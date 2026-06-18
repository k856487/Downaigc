from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional, Tuple

from sqlalchemy.orm import Session

from models.entities import AdWatchTicket, PointState
from repositories import points_repo


def _now() -> datetime:
    return datetime.now(timezone.utc)


def get_ticket(db: Session, ticket_id: str) -> AdWatchTicket | None:
    return db.get(AdWatchTicket, ticket_id)


def create_ticket(
    db: Session,
    *,
    user_id: str,
    ticket_id: str,
    reward_points: int,
    expires_at: datetime,
) -> Tuple[AdWatchTicket | None, str]:
    ps = points_repo.get_or_create_point_state(db, user_id)
    today = points_repo._today_key()
    ok, reason, _ = points_repo.can_watch_ad(ps, today)
    if not ok:
        db.rollback()
        return None, reason

    row = AdWatchTicket(
        id=ticket_id,
        user_id=user_id,
        status="pending",
        reward_points=reward_points,
        created_at=_now(),
        expires_at=expires_at,
        completed_at=None,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row, "ok"


def mark_ticket_expired_if_needed(db: Session, row: AdWatchTicket) -> AdWatchTicket:
    if row.status != "pending":
        return row
    if _now() > row.expires_at:
        row.status = "expired"
        db.commit()
        db.refresh(row)
    return row


def complete_ticket_and_credit_points(
    db: Session,
    *,
    ticket_id: str,
) -> Tuple[bool, str, Optional[int]]:
    """
    幂等完成：仅 pending 且未过期时加分并置 completed。
    返回 (ok, reason, new_writable_words_total)。
    """
    row = db.get(AdWatchTicket, ticket_id)
    if not row:
        return False, "not_found", None
    user_id = row.user_id
    now = _now()
    if row.status == "completed":
        ps = db.get(PointState, user_id)
        total = points_repo.writable_words(ps) if ps else 0
        return True, "already_completed", total
    if now > row.expires_at:
        if row.status == "pending":
            row.status = "expired"
            db.commit()
        return False, "expired", None
    if row.status != "pending":
        return False, row.status, None

    ps = points_repo.get_or_create_point_state(db, user_id)
    today = points_repo._today_key()
    ok, reason, _ = points_repo.can_watch_ad(ps, today)
    if not ok:
        return False, reason, None

    add = int(row.reward_points or 0)
    ps.points = int(ps.points or 0) + add
    points_repo.record_ad_watch(ps, today)
    row.status = "completed"
    row.completed_at = now
    db.commit()
    db.refresh(ps)
    return True, "ok", points_repo.writable_words(ps)
