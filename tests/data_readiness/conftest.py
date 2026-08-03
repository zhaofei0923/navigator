from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

PACKAGE_ROOT = Path(__file__).parents[2] / "services" / "data-readiness" / "src"
sys.path.insert(0, str(PACKAGE_ROOT))

from navigator_data_readiness.paths import (  # noqa: E402
    RepositoryPaths,
)
from navigator_data_readiness.paths import (  # noqa: E402
    discover_repository as discover_current_repository,
)

_PRE_ADOPTION_COMMIT = "99de271f60da9a73cbe6cef38f3e3c05de504133"
_PRE_ADOPTION_MODULES = {
    "test_d0_acceptance_confirmation",
    "test_d0_acceptance_review",
    "test_d0_baseline_adoption",
    "test_d0_baseline_change",
    "test_d0_baseline_publication",
    "test_d0_baseline_review",
    "test_d0_candidates",
    "test_d0_confirmation",
    "test_d0_contract_resolution",
    "test_d0_review",
}


@pytest.fixture(scope="session")
def pre_adoption_repository(tmp_path_factory: pytest.TempPathFactory) -> RepositoryPaths:
    """Provide immutable inputs for tests of the completed pre-publication workflow."""

    current = discover_current_repository()
    checkout = tmp_path_factory.mktemp("navigator-pre-adoption") / "repository"
    subprocess.run(
        ["git", "clone", "--quiet", "--shared", str(current.root), str(checkout)],
        check=True,
    )
    subprocess.run(
        ["git", "-C", str(checkout), "checkout", "--quiet", _PRE_ADOPTION_COMMIT],
        check=True,
    )
    return discover_current_repository(checkout)


@pytest.fixture(autouse=True)
def route_pre_adoption_repository(
    request: pytest.FixtureRequest,
    monkeypatch: pytest.MonkeyPatch,
    pre_adoption_repository: RepositoryPaths,
) -> None:
    """Keep historical D0 workflow tests bound to their original Git baseline."""

    if request.module.__name__.split(".")[-1] not in _PRE_ADOPTION_MODULES:
        return
    discover = getattr(request.module, "discover_repository", None)
    if discover is None:
        return

    def routed_discovery(root: Path | None = None) -> RepositoryPaths:
        if root is None:
            return pre_adoption_repository
        return discover(root)

    monkeypatch.setattr(request.module, "discover_repository", routed_discovery)
