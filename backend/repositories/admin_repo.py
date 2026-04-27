from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from models.entities import PointState, Task, TaskParagraph, User, UserQuota


def admin_overview_rows(db: Session) -> tuple[list[dict], dict]:
    users = list(db.scalars(select(User)))
    user_rows: list[dict] = []
    total_ad_views = 0
    total_words_quota = 0
    used_words_quota = 0
    monthly_active = 0

    now = datetime.now(timezone.utc)
    threshold = now - timedelta(days=30)

    for u in users:
        words_used = (
            db.scalar(
                select(func.coalesce(func.sum(TaskParagraph.word_count), 0))
                .join(Task, TaskParagraph.task_id == Task.id)
                .where(Task.user_id == u.id)
            )
            or 0
        )
        quota = (
            db.scalar(select(UserQuota.words_quota).where(UserQuota.user_id == u.id))
            or 120000
        )
        points = (
            db.scalar(select(PointState.points).where(PointState.user_id == u.id))
            or 0
        )
        ad_views = max(0, int(points) // 10)
        active_count = (
            db.scalar(select(func.count(Task.id)).where(Task.user_id == u.id, Task.created_at >= threshold))
            or 0
        )
        monthly_active_user = active_count > 0

        if monthly_active_user:
            monthly_active += 1
        total_ad_views += ad_views
        total_words_quota += int(quota)
        used_words_quota += int(words_used)
        user_rows.append(
            {
                "id": u.id,
                "email": u.email,
                "nickname": u.nickname or "",
                "isBanned": bool(u.is_banned),
                "adViews": ad_views,
                "wordsQuota": int(quota),
                "wordsUsed": int(words_used),
                "remainingQuota": max(0, int(quota) - int(words_used)),
                "monthlyActive": monthly_active_user,
            }
        )

    user_rows.sort(key=lambda x: (x["monthlyActive"], x["wordsUsed"]), reverse=True)
    agg = {
        "userCount": len(users),
        "monthlyActiveUsers": monthly_active,
        "totalAdViews": total_ad_views,
        "totalWordsQuota": total_words_quota,
        "usedWordsQuota": used_words_quota,
    }
    return user_rows, agg


def admin_daily_metrics(db: Session) -> list[dict]:
    now = datetime.now(timezone.utc)
    rows: list[dict] = []
    for back in range(29, -1, -1):
        day = now - timedelta(days=back)
        day_start = day.replace(hour=0, minute=0, second=0, microsecond=0)
        day_end = day_start + timedelta(days=1)

        active_users = (
            db.scalar(
                select(func.count(func.distinct(Task.user_id))).where(
                    Task.created_at >= day_start, Task.created_at < day_end
                )
            )
            or 0
        )
        day_words = (
            db.scalar(
                select(func.coalesce(func.sum(TaskParagraph.word_count), 0))
                .join(Task, TaskParagraph.task_id == Task.id)
                .where(Task.created_at >= day_start, Task.created_at < day_end)
            )
            or 0
        )
        rows.append(
            {
                "date": day_start.strftime("%Y-%m-%d"),
                "activeUsers": int(active_users),
                "adViews": int(active_users) * 2,
                "wordsUsed": int(day_words),
            }
        )
    return rows

