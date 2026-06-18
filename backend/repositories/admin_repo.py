from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select, union
from sqlalchemy.orm import Session

from models.entities import AdWatchTicket, Feedback, PointState, Task, TaskParagraph, User, UserQuota
from admin_access import is_protected_admin_email

# 与 main.DEFAULT_WORD_QUOTA 一致：默认免费额度；高于此视为运营配置的 VIP 档位（人工调额）
_DEFAULT_FREE_WORDS_QUOTA = 120_000


def _user_segment(*, is_banned: bool, words_used: int, words_quota: int) -> str:
    """
    管理端用户分类（无独立会员表时，用封禁状态 + 用量/额度关系 + 字数额度档位近似 VIP 分层）。
    取值：banned | over_quota | vip_week | vip_month | vip_year | vip_lifetime | normal
    """
    if is_banned:
        return "banned"
    wu, q = int(words_used), int(words_quota)
    if wu > q:
        return "over_quota"
    if q > _DEFAULT_FREE_WORDS_QUOTA:
        if q >= 2_000_000:
            return "vip_lifetime"
        if q >= 800_000:
            return "vip_year"
        if q >= 400_000:
            return "vip_season"
        if q >= 200_000:
            return "vip_month"
        return "vip_week"
    return "normal"


def admin_overview_rows(db: Session) -> tuple[list[dict], dict]:
    users = list(db.scalars(select(User)))
    user_rows: list[dict] = []
    total_ad_views = (
        int(
            db.scalar(select(func.count(AdWatchTicket.id)).where(AdWatchTicket.status == "completed"))
            or 0
        )
    )
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
        ad_views = (
            int(
                db.scalar(
                    select(func.count(AdWatchTicket.id)).where(
                        AdWatchTicket.user_id == u.id,
                        AdWatchTicket.status == "completed",
                    )
                )
                or 0
            )
        )
        tasks_recent = (
            int(
                db.scalar(
                    select(func.count(Task.id)).where(
                        Task.user_id == u.id,
                        Task.created_at >= threshold,
                    )
                )
                or 0
            )
        )
        ads_recent = (
            int(
                db.scalar(
                    select(func.count(AdWatchTicket.id)).where(
                        AdWatchTicket.user_id == u.id,
                        AdWatchTicket.status == "completed",
                        AdWatchTicket.completed_at.is_not(None),
                        AdWatchTicket.completed_at >= threshold,
                    )
                )
                or 0
            )
        )
        monthly_active_user = tasks_recent > 0 or ads_recent > 0

        if monthly_active_user:
            monthly_active += 1
        total_words_quota += int(quota)
        used_words_quota += int(words_used)
        wu_i, q_i = int(words_used), int(quota)
        user_rows.append(
            {
                "id": u.id,
                "email": u.email,
                "nickname": u.nickname or "",
                "isBanned": bool(u.is_banned),
                "isAdmin": is_protected_admin_email(u.email),
                "adViews": ad_views,
                "points": int(points),
                "wordsQuota": q_i,
                "wordsUsed": wu_i,
                "remainingQuota": max(0, q_i - wu_i),
                "monthlyActive": monthly_active_user,
                "createdAt": u.created_at.isoformat() if u.created_at else "",
                "userSegment": _user_segment(is_banned=bool(u.is_banned), words_used=wu_i, words_quota=q_i),
            }
        )

    user_rows.sort(key=lambda x: (x["monthlyActive"], x["wordsUsed"]), reverse=True)

    open_feedback = int(db.scalar(select(func.count(Feedback.id)).where(Feedback.status == "open")) or 0)
    total_tasks = int(db.scalar(select(func.count(Task.id))) or 0)

    agg = {
        "userCount": len(users),
        "monthlyActiveUsers": monthly_active,
        "totalAdViews": total_ad_views,
        "totalWordsQuota": total_words_quota,
        "usedWordsQuota": used_words_quota,
        "openFeedbackCount": open_feedback,
        "totalTasksCount": total_tasks,
    }
    return user_rows, agg


def admin_daily_metrics(db: Session) -> list[dict]:
    now = datetime.now(timezone.utc)
    rows: list[dict] = []
    for back in range(29, -1, -1):
        day = now - timedelta(days=back)
        day_start = day.replace(hour=0, minute=0, second=0, microsecond=0)
        day_end = day_start + timedelta(days=1)

        task_users = select(Task.user_id).where(
            Task.created_at >= day_start,
            Task.created_at < day_end,
        ).distinct()
        ad_users = (
            select(AdWatchTicket.user_id)
            .where(
                AdWatchTicket.status == "completed",
                AdWatchTicket.completed_at.is_not(None),
                AdWatchTicket.completed_at >= day_start,
                AdWatchTicket.completed_at < day_end,
            )
            .distinct()
        )
        union_sub = union(task_users, ad_users).subquery()
        active_users = int(db.scalar(select(func.count()).select_from(union_sub)) or 0)

        ad_views = (
            int(
                db.scalar(
                    select(func.count(AdWatchTicket.id)).where(
                        AdWatchTicket.status == "completed",
                        AdWatchTicket.completed_at.is_not(None),
                        AdWatchTicket.completed_at >= day_start,
                        AdWatchTicket.completed_at < day_end,
                    )
                )
                or 0
            )
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
                "adViews": int(ad_views),
                "wordsUsed": int(day_words),
            }
        )
    return rows
