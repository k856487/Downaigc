from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import timedelta
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from db.session import get_db
from repositories import adhub_repo

JWT_ALG = "HS256"
oauth2_adhub = OAuth2PasswordBearer(tokenUrl="/api/adhub/auth/weixin")


def _jwt_secret() -> str:
    return os.getenv("JWT_SECRET_KEY", "dev-secret-change-me").strip() or "dev-secret-change-me"


def _adhub_public_base() -> str:
    return (os.getenv("ADHUB_PUBLIC_BASE") or os.getenv("AD_WATCH_PUBLIC_BASE") or "http://127.0.0.1:8000").rstrip("/")


def _wechat_appid() -> str:
    return (os.getenv("ADHUB_WECHAT_APPID") or os.getenv("WECHAT_MP_APPID") or "").strip()


def _wechat_secret() -> str:
    return (os.getenv("ADHUB_WECHAT_SECRET") or os.getenv("WECHAT_MP_SECRET") or "").strip()


def create_adhub_token(account_id: str) -> str:
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)
    exp = now + timedelta(days=30)
    payload = {
        "sub": account_id,
        "typ": "adhub",
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
    }
    return jwt.encode(payload, _jwt_secret(), algorithm=JWT_ALG)


async def get_current_adhub_account(
    token: str = Depends(oauth2_adhub), db: Session = Depends(get_db)
) -> Dict[str, Any]:
    try:
        payload = jwt.decode(token, _jwt_secret(), algorithms=[JWT_ALG])
        if payload.get("typ") != "adhub":
            raise HTTPException(status_code=401, detail="Invalid token type")
        account_id = payload.get("sub")
        if not account_id:
            raise HTTPException(status_code=401, detail="Invalid token")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
    acc = adhub_repo.get_account(db, str(account_id))
    if not acc:
        raise HTTPException(status_code=401, detail="Account not found")
    return {"id": acc.id, "account": acc}


def _adhub_dev_login() -> bool:
    return (os.getenv("ADHUB_DEV_LOGIN") or "").strip().lower() in ("1", "true", "yes")


def _exchange_weixin_code(code: str) -> tuple[str, str | None]:
    code = (code or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="缺少微信 code")
    appid, secret = _wechat_appid(), _wechat_secret()
    if _adhub_dev_login() or (not appid and not secret):
        # 本地开发：不调用微信 jscode2session，用 code 生成稳定 openid
        import hashlib

        digest = hashlib.sha256(code.encode("utf-8")).hexdigest()[:24]
        return f"dev_openid_{digest}", None
    if code in ("dev", "test") and not appid:
        return f"dev_openid_{code}", None
    if not appid or not secret:
        raise HTTPException(
            status_code=503,
            detail="微信登录未配置 ADHUB_WECHAT_APPID/SECRET（本地开发可设 ADHUB_DEV_LOGIN=1）",
        )
    qs = urllib.parse.urlencode(
        {"appid": appid, "secret": secret, "js_code": code, "grant_type": "authorization_code"}
    )
    url = f"https://api.weixin.qq.com/sns/jscode2session?{qs}"
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.URLError as exc:
        raise HTTPException(status_code=502, detail="微信服务暂不可用") from exc
    if data.get("errcode"):
        raise HTTPException(status_code=400, detail=f"微信登录失败: {data.get('errmsg', data.get('errcode'))}")
    openid = data.get("openid")
    if not openid:
        raise HTTPException(status_code=400, detail="微信登录失败: 无 openid")
    return str(openid), data.get("unionid")


class WeixinLoginRequest(BaseModel):
    code: str
    nickname: str = ""
    avatarUrl: str = ""


class RealnameRequest(BaseModel):
    realName: str = Field(min_length=2, max_length=32)
    idNumber: str = Field(min_length=15, max_length=20)


class PublisherContactRequest(BaseModel):
    contactPhone: str = ""
    contactEmail: str = ""
    websiteUrl: str = ""
    bio: str = ""


class AdvertiserRegisterRequest(BaseModel):
    companyName: str = Field(min_length=2, max_length=128)
    contactName: str = ""
    contactPhone: str = ""
    contactEmail: str = ""
    bio: str = ""


class CooperationRequest(BaseModel):
    toAccountId: str
    message: str = ""


class ChatSendRequest(BaseModel):
    content: str = Field(min_length=1, max_length=2000)


class WatchCompleteRequest(BaseModel):
    code: str
    viewerKey: str = ""
    durationSec: int = Field(ge=0, le=600)


router = APIRouter(prefix="/api/adhub", tags=["adhub"])


@router.post("/auth/weixin")
def adhub_weixin_login(req: WeixinLoginRequest, db: Session = Depends(get_db)) -> Dict[str, Any]:
    openid, unionid = _exchange_weixin_code(req.code.strip())
    acc = adhub_repo.upsert_weixin_account(
        db,
        openid=openid,
        unionid=unionid,
        nickname=req.nickname.strip(),
        avatar_url=req.avatarUrl.strip(),
    )
    token = create_adhub_token(acc.id)
    return {"accessToken": token, "account": adhub_repo.account_me_dict(db, acc)}


@router.get("/me")
def adhub_me(ctx: Dict[str, Any] = Depends(get_current_adhub_account), db: Session = Depends(get_db)) -> Dict[str, Any]:
    acc = ctx["account"]
    db.refresh(acc)
    return adhub_repo.account_me_dict(db, acc)


@router.put("/me/publisher")
def adhub_update_publisher(
    req: PublisherContactRequest,
    ctx: Dict[str, Any] = Depends(get_current_adhub_account),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    adhub_repo.update_publisher_contact(
        db,
        ctx["account"],
        contact_phone=req.contactPhone,
        contact_email=req.contactEmail,
        website_url=req.websiteUrl,
        bio=req.bio,
    )
    db.refresh(ctx["account"])
    return adhub_repo.account_me_dict(db, ctx["account"])


@router.post("/me/verify-realname")
def adhub_verify_realname(
    req: RealnameRequest,
    ctx: Dict[str, Any] = Depends(get_current_adhub_account),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    try:
        adhub_repo.submit_realname(
            db, ctx["account"], real_name=req.realName, id_number=req.idNumber
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    db.refresh(ctx["account"])
    return adhub_repo.account_me_dict(db, ctx["account"])


@router.get("/me/qr")
def adhub_my_qr(
    ctx: Dict[str, Any] = Depends(get_current_adhub_account), db: Session = Depends(get_db)
) -> Dict[str, Any]:
    acc = ctx["account"]
    prof = acc.publisher
    if not prof or prof.verify_status != "verified":
        raise HTTPException(status_code=403, detail="请先完成实名认证")
    slot = adhub_repo.get_qr_by_account(db, acc.id)
    if not slot:
        raise HTTPException(status_code=404, detail="二维码未生成")
    embed_url = f"{_adhub_public_base()}/static/adhub-watch/index.html?code={slot.code}"
    return {
        "code": slot.code,
        "embedUrl": embed_url,
        "reputationScore": int(prof.reputation_score),
        "hint": "每个实名账号仅有一个专属二维码，可嵌入个人网站供访客扫码看广。",
    }


@router.post("/advertiser/register")
def adhub_register_advertiser(
    req: AdvertiserRegisterRequest,
    ctx: Dict[str, Any] = Depends(get_current_adhub_account),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    try:
        adhub_repo.register_advertiser(
            db,
            ctx["account"],
            company_name=req.companyName,
            contact_name=req.contactName,
            contact_phone=req.contactPhone,
            contact_email=req.contactEmail,
            bio=req.bio,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    db.refresh(ctx["account"])
    return adhub_repo.account_me_dict(db, ctx["account"])


@router.get("/market/publishers")
def adhub_market_publishers(
    minReputation: int = 0,
    db: Session = Depends(get_db),
    _: Dict[str, Any] = Depends(get_current_adhub_account),
) -> Dict[str, Any]:
    return {"items": adhub_repo.list_publishers(db, min_reputation=minReputation)}


@router.get("/market/advertisers")
def adhub_market_advertisers(
    db: Session = Depends(get_db),
    _: Dict[str, Any] = Depends(get_current_adhub_account),
) -> Dict[str, Any]:
    return {"items": adhub_repo.list_advertisers(db)}


@router.get("/market/publishers/{account_id}")
def adhub_publisher_detail(
    account_id: str,
    db: Session = Depends(get_db),
    _: Dict[str, Any] = Depends(get_current_adhub_account),
) -> Dict[str, Any]:
    row = adhub_repo.get_publisher_public(db, account_id)
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    return row


@router.get("/market/advertisers/{account_id}")
def adhub_advertiser_detail(
    account_id: str,
    db: Session = Depends(get_db),
    _: Dict[str, Any] = Depends(get_current_adhub_account),
) -> Dict[str, Any]:
    row = adhub_repo.get_advertiser_public(db, account_id)
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    return row


@router.post("/cooperation/request")
def adhub_cooperation_request(
    req: CooperationRequest,
    ctx: Dict[str, Any] = Depends(get_current_adhub_account),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    try:
        row = adhub_repo.create_cooperation(
            db, from_id=ctx["id"], to_id=req.toAccountId, message=req.message
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "id": row.id, "status": row.status}


@router.get("/chat/threads")
def adhub_chat_threads(
    ctx: Dict[str, Any] = Depends(get_current_adhub_account), db: Session = Depends(get_db)
) -> Dict[str, Any]:
    return {"items": adhub_repo.list_chat_threads(db, ctx["id"])}


@router.post("/chat/open-with/{peer_id}")
def adhub_chat_open(
    peer_id: str,
    ctx: Dict[str, Any] = Depends(get_current_adhub_account),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    thread = adhub_repo.open_chat_thread(db, ctx["id"], peer_id)
    return {"threadId": thread.id}


@router.get("/chat/threads/{thread_id}/messages")
def adhub_chat_messages(
    thread_id: str,
    ctx: Dict[str, Any] = Depends(get_current_adhub_account),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    return {"items": adhub_repo.list_chat_messages(db, thread_id, ctx["id"])}


@router.post("/chat/threads/{thread_id}/messages")
def adhub_chat_send(
    thread_id: str,
    req: ChatSendRequest,
    ctx: Dict[str, Any] = Depends(get_current_adhub_account),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    try:
        msg = adhub_repo.send_chat_message(
            db, thread_id=thread_id, sender_id=ctx["id"], content=req.content
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "id": msg.id,
        "content": msg.content,
        "createdAt": msg.created_at.isoformat() if msg.created_at else "",
    }


@router.post("/watch/complete")
def adhub_watch_complete(req: WatchCompleteRequest, request: Request, db: Session = Depends(get_db)) -> Dict[str, Any]:
    ip = request.client.host if request.client else ""
    viewer = req.viewerKey.strip() or ip or "anonymous"
    ok, reason, extra = adhub_repo.record_watch_complete(
        db,
        qr_code=req.code.strip(),
        viewer_key=viewer,
        ip_address=ip,
        duration_sec=req.durationSec,
    )
    if not ok:
        raise HTTPException(status_code=400, detail=reason)
    return {"ok": True, "reason": reason, **extra}
