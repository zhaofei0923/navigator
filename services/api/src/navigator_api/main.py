"""FastAPI application factory for the bounded internal demo."""

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

from navigator_api.config import Settings
from navigator_api.constants import DATA_ORIGIN
from navigator_api.database import build_engine, build_session_factory
from navigator_api.errors import DemoAPIError, error_payload
from navigator_api.models import Base, Country
from navigator_api.routers import api_router
from navigator_api.schemas import HealthResponse

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


def create_app(settings: Settings | None = None) -> FastAPI:
    runtime_settings = settings or Settings.from_env()
    engine = build_engine(runtime_settings.database_url)
    session_factory = build_session_factory(engine)

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        if runtime_settings.auto_create_schema:
            Base.metadata.create_all(engine)
        yield
        engine.dispose()

    app = FastAPI(
        title="Navigator Internal Demo API",
        version="0.1.0",
        description=("仅供内部展示。全部业务数据均为 synthetic_demo，所有结论均为非正式结论。"),
        lifespan=lifespan,
    )
    app.state.settings = runtime_settings
    app.state.engine = engine
    app.state.session_factory = session_factory

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(runtime_settings.cors_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "X-Demo-Key"],
    )

    @app.middleware("http")
    async def demo_boundary_headers(request: Request, call_next: Any) -> Any:
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Navigator-Data-Origin"] = DATA_ORIGIN
        response.headers["X-Navigator-Disclaimer"] = "demo-data-non-authoritative"
        return response

    @app.exception_handler(DemoAPIError)
    async def demo_api_error_handler(_request: Request, exc: DemoAPIError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=error_payload(code=exc.code, message=exc.message, details=exc.details),
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(
        _request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content=error_payload(
                code="VALIDATION_ERROR",
                message="请求参数未通过校验。",
                details=_validation_details(exc),
            ),
        )

    @app.exception_handler(HTTPException)
    async def http_error_handler(_request: Request, exc: HTTPException) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=error_payload(code=f"HTTP_{exc.status_code}", message=str(exc.detail)),
        )

    @app.exception_handler(SQLAlchemyError)
    async def database_error_handler(_request: Request, exc: SQLAlchemyError) -> JSONResponse:
        LOGGER.exception("Synthetic demo database request failed", exc_info=exc)
        return JSONResponse(
            status_code=503,
            content=error_payload(
                code="DEMO_DATABASE_UNAVAILABLE",
                message="内部演示数据库暂不可用。",
            ),
        )

    @app.get("/health", response_model=HealthResponse, operation_id="API-HEALTH-001")
    def health() -> HealthResponse:
        with session_factory() as session:
            session.execute(text("SELECT 1"))
            count = session.scalar(select(func.count()).select_from(Country)) or 0
        return HealthResponse(status="ok", database="ready", seeded_country_count=count)

    app.include_router(api_router)
    return app
