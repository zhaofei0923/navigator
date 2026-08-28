"""Transactional, append-only importer for signed BASIC60 release artifacts."""

from __future__ import annotations

import argparse
import hashlib
import json
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from navigator_api.basic60_config import Basic60Settings
from navigator_api.basic60_governance import (
    Basic60GovernanceError,
    validate_basic60_activation,
)
from navigator_api.basic60_models import (
    Basic60AdminStructure,
    Basic60Base,
    Basic60Capital,
    Basic60Country,
    Basic60CountryCurrency,
    Basic60CountryLanguage,
    Basic60CountryTimezone,
    Basic60DataRecordVersion,
    Basic60FieldProvenance,
    Basic60LocalizedText,
    Basic60MetricDefinition,
    Basic60MetricValue,
    Basic60RawRecord,
    Basic60Release,
    Basic60SourceRegistry,
    Basic60SourceSnapshot,
)
from navigator_api.basic60_seed_contract import (
    Basic60SeedArtifact,
    CountryArtifact,
    MetricValueArtifact,
    ProvenancedArtifact,
)
from navigator_api.database import build_engine, build_session_factory

MAX_SEED_BYTES = 128 * 1024 * 1024
EXPECTED_PRIVATE_TRIAL_COUNTS = {
    "countries": 60,
    "macro_rows": 300,
    "energy_rows": 60,
    "available_metric_values": 2279,
    "pending_metric_values": 61,
}


class Basic60ImportError(RuntimeError):
    """Raised when a release cannot be imported without weakening a guard."""


def _canonical_sha256(value: Any) -> str:
    payload = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def load_seed_artifact(path: Path) -> tuple[Basic60SeedArtifact, str]:
    try:
        size = path.stat().st_size
        if size > MAX_SEED_BYTES:
            raise Basic60ImportError("BASIC60 seed artifact exceeds the 128 MiB safety limit")
        payload = path.read_bytes()
    except OSError as exc:
        raise Basic60ImportError(f"Cannot read BASIC60 seed artifact: {path}") from exc
    digest = hashlib.sha256(payload).hexdigest()
    try:
        artifact = Basic60SeedArtifact.model_validate_json(payload)
    except ValueError as exc:
        raise Basic60ImportError(f"BASIC60 seed artifact is invalid: {exc}") from exc
    return artifact, digest


def _validate_activation(
    artifact: Basic60SeedArtifact,
    artifact_sha256: str,
    settings: Basic60Settings,
) -> None:
    if artifact.release.status != "private_trial_ready":
        raise Basic60ImportError("Only a private_trial_ready artifact can be activated")
    if settings.enforce_baseline_counts:
        declared = artifact.release.counts.model_dump()
        if declared != EXPECTED_PRIVATE_TRIAL_COUNTS:
            raise Basic60ImportError(
                "BASIC60 activation counts do not match the approved V1 baseline: "
                f"expected={EXPECTED_PRIVATE_TRIAL_COUNTS}, actual={declared}"
            )
    try:
        validate_basic60_activation(
            settings,
            release_id=artifact.release.release_id,
            release_bundle_sha256=artifact.release.release_bundle_sha256,
            validation_report_sha256=artifact.release.validation_report_sha256,
            seed_artifact_sha256=artifact_sha256,
        )
    except Basic60GovernanceError as exc:
        raise Basic60ImportError(str(exc)) from exc


def _existing_versions(session: Session) -> dict[tuple[str, str], int]:
    statement = select(
        Basic60DataRecordVersion.entity_type,
        Basic60DataRecordVersion.entity_key,
        func.max(Basic60DataRecordVersion.version_number),
    ).group_by(
        Basic60DataRecordVersion.entity_type,
        Basic60DataRecordVersion.entity_key,
    )
    return {
        (entity_type, entity_key): int(version_number)
        for entity_type, entity_key, version_number in session.execute(statement)
    }


def _record_version(
    *,
    release_id: str,
    raw_record: Basic60RawRecord | None,
    entity_type: str,
    entity_key: str,
    payload: Any,
    published: bool,
    previous_versions: dict[tuple[str, str], int],
    created_at: datetime,
) -> Basic60DataRecordVersion:
    key = (entity_type, entity_key)
    version_number = previous_versions.get(key, 0) + 1
    previous_versions[key] = version_number
    return Basic60DataRecordVersion(
        release_id=release_id,
        raw_record_id=raw_record.id if raw_record is not None else None,
        entity_type=entity_type,
        entity_key=entity_key,
        version_number=version_number,
        record_sha256=_canonical_sha256(payload),
        record_status="published" if published else "pending",
        created_at=created_at,
    )


def _provenance(
    *,
    release_id: str,
    raw_record: Basic60RawRecord,
    country_code: str,
    item: ProvenancedArtifact,
    field_path: str,
    quality_status: str,
) -> Basic60FieldProvenance:
    return Basic60FieldProvenance(
        release_id=release_id,
        raw_record_id=raw_record.id,
        entity_type="country",
        entity_key=country_code,
        field_path=field_path,
        source_field=field_path,
        transform_ref="basic60.seed.v1",
        source_ref=item.source_ref,
        quality_status=quality_status,
    )


def _add_country_identity(
    session: Session,
    *,
    release_id: str,
    country: Basic60Country,
    artifact: CountryArtifact,
    raw_by_ref: dict[str, Basic60RawRecord],
) -> None:
    for localized_index, localized_item in enumerate(artifact.localized_texts, start=1):
        country.localized_texts.append(
            Basic60LocalizedText(
                field_code=localized_item.field_code,
                locale=localized_item.locale,
                text=localized_item.text,
                preferred=localized_item.preferred,
                translation_status=localized_item.translation_status,
                source_text_sha256=localized_item.source_text_sha256,
                valid_from=localized_item.valid_from,
                valid_to=localized_item.valid_to,
                source_ref=localized_item.source_ref,
            )
        )
        session.add(
            _provenance(
                release_id=release_id,
                raw_record=raw_by_ref[localized_item.raw_record_ref],
                country_code=artifact.iso3,
                item=localized_item,
                field_path=(
                    f"localized_texts.{localized_item.field_code}."
                    f"{localized_item.locale}.{localized_index}"
                ),
                quality_status=localized_item.translation_status,
            )
        )
    for capital_item in artifact.capitals:
        country.capitals.append(
            Basic60Capital(
                name=capital_item.name,
                role=capital_item.role,
                display_order=capital_item.display_order,
                valid_from=capital_item.valid_from,
                valid_to=capital_item.valid_to,
                source_ref=capital_item.source_ref,
            )
        )
        session.add(
            _provenance(
                release_id=release_id,
                raw_record=raw_by_ref[capital_item.raw_record_ref],
                country_code=artifact.iso3,
                item=capital_item,
                field_path=f"capitals.{capital_item.display_order}",
                quality_status="reviewed",
            )
        )
    for language_item in artifact.languages:
        country.languages.append(
            Basic60CountryLanguage(
                language_code=language_item.code,
                name_en=language_item.name_en,
                name_local=language_item.name_local,
                status=language_item.status,
                source_ref=language_item.source_ref,
            )
        )
        session.add(
            _provenance(
                release_id=release_id,
                raw_record=raw_by_ref[language_item.raw_record_ref],
                country_code=artifact.iso3,
                item=language_item,
                field_path=f"languages.{language_item.code}",
                quality_status="reviewed",
            )
        )
    for currency_item in artifact.currencies:
        country.currencies.append(
            Basic60CountryCurrency(
                currency_code=currency_item.code,
                name_en=currency_item.name_en,
                legal_tender=currency_item.legal_tender,
                valid_from=currency_item.valid_from,
                valid_to=currency_item.valid_to,
                source_ref=currency_item.source_ref,
            )
        )
        session.add(
            _provenance(
                release_id=release_id,
                raw_record=raw_by_ref[currency_item.raw_record_ref],
                country_code=artifact.iso3,
                item=currency_item,
                field_path=f"currencies.{currency_item.code}",
                quality_status="reviewed",
            )
        )
    for timezone_item in artifact.timezones:
        country.timezones.append(
            Basic60CountryTimezone(
                iana_code=timezone_item.iana_code,
                primary=timezone_item.primary,
                source_ref=timezone_item.source_ref,
            )
        )
        session.add(
            _provenance(
                release_id=release_id,
                raw_record=raw_by_ref[timezone_item.raw_record_ref],
                country_code=artifact.iso3,
                item=timezone_item,
                field_path=f"timezones.{timezone_item.iana_code}",
                quality_status="reviewed",
            )
        )
    for admin_item in artifact.admin_structures:
        country.admin_structures.append(
            Basic60AdminStructure(
                admin_level=admin_item.admin_level,
                unit_type=admin_item.unit_type,
                unit_count=admin_item.unit_count,
                as_of_year=admin_item.as_of_year,
                status=admin_item.status,
                source_ref=admin_item.source_ref,
            )
        )
        session.add(
            _provenance(
                release_id=release_id,
                raw_record=raw_by_ref[admin_item.raw_record_ref],
                country_code=artifact.iso3,
                item=admin_item,
                field_path=(f"admin_structures.{admin_item.admin_level}.{admin_item.as_of_year}"),
                quality_status=admin_item.status,
            )
        )


def _add_metric(
    session: Session,
    *,
    release_id: str,
    country: Basic60Country,
    country_code: str,
    item: MetricValueArtifact,
    definition: Basic60MetricDefinition,
    raw_record: Basic60RawRecord,
    published: bool,
    previous_versions: dict[tuple[str, str], int],
    imported_at: datetime,
) -> None:
    country.metric_values.append(
        Basic60MetricValue(
            definition=definition,
            period_start=item.period_start,
            period_end=item.period_end,
            period_label=item.period_label,
            original_value=item.original_value,
            original_unit=item.original_unit,
            normalized_value=item.normalized_value,
            normalized_unit=item.normalized_unit,
            value_status=item.value_status,
            null_reason=item.null_reason,
            source_ref=item.source_ref,
            source_snapshot_ref=item.source_snapshot_ref,
            raw_record_ref=item.raw_record_ref,
            quality_status=item.quality_status,
            freshness_status=item.freshness_status,
            reviewed_at=item.reviewed_at,
        )
    )
    entity_key = (
        f"{country_code}:{item.metric_code}:{item.period_start.isoformat()}:"
        f"{item.period_end.isoformat()}"
    )
    session.add(
        _record_version(
            release_id=release_id,
            raw_record=raw_record,
            entity_type="country_metric_value",
            entity_key=entity_key,
            payload=item.model_dump(mode="json"),
            published=published,
            previous_versions=previous_versions,
            created_at=imported_at,
        )
    )
    session.add(
        _provenance(
            release_id=release_id,
            raw_record=raw_record,
            country_code=country_code,
            item=item,
            field_path=f"metrics.{item.metric_code}.{item.period_label}",
            quality_status=item.quality_status,
        )
    )


def database_counts(session: Session, release_id: str) -> dict[str, int]:
    country_count = (
        session.scalar(
            select(func.count())
            .select_from(Basic60Country)
            .where(Basic60Country.release_id == release_id)
        )
        or 0
    )
    metric_statement = (
        select(Basic60MetricValue.value_status, func.count())
        .join(Basic60Country)
        .where(Basic60Country.release_id == release_id)
        .group_by(Basic60MetricValue.value_status)
    )
    metric_counts: dict[str, int] = {}
    for status, count in session.execute(metric_statement).tuples():
        metric_counts[status] = count
    return {
        "countries": country_count,
        "available_metric_values": metric_counts.get("available", 0),
        "pending_metric_values": metric_counts.get("pending", 0),
        "unavailable_metric_values": metric_counts.get("unavailable", 0),
    }


def validate_basic60_release_counts(
    session: Session, release: Basic60Release, settings: Basic60Settings
) -> None:
    if not settings.enforce_baseline_counts:
        return
    if release.declared_counts != EXPECTED_PRIVATE_TRIAL_COUNTS:
        raise Basic60ImportError("Stored BASIC60 release counts do not match the V1 baseline")
    actual = database_counts(session, release.release_id)
    expected_actual = {
        "countries": EXPECTED_PRIVATE_TRIAL_COUNTS["countries"],
        "available_metric_values": EXPECTED_PRIVATE_TRIAL_COUNTS["available_metric_values"],
        "pending_metric_values": EXPECTED_PRIVATE_TRIAL_COUNTS["pending_metric_values"],
        "unavailable_metric_values": 0,
    }
    if actual != expected_actual:
        raise Basic60ImportError(
            f"Stored BASIC60 row counts do not match the release declaration: {actual}"
        )


def validate_basic60_manual_usage_authorization(release: Basic60Release) -> None:
    """Verify the stored release-scoped A1 decision has not drifted."""

    authorization = release.manual_usage_authorization
    if not isinstance(authorization, dict) or not authorization:
        raise Basic60ImportError("Stored BASIC60 A1 manual usage authorization is missing")
    actual_sha256 = _canonical_sha256(authorization)
    if actual_sha256 != release.manual_usage_authorization_sha256:
        raise Basic60ImportError("Stored BASIC60 A1 manual usage authorization hash mismatch")


def _source(
    session: Session,
    release_id: str,
    source_ref: str,
    *,
    for_update: bool = False,
) -> Basic60SourceRegistry:
    if session.get(Basic60Release, release_id) is None:
        raise Basic60ImportError(f"Unknown BASIC60 release: {release_id}")
    statement = select(Basic60SourceRegistry).where(
        Basic60SourceRegistry.release_id == release_id,
        Basic60SourceRegistry.source_ref == source_ref,
    )
    if for_update:
        statement = statement.with_for_update()
    source = session.scalar(statement)
    if source is None:
        raise Basic60ImportError(f"Unknown BASIC60 source for release {release_id}: {source_ref}")
    return source


def basic60_source_status_snapshot(
    session: Session,
    release_id: str,
    source_ref: str,
) -> dict[str, object]:
    """Return a machine-readable retained/visible snapshot for a D4 revocation drill."""

    normalized_ref = source_ref.strip()
    source = _source(session, release_id, normalized_ref)
    raw_statement = (
        select(func.count())
        .select_from(Basic60RawRecord)
        .join(
            Basic60SourceSnapshot,
            Basic60RawRecord.source_snapshot_id == Basic60SourceSnapshot.id,
        )
        .where(
            Basic60RawRecord.release_id == release_id,
            Basic60SourceSnapshot.source_id == source.id,
        )
    )
    metric_statement = (
        select(func.count())
        .select_from(Basic60MetricValue)
        .join(Basic60Country)
        .where(
            Basic60Country.release_id == release_id,
            Basic60MetricValue.source_ref == normalized_ref,
        )
    )
    provenance_statement = (
        select(func.count())
        .select_from(Basic60FieldProvenance)
        .where(
            Basic60FieldProvenance.release_id == release_id,
            Basic60FieldProvenance.source_ref == normalized_ref,
        )
    )
    version_statement = (
        select(func.count())
        .select_from(Basic60DataRecordVersion)
        .join(
            Basic60RawRecord,
            Basic60DataRecordVersion.raw_record_id == Basic60RawRecord.id,
        )
        .join(
            Basic60SourceSnapshot,
            Basic60RawRecord.source_snapshot_id == Basic60SourceSnapshot.id,
        )
        .where(
            Basic60DataRecordVersion.release_id == release_id,
            Basic60SourceSnapshot.source_id == source.id,
        )
    )
    identity_models = (
        Basic60LocalizedText,
        Basic60Capital,
        Basic60CountryLanguage,
        Basic60CountryCurrency,
        Basic60CountryTimezone,
        Basic60AdminStructure,
    )
    stored_identity_values = sum(
        int(
            session.scalar(
                select(func.count())
                .select_from(model)
                .join(Basic60Country)
                .where(
                    Basic60Country.release_id == release_id,
                    model.source_ref == normalized_ref,
                )
            )
            or 0
        )
        for model in identity_models
    )
    stored_raw_records = int(session.scalar(raw_statement) or 0)
    stored_metric_values = int(session.scalar(metric_statement) or 0)
    stored_provenance_rows = int(session.scalar(provenance_statement) or 0)
    stored_record_versions = int(session.scalar(version_statement) or 0)
    visible = source.status == "active"
    return {
        "release_id": release_id,
        "source_ref": normalized_ref,
        "status": source.status,
        "stored_raw_records": stored_raw_records,
        "stored_identity_values": stored_identity_values,
        "stored_metric_values": stored_metric_values,
        "stored_provenance_rows": stored_provenance_rows,
        "stored_record_versions": stored_record_versions,
        "visible_identity_values": stored_identity_values if visible else 0,
        "visible_metric_values": stored_metric_values if visible else 0,
        "visible_provenance_rows": stored_provenance_rows if visible else 0,
    }


def revoke_basic60_source(
    session: Session,
    release_id: str,
    source_ref: str,
) -> dict[str, object]:
    """Revoke one retained source without deleting or rewriting historical rows."""

    normalized_ref = source_ref.strip()
    source = _source(session, release_id, normalized_ref, for_update=True)
    if source.status not in {"active", "revoked"}:
        raise Basic60ImportError(
            f"Unsupported BASIC60 source status for {normalized_ref}: {source.status}"
        )
    changed = source.status == "active"
    try:
        if changed:
            source.status = "revoked"
        session.commit()
    except Exception:
        session.rollback()
        raise
    snapshot = basic60_source_status_snapshot(session, release_id, normalized_ref)
    return {"changed": changed, **snapshot}


def import_basic60_seed_file(
    session: Session,
    path: Path,
    settings: Basic60Settings,
    *,
    activate: bool,
) -> dict[str, int]:
    artifact, artifact_sha256 = load_seed_artifact(path)
    if activate:
        _validate_activation(artifact, artifact_sha256, settings)

    existing = session.get(Basic60Release, artifact.release.release_id)
    if existing is not None:
        if existing.artifact_sha256 != artifact_sha256:
            raise Basic60ImportError(
                "release_id already exists with a different immutable seed artifact hash"
            )
        if activate and not existing.is_active:
            activate_basic60_release(session, existing.release_id, settings)
        elif activate:
            validate_basic60_release_counts(session, existing, settings)
        return database_counts(session, existing.release_id)

    imported_at = datetime.now(UTC)
    published = activate and artifact.release.status == "private_trial_ready"
    release = Basic60Release(
        release_id=artifact.release.release_id,
        release_profile=artifact.release.release_profile,
        formal_gate_status=artifact.release.formal_gate_status,
        status=artifact.release.status,
        as_of=artifact.release.as_of,
        source_cutoff=artifact.release.source_cutoff,
        artifact_schema_version=artifact.schema_version,
        artifact_sha256=artifact_sha256,
        release_bundle_sha256=artifact.release.release_bundle_sha256,
        validation_report_sha256=artifact.release.validation_report_sha256,
        declared_counts=artifact.release.counts.model_dump(),
        manual_usage_authorization=artifact.manual_usage_authorization.model_dump(mode="json"),
        manual_usage_authorization_sha256=_canonical_sha256(
            artifact.manual_usage_authorization.model_dump(mode="json")
        ),
        is_active=False,
        imported_at=imported_at,
    )
    session.add(release)

    try:
        snapshot_by_ref: dict[tuple[str, str], Basic60SourceSnapshot] = {}
        for source_item in artifact.sources:
            source = Basic60SourceRegistry(
                release=release,
                source_ref=source_item.source_ref,
                provider=source_item.provider,
                dataset=source_item.dataset,
                data_domain=source_item.data_domain,
                source_role=source_item.source_role,
                status=source_item.status,
                terms_uri=source_item.terms_uri,
                evidence_sha256=source_item.evidence_sha256,
                access_method=source_item.access_method,
                rate_limit=source_item.rate_limit,
            )
            session.add(source)
            for snapshot_item in source_item.snapshots:
                snapshot = Basic60SourceSnapshot(
                    source=source,
                    snapshot_ref=snapshot_item.snapshot_ref,
                    captured_at=snapshot_item.captured_at,
                    content_sha256=snapshot_item.content_sha256,
                    retrieval_uri=snapshot_item.retrieval_uri,
                    media_type=snapshot_item.media_type,
                )
                session.add(snapshot)
                snapshot_by_ref[(source_item.source_ref, snapshot_item.snapshot_ref)] = snapshot
        session.flush()

        raw_by_ref: dict[str, Basic60RawRecord] = {}
        for raw_item in artifact.raw_records:
            raw = Basic60RawRecord(
                release_id=release.release_id,
                source_snapshot=snapshot_by_ref[
                    (raw_item.source_ref, raw_item.source_snapshot_ref)
                ],
                record_ref=raw_item.record_ref,
                country_code=raw_item.country_code,
                object_key=raw_item.object_key,
                payload_sha256=raw_item.payload_sha256,
                media_type=raw_item.media_type,
                imported_at=imported_at,
            )
            session.add(raw)
            raw_by_ref[raw_item.record_ref] = raw
        session.flush()

        definitions: dict[str, Basic60MetricDefinition] = {}
        for item in artifact.metric_definitions:
            definition = Basic60MetricDefinition(
                release=release,
                metric_code=item.metric_code,
                label_zh=item.label_zh,
                label_en=item.label_en,
                data_domain=item.data_domain,
                canonical_unit=item.canonical_unit,
                period_type=item.period_type,
                display_precision=item.display_precision,
                normalization_rule=item.normalization_rule,
            )
            session.add(definition)
            definitions[item.metric_code] = definition
        session.flush()

        previous_versions = _existing_versions(session)
        for country_item in artifact.countries:
            country = Basic60Country(
                release=release,
                iso3=country_item.iso3,
                iso2=country_item.iso2,
                region_code=country_item.region_code,
                coverage_status=country_item.coverage_status,
                coverage_level=country_item.coverage_level,
                opportunity_level=country_item.opportunity_level,
                policy_friendliness_level=country_item.policy_friendliness_level,
                risk_assessment_status=country_item.risk_assessment_status,
                risk_level=country_item.risk_level,
                last_reviewed_at=country_item.last_reviewed_at,
            )
            session.add(country)
            _add_country_identity(
                session,
                release_id=release.release_id,
                country=country,
                artifact=country_item,
                raw_by_ref=raw_by_ref,
            )
            identity_raw = raw_by_ref[country_item.localized_texts[0].raw_record_ref]
            session.add(
                _record_version(
                    release_id=release.release_id,
                    raw_record=identity_raw,
                    entity_type="country",
                    entity_key=country_item.iso3,
                    payload=country_item.model_dump(mode="json", exclude={"metrics"}),
                    published=published,
                    previous_versions=previous_versions,
                    created_at=imported_at,
                )
            )
            for metric_item in country_item.metrics:
                _add_metric(
                    session,
                    release_id=release.release_id,
                    country=country,
                    country_code=country_item.iso3,
                    item=metric_item,
                    definition=definitions[metric_item.metric_code],
                    raw_record=raw_by_ref[metric_item.raw_record_ref],
                    published=published,
                    previous_versions=previous_versions,
                    imported_at=imported_at,
                )

        session.flush()
        if activate:
            session.execute(
                update(Basic60Release)
                .where(Basic60Release.is_active.is_(True))
                .values(is_active=False)
            )
            release.is_active = True
        session.commit()
    except Exception:
        session.rollback()
        raise
    return database_counts(session, release.release_id)


def activate_basic60_release(session: Session, release_id: str, settings: Basic60Settings) -> None:
    release = session.get(Basic60Release, release_id)
    if release is None:
        raise Basic60ImportError(f"Unknown BASIC60 release: {release_id}")
    if release.status != "private_trial_ready":
        raise Basic60ImportError("Only a private_trial_ready release can be activated")
    validate_basic60_manual_usage_authorization(release)
    validate_basic60_release_counts(session, release, settings)
    try:
        validate_basic60_activation(
            settings,
            release_id=release.release_id,
            release_bundle_sha256=release.release_bundle_sha256,
            validation_report_sha256=release.validation_report_sha256,
            seed_artifact_sha256=release.artifact_sha256,
        )
    except Basic60GovernanceError as exc:
        raise Basic60ImportError(str(exc)) from exc
    try:
        session.execute(
            update(Basic60Release).where(Basic60Release.is_active.is_(True)).values(is_active=False)
        )
        release.is_active = True
        session.execute(
            update(Basic60DataRecordVersion)
            .where(Basic60DataRecordVersion.release_id == release_id)
            .values(record_status="published")
        )
        session.commit()
    except Exception:
        session.rollback()
        raise


def revoke_basic60_release(session: Session, release_id: str, settings: Basic60Settings) -> None:
    release = session.get(Basic60Release, release_id)
    if release is None:
        raise Basic60ImportError(f"Unknown BASIC60 release: {release_id}")
    try:
        validate_basic60_activation(
            settings,
            release_id=release.release_id,
            release_bundle_sha256=release.release_bundle_sha256,
            validation_report_sha256=release.validation_report_sha256,
            seed_artifact_sha256=release.artifact_sha256,
        )
    except Basic60GovernanceError as exc:
        raise Basic60ImportError(str(exc)) from exc
    try:
        release.is_active = False
        release.status = "revoked"
        release.revoked_at = datetime.now(UTC)
        session.execute(
            update(Basic60DataRecordVersion)
            .where(Basic60DataRecordVersion.release_id == release_id)
            .values(record_status="revoked")
        )
        session.commit()
    except Exception:
        session.rollback()
        raise


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--path", type=Path, help="Override BASIC60_SEED_PATH")
    parser.add_argument("--no-activate", action="store_true")
    parser.add_argument("--create-schema", action="store_true")
    parser.add_argument("--activate-release")
    parser.add_argument("--revoke-release")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.activate_release and args.revoke_release:
        raise SystemExit("--activate-release and --revoke-release are mutually exclusive")
    settings = Basic60Settings.from_env()
    engine = build_engine(settings.database_url)
    if args.create_schema:
        Basic60Base.metadata.create_all(engine)
    session_factory = build_session_factory(engine)
    with session_factory() as session:
        if args.activate_release:
            activate_basic60_release(session, args.activate_release, settings)
            result: dict[str, object] = {"activated_release_id": args.activate_release}
        elif args.revoke_release:
            revoke_basic60_release(session, args.revoke_release, settings)
            result = {"revoked_release_id": args.revoke_release}
        else:
            seed_path = args.path or settings.seed_path
            counts = import_basic60_seed_file(
                session,
                seed_path,
                settings,
                activate=not args.no_activate,
            )
            result = {"seed_path": str(seed_path), "record_counts": counts}
    engine.dispose()
    print(
        json.dumps(
            {"release_profile": "basic60_private", "formal_gate_status": "pending", **result},
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
