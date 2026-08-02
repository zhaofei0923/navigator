from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any

from .baseline import extract_contracts, sha256_file
from .d0_baseline_change import assess_d0_baseline_change
from .d0_candidates import (
    build_gold_standard_gap_report,
    build_template_trial,
    candidate_payloads,
    load_license_snapshots,
    load_research_captures,
)
from .d0_review import validate_review_packet
from .paths import RepositoryPaths

_EXPECTED_PENDING_REVIEW_CODES = {
    "D0_REVIEW_ACCEPTANCE_PENDING",
    "D0_REVIEW_FINAL_PENDING",
}
_ARTIFACT_BY_ACCEPTANCE = {
    "D0-AC-004": "D0-ART-CONVENTIONS",
    "D0-AC-006": "D0-ART-TERMINOLOGY",
    "D0-AC-008": "D0-ART-FILE-RULES",
}
_CANDIDATE_FILE_BY_ACCEPTANCE = {
    "D0-AC-003": "enum_migration_evidence.json",
    "D0-AC-004": "conventions.json",
    "D0-AC-006": "terminology_review_queue.json",
    "D0-AC-008": "file_rules.json",
}


def _load_object(path: Path, *, label: str) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{label} must be a JSON object")
    return payload


def _relative_path(paths: RepositoryPaths, path: Path) -> str:
    try:
        return path.resolve().relative_to(paths.root.resolve()).as_posix()
    except ValueError:
        return str(path.resolve())


def _payload_bytes(payload: dict[str, Any]) -> bytes:
    return (json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode(
        "utf-8"
    )


def _canonical_payload_sha256(payload: Any) -> str:
    serialized = json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode()
    return hashlib.sha256(serialized).hexdigest()


def _evidence_date_token(bundle_output: Path) -> str:
    match = re.search(r"(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)", bundle_output.name)
    if match is None:
        raise ValueError("D0 acceptance review bundle filename must contain an ISO date")
    return "".join(match.groups())


def _artifact_approved(
    artifacts: dict[str, dict[str, Any]],
    artifact_id: str,
    candidate_path: Path,
) -> bool:
    artifact = artifacts.get(artifact_id, {})
    return artifact.get("review_status") == "approved" and artifact.get(
        "candidate_sha256"
    ) == _canonical_payload_sha256(_load_object(candidate_path, label=artifact_id))


def _candidate_binding(paths: RepositoryPaths, filename: str) -> dict[str, str]:
    candidate = paths.d0_candidates_dir / filename
    return {
        "path": candidate.relative_to(paths.root).as_posix(),
        "sha256": sha256_file(candidate),
    }


def _review_state(
    acceptance: dict[str, Any],
    *,
    prerequisites_ready: bool,
) -> str:
    if acceptance.get("review_status") == "approved":
        return "approved"
    return "ready_for_human_review" if prerequisites_ready else "blocked"


def build_d0_acceptance_review_bundle(
    paths: RepositoryPaths,
    review_packet: dict[str, Any],
    review_path: Path,
    resolution: dict[str, Any],
    resolution_path: Path,
    candidate_workbook: Path,
    bundle_output: Path,
) -> dict[str, Any]:
    unexpected_review_checks = [
        check
        for check in validate_review_packet(paths, review_packet)
        if check.code not in _EXPECTED_PENDING_REVIEW_CODES
    ]
    if unexpected_review_checks:
        raise ValueError(
            "Formal review packet has non-pending validation errors: "
            + "; ".join(f"{check.code}: {check.message}" for check in unexpected_review_checks)
        )

    candidate_assessment = assess_d0_baseline_change(
        paths,
        resolution,
        candidate_workbook,
    )
    if candidate_assessment.get("candidate_ready_for_formal_baseline_review") is not True:
        raise ValueError("The D0 candidate workbook is not ready for formal baseline review")

    contracts = extract_contracts(paths)
    template_trial = build_template_trial(contracts, review_packet["mapping_decisions"])
    gold_standard = build_gold_standard_gap_report(
        contracts,
        load_research_captures(paths),
        review_packet["raw_sample_reviews"],
        load_license_snapshots(paths),
    )
    generated_candidates = candidate_payloads(paths)
    acceptance = {str(item["acceptance_id"]): item for item in review_packet["acceptance_items"]}
    artifacts = {str(item["artifact_id"]): item for item in review_packet["artifact_reviews"]}
    role_holders = {
        str(item["role"]): str(item["role_holder"]) for item in review_packet["role_assignments"]
    }
    evidence_date_token = _evidence_date_token(bundle_output)

    enum_ready = generated_candidates["enum_migration_evidence.json"]["machine_status"] == "pass"
    conventions_ready = _artifact_approved(
        artifacts,
        _ARTIFACT_BY_ACCEPTANCE["D0-AC-004"],
        paths.d0_candidates_dir / _CANDIDATE_FILE_BY_ACCEPTANCE["D0-AC-004"],
    )
    samples_ready = (
        template_trial["status"] == "pass"
        and gold_standard["status"] == "candidate_ready_for_review"
        and all(not item["unresolved"] for item in gold_standard["candidates"])
    )
    terminology_ready = _artifact_approved(
        artifacts,
        _ARTIFACT_BY_ACCEPTANCE["D0-AC-006"],
        paths.d0_candidates_dir / _CANDIDATE_FILE_BY_ACCEPTANCE["D0-AC-006"],
    )
    file_rules_ready = _artifact_approved(
        artifacts,
        _ARTIFACT_BY_ACCEPTANCE["D0-AC-008"],
        paths.d0_candidates_dir / _CANDIDATE_FILE_BY_ACCEPTANCE["D0-AC-008"],
    )
    prerequisites = {
        "D0-AC-001": True,
        "D0-AC-002": True,
        "D0-AC-003": enum_ready,
        "D0-AC-004": conventions_ready,
        "D0-AC-005": samples_ready,
        "D0-AC-006": samples_ready and terminology_ready,
        "D0-AC-007": True,
        "D0-AC-008": file_rules_ready,
        "D0-AC-009": False,
        "D0-AC-010": False,
    }

    evidence_bindings = {
        "D0-AC-001": [
            {
                "path": _relative_path(paths, candidate_workbook),
                "sha256": sha256_file(candidate_workbook),
                "subject": "candidate core-entity contract",
            },
            {
                "path": _relative_path(paths, resolution_path),
                "sha256": sha256_file(resolution_path),
                "subject": "reviewed AC-001/002 resolution packet",
            },
        ],
        "D0-AC-002": [
            {
                "path": _relative_path(paths, candidate_workbook),
                "sha256": sha256_file(candidate_workbook),
                "subject": "candidate core-field contract",
            },
            {
                "path": _relative_path(paths, resolution_path),
                "sha256": sha256_file(resolution_path),
                "subject": "reviewed AC-001/002 resolution packet",
            },
        ],
        "D0-AC-003": [
            {
                **_candidate_binding(paths, "enum_migration_evidence.json"),
                "subject": "enum and migration machine evidence",
            }
        ],
        "D0-AC-004": [
            {
                **_candidate_binding(paths, "conventions.json"),
                "subject": "approved convention candidate",
            }
        ],
        "D0-AC-005": [
            {
                "path": "embedded:effective_template_trial",
                "sha256": hashlib.sha256(_payload_bytes(template_trial)).hexdigest(),
                "subject": "mapping-aware D4 template trial",
            },
            {
                "path": "embedded:effective_gold_standard",
                "sha256": hashlib.sha256(_payload_bytes(gold_standard)).hexdigest(),
                "subject": "review-aware gold-standard assessment",
            },
        ],
        "D0-AC-006": [
            {
                **_candidate_binding(paths, "terminology_review_queue.json"),
                "subject": "approved terminology candidate",
            },
            {
                "path": "embedded:effective_gold_standard",
                "sha256": hashlib.sha256(_payload_bytes(gold_standard)).hexdigest(),
                "subject": "professionally reviewed gold-standard assessment",
            },
        ],
        "D0-AC-007": [],
        "D0-AC-008": [
            {
                **_candidate_binding(paths, "file_rules.json"),
                "subject": "approved file and evidence rules",
            }
        ],
        "D0-AC-009": [],
        "D0-AC-010": [],
    }

    items: list[dict[str, Any]] = []
    manifest_templates: list[dict[str, Any]] = []
    for acceptance_id in sorted(acceptance):
        item = acceptance[acceptance_id]
        state = _review_state(item, prerequisites_ready=prerequisites[acceptance_id])
        evidence_id = f"EVD-D0-{acceptance_id.removeprefix('D0-')}-REVIEW-{evidence_date_token}"
        items.append(
            {
                "acceptance_id": acceptance_id,
                "title": item["title"],
                "required_roles": item["required_roles"],
                "current_review_status": item["review_status"],
                "review_state": state,
                "evidence_candidate_id": evidence_id if state == "ready_for_human_review" else None,
                "evidence_bindings": evidence_bindings[acceptance_id],
                "reviewer_signature_template": [
                    {
                        "role": role,
                        "person_name": role_holders[role],
                        "signed_at": None,
                        "evidence_ids": [evidence_id],
                    }
                    for role in item["required_roles"]
                ]
                if state == "ready_for_human_review"
                else [],
            }
        )
        if state == "ready_for_human_review":
            manifest_templates.append(
                {
                    "evidence_id": evidence_id,
                    "acceptance_id": acceptance_id,
                    "path": _relative_path(paths, bundle_output),
                    "sha256": None,
                    "recorded_by": "codex (authorized transcription)",
                    "recorded_at": None,
                    "reviewer": role_holders[item["required_roles"][0]],
                    "status": "待复核",
                }
            )

    return {
        "schema_version": 1,
        "stage": "D0",
        "bundle_type": "acceptance_review_candidate",
        "automated_assessment_only": True,
        "does_not_approve_acceptance": True,
        "does_not_activate_baseline": True,
        "inputs": {
            "review_packet": {
                "path": _relative_path(paths, review_path),
                "sha256": sha256_file(review_path),
            },
            "resolution": {
                "path": _relative_path(paths, resolution_path),
                "sha256": sha256_file(resolution_path),
            },
            "candidate_workbook": {
                "path": _relative_path(paths, candidate_workbook),
                "sha256": sha256_file(candidate_workbook),
            },
            "authoritative_workbook": {
                "path": paths.d0_workbook.relative_to(paths.root).as_posix(),
                "sha256": sha256_file(paths.d0_workbook),
            },
        },
        "effective_machine_results": {
            "candidate_ac001": candidate_assessment["core_entity_assessment"],
            "candidate_ac002": candidate_assessment["core_field_assessment"],
            "enum_ac003": generated_candidates["enum_migration_evidence.json"],
            "effective_template_trial": template_trial,
            "effective_gold_standard": gold_standard,
        },
        "summary": {
            "ready_for_human_review": [
                item["acceptance_id"]
                for item in items
                if item["review_state"] == "ready_for_human_review"
            ],
            "already_approved": [
                item["acceptance_id"] for item in items if item["review_state"] == "approved"
            ],
            "blocked": [
                item["acceptance_id"] for item in items if item["review_state"] == "blocked"
            ],
        },
        "acceptance_items": items,
        "evidence_manifest_templates": manifest_templates,
        "warning": (
            "Only the authorized named reviewers may approve the exact bundle hash. "
            "Approval of review-ready items does not complete AC-009/010, activate the "
            "authoritative workbook, complete D0/D4, or authorize user-facing development."
        ),
    }


def render_d0_acceptance_review_worksheet(
    bundle: dict[str, Any],
    *,
    bundle_path: str,
    bundle_sha256: str,
) -> str:
    lines = [
        "# D0 当前可验收项人工复核表",
        "",
        "> 本文件是待填审核表，不是批准记录。只有正式角色持有人可审核。",
        "> 审核通过仍不代表D0/D4完成，也不会激活权威工作簿或授权用户侧开发。",
        "",
        "## 绑定对象",
        "",
        f"- 验收候选包：`{bundle_path}`",
        f"- 验收候选包SHA-256：`{bundle_sha256}`",
        (f"- 候选工作簿SHA-256：`{bundle['inputs']['candidate_workbook']['sha256']}`"),
        f"- 整改包SHA-256：`{bundle['inputs']['resolution']['sha256']}`",
        (f"- 权威工作簿SHA-256：`{bundle['inputs']['authoritative_workbook']['sha256']}`"),
        "",
        "## 状态汇总",
        "",
        ("- 可人工审核：" + "、".join(bundle["summary"]["ready_for_human_review"])),
        "- 已批准：" + "、".join(bundle["summary"]["already_approved"]),
        "- 仍阻断：" + "、".join(bundle["summary"]["blocked"]),
        "",
        "## 逐项结论",
    ]
    for item in bundle["acceptance_items"]:
        if item["review_state"] != "ready_for_human_review":
            continue
        lines.extend(
            [
                "",
                f"### {item['acceptance_id']} {item['title']}",
                "",
                "- 所需角色：" + "、".join(item["required_roles"]),
                f"- 证据候选编号：`{item['evidence_candidate_id']}`",
                "- 绑定证据：",
            ]
        )
        lines.extend(
            f"  - `{binding['sha256']}` `{binding['path']}` ({binding['subject']})"
            for binding in item["evidence_bindings"]
        )
        lines.extend(
            [
                "- 对上述验收项及验收候选包精确哈希的结论：`approved` / `rejected`：",
                "- 复核人：",
                "- 复核日期 (ISO日期或带时区时间)：",
                "- 意见：",
            ]
        )
    lines.extend(
        [
            "",
            "## 暂不可批准",
            "",
            "- D0-AC-009：须等待D0-AC-001至008全部完成，并证明阻塞项为0；",
            "- D0-AC-010：须等待所有前置验收、任务状态和证据完成后由项目批准人最终签署。",
            "",
        ]
    )
    return "\n".join(lines)


def write_d0_acceptance_review_bundle(
    paths: RepositoryPaths,
    review_path: Path,
    resolution_path: Path,
    candidate_workbook: Path,
    bundle_output: Path,
    worksheet_output: Path,
) -> tuple[Path, Path]:
    for output in (bundle_output, worksheet_output):
        if output.exists():
            raise FileExistsError(f"Refusing to overwrite {output}")
    review_packet = _load_object(review_path, label="D0 review packet")
    resolution = _load_object(resolution_path, label="D0 contract resolution")
    bundle = build_d0_acceptance_review_bundle(
        paths,
        review_packet,
        review_path,
        resolution,
        resolution_path,
        candidate_workbook,
        bundle_output,
    )
    bundle_bytes = _payload_bytes(bundle)
    bundle_hash = hashlib.sha256(bundle_bytes).hexdigest()
    worksheet = render_d0_acceptance_review_worksheet(
        bundle,
        bundle_path=_relative_path(paths, bundle_output),
        bundle_sha256=bundle_hash,
    ).encode("utf-8")

    temporary_paths: list[Path] = []
    try:
        for output, content in (
            (bundle_output, bundle_bytes),
            (worksheet_output, worksheet),
        ):
            output.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(
                dir=output.parent,
                prefix=f".{output.name}.",
                suffix=".tmp",
                delete=False,
            ) as temporary:
                temporary_path = Path(temporary.name)
                temporary.write(content)
            temporary_path.chmod(0o644)
            temporary_paths.append(temporary_path)
        os.replace(temporary_paths[0], bundle_output)
        temporary_paths.pop(0)
        os.replace(temporary_paths[0], worksheet_output)
        temporary_paths.pop(0)
    finally:
        for temporary_path in temporary_paths:
            temporary_path.unlink(missing_ok=True)
    return bundle_output, worksheet_output
