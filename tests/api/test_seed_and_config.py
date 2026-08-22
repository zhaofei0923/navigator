"""Seed determinism, configuration boundaries, and database constraints."""

from __future__ import annotations

import pytest
from navigator_api.config import Settings
from navigator_api.models import Country
from navigator_api.seed import seed_database
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError


def test_seed_if_empty_is_idempotent(app: object) -> None:
    session_factory = app.state.session_factory  # type: ignore[attr-defined]
    with session_factory() as session:
        first = seed_database(session, force=False)
        second = seed_database(session, force=False)
    assert first == second
    assert first["countries"] == 5


def test_database_rejects_non_synthetic_origin(app: object) -> None:
    session_factory = app.state.session_factory  # type: ignore[attr-defined]
    with session_factory() as session:
        country = session.scalar(select(Country).where(Country.code == "IDN"))
        assert country is not None
        country.data_origin = "real_source"
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()


def test_runtime_configuration_requires_database_and_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("DEMO_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="DATABASE_URL"):
        Settings.from_env()

    monkeypatch.setenv("DATABASE_URL", "sqlite+pysqlite:///:memory:")
    with pytest.raises(RuntimeError, match="DEMO_API_KEY"):
        Settings.from_env()


def test_runtime_configuration_reads_explicit_values(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "sqlite+pysqlite:///:memory:")
    monkeypatch.setenv("DEMO_API_KEY", "explicit-test-key")
    monkeypatch.setenv("DEMO_CORS_ORIGINS", "http://localhost:3000, http://localhost:3001")
    settings = Settings.from_env()
    assert settings.demo_api_key == "explicit-test-key"
    assert settings.cors_origins == ("http://localhost:3000", "http://localhost:3001")
