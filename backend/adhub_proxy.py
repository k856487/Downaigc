"""将 /api/adhub/* 转发到扫码看广独立后端（默认 8001）。"""
from __future__ import annotations

import os
import urllib.error
import urllib.request

from fastapi import APIRouter, HTTPException, Request, Response

router = APIRouter()


def _adhub_proxy_base() -> str:
    return (os.getenv("ADHUB_PROXY_BASE") or "http://127.0.0.1:8001").rstrip("/")


@router.api_route("/api/adhub/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"])
async def adhub_proxy(path: str, request: Request) -> Response:
    if request.method == "OPTIONS":
        return Response(status_code=204)

    base = _adhub_proxy_base()
    query = request.url.query
    url = f"{base}/api/adhub/{path}"
    if query:
        url = f"{url}?{query}"

    body = await request.body()
    headers: dict[str, str] = {}
    ct = request.headers.get("content-type")
    if ct:
        headers["Content-Type"] = ct
    auth = request.headers.get("authorization")
    if auth:
        headers["Authorization"] = auth

    req = urllib.request.Request(url, data=body or None, headers=headers, method=request.method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            content = resp.read()
            status = resp.status
            resp_headers: dict[str, str] = {}
            resp_ct = resp.headers.get("Content-Type")
            if resp_ct:
                resp_headers["Content-Type"] = resp_ct
    except urllib.error.HTTPError as exc:
        content = exc.read()
        status = exc.code
        resp_headers = {}
        resp_ct = exc.headers.get("Content-Type") if exc.headers else None
        if resp_ct:
            resp_headers["Content-Type"] = resp_ct
    except urllib.error.URLError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"无法连接扫码看广后端 {base}，请确认 server 已启动：{exc.reason}",
        ) from exc

    return Response(content=content, status_code=status, headers=resp_headers)
