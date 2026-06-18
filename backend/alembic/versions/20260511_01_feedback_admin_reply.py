"""feedbacks.admin_reply for admin processing notes

Revision ID: 20260511_01
Revises: 20260508_01
Create Date: 2026-05-11
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "20260511_01"
down_revision = "20260508_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)
    cols = {c["name"] for c in insp.get_columns("feedbacks")}
    if "admin_reply" not in cols:
        op.add_column(
            "feedbacks",
            sa.Column("admin_reply", sa.Text(), nullable=True),
        )


def downgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)
    cols = {c["name"] for c in insp.get_columns("feedbacks")}
    if "admin_reply" in cols:
        op.drop_column("feedbacks", "admin_reply")
