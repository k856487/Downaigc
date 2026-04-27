from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
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


def update_feedback_status(db: Session, feedback_id: str, status: str) -> Feedback | None:
    row = db.get(Feedback, feedback_id)
    if not row:
        return None
    row.status = status
    row.updated_at = _now()
    db.commit()
    db.refresh(row)
    return row

