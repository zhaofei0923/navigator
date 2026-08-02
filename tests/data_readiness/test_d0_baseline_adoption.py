from __future__ import annotations

import copy
import hashlib
import json
import shutil
import subprocess
from pathlib import Path
from typing import Any

import pytest
from navigator_data_readiness.baseline import write_snapshot
from navigator_data_readiness.cli import main
from navigator_data_readiness.d0_ac009_confirmation import (
    apply_d0_ac009_confirmation,
    validate_d0_ac009_confirmation,
    write_d0_ac009_confirmation_template,
)
from navigator_data_readiness.d0_baseline_adoption import (
    apply_d0_post_adoption_confirmation,
    assess_d0_baseline_adoption,
    build_d0_post_adoption_review_bundle,
    load_and_validate_d0_baseline_publication_authorization,
    load_and_validate_d0_post_adoption_review_bundle,
    validate_d0_post_adoption_confirmation,
    write_d0_baseline_publication_authorization,
    write_d0_post_adoption_confirmation_template,
    write_d0_post_adoption_review_bundle,
)
from navigator_data_readiness.d0_closure import (
    build_d0_ac009_review_bundle,
    build_d0_final_review_bundle,
    load_and_validate_d0_ac009_review_bundle,
    load_and_validate_d0_final_review_bundle,
    write_d0_ac009_review_bundle,
    write_d0_final_review_bundle,
)
from navigator_data_readiness.d0_final_confirmation import (
    apply_d0_final_confirmation,
    validate_d0_final_confirmation,
    write_d0_final_confirmation_template,
)
from navigator_data_readiness.d0_review import validate_review_packet
from navigator_data_readiness.paths import RepositoryPaths, discover_repository
from navigator_data_readiness.readiness import build_readiness_report


def _load(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    assert isinstance(payload, dict)
    return payload


def _write(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _git(root: Path, *arguments: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(root), *arguments],
        check=True,
        capture_output=True,
    )
    return result.stdout.decode("utf-8").strip()


def _isolated_repository(tmp_path: Path) -> tuple[RepositoryPaths, str]:
    source = discover_repository()
    (tmp_path / "doc" / "doc").mkdir(parents=True)
    shutil.copy2(source.d0_workbook, tmp_path / "doc" / "doc" / source.d0_workbook.name)
    shutil.copy2(
        source.technical_workbook,
        tmp_path / "doc" / "doc" / source.technical_workbook.name,
    )
    for relative in (
        Path("data/d0/candidates"),
        Path("data/d0/review"),
        Path("data/d0/evidence"),
        Path("data/d0/research"),
    ):
        shutil.copytree(source.root / relative, tmp_path / relative)
    for path in (tmp_path / "data" / "d0" / "candidates").glob(
        "d0_baseline_publication_authorization.*.json"
    ):
        path.unlink()
    _git(tmp_path, "init", "--quiet")
    _git(tmp_path, "config", "user.name", "Navigator Tests")
    _git(tmp_path, "config", "user.email", "navigator-tests@example.invalid")
    _git(tmp_path, "add", "--all")
    _git(tmp_path, "commit", "--quiet", "-m", "approval state")
    return discover_repository(tmp_path), _git(tmp_path, "rev-parse", "HEAD")


def _inputs(paths: RepositoryPaths) -> tuple[Path, Path, Path]:
    staged = list((paths.d0_candidates_dir / "publication-staging" / "2026-08-02").glob("*.xlsx"))
    assert len(staged) == 1
    return (
        paths.d0_review_dir / "d0_baseline_adoption_decision.2026-08-02.json",
        paths.d0_candidates_dir / "d0_baseline_publication_readiness.2026-08-02.json",
        staged[0],
    )


def _authorization_output(paths: RepositoryPaths) -> Path:
    return paths.d0_candidates_dir / "d0_baseline_publication_authorization.2026-08-03.json"


def _prepare(paths: RepositoryPaths, approval_commit: str) -> Path:
    decision, readiness, staged = _inputs(paths)
    return write_d0_baseline_publication_authorization(
        paths,
        approval_commit,
        decision,
        readiness,
        staged,
        _authorization_output(paths),
    )


def _publish_approved_workbook(paths: RepositoryPaths) -> str:
    _decision, _readiness, staged = _inputs(paths)
    shutil.copy2(staged, paths.d0_workbook)
    _git(paths.root, "add", "--all")
    _git(paths.root, "commit", "--quiet", "-m", "publish approved D0 baseline")
    return _git(paths.root, "rev-parse", "HEAD")


def _codes(report: dict[str, Any]) -> set[str]:
    return {str(check["code"]) for check in report["checks"]}


def _post_adoption_paths(paths: RepositoryPaths) -> tuple[Path, Path, Path, Path]:
    return (
        paths.d0_candidates_dir / "d0_post_adoption_review_bundle.2026-08-03.json",
        paths.d0_review_dir / "d0_post_adoption_review_confirmation.template.2026-08-03.json",
        paths.d0_review_dir / "d0_review_packet.2026-08-03.json",
        paths.evidence_manifest.parent / "kevin_post_adoption_confirmation_20260803.json",
    )


def _completed_post_adoption_confirmation(template_path: Path) -> dict[str, Any]:
    confirmation = _load(template_path)
    confirmation.update(
        {
            "template_only": False,
            "authorized_transcription": True,
            "reviewer": "kevin",
            "reviewed_at": "2026-08-03",
            "decision": "approved",
            "comments": "同意",
        }
    )
    return confirmation


def _prepare_committed_post_adoption_state(
    paths: RepositoryPaths,
    approval_commit: str,
) -> tuple[Path, Path, str]:
    authorization = _prepare(paths, approval_commit)
    _publish_approved_workbook(paths)
    write_snapshot(paths)
    bundle_path, template_path, review_output, confirmation_path = _post_adoption_paths(paths)
    write_d0_post_adoption_review_bundle(paths, authorization, bundle_path)
    write_d0_post_adoption_confirmation_template(
        paths,
        bundle_path,
        review_output,
        template_path,
    )
    _write(confirmation_path, _completed_post_adoption_confirmation(template_path))
    apply_d0_post_adoption_confirmation(
        paths,
        confirmation_path,
        bundle_path,
        review_output,
    )
    _git(paths.root, "add", "--all")
    _git(paths.root, "commit", "--quiet", "-m", "commit post-adoption review state")
    return authorization, review_output, _git(paths.root, "rev-parse", "HEAD")


def _ac009_output(paths: RepositoryPaths) -> Path:
    return paths.d0_candidates_dir / "d0_ac009_review_bundle.2026-08-04.json"


def _prepare_ac009_review_state(
    paths: RepositoryPaths,
    approval_commit: str,
) -> tuple[Path, Path, Path]:
    authorization, review_path, _current_head = _prepare_committed_post_adoption_state(
        paths,
        approval_commit,
    )
    bundle_path = _ac009_output(paths)
    write_d0_ac009_review_bundle(paths, authorization, review_path, bundle_path)
    return authorization, review_path, bundle_path


def _ac009_confirmation_paths(paths: RepositoryPaths) -> tuple[Path, Path, Path]:
    return (
        paths.d0_review_dir / "d0_ac009_confirmation.template.2026-08-05.json",
        paths.d0_review_dir / "d0_review_packet.2026-08-05.json",
        paths.evidence_manifest.parent / "kevin_ac009_confirmation_20260805.json",
    )


def _completed_ac009_confirmation(template_path: Path) -> dict[str, Any]:
    confirmation = _load(template_path)
    confirmation.update(
        {
            "template_only": False,
            "authorized_transcription": True,
            "decision": "approved",
            "comments": "同意",
        }
    )
    for signature in confirmation["signatures"]:
        signature["signed_at"] = "2026-08-05"
    return confirmation


def _prepare_committed_ac009_state(
    paths: RepositoryPaths,
    approval_commit: str,
) -> tuple[Path, Path, str]:
    authorization, review_path, bundle_path = _prepare_ac009_review_state(
        paths,
        approval_commit,
    )
    template_path, review_output, confirmation_path = _ac009_confirmation_paths(paths)
    write_d0_ac009_confirmation_template(
        paths,
        authorization,
        review_path,
        bundle_path,
        review_output,
        template_path,
    )
    _write(confirmation_path, _completed_ac009_confirmation(template_path))
    apply_d0_ac009_confirmation(
        paths,
        confirmation_path,
        authorization,
        review_path,
        bundle_path,
        review_output,
        paths.evidence_manifest,
    )
    _git(paths.root, "add", "--all")
    _git(paths.root, "commit", "--quiet", "-m", "commit AC009 closure state")
    return authorization, review_output, _git(paths.root, "rev-parse", "HEAD")


def _final_bundle_output(paths: RepositoryPaths) -> Path:
    return paths.d0_candidates_dir / "d0_final_review_bundle.2026-08-06.json"


def _final_confirmation_paths(paths: RepositoryPaths) -> tuple[Path, Path, Path]:
    return (
        paths.d0_review_dir / "d0_final_confirmation.template.2026-08-07.json",
        paths.d0_review_dir / "d0_review_packet.2026-08-07.json",
        paths.evidence_manifest.parent / "kevin_d0_final_confirmation_20260807.json",
    )


def _completed_final_confirmation(template_path: Path) -> dict[str, Any]:
    confirmation = _load(template_path)
    confirmation.update(
        {
            "template_only": False,
            "authorized_transcription": True,
            "decision": "approved",
            "comments": "同意",
        }
    )
    confirmation["acceptance_signature"]["signed_at"] = "2026-08-07"
    confirmation["final_signature"]["signed_at"] = "2026-08-07"
    return confirmation


def test_repository_authorization_is_current_and_waiting_for_publication() -> None:
    paths = discover_repository()
    authorization = _authorization_output(paths)

    packet = load_and_validate_d0_baseline_publication_authorization(paths, authorization)
    report = assess_d0_baseline_adoption(paths, authorization)

    assert packet["approval_commit"] == "70de3b3001a8b556393a17dcf6c1c13ff7756539"
    assert packet["expected_publication"] == {
        "path": paths.d0_workbook.relative_to(paths.root).as_posix(),
        "previous_sha256": "224e9a35bcbb363cf41c007499ba32aa6394cfdbf06331830c02d994e1c7ddff",
        "adopted_sha256": "123394d0ee1744edf86e201bd1c683cafdd222d1ff5c55221eb1f0798e2f0712",
        "required_git_mode": "100644",
        "requires_descendant_commit": True,
    }
    assert report["ready_for_post_publication_d0_rebuild"] is False
    assert _codes(report) == {"D0_ADOPTION_NOT_PUBLISHED"}


def test_writer_binds_git_objects_and_refuses_overwrite(tmp_path: Path) -> None:
    paths, approval_commit = _isolated_repository(tmp_path)
    output = _prepare(paths, approval_commit)

    packet = load_and_validate_d0_baseline_publication_authorization(paths, output)

    assert packet["approval_commit"] == approval_commit
    assert (
        packet["bindings"]["approved_candidate_workbook"]["git_blob"]
        == packet["bindings"]["staged_workbook"]["git_blob"]
    )
    assert packet["publication_state_at_authorization"] == "authorized_not_published"
    assert output.stat().st_mode & 0o777 == 0o644
    assert list(output.parent.glob(f".{output.name}.*.tmp")) == []
    with pytest.raises(FileExistsError, match="Refusing to overwrite"):
        _prepare(paths, approval_commit)


def test_adoption_requires_publication_commit_then_passes(tmp_path: Path) -> None:
    paths, approval_commit = _isolated_repository(tmp_path)
    authorization = _prepare(paths, approval_commit)
    _decision, _readiness, staged = _inputs(paths)

    before = assess_d0_baseline_adoption(paths, authorization)
    assert _codes(before) == {"D0_ADOPTION_NOT_PUBLISHED"}

    shutil.copy2(staged, paths.d0_workbook)
    uncommitted = assess_d0_baseline_adoption(paths, authorization)
    assert _codes(uncommitted) == {"D0_ADOPTION_NOT_COMMITTED"}

    _git(paths.root, "add", "--all")
    _git(paths.root, "commit", "--quiet", "-m", "publish approved D0 baseline")
    published = assess_d0_baseline_adoption(paths, authorization)
    assert published["ready_for_post_publication_d0_rebuild"] is True
    assert published["checks"] == []
    assert published["current_head"] != approval_commit
    assert published["current_authoritative_workbook"]["git_blob"]


def test_adoption_rejects_unexpected_hash_and_packet_tampering(tmp_path: Path) -> None:
    paths, approval_commit = _isolated_repository(tmp_path)
    authorization = _prepare(paths, approval_commit)
    paths.d0_workbook.write_bytes(paths.d0_workbook.read_bytes() + b"unexpected")

    unexpected = assess_d0_baseline_adoption(paths, authorization)
    assert _codes(unexpected) == {"D0_ADOPTION_UNEXPECTED_HASH"}

    packet = _load(authorization)
    packet["expected_publication"]["adopted_sha256"] = "0" * 64
    _write(authorization, packet)
    tampered = assess_d0_baseline_adoption(paths, authorization)
    assert _codes(tampered) == {"D0_ADOPTION_AUTHORIZATION_INVALID"}


def test_cli_prepares_authorization_and_reports_pending_adoption(tmp_path: Path) -> None:
    paths, approval_commit = _isolated_repository(tmp_path)
    decision, readiness, staged = _inputs(paths)
    authorization = _authorization_output(paths)

    prepare_exit = main(
        [
            "--repo",
            str(paths.root),
            "prepare-d0-baseline-publication-authorization",
            "--approval-commit",
            approval_commit,
            "--decision",
            str(decision),
            "--readiness",
            str(readiness),
            "--workbook",
            str(staged),
            "--output",
            str(authorization),
        ]
    )
    report_output = paths.d0_candidates_dir / "d0_baseline_adoption_assessment.test.json"
    validate_exit = main(
        [
            "--repo",
            str(paths.root),
            "validate-d0-baseline-adoption",
            "--authorization",
            str(authorization),
            "--output",
            str(report_output),
        ]
    )

    assert prepare_exit == 0
    assert validate_exit == 1
    assert _codes(_load(report_output)) == {"D0_ADOPTION_NOT_PUBLISHED"}


def test_post_adoption_review_bundle_requires_published_authoritative_workbook() -> None:
    paths = discover_repository()

    with pytest.raises(ValueError, match="D0_ADOPTION_NOT_PUBLISHED"):
        build_d0_post_adoption_review_bundle(paths, _authorization_output(paths))


def test_post_adoption_review_bundle_carries_only_prior_named_approvals(
    tmp_path: Path,
) -> None:
    paths, approval_commit = _isolated_repository(tmp_path)
    authorization = _prepare(paths, approval_commit)
    publication_commit = _publish_approved_workbook(paths)

    bundle = build_d0_post_adoption_review_bundle(paths, authorization)
    proposed = bundle["proposed_review_packet"]
    acceptance = {item["acceptance_id"]: item for item in proposed["acceptance_items"]}
    changed_candidates = {
        item["candidate"]
        for item in bundle["migration_scope"]["candidate_hash_changes"]
        if item["changed"]
    }

    assert bundle["publication"]["current_head"] == publication_commit
    assert bundle["ready_for_named_human_review"] is True
    assert bundle["does_not_write_review_packet"] is True
    assert bundle["migration_scope"]["carried_acceptance_ids"] == [
        f"D0-AC-{number:03d}" for number in range(1, 9)
    ]
    assert bundle["migration_scope"]["remaining_acceptance_ids"] == [
        "D0-AC-009",
        "D0-AC-010",
    ]
    assert acceptance["D0-AC-001"]["machine_status"] == "pass"
    assert acceptance["D0-AC-002"]["machine_status"] == "pass"
    assert acceptance["D0-AC-009"]["review_status"] == "pending"
    assert acceptance["D0-AC-010"]["review_status"] == "pending"
    assert proposed["final_decision"]["status"] == "pending"
    assert changed_candidates == {
        "acceptance_assessment.json",
        "core_contract_resolution.template.json",
        "core_entity_evidence.json",
        "core_field_evidence.json",
        "enum_migration_evidence.json",
        "machine_evidence_review_queue.json",
    }
    assert {check["code"] for check in bundle["machine_replay"]["checks"]} == {
        "D0_REVIEW_ACCEPTANCE_PENDING",
        "D0_REVIEW_FINAL_PENDING",
    }


def test_post_adoption_review_writer_is_atomic_and_refuses_overwrite(
    tmp_path: Path,
) -> None:
    paths, approval_commit = _isolated_repository(tmp_path)
    authorization = _prepare(paths, approval_commit)
    _publish_approved_workbook(paths)
    output = paths.d0_candidates_dir / "d0_post_adoption_review_bundle.2026-08-03.json"

    written = write_d0_post_adoption_review_bundle(paths, authorization, output)

    assert written == output
    assert _load(output)["bundle_type"] == "post_adoption_review_migration_candidate"
    assert output.stat().st_mode & 0o777 == 0o644
    assert list(output.parent.glob(f".{output.name}.*.tmp")) == []
    with pytest.raises(FileExistsError, match="Refusing to overwrite"):
        write_d0_post_adoption_review_bundle(paths, authorization, output)


def test_post_adoption_review_rejects_technical_baseline_change(tmp_path: Path) -> None:
    paths, approval_commit = _isolated_repository(tmp_path)
    authorization = _prepare(paths, approval_commit)
    _publish_approved_workbook(paths)
    paths.technical_workbook.write_bytes(paths.technical_workbook.read_bytes() + b"unexpected")
    _git(paths.root, "add", "--all")
    _git(paths.root, "commit", "--quiet", "-m", "tamper technical baseline")

    with pytest.raises(ValueError, match="technical workbook changed"):
        build_d0_post_adoption_review_bundle(paths, authorization)


def test_cli_prepares_post_adoption_review_bundle(tmp_path: Path) -> None:
    paths, approval_commit = _isolated_repository(tmp_path)
    authorization = _prepare(paths, approval_commit)
    _publish_approved_workbook(paths)
    output = paths.d0_candidates_dir / "d0_post_adoption_review_bundle.cli.json"

    exit_code = main(
        [
            "--repo",
            str(paths.root),
            "prepare-d0-post-adoption-review",
            "--authorization",
            str(authorization),
            "--output",
            str(output),
        ]
    )

    assert exit_code == 0
    assert _load(output)["ready_for_named_human_review"] is True


def test_post_adoption_confirmation_template_binds_exact_outputs(tmp_path: Path) -> None:
    paths, approval_commit = _isolated_repository(tmp_path)
    authorization = _prepare(paths, approval_commit)
    _publish_approved_workbook(paths)
    bundle_path, template_path, review_output, _confirmation_path = _post_adoption_paths(paths)
    write_d0_post_adoption_review_bundle(paths, authorization, bundle_path)

    written = write_d0_post_adoption_confirmation_template(
        paths,
        bundle_path,
        review_output,
        template_path,
    )
    template = _load(written)
    bundle = load_and_validate_d0_post_adoption_review_bundle(paths, bundle_path)

    assert template["template_only"] is True
    assert template["authorized_transcription"] is False
    assert template["expected_reviewer"] == "kevin"
    assert template["reviewer"] is None
    assert template["decision"] is None
    assert template["bundle"]["sha256"] == hashlib.sha256(bundle_path.read_bytes()).hexdigest()
    assert template["proposed_review_packet_sha256"] == bundle["proposed_review_packet_sha256"]
    assert template["review_output"] == review_output.relative_to(paths.root).as_posix()
    assert review_output.exists() is False
    assert template_path.stat().st_mode & 0o777 == 0o644
    assert list(template_path.parent.glob(f".{template_path.name}.*.tmp")) == []
    with pytest.raises(FileExistsError, match="Refusing to overwrite"):
        write_d0_post_adoption_confirmation_template(
            paths,
            bundle_path,
            review_output,
            template_path,
        )


def test_post_adoption_confirmation_transcribes_exact_proposed_packet(
    tmp_path: Path,
) -> None:
    paths, approval_commit = _isolated_repository(tmp_path)
    authorization = _prepare(paths, approval_commit)
    _publish_approved_workbook(paths)
    bundle_path, template_path, review_output, confirmation_path = _post_adoption_paths(paths)
    write_d0_post_adoption_review_bundle(paths, authorization, bundle_path)
    write_d0_post_adoption_confirmation_template(
        paths,
        bundle_path,
        review_output,
        template_path,
    )
    _write(confirmation_path, _completed_post_adoption_confirmation(template_path))

    written = apply_d0_post_adoption_confirmation(
        paths,
        confirmation_path,
        bundle_path,
        review_output,
    )
    bundle = _load(bundle_path)
    migrated = _load(written)
    acceptance = {item["acceptance_id"]: item for item in migrated["acceptance_items"]}

    assert (
        hashlib.sha256(written.read_bytes()).hexdigest() == bundle["proposed_review_packet_sha256"]
    )
    assert [acceptance[f"D0-AC-{number:03d}"]["review_status"] for number in range(1, 9)] == [
        "approved"
    ] * 8
    assert acceptance["D0-AC-009"]["review_status"] == "pending"
    assert acceptance["D0-AC-010"]["review_status"] == "pending"
    assert migrated["final_decision"]["status"] == "pending"
    assert written.stat().st_mode & 0o777 == 0o644
    with pytest.raises(FileExistsError, match="Refusing to overwrite"):
        apply_d0_post_adoption_confirmation(
            paths,
            confirmation_path,
            bundle_path,
            review_output,
        )


def test_post_adoption_confirmation_rejects_tampering_and_rejection(
    tmp_path: Path,
) -> None:
    paths, approval_commit = _isolated_repository(tmp_path)
    authorization = _prepare(paths, approval_commit)
    _publish_approved_workbook(paths)
    bundle_path, template_path, review_output, confirmation_path = _post_adoption_paths(paths)
    write_d0_post_adoption_review_bundle(paths, authorization, bundle_path)
    write_d0_post_adoption_confirmation_template(
        paths,
        bundle_path,
        review_output,
        template_path,
    )
    valid = _completed_post_adoption_confirmation(template_path)

    mutations = [
        ({**valid, "reviewer": "someone-else"}, "not the project approver"),
        ({**valid, "reviewed_at": "2026-08-02"}, "cannot predate"),
        ({**valid, "email": "private@example.invalid"}, "unexpected fields"),
        (
            {**valid, "bundle": {**valid["bundle"], "sha256": "0" * 64}},
            "changed the bound bundle",
        ),
    ]
    for confirmation, message in mutations:
        with pytest.raises(ValueError, match=message):
            validate_d0_post_adoption_confirmation(
                paths,
                confirmation,
                bundle_path,
                review_output,
            )

    rejected = copy.deepcopy(valid)
    rejected.update({"decision": "rejected", "comments": "需要整改"})
    _write(confirmation_path, rejected)
    with pytest.raises(ValueError, match="was rejected"):
        apply_d0_post_adoption_confirmation(
            paths,
            confirmation_path,
            bundle_path,
            review_output,
        )
    assert review_output.exists() is False


def test_cli_prepares_and_applies_post_adoption_confirmation(tmp_path: Path) -> None:
    paths, approval_commit = _isolated_repository(tmp_path)
    authorization = _prepare(paths, approval_commit)
    _publish_approved_workbook(paths)
    bundle_path, template_path, review_output, confirmation_path = _post_adoption_paths(paths)
    write_d0_post_adoption_review_bundle(paths, authorization, bundle_path)

    prepare_exit = main(
        [
            "--repo",
            str(paths.root),
            "prepare-d0-post-adoption-confirmation",
            "--bundle",
            str(bundle_path),
            "--review-output",
            str(review_output),
            "--output",
            str(template_path),
        ]
    )
    _write(confirmation_path, _completed_post_adoption_confirmation(template_path))
    apply_exit = main(
        [
            "--repo",
            str(paths.root),
            "apply-d0-post-adoption-review",
            "--input",
            str(confirmation_path),
            "--bundle",
            str(bundle_path),
            "--review-output",
            str(review_output),
        ]
    )

    assert prepare_exit == 0
    assert apply_exit == 0
    assert review_output.is_file()


def test_ac009_review_bundle_binds_committed_post_adoption_state(
    tmp_path: Path,
) -> None:
    paths, approval_commit = _isolated_repository(tmp_path)
    authorization, review_path, current_head = _prepare_committed_post_adoption_state(
        paths,
        approval_commit,
    )
    output = _ac009_output(paths)

    written = write_d0_ac009_review_bundle(
        paths,
        authorization,
        review_path,
        output,
    )
    bundle = load_and_validate_d0_ac009_review_bundle(
        paths,
        authorization,
        review_path,
        written,
    )

    assert bundle["current_head"] == current_head
    assert bundle["ready_for_named_human_review"] is True
    assert bundle["does_not_approve_acceptance"] is True
    assert bundle["review_replay"]["carried_acceptance_ids"] == [
        f"D0-AC-{number:03d}" for number in range(1, 9)
    ]
    assert bundle["review_replay"]["remaining_acceptance_ids"] == [
        "D0-AC-009",
        "D0-AC-010",
    ]
    assert bundle["readiness_replay"]["preclosure_blockers"] == []
    assert {
        (
            item["code"],
            item["message"].partition(":")[0]
            if item["code"] == "D0_ACCEPTANCE_PENDING"
            else item["message"].removeprefix("No evidence is registered for "),
        )
        for item in bundle["readiness_replay"]["excluded_self_gates"]
    } == {
        ("D0_ACCEPTANCE_PENDING", "D0-AC-009"),
        ("D0_ACCEPTANCE_PENDING", "D0-AC-010"),
        ("EVIDENCE_ACCEPTANCE_MISSING", "D0-AC-009"),
        ("EVIDENCE_ACCEPTANCE_MISSING", "D0-AC-010"),
    }
    assert bundle["acceptance_item"]["required_roles"] == [
        "数据负责人",
        "项目批准人",
    ]
    assert bundle["acceptance_item"]["reviewer_signature_template"] == [
        {
            "role": "数据负责人",
            "person_name": "kevin",
            "signed_at": None,
            "evidence_ids": ["EVD-D0-AC-009-CLOSURE-R01-20260804"],
        },
        {
            "role": "项目批准人",
            "person_name": "kevin",
            "signed_at": None,
            "evidence_ids": ["EVD-D0-AC-009-CLOSURE-R02-20260804"],
        },
    ]
    assert [item["reviewer_role"] for item in bundle["evidence_manifest_templates"]] == [
        "数据负责人",
        "项目批准人",
    ]
    assert len(bundle["inputs"]["contract_snapshot"]["contracts"]) == 25
    assert all(
        binding["git_blob"]
        for binding in (
            bundle["inputs"]["publication_authorization"],
            bundle["inputs"]["review_packet"],
            bundle["inputs"]["authoritative_d0_workbook"],
            bundle["inputs"]["authoritative_technical_workbook"],
            bundle["inputs"]["contract_snapshot"]["manifest"],
            bundle["inputs"]["evidence_manifest"],
        )
    )
    assert written.stat().st_mode & 0o777 == 0o644
    assert list(written.parent.glob(f".{written.name}.*.tmp")) == []
    with pytest.raises(FileExistsError, match="Refusing to overwrite"):
        write_d0_ac009_review_bundle(paths, authorization, review_path, output)


def test_ac009_review_bundle_rejects_uncommitted_inputs(tmp_path: Path) -> None:
    paths, approval_commit = _isolated_repository(tmp_path)
    authorization, review_path, _current_head = _prepare_committed_post_adoption_state(
        paths,
        approval_commit,
    )
    review = _load(review_path)
    acceptance = {item["acceptance_id"]: item for item in review["acceptance_items"]}
    acceptance["D0-AC-009"]["comments"] = "uncommitted"
    _write(review_path, review)

    with pytest.raises(ValueError, match="committed Git blob"):
        build_d0_ac009_review_bundle(
            paths,
            authorization,
            review_path,
            _ac009_output(paths),
        )


def test_ac009_review_bundle_rejects_stale_contract_snapshot(tmp_path: Path) -> None:
    paths, approval_commit = _isolated_repository(tmp_path)
    authorization, review_path, _current_head = _prepare_committed_post_adoption_state(
        paths,
        approval_commit,
    )
    contract = paths.contracts_dir / "entities.json"
    contract.write_bytes(contract.read_bytes() + b" ")

    with pytest.raises(ValueError, match="committed Git blob"):
        build_d0_ac009_review_bundle(
            paths,
            authorization,
            review_path,
            _ac009_output(paths),
        )


def test_ac009_review_bundle_rejects_unexpected_readiness_blocker(
    tmp_path: Path,
) -> None:
    paths, approval_commit = _isolated_repository(tmp_path)
    authorization, review_path, _current_head = _prepare_committed_post_adoption_state(
        paths,
        approval_commit,
    )
    manifest = _load(paths.evidence_manifest)
    manifest["evidence"] = [
        item for item in manifest["evidence"] if item["acceptance_id"] != "D0-AC-008"
    ]
    _write(paths.evidence_manifest, manifest)
    _git(paths.root, "add", "--all")
    _git(paths.root, "commit", "--quiet", "-m", "remove required evidence")

    with pytest.raises(ValueError, match="requires only AC-009"):
        build_d0_ac009_review_bundle(
            paths,
            authorization,
            review_path,
            _ac009_output(paths),
        )


def test_cli_prepares_d0_ac009_review_bundle(tmp_path: Path) -> None:
    paths, approval_commit = _isolated_repository(tmp_path)
    authorization, review_path, _current_head = _prepare_committed_post_adoption_state(
        paths,
        approval_commit,
    )
    output = _ac009_output(paths)

    exit_code = main(
        [
            "--repo",
            str(paths.root),
            "prepare-d0-ac009-review",
            "--authorization",
            str(authorization),
            "--review",
            str(review_path),
            "--output",
            str(output),
        ]
    )

    assert exit_code == 0
    assert _load(output)["ready_for_named_human_review"] is True


def test_ac009_confirmation_template_binds_roles_hash_and_output(
    tmp_path: Path,
) -> None:
    paths, approval_commit = _isolated_repository(tmp_path)
    authorization, review_path, bundle_path = _prepare_ac009_review_state(
        paths,
        approval_commit,
    )
    template_path, review_output, _confirmation_path = _ac009_confirmation_paths(paths)

    written = write_d0_ac009_confirmation_template(
        paths,
        authorization,
        review_path,
        bundle_path,
        review_output,
        template_path,
    )
    template = _load(written)

    assert template["template_only"] is True
    assert template["authorized_transcription"] is False
    assert template["decision"] is None
    assert template["review_output"] == review_output.relative_to(paths.root).as_posix()
    assert template["bundle"]["sha256"] == hashlib.sha256(bundle_path.read_bytes()).hexdigest()
    assert template["expected_signatures"] == [
        {"role": "数据负责人", "person_name": "kevin"},
        {"role": "项目批准人", "person_name": "kevin"},
    ]
    assert template["signatures"] == [
        {"role": "数据负责人", "person_name": "kevin", "signed_at": None},
        {"role": "项目批准人", "person_name": "kevin", "signed_at": None},
    ]
    assert review_output.exists() is False
    assert written.stat().st_mode & 0o777 == 0o644
    assert list(written.parent.glob(f".{written.name}.*.tmp")) == []
    with pytest.raises(FileExistsError, match="Refusing to overwrite"):
        write_d0_ac009_confirmation_template(
            paths,
            authorization,
            review_path,
            bundle_path,
            review_output,
            template_path,
        )


def test_ac009_confirmation_applies_review_and_evidence_atomically(
    tmp_path: Path,
) -> None:
    paths, approval_commit = _isolated_repository(tmp_path)
    authorization, review_path, bundle_path = _prepare_ac009_review_state(
        paths,
        approval_commit,
    )
    template_path, review_output, confirmation_path = _ac009_confirmation_paths(paths)
    write_d0_ac009_confirmation_template(
        paths,
        authorization,
        review_path,
        bundle_path,
        review_output,
        template_path,
    )
    confirmation = _completed_ac009_confirmation(template_path)
    _write(confirmation_path, confirmation)

    written = apply_d0_ac009_confirmation(
        paths,
        confirmation_path,
        authorization,
        review_path,
        bundle_path,
        review_output,
        paths.evidence_manifest,
    )
    packet = _load(review_output)
    acceptance = {item["acceptance_id"]: item for item in packet["acceptance_items"]}
    ac009 = acceptance["D0-AC-009"]
    checks = validate_review_packet(paths, packet)
    new_evidence_ids = {
        "EVD-D0-AC-009-CLOSURE-R01-20260804",
        "EVD-D0-AC-009-CLOSURE-R02-20260804",
    }
    entries = [
        item
        for item in _load(paths.evidence_manifest)["evidence"]
        if item["evidence_id"] in new_evidence_ids
    ]

    assert written == (review_output, paths.evidence_manifest)
    assert ac009["review_status"] == "approved"
    assert ac009["comments"] == "同意"
    assert {item["role"] for item in ac009["reviewer_signatures"]} == {
        "数据负责人",
        "项目批准人",
    }
    assert {item["evidence_ids"][0] for item in ac009["reviewer_signatures"]} == new_evidence_ids
    assert {(check.code, check.location) for check in checks} == {
        ("D0_REVIEW_ACCEPTANCE_PENDING", "acceptance_items.D0-AC-010"),
        ("D0_REVIEW_FINAL_PENDING", "final_decision"),
    }
    assert len(entries) == 2
    assert {item["reviewer_role"] for item in entries} == {
        "数据负责人",
        "项目批准人",
    }
    assert all(item["reviewer"] == "kevin" for item in entries)
    assert all(
        item["path"] == confirmation_path.relative_to(paths.root).as_posix() for item in entries
    )
    assert all(
        item["sha256"] == hashlib.sha256(confirmation_path.read_bytes()).hexdigest()
        for item in entries
    )
    assert all(item["subject_sha256"] == confirmation["bundle"]["sha256"] for item in entries)
    readiness = build_readiness_report(paths)
    assert {(check.code, check.message.rsplit(" ", 1)[-1]) for check in readiness.blockers} == {
        ("D0_ACCEPTANCE_PENDING", "pending"),
        ("EVIDENCE_ACCEPTANCE_MISSING", "D0-AC-010"),
    }
    assert review_output.stat().st_mode & 0o777 == 0o644
    assert paths.evidence_manifest.stat().st_mode & 0o777 == 0o644
    assert list(review_output.parent.glob(".*.tmp")) == []
    assert list(paths.evidence_manifest.parent.glob(".*.tmp")) == []
    with pytest.raises(FileExistsError, match="Refusing to overwrite"):
        apply_d0_ac009_confirmation(
            paths,
            confirmation_path,
            authorization,
            review_path,
            bundle_path,
            review_output,
            paths.evidence_manifest,
        )


def test_ac009_confirmation_rejects_tampering_dates_and_rejection(
    tmp_path: Path,
) -> None:
    paths, approval_commit = _isolated_repository(tmp_path)
    authorization, review_path, bundle_path = _prepare_ac009_review_state(
        paths,
        approval_commit,
    )
    template_path, review_output, confirmation_path = _ac009_confirmation_paths(paths)
    write_d0_ac009_confirmation_template(
        paths,
        authorization,
        review_path,
        bundle_path,
        review_output,
        template_path,
    )
    valid = _completed_ac009_confirmation(template_path)

    wrong_signer = copy.deepcopy(valid)
    wrong_signer["signatures"][0]["person_name"] = "peter"
    with pytest.raises(ValueError, match="signed holder"):
        validate_d0_ac009_confirmation(
            paths,
            wrong_signer,
            authorization,
            review_path,
            bundle_path,
            review_output,
        )

    wrong_date = copy.deepcopy(valid)
    wrong_date["signatures"][0]["signed_at"] = "2026-08-04"
    with pytest.raises(ValueError, match="must match the review output date"):
        validate_d0_ac009_confirmation(
            paths,
            wrong_date,
            authorization,
            review_path,
            bundle_path,
            review_output,
        )

    extra_field = {**valid, "email": "private@example.invalid"}
    with pytest.raises(ValueError, match="unexpected fields"):
        validate_d0_ac009_confirmation(
            paths,
            extra_field,
            authorization,
            review_path,
            bundle_path,
            review_output,
        )

    rejected = copy.deepcopy(valid)
    rejected.update({"decision": "rejected", "comments": "需要整改"})
    _write(confirmation_path, rejected)
    with pytest.raises(ValueError, match="was rejected"):
        apply_d0_ac009_confirmation(
            paths,
            confirmation_path,
            authorization,
            review_path,
            bundle_path,
            review_output,
            paths.evidence_manifest,
        )
    assert review_output.exists() is False

    _write(confirmation_path, valid)
    alternate_manifest = paths.evidence_manifest.parent / "alternate-manifest.json"
    with pytest.raises(ValueError, match="current evidence manifest"):
        apply_d0_ac009_confirmation(
            paths,
            confirmation_path,
            authorization,
            review_path,
            bundle_path,
            review_output,
            alternate_manifest,
        )


def test_cli_prepares_and_applies_ac009_confirmation(tmp_path: Path) -> None:
    paths, approval_commit = _isolated_repository(tmp_path)
    authorization, review_path, bundle_path = _prepare_ac009_review_state(
        paths,
        approval_commit,
    )
    template_path, review_output, confirmation_path = _ac009_confirmation_paths(paths)

    prepare_exit = main(
        [
            "--repo",
            str(paths.root),
            "prepare-d0-ac009-confirmation",
            "--authorization",
            str(authorization),
            "--review",
            str(review_path),
            "--bundle",
            str(bundle_path),
            "--review-output",
            str(review_output),
            "--output",
            str(template_path),
        ]
    )
    _write(confirmation_path, _completed_ac009_confirmation(template_path))
    apply_exit = main(
        [
            "--repo",
            str(paths.root),
            "apply-d0-ac009-confirmation",
            "--input",
            str(confirmation_path),
            "--authorization",
            str(authorization),
            "--review",
            str(review_path),
            "--bundle",
            str(bundle_path),
            "--review-output",
            str(review_output),
            "--manifest-output",
            str(paths.evidence_manifest),
        ]
    )

    assert prepare_exit == 0
    assert apply_exit == 0
    assert _load(review_output)["acceptance_items"][8]["review_status"] == "approved"


def test_final_review_bundle_binds_only_remaining_self_gates(tmp_path: Path) -> None:
    paths, approval_commit = _isolated_repository(tmp_path)
    authorization, review_path, current_head = _prepare_committed_ac009_state(
        paths,
        approval_commit,
    )
    output = _final_bundle_output(paths)

    written = write_d0_final_review_bundle(paths, authorization, review_path, output)
    bundle = load_and_validate_d0_final_review_bundle(
        paths,
        authorization,
        review_path,
        written,
    )

    assert bundle["current_head"] == current_head
    assert bundle["ready_for_named_human_review"] is True
    assert bundle["review_replay"]["carried_acceptance_ids"] == [
        f"D0-AC-{number:03d}" for number in range(1, 10)
    ]
    assert bundle["review_replay"]["remaining_acceptance_ids"] == ["D0-AC-010"]
    assert bundle["readiness_replay"]["preclosure_blockers"] == []
    assert {
        (
            item["code"],
            item["message"].partition(":")[0]
            if item["code"] == "D0_ACCEPTANCE_PENDING"
            else item["message"].removeprefix("No evidence is registered for "),
        )
        for item in bundle["readiness_replay"]["excluded_self_gates"]
    } == {
        ("D0_ACCEPTANCE_PENDING", "D0-AC-010"),
        ("EVIDENCE_ACCEPTANCE_MISSING", "D0-AC-010"),
    }
    assert bundle["acceptance_item"]["reviewer_signature_template"] == [
        {
            "role": "项目批准人",
            "person_name": "kevin",
            "signed_at": None,
            "evidence_ids": ["EVD-D0-AC-010-CLOSURE-ACCEPTANCE-20260806"],
        }
    ]
    assert bundle["final_decision_template"] == {
        "status": "approved",
        "approver_role": "项目批准人",
        "approved_by": "kevin",
        "approved_at": None,
        "evidence_ids": ["EVD-D0-AC-010-CLOSURE-FINAL-20260806"],
        "comments": None,
    }
    assert {item["review_purpose"] for item in bundle["evidence_manifest_templates"]} == {
        "D0-AC-010 acceptance",
        "final D0 decision",
    }
    assert written.stat().st_mode & 0o777 == 0o644
    with pytest.raises(FileExistsError, match="Refusing to overwrite"):
        write_d0_final_review_bundle(paths, authorization, review_path, output)


def test_final_review_bundle_rejects_uncommitted_ac009_state(tmp_path: Path) -> None:
    paths, approval_commit = _isolated_repository(tmp_path)
    authorization, review_path, bundle_path = _prepare_ac009_review_state(
        paths,
        approval_commit,
    )
    template_path, review_output, confirmation_path = _ac009_confirmation_paths(paths)
    write_d0_ac009_confirmation_template(
        paths,
        authorization,
        review_path,
        bundle_path,
        review_output,
        template_path,
    )
    _write(confirmation_path, _completed_ac009_confirmation(template_path))
    apply_d0_ac009_confirmation(
        paths,
        confirmation_path,
        authorization,
        review_path,
        bundle_path,
        review_output,
        paths.evidence_manifest,
    )

    with pytest.raises(ValueError, match="Git object at HEAD"):
        build_d0_final_review_bundle(
            paths,
            authorization,
            review_output,
            _final_bundle_output(paths),
        )


def test_final_confirmation_reaches_zero_blocker_d0_gate(tmp_path: Path) -> None:
    paths, approval_commit = _isolated_repository(tmp_path)
    authorization, review_path, _current_head = _prepare_committed_ac009_state(
        paths,
        approval_commit,
    )
    bundle_path = _final_bundle_output(paths)
    write_d0_final_review_bundle(paths, authorization, review_path, bundle_path)
    template_path, review_output, confirmation_path = _final_confirmation_paths(paths)
    write_d0_final_confirmation_template(
        paths,
        authorization,
        review_path,
        bundle_path,
        review_output,
        template_path,
    )
    confirmation = _completed_final_confirmation(template_path)
    _write(confirmation_path, confirmation)

    written = apply_d0_final_confirmation(
        paths,
        confirmation_path,
        authorization,
        review_path,
        bundle_path,
        review_output,
        paths.evidence_manifest,
    )
    packet = _load(review_output)
    acceptance = {item["acceptance_id"]: item for item in packet["acceptance_items"]}
    evidence_ids = {
        "EVD-D0-AC-010-CLOSURE-ACCEPTANCE-20260806",
        "EVD-D0-AC-010-CLOSURE-FINAL-20260806",
    }
    evidence = [
        item
        for item in _load(paths.evidence_manifest)["evidence"]
        if item["evidence_id"] in evidence_ids
    ]
    readiness = build_readiness_report(paths)

    assert written == (review_output, paths.evidence_manifest)
    assert acceptance["D0-AC-010"]["review_status"] == "approved"
    assert packet["final_decision"] == {
        "status": "approved",
        "approver_role": "项目批准人",
        "approved_by": "kevin",
        "approved_at": "2026-08-07",
        "evidence_ids": ["EVD-D0-AC-010-CLOSURE-FINAL-20260806"],
        "comments": "同意",
    }
    assert validate_review_packet(paths, packet) == []
    assert len(evidence) == 2
    assert {item["review_purpose"] for item in evidence} == {
        "D0-AC-010 acceptance",
        "final D0 decision",
    }
    assert readiness.ready is True
    assert readiness.blockers == []
    assert review_output.stat().st_mode & 0o777 == 0o644
    assert paths.evidence_manifest.stat().st_mode & 0o777 == 0o644
    assert list(review_output.parent.glob(".*.tmp")) == []
    assert list(paths.evidence_manifest.parent.glob(".*.tmp")) == []


def test_final_confirmation_rejects_tampering_and_rejection(tmp_path: Path) -> None:
    paths, approval_commit = _isolated_repository(tmp_path)
    authorization, review_path, _current_head = _prepare_committed_ac009_state(
        paths,
        approval_commit,
    )
    bundle_path = _final_bundle_output(paths)
    write_d0_final_review_bundle(paths, authorization, review_path, bundle_path)
    template_path, review_output, confirmation_path = _final_confirmation_paths(paths)
    write_d0_final_confirmation_template(
        paths,
        authorization,
        review_path,
        bundle_path,
        review_output,
        template_path,
    )
    valid = _completed_final_confirmation(template_path)

    wrong_signer = copy.deepcopy(valid)
    wrong_signer["final_signature"]["person_name"] = "peter"
    with pytest.raises(ValueError, match="signed project approver"):
        validate_d0_final_confirmation(
            paths,
            wrong_signer,
            authorization,
            review_path,
            bundle_path,
            review_output,
        )

    wrong_date = copy.deepcopy(valid)
    wrong_date["acceptance_signature"]["signed_at"] = "2026-08-06"
    with pytest.raises(ValueError, match="must match the review output date"):
        validate_d0_final_confirmation(
            paths,
            wrong_date,
            authorization,
            review_path,
            bundle_path,
            review_output,
        )

    extra_field = {**valid, "phone": "private"}
    with pytest.raises(ValueError, match="unexpected fields"):
        validate_d0_final_confirmation(
            paths,
            extra_field,
            authorization,
            review_path,
            bundle_path,
            review_output,
        )

    rejected = copy.deepcopy(valid)
    rejected.update({"decision": "rejected", "comments": "需要整改"})
    _write(confirmation_path, rejected)
    with pytest.raises(ValueError, match="was rejected"):
        apply_d0_final_confirmation(
            paths,
            confirmation_path,
            authorization,
            review_path,
            bundle_path,
            review_output,
            paths.evidence_manifest,
        )
    assert review_output.exists() is False


def test_cli_prepares_and_applies_d0_final_confirmation(tmp_path: Path) -> None:
    paths, approval_commit = _isolated_repository(tmp_path)
    authorization, review_path, _current_head = _prepare_committed_ac009_state(
        paths,
        approval_commit,
    )
    bundle_path = _final_bundle_output(paths)
    prepare_bundle_exit = main(
        [
            "--repo",
            str(paths.root),
            "prepare-d0-final-review",
            "--authorization",
            str(authorization),
            "--review",
            str(review_path),
            "--output",
            str(bundle_path),
        ]
    )
    template_path, review_output, confirmation_path = _final_confirmation_paths(paths)
    prepare_confirmation_exit = main(
        [
            "--repo",
            str(paths.root),
            "prepare-d0-final-confirmation",
            "--authorization",
            str(authorization),
            "--review",
            str(review_path),
            "--bundle",
            str(bundle_path),
            "--review-output",
            str(review_output),
            "--output",
            str(template_path),
        ]
    )
    _write(confirmation_path, _completed_final_confirmation(template_path))
    apply_exit = main(
        [
            "--repo",
            str(paths.root),
            "apply-d0-final-confirmation",
            "--input",
            str(confirmation_path),
            "--authorization",
            str(authorization),
            "--review",
            str(review_path),
            "--bundle",
            str(bundle_path),
            "--review-output",
            str(review_output),
            "--manifest-output",
            str(paths.evidence_manifest),
        ]
    )

    assert prepare_bundle_exit == 0
    assert prepare_confirmation_exit == 0
    assert apply_exit == 0
    assert build_readiness_report(paths).ready is True
