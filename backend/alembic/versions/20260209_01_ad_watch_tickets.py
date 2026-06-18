"""ad watch tickets for wechat scan ad flow

Revision ID: 20260209_01
Revises: 20260427_03
Create Date: 2026-02-09
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "20260209_01"
down_revision = "20260427_03"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ad_watch_tickets",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("reward_points", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ad_watch_tickets_user_id", "ad_watch_tickets", ["user_id"], unique=False)
    op.create_index("ix_ad_watch_tickets_status", "ad_watch_tickets", ["status"], unique=False)
    op.create_index("ix_ad_watch_tickets_created_at", "ad_watch_tickets", ["created_at"], unique=False)
    op.create_index("ix_ad_watch_tickets_expires_at", "ad_watch_tickets", ["expires_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_ad_watch_tickets_expires_at", table_name="ad_watch_tickets")
    op.drop_index("ix_ad_watch_tickets_created_at", table_name="ad_watch_tickets")
    op.drop_index("ix_ad_watch_tickets_status", table_name="ad_watch_tickets")
    op.drop_index("ix_ad_watch_tickets_user_id", table_name="ad_watch_tickets")
    op.drop_table("ad_watch_tickets")
