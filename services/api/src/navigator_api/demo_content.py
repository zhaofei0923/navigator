"""Bilingual deterministic copy used by the bounded demo tools."""

from __future__ import annotations

from typing import Final, TypedDict

from navigator_api.schemas import Locale, ProjectType, QuestionType, SectionKey, SolarScenario


class CountryGuidance(TypedDict):
    focus: str
    risk: str
    action: str


GLOBE_COORDINATES: Final[dict[str, tuple[float, float]]] = {
    "BRA": (-14.2350, -51.9253),
    "IDN": (-0.7893, 113.9213),
    "SAU": (23.8859, 45.0792),
    "VNM": (14.0583, 108.2772),
    "ZAF": (-30.5595, 22.9375),
}

COUNTRY_GUIDANCE: Final[dict[str, dict[Locale, CountryGuidance]]] = {
    "BRA": {
        "zh-CN": {
            "focus": "高可靠工商业负荷和韧性能源服务",
            "risk": "合成客户验证周期可能延长",
            "action": "先用合成负荷曲线验证备电与储能组合",
        },
        "en": {
            "focus": "high-reliability commercial loads and resilient energy services",
            "risk": "the synthetic customer validation cycle may be longer",
            "action": "first test backup-power and storage combinations with synthetic loads",
        },
    },
    "IDN": {
        "zh-CN": {
            "focus": "群岛微网和跨区域交付组合",
            "risk": "合成审批与交付路径较分散",
            "action": "先选择一个合成区域完成桌面推演",
        },
        "en": {
            "focus": "island microgrids and cross-region delivery portfolios",
            "risk": "the synthetic approval and delivery path is geographically dispersed",
            "action": "first select one synthetic region for a desktop exercise",
        },
    },
    "SAU": {
        "zh-CN": {
            "focus": "大型光储项目和本地化交付",
            "risk": "合成本地化能力仍有履约差距",
            "action": "先完成合成本地化差距与职责矩阵",
        },
        "en": {
            "focus": "utility-scale solar and storage with localized delivery",
            "risk": "the synthetic localization capability still has delivery gaps",
            "action": "first complete a synthetic localization gap and responsibility matrix",
        },
    },
    "VNM": {
        "zh-CN": {
            "focus": "工业园区绿电和储能集成",
            "risk": "合成并网容量存在约束",
            "action": "先比较三个合成接入容量场景",
        },
        "en": {
            "focus": "industrial-park green power and storage integration",
            "risk": "the synthetic grid connection has capacity constraints",
            "action": "first compare three synthetic interconnection-capacity scenarios",
        },
    },
    "ZAF": {
        "zh-CN": {
            "focus": "工商业韧性供电和标准化方案",
            "risk": "合成价格竞争压力较高",
            "action": "先形成两个合成容量档位和服务组合",
        },
        "en": {
            "focus": "resilient commercial power and standardized solution packs",
            "risk": "synthetic price competition is relatively strong",
            "action": "first prepare two synthetic capacity tiers and service bundles",
        },
    },
}

QUESTION_LABELS: Final[dict[Locale, dict[QuestionType, str]]] = {
    "zh-CN": {
        "market_entry": "市场进入",
        "policy_risk": "政策与风险",
        "partner_strategy": "伙伴策略",
        "tender_readiness": "招标准备",
    },
    "en": {
        "market_entry": "market entry",
        "policy_risk": "policy and risk",
        "partner_strategy": "partner strategy",
        "tender_readiness": "tender readiness",
    },
}

SCENARIO_LABELS: Final[dict[Locale, dict[SolarScenario, str]]] = {
    "zh-CN": {
        "utility_scale": "集中式项目",
        "commercial_industrial": "工商业项目",
        "island_microgrid": "岛屿微网",
    },
    "en": {
        "utility_scale": "utility-scale project",
        "commercial_industrial": "commercial and industrial project",
        "island_microgrid": "island microgrid",
    },
}

PROJECT_LABELS: Final[dict[Locale, dict[ProjectType, str]]] = {
    "zh-CN": {
        "solar_storage": "光储项目",
        "microgrid": "微网项目",
        "battery_storage": "储能项目",
    },
    "en": {
        "solar_storage": "solar and storage project",
        "microgrid": "microgrid project",
        "battery_storage": "battery storage project",
    },
}

SECTION_TITLES: Final[dict[Locale, dict[SectionKey, str]]] = {
    "zh-CN": {
        "market_context": "市场背景",
        "technical_concept": "技术概念",
        "delivery_plan": "交付计划",
        "risk_review": "风险复核",
    },
    "en": {
        "market_context": "Market context",
        "technical_concept": "Technical concept",
        "delivery_plan": "Delivery plan",
        "risk_review": "Risk review",
    },
}
