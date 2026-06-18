"""commercial v1: daily free pool, membership tier, ad daily limits

Revision ID: 20260602_01
Revises: 20260601_01
Create Date: 2026-06-02
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "20260602_01"
down_revision = "20260601_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)
    cols = {c["name"] for c in insp.get_columns("points")}

    if "daily_free_points" not in cols:
        op.add_column(
            "points",
            sa.Column("daily_free_points", sa.Integer(), server_default="0", nullable=False),
        )
    if "last_daily_refresh_date" not in cols:
        op.add_column("points", sa.Column("last_daily_refresh_date", sa.String(length=10), nullable=True))
    if "ad_watches_today" not in cols:
        op.add_column(
            "points",
            sa.Column("ad_watches_today", sa.Integer(), server_default="0", nullable=False),
        )
    if "last_ad_watch_date" not in cols:
        op.add_column("points", sa.Column("last_ad_watch_date", sa.String(length=10), nullable=True))
    if "membership_tier" not in cols:
        op.add_column(
            "points",
            sa.Column("membership_tier", sa.String(length=20), server_default="none", nullable=False),
        )
    if "membership_expires_at" not in cols:
        op.add_column("points", sa.Column("membership_expires_at", sa.DateTime(timezone=True), nullable=True))
    if "member_points_month" not in cols:
        op.add_column("points", sa.Column("member_points_month", sa.String(length=7), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)
    cols = {c["name"] for c in insp.get_columns("points")}
    for name in (
        "member_points_month",
        "membership_expires_at",
        "membership_tier",
        "last_ad_watch_date",
        "ad_watches_today",
        "last_daily_refresh_date",
        "daily_free_points",
    ):
        if name in cols:
            op.drop_column("points", name)
