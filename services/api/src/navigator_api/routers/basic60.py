"""Router composition for the BASIC60-only application."""

from fastapi import APIRouter, Depends

from navigator_api.basic60_dependencies import require_private_trial_key
from navigator_api.routers import basic60_countries, market_content

basic60_api_router = APIRouter(prefix="/api/v1", dependencies=[Depends(require_private_trial_key)])
basic60_api_router.include_router(basic60_countries.router)
basic60_api_router.include_router(market_content.router)
