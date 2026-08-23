"""Demo boundary metadata endpoint."""

from fastapi import APIRouter

from navigator_api.constants import DATA_ORIGIN, DEMO_BASELINE_DECISION
from navigator_api.localization import disclaimer_for
from navigator_api.schemas import DemoInfo, DemoMeta, DemoResponse, Locale

router = APIRouter(tags=["demo-boundary"])


@router.get("/meta", response_model=DemoResponse[DemoInfo], operation_id="API-DEMO-META-001")
def get_demo_meta(locale: Locale = "zh-CN") -> DemoResponse[DemoInfo]:
    data = DemoInfo(
        name=("Navigator Internal Full-stack Demo" if locale == "en" else "Navigator 内部全栈演示"),
        baseline_decision=DEMO_BASELINE_DECISION,
        mode="bounded_internal_demo",
        country_codes=["BRA", "IDN", "SAU", "VNM", "ZAF"],
        external_calls_enabled=False,
        real_data_enabled=False,
        data_origin=DATA_ORIGIN,
    )
    return DemoResponse(
        meta=DemoMeta(locale=locale, disclaimer=disclaimer_for(locale), result_count=1), data=data
    )
