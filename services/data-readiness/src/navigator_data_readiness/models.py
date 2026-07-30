from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal

Severity = Literal["error", "warning", "info"]


@dataclass(frozen=True, slots=True)
class CheckResult:
    code: str
    message: str
    severity: Severity = "error"
    location: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True, slots=True)
class StageSummary:
    stage: str
    status: str
    completed: int
    total: int

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class ReadinessReport:
    baseline_version: str
    current_stage: str
    ready: bool
    generated_at: str
    workbook_hashes: dict[str, str]
    stage_summaries: list[StageSummary] = field(default_factory=list)
    blockers: list[CheckResult] = field(default_factory=list)
    warnings: list[CheckResult] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "baseline_version": self.baseline_version,
            "current_stage": self.current_stage,
            "ready": self.ready,
            "generated_at": self.generated_at,
            "workbook_hashes": self.workbook_hashes,
            "stage_summaries": [item.to_dict() for item in self.stage_summaries],
            "blockers": [item.to_dict() for item in self.blockers],
            "warnings": [item.to_dict() for item in self.warnings],
        }
