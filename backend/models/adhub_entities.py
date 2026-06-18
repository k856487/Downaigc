from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


class AdHubAccount(Base):
    """扫码看广小程序独立账号（与论文润色 Web 用户分离）。"""

    __tablename__ = "adhub_accounts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    openid: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    unionid: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    nickname: Mapped[str] = mapped_column(String(100), default="")
    avatar_url: Mapped[str] = mapped_column(String(512), default="")
    is_publisher: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    is_advertiser: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now_utc, index=True)

    publisher: Mapped["AdHubPublisherProfile | None"] = relationship(
        back_populates="account", uselist=False, cascade="all, delete-orphan"
    )
    advertiser: Mapped["AdHubAdvertiserProfile | None"] = relationship(
        back_populates="account", uselist=False, cascade="all, delete-orphan"
    )
    qr_slot: Mapped["AdHubQrSlot | None"] = relationship(
        back_populates="account", uselist=False, cascade="all, delete-orphan"
    )


class AdHubPublisherProfile(Base):
    __tablename__ = "adhub_publisher_profiles"

    account_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("adhub_accounts.id", ondelete="CASCADE"), primary_key=True
    )
    real_name: Mapped[str] = mapped_column(String(64), default="")
    id_number_tail: Mapped[str] = mapped_column(String(8), default="")
    verify_status: Mapped[str] = mapped_column(String(16), default="none", index=True)
    reputation_score: Mapped[int] = mapped_column(Integer, default=80, server_default="80")
    fraud_flags: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    contact_phone: Mapped[str] = mapped_column(String(32), default="")
    contact_email: Mapped[str] = mapped_column(String(128), default="")
    website_url: Mapped[str] = mapped_column(String(512), default="")
    bio: Mapped[str] = mapped_column(Text, default="")
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    account: Mapped[AdHubAccount] = relationship(back_populates="publisher")


class AdHubAdvertiserProfile(Base):
    __tablename__ = "adhub_advertiser_profiles"

    account_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("adhub_accounts.id", ondelete="CASCADE"), primary_key=True
    )
    company_name: Mapped[str] = mapped_column(String(128), default="")
    contact_name: Mapped[str] = mapped_column(String(64), default="")
    contact_phone: Mapped[str] = mapped_column(String(32), default="")
    contact_email: Mapped[str] = mapped_column(String(128), default="")
    reputation_score: Mapped[int] = mapped_column(Integer, default=80, server_default="80")
    bio: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now_utc)

    account: Mapped[AdHubAccount] = relationship(back_populates="advertiser")


class AdHubQrSlot(Base):
    """实名认证通过后分配，一账号一码。"""

    __tablename__ = "adhub_qr_slots"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    account_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("adhub_accounts.id", ondelete="CASCADE"), unique=True, index=True
    )
    code: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now_utc)

    account: Mapped[AdHubAccount] = relationship(back_populates="qr_slot")


class AdHubWatchEvent(Base):
    __tablename__ = "adhub_watch_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    qr_code: Mapped[str] = mapped_column(String(32), index=True)
    publisher_account_id: Mapped[str] = mapped_column(String(36), ForeignKey("adhub_accounts.id"), index=True)
    viewer_key: Mapped[str] = mapped_column(String(128), default="", index=True)
    ip_address: Mapped[str] = mapped_column(String(64), default="")
    duration_sec: Mapped[int] = mapped_column(Integer, default=0)
    completed: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    suspicious: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now_utc, index=True)


class AdHubReputationLog(Base):
    __tablename__ = "adhub_reputation_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    account_id: Mapped[str] = mapped_column(String(36), ForeignKey("adhub_accounts.id"), index=True)
    delta: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(String(128), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now_utc, index=True)


class AdHubCooperationIntent(Base):
    __tablename__ = "adhub_cooperation_intents"
    __table_args__ = (UniqueConstraint("from_account_id", "to_account_id", name="uq_adhub_coop_pair"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    from_account_id: Mapped[str] = mapped_column(String(36), ForeignKey("adhub_accounts.id"), index=True)
    to_account_id: Mapped[str] = mapped_column(String(36), ForeignKey("adhub_accounts.id"), index=True)
    message: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now_utc)


class AdHubChatThread(Base):
    __tablename__ = "adhub_chat_threads"
    __table_args__ = (UniqueConstraint("account_a_id", "account_b_id", name="uq_adhub_chat_pair"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    account_a_id: Mapped[str] = mapped_column(String(36), ForeignKey("adhub_accounts.id"), index=True)
    account_b_id: Mapped[str] = mapped_column(String(36), ForeignKey("adhub_accounts.id"), index=True)
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now_utc)

    messages: Mapped[list["AdHubChatMessage"]] = relationship(
        back_populates="thread", cascade="all, delete-orphan"
    )


class AdHubChatMessage(Base):
    __tablename__ = "adhub_chat_messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    thread_id: Mapped[str] = mapped_column(String(36), ForeignKey("adhub_chat_threads.id"), index=True)
    sender_id: Mapped[str] = mapped_column(String(36), ForeignKey("adhub_accounts.id"), index=True)
    content: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now_utc, index=True)

    thread: Mapped[AdHubChatThread] = relationship(back_populates="messages")
