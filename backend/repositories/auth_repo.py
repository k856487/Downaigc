from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from models.entities import PointState, User, UserQuota
from pricing import REGISTRATION_BONUS
from admin_access import is_protected_admin_email, protected_admin_emails


def get_user_by_email(db: Session, email: str) -> User | None:
    return db.scalar(select(User).where(User.email == email))


def get_user_by_id(db: Session, user_id: str) -> User | None:
    return db.get(User, user_id)


def list_users(db: Session) -> list[User]:
    return list(db.scalars(select(User).order_by(User.created_at.desc())))


def create_user(db: Session, *, email: str, password_hash: str, nickname: str, default_quota: int) -> User:
    user = User(
        email=email,
        password_hash=password_hash,
        nickname=nickname or "",
        is_banned=False,
    )
    db.add(user)
    db.flush()
    db.add(PointState(user_id=user.id, points=REGISTRATION_BONUS, last_signin_date=None, streak=0))
    db.add(UserQuota(user_id=user.id, words_quota=default_quota))
    db.commit()
    db.refresh(user)
    return user


def get_or_create_seed_user(
    db: Session, *, email: str, password_hash: str, nickname: str, default_quota: int
) -> User:
    existing = get_user_by_email(db, email)
    if existing:
        return existing
    return create_user(
        db,
        email=email,
        password_hash=password_hash,
        nickname=nickname,
        default_quota=default_quota,
    )


def user_is_protected_admin(db: Session, user_id: str) -> bool:
    user = db.get(User, user_id)
    if not user:
        return False
    return is_protected_admin_email(user.email)


def unban_protected_admin_accounts(db: Session) -> list[str]:
    restored: list[str] = []
    for email in protected_admin_emails():
        user = get_user_by_email(db, email)
        if user and user.is_banned:
            user.is_banned = False
            restored.append(email)
    if restored:
        db.commit()
    return restored


def set_user_ban_status(db: Session, user_id: str, is_banned: bool) -> User | None:
    user = db.get(User, user_id)
    if not user:
        return None
    if is_banned and is_protected_admin_email(user.email):
        return None
    user.is_banned = is_banned
    db.commit()
    db.refresh(user)
    return user


def delete_user(db: Session, user_id: str) -> bool:
    user = db.get(User, user_id)
    if not user:
        return False
    if is_protected_admin_email(user.email):
        return False
    db.delete(user)
    db.commit()
    return True

