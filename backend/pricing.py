"""
定价与商业化常量（V3.0，与 frontend config/pricing.ts 对齐）。

五层变现：免费体验、激励广告、首充礼包、字数包、效率会员。
1 字 = 改写 1 个汉字；按实际输出汉字数扣费。
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

BENCHMARK_WORDS = 7166
BENCHMARK_YUAN = 0.07
YUAN_PER_WORD = BENCHMARK_YUAN / BENCHMARK_WORDS

REGISTRATION_BONUS = 5888

MEMBERSHIP_TIER_NONE = "none"
MEMBERSHIP_TIER_MONTHLY = "monthly"
MEMBERSHIP_TIER_PREMIUM = "premium"

SIGNIN_GRANT: dict[str, int] = {
    MEMBERSHIP_TIER_NONE: 888,
    MEMBERSHIP_TIER_MONTHLY: 2888,
    MEMBERSHIP_TIER_PREMIUM: 3888,
}

AD_REWARD: dict[str, int] = {
    MEMBERSHIP_TIER_NONE: 2888,
    MEMBERSHIP_TIER_MONTHLY: 3888,
    MEMBERSHIP_TIER_PREMIUM: 5888,
}

MEMBER_AD_DAILY_LIMIT: dict[str, int] = {
    MEMBERSHIP_TIER_NONE: 10,
    MEMBERSHIP_TIER_MONTHLY: 20,
    MEMBERSHIP_TIER_PREMIUM: 30,
}

MEMBER_RETAIL_YUAN: dict[str, float] = {
    MEMBERSHIP_TIER_MONTHLY: 19.9,
    MEMBERSHIP_TIER_PREMIUM: 39.9,
}

# V3 会员不再按月赠送固定字数池
MEMBER_MONTHLY_POINTS: dict[str, int] = {
    MEMBERSHIP_TIER_MONTHLY: 0,
    MEMBERSHIP_TIER_PREMIUM: 0,
}

FIRST_RECHARGE_WORD_PACK = {"yuan": 2.99, "points": 18_888, "label": "首充礼包"}
FIRST_RECHARGE_MEMBER_DAYS = 7

RECHARGE_PACKAGES: list[dict[str, float | int | str | bool]] = [
    {"yuan": 6.99, "points": 38_888, "label": "体验包", "hook": "适合课程作业"},
    {"yuan": 19.9, "points": 128_888, "label": "入门包", "hook": "适合课程论文"},
    {"yuan": 39.9, "points": 388_888, "label": "热门包", "recommended": True, "hook": "适合毕业论文"},
    {"yuan": 99.0, "points": 1_288_888, "label": "专业包", "hook": "适合长期使用"},
]

# 兼容旧 env / 接口字段名
DAILY_FREE_GRANT = SIGNIN_GRANT[MEMBERSHIP_TIER_NONE]
DAILY_FREE_CAP = SIGNIN_GRANT[MEMBERSHIP_TIER_NONE]


def _normalize_tier(tier: str | None) -> str:
    t = (tier or MEMBERSHIP_TIER_NONE).strip()
    if t in (MEMBERSHIP_TIER_MONTHLY, MEMBERSHIP_TIER_PREMIUM):
        return t
    return MEMBERSHIP_TIER_NONE


def effective_membership_tier(tier: str | None, expires_at: datetime | None) -> str:
    t = _normalize_tier(tier)
    if t == MEMBERSHIP_TIER_NONE:
        return MEMBERSHIP_TIER_NONE
    if expires_at is not None and expires_at <= datetime.now(timezone.utc):
        return MEMBERSHIP_TIER_NONE
    return t


def signin_grant_for_tier(tier: str | None) -> int:
    return SIGNIN_GRANT.get(_normalize_tier(tier), SIGNIN_GRANT[MEMBERSHIP_TIER_NONE])


def ad_reward_for_tier(tier: str | None) -> int:
    env = (os.getenv("AD_WATCH_REWARD_POINTS") or "").strip()
    if env:
        return int(env)
    return AD_REWARD.get(_normalize_tier(tier), AD_REWARD[MEMBERSHIP_TIER_NONE])


def ad_daily_limit_for_tier(tier: str) -> int | None:
    return MEMBER_AD_DAILY_LIMIT.get(_normalize_tier(tier), MEMBER_AD_DAILY_LIMIT[MEMBERSHIP_TIER_NONE])


def member_monthly_grant(tier: str) -> int:
    return MEMBER_MONTHLY_POINTS.get(_normalize_tier(tier), 0)


def ad_watch_reward_points() -> int:
    """默认普通用户广告奖励（创建票据前应按用户 tier 覆盖）。"""
    return ad_reward_for_tier(MEMBERSHIP_TIER_NONE)


def points_per_yuan() -> int:
    return int((os.getenv("POINTS_PER_YUAN") or "3000").strip() or "3000")


def membership_duration_days(tier: str, *, trial: bool = False) -> int | None:
    if trial:
        return FIRST_RECHARGE_MEMBER_DAYS
    if tier in (MEMBERSHIP_TIER_MONTHLY, MEMBERSHIP_TIER_PREMIUM):
        return 30
    return None
