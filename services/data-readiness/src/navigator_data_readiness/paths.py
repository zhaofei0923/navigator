from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

D0_WORKBOOK_NAME = "新能源企业出海导航仪_D0数据标准冻结执行台账.xlsx"
TECH_WORKBOOK_NAME = "新能源企业出海导航仪_V1.0技术附件_BASELINE.xlsx"


@dataclass(frozen=True, slots=True)
class RepositoryPaths:
    root: Path
    d0_workbook: Path
    technical_workbook: Path
    contracts_dir: Path
    d0_candidates_dir: Path
    d0_research_dir: Path
    d0_review_dir: Path
    d1_candidates_dir: Path
    evidence_manifest: Path


def discover_repository(start: Path | None = None) -> RepositoryPaths:
    candidate = (start or Path.cwd()).resolve()
    for root in (candidate, *candidate.parents):
        d0_matches = list((root / "doc").rglob(D0_WORKBOOK_NAME)) if (root / "doc").exists() else []
        tech_matches = (
            list((root / "doc").rglob(TECH_WORKBOOK_NAME)) if (root / "doc").exists() else []
        )
        if len(d0_matches) == 1 and len(tech_matches) == 1:
            return RepositoryPaths(
                root=root,
                d0_workbook=d0_matches[0],
                technical_workbook=tech_matches[0],
                contracts_dir=root / "data" / "contracts" / "current",
                d0_candidates_dir=root / "data" / "d0" / "candidates",
                d0_research_dir=root / "data" / "d0" / "research",
                d0_review_dir=root / "data" / "d0" / "review",
                d1_candidates_dir=root / "data" / "d1" / "candidates",
                evidence_manifest=root / "data" / "d0" / "evidence" / "manifest.json",
            )
    raise FileNotFoundError(
        f"Could not find {D0_WORKBOOK_NAME} and {TECH_WORKBOOK_NAME} from {candidate}"
    )
