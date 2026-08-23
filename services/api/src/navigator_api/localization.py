"""Repository-owned English copy for the synthetic demo records.

The database intentionally keeps the original Chinese fixtures unchanged.  This
module is a deterministic, read-only presentation layer: missing English copy
falls back to the Chinese source value, while the API tests enforce complete
coverage for every seeded display field.
"""

from __future__ import annotations

from typing import Final

from navigator_api.constants import DISCLAIMER, DISCLAIMER_EN
from navigator_api.schemas import Disclaimer, Locale

TranslationValue = str | list[str]

ENGLISH_CONTENT: Final[dict[str, dict[str, TranslationValue]]] = {
    "country:IDN": {
        "region": "Southeast Asia",
        "summary": "A fully synthetic scenario for exploring entry into an archipelagic market.",
    },
    "signal:SIG-IDN-001": {
        "title": "Synthetic project activity",
        "summary": "A fictional index indicates active project leads in this internal demo.",
    },
    "signal:SIG-IDN-002": {
        "title": "Synthetic local delivery coverage",
        "summary": "A fictional coverage rate supports the cross-region delivery demonstration.",
    },
    "reason:REA-IDN-001": {
        "title": "Larger demo demand pool",
        "detail": "Synthetic lead volume and opportunity scores create a demo ranking advantage.",
    },
    "reason:REA-IDN-002": {
        "title": "Dispersed delivery regions",
        "detail": "This fictional constraint exists only to demonstrate risk explanations.",
    },
    "action:ACT-IDN-001": {
        "title": "Build a synthetic regional shortlist",
        "detail": "Select one of three fictional regions for a desktop exercise.",
        "owner_hint": "Market team",
    },
    "action:ACT-IDN-002": {
        "title": "Validate a fictional delivery partner mix",
        "detail": "Use demo partner profiles to complete a capability matrix.",
        "owner_hint": "Delivery team",
    },
    "policy:POL-IDN-001": {
        "title": "Synthetic clean-energy demonstration framework",
        "summary": "A fictional policy record that does not represent any actual law or policy.",
    },
    "risk:RSK-IDN-001": {
        "title": "Synthetic cross-region approval complexity",
        "detail": "A fictional approval path may extend the demo project schedule.",
        "mitigation": "Reserve staged verification points in the internal exercise.",
    },
    "opportunity:OPP-IDN-001": {
        "title": "Synthetic island microgrid portfolio",
        "detail": "Fictional distributed scenarios demonstrate opportunity aggregation.",
        "next_step": "Create a synthetic site shortlist and run a comparison.",
    },
    "tender:TND-IDN-001": {
        "title": "Synthetic eastern-region storage demonstration package",
        "summary": "A wholly fictional tender card that must not support business decisions.",
    },
    "partner:PTR-IDN-001": {
        "capabilities": ["Microgrid integration", "Site operations", "Local coordination"],
        "summary": "A repository-owned fictional partner with no corresponding legal entity.",
    },
    "country:SAU": {
        "region": "Middle East",
        "summary": (
            "A fully synthetic scenario for exploring large project portfolios and "
            "localization requirements."
        ),
    },
    "signal:SIG-SAU-001": {
        "title": "Synthetic large-project density",
        "summary": "A fictional index presents utility-scale project opportunities.",
    },
    "signal:SIG-SAU-002": {
        "title": "Synthetic localization readiness",
        "summary": "A fictional score demonstrates localization strategy planning.",
    },
    "reason:REA-SAU-001": {
        "title": "Larger demo project scale",
        "detail": "Synthetic project scale receives a higher weight in the portfolio demo.",
    },
    "reason:REA-SAU-002": {
        "title": "Synthetic localization threshold",
        "detail": "A fictional threshold illustrates market-entry preparation.",
    },
    "action:ACT-SAU-001": {
        "title": "Complete a synthetic localization gap table",
        "detail": "Map fictional workforce and supply-chain requirements to capabilities.",
        "owner_hint": "Strategy team",
    },
    "action:ACT-SAU-002": {
        "title": "Design a demo joint-delivery model",
        "detail": "Create a responsibility matrix from fictional partner capabilities.",
        "owner_hint": "Delivery team",
    },
    "policy:POL-SAU-001": {
        "title": "Synthetic energy-localization incentive scheme",
        "summary": "A fictional policy record that does not represent any actual law or policy.",
    },
    "risk:RSK-SAU-001": {
        "title": "Synthetic localization delivery gap",
        "detail": "A fictional resource gap may affect the demo delivery score.",
        "mitigation": "Close gaps in stages using a synthetic capability matrix.",
    },
    "opportunity:OPP-SAU-001": {
        "title": "Synthetic utility-scale solar and storage portfolio",
        "detail": "Fictional utility-scale projects demonstrate portfolio opportunities.",
        "next_step": "Run a fictional consortium scenario comparison.",
    },
    "tender:TND-SAU-001": {
        "title": "Synthetic desert solar and storage demonstration package",
        "summary": "A wholly fictional tender card that must not support business decisions.",
    },
    "partner:PTR-SAU-001": {
        "capabilities": ["Project development", "Localization planning", "Program management"],
        "summary": "A repository-owned fictional partner with no corresponding legal entity.",
    },
    "country:VNM": {
        "region": "Southeast Asia",
        "summary": (
            "A fully synthetic scenario for exploring industrial demand and grid constraints."
        ),
    },
    "signal:SIG-VNM-001": {
        "title": "Synthetic industrial demand",
        "summary": "A fictional index demonstrates industrial energy demand.",
    },
    "signal:SIG-VNM-002": {
        "title": "Synthetic grid availability",
        "summary": "Fictional availability demonstrates grid constraints.",
    },
    "reason:REA-VNM-001": {
        "title": "Rich industrial demo scenarios",
        "detail": "Synthetic industrial-park demand supports multiple solution demonstrations.",
    },
    "reason:REA-VNM-002": {
        "title": "Limited fictional grid capacity",
        "detail": "This assumption demonstrates capacity-risk prompts.",
    },
    "action:ACT-VNM-001": {
        "title": "Shortlist synthetic industrial parks",
        "detail": "Create three demo scenarios from fictional load profiles.",
        "owner_hint": "Product team",
    },
    "action:ACT-VNM-002": {
        "title": "Run synthetic grid sensitivity checks",
        "detail": "Compare three fictional interconnection capacities.",
        "owner_hint": "Technical team",
    },
    "policy:POL-VNM-001": {
        "title": "Synthetic industrial-park green-power pilot",
        "summary": "A fictional policy record that does not represent any actual law or policy.",
    },
    "risk:RSK-VNM-001": {
        "title": "Synthetic grid-capacity variation",
        "detail": "Fictional capacity changes may affect the demo concept.",
        "mitigation": "Retain islanded-operation and peak-shaving alternatives.",
    },
    "opportunity:OPP-VNM-001": {
        "title": "Synthetic industrial-park green-power portfolio",
        "detail": "Fictional load scenarios demonstrate corporate energy services.",
        "next_step": "Generate a synthetic load-to-solution matching card.",
    },
    "tender:TND-VNM-001": {
        "title": "Synthetic southern industrial storage demonstration",
        "summary": "A wholly fictional tender card that must not support business decisions.",
    },
    "partner:PTR-VNM-001": {
        "capabilities": ["Industrial energy", "Storage integration", "Load analysis"],
        "summary": "A repository-owned fictional partner with no corresponding legal entity.",
    },
    "country:ZAF": {
        "region": "Southern Africa",
        "summary": (
            "A fully synthetic scenario for exploring resilient commercial power and "
            "distributed energy."
        ),
    },
    "signal:SIG-ZAF-001": {
        "title": "Synthetic commercial resilience demand",
        "summary": "A fictional index demonstrates commercial resilience demand.",
    },
    "signal:SIG-ZAF-002": {
        "title": "Synthetic financing availability",
        "summary": "A fictional score demonstrates financing scenarios.",
    },
    "reason:REA-ZAF-001": {
        "title": "Clear resilient-power demo scenarios",
        "detail": "A synthetic commercial portfolio suits standardized solution demonstrations.",
    },
    "reason:REA-ZAF-002": {
        "title": "Stronger fictional price competition",
        "detail": "This assumption demonstrates margin sensitivity.",
    },
    "action:ACT-ZAF-001": {
        "title": "Prepare a synthetic standard solution pack",
        "detail": "Create two fictional capacity tiers and service bundles.",
        "owner_hint": "Product team",
    },
    "action:ACT-ZAF-002": {
        "title": "Validate a demo financing structure",
        "detail": "Compare three wholly synthetic cash-flow models.",
        "owner_hint": "Finance team",
    },
    "policy:POL-ZAF-001": {
        "title": "Synthetic commercial energy-resilience trial rules",
        "summary": "A fictional policy record that does not represent any actual law or policy.",
    },
    "risk:RSK-ZAF-001": {
        "title": "Synthetic price competition pressure",
        "detail": "Fictional price pressure may reduce demo project returns.",
        "mitigation": "Demonstrate differentiation through synthetic service bundles.",
    },
    "opportunity:OPP-ZAF-001": {
        "title": "Synthetic business-park energy service",
        "detail": "A fictional park portfolio demonstrates standardized delivery.",
        "next_step": "Compare two synthetic capacity tiers.",
    },
    "tender:TND-ZAF-001": {
        "title": "Synthetic business-park solar and storage package",
        "summary": "A wholly fictional tender card that must not support business decisions.",
    },
    "partner:PTR-ZAF-001": {
        "capabilities": ["Commercial energy", "Resilient power", "Financing coordination"],
        "summary": "A repository-owned fictional partner with no corresponding legal entity.",
    },
    "country:BRA": {
        "region": "Latin America",
        "summary": (
            "A fully synthetic scenario for exploring large commercial loads and "
            "high-reliability energy services."
        ),
    },
    "signal:SIG-BRA-001": {
        "title": "Synthetic high-reliability load demand",
        "summary": "A fictional index demonstrates reliable energy demand for large facilities.",
    },
    "signal:SIG-BRA-002": {
        "title": "Synthetic supply-chain readiness",
        "summary": "A fictional score demonstrates delivery readiness.",
    },
    "reason:REA-BRA-001": {
        "title": "Clear high-reliability demo loads",
        "detail": "Synthetic energy profiles suit high-reliability solution demonstrations.",
    },
    "reason:REA-BRA-002": {
        "title": "Longer fictional customer validation cycle",
        "detail": "This assumption demonstrates sales-cycle risk.",
    },
    "action:ACT-BRA-001": {
        "title": "Build a synthetic reliability concept",
        "detail": "Use fictional load profiles to test backup-power and storage combinations.",
        "owner_hint": "Technical team",
    },
    "action:ACT-BRA-002": {
        "title": "Prepare a demo customer validation list",
        "detail": "List wholly synthetic performance metrics and acceptance points.",
        "owner_hint": "Pre-sales team",
    },
    "policy:POL-BRA-001": {
        "title": "Synthetic reliable-commercial-energy guidance",
        "summary": "A fictional policy record that does not represent any actual law or policy.",
    },
    "risk:RSK-BRA-001": {
        "title": "Synthetic validation-cycle extension",
        "detail": "A fictional customer validation process may extend the demo cycle.",
        "mitigation": "Provide synthetic test evidence and acceptance lists in advance.",
    },
    "opportunity:OPP-BRA-001": {
        "title": "Synthetic data-center resilience energy package",
        "detail": "Fictional high-reliability loads demonstrate resilient solutions.",
        "next_step": "Run a synthetic reliability and cost trade-off exercise.",
    },
    "tender:TND-BRA-001": {
        "title": "Synthetic data-center storage demonstration",
        "summary": "A wholly fictional tender card that must not support business decisions.",
    },
    "partner:PTR-BRA-001": {
        "capabilities": ["Critical power", "Commercial energy", "System testing"],
        "summary": "A repository-owned fictional partner with no corresponding legal entity.",
    },
}


def disclaimer_for(locale: Locale) -> Disclaimer:
    return DISCLAIMER_EN if locale == "en" else DISCLAIMER


def locale_from_value(value: str | None) -> Locale:
    return "en" if value == "en" else "zh-CN"


def localized_text(locale: Locale, key: str, field: str, source: str) -> str:
    if locale == "zh-CN":
        return source
    translated = ENGLISH_CONTENT.get(key, {}).get(field)
    return translated if isinstance(translated, str) else source


def localized_list(locale: Locale, key: str, field: str, source: list[str]) -> list[str]:
    if locale == "zh-CN":
        return source
    translated = ENGLISH_CONTENT.get(key, {}).get(field)
    if isinstance(translated, list) and all(isinstance(item, str) for item in translated):
        return translated
    return source
