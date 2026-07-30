from __future__ import annotations

import sys
from pathlib import Path

PACKAGE_ROOT = Path(__file__).parents[2] / "services" / "data-readiness" / "src"
sys.path.insert(0, str(PACKAGE_ROOT))
