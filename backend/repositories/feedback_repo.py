from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from models.entities import Feedback


def _now():
    return datetime.now(timezone.utc)


def create_feedback(
    db: Session,
    *,
    user_id: str,
    category: str,
    content: str,
    contact: str | None,
) -> Feedback:
    row = Feedback(
        user_id=user_id,
        category=category,
        content=content,
        contact=contact,
        status="open",
        created_at=_now(),
        updated_at=_now(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def list_feedback_by_user(db: Session, user_id: str) -> list[Feedback]:
    return list(db.scalars(select(Feedback).where(Feedback.user_id == user_id).order_by(Feedback.created_at.desc())))


def list_feedback_all(db: Session) -> list[Feedback]:
    return list(db.scalars(select(Feedback).order_by(Feedback.created_at.desc())))


def get_feedback(db: Session, feedback_id: str) -> Feedback | None:
    return db.get(Feedback, feedback_id)


def count_feedback_by_status(db: Session, *, status: str) -> int:
    return int(db.scalar(select(func.count(Feedback.id)).where(Feedback.status == status)) or 0)


def count_user_feedback_pending(db: Session, user_id: str) -> int:
    """当前用户未办结反馈：待处理 + 处理中。"""
    return int(
        db.scalar(
            select(func.count(Feedback.id)).where(
                Feedback.user_id == user_id,
                Feedback.status.in_(("open", "processing")),
            )
        )
        or 0
    )


def update_feedback_status(db: Session, feedback_id: str, status: str) -> Feedback | None:
    row = db.get(Feedback, feedback_id)
    if not row:
        return None
    row.status = status
    row.updated_at = _now()
    db.commit()
    db.refresh(row)
    return row


def patch_feedback_admin(
    db: Session,
    feedback_id: str,
    *,
    status: str | None = None,
    update_status: bool = False,
    admin_reply: str | None = None,
    update_admin_reply: bool = False,
) -> Feedback | None:
    row = db.get(Feedback, feedback_id)
    if not row:
        return None
    if update_status and status is not None:
        row.status = status
    if update_admin_reply:
        row.admin_reply = admin_reply
    row.updated_at = _now()
    db.commit()
    db.refresh(row)
    return row

