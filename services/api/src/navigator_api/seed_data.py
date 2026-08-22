"""Deterministic repository-owned fixtures for the bounded internal demo."""

from __future__ import annotations

from datetime import date
from typing import TypedDict


class SignalFixture(TypedDict):
    category: str
    title: str
    value: float
    unit: str
    trend: str
    confidence: int
    occurred_at: date
    summary: str


class ReasonFixture(TypedDict):
    kind: str
    title: str
    detail: str


class ActionFixture(TypedDict):
    title: str
    detail: str
    owner_hint: str


class PolicyFixture(TypedDict):
    title: str
    category: str
    status: str
    published_at: date
    summary: str


class RiskFixture(TypedDict):
    title: str
    category: str
    severity: int
    likelihood: int
    detail: str
    mitigation: str


class OpportunityFixture(TypedDict):
    title: str
    category: str
    score: int
    detail: str
    next_step: str


class TenderFixture(TypedDict):
    title: str
    sector: str
    stage: str
    budget_min_million: float
    budget_max_million: float
    currency: str
    deadline: date
    summary: str


class PartnerFixture(TypedDict):
    name: str
    partner_type: str
    capabilities: list[str]
    fit_score: int
    summary: str


class CountryFixture(TypedDict):
    code: str
    name_zh: str
    name_en: str
    region: str
    currency: str
    summary: str
    readiness_score: int
    opportunity_score: int
    risk_score: int
    market_attractiveness: int
    policy_certainty: int
    project_activity: int
    partner_maturity: int
    risk_controllability: int
    dimension_deltas: dict[str, float]
    signals: list[SignalFixture]
    reasons: list[ReasonFixture]
    actions: list[ActionFixture]
    policy: PolicyFixture
    risk: RiskFixture
    opportunity: OpportunityFixture
    tender: TenderFixture
    partner: PartnerFixture


COUNTRY_FIXTURES: tuple[CountryFixture, ...] = (
    {
        "code": "IDN",
        "name_zh": "印度尼西亚",
        "name_en": "Indonesia",
        "region": "东南亚",
        "currency": "IDR",
        "summary": "用于演示群岛型市场进入分析的完全合成情景。",
        "readiness_score": 78,
        "opportunity_score": 84,
        "risk_score": 56,
        "market_attractiveness": 86,
        "policy_certainty": 72,
        "project_activity": 84,
        "partner_maturity": 74,
        "risk_controllability": 54,
        "dimension_deltas": {
            "market_attractiveness": 2.4,
            "policy_certainty": 1.2,
            "project_activity": 3.1,
            "partner_maturity": 0.8,
            "risk_controllability": 1.5,
        },
        "signals": [
            {
                "category": "market",
                "title": "合成项目活跃度",
                "value": 82.0,
                "unit": "score_point",
                "trend": "up",
                "confidence": 88,
                "occurred_at": date(2026, 7, 28),
                "summary": "虚构指数显示内部演示中的项目线索较活跃。",
            },
            {
                "category": "delivery",
                "title": "合成本地交付覆盖",
                "value": 71.0,
                "unit": "percent",
                "trend": "stable",
                "confidence": 81,
                "occurred_at": date(2026, 7, 18),
                "summary": "虚构覆盖率用于演示跨区域交付判断。",
            },
        ],
        "reasons": [
            {
                "kind": "opportunity",
                "title": "演示需求池较大",
                "detail": "合成线索数量与机会评分共同形成演示排序优势。",
            },
            {
                "kind": "constraint",
                "title": "交付区域分散",
                "detail": "该约束为虚构假设，仅用于展示风险解释能力。",
            },
        ],
        "actions": [
            {
                "title": "建立合成区域样板清单",
                "detail": "从三个虚构区域中选择一处开展桌面推演。",
                "owner_hint": "市场团队",
            },
            {
                "title": "验证虚构交付伙伴组合",
                "detail": "使用演示伙伴档案完成能力矩阵。",
                "owner_hint": "交付团队",
            },
        ],
        "policy": {
            "title": "合成清洁能源示范框架",
            "category": "energy",
            "status": "scenario_active",
            "published_at": date(2026, 1, 15),
            "summary": "虚构政策记录，不代表任何实际法规或政策。",
        },
        "risk": {
            "title": "合成跨区域审批复杂度",
            "category": "regulatory",
            "severity": 4,
            "likelihood": 3,
            "detail": "虚构审批路径可能增加演示项目周期。",
            "mitigation": "在内部沙盘中预留分阶段核验节点。",
        },
        "opportunity": {
            "title": "合成群岛微网组合",
            "category": "microgrid",
            "score": 86,
            "detail": "虚构分布式场景用于展示机会聚合。",
            "next_step": "创建合成场址短名单并运行比较。",
        },
        "tender": {
            "title": "合成东部区域储能示范包",
            "sector": "battery_storage",
            "stage": "demo_watchlist",
            "budget_min_million": 18.0,
            "budget_max_million": 28.0,
            "currency": "USD",
            "deadline": date(2026, 11, 30),
            "summary": "完全虚构的招标卡片，不可用于商业决策。",
        },
        "partner": {
            "name": "Nusantara Demo Engineering",
            "partner_type": "synthetic_epc",
            "capabilities": ["微网集成", "现场运维", "本地协调"],
            "fit_score": 83,
            "summary": "仓库自有虚构伙伴，不对应真实法人。",
        },
    },
    {
        "code": "SAU",
        "name_zh": "沙特阿拉伯",
        "name_en": "Saudi Arabia",
        "region": "中东",
        "currency": "SAR",
        "summary": "用于演示大型项目组合与本地化要求的完全合成情景。",
        "readiness_score": 82,
        "opportunity_score": 79,
        "risk_score": 52,
        "market_attractiveness": 84,
        "policy_certainty": 80,
        "project_activity": 82,
        "partner_maturity": 76,
        "risk_controllability": 58,
        "dimension_deltas": {
            "market_attractiveness": 1.8,
            "policy_certainty": 2.1,
            "project_activity": 1.4,
            "partner_maturity": 2.2,
            "risk_controllability": 0.9,
        },
        "signals": [
            {
                "category": "market",
                "title": "合成大型项目密度",
                "value": 86.0,
                "unit": "score_point",
                "trend": "up",
                "confidence": 86,
                "occurred_at": date(2026, 7, 26),
                "summary": "虚构指数用于呈现集中式项目机会。",
            },
            {
                "category": "localization",
                "title": "合成本地化准备度",
                "value": 73.0,
                "unit": "percent",
                "trend": "up",
                "confidence": 82,
                "occurred_at": date(2026, 7, 16),
                "summary": "虚构评分用于演示本地化策略。",
            },
        ],
        "reasons": [
            {
                "kind": "opportunity",
                "title": "演示项目规模较高",
                "detail": "合成项目规模为组合展示提供较高权重。",
            },
            {
                "kind": "constraint",
                "title": "合成本地化门槛",
                "detail": "虚构门槛用于展示进入准备工作。",
            },
        ],
        "actions": [
            {
                "title": "完成合成本地化差距表",
                "detail": "将虚构岗位与供应链要求映射到能力清单。",
                "owner_hint": "战略团队",
            },
            {
                "title": "设计演示联合交付模型",
                "detail": "基于虚构伙伴能力形成职责矩阵。",
                "owner_hint": "交付团队",
            },
        ],
        "policy": {
            "title": "合成能源本地化激励方案",
            "category": "investment",
            "status": "scenario_active",
            "published_at": date(2026, 2, 20),
            "summary": "虚构政策记录，不代表任何实际法规或政策。",
        },
        "risk": {
            "title": "合成本地化履约差距",
            "category": "delivery",
            "severity": 4,
            "likelihood": 3,
            "detail": "虚构资源差距可能影响演示履约评分。",
            "mitigation": "使用合成能力矩阵分阶段补齐。",
        },
        "opportunity": {
            "title": "合成大型光储一体化组合",
            "category": "solar_storage",
            "score": 82,
            "detail": "虚构集中式项目用于展示规模化机会。",
            "next_step": "运行虚构联合体情景比较。",
        },
        "tender": {
            "title": "合成沙漠光储示范包",
            "sector": "solar_storage",
            "stage": "demo_watchlist",
            "budget_min_million": 45.0,
            "budget_max_million": 72.0,
            "currency": "USD",
            "deadline": date(2027, 1, 15),
            "summary": "完全虚构的招标卡片，不可用于商业决策。",
        },
        "partner": {
            "name": "Riyadh Demo Projects",
            "partner_type": "synthetic_developer",
            "capabilities": ["项目开发", "本地化规划", "大型项目管理"],
            "fit_score": 80,
            "summary": "仓库自有虚构伙伴，不对应真实法人。",
        },
    },
    {
        "code": "VNM",
        "name_zh": "越南",
        "name_en": "Vietnam",
        "region": "东南亚",
        "currency": "VND",
        "summary": "用于演示制造业负荷与电网约束的完全合成情景。",
        "readiness_score": 80,
        "opportunity_score": 82,
        "risk_score": 48,
        "market_attractiveness": 83,
        "policy_certainty": 75,
        "project_activity": 85,
        "partner_maturity": 78,
        "risk_controllability": 62,
        "dimension_deltas": {
            "market_attractiveness": 2.0,
            "policy_certainty": 0.7,
            "project_activity": 2.8,
            "partner_maturity": 1.6,
            "risk_controllability": 1.1,
        },
        "signals": [
            {
                "category": "demand",
                "title": "合成工业负荷需求",
                "value": 84.0,
                "unit": "score_point",
                "trend": "up",
                "confidence": 87,
                "occurred_at": date(2026, 7, 24),
                "summary": "虚构指数用于演示工业能源需求。",
            },
            {
                "category": "grid",
                "title": "合成并网可用度",
                "value": 68.0,
                "unit": "percent",
                "trend": "stable",
                "confidence": 79,
                "occurred_at": date(2026, 7, 14),
                "summary": "虚构可用度用于演示电网约束。",
            },
        ],
        "reasons": [
            {
                "kind": "opportunity",
                "title": "演示工业场景丰富",
                "detail": "合成工业园区需求支撑多种解决方案展示。",
            },
            {
                "kind": "constraint",
                "title": "虚构并网容量有限",
                "detail": "该假设用于展示容量风险提示。",
            },
        ],
        "actions": [
            {
                "title": "筛选合成工业园区",
                "detail": "按虚构负荷曲线形成三个演示场景。",
                "owner_hint": "产品团队",
            },
            {
                "title": "运行合成并网敏感性分析",
                "detail": "比较三种虚构接入容量。",
                "owner_hint": "技术团队",
            },
        ],
        "policy": {
            "title": "合成工业园区绿电试点",
            "category": "power_market",
            "status": "scenario_active",
            "published_at": date(2026, 3, 10),
            "summary": "虚构政策记录，不代表任何实际法规或政策。",
        },
        "risk": {
            "title": "合成并网容量波动",
            "category": "grid",
            "severity": 3,
            "likelihood": 3,
            "detail": "虚构容量变化可能影响演示方案。",
            "mitigation": "为合成方案保留离网和削峰备选。",
        },
        "opportunity": {
            "title": "合成工业园区绿电组合",
            "category": "corporate_energy",
            "score": 84,
            "detail": "虚构负荷场景用于展示企业能源服务。",
            "next_step": "生成合成负荷与方案匹配卡。",
        },
        "tender": {
            "title": "合成南部工业储能示范",
            "sector": "industrial_storage",
            "stage": "demo_watchlist",
            "budget_min_million": 12.0,
            "budget_max_million": 20.0,
            "currency": "USD",
            "deadline": date(2026, 12, 20),
            "summary": "完全虚构的招标卡片，不可用于商业决策。",
        },
        "partner": {
            "name": "Mekong Demo Energy",
            "partner_type": "synthetic_integrator",
            "capabilities": ["工业能源", "储能集成", "负荷分析"],
            "fit_score": 85,
            "summary": "仓库自有虚构伙伴，不对应真实法人。",
        },
    },
    {
        "code": "ZAF",
        "name_zh": "南非",
        "name_en": "South Africa",
        "region": "非洲南部",
        "currency": "ZAR",
        "summary": "用于演示工商业韧性供电与分布式能源的完全合成情景。",
        "readiness_score": 74,
        "opportunity_score": 76,
        "risk_score": 44,
        "market_attractiveness": 76,
        "policy_certainty": 78,
        "project_activity": 74,
        "partner_maturity": 75,
        "risk_controllability": 66,
        "dimension_deltas": {
            "market_attractiveness": 0.9,
            "policy_certainty": -0.4,
            "project_activity": 1.2,
            "partner_maturity": 0.5,
            "risk_controllability": -0.8,
        },
        "signals": [
            {
                "category": "market",
                "title": "合成工商业韧性需求",
                "value": 76.0,
                "unit": "score_point",
                "trend": "stable",
                "confidence": 84,
                "occurred_at": date(2026, 7, 22),
                "summary": "虚构指数用于演示工商业韧性需求。",
            },
            {
                "category": "finance",
                "title": "合成融资可获得性",
                "value": 72.0,
                "unit": "percent",
                "trend": "up",
                "confidence": 77,
                "occurred_at": date(2026, 7, 12),
                "summary": "虚构评分用于演示融资情景。",
            },
        ],
        "reasons": [
            {
                "kind": "opportunity",
                "title": "演示韧性供电场景清晰",
                "detail": "合成工商业项目组合适合展示标准化方案。",
            },
            {
                "kind": "constraint",
                "title": "虚构价格竞争较强",
                "detail": "该假设用于展示毛利敏感性。",
            },
        ],
        "actions": [
            {
                "title": "制作合成标准方案包",
                "detail": "形成两个虚构容量档位和服务组合。",
                "owner_hint": "产品团队",
            },
            {
                "title": "验证演示融资结构",
                "detail": "比较三种纯合成现金流模型。",
                "owner_hint": "财务团队",
            },
        ],
        "policy": {
            "title": "合成工商业能源韧性试验规则",
            "category": "distributed_energy",
            "status": "scenario_active",
            "published_at": date(2026, 4, 5),
            "summary": "虚构政策记录，不代表任何实际法规或政策。",
        },
        "risk": {
            "title": "合成价格竞争压力",
            "category": "commercial",
            "severity": 3,
            "likelihood": 3,
            "detail": "虚构价格压力可能降低演示项目收益。",
            "mitigation": "通过合成服务组合演示差异化。",
        },
        "opportunity": {
            "title": "合成商业园区能源服务",
            "category": "distributed_energy",
            "score": 78,
            "detail": "虚构园区组合用于展示标准化交付。",
            "next_step": "对两个合成容量档位进行比较。",
        },
        "tender": {
            "title": "合成商业园区光储包",
            "sector": "distributed_energy",
            "stage": "demo_watchlist",
            "budget_min_million": 8.0,
            "budget_max_million": 14.0,
            "currency": "USD",
            "deadline": date(2026, 10, 25),
            "summary": "完全虚构的招标卡片，不可用于商业决策。",
        },
        "partner": {
            "name": "Cape Demo Solutions",
            "partner_type": "synthetic_service_provider",
            "capabilities": ["工商业能源", "韧性供电", "融资协调"],
            "fit_score": 78,
            "summary": "仓库自有虚构伙伴，不对应真实法人。",
        },
    },
    {
        "code": "BRA",
        "name_zh": "巴西",
        "name_en": "Brazil",
        "region": "拉丁美洲",
        "currency": "BRL",
        "summary": "用于演示大型工商业负荷与高可靠能源服务的完全合成情景。",
        "readiness_score": 77,
        "opportunity_score": 75,
        "risk_score": 40,
        "market_attractiveness": 78,
        "policy_certainty": 81,
        "project_activity": 76,
        "partner_maturity": 80,
        "risk_controllability": 72,
        "dimension_deltas": {
            "market_attractiveness": 1.5,
            "policy_certainty": 1.0,
            "project_activity": 1.9,
            "partner_maturity": 1.3,
            "risk_controllability": 0.6,
        },
        "signals": [
            {
                "category": "demand",
                "title": "合成高可靠负荷需求",
                "value": 79.0,
                "unit": "score_point",
                "trend": "up",
                "confidence": 85,
                "occurred_at": date(2026, 7, 20),
                "summary": "虚构指数用于展示大型工商业高可靠用能需求。",
            },
            {
                "category": "delivery",
                "title": "合成供应链准备度",
                "value": 78.0,
                "unit": "percent",
                "trend": "stable",
                "confidence": 83,
                "occurred_at": date(2026, 7, 10),
                "summary": "虚构评分用于展示交付准备度。",
            },
        ],
        "reasons": [
            {
                "kind": "opportunity",
                "title": "演示高可靠负荷清晰",
                "detail": "合成用能画像适合展示高可靠方案。",
            },
            {
                "kind": "constraint",
                "title": "虚构客户验证周期较长",
                "detail": "该假设用于展示销售周期风险。",
            },
        ],
        "actions": [
            {
                "title": "构建合成可靠性方案",
                "detail": "用虚构负荷曲线验证备电与储能组合。",
                "owner_hint": "技术团队",
            },
            {
                "title": "准备演示客户验证清单",
                "detail": "列出纯合成性能指标与验收点。",
                "owner_hint": "售前团队",
            },
        ],
        "policy": {
            "title": "合成工商业高可靠能源指引",
            "category": "commercial_energy",
            "status": "scenario_active",
            "published_at": date(2026, 5, 8),
            "summary": "虚构政策记录，不代表任何实际法规或政策。",
        },
        "risk": {
            "title": "合成验证周期延长",
            "category": "commercial",
            "severity": 2,
            "likelihood": 3,
            "detail": "虚构客户验证流程可能拉长演示周期。",
            "mitigation": "提前提供合成测试证据和验收清单。",
        },
        "opportunity": {
            "title": "合成数据中心韧性能源包",
            "category": "critical_power",
            "score": 80,
            "detail": "虚构高可靠负荷用于展示韧性方案。",
            "next_step": "运行合成可靠性与成本权衡。",
        },
        "tender": {
            "title": "合成数据中心储能示范",
            "sector": "critical_power",
            "stage": "demo_watchlist",
            "budget_min_million": 15.0,
            "budget_max_million": 24.0,
            "currency": "USD",
            "deadline": date(2027, 2, 10),
            "summary": "完全虚构的招标卡片，不可用于商业决策。",
        },
        "partner": {
            "name": "Atlantic Demo Infrastructure",
            "partner_type": "synthetic_technology_partner",
            "capabilities": ["关键电源", "工商业能源", "系统测试"],
            "fit_score": 82,
            "summary": "仓库自有虚构伙伴，不对应真实法人。",
        },
    },
)
