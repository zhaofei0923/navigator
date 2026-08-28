"""Dialect-specific regression tests for the BASIC60 Alembic chain."""

from __future__ import annotations

import importlib.util
from io import StringIO
from pathlib import Path
from types import ModuleType

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations


def _load_manual_authorization_migration() -> ModuleType:
    migration_path = (
        Path(__file__).parents[2]
        / "services"
        / "api"
        / "alembic_basic60"
        / "versions"
        / "20260826_0003_basic60_manual_usage_authorization.py"
    )
    spec = importlib.util.spec_from_file_location(
        "basic60_manual_authorization_migration", migration_path
    )
    if spec is None or spec.loader is None:
        raise AssertionError(f"could not load migration: {migration_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_manual_authorization_migration_uses_native_postgresql_alter(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    migration = _load_manual_authorization_migration()
    output = StringIO()
    context = MigrationContext.configure(
        dialect_name="postgresql",
        opts={"as_sql": True, "output_buffer": output},
    )
    monkeypatch.setattr(migration, "op", Operations(context))
    monkeypatch.setattr(migration, "_require_empty_private_release", lambda: None)

    migration.upgrade()

    sql = output.getvalue()
    assert "ALTER TABLE basic60_release_snapshots ADD COLUMN" in sql
    assert "ALTER TABLE basic60_source_registry DROP COLUMN" in sql
    assert "_alembic_tmp_basic60_release_snapshots" not in sql
    assert "_alembic_tmp_basic60_source_registry" not in sql
    assert "DROP TABLE basic60_release_snapshots" not in sql
    assert "DROP TABLE basic60_source_registry" not in sql
