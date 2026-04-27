from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import List

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    nickname: Mapped[str] = mapped_column(String(100), default="")
    is_banned: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, index=True)

    points: Mapped["PointState"] = relationship(back_populates="user", uselist=False, cascade="all, delete-orphan")
    quota: Mapped["UserQuota"] = relationship(back_populates="user", uselist=False, cascade="all, delete-orphan")
    tasks: Mapped[List["Task"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    feedbacks: Mapped[List["Feedback"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class PointState(Base):
    __tablename__ = "points"

    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    points: Mapped[int] = mapped_column(Integer, default=0)
    last_signin_date: Mapped[str | None] = mapped_column(String(10), nullable=True)
    streak: Mapped[int] = mapped_column(Integer, default=0)

    user: Mapped[User] = relationship(back_populates="points")


class UserQuota(Base):
    __tablename__ = "user_quotas"

    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    words_quota: Mapped[int] = mapped_column(Integer, default=120000)

    user: Mapped[User] = relationship(back_populates="quota")


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    mode: Mapped[str] = mapped_column(String(20), index=True)
    status: Mapped[str] = mapped_column(String(20), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, index=True)
    title: Mapped[str] = mapped_column(String(255), default="未命名文稿")

    user: Mapped[User] = relationship(back_populates="tasks")
    paragraphs: Mapped[List["TaskParagraph"]] = relationship(
        back_populates="task", cascade="all, delete-orphan", order_by="TaskParagraph.idx"
    )


class TaskParagraph(Base):
    __tablename__ = "task_paragraphs"
    __table_args__ = (UniqueConstraint("task_id", "idx", name="uq_task_paragraph_idx"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[str] = mapped_column(String(36), ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    idx: Mapped[int] = mapped_column(Integer)
    word_count: Mapped[int] = mapped_column(Integer, default=0)
    original: Mapped[str] = mapped_column(Text)
    polished: Mapped[str] = mapped_column(Text, default="")
    model_used: Mapped[str | None] = mapped_column(String(255), nullable=True)

    task: Mapped[Task] = relationship(back_populates="paragraphs")


class Feedback(Base):
    __tablename__ = "feedbacks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    category: Mapped[str] = mapped_column(String(30), index=True)
    content: Mapped[str] = mapped_column(Text)
    contact: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="open", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, index=True)

    user: Mapped[User] = relationship(back_populates="feedbacks")


class EmailVerificationCode(Base):
    __tablename__ = "email_verification_codes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(255), index=True)
    purpose: Mapped[str] = mapped_column(String(30), index=True, default="register")
    code: Mapped[str] = mapped_column(String(12))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, index=True)

