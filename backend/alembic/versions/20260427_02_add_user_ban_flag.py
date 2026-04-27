"""add user ban flag

Revision ID: 20260427_02
Revises: 20260427_01
Create Date: 2026-04-27
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260427_02"
down_revision = "20260427_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("is_banned", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_index("ix_users_is_banned", "users", ["is_banned"], unique=False)
    op.alter_column("users", "is_banned", server_default=None)


def downgrade() -> None:
    op.drop_index("ix_users_is_banned", table_name="users")
    op.drop_column("users", "is_banned")

