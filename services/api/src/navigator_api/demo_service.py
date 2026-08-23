"""Deterministic read-only services for the accelerated full-stack demo."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from navigator_api.constants import DATA_ORIGIN
from navigator_api.demo_content import (
    COUNTRY_GUIDANCE,
    GLOBE_COORDINATES,
    PROJECT_LABELS,
    QUESTION_LABELS,
    SCENARIO_LABELS,
    SECTION_TITLES,
)
from navigator_api.errors import DemoAPIError
from navigator_api.localization import localized_text
from navigator_api.models import Country, Policy, Tender
from navigator_api.schemas import (
    AssistantPreview,
    AssistantPreviewRequest,
    FeasibilityReportPreview,
    FeasibilityReportPreviewRequest,
    FeasibilitySection,
    GlobeMarker,
    Locale,
    SolarStoragePreview,
    SolarStoragePreviewRequest,
    TenderItem,
)
from navigator_api.service import get_country_detail, list_countries, tender_item


def _display_name(country: Country, locale: Locale) -> str:
    return country.name_en if locale == "en" else country.name_zh


def globe_markers(session: Session, locale: Locale) -> list[GlobeMarker]:
    markers: list[GlobeMarker] = []
    for country in list_countries(session):
        lat, lng = GLOBE_COORDINATES[country.code]
        markers.append(
            GlobeMarker(
                code=country.code,
                name=_display_name(country, locale),
                lat=lat,
                lng=lng,
                summary=localized_text(
                    locale, f"country:{country.code}", "summary", country.summary
                ),
                readiness=country.readiness_score,
                data_origin=DATA_ORIGIN,
            )
        )
    return markers


def assistant_preview(
    session: Session, request: AssistantPreviewRequest, locale: Locale
) -> AssistantPreview:
    country = get_country_detail(session, request.country_code)
    name = _display_name(country, locale)
    guidance = COUNTRY_GUIDANCE[country.code][locale]
    label = QUESTION_LABELS[locale][request.question_type]
    policy = session.scalar(select(Policy).where(Policy.country_code == country.code))
    tender = session.scalar(select(Tender).where(Tender.country_code == country.code))
    if policy is None or tender is None:
        raise DemoAPIError(
            status_code=409,
            code="DEMO_FIXTURE_INCOMPLETE",
            message="合成演示记录不完整。",
        )
    policy_title = localized_text(locale, f"policy:{policy.policy_id}", "title", policy.title)
    tender_title = localized_text(locale, f"tender:{tender.tender_id}", "title", tender.title)

    if locale == "en":
        summary = (
            f"The {label} demo for {name} focuses on {guidance['focus']}, while treating "
            f"'{guidance['risk']}' as a verification item. This is a synthetic exercise, "
            "not a professional conclusion."
        )
        actions = [
            guidance["action"].capitalize() + ".",
            "Review the synthetic policy and risk cards before selecting a path.",
            "Record assumptions and assign an owner for the next internal exercise.",
        ]
        limitations = [
            "Uses repository-owned synthetic demo data only.",
            "No external model, source, customer, or real-user call is made.",
            "The response must not support investment, engineering, or legal decisions.",
        ]
    else:
        summary = (
            f"{name}的{label}演示应围绕{guidance['focus']}展开，同时将“{guidance['risk']}”"
            "作为核验项。这是合成推演，不是专业结论。"
        )
        actions = [
            f"{guidance['action']}。",
            "选择路径前复核合成政策卡和风险卡。",
            "记录假设，并为下一次内部推演指定责任人。",
        ]
        limitations = [
            "仅使用仓库自有的合成演示数据。",
            "未调用外部模型、数据源、客户或真实用户。",
            "回答不得用于投资、工程或法律决策。",
        ]

    return AssistantPreview(
        country_code=country.code,
        question_type=request.question_type,
        summary=summary,
        actions=actions,
        related_items=[
            f"{policy.policy_id} · {policy_title}",
            f"{tender.tender_id} · {tender_title}",
        ],
        limitations=limitations,
        data_origin=DATA_ORIGIN,
    )


def solar_storage_preview(
    session: Session, request: SolarStoragePreviewRequest, locale: Locale
) -> SolarStoragePreview:
    country = get_country_detail(session, request.country_code)
    name = _display_name(country, locale)
    guidance = COUNTRY_GUIDANCE[country.code][locale]
    scenario = SCENARIO_LABELS[locale][request.scenario]
    capacity = f"{request.solar_capacity_mw:g}"

    if locale == "en":
        configuration = [
            f"Illustrative market and scenario: {name} · {scenario}.",
            f"Input solar concept capacity: {capacity} MW; not independently validated.",
            (
                f"Storage duration assumption: {request.storage_duration_hours} hours; "
                "storage power remains to be validated."
            ),
            "Illustrative operating mode: resilience, peak management, and renewable matching.",
        ]
        assumptions = [
            "All values are user-entered or synthetic and are not an engineering design.",
            "Site, load, grid, climate, equipment, and safety data have not been verified.",
            "Commercial returns and financial performance are intentionally not calculated.",
        ]
        risks = [
            guidance["risk"].capitalize() + ".",
            "Grid, land, permitting, fire-safety, and supply-chain constraints are unverified.",
            "The concept cannot be used for procurement, construction, or financing.",
        ]
        next_steps = [
            guidance["action"].capitalize() + ".",
            "Collect verified load, site, interconnection, and safety inputs.",
            "Commission authorized specialists before any formal design or decision.",
        ]
    else:
        configuration = [
            f"演示市场与场景：{name} · {scenario}。",
            f"输入的光伏概念容量：{capacity} MW，尚未独立核验。",
            f"储能时长假设：{request.storage_duration_hours}小时；储能功率仍待核验。",
            "演示运行方式：韧性供电、峰值管理与可再生能源匹配。",
        ]
        assumptions = [
            "全部数值来自用户输入或合成假设，不构成工程设计。",
            "场址、负荷、电网、气候、设备和安全数据均未核验。",
            "有意不计算商业回报或财务表现。",
        ]
        risks = [
            f"{guidance['risk']}。",
            "电网、土地、许可、消防和供应链约束均未核验。",
            "本概念不得用于采购、施工或融资。",
        ]
        next_steps = [
            f"{guidance['action']}。",
            "收集经核验的负荷、场址、并网和安全输入。",
            "任何正式设计或决定前，委托具备授权的专业人员。",
        ]

    return SolarStoragePreview(
        country_code=country.code,
        scenario=request.scenario,
        configuration=configuration,
        assumptions=assumptions,
        risks=risks,
        next_steps=next_steps,
        data_origin=DATA_ORIGIN,
    )


def feasibility_report_preview(
    session: Session, request: FeasibilityReportPreviewRequest, locale: Locale
) -> FeasibilityReportPreview:
    country = get_country_detail(session, request.country_code)
    name = _display_name(country, locale)
    guidance = COUNTRY_GUIDANCE[country.code][locale]
    project = PROJECT_LABELS[locale][request.project_type]

    if locale == "en":
        section_content = {
            "market_context": (
                f"The synthetic {name} scenario highlights {guidance['focus']}. "
                "Real market evidence has not been collected or admitted."
            ),
            "technical_concept": (
                f"The {project} remains a qualitative concept. Capacity, topology, equipment, "
                "grid, site, and safety inputs require authorized validation."
            ),
            "delivery_plan": (
                f"The internal exercise starts by following this synthetic action: "
                f"{guidance['action']}. Owners and evidence must be confirmed separately."
            ),
            "risk_review": (
                f"The primary synthetic prompt is that {guidance['risk']}. Legal, technical, "
                "commercial, environmental, and safety reviews remain open."
            ),
        }
        title = f"Synthetic {name} {project} feasibility draft"
        open_questions = [
            "Who is authorized to validate the site, load, and grid inputs?",
            "Which real-source evidence may be admitted under the formal data gates?",
            "What acceptance criteria and decision authority will govern the next stage?",
        ]
        limitations = [
            "Draft preview only; no formal report artifact is produced.",
            "No external source, model, real-user, or production credential is used.",
            "Not suitable for professional, investment, engineering, legal, or tender decisions.",
        ]
    else:
        section_content = {
            "market_context": (
                f"合成{name}情景突出{guidance['focus']}。尚未采集或准入任何真实市场证据。"
            ),
            "technical_concept": (
                f"{project}仍为定性概念。容量、拓扑、设备、电网、场址和安全输入均需授权核验。"
            ),
            "delivery_plan": (
                f"内部推演首先执行该合成动作：{guidance['action']}。责任人和证据需另行确认。"
            ),
            "risk_review": (
                f"首要合成提示为{guidance['risk']}。法律、技术、商务、环境和安全复核均未完成。"
            ),
        }
        title = f"合成{name}{project}可研草案"
        open_questions = [
            "谁有权核验场址、负荷和电网输入?",
            "正式数据闸门允许准入哪些真实来源证据?",
            "下一阶段采用哪些验收标准和决定权限?",
        ]
        limitations = [
            "仅为草案预览，不生成正式报告制品。",
            "未使用外部来源、模型、真实用户或生产凭据。",
            "不得用于专业、投资、工程、法律或招标决定。",
        ]

    sections = [
        FeasibilitySection(
            key=section_key,
            title=SECTION_TITLES[locale][section_key],
            content=section_content[section_key],
        )
        for section_key in request.section_keys
    ]
    return FeasibilityReportPreview(
        country_code=country.code,
        project_type=request.project_type,
        title=title,
        sections=sections,
        open_questions=open_questions,
        limitations=limitations,
        data_origin=DATA_ORIGIN,
    )


def list_tool_tenders(
    session: Session,
    locale: Locale,
    *,
    country_code: str | None,
    sector: str | None,
    stage: str | None,
    keyword: str | None,
    limit: int,
) -> list[TenderItem]:
    statement = select(Tender)
    if country_code:
        statement = statement.where(Tender.country_code == country_code.upper())
    if sector:
        statement = statement.where(Tender.sector == sector)
    if stage:
        statement = statement.where(Tender.stage == stage)
    rows = list(session.scalars(statement.order_by(Tender.deadline, Tender.tender_id)).all())
    items = [tender_item(row, locale) for row in rows]
    if keyword:
        needle = keyword.casefold().strip()
        items = [
            item
            for item in items
            if needle in item.title.casefold()
            or needle in item.summary.casefold()
            or needle in item.country_code.casefold()
        ]
    return items[:limit]


def get_tool_tender(session: Session, tender_id: str, locale: Locale) -> TenderItem:
    row = session.scalar(select(Tender).where(Tender.tender_id == tender_id.upper()))
    if row is None:
        raise DemoAPIError(
            status_code=404,
            code="DEMO_TENDER_NOT_FOUND",
            message=f"合成演示库中不存在招标编号 {tender_id.upper()}。",
        )
    return tender_item(row, locale)
