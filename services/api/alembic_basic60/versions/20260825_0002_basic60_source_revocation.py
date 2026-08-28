"""Allow retained BASIC60 sources to be marked revoked.

Revision ID: 20260825_b60002
Revises: 20260825_b60001
Create Date: 2026-08-25
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260825_b60002"
down_revision: str | None = "20260825_b60001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("basic60_source_registry") as batch_op:
        batch_op.drop_constraint("ck_basic60_source_active", type_="check")
        batch_op.create_check_constraint(
            "ck_basic60_source_status",
            "status IN ('active', 'revoked')",
        )


def downgrade() -> None:
    # Downgrade is deliberately fail-closed when revoked rows still exist: the
    # restored constraint cannot accept them until an operator reactivates or
    # migrates those retained rows explicitly.
    with op.batch_alter_table("basic60_source_registry") as batch_op:
        batch_op.drop_constraint("ck_basic60_source_status", type_="check")
        batch_op.create_check_constraint(
            "ck_basic60_source_active",
            "status = 'active'",
        )
