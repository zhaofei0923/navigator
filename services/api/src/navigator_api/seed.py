"""Seed and reset the deterministic synthetic-demo database."""

from __future__ import annotations

import argparse
import json
from collections.abc import Sequence

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from navigator_api.config import Settings
from navigator_api.database import build_engine, build_session_factory
from navigator_api.models import (
    Base,
    Country,
    CountryAction,
    CountryReason,
    CountrySignal,
    Opportunity,
    Partner,
    Policy,
    RiskRecord,
    Tender,
)
from navigator_api.seed_data import COUNTRY_FIXTURES

RESET_ORDER = (
    CountrySignal,
    CountryReason,
    CountryAction,
    Policy,
    RiskRecord,
    Opportunity,
    Tender,
    Partner,
    Country,
)


def database_counts(session: Session) -> dict[str, int]:
    return {
        "countries": session.scalar(select(func.count()).select_from(Country)) or 0,
        "signals": session.scalar(select(func.count()).select_from(CountrySignal)) or 0,
        "reasons": session.scalar(select(func.count()).select_from(CountryReason)) or 0,
        "actions": session.scalar(select(func.count()).select_from(CountryAction)) or 0,
        "policies": session.scalar(select(func.count()).select_from(Policy)) or 0,
        "risks": session.scalar(select(func.count()).select_from(RiskRecord)) or 0,
        "opportunities": session.scalar(select(func.count()).select_from(Opportunity)) or 0,
        "tenders": session.scalar(select(func.count()).select_from(Tender)) or 0,
        "partners": session.scalar(select(func.count()).select_from(Partner)) or 0,
    }


def seed_database(session: Session, *, force: bool = True) -> dict[str, int]:
    existing = session.scalar(select(func.count()).select_from(Country)) or 0
    if existing and not force:
        return database_counts(session)

    try:
        for model in RESET_ORDER:
            session.execute(delete(model))

        for fixture in COUNTRY_FIXTURES:
            code = fixture["code"]
            country = Country(
                code=code,
                name_zh=fixture["name_zh"],
                name_en=fixture["name_en"],
                region=fixture["region"],
                currency=fixture["currency"],
                summary=fixture["summary"],
                readiness_score=fixture["readiness_score"],
                opportunity_score=fixture["opportunity_score"],
                risk_score=fixture["risk_score"],
                market_attractiveness=fixture["market_attractiveness"],
                policy_certainty=fixture["policy_certainty"],
                project_activity=fixture["project_activity"],
                partner_maturity=fixture["partner_maturity"],
                risk_controllability=fixture["risk_controllability"],
                dimension_deltas=fixture["dimension_deltas"],
            )
            session.add(country)

            for index, signal in enumerate(fixture["signals"], start=1):
                session.add(
                    CountrySignal(
                        signal_id=f"SIG-{code}-{index:03d}",
                        country_code=code,
                        **signal,
                    )
                )
            for index, reason in enumerate(fixture["reasons"], start=1):
                session.add(
                    CountryReason(
                        reason_id=f"REA-{code}-{index:03d}",
                        country_code=code,
                        rank=index,
                        **reason,
                    )
                )
            for index, action in enumerate(fixture["actions"], start=1):
                session.add(
                    CountryAction(
                        action_id=f"ACT-{code}-{index:03d}",
                        country_code=code,
                        priority=index,
                        **action,
                    )
                )

            session.add(Policy(policy_id=f"POL-{code}-001", country_code=code, **fixture["policy"]))
            session.add(RiskRecord(risk_id=f"RSK-{code}-001", country_code=code, **fixture["risk"]))
            session.add(
                Opportunity(
                    opportunity_id=f"OPP-{code}-001",
                    country_code=code,
                    **fixture["opportunity"],
                )
            )
            session.add(Tender(tender_id=f"TND-{code}-001", country_code=code, **fixture["tender"]))
            session.add(
                Partner(partner_id=f"PTR-{code}-001", country_code=code, **fixture["partner"])
            )

        session.commit()
    except Exception:
        session.rollback()
        raise
    return database_counts(session)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--if-empty",
        action="store_true",
        help="Leave an already seeded database unchanged.",
    )
    parser.add_argument(
        "--create-schema",
        action="store_true",
        help="Create tables directly for local-only use; deployed containers use Alembic.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    settings = Settings.from_env()
    engine = build_engine(settings.database_url)
    if args.create_schema:
        Base.metadata.create_all(engine)
    session_factory = build_session_factory(engine)
    with session_factory() as session:
        counts = seed_database(session, force=not args.if_empty)
    engine.dispose()
    print(
        json.dumps({"data_origin": "synthetic_demo", "record_counts": counts}, ensure_ascii=False)
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
