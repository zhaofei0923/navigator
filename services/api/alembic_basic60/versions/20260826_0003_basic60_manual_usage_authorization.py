"""Store the one A1 manual usage authorization at release scope.

Revision ID: 20260826_b60003
Revises: 20260825_b60002
Create Date: 2026-08-26
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260826_b60003"
down_revision: str | None = "20260825_b60002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _require_empty_private_release() -> None:
    """Refuse to invent A1 evidence for an already imported immutable release."""

    connection = op.get_bind()
    release_count = connection.execute(
        sa.text("SELECT COUNT(*) FROM basic60_release_snapshots")
    ).scalar_one()
    if release_count:
        raise RuntimeError(
            "BASIC60 manual-authorization migration requires an empty private database; "
            "rebuild it from the new hash-bound seed artifact"
        )


def upgrade() -> None:
    _require_empty_private_release()
    # ``auto`` recreates tables only where the dialect needs it (notably SQLite).
    # PostgreSQL must use native ALTER TABLE here because both tables are already
    # referenced by downstream foreign keys; forcing a table replacement makes
    # PostgreSQL reject the DROP with DependentObjectsStillExist.
    with op.batch_alter_table("basic60_release_snapshots", recreate="auto") as batch_op:
        batch_op.add_column(sa.Column("manual_usage_authorization", sa.JSON(), nullable=False))
        batch_op.add_column(
            sa.Column("manual_usage_authorization_sha256", sa.String(length=64), nullable=False)
        )
        batch_op.create_check_constraint(
            "ck_basic60_manual_usage_authorization_sha256",
            "length(manual_usage_authorization_sha256) = 64",
        )

    with op.batch_alter_table("basic60_source_registry", recreate="auto") as batch_op:
        batch_op.drop_constraint("ck_basic60_source_no_ai", type_="check")
        batch_op.drop_constraint("ck_basic60_source_no_cloud", type_="check")
        batch_op.drop_column("license_scope")
        batch_op.drop_column("ai_processing")
        batch_op.drop_column("cloud_processing")


def downgrade() -> None:
    _require_empty_private_release()
    with op.batch_alter_table("basic60_source_registry", recreate="auto") as batch_op:
        batch_op.add_column(sa.Column("license_scope", sa.JSON(), nullable=False))
        batch_op.add_column(sa.Column("ai_processing", sa.String(length=32), nullable=False))
        batch_op.add_column(sa.Column("cloud_processing", sa.String(length=32), nullable=False))
        batch_op.create_check_constraint(
            "ck_basic60_source_no_ai",
            "ai_processing = 'prohibited_for_v1'",
        )
        batch_op.create_check_constraint(
            "ck_basic60_source_no_cloud",
            "cloud_processing = 'prohibited_for_v1'",
        )

    with op.batch_alter_table("basic60_release_snapshots", recreate="auto") as batch_op:
        batch_op.drop_constraint(
            "ck_basic60_manual_usage_authorization_sha256",
            type_="check",
        )
        batch_op.drop_column("manual_usage_authorization_sha256")
        batch_op.drop_column("manual_usage_authorization")
