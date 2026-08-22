"""Environment-backed API configuration without external secret providers."""

from __future__ import annotations

import os
from dataclasses import dataclass


def _cors_origins(raw_value: str) -> tuple[str, ...]:
    origins = tuple(item.strip() for item in raw_value.split(",") if item.strip())
    return origins or ("http://localhost:3000",)


def _required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Required environment variable {name} is not set")
    return value


@dataclass(frozen=True, slots=True)
class Settings:
    """Runtime settings for the isolated internal demo."""

    database_url: str
    demo_api_key: str
    cors_origins: tuple[str, ...]
    auto_create_schema: bool = False

    @classmethod
    def from_env(cls) -> Settings:
        return cls(
            database_url=_required_env("DATABASE_URL"),
            demo_api_key=_required_env("DEMO_API_KEY"),
            cors_origins=_cors_origins(
                os.getenv(
                    "DEMO_CORS_ORIGINS",
                    "http://localhost:3000,http://127.0.0.1:3000",
                )
            ),
            auto_create_schema=os.getenv("DEMO_AUTO_CREATE_SCHEMA", "false").lower()
            in {"1", "true", "yes"},
        )
