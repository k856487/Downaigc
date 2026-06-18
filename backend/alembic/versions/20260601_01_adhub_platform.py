"""adhub platform for scan-to-watch mini program

Revision ID: 20260601_01
Revises: 20260511_01
Create Date: 2026-06-01
"""

from alembic import op
import sqlalchemy as sa

revision = "20260601_01"
down_revision = "20260511_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "adhub_accounts",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("openid", sa.String(length=128), nullable=False),
        sa.Column("unionid", sa.String(length=128), nullable=True),
        sa.Column("nickname", sa.String(length=100), nullable=False),
        sa.Column("avatar_url", sa.String(length=512), nullable=False),
        sa.Column("is_publisher", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("is_advertiser", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("openid"),
    )
    op.create_index("ix_adhub_accounts_openid", "adhub_accounts", ["openid"], unique=True)
    op.create_index("ix_adhub_accounts_unionid", "adhub_accounts", ["unionid"], unique=False)
    op.create_index("ix_adhub_accounts_created_at", "adhub_accounts", ["created_at"], unique=False)

    op.create_table(
        "adhub_publisher_profiles",
        sa.Column("account_id", sa.String(length=36), nullable=False),
        sa.Column("real_name", sa.String(length=64), nullable=False),
        sa.Column("id_number_tail", sa.String(length=8), nullable=False),
        sa.Column("verify_status", sa.String(length=16), nullable=False),
        sa.Column("reputation_score", sa.Integer(), nullable=False, server_default="80"),
        sa.Column("fraud_flags", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("contact_phone", sa.String(length=32), nullable=False),
        sa.Column("contact_email", sa.String(length=128), nullable=False),
        sa.Column("website_url", sa.String(length=512), nullable=False),
        sa.Column("bio", sa.Text(), nullable=False),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["account_id"], ["adhub_accounts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("account_id"),
    )
    op.create_index(
        "ix_adhub_publisher_profiles_verify_status", "adhub_publisher_profiles", ["verify_status"], unique=False
    )

    op.create_table(
        "adhub_advertiser_profiles",
        sa.Column("account_id", sa.String(length=36), nullable=False),
        sa.Column("company_name", sa.String(length=128), nullable=False),
        sa.Column("contact_name", sa.String(length=64), nullable=False),
        sa.Column("contact_phone", sa.String(length=32), nullable=False),
        sa.Column("contact_email", sa.String(length=128), nullable=False),
        sa.Column("reputation_score", sa.Integer(), nullable=False, server_default="80"),
        sa.Column("bio", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["adhub_accounts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("account_id"),
    )

    op.create_table(
        "adhub_qr_slots",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("account_id", sa.String(length=36), nullable=False),
        sa.Column("code", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["adhub_accounts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("account_id"),
        sa.UniqueConstraint("code"),
    )
    op.create_index("ix_adhub_qr_slots_account_id", "adhub_qr_slots", ["account_id"], unique=True)
    op.create_index("ix_adhub_qr_slots_code", "adhub_qr_slots", ["code"], unique=True)

    op.create_table(
        "adhub_watch_events",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("qr_code", sa.String(length=32), nullable=False),
        sa.Column("publisher_account_id", sa.String(length=36), nullable=False),
        sa.Column("viewer_key", sa.String(length=128), nullable=False),
        sa.Column("ip_address", sa.String(length=64), nullable=False),
        sa.Column("duration_sec", sa.Integer(), nullable=False),
        sa.Column("completed", sa.Boolean(), nullable=False),
        sa.Column("suspicious", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["publisher_account_id"], ["adhub_accounts.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_adhub_watch_events_qr_code", "adhub_watch_events", ["qr_code"], unique=False)
    op.create_index(
        "ix_adhub_watch_events_publisher_account_id", "adhub_watch_events", ["publisher_account_id"], unique=False
    )
    op.create_index("ix_adhub_watch_events_viewer_key", "adhub_watch_events", ["viewer_key"], unique=False)
    op.create_index("ix_adhub_watch_events_completed", "adhub_watch_events", ["completed"], unique=False)
    op.create_index("ix_adhub_watch_events_suspicious", "adhub_watch_events", ["suspicious"], unique=False)
    op.create_index("ix_adhub_watch_events_created_at", "adhub_watch_events", ["created_at"], unique=False)

    op.create_table(
        "adhub_reputation_logs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("account_id", sa.String(length=36), nullable=False),
        sa.Column("delta", sa.Integer(), nullable=False),
        sa.Column("reason", sa.String(length=128), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["adhub_accounts.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_adhub_reputation_logs_account_id", "adhub_reputation_logs", ["account_id"], unique=False)
    op.create_index("ix_adhub_reputation_logs_created_at", "adhub_reputation_logs", ["created_at"], unique=False)

    op.create_table(
        "adhub_cooperation_intents",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("from_account_id", sa.String(length=36), nullable=False),
        sa.Column("to_account_id", sa.String(length=36), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["from_account_id"], ["adhub_accounts.id"]),
        sa.ForeignKeyConstraint(["to_account_id"], ["adhub_accounts.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("from_account_id", "to_account_id", name="uq_adhub_coop_pair"),
    )
    op.create_index(
        "ix_adhub_cooperation_intents_from_account_id", "adhub_cooperation_intents", ["from_account_id"], unique=False
    )
    op.create_index(
        "ix_adhub_cooperation_intents_to_account_id", "adhub_cooperation_intents", ["to_account_id"], unique=False
    )
    op.create_index("ix_adhub_cooperation_intents_status", "adhub_cooperation_intents", ["status"], unique=False)

    op.create_table(
        "adhub_chat_threads",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("account_a_id", sa.String(length=36), nullable=False),
        sa.Column("account_b_id", sa.String(length=36), nullable=False),
        sa.Column("last_message_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["account_a_id"], ["adhub_accounts.id"]),
        sa.ForeignKeyConstraint(["account_b_id"], ["adhub_accounts.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("account_a_id", "account_b_id", name="uq_adhub_chat_pair"),
    )
    op.create_index("ix_adhub_chat_threads_account_a_id", "adhub_chat_threads", ["account_a_id"], unique=False)
    op.create_index("ix_adhub_chat_threads_account_b_id", "adhub_chat_threads", ["account_b_id"], unique=False)

    op.create_table(
        "adhub_chat_messages",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("thread_id", sa.String(length=36), nullable=False),
        sa.Column("sender_id", sa.String(length=36), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["sender_id"], ["adhub_accounts.id"]),
        sa.ForeignKeyConstraint(["thread_id"], ["adhub_chat_threads.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_adhub_chat_messages_thread_id", "adhub_chat_messages", ["thread_id"], unique=False)
    op.create_index("ix_adhub_chat_messages_sender_id", "adhub_chat_messages", ["sender_id"], unique=False)
    op.create_index("ix_adhub_chat_messages_created_at", "adhub_chat_messages", ["created_at"], unique=False)


def downgrade() -> None:
    op.drop_table("adhub_chat_messages")
    op.drop_table("adhub_chat_threads")
    op.drop_table("adhub_cooperation_intents")
    op.drop_table("adhub_reputation_logs")
    op.drop_table("adhub_watch_events")
    op.drop_table("adhub_qr_slots")
    op.drop_table("adhub_advertiser_profiles")
    op.drop_table("adhub_publisher_profiles")
    op.drop_table("adhub_accounts")
