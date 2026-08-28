"""Create the isolated BASIC60 private-trial schema.

Revision ID: 20260825_b60001
Revises: None
Create Date: 2026-08-25
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260825_b60001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = ("basic60_private",)
depends_on: str | Sequence[str] | None = None


def _uuid_id() -> sa.Column[object]:
    return sa.Column("id", sa.Uuid(), nullable=False)


def upgrade() -> None:
    op.create_table(
        "basic60_release_snapshots",
        sa.Column("release_id", sa.String(length=80), nullable=False),
        sa.Column(
            "release_profile",
            sa.String(length=32),
            server_default="basic60_private",
            nullable=False,
        ),
        sa.Column(
            "formal_gate_status", sa.String(length=24), server_default="pending", nullable=False
        ),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("as_of", sa.Date(), nullable=False),
        sa.Column("source_cutoff", sa.Date(), nullable=False),
        sa.Column("artifact_schema_version", sa.String(length=40), nullable=False),
        sa.Column("artifact_sha256", sa.String(length=64), nullable=False),
        sa.Column("release_bundle_sha256", sa.String(length=64), nullable=False),
        sa.Column("validation_report_sha256", sa.String(length=64), nullable=False),
        sa.Column("declared_counts", sa.JSON(), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("imported_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "release_profile = 'basic60_private'", name="ck_basic60_release_profile"
        ),
        sa.CheckConstraint("formal_gate_status = 'pending'", name="ck_basic60_formal_gate_pending"),
        sa.CheckConstraint(
            "status IN ('private_trial_ready', 'not_ready', 'revoked')",
            name="ck_basic60_release_status",
        ),
        sa.CheckConstraint(
            "NOT is_active OR status = 'private_trial_ready'",
            name="ck_basic60_active_release_ready",
        ),
        sa.PrimaryKeyConstraint("release_id"),
        sa.UniqueConstraint("artifact_sha256"),
    )
    op.create_index("ix_basic60_release_snapshots_as_of", "basic60_release_snapshots", ["as_of"])
    op.create_index(
        "ix_basic60_release_snapshots_is_active", "basic60_release_snapshots", ["is_active"]
    )

    op.create_table(
        "basic60_source_registry",
        _uuid_id(),
        sa.Column("release_id", sa.String(length=80), nullable=False),
        sa.Column("source_ref", sa.String(length=120), nullable=False),
        sa.Column("provider", sa.String(length=160), nullable=False),
        sa.Column("dataset", sa.String(length=240), nullable=False),
        sa.Column("data_domain", sa.String(length=32), nullable=False),
        sa.Column("source_role", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("terms_uri", sa.Text(), nullable=False),
        sa.Column("evidence_sha256", sa.String(length=64), nullable=False),
        sa.Column("license_scope", sa.JSON(), nullable=False),
        sa.Column("access_method", sa.String(length=80), nullable=False),
        sa.Column("rate_limit", sa.String(length=160), nullable=True),
        sa.Column("ai_processing", sa.String(length=32), nullable=False),
        sa.Column("cloud_processing", sa.String(length=32), nullable=False),
        sa.CheckConstraint(
            "data_domain IN ('country_identity', 'macro', 'energy')",
            name="ck_basic60_source_domain",
        ),
        sa.CheckConstraint(
            "source_role IN ('primary', 'alternate')", name="ck_basic60_source_role"
        ),
        sa.CheckConstraint("status = 'active'", name="ck_basic60_source_active"),
        sa.CheckConstraint("ai_processing = 'prohibited_for_v1'", name="ck_basic60_source_no_ai"),
        sa.CheckConstraint(
            "cloud_processing = 'prohibited_for_v1'", name="ck_basic60_source_no_cloud"
        ),
        sa.ForeignKeyConstraint(["release_id"], ["basic60_release_snapshots.release_id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("release_id", "source_ref", name="uq_basic60_source_release_ref"),
    )
    op.create_index(
        "ix_basic60_source_registry_release_id", "basic60_source_registry", ["release_id"]
    )

    op.create_table(
        "basic60_source_snapshots",
        _uuid_id(),
        sa.Column("source_id", sa.Uuid(), nullable=False),
        sa.Column("snapshot_ref", sa.String(length=180), nullable=False),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("content_sha256", sa.String(length=64), nullable=False),
        sa.Column("retrieval_uri", sa.Text(), nullable=True),
        sa.Column("media_type", sa.String(length=120), nullable=False),
        sa.ForeignKeyConstraint(["source_id"], ["basic60_source_registry.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("source_id", "snapshot_ref", name="uq_basic60_source_snapshot_ref"),
    )
    op.create_index(
        "ix_basic60_source_snapshots_source_id", "basic60_source_snapshots", ["source_id"]
    )

    op.create_table(
        "basic60_countries",
        _uuid_id(),
        sa.Column("release_id", sa.String(length=80), nullable=False),
        sa.Column("iso3", sa.String(length=3), nullable=False),
        sa.Column("iso2", sa.String(length=2), nullable=False),
        sa.Column("region_code", sa.String(length=40), nullable=False),
        sa.Column("coverage_status", sa.String(length=24), nullable=False),
        sa.Column("coverage_level", sa.String(length=16), nullable=False),
        sa.Column("opportunity_level", sa.String(length=24), nullable=False),
        sa.Column("policy_friendliness_level", sa.String(length=24), nullable=False),
        sa.Column("risk_assessment_status", sa.String(length=24), nullable=False),
        sa.Column("risk_level", sa.String(length=24), nullable=True),
        sa.Column("last_reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("length(iso3) = 3", name="ck_basic60_country_iso3"),
        sa.CheckConstraint("length(iso2) = 2", name="ck_basic60_country_iso2"),
        sa.CheckConstraint("coverage_status = 'covered'", name="ck_basic60_country_covered"),
        sa.CheckConstraint("coverage_level = 'Basic'", name="ck_basic60_country_level"),
        sa.CheckConstraint("opportunity_level = 'pending'", name="ck_basic60_country_opportunity"),
        sa.CheckConstraint(
            "policy_friendliness_level = 'pending'", name="ck_basic60_country_policy"
        ),
        sa.CheckConstraint(
            "risk_assessment_status = 'unknown'", name="ck_basic60_country_risk_status"
        ),
        sa.CheckConstraint("risk_level IS NULL", name="ck_basic60_country_risk_null"),
        sa.ForeignKeyConstraint(["release_id"], ["basic60_release_snapshots.release_id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("release_id", "iso2", name="uq_basic60_country_release_iso2"),
        sa.UniqueConstraint("release_id", "iso3", name="uq_basic60_country_release_iso3"),
    )
    op.create_index("ix_basic60_countries_iso3", "basic60_countries", ["iso3"])
    op.create_index("ix_basic60_countries_region_code", "basic60_countries", ["region_code"])
    op.create_index("ix_basic60_countries_release_id", "basic60_countries", ["release_id"])

    op.create_table(
        "basic60_localized_texts",
        _uuid_id(),
        sa.Column("country_id", sa.Uuid(), nullable=False),
        sa.Column("field_code", sa.String(length=40), nullable=False),
        sa.Column("locale", sa.String(length=40), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("preferred", sa.Boolean(), nullable=False),
        sa.Column("translation_status", sa.String(length=24), nullable=False),
        sa.Column("source_text_sha256", sa.String(length=64), nullable=False),
        sa.Column("valid_from", sa.Date(), nullable=True),
        sa.Column("valid_to", sa.Date(), nullable=True),
        sa.Column("source_ref", sa.String(length=120), nullable=False),
        sa.CheckConstraint(
            "translation_status IN ('reviewed', 'source', 'pending')",
            name="ck_basic60_translation_status",
        ),
        sa.ForeignKeyConstraint(["country_id"], ["basic60_countries.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "country_id", "field_code", "locale", "text", name="uq_basic60_localized_text"
        ),
    )
    op.create_index(
        "ix_basic60_localized_texts_country_id", "basic60_localized_texts", ["country_id"]
    )

    op.create_table(
        "basic60_country_capitals",
        _uuid_id(),
        sa.Column("country_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("role", sa.String(length=24), nullable=False),
        sa.Column("display_order", sa.Integer(), nullable=False),
        sa.Column("valid_from", sa.Date(), nullable=True),
        sa.Column("valid_to", sa.Date(), nullable=True),
        sa.Column("source_ref", sa.String(length=120), nullable=False),
        sa.CheckConstraint(
            "role IN ('official', 'administrative', 'legislative', 'judicial', 'de_facto')",
            name="ck_basic60_capital_role",
        ),
        sa.ForeignKeyConstraint(["country_id"], ["basic60_countries.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("country_id", "name", "role", name="uq_basic60_capital_role"),
    )
    op.create_index(
        "ix_basic60_country_capitals_country_id", "basic60_country_capitals", ["country_id"]
    )

    op.create_table(
        "basic60_country_languages",
        _uuid_id(),
        sa.Column("country_id", sa.Uuid(), nullable=False),
        sa.Column("language_code", sa.String(length=40), nullable=False),
        sa.Column("name_en", sa.String(length=120), nullable=False),
        sa.Column("name_local", sa.String(length=160), nullable=True),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("source_ref", sa.String(length=120), nullable=False),
        sa.CheckConstraint(
            "status IN ('official', 'co_official', 'recognized')",
            name="ck_basic60_language_status",
        ),
        sa.ForeignKeyConstraint(["country_id"], ["basic60_countries.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("country_id", "language_code", name="uq_basic60_country_language"),
    )
    op.create_index(
        "ix_basic60_country_languages_country_id", "basic60_country_languages", ["country_id"]
    )

    op.create_table(
        "basic60_country_currencies",
        _uuid_id(),
        sa.Column("country_id", sa.Uuid(), nullable=False),
        sa.Column("currency_code", sa.String(length=3), nullable=False),
        sa.Column("name_en", sa.String(length=120), nullable=False),
        sa.Column("legal_tender", sa.Boolean(), nullable=False),
        sa.Column("valid_from", sa.Date(), nullable=True),
        sa.Column("valid_to", sa.Date(), nullable=True),
        sa.Column("source_ref", sa.String(length=120), nullable=False),
        sa.ForeignKeyConstraint(["country_id"], ["basic60_countries.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("country_id", "currency_code", name="uq_basic60_country_currency"),
    )
    op.create_index(
        "ix_basic60_country_currencies_country_id",
        "basic60_country_currencies",
        ["country_id"],
    )

    op.create_table(
        "basic60_country_timezones",
        _uuid_id(),
        sa.Column("country_id", sa.Uuid(), nullable=False),
        sa.Column("iana_code", sa.String(length=80), nullable=False),
        sa.Column("primary", sa.Boolean(), nullable=False),
        sa.Column("source_ref", sa.String(length=120), nullable=False),
        sa.ForeignKeyConstraint(["country_id"], ["basic60_countries.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("country_id", "iana_code", name="uq_basic60_country_timezone"),
    )
    op.create_index(
        "ix_basic60_country_timezones_country_id", "basic60_country_timezones", ["country_id"]
    )

    op.create_table(
        "basic60_admin_structures",
        _uuid_id(),
        sa.Column("country_id", sa.Uuid(), nullable=False),
        sa.Column("admin_level", sa.Integer(), nullable=False),
        sa.Column("unit_type", sa.String(length=120), nullable=False),
        sa.Column("unit_count", sa.Integer(), nullable=False),
        sa.Column("as_of_year", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("source_ref", sa.String(length=120), nullable=False),
        sa.CheckConstraint("admin_level >= 1", name="ck_basic60_admin_level"),
        sa.CheckConstraint("unit_count >= 0", name="ck_basic60_admin_count"),
        sa.CheckConstraint("status IN ('reviewed', 'pending')", name="ck_basic60_admin_status"),
        sa.ForeignKeyConstraint(["country_id"], ["basic60_countries.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "country_id", "admin_level", "unit_type", "as_of_year", name="uq_basic60_admin"
        ),
    )
    op.create_index(
        "ix_basic60_admin_structures_country_id", "basic60_admin_structures", ["country_id"]
    )

    op.create_table(
        "basic60_metric_definitions",
        _uuid_id(),
        sa.Column("release_id", sa.String(length=80), nullable=False),
        sa.Column("metric_code", sa.String(length=80), nullable=False),
        sa.Column("label_zh", sa.String(length=160), nullable=False),
        sa.Column("label_en", sa.String(length=160), nullable=False),
        sa.Column("data_domain", sa.String(length=16), nullable=False),
        sa.Column("canonical_unit", sa.String(length=40), nullable=False),
        sa.Column("period_type", sa.String(length=16), nullable=False),
        sa.Column("display_precision", sa.Integer(), nullable=False),
        sa.Column("normalization_rule", sa.Text(), nullable=False),
        sa.CheckConstraint(
            "data_domain IN ('identity', 'macro', 'energy')",
            name="ck_basic60_metric_domain",
        ),
        sa.CheckConstraint(
            "period_type IN ('year', 'date', 'latest')", name="ck_basic60_period_type"
        ),
        sa.ForeignKeyConstraint(["release_id"], ["basic60_release_snapshots.release_id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("release_id", "metric_code", name="uq_basic60_metric_release_code"),
    )
    op.create_index(
        "ix_basic60_metric_definitions_release_id",
        "basic60_metric_definitions",
        ["release_id"],
    )

    op.create_table(
        "basic60_metric_values",
        _uuid_id(),
        sa.Column("country_id", sa.Uuid(), nullable=False),
        sa.Column("metric_definition_id", sa.Uuid(), nullable=False),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("period_end", sa.Date(), nullable=False),
        sa.Column("period_label", sa.String(length=40), nullable=False),
        sa.Column("original_value", sa.Numeric(precision=30, scale=8), nullable=True),
        sa.Column("original_unit", sa.String(length=40), nullable=False),
        sa.Column("normalized_value", sa.Numeric(precision=30, scale=8), nullable=True),
        sa.Column("normalized_unit", sa.String(length=40), nullable=False),
        sa.Column("value_status", sa.String(length=24), nullable=False),
        sa.Column("null_reason", sa.String(length=240), nullable=True),
        sa.Column("source_ref", sa.String(length=120), nullable=False),
        sa.Column("source_snapshot_ref", sa.String(length=180), nullable=False),
        sa.Column("raw_record_ref", sa.String(length=180), nullable=False),
        sa.Column("quality_status", sa.String(length=32), nullable=False),
        sa.Column("freshness_status", sa.String(length=24), nullable=False),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("period_start <= period_end", name="ck_basic60_metric_period"),
        sa.CheckConstraint(
            "value_status IN ('available', 'pending', 'unavailable')",
            name="ck_basic60_metric_value_status",
        ),
        sa.CheckConstraint(
            "(value_status = 'available' AND normalized_value IS NOT NULL "
            "AND null_reason IS NULL) OR (value_status <> 'available' "
            "AND normalized_value IS NULL AND null_reason IS NOT NULL)",
            name="ck_basic60_metric_value_null_semantics",
        ),
        sa.CheckConstraint(
            "quality_status IN ('reviewed', 'machine_validated', 'pending')",
            name="ck_basic60_metric_quality",
        ),
        sa.CheckConstraint(
            "freshness_status IN ('current', 'aging', 'stale', 'pending')",
            name="ck_basic60_metric_freshness",
        ),
        sa.ForeignKeyConstraint(["country_id"], ["basic60_countries.id"]),
        sa.ForeignKeyConstraint(["metric_definition_id"], ["basic60_metric_definitions.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "country_id",
            "metric_definition_id",
            "period_start",
            "period_end",
            name="uq_basic60_metric_observation",
        ),
    )
    op.create_index("ix_basic60_metric_values_country_id", "basic60_metric_values", ["country_id"])
    op.create_index(
        "ix_basic60_metric_values_metric_definition_id",
        "basic60_metric_values",
        ["metric_definition_id"],
    )
    op.create_index("ix_basic60_metric_values_source_ref", "basic60_metric_values", ["source_ref"])

    op.create_table(
        "basic60_raw_records",
        _uuid_id(),
        sa.Column("release_id", sa.String(length=80), nullable=False),
        sa.Column("source_snapshot_id", sa.Uuid(), nullable=False),
        sa.Column("record_ref", sa.String(length=180), nullable=False),
        sa.Column("country_code", sa.String(length=3), nullable=True),
        sa.Column("object_key", sa.Text(), nullable=False),
        sa.Column("payload_sha256", sa.String(length=64), nullable=False),
        sa.Column("media_type", sa.String(length=120), nullable=False),
        sa.Column("imported_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["release_id"], ["basic60_release_snapshots.release_id"]),
        sa.ForeignKeyConstraint(["source_snapshot_id"], ["basic60_source_snapshots.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("release_id", "record_ref", name="uq_basic60_raw_release_ref"),
    )
    op.create_index("ix_basic60_raw_records_country_code", "basic60_raw_records", ["country_code"])
    op.create_index("ix_basic60_raw_records_release_id", "basic60_raw_records", ["release_id"])
    op.create_index(
        "ix_basic60_raw_records_source_snapshot_id",
        "basic60_raw_records",
        ["source_snapshot_id"],
    )

    op.create_table(
        "basic60_field_provenance",
        _uuid_id(),
        sa.Column("release_id", sa.String(length=80), nullable=False),
        sa.Column("raw_record_id", sa.Uuid(), nullable=False),
        sa.Column("entity_type", sa.String(length=40), nullable=False),
        sa.Column("entity_key", sa.String(length=200), nullable=False),
        sa.Column("field_path", sa.String(length=240), nullable=False),
        sa.Column("source_field", sa.String(length=240), nullable=False),
        sa.Column("transform_ref", sa.String(length=160), nullable=True),
        sa.Column("source_ref", sa.String(length=120), nullable=False),
        sa.Column("quality_status", sa.String(length=32), nullable=False),
        sa.ForeignKeyConstraint(["raw_record_id"], ["basic60_raw_records.id"]),
        sa.ForeignKeyConstraint(["release_id"], ["basic60_release_snapshots.release_id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "release_id",
            "entity_type",
            "entity_key",
            "field_path",
            "source_ref",
            name="uq_basic60_field_provenance",
        ),
    )
    op.create_index(
        "ix_basic60_field_provenance_raw_record_id",
        "basic60_field_provenance",
        ["raw_record_id"],
    )
    op.create_index(
        "ix_basic60_field_provenance_release_id",
        "basic60_field_provenance",
        ["release_id"],
    )

    op.create_table(
        "basic60_data_record_versions",
        _uuid_id(),
        sa.Column("release_id", sa.String(length=80), nullable=False),
        sa.Column("raw_record_id", sa.Uuid(), nullable=True),
        sa.Column("entity_type", sa.String(length=40), nullable=False),
        sa.Column("entity_key", sa.String(length=200), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("record_sha256", sa.String(length=64), nullable=False),
        sa.Column("record_status", sa.String(length=24), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("version_number >= 1", name="ck_basic60_record_version_positive"),
        sa.CheckConstraint(
            "record_status IN ('published', 'pending', 'revoked')",
            name="ck_basic60_record_status",
        ),
        sa.ForeignKeyConstraint(["raw_record_id"], ["basic60_raw_records.id"]),
        sa.ForeignKeyConstraint(["release_id"], ["basic60_release_snapshots.release_id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "release_id",
            "entity_type",
            "entity_key",
            "version_number",
            name="uq_basic60_record_version",
        ),
    )
    op.create_index(
        "ix_basic60_data_record_versions_release_id",
        "basic60_data_record_versions",
        ["release_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_basic60_data_record_versions_release_id",
        table_name="basic60_data_record_versions",
    )
    op.drop_table("basic60_data_record_versions")
    op.drop_index("ix_basic60_field_provenance_release_id", table_name="basic60_field_provenance")
    op.drop_index(
        "ix_basic60_field_provenance_raw_record_id", table_name="basic60_field_provenance"
    )
    op.drop_table("basic60_field_provenance")
    op.drop_index("ix_basic60_raw_records_source_snapshot_id", table_name="basic60_raw_records")
    op.drop_index("ix_basic60_raw_records_release_id", table_name="basic60_raw_records")
    op.drop_index("ix_basic60_raw_records_country_code", table_name="basic60_raw_records")
    op.drop_table("basic60_raw_records")
    op.drop_index("ix_basic60_metric_values_source_ref", table_name="basic60_metric_values")
    op.drop_index(
        "ix_basic60_metric_values_metric_definition_id", table_name="basic60_metric_values"
    )
    op.drop_index("ix_basic60_metric_values_country_id", table_name="basic60_metric_values")
    op.drop_table("basic60_metric_values")
    op.drop_index(
        "ix_basic60_metric_definitions_release_id", table_name="basic60_metric_definitions"
    )
    op.drop_table("basic60_metric_definitions")
    op.drop_index("ix_basic60_admin_structures_country_id", table_name="basic60_admin_structures")
    op.drop_table("basic60_admin_structures")
    op.drop_index("ix_basic60_country_timezones_country_id", table_name="basic60_country_timezones")
    op.drop_table("basic60_country_timezones")
    op.drop_index(
        "ix_basic60_country_currencies_country_id", table_name="basic60_country_currencies"
    )
    op.drop_table("basic60_country_currencies")
    op.drop_index("ix_basic60_country_languages_country_id", table_name="basic60_country_languages")
    op.drop_table("basic60_country_languages")
    op.drop_index("ix_basic60_country_capitals_country_id", table_name="basic60_country_capitals")
    op.drop_table("basic60_country_capitals")
    op.drop_index("ix_basic60_localized_texts_country_id", table_name="basic60_localized_texts")
    op.drop_table("basic60_localized_texts")
    op.drop_index("ix_basic60_countries_release_id", table_name="basic60_countries")
    op.drop_index("ix_basic60_countries_region_code", table_name="basic60_countries")
    op.drop_index("ix_basic60_countries_iso3", table_name="basic60_countries")
    op.drop_table("basic60_countries")
    op.drop_index("ix_basic60_source_snapshots_source_id", table_name="basic60_source_snapshots")
    op.drop_table("basic60_source_snapshots")
    op.drop_index("ix_basic60_source_registry_release_id", table_name="basic60_source_registry")
    op.drop_table("basic60_source_registry")
    op.drop_index("ix_basic60_release_snapshots_is_active", table_name="basic60_release_snapshots")
    op.drop_index("ix_basic60_release_snapshots_as_of", table_name="basic60_release_snapshots")
    op.drop_table("basic60_release_snapshots")
