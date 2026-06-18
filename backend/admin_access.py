from __future__ import annotations

import os
from typing import Optional

# 与 main.DEFAULT_EMAIL 一致：本地默认种子管理员
DEFAULT_SEED_ADMIN_EMAIL = "kiter"


def admin_email_allowlist() -> Optional[set[str]]:
    """若设置 ADMIN_EMAILS，仅这些邮箱可访问 /api/admin/*；未设置则任意已登录用户可访问。"""
    raw = (os.getenv("ADMIN_EMAILS") or "").strip()
    if not raw:
        return None
    return {x.strip().lower() for x in raw.split(",") if x.strip()}


def protected_admin_emails() -> set[str]:
    """不可封禁、不可删除的管理员邮箱（小写）。"""
    protected = {DEFAULT_SEED_ADMIN_EMAIL.lower()}
    allow = admin_email_allowlist()
    if allow:
        protected |= allow
    return protected


def is_protected_admin_email(email: str) -> bool:
    return (email or "").strip().lower() in protected_admin_emails()
