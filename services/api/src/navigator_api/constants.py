"""Immutable markers that distinguish the bounded demo from production data."""

from typing import Final, Literal

DATA_ORIGIN: Final[Literal["synthetic_demo"]] = "synthetic_demo"
DISCLAIMER: Final[Literal["演示数据 / 非正式结论"]] = "演示数据 / 非正式结论"
DISCLAIMER_EN: Final[Literal["Demo Data / Non-official Conclusions"]] = (
    "Demo Data / Non-official Conclusions"
)
DEMO_BASELINE_DECISION: Final = "PBD-ACCEL-DEMO-001"
