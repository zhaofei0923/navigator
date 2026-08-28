"""Isolated FastAPI factory for the governed BASIC60 V1 private trial."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import func, select, text
from sqlalchemy.exc import SQLAlchemyError

from navigator_api.basic60_config import Basic60Settings
from navigator_api.basic60_errors import Basic60APIError, basic60_error_payload
from navigator_api.basic60_governance import (
    Basic60GovernanceError,
    validate_basic60_activation,
    validate_basic60_decision,
)
from navigator_api.basic60_importer import (
    import_basic60_seed_file,
    validate_basic60_manual_usage_authorization,
    validate_basic60_release_counts,
)
from navigator_api.basic60_models import Basic60Base, Basic60Country, Basic60Release
from navigator_api.basic60_schemas import Basic60HealthResponse
from navigator_api.database import build_engine, build_session_factory
from navigator_api.routers.basic60 import basic60_api_router

LOGGER = logging.getLogger(__name__)


def _validation_details(exc: RequestValidationError) -> list[dict[str, Any]]:
    return [
        {
            "location": [str(part) for part in error["loc"]],
            "message": error["msg"],
            "type": error["type"],
        }
        for error in exc.errors()
    ]


def _error_context(request: Request) -> tuple[str | None, Any]:
    return (
        getattr(request.app.state, "authorized_release_id", None) or None,
        getattr(request.app.state, "authorized_release_as_of", None),
    )


def _authorize_active_release(app: FastAPI) -> None:
    settings: Basic60Settings = app.state.settings
    if settings.candidate_only:
        app.state.authorized_release_id = ""
        app.state.authorized_release_as_of = None
        return
    validate_basic60_decision(settings)
    session_factory = app.state.session_factory
    with session_factory() as session:
        releases = list(
            session.scalars(
                select(Basic60Release).where(
                    Basic60Release.is_active.is_(True),
                    Basic60Release.status == "private_trial_ready",
                )
            ).all()
        )
        if len(releases) != 1:
            raise Basic60GovernanceError(
                "BASIC60 startup requires exactly one active private_trial_ready release"
            )
        release = releases[0]
        validate_basic60_manual_usage_authorization(release)
        validate_basic60_release_counts(session, release, settings)
        validate_basic60_activation(
            settings,
            release_id=release.release_id,
            release_bundle_sha256=release.release_bundle_sha256,
            validation_report_sha256=release.validation_report_sha256,
            seed_artifact_sha256=release.artifact_sha256,
        )
        app.state.authorized_release_id = release.release_id
        app.state.authorized_release_as_of = release.as_of


def create_app(settings: Basic60Settings | None = None) -> FastAPI:
    runtime_settings = settings or Basic60Settings.from_env()
    engine = build_engine(runtime_settings.database_url)
    session_factory = build_session_factory(engine)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        if runtime_settings.auto_create_schema:
            Basic60Base.metadata.create_all(engine)
        if runtime_settings.auto_import_seed:
            with session_factory() as session:
                import_basic60_seed_file(
                    session,
                    runtime_settings.seed_path,
                    runtime_settings,
                    activate=not runtime_settings.candidate_only,
                )
        _authorize_active_release(app)
        yield
        engine.dispose()

    app = FastAPI(
        title="Navigator BASIC60 Private Trial API",
        version="0.1.0",
        description=(
            "面向中国企业出海的海外目标市场只读接口，不含中国，提供基础档案、宏观和能源数据。"
            "正式D1-D4与P0保持pending。"
        ),
        lifespan=lifespan,
    )
    app.state.settings = runtime_settings
    app.state.engine = engine
    app.state.session_factory = session_factory
    app.state.authorized_release_id = ""
    app.state.authorized_release_as_of = None

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(runtime_settings.cors_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "X-Private-Trial-Key"],
    )

    @app.middleware("http")
    async def private_trial_headers(request: Request, call_next: Any) -> Any:
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Navigator-Release-Profile"] = "basic60_private"
        response.headers["X-Navigator-Formal-Gate-Status"] = "pending"
        response.headers["X-Navigator-Disclaimer"] = "private-trial-non-authoritative"
        return response

    @app.exception_handler(Basic60APIError)
    async def basic60_api_error_handler(request: Request, exc: Basic60APIError) -> JSONResponse:
        release_id, as_of = _error_context(request)
        return JSONResponse(
            status_code=exc.status_code,
            content=basic60_error_payload(
                code=exc.code,
                message=exc.message,
                details=exc.details,
                release_id=release_id,
                as_of=as_of,
            ),
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        release_id, as_of = _error_context(request)
        return JSONResponse(
            status_code=422,
            content=basic60_error_payload(
                code="VALIDATION_ERROR",
                message="请求参数未通过校验。",
                details=_validation_details(exc),
                release_id=release_id,
                as_of=as_of,
            ),
        )

    @app.exception_handler(HTTPException)
    async def http_error_handler(request: Request, exc: HTTPException) -> JSONResponse:
        release_id, as_of = _error_context(request)
        return JSONResponse(
            status_code=exc.status_code,
            content=basic60_error_payload(
                code=f"HTTP_{exc.status_code}",
                message=str(exc.detail),
                release_id=release_id,
                as_of=as_of,
            ),
        )

    @app.exception_handler(SQLAlchemyError)
    async def database_error_handler(request: Request, exc: SQLAlchemyError) -> JSONResponse:
        LOGGER.exception("BASIC60 private-trial database request failed", exc_info=exc)
        release_id, as_of = _error_context(request)
        return JSONResponse(
            status_code=503,
            content=basic60_error_payload(
                code="BASIC60_DATABASE_UNAVAILABLE",
                message="BASIC60 私有试用数据库暂不可用。",
                release_id=release_id,
                as_of=as_of,
            ),
        )

    @app.get("/health", response_model=Basic60HealthResponse, operation_id="API-HEALTH-BASIC60")
    def health() -> Basic60HealthResponse:
        authorized_release_id = app.state.authorized_release_id
        if not authorized_release_id:
            raise Basic60APIError(
                status_code=503,
                code="BASIC60_NO_ACTIVE_RELEASE",
                message="BASIC60 candidate-only runtime has no exposed release.",
            )
        with session_factory() as session:
            session.execute(text("SELECT 1"))
            release = session.get(Basic60Release, authorized_release_id)
            if release is None or not release.is_active or release.status != "private_trial_ready":
                raise Basic60APIError(
                    status_code=503,
                    code="BASIC60_NO_ACTIVE_RELEASE",
                    message="BASIC60 active release is unavailable.",
                )
            country_count = (
                session.scalar(
                    select(func.count())
                    .select_from(Basic60Country)
                    .where(Basic60Country.release_id == release.release_id)
                )
                or 0
            )
        return Basic60HealthResponse(
            status="ok",
            database="ready",
            release_id=release.release_id,
            release_status="private_trial_ready",
            country_count=country_count,
        )

    app.include_router(basic60_api_router)
    return app
