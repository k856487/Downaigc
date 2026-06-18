from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy.orm import Session

from models.entities import PointState
from pricing import (
    MEMBERSHIP_TIER_MONTHLY,
    MEMBERSHIP_TIER_NONE,
    MEMBERSHIP_TIER_PREMIUM,
    ad_daily_limit_for_tier,
    ad_reward_for_tier,
    effective_membership_tier,
    member_monthly_grant,
    membership_duration_days,
    signin_grant_for_tier,
)

VALID_MEMBERSHIP_TIERS = frozenset({MEMBERSHIP_TIER_NONE, MEMBERSHIP_TIER_MONTHLY, MEMBERSHIP_TIER_PREMIUM})


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _today_key(d: datetime | None = None) -> str:
    dt = d or _now()
    return dt.strftime("%Y-%m-%d")


def _month_key(d: datetime | None = None) -> str:
    dt = d or _now()
    return dt.strftime("%Y-%m")


def get_or_create_point_state(db: Session, user_id: str) -> PointState:
    ps = db.get(PointState, user_id)
    if ps:
        return ps
    ps = PointState(user_id=user_id)
    db.add(ps)
    db.flush()
    return ps


def refresh_ad_day(ps: PointState, today: str) -> None:
    if ps.last_ad_watch_date != today:
        ps.ad_watches_today = 0
        ps.last_ad_watch_date = today


def refresh_daily_free(ps: PointState, today: str) -> int:
    """每日签到：当日首次领取，按会员档位发放改写字数（写入永久字数）。"""
    if ps.last_daily_refresh_date == today:
        return 0
    tier = effective_membership_tier(ps.membership_tier, ps.membership_expires_at)
    grant = signin_grant_for_tier(tier)
    ps.points = int(ps.points or 0) + grant
    ps.last_daily_refresh_date = today
    return grant


def maybe_grant_member_monthly(ps: PointState, now: datetime | None = None) -> int:
    tier = effective_membership_tier(ps.membership_tier, ps.membership_expires_at)
    if tier not in (MEMBERSHIP_TIER_MONTHLY, MEMBERSHIP_TIER_PREMIUM):
        return 0
    month = _month_key(now)
    if ps.member_points_month == month:
        return 0
    grant = member_monthly_grant(tier)
    if grant <= 0:
        return 0
    ps.points = int(ps.points or 0) + grant
    ps.member_points_month = month
    return grant


def writable_words(ps: PointState) -> int:
    return int(ps.daily_free_points or 0) + int(ps.points or 0)


def ad_limit_for_state(ps: PointState) -> int | None:
    tier = effective_membership_tier(ps.membership_tier, ps.membership_expires_at)
    return ad_daily_limit_for_tier(tier)


def can_watch_ad(ps: PointState, today: str | None = None) -> tuple[bool, str, int | None]:
    today = today or _today_key()
    refresh_ad_day(ps, today)
    limit = ad_limit_for_state(ps)
    if limit is None:
        return True, "ok", None
    used = int(ps.ad_watches_today or 0)
    if used >= limit:
        return False, "daily_limit", limit
    return True, "ok", limit


def record_ad_watch(ps: PointState, today: str | None = None) -> None:
    today = today or _today_key()
    refresh_ad_day(ps, today)
    ps.ad_watches_today = int(ps.ad_watches_today or 0) + 1


def deduct_writable_words(
    ps: PointState, amount: int
) -> tuple[bool, dict[str, int]]:
    """
    优先扣 daily_free_points，再扣 points。
    返回 (ok, {fromDailyFree, fromPoints, remainingWritable})。
    """
    amount = max(0, int(amount))
    if amount == 0:
        return True, {"fromDailyFree": 0, "fromPoints": 0, "remainingWritable": writable_words(ps)}
    free = int(ps.daily_free_points or 0)
    paid = int(ps.points or 0)
    total = free + paid
    if amount > total:
        return False, {
            "fromDailyFree": 0,
            "fromPoints": 0,
            "remainingWritable": total,
        }
    from_free = min(amount, free)
    from_paid = amount - from_free
    ps.daily_free_points = free - from_free
    ps.points = paid - from_paid
    return True, {
        "fromDailyFree": from_free,
        "fromPoints": from_paid,
        "remainingWritable": writable_words(ps),
    }


def activate_membership_demo(
    db: Session, user_id: str, tier: str, *, trial_days: int | None = None
) -> tuple[PointState, int]:
    if tier not in (MEMBERSHIP_TIER_MONTHLY, MEMBERSHIP_TIER_PREMIUM):
        raise ValueError("invalid_tier")
    ps = get_or_create_point_state(db, user_id)
    ps.membership_tier = tier
    days = trial_days if trial_days is not None else membership_duration_days(tier)
    if days:
        ps.membership_expires_at = _now() + timedelta(days=days)
    else:
        ps.membership_expires_at = None
    granted = maybe_grant_member_monthly(ps)
    db.commit()
    db.refresh(ps)
    return ps, granted


def build_points_payload(ps: PointState, balance_yuan: float, today: str | None = None) -> dict[str, Any]:
    today = today or _today_key()
    refresh_ad_day(ps, today)
    tier = effective_membership_tier(ps.membership_tier, ps.membership_expires_at)
    limit = ad_limit_for_state(ps)
    signin_grant = signin_grant_for_tier(tier)
    ad_reward = ad_reward_for_tier(tier)
    return {
        "points": int(ps.points or 0),
        "dailyFreePoints": int(ps.daily_free_points or 0),
        "writableWords": writable_words(ps),
        "balanceYuan": balance_yuan,
        "membershipTier": tier,
        "adWatchesToday": int(ps.ad_watches_today or 0),
        "adDailyLimit": limit,
        "dailyFreeCap": signin_grant,
        "dailyFreeGrant": signin_grant,
        "adRewardGrant": ad_reward,
        "signInGrant": signin_grant,
        "signIn": {
            "lastDate": ps.last_daily_refresh_date,
            "streak": 0,
        },
    }


def prepare_point_state(db: Session, user_id: str, balance_yuan: float) -> dict[str, Any]:
    """访问改写字数接口时：刷新广告日计数、检查会员有效期，返回快照（不自动签到）。"""
    ps = get_or_create_point_state(db, user_id)
    today = _today_key()
    tier = effective_membership_tier(ps.membership_tier, ps.membership_expires_at)
    if tier != (ps.membership_tier or MEMBERSHIP_TIER_NONE):
        ps.membership_tier = tier
    refresh_ad_day(ps, today)
    db.commit()
    db.refresh(ps)
    return build_points_payload(ps, balance_yuan, today)
