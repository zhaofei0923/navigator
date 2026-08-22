"""Create the bounded synthetic-demo schema.

Revision ID: 20260822_0001
Revises: None
Create Date: 2026-08-22
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260822_0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _origin_column() -> sa.Column[str]:
    return sa.Column(
        "data_origin",
        sa.String(length=32),
        nullable=False,
        server_default="synthetic_demo",
    )


def upgrade() -> None:
    op.create_table(
        "countries",
        sa.Column("code", sa.String(length=3), nullable=False),
        sa.Column("name_zh", sa.String(length=80), nullable=False),
        sa.Column("name_en", sa.String(length=80), nullable=False),
        sa.Column("region", sa.String(length=80), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("readiness_score", sa.Integer(), nullable=False),
        sa.Column("opportunity_score", sa.Integer(), nullable=False),
        sa.Column("risk_score", sa.Integer(), nullable=False),
        sa.Column("market_attractiveness", sa.Integer(), nullable=False),
        sa.Column("policy_certainty", sa.Integer(), nullable=False),
        sa.Column("project_activity", sa.Integer(), nullable=False),
        sa.Column("partner_maturity", sa.Integer(), nullable=False),
        sa.Column("risk_controllability", sa.Integer(), nullable=False),
        sa.Column("dimension_deltas", sa.JSON(), nullable=False),
        _origin_column(),
        sa.CheckConstraint(
            "market_attractiveness BETWEEN 0 AND 100", name="ck_country_market_attractiveness"
        ),
        sa.CheckConstraint("opportunity_score BETWEEN 0 AND 100", name="ck_country_opportunity"),
        sa.CheckConstraint(
            "partner_maturity BETWEEN 0 AND 100", name="ck_country_partner_maturity"
        ),
        sa.CheckConstraint(
            "policy_certainty BETWEEN 0 AND 100", name="ck_country_policy_certainty"
        ),
        sa.CheckConstraint(
            "project_activity BETWEEN 0 AND 100", name="ck_country_project_activity"
        ),
        sa.CheckConstraint("readiness_score BETWEEN 0 AND 100", name="ck_country_readiness"),
        sa.CheckConstraint("risk_score BETWEEN 0 AND 100", name="ck_country_risk"),
        sa.CheckConstraint(
            "risk_controllability BETWEEN 0 AND 100", name="ck_country_risk_controllability"
        ),
        sa.CheckConstraint("data_origin = 'synthetic_demo'", name="ck_countries_synthetic_origin"),
        sa.PrimaryKeyConstraint("code"),
    )

    op.create_table(
        "country_actions",
        sa.Column("action_id", sa.String(length=32), nullable=False),
        sa.Column("country_code", sa.String(length=3), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("detail", sa.Text(), nullable=False),
        sa.Column("owner_hint", sa.String(length=80), nullable=False),
        _origin_column(),
        sa.CheckConstraint("data_origin = 'synthetic_demo'", name="ck_actions_synthetic_origin"),
        sa.ForeignKeyConstraint(["country_code"], ["countries.code"]),
        sa.PrimaryKeyConstraint("action_id"),
    )
    op.create_index("ix_country_actions_country_code", "country_actions", ["country_code"])

    op.create_table(
        "country_reasons",
        sa.Column("reason_id", sa.String(length=32), nullable=False),
        sa.Column("country_code", sa.String(length=3), nullable=False),
        sa.Column("kind", sa.String(length=24), nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("detail", sa.Text(), nullable=False),
        sa.Column("rank", sa.Integer(), nullable=False),
        _origin_column(),
        sa.CheckConstraint("data_origin = 'synthetic_demo'", name="ck_reasons_synthetic_origin"),
        sa.ForeignKeyConstraint(["country_code"], ["countries.code"]),
        sa.PrimaryKeyConstraint("reason_id"),
    )
    op.create_index("ix_country_reasons_country_code", "country_reasons", ["country_code"])

    op.create_table(
        "country_signals",
        sa.Column("signal_id", sa.String(length=32), nullable=False),
        sa.Column("country_code", sa.String(length=3), nullable=False),
        sa.Column("category", sa.String(length=40), nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("value", sa.Float(), nullable=False),
        sa.Column("unit", sa.String(length=40), nullable=False),
        sa.Column("trend", sa.String(length=20), nullable=False),
        sa.Column("confidence", sa.Integer(), nullable=False),
        sa.Column("occurred_at", sa.Date(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        _origin_column(),
        sa.CheckConstraint("confidence BETWEEN 0 AND 100", name="ck_signal_confidence"),
        sa.CheckConstraint("data_origin = 'synthetic_demo'", name="ck_signals_synthetic_origin"),
        sa.ForeignKeyConstraint(["country_code"], ["countries.code"]),
        sa.PrimaryKeyConstraint("signal_id"),
    )
    op.create_index("ix_country_signals_country_code", "country_signals", ["country_code"])

    op.create_table(
        "opportunities",
        sa.Column("opportunity_id", sa.String(length=32), nullable=False),
        sa.Column("country_code", sa.String(length=3), nullable=False),
        sa.Column("title", sa.String(length=180), nullable=False),
        sa.Column("category", sa.String(length=40), nullable=False),
        sa.Column("score", sa.Integer(), nullable=False),
        sa.Column("detail", sa.Text(), nullable=False),
        sa.Column("next_step", sa.Text(), nullable=False),
        _origin_column(),
        sa.CheckConstraint(
            "data_origin = 'synthetic_demo'", name="ck_opportunities_synthetic_origin"
        ),
        sa.CheckConstraint("score BETWEEN 0 AND 100", name="ck_opportunity_score"),
        sa.ForeignKeyConstraint(["country_code"], ["countries.code"]),
        sa.PrimaryKeyConstraint("opportunity_id"),
    )
    op.create_index("ix_opportunities_country_code", "opportunities", ["country_code"])

    op.create_table(
        "partners",
        sa.Column("partner_id", sa.String(length=32), nullable=False),
        sa.Column("country_code", sa.String(length=3), nullable=False),
        sa.Column("name", sa.String(length=180), nullable=False),
        sa.Column("partner_type", sa.String(length=60), nullable=False),
        sa.Column("capabilities", sa.JSON(), nullable=False),
        sa.Column("fit_score", sa.Integer(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        _origin_column(),
        sa.CheckConstraint("data_origin = 'synthetic_demo'", name="ck_partners_synthetic_origin"),
        sa.CheckConstraint("fit_score BETWEEN 0 AND 100", name="ck_partner_fit"),
        sa.ForeignKeyConstraint(["country_code"], ["countries.code"]),
        sa.PrimaryKeyConstraint("partner_id"),
    )
    op.create_index("ix_partners_country_code", "partners", ["country_code"])

    op.create_table(
        "policies",
        sa.Column("policy_id", sa.String(length=32), nullable=False),
        sa.Column("country_code", sa.String(length=3), nullable=False),
        sa.Column("title", sa.String(length=180), nullable=False),
        sa.Column("category", sa.String(length=40), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("published_at", sa.Date(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        _origin_column(),
        sa.CheckConstraint("data_origin = 'synthetic_demo'", name="ck_policies_synthetic_origin"),
        sa.ForeignKeyConstraint(["country_code"], ["countries.code"]),
        sa.PrimaryKeyConstraint("policy_id"),
    )
    op.create_index("ix_policies_country_code", "policies", ["country_code"])

    op.create_table(
        "risks",
        sa.Column("risk_id", sa.String(length=32), nullable=False),
        sa.Column("country_code", sa.String(length=3), nullable=False),
        sa.Column("title", sa.String(length=180), nullable=False),
        sa.Column("category", sa.String(length=40), nullable=False),
        sa.Column("severity", sa.Integer(), nullable=False),
        sa.Column("likelihood", sa.Integer(), nullable=False),
        sa.Column("detail", sa.Text(), nullable=False),
        sa.Column("mitigation", sa.Text(), nullable=False),
        _origin_column(),
        sa.CheckConstraint("data_origin = 'synthetic_demo'", name="ck_risks_synthetic_origin"),
        sa.CheckConstraint("likelihood BETWEEN 1 AND 5", name="ck_risk_likelihood"),
        sa.CheckConstraint("severity BETWEEN 1 AND 5", name="ck_risk_severity"),
        sa.ForeignKeyConstraint(["country_code"], ["countries.code"]),
        sa.PrimaryKeyConstraint("risk_id"),
    )
    op.create_index("ix_risks_country_code", "risks", ["country_code"])

    op.create_table(
        "tenders",
        sa.Column("tender_id", sa.String(length=32), nullable=False),
        sa.Column("country_code", sa.String(length=3), nullable=False),
        sa.Column("title", sa.String(length=180), nullable=False),
        sa.Column("sector", sa.String(length=60), nullable=False),
        sa.Column("stage", sa.String(length=40), nullable=False),
        sa.Column("budget_min_million", sa.Float(), nullable=False),
        sa.Column("budget_max_million", sa.Float(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("deadline", sa.Date(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        _origin_column(),
        sa.CheckConstraint("budget_min_million >= 0", name="ck_tender_budget_min"),
        sa.CheckConstraint(
            "budget_max_million >= budget_min_million", name="ck_tender_budget_order"
        ),
        sa.CheckConstraint("data_origin = 'synthetic_demo'", name="ck_tenders_synthetic_origin"),
        sa.ForeignKeyConstraint(["country_code"], ["countries.code"]),
        sa.PrimaryKeyConstraint("tender_id"),
    )
    op.create_index("ix_tenders_country_code", "tenders", ["country_code"])


def downgrade() -> None:
    op.drop_index("ix_tenders_country_code", table_name="tenders")
    op.drop_table("tenders")
    op.drop_index("ix_risks_country_code", table_name="risks")
    op.drop_table("risks")
    op.drop_index("ix_policies_country_code", table_name="policies")
    op.drop_table("policies")
    op.drop_index("ix_partners_country_code", table_name="partners")
    op.drop_table("partners")
    op.drop_index("ix_opportunities_country_code", table_name="opportunities")
    op.drop_table("opportunities")
    op.drop_index("ix_country_signals_country_code", table_name="country_signals")
    op.drop_table("country_signals")
    op.drop_index("ix_country_reasons_country_code", table_name="country_reasons")
    op.drop_table("country_reasons")
    op.drop_index("ix_country_actions_country_code", table_name="country_actions")
    op.drop_table("country_actions")
    op.drop_table("countries")
