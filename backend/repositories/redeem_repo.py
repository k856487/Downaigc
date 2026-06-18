from __future__ import annotations

import secrets
import string
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional, Tuple

from sqlalchemy import select, func
from sqlalchemy.orm import Session

from models.entities import PointState, RedeemCode, RedeemCodeUsage, User

_ALPHABET = "".join(c for c in (string.ascii_uppercase + string.digits) if c not in "0O1I")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _gen_code_str() -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(12))


def list_redeem_codes(db: Session, *, limit: int = 200) -> List[RedeemCode]:
    return list(
        db.scalars(select(RedeemCode).order_by(RedeemCode.created_at.desc()).limit(min(limit, 500)))
    )


def count_redeem_codes(db: Session) -> int:
    n = db.scalar(select(func.count(RedeemCode.id)))
    return int(n or 0)


def list_redeem_codes_paginated(db: Session, *, offset: int, limit: int) -> Tuple[List[RedeemCode], int]:
    """按创建时间倒序分页；返回 (当前页行, 总行数)。"""
    lim = max(1, min(int(limit), 100))
    off = max(0, int(offset))
    total = count_redeem_codes(db)
    rows = list(
        db.scalars(
            select(RedeemCode)
            .order_by(RedeemCode.created_at.desc())
            .offset(off)
            .limit(lim)
        )
    )
    return rows, total


def effective_redeem_status(row: RedeemCode) -> Literal["active", "disabled", "expired", "depleted"]:
    """与 try_redeem 规则一致：停用 > 过期 > 用尽 > 可用。"""
    if bool(row.disabled):
        return "disabled"
    now = _now()
    if row.expires_at is not None and now > row.expires_at:
        return "expired"
    if int(row.use_count or 0) >= int(row.max_uses or 0):
        return "depleted"
    return "active"


def _ensure_unique_code(db: Session) -> str:
    for _ in range(40):
        c = _gen_code_str()
        exists = db.scalar(select(func.count(RedeemCode.id)).where(RedeemCode.code == c))
        if not exists:
            return c
    raise RuntimeError("Could not allocate redeem code")


def create_redeem_codes_batch(
    db: Session,
    *,
    reward_kind: str,
    amount: int,
    scope: str,
    restrict_user_id: Optional[str],
    max_uses: int,
    expires_at: Optional[datetime],
    quantity: int,
) -> List[RedeemCode]:
    rows: List[RedeemCode] = []
    for _ in range(quantity):
        code = _ensure_unique_code(db)
        row = RedeemCode(
            code=code,
            reward_kind=reward_kind,
            amount=int(amount),
            scope=scope,
            restrict_user_id=restrict_user_id,
            max_uses=max(1, int(max_uses)),
            use_count=0,
            expires_at=expires_at,
            created_at=_now(),
            disabled=False,
        )
        db.add(row)
        rows.append(row)
    db.commit()
    for r in rows:
        db.refresh(r)
    return rows


def try_redeem(db: Session, *, user_id: str, code_raw: str) -> Tuple[bool, str, Dict[str, Any]]:
    raw = (code_raw or "").strip().upper()
    if len(raw) < 4:
        return False, "invalid_code", {}

    row = db.scalar(select(RedeemCode).where(RedeemCode.code == raw).with_for_update())
    if not row:
        return False, "invalid_code", {}

    if row.disabled:
        return False, "disabled", {}

    now = _now()
    if row.expires_at is not None and now > row.expires_at:
        return False, "expired", {}

    if int(row.use_count) >= int(row.max_uses):
        return False, "depleted", {}

    if row.scope == "single":
        if not row.restrict_user_id or row.restrict_user_id != user_id:
            return False, "not_eligible", {}

    used = db.scalar(
        select(func.count(RedeemCodeUsage.id)).where(
            RedeemCodeUsage.code_id == row.id,
            RedeemCodeUsage.user_id == user_id,
        )
    )
    if used and int(used) > 0:
        return False, "already_used", {}

    user = db.get(User, user_id)
    if not user:
        return False, "user_missing", {}

    if user.is_banned:
        return False, "banned", {}

    if row.reward_kind == "points":
        add = int(row.amount)
        if add <= 0:
            return False, "bad_code", {}
        ps = db.get(PointState, user_id)
        if not ps:
            ps = PointState(user_id=user_id, points=0, last_signin_date=None, streak=0)
            db.add(ps)
            db.flush()
        ps.points = int(ps.points or 0) + add
    elif row.reward_kind == "balance_yuan":
        add_cents = int(row.amount)
        if add_cents <= 0:
            return False, "bad_code", {}
        user.balance_cents = int(user.balance_cents or 0) + add_cents
    else:
        return False, "bad_code", {}

    db.add(
        RedeemCodeUsage(
            id=str(uuid.uuid4()),
            code_id=row.id,
            user_id=user_id,
            used_at=now,
        )
    )
    row.use_count = int(row.use_count or 0) + 1
    db.commit()

    ps2 = db.get(PointState, user_id)
    pts = int(ps2.points) if ps2 else 0
    u2 = db.get(User, user_id)
    bal = round(int(u2.balance_cents or 0) / 100.0, 2) if u2 else 0.0
    return True, "ok", {"points": pts, "balanceYuan": bal}
