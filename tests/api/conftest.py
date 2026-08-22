"""Isolated SQLite fixtures for the bounded demo API."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from navigator_api.config import Settings
from navigator_api.main import create_app
from navigator_api.seed import seed_database

DEMO_KEY = "test-only-demo-key"


@pytest.fixture
def app() -> Iterator[Any]:
    application = create_app(
        Settings(
            database_url="sqlite+pysqlite:///:memory:",
            demo_api_key=DEMO_KEY,
            cors_origins=("http://localhost:3000",),
            auto_create_schema=True,
        )
    )
    with TestClient(application):
        with application.state.session_factory() as session:
            seed_database(session)
        yield application


@pytest.fixture
def client(app: Any) -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def auth_headers() -> dict[str, str]:
    return {"X-Demo-Key": DEMO_KEY}
