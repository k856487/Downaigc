"""add email verification codes

Revision ID: 20260427_03
Revises: 20260427_02
Create Date: 2026-04-27
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260427_03"
down_revision = "20260427_02"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "email_verification_codes",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("purpose", sa.String(length=30), nullable=False),
        sa.Column("code", sa.String(length=12), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_email_verification_codes_email", "email_verification_codes", ["email"], unique=False)
    op.create_index("ix_email_verification_codes_purpose", "email_verification_codes", ["purpose"], unique=False)
    op.create_index("ix_email_verification_codes_expires_at", "email_verification_codes", ["expires_at"], unique=False)
    op.create_index("ix_email_verification_codes_created_at", "email_verification_codes", ["created_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_email_verification_codes_created_at", table_name="email_verification_codes")
    op.drop_index("ix_email_verification_codes_expires_at", table_name="email_verification_codes")
    op.drop_index("ix_email_verification_codes_purpose", table_name="email_verification_codes")
    op.drop_index("ix_email_verification_codes_email", table_name="email_verification_codes")
    op.drop_table("email_verification_codes")

