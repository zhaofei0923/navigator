"""API router composition."""

from fastapi import APIRouter, Depends

from navigator_api.dependencies import require_demo_key
from navigator_api.routers import catalog, countries, demo, meta

api_router = APIRouter(prefix="/api/v1", dependencies=[Depends(require_demo_key)])
api_router.include_router(meta.router)
api_router.include_router(countries.router)
api_router.include_router(catalog.router)
api_router.include_router(demo.router)
