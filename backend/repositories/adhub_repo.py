from __future__ import annotations

import hashlib
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from models.adhub_entities import (
    AdHubAccount,
    AdHubAdvertiserProfile,
    AdHubChatMessage,
    AdHubChatThread,
    AdHubCooperationIntent,
    AdHubPublisherProfile,
    AdHubQrSlot,
    AdHubReputationLog,
    AdHubWatchEvent,
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def get_account(db: Session, account_id: str) -> AdHubAccount | None:
    return db.get(AdHubAccount, account_id)


def get_account_by_openid(db: Session, openid: str) -> AdHubAccount | None:
    return db.scalar(select(AdHubAccount).where(AdHubAccount.openid == openid))


def ensure_publisher_profile(db: Session, account: AdHubAccount) -> AdHubPublisherProfile:
    if account.publisher:
        return account.publisher
    row = AdHubPublisherProfile(account_id=account.id)
    db.add(row)
    db.flush()
    return row


def upsert_weixin_account(
    db: Session, *, openid: str, unionid: str | None, nickname: str, avatar_url: str
) -> AdHubAccount:
    row = get_account_by_openid(db, openid)
    if row:
        if nickname:
            row.nickname = nickname
        if avatar_url:
            row.avatar_url = avatar_url
        if unionid:
            row.unionid = unionid
        db.commit()
        db.refresh(row)
        ensure_publisher_profile(db, row)
        return row
    row = AdHubAccount(
        openid=openid,
        unionid=unionid,
        nickname=nickname or "微信用户",
        avatar_url=avatar_url or "",
    )
    db.add(row)
    db.flush()
    db.add(AdHubPublisherProfile(account_id=row.id))
    db.commit()
    db.refresh(row)
    return row


def _normalize_id_tail(id_number: str) -> str:
    digits = re.sub(r"\D", "", id_number)
    return digits[-4:] if len(digits) >= 4 else digits


def submit_realname(
    db: Session, account: AdHubAccount, *, real_name: str, id_number: str
) -> AdHubPublisherProfile:
    prof = ensure_publisher_profile(db, account)
    name = real_name.strip()
    if len(name) < 2:
        raise ValueError("invalid_name")
    tail = _normalize_id_tail(id_number)
    if len(tail) < 4:
        raise ValueError("invalid_id_number")
    prof.real_name = name
    prof.id_number_tail = tail
    prof.verify_status = "verified"
    prof.verified_at = _now()
    _ensure_qr_slot(db, account)
    _adjust_reputation(db, account.id, +2, "实名认证通过")
    db.commit()
    db.refresh(prof)
    return prof


def _ensure_qr_slot(db: Session, account: AdHubAccount) -> AdHubQrSlot:
    if account.qr_slot:
        return account.qr_slot
    code = secrets.token_urlsafe(9).replace("-", "").replace("_", "")[:12].lower()
    row = AdHubQrSlot(account_id=account.id, code=code)
    db.add(row)
    db.flush()
    return row


def get_qr_by_account(db: Session, account_id: str) -> AdHubQrSlot | None:
    return db.scalar(select(AdHubQrSlot).where(AdHubQrSlot.account_id == account_id))


def get_qr_by_code(db: Session, code: str) -> AdHubQrSlot | None:
    return db.scalar(select(AdHubQrSlot).where(AdHubQrSlot.code == code))


def update_publisher_contact(
    db: Session,
    account: AdHubAccount,
    *,
    contact_phone: str = "",
    contact_email: str = "",
    website_url: str = "",
    bio: str = "",
) -> AdHubPublisherProfile:
    prof = ensure_publisher_profile(db, account)
    prof.contact_phone = contact_phone.strip()
    prof.contact_email = contact_email.strip()
    prof.website_url = website_url.strip()
    prof.bio = bio.strip()
    db.commit()
    db.refresh(prof)
    return prof


def register_advertiser(
    db: Session,
    account: AdHubAccount,
    *,
    company_name: str,
    contact_name: str,
    contact_phone: str,
    contact_email: str,
    bio: str = "",
) -> AdHubAdvertiserProfile:
    if not company_name.strip():
        raise ValueError("company_required")
    account.is_advertiser = True
    existing = account.advertiser
    if existing:
        existing.company_name = company_name.strip()
        existing.contact_name = contact_name.strip()
        existing.contact_phone = contact_phone.strip()
        existing.contact_email = contact_email.strip()
        existing.bio = bio.strip()
        db.commit()
        db.refresh(existing)
        return existing
    row = AdHubAdvertiserProfile(
        account_id=account.id,
        company_name=company_name.strip(),
        contact_name=contact_name.strip(),
        contact_phone=contact_phone.strip(),
        contact_email=contact_email.strip(),
        bio=bio.strip(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _adjust_reputation(db: Session, account_id: str, delta: int, reason: str) -> int:
    prof = db.get(AdHubPublisherProfile, account_id)
    if not prof:
        adv = db.get(AdHubAdvertiserProfile, account_id)
        if not adv:
            return 80
        adv.reputation_score = max(0, min(100, int(adv.reputation_score) + delta))
        db.add(AdHubReputationLog(account_id=account_id, delta=delta, reason=reason))
        return adv.reputation_score
    prof.reputation_score = max(0, min(100, int(prof.reputation_score) + delta))
    db.add(AdHubReputationLog(account_id=account_id, delta=delta, reason=reason))
    return prof.reputation_score


def list_publishers(
    db: Session, *, min_reputation: int = 0, limit: int = 50
) -> list[dict]:
    rows = db.scalars(
        select(AdHubAccount)
        .join(AdHubPublisherProfile, AdHubPublisherProfile.account_id == AdHubAccount.id)
        .where(
            AdHubPublisherProfile.verify_status == "verified",
            AdHubPublisherProfile.reputation_score >= min_reputation,
        )
        .order_by(AdHubPublisherProfile.reputation_score.desc())
        .limit(limit)
    )
    out: list[dict] = []
    for acc in rows:
        p = acc.publisher
        if not p:
            continue
        out.append(_publisher_public_dict(acc, p))
    return out


def list_advertisers(db: Session, *, limit: int = 50) -> list[dict]:
    rows = db.scalars(
        select(AdHubAccount)
        .join(AdHubAdvertiserProfile, AdHubAdvertiserProfile.account_id == AdHubAccount.id)
        .where(AdHubAccount.is_advertiser.is_(True))
        .order_by(AdHubAdvertiserProfile.reputation_score.desc())
        .limit(limit)
    )
    out: list[dict] = []
    for acc in rows:
        a = acc.advertiser
        if not a:
            continue
        out.append(_advertiser_public_dict(acc, a))
    return out


def get_publisher_public(db: Session, account_id: str) -> dict | None:
    acc = db.get(AdHubAccount, account_id)
    if not acc or not acc.publisher or acc.publisher.verify_status != "verified":
        return None
    return _publisher_public_dict(acc, acc.publisher)


def get_advertiser_public(db: Session, account_id: str) -> dict | None:
    acc = db.get(AdHubAccount, account_id)
    if not acc or not acc.advertiser:
        return None
    return _advertiser_public_dict(acc, acc.advertiser)


def _publisher_public_dict(acc: AdHubAccount, p: AdHubPublisherProfile) -> dict:
    return {
        "id": acc.id,
        "nickname": acc.nickname,
        "avatarUrl": acc.avatar_url,
        "realNameMasked": p.real_name[:1] + "**" if p.real_name else "",
        "reputationScore": int(p.reputation_score),
        "fraudFlags": int(p.fraud_flags),
        "contactPhone": p.contact_phone,
        "contactEmail": p.contact_email,
        "websiteUrl": p.website_url,
        "bio": p.bio,
        "verified": p.verify_status == "verified",
        "role": "publisher",
    }


def _advertiser_public_dict(acc: AdHubAccount, a: AdHubAdvertiserProfile) -> dict:
    return {
        "id": acc.id,
        "nickname": acc.nickname,
        "avatarUrl": acc.avatar_url,
        "companyName": a.company_name,
        "contactName": a.contact_name,
        "reputationScore": int(a.reputation_score),
        "contactPhone": a.contact_phone,
        "contactEmail": a.contact_email,
        "bio": a.bio,
        "role": "advertiser",
    }


def account_me_dict(db: Session, account: AdHubAccount) -> dict:
    p = account.publisher
    a = account.advertiser
    qr = account.qr_slot
    return {
        "id": account.id,
        "nickname": account.nickname,
        "avatarUrl": account.avatar_url,
        "isPublisher": bool(account.is_publisher),
        "isAdvertiser": bool(account.is_advertiser),
        "publisher": {
            "verifyStatus": p.verify_status if p else "none",
            "realNameMasked": (p.real_name[:1] + "**") if p and p.real_name else "",
            "reputationScore": int(p.reputation_score) if p else 80,
            "fraudFlags": int(p.fraud_flags) if p else 0,
            "contactPhone": p.contact_phone if p else "",
            "contactEmail": p.contact_email if p else "",
            "websiteUrl": p.website_url if p else "",
            "bio": p.bio if p else "",
        },
        "advertiser": {
            "companyName": a.company_name if a else "",
            "contactName": a.contact_name if a else "",
            "reputationScore": int(a.reputation_score) if a else 80,
            "contactPhone": a.contact_phone if a else "",
            "contactEmail": a.contact_email if a else "",
            "bio": a.bio if a else "",
        }
        if a
        else None,
        "qrCode": qr.code if qr else None,
    }


def record_watch_complete(
    db: Session,
    *,
    qr_code: str,
    viewer_key: str,
    ip_address: str,
    duration_sec: int,
) -> tuple[bool, str, dict]:
    slot = get_qr_by_code(db, qr_code)
    if not slot:
        return False, "invalid_code", {}
    publisher_id = slot.account_id
    prof = db.get(AdHubPublisherProfile, publisher_id)
    if not prof or prof.verify_status != "verified":
        return False, "publisher_not_verified", {}

    suspicious = False
    if duration_sec < 25:
        suspicious = True
    since = _now() - timedelta(hours=1)
    recent_same_viewer = int(
        db.scalar(
            select(func.count(AdHubWatchEvent.id)).where(
                AdHubWatchEvent.qr_code == qr_code,
                AdHubWatchEvent.viewer_key == viewer_key,
                AdHubWatchEvent.completed.is_(True),
                AdHubWatchEvent.created_at >= since,
            )
        )
        or 0
    )
    if recent_same_viewer >= 5:
        suspicious = True

    evt = AdHubWatchEvent(
        qr_code=qr_code,
        publisher_account_id=publisher_id,
        viewer_key=viewer_key,
        ip_address=ip_address or "",
        duration_sec=duration_sec,
        completed=True,
        suspicious=suspicious,
    )
    db.add(evt)

    if suspicious:
        prof.fraud_flags = int(prof.fraud_flags) + 1
        score = _adjust_reputation(db, publisher_id, -8, "疑似刷量观看")
    else:
        score = _adjust_reputation(db, publisher_id, +1, "正常完成观看")

    db.commit()
    return True, "ok" if not suspicious else "suspicious", {
        "publisherReputation": score,
        "suspicious": suspicious,
    }


def create_cooperation(
    db: Session, *, from_id: str, to_id: str, message: str
) -> AdHubCooperationIntent:
    if from_id == to_id:
        raise ValueError("self")
    existing = db.scalar(
        select(AdHubCooperationIntent).where(
            AdHubCooperationIntent.from_account_id == from_id,
            AdHubCooperationIntent.to_account_id == to_id,
        )
    )
    if existing:
        existing.message = message.strip()
        existing.status = "pending"
        db.commit()
        db.refresh(existing)
        return existing
    row = AdHubCooperationIntent(
        from_account_id=from_id, to_account_id=to_id, message=message.strip(), status="pending"
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _thread_pair(a: str, b: str) -> tuple[str, str]:
    return (a, b) if a < b else (b, a)


def open_chat_thread(db: Session, account_id: str, peer_id: str) -> AdHubChatThread:
    a, b = _thread_pair(account_id, peer_id)
    row = db.scalar(
        select(AdHubChatThread).where(
            AdHubChatThread.account_a_id == a, AdHubChatThread.account_b_id == b
        )
    )
    if row:
        return row
    row = AdHubChatThread(account_a_id=a, account_b_id=b)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def list_chat_threads(db: Session, account_id: str) -> list[dict]:
    rows = db.scalars(
        select(AdHubChatThread).where(
            or_(
                AdHubChatThread.account_a_id == account_id,
                AdHubChatThread.account_b_id == account_id,
            )
        ).order_by(AdHubChatThread.last_message_at.desc().nullslast())
    )
    out: list[dict] = []
    for t in rows:
        peer_id = t.account_b_id if t.account_a_id == account_id else t.account_a_id
        peer = db.get(AdHubAccount, peer_id)
        last = db.scalar(
            select(AdHubChatMessage)
            .where(AdHubChatMessage.thread_id == t.id)
            .order_by(AdHubChatMessage.created_at.desc())
            .limit(1)
        )
        out.append(
            {
                "threadId": t.id,
                "peerId": peer_id,
                "peerNickname": peer.nickname if peer else "",
                "peerAvatarUrl": peer.avatar_url if peer else "",
                "lastMessage": last.content if last else "",
                "lastMessageAt": last.created_at.isoformat() if last and last.created_at else "",
            }
        )
    return out


def list_chat_messages(db: Session, thread_id: str, account_id: str) -> list[dict]:
    thread = db.get(AdHubChatThread, thread_id)
    if not thread or account_id not in (thread.account_a_id, thread.account_b_id):
        return []
    rows = db.scalars(
        select(AdHubChatMessage)
        .where(AdHubChatMessage.thread_id == thread_id)
        .order_by(AdHubChatMessage.created_at.asc())
    )
    return [
        {
            "id": m.id,
            "senderId": m.sender_id,
            "content": m.content,
            "createdAt": m.created_at.isoformat() if m.created_at else "",
            "mine": m.sender_id == account_id,
        }
        for m in rows
    ]


def send_chat_message(db: Session, *, thread_id: str, sender_id: str, content: str) -> AdHubChatMessage:
    thread = db.get(AdHubChatThread, thread_id)
    if not thread or sender_id not in (thread.account_a_id, thread.account_b_id):
        raise ValueError("forbidden")
    text = content.strip()
    if not text:
        raise ValueError("empty")
    msg = AdHubChatMessage(thread_id=thread_id, sender_id=sender_id, content=text)
    thread.last_message_at = _now()
    db.add(msg)
    db.commit()
    db.refresh(msg)
    return msg
