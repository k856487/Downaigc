"""redeem codes + user balance_cents

Revision ID: 20260508_01
Revises: 20260209_01
Create Date: 2026-05-08
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "20260508_01"
down_revision = "20260209_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)

    user_cols = {c["name"] for c in insp.get_columns("users")}
    if "balance_cents" not in user_cols:
        op.add_column(
            "users",
            sa.Column("balance_cents", sa.Integer(), server_default="0", nullable=False),
        )

    if not insp.has_table("redeem_codes"):
        op.create_table(
            "redeem_codes",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("code", sa.String(length=32), nullable=False),
            sa.Column("reward_kind", sa.String(length=20), nullable=False),
            sa.Column("amount", sa.Integer(), nullable=False),
            sa.Column("scope", sa.String(length=20), nullable=False),
            sa.Column("restrict_user_id", sa.String(length=36), nullable=True),
            sa.Column("max_uses", sa.Integer(), nullable=False),
            sa.Column("use_count", sa.Integer(), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("disabled", sa.Boolean(), nullable=False),
            sa.ForeignKeyConstraint(["restrict_user_id"], ["users.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_redeem_codes_code", "redeem_codes", ["code"], unique=True)
        op.create_index("ix_redeem_codes_reward_kind", "redeem_codes", ["reward_kind"], unique=False)
        op.create_index("ix_redeem_codes_scope", "redeem_codes", ["scope"], unique=False)
        op.create_index("ix_redeem_codes_expires_at", "redeem_codes", ["expires_at"], unique=False)
        op.create_index("ix_redeem_codes_created_at", "redeem_codes", ["created_at"], unique=False)
        op.create_index("ix_redeem_codes_disabled", "redeem_codes", ["disabled"], unique=False)

    if not insp.has_table("redeem_code_usages"):
        op.create_table(
            "redeem_code_usages",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("code_id", sa.String(length=36), nullable=False),
            sa.Column("user_id", sa.String(length=36), nullable=False),
            sa.Column("used_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["code_id"], ["redeem_codes.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("code_id", "user_id", name="uq_redeem_code_user"),
        )
        op.create_index("ix_redeem_code_usages_code_id", "redeem_code_usages", ["code_id"], unique=False)
        op.create_index("ix_redeem_code_usages_user_id", "redeem_code_usages", ["user_id"], unique=False)
        op.create_index("ix_redeem_code_usages_used_at", "redeem_code_usages", ["used_at"], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)

    if insp.has_table("redeem_code_usages"):
        for ix in ("ix_redeem_code_usages_used_at", "ix_redeem_code_usages_user_id", "ix_redeem_code_usages_code_id"):
            if insp.has_index("redeem_code_usages", ix):
                op.drop_index(ix, table_name="redeem_code_usages")
        op.drop_table("redeem_code_usages")

    if insp.has_table("redeem_codes"):
        for ix in (
            "ix_redeem_codes_disabled",
            "ix_redeem_codes_created_at",
            "ix_redeem_codes_expires_at",
            "ix_redeem_codes_scope",
            "ix_redeem_codes_reward_kind",
            "ix_redeem_codes_code",
        ):
            if insp.has_index("redeem_codes", ix):
                op.drop_index(ix, table_name="redeem_codes")
        op.drop_table("redeem_codes")

    user_cols = {c["name"] for c in insp.get_columns("users")}
    if "balance_cents" in user_cols:
        op.drop_column("users", "balance_cents")
