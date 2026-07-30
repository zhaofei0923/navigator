from __future__ import annotations

from pathlib import Path

import pytest
from navigator_data_readiness.paths import discover_repository


def test_discover_repository_rejects_unrelated_directory(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        discover_repository(tmp_path)
