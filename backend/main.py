from __future__ import annotations

import asyncio
import base64
import difflib
import io
import json
import hmac
import hashlib
import random
import smtplib
import os
import re
import threading
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from email.header import Header
from email.mime.text import MIMEText
from email.utils import formataddr
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional, Tuple

try:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parent / ".env")
except ImportError:
    pass

from fastapi import Depends, FastAPI, File, HTTPException, Query, Request, UploadFile, status
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.orm import Session
from passlib.context import CryptContext

from db.base import Base
from db.session import engine, get_db, SessionLocal
from repositories import admin_repo, ad_watch_repo, auth_repo, feedback_repo, points_repo, redeem_repo, task_repo
from pricing import ad_watch_reward_points as pricing_ad_watch_reward_points
from admin_access import admin_email_allowlist
from adhub_proxy import router as adhub_proxy_router
from models import entities as _entities  # noqa: F401
from models.entities import PointState, RedeemCode, TaskParagraph, User
from models.entities import EmailVerificationCode

JWT_ALG = "HS256"
pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _iso_date_utc(d: Optional[datetime] = None) -> str:
    dt = d or _now_utc()
    return dt.strftime("%Y-%m-%d")


def count_words(text: str) -> int:
    """
    计费口径：仅统计汉字（1 字 = 1 汉字）。
    标点、空格、英文与数字不计入扣费。
    """
    return len(re.findall(r"[\u4e00-\u9fff]", text or ""))


def detect_language_directive(text: str) -> str:
    """
    粗判本段主语言，供 prompt 约束输出语种（与原文一致）。
    """
    t = text.strip()
    if not t:
        return "未检测到有效正文：输出语言须与后续输入段落一致。"
    cjk = len(re.findall(r"[\u4e00-\u9fff]", t))
    latin = len(re.findall(r"[a-zA-Z]", t))
    # 中文论文：汉字占优
    if cjk >= 8 and cjk >= latin * 0.35:
        return (
            "【判定】本段以中文为主：输出必须通篇为简体中文，"
            "禁止插入英文句子、英文从句或「中文（English）」式对照；"
            "仅在必要时保留外文专名、缩写、公式与文献题名；勿混用繁体字。"
        )
    # 英文论文：拉丁字母占优
    if latin >= 30 and latin > cjk * 1.0:
        return (
            "【判定】本段以英文为主：输出必须通篇为英文，"
            "专有名词、缩写与公式保持常见学术写法。"
        )
    return (
        "【判定】中英混排或篇幅较短：输出语言比例与原文段落一致，"
        "不要擅自翻译整段；专名保持原样。"
    )


def _detach_inline_keyword_suffix(body: str, existing_suffix: str) -> Tuple[str, str]:
    """
    当「关键词：」未单独成行、而是接在摘要正文末或同行时，拆入 suffix，避免整段送模型后关键词被吃掉。
    """
    suf = (existing_suffix or "").strip()
    if suf:
        return body.strip(), existing_suffix
    b = (body or "").rstrip()
    if "关键词" not in b and "关键字" not in b:
        return body.strip(), ""
    for label in ("关键词", "关键字"):
        m = re.search(rf"(?s)^(.+?)(\n\s*{label}\s*[：:].+)$", b)
        if m and len(m.group(1).strip()) >= 8 and len(m.group(2).strip()) >= 4:
            return m.group(1).rstrip(), m.group(2).strip()
        m2 = re.search(rf"(?s)^(.+?)(\s+{label}\s*[：:].+)$", b)
        if m2 and len(m2.group(1).strip()) >= 8 and len(m2.group(2).strip()) >= 4:
            return m2.group(1).rstrip(), m2.group(2).strip()
    for label in ("关键词", "关键字"):
        m = re.search(rf"(?s)^(.+?)([。！？…；;]\s*{label}\s*[：:].+)$", b)
        if m and len(m.group(1).strip()) >= 8 and len(m.group(2).strip()) >= 4:
            punct, rest = m.group(2)[0], m.group(2)[1:].lstrip()
            return (m.group(1).rstrip() + punct).rstrip(), rest
    best_kw: Optional[Tuple[int, str, str]] = None
    for label in ("关键词", "关键字"):
        for m in re.finditer(rf"{label}\s*[：:]", b):
            pos = m.start()
            if pos < 8:
                continue
            head = b[:pos].rstrip()
            tail = b[pos:].strip()
            if len(head) < 8 or len(tail) < 4:
                continue
            if "；" in tail or ";" in tail or "、" in tail or len(tail) <= 220:
                if best_kw is None or pos >= best_kw[0]:
                    best_kw = (pos, head, tail)
    if best_kw:
        return best_kw[1], best_kw[2]
    return body.strip(), ""


def split_paper_abstract_block(text: str) -> Optional[Tuple[str, str, str]]:
    """
    识别常见论文首段结构：标题行 + 「摘要：」行 + 摘要正文 + 「关键词：…」行。
    返回 (prefix, body, suffix)：
    - prefix：标题 + 摘要行 + 换行（供原样拼回）
    - body：仅摘要正文（交给模型改写）
    - suffix：「关键词：…」整行；若无关键词行则为空字符串
    不匹配则返回 None。

    支持两种排版：
    - 第二行仅为「摘要」/「摘要：」标签，正文从第三行起；
    - 第二行为「摘要：」与正文同一行（常见），正文从「摘要：」后截取。
    """

    def _kw_line_index(block: List[str]) -> Optional[int]:
        for i, ln in enumerate(block):
            s = ln.strip()
            if (
                re.match(r"^关键词\s*[：:]", s)
                or re.match(r"^关键词\s*$", s)
                or re.match(r"^关键字\s*[：:]", s)
                or re.match(r"^关键字\s*$", s)
            ):
                return i
        return None

    lines = text.splitlines()
    if len(lines) == 1:
        ln = lines[0].strip()
        m0 = re.match(
            r"^(摘要\s*[：:]\s*)(.+?)((?:\s+关键词|\s+关键字)\s*[：:].+)$", ln, re.DOTALL
        )
        if m0:
            return ("摘要：\n", m0.group(2).strip(), m0.group(3).strip())
    if len(lines) < 2:
        return None

    title = lines[0].rstrip()
    line1 = lines[1].strip()

    # A) 第二行仅为摘要标签（无同行正文）
    if re.match(r"^摘要\s*[：:]?\s*$", line1):
        if len(lines) < 3:
            return None
        abstract_label = lines[1].rstrip()
        prefix = f"{title}\n{abstract_label}\n"
        rest = lines[2:]
        kw_idx = _kw_line_index(rest)
        if kw_idx is None:
            body = "\n".join(rest).strip()
            body, sfx = _detach_inline_keyword_suffix(body, "")
            return (prefix, body, sfx)
        body = "\n".join(rest[:kw_idx]).strip()
        suffix = rest[kw_idx].rstrip()
        body, sfx = _detach_inline_keyword_suffix(body, suffix)
        return (prefix, body, sfx)

    # B) 第二行「摘要：」与正文在同一行
    m = re.match(r"^摘要\s*[：:]\s*(.*)$", line1, re.DOTALL)
    if not m:
        return None

    prefix = f"{title}\n摘要：\n"
    first_body = (m.group(1) or "").strip()
    body_lines: List[str] = []
    if first_body:
        body_lines.append(first_body)
    if len(lines) > 2:
        rest = lines[2:]
        kw_idx = _kw_line_index(rest)
        if kw_idx is None:
            body_lines.extend(rest)
        else:
            body_lines.extend(rest[:kw_idx])
            body = "\n".join(body_lines).strip()
            suffix = rest[kw_idx].rstrip()
            body, sfx = _detach_inline_keyword_suffix(body, suffix)
            return (prefix, body, sfx)

    body = "\n".join(body_lines).strip()
    if not body:
        return None
    body, sfx = _detach_inline_keyword_suffix(body, "")
    return (prefix, body, sfx)


def strip_redundant_leading_abstract_label(prefix: str, reduced: str) -> str:
    """
    prefix 已含单独「摘要」标签行时，模型若再在正文开头输出「摘要：」或单独一行「摘要」，
    拼回后会叠成「摘要： 摘要」类重复；在此剥掉正文开头的复读标记（可多种形态交替出现）。
    """
    if not reduced or not prefix.strip():
        return reduced
    nonempty = [ln.strip() for ln in prefix.split("\n") if ln.strip()]
    if len(nonempty) < 2:
        return reduced
    if not re.match(r"^摘要\s*[：:]?\s*$", nonempty[1]):
        return reduced
    r = reduced.lstrip()
    while r.strip():
        prev = r
        r = re.sub(r"^(?:摘要\s*[：:]\s*)+", "", r, count=1)
        if r != prev:
            continue
        lines = r.splitlines()
        if lines and re.match(r"^摘要\s*$", lines[0].strip()):
            r = "\n".join(lines[1:]).lstrip()
            continue
        # 同行「摘要： … 摘要 …」中多出来的「摘要」+ 空白
        r = re.sub(r"^摘要\s+", "", r, count=1)
        if r != prev:
            continue
        break
    return r.lstrip() if r.strip() else reduced


def strip_runaway_leading_abstract_labels(text: str) -> str:
    """
    去掉段首连续重复的「摘要：」堆叠（模型复读或与分段合并后的段首标签叠加）。
    单次「摘要：」保留不动；两次及以上从段首整体剥掉，保留其后正文。
    另处理「摘要：」与单独「摘要」紧邻（同行或次行）的常见误输出。
    """
    if not (t := text.strip()):
        return text
    new_t = re.sub(r"^(?:摘要\s*[：:]\s*){2,}", "", t, count=1)
    if new_t != t:
        return new_t.lstrip() if new_t.strip() else text
    # 同行：「摘要：」后多写了一个「摘要」（可有尾随空格），合并为单一标签
    t2 = re.sub(r"^摘要\s*[：:]\s+摘要\s*", "摘要：", t, count=1)
    if t2 != t:
        return t2.lstrip() if t2.strip() else text
    t = t2
    lines = [ln.rstrip("\r") for ln in t.splitlines()]
    if (
        len(lines) >= 2
        and re.match(r"^摘要\s*[：:]\s*$", lines[0].strip())
        and re.match(r"^摘要\s*$", lines[1].strip())
    ):
        merged = "\n".join([lines[0]] + lines[2:]).strip()
        return merged if merged else text
    return t


def postprocess_model_output_quality(text: str) -> str:
    """
    模型输出确定性后处理：方括注全半角与混用修复、[n、k] 式引用拆成多注、
    注内非标连字符统一为 ASCII「-」、中文后英文术语缺左括号等常见版式问题。
    不依赖原文，可安全重复执行。
    """
    if not text or not text.strip():
        return text
    t = text.replace("\u00a0", " ")
    t = _pp_normalize_citation_bracket_chars(t)
    t = _pp_normalize_mixed_bracket_citations(t)
    t = _pp_split_citation_enumeration_in_brackets(t)
    t = _pp_normalize_hyphens_in_numeric_brackets(t)
    t = _pp_fix_orphan_latin_before_closing_paren(t)
    t = _pp_fix_decimal_percent_spacing(t)
    return t


def _pp_normalize_citation_bracket_chars(text: str) -> str:
    """全角方括号 U+FF3B/U+FF3D → 半角，便于后续规则。"""
    return text.replace("\uff3b", "[").replace("\uff3d", "]")


def _pp_normalize_mixed_bracket_citations(text: str) -> str:
    """修复 [n］、［n]、［n］及 [ n ] 等混用或多余空格。"""
    t = text
    for _ in range(8):
        nt = re.sub(r"\[(\d+)\s*\uff3d", r"[\1]", t)
        nt = re.sub(r"\uff3b\s*(\d+)\s*\]", r"[\1]", nt)
        nt = re.sub(r"\uff3b\s*(\d+)\s*\uff3d", r"[\1]", nt)
        nt = re.sub(r"\[\s*(\d+(?:\s*-\s*\d+)?)\s*\]", r"[\1]", nt)
        if nt == t:
            break
        t = nt
    return t


def _pp_split_citation_enumeration_in_brackets(text: str) -> str:
    """[5-6、8] → [5-6][8]；仅当方括号内为顿号分隔的纯数字/区间时生效。"""

    def repl(m: re.Match[str]) -> str:
        inner = m.group(1).strip()
        if "、" not in inner:
            return m.group(0)
        parts = [p.strip() for p in inner.split("、")]
        if len(parts) < 2 or not all(re.match(r"^\d+(?:-\d+)?$", p) for p in parts):
            return m.group(0)
        return "".join(f"[{p}]" for p in parts)

    return re.sub(r"\[((?:\d+(?:-\d+)?)(?:、\d+(?:-\d+)?)+)\]", repl, text)


def _pp_normalize_hyphens_in_numeric_brackets(text: str) -> str:
    """[4−7]、[1—4] 等注内 Unicode 连字符→ ASCII「-」（仅以数字开头的注文）。"""

    def inner_fix(inner: str) -> str:
        s = inner.strip()
        if not re.match(r"^\d", s):
            return inner
        out = inner
        for _ in range(4):
            nxt = re.sub(r"(\d)\s*[\u2212\u2013\u2014]\s*(\d)", r"\1-\2", out)
            if nxt == out:
                break
            out = nxt
        return out

    def repl(m: re.Match[str]) -> str:
        return "[" + inner_fix(m.group(1)) + "]"

    return re.sub(r"\[([^\]]+)\]", repl, text)


def _pp_fix_orphan_latin_before_closing_paren(text: str) -> str:
    """
    汉字后直接英文词 + 右括号（缺左括号），如「困惑度 Perplexity），」。
    英文词总长度≥6（首字母大写 + 至少 5 个后续字符），降低误伤 AIGC、AI 等短词。
    """
    return re.sub(
        r"(?<=[\u4e00-\u9fff])\s+([A-Z][A-Za-z0-9]{5,})\s*[）\)](?=[，。；、,\.\!\?\s\n]|$)",
        r"（\1）",
        text,
    )


def _pp_fix_decimal_percent_spacing(text: str) -> str:
    """修复模型在百分数中插入的多余空格，如 22. 5%、18． 0 %。"""
    t = text
    for _ in range(6):
        nxt = re.sub(r"(\d)(?:\.|．)\s+(\d+)\s*(?=%)", r"\1.\2", t)
        if nxt == t:
            break
        t = nxt
    return t


def strip_inline_citation_markers(text: str) -> Tuple[str, int]:
    """
    在独立成行「参考文献」标题之前，去掉正文中 [1]、[2-3][4] 等文献角标（避免改写乱码）。
    「参考文献」及之后的列表（含 [1] 作者…）不处理。
    """
    if not (text or "").strip():
        return text, 0
    m = re.search(r"^\s*参考文献\s*$", text, re.MULTILINE)
    head, tail = (text[: m.start()], text[m.start() :]) if m else (text, "")
    markers = re.findall(r"\[\d+(?:-\d+)?\]", head)
    if not markers:
        return text, 0
    new_head = re.sub(r"(?:\[\d+(?:-\d+)?\]\s*)+", "", head)
    new_head = re.sub(r" {2,}", " ", new_head)
    new_full = new_head + tail
    return new_full, len(markers)


def _heading_number_prefix(s: str) -> Optional[str]:
    """小节标题前的阿拉伯多级编号，如 4.1、3.3.2；非此类返回 None。"""
    m = re.match(r"^(\d+(?:\.\d+)*)", s.strip())
    return m.group(1) if m else None


def is_chapter_heading_line(s: str) -> bool:
    """
    单行是否为论文章节/小节标题（如「一、引言」「1.1 研究背景」）。
    用于分段合并与「整段仅标题则跳过降重」判断。
    """
    s = s.strip()
    if not s:
        return False
    # 避免把年份行误判为编号标题：2024 年……
    if re.match(r"^[12]\d{3}\s", s):
        return False
    # 数字多级标题：1.1 / 2.3.1 …
    if re.match(r"^\d+(\.\d+)*\s+.+", s) and len(s) <= 120:
        return True
    # 中文序号标题：一、引言 / 十一、讨论
    if re.match(r"^[一二三四五六七八九十百千]+、\s*\S+", s):
        return True
    # （一）xxx
    if re.match(r"^[（(][一二三四五六七八九十]+[）)]\s*\S+", s):
        return True
    # 第X章 / 第X节
    if re.match(r"^第[一二三四五六七八九十百千0-9]+[章节]\s*\S*", s):
        return True
    return False


def normalize_heading_spacing_after_model(original: str, reduced: str) -> str:
    """
    段首为小节标题时，按「原文」是否在标题后留空行，统一模型输出，避免有时多一空行。
    仅处理段首第一条非空行（对应常见「1.1 标题 + 正文」）。
    """
    if not original.strip() or not reduced.strip():
        return reduced
    o_lines = original.splitlines()
    r_lines = reduced.splitlines()
    if not o_lines or not r_lines:
        return reduced
    first_o = o_lines[0].strip()
    if not is_chapter_heading_line(first_o):
        return reduced

    want_blank = len(o_lines) >= 2 and o_lines[1].strip() == ""

    fi = 0
    while fi < len(r_lines) and not r_lines[fi].strip():
        fi += 1
    if fi >= len(r_lines):
        return reduced

    if want_blank:
        if fi + 1 >= len(r_lines) or r_lines[fi + 1].strip() != "":
            r_lines.insert(fi + 1, "")
        while fi + 2 < len(r_lines) and r_lines[fi + 1].strip() == "" and r_lines[fi + 2].strip() == "":
            del r_lines[fi + 2]
    else:
        while fi + 1 < len(r_lines) and r_lines[fi + 1].strip() == "":
            del r_lines[fi + 1]

    return "\n".join(r_lines)


def _split_glued_heading_body(original: str, reduced: str) -> str:
    """
    原文首行为小节标题且其后有正文时，模型常把「标题+首句」挤在同一行。
    若输出首行以原文标题为前缀且后面仍有字符，则在标题后拆成两行，便于与原文换行一致。
    """
    o_lines = original.splitlines()
    if not o_lines:
        return reduced
    h = o_lines[0].strip()
    if not is_chapter_heading_line(h):
        return reduced
    # 跳过标题后的空行，确认存在正文
    k = 1
    while k < len(o_lines) and o_lines[k].strip() == "":
        k += 1
    if k >= len(o_lines) or not o_lines[k].strip():
        return reduced
    r_lines = reduced.splitlines()
    fi = 0
    while fi < len(r_lines) and not r_lines[fi].strip():
        fi += 1
    if fi >= len(r_lines):
        return reduced
    s = r_lines[fi].strip()
    if not s.startswith(h):
        return reduced
    if len(s) <= len(h):
        return reduced
    extra = s[len(h) :].lstrip()
    if not extra:
        return reduced
    r_lines[fi] = h
    r_lines.insert(fi + 1, extra)
    return "\n".join(r_lines)


def _strip_leading_english_meta_preface(text: str, original: str) -> str:
    """原文以中文为主时，去掉模型在段首输出的英文说明/计划句。"""
    if not text.strip():
        return text
    if "本段以中文为主" not in detect_language_directive(original):
        return text
    lines = text.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        if not line.strip():
            i += 1
            continue
        cjk = len(re.findall(r"[\u4e00-\u9fff]", line))
        lat = len(re.findall(r"[a-zA-Z]", line))
        low = line.lower()
        meta_kw = (
            "here's",
            "i will",
            "i'll",
            "slight change",
            "rewrite",
            "principle",
            "according to",
        )
        if lat >= 8 and cjk <= 2 and (lat > cjk * 3 or any(k in low for k in meta_kw)):
            i += 1
            continue
        break
    return "\n".join(lines[i:]).strip()


def _count_blank_lines(text: str) -> int:
    return sum(1 for ln in text.splitlines() if not ln.strip())


def _count_list_like_lines(text: str) -> int:
    c = 0
    for ln in text.splitlines():
        s = ln.strip()
        if not s:
            continue
        if (
            re.match(r"^[-*•]\s+", s)
            or re.match(r"^\d+[.)、]\s+", s)
            or re.match(r"^[一二三四五六七八九十]+、\s*", s)
        ):
            c += 1
    return c


def _flatten_unwanted_lists(original: str, reduced: str) -> str:
    """
    原文不是分点体时，模型若擅自改成列表，去掉列表前缀并恢复连续叙述。
    """
    if not original.strip() or not reduced.strip():
        return reduced
    if _count_list_like_lines(original) > 0:
        return reduced
    if _count_list_like_lines(reduced) < 2:
        return reduced
    out: List[str] = []
    for ln in reduced.splitlines():
        s = ln.strip()
        if not s:
            out.append("")
            continue
        s = re.sub(r"^[-*•]\s+", "", s)
        s = re.sub(r"^\d+[.)、]\s+", "", s)
        s = re.sub(r"^[一二三四五六七八九十]+、\s*", "", s)
        out.append(s)
    return "\n".join(out).strip()


def _normalize_blank_lines_by_original(original: str, reduced: str) -> str:
    """
    控制过度换行：按原文空行密度回收模型产生的大量空行。
    """
    if not reduced.strip():
        return reduced
    ob = _count_blank_lines(original)
    rb = _count_blank_lines(reduced)
    x = re.sub(r"\n\s*\n\s*\n+", "\n\n", reduced)
    if ob == 0 and rb >= 2:
        x = re.sub(r"\n\s*\n+", "\n", x)
    elif ob <= 1 and rb > ob + 3:
        x = re.sub(r"\n\s*\n+", "\n\n", x)
    return x.strip()


def _is_severe_content_loss(original: str, reduced: str) -> bool:
    """
    明显内容丢失：输出只剩标题/少量字时触发保护。
    """
    o = original.strip()
    r = reduced.strip()
    if not o or not r:
        return False
    ow = count_words(o)
    rw = count_words(r)
    if ow >= 40 and rw <= max(12, int(ow * 0.30)):
        return True
    on = len([ln for ln in o.splitlines() if ln.strip()])
    rn = len([ln for ln in r.splitlines() if ln.strip()])
    if ow >= 40 and on >= 3 and rn <= 2:
        return True
    return False


def _is_too_similar_rewrite(original: str, reduced: str) -> bool:
    """
    判断改写是否“几乎没变化”：
    - 统一空白后文本完全相同；
    - 或长段落下相似度过高（仅改了极少字符）。
    """
    o = re.sub(r"\s+", "", (original or "").strip())
    r = re.sub(r"\s+", "", (reduced or "").strip())
    if not o or not r:
        return False
    if o == r:
        return True
    # 小短句允许更接近；长段落要求必须出现可见改写
    ratio = difflib.SequenceMatcher(None, o, r).ratio()
    if len(o) >= 120 and ratio >= 0.985:
        return True
    if len(o) >= 240 and ratio >= 0.975:
        return True
    return False


def _plain_norm_similarity(a: str, b: str) -> float:
    o = re.sub(r"\s+", "", (a or "").strip())
    r = re.sub(r"\s+", "", (b or "").strip())
    if not o or not r:
        return 0.0
    return float(difflib.SequenceMatcher(None, o, r).ratio())


def _polish_output_passes_review(original: str, polished: str) -> bool:
    """
    润色结果审查：字数差须在比例内；长段相似度不得过高（几乎未改）或过低（偏离过大）。
    """
    o = (original or "").strip()
    p = (polished or "").strip()
    if not p or p == o:
        return False
    ow = count_words(o)
    pw = count_words(p)
    ratio = _plain_norm_similarity(o, p)
    if ow < 14:
        return ratio < 0.998 and bool(p)
    max_wd = max(10, int(ow * POLISH_REVIEW_WORD_DELTA_RATIO))
    if abs(ow - pw) > max_wd:
        return False
    ons = re.sub(r"\s+", "", o)
    L = len(ons)
    if L >= 90 and ratio >= POLISH_SIMILARITY_MAX_RATIO:
        return False
    if L >= 120 and ratio < POLISH_SIMILARITY_MIN_RATIO:
        return False
    return True


def _is_reduce_meta_wordcount_line(s: str) -> bool:
    """
    模型常把统计行、任务标签行混进正文，须整行剔除。
    例如「改写后文字数：…」「改写后的文字段落：」（会导致标题重复显示）。
    """
    s = s.strip()
    if not s:
        return False
    if len(s) > 200:
        return False
    patterns = (
        r"^将[“\"']?.+?[”\"']?\s*改为[“\"']?.+?[”\"']?[：:]?$",
        r"^调整后的内容[：:]",
        r"^改写文段[（(].*[）)]\s*[：:]",
        r"^改写文段\s*[：:]",
        r"^字数约为原文的\s*[0-9.]+\s*%",
        r"^改写后的?文字?段落[：:]",
        r"^改写后[的]?段落[：:]",
        r"^改写后段落全文[：:]",
        r"^改写后的?内容[：:]",
        r"^改写后段落字?数[：:]",
        r"^改写后文?字?数[（(][^）)]*[）)]?\s*[：:]",
        r"^改写后文?字?数\s*[：:]",
        r"^改写后字数[（(][^）)]*[）)]",
        r"^原文字数[（(][^）)]*[）)]?\s*[：:]",
        r"^原文字数\s*[：:]",
        r"^注[：:]\s*字数为原文的",
        r"^字数为原文的\s*[0-9.]+\s*%",
        r"^字数为原文的[0-9.]+%",
        r"^以下是改写后的内容[：:]",
        r"^Here's the rewritten paragraph:?\s*$",
        r"^内容\s*[:：]\s*[^\n]{0,120}$",
    )
    for p in patterns:
        if re.match(p, s, flags=re.I):
            return True
    # 「注：」开头的短统计句
    if re.match(r"^注[：:]", s) and ("字数" in s or "%" in s):
        return True
    # 短行 + 改写/字数 + 冒号数字（避免误伤正文长句）
    if len(s) <= 80 and re.search(r"[：:]\s*\d+", s):
        if re.search(r"改写后.*字|字.*数.*[：:]", s) or re.search(r"粗略", s):
            return True
    # 「改写后段落字数约为200。」「改写后段落字数约68」—— 无冒号，易漏网
    if re.match(r"^改写后[的]?段落字?数", s) and len(s) <= 90:
        if re.search(r"(约|约为|[：:]\s*\d)", s):
            return True
    # 套话：根据需要，修改如下：
    if re.match(r"^根据需要[，,]", s) and "如下" in s and len(s) <= 100:
        return True
    if len(s) <= 40 and re.match(r"^如[^。\n]{0,8}下[：:]\s*$", s):
        return True
    return False


def _strip_reduce_meta_noise(text: str) -> str:
    """去掉模型泄露的任务复述、字数行、英文过渡句等。"""
    t = text.strip()
    if not t:
        return t
    t = re.sub(r"(?m)^改写后段落字?数[：:].*?(\n|$)", "", t)
    t = re.sub(r"(?m)^以下是改写后的内容[：:].*?(\n|$)", "", t)
    t = re.sub(r"(?m)^Here's the rewritten paragraph:?\s*(\n|$)", "", t, flags=re.I)
    t = re.sub(r"(?m)^内容\s*[:：]\s*[^\n]{0,120}\s*(\n|$)", "", t)
    # 按行过滤（覆盖正则未写全的变体，如「改写后文字数（粗略）：197。」）
    lines = t.splitlines()
    t = "\n".join(ln for ln in lines if not _is_reduce_meta_wordcount_line(ln))
    return t.strip()


def _dedupe_leading_duplicate_headings(reduced: str) -> str:
    """
    在尚未出现正文（非标题行）前，若小节标题重复出现（中间可有空行），去掉后出现的重复行。
    典型：模型先输出「2.1 xxx」，再输出统计行，再重复一遍「2.1 xxx」。
    同编号不同措辞（4.1 A / 4.1 B）在段首连续出现时，只保留第一条。
    """
    if not reduced.strip():
        return reduced
    lines = reduced.splitlines()
    out: List[str] = []
    seen_heading: Optional[str] = None
    seen_heading_num: Optional[str] = None
    seen_body = False
    for ln in lines:
        s = ln.strip()
        if not s:
            out.append(ln)
            continue
        # 仅在段首剥除漏网的标签/统计行，避免误判「已开始正文」；进入正文后不再按行丢弃以免误伤
        if not seen_body and _is_reduce_meta_wordcount_line(s):
            continue
        if is_chapter_heading_line(s) and not seen_body:
            nk = _heading_number_prefix(s)
            if nk and seen_heading_num is not None and nk == seen_heading_num:
                continue
            if seen_heading is not None and s == seen_heading:
                continue
            seen_heading = s
            if nk:
                seen_heading_num = nk
        else:
            seen_body = True
        out.append(ln)
    return "\n".join(out)


def _looks_like_inline_number_heading(s: str) -> bool:
    """识别「1. 小节名」这类点号后为空格的提纲行（is_chapter_heading_line 要求 1.1 形式）。"""
    s = s.strip()
    if not s or len(s) > 120:
        return False
    if is_chapter_heading_line(s):
        return True
    # 兼容「1.标题」与「1. 标题」
    return bool(re.match(r"^\d+\.\s*\S", s))


def _heading_text_without_prefix(s: str) -> str:
    """去掉标题编号前缀（1.1 / 1. / 一、）后的纯文本。"""
    x = s.strip()
    x = re.sub(r"^\d+(?:\.\d+)*\.?\s*", "", x)
    x = re.sub(r"^[一二三四五六七八九十百千]+、\s*", "", x)
    x = re.sub(r"^[（(][一二三四五六七八九十]+[）)]\s*", "", x)
    return x.strip()


def _strip_spurious_child_outline_heading(original: str, reduced: str) -> str:
    """
    原文段首为「1.2 xxx」等多级编号时，模型有时在标题后再插一行「1. xxx」提纲，正文被挤掉。
    若输出首行已与原文标题一致，则删除紧跟的、编号为原文「上一级」的提纲行（如 1.2 后多出的「1. …」）。
    """
    if not original.strip() or not reduced.strip():
        return reduced
    o0 = original.splitlines()[0].strip()
    if not is_chapter_heading_line(o0):
        return reduced
    on = _heading_number_prefix(o0)
    if not on or "." not in on:
        return reduced
    parent = on.split(".")[0]
    lines = reduced.splitlines()
    idx = [i for i, ln in enumerate(lines) if ln.strip()]
    if len(idx) < 2:
        return reduced
    i0, i1 = idx[0], idx[1]
    a, b = lines[i0].strip(), lines[i1].strip()
    if a != o0 or not _looks_like_inline_number_heading(b):
        return reduced
    bn = _heading_number_prefix(b)
    if not bn:
        return reduced
    if bn == parent and bn != on:
        del lines[i1]
        return "\n".join(lines)
    return reduced


def _dedupe_adjacent_headings(original: str, reduced: str) -> str:
    """去掉模型多打的一行小节标题（如 1.1 后又跟 1. 同义标题）。"""
    if not original.strip() or not reduced.strip():
        return reduced
    o0 = original.splitlines()[0].strip()
    lines = reduced.splitlines()
    idx = [i for i, ln in enumerate(lines) if ln.strip()]
    if len(idx) < 2:
        return reduced
    i0, i1 = idx[0], idx[1]
    a, b = lines[i0].strip(), lines[i1].strip()
    if not (is_chapter_heading_line(a) and is_chapter_heading_line(b)):
        return reduced
    # 前两行非空均为同一条小节标题：只保留一行
    if a == b:
        del lines[i1]
        return "\n".join(lines)
    # 与原文首行一致：保留与原文一致的那一行
    if o0 and a == o0 and b != o0:
        del lines[i1]
        return "\n".join(lines)
    if o0 and b == o0 and a != o0:
        del lines[i0]
        return "\n".join(lines)
    # 去空格后一行包含另一行（简略版重复）
    sa, sb = re.sub(r"\s+", "", a), re.sub(r"\s+", "", b)
    if len(sa) >= 4 and len(sb) >= 4:
        if sa in sb and len(sb) > len(sa):
            del lines[i0]
            return "\n".join(lines)
        if sb in sa and len(sa) > len(sb):
            del lines[i1]
            return "\n".join(lines)
    # 同编号小节标题连续出现、措辞略不同（如 4.1 技术选型 / 4.1 技术选择）
    ka, kb = _heading_number_prefix(a), _heading_number_prefix(b)
    if (
        ka
        and ka == kb
        and is_chapter_heading_line(a)
        and is_chapter_heading_line(b)
    ):
        if o0:
            ao = o0.strip()
            if a.strip() == ao:
                del lines[i1]
                return "\n".join(lines)
            if b.strip() == ao:
                del lines[i0]
                return "\n".join(lines)
        del lines[i1]
        return "\n".join(lines)
    return reduced


def sanitize_reduce_output(original: str, reduced: str) -> str:
    """
    模型（尤其小体量/对话向）易在后续段落「跑偏」：复述任务、泄露原则、中英混写。
    与「是否重置会话」无关（Ollama 单次请求本就不带多轮历史）；此处做确定性清洗。
    """
    if not reduced.strip():
        return reduced
    t = reduced.strip()
    t = _strip_model_think_blocks(t)
    t = _strip_explicit_reasoning_noise(t)
    t = _strip_reduce_meta_noise(t)
    t = _strip_reduce_chinese_preamble(t)
    t = _strip_reviewer_prompt_echo(t)
    t = _strip_leading_english_meta_preface(t, original)
    # 原文未出现“文章结构安排”时，清理模型擅自追加的结构分析段
    if (
        "文章结构安排" not in original
        and "本文结构安排" not in original
        and "研究内容涵盖" not in original
        and re.search(r"(文章|本文)结构安排如下[：:]|研究内容涵盖[：:]", t)
    ):
        t = re.sub(
            r"(?s)\n?(?:文章|本文)结构安排如下[：:].*$|\n?研究内容涵盖[：:].*$",
            "",
            t,
            count=1,
        ).strip()
    t = _flatten_unwanted_lists(original, t)
    t = _normalize_blank_lines_by_original(original, t)
    # 去标题重复/同编号重复：多轮直到稳定（去掉中间统计行后可能仍剩连续标题）
    for _ in range(5):
        t2 = _strip_spurious_child_outline_heading(original, t)
        t2 = _dedupe_adjacent_headings(original, t2)
        t2 = _dedupe_leading_duplicate_headings(t2)
        if t2 == t:
            break
        t = t2
    return t.strip()


def looks_like_instruction_leakage(text: str) -> bool:
    """启发式：草稿是否混入了任务说明/索要输入。"""
    if not text:
        return False
    needles = (
        "请提供一段",
        "我将按照以上原则",
        "以下原则",
        "问题诊断",
        "自检报告",
        "Here's the rewritten",
        "改写后段落字数",
        "改写后文字数",
        "改写后的文字段落",
        "根据需要",
        "修改如下",
        "字数为原文的",
        "只输出改写后的段落原文",
        "可能由 AI 生成",
        "I'll focus on rewriting",
    )
    return any(n in text for n in needles)


def ensure_leading_section_heading_line(original: str, reduced: str) -> str:
    """
    原文段首为小节标题时，强制以原文标题行为准：
    - 首个非空行不是标题：补回原文标题；
    - 首个非空行是其它标题（即使同编号不同措辞）：替换为原文标题；
    - 标题后若继续出现其它标题行（含「1. xxx」提纲），在正文出现前全部剔除。
    """
    if not original.strip() or not reduced.strip():
        return reduced
    o_lines = original.splitlines()
    if not o_lines:
        return reduced
    h = o_lines[0].strip()
    if not is_chapter_heading_line(h):
        return reduced
    r_lines = reduced.splitlines()
    fi = 0
    while fi < len(r_lines) and not r_lines[fi].strip():
        fi += 1
    if fi >= len(r_lines):
        return h + "\n" + reduced

    first = r_lines[fi].strip()
    if first != h:
        if is_chapter_heading_line(first) or _looks_like_inline_number_heading(first):
            r_lines[fi] = h
        else:
            r_lines.insert(fi, h)

    h_text = _heading_text_without_prefix(h)
    # 标题后到正文前，删除重复/漂移标题（含“研究背景与意义”这种无编号重复）
    i = fi + 1
    while i < len(r_lines):
        s = r_lines[i].strip()
        if not s:
            i += 1
            continue
        s_text = _heading_text_without_prefix(s)
        if (
            is_chapter_heading_line(s)
            or _looks_like_inline_number_heading(s)
            or (h_text and s_text == h_text)
        ):
            del r_lines[i]
            continue
        break
    return "\n".join(r_lines)


def finalize_reduce_text(original: str, reduced: str) -> str:
    """降 AIGC 最终后处理：清洗元话语 → 补回段首标题 → 统一标题后空行。"""
    if not reduced:
        return reduced
    x = sanitize_reduce_output(original, reduced)
    x = strip_runaway_leading_abstract_labels(x)
    x = ensure_leading_section_heading_line(original, x)
    x = _split_glued_heading_body(original, x)
    x = normalize_heading_spacing_after_model(original, x)
    return postprocess_model_output_quality(x)


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    nickname: Optional[str] = None


class LoginRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    updated_existing: bool = False


class UserInfo(BaseModel):
    id: str
    email: str
    nickname: Optional[str] = None


class PointsState(BaseModel):
    points: int
    dailyFreePoints: int = 0
    writableWords: int = 0
    balanceYuan: float = 0.0
    membershipTier: str = "none"
    adWatchesToday: int = 0
    adDailyLimit: Optional[int] = 10
    dailyFreeCap: int = 888
    dailyFreeGrant: int = 888
    adRewardGrant: int = 2888
    signInGrant: int = 888
    signIn: Dict[str, Any]


class MembershipActivateRequest(BaseModel):
    tier: Literal["monthly", "premium"]
    trialDays: Optional[int] = None


class MembershipActivateResponse(BaseModel):
    ok: bool
    tier: str
    grantedPoints: int
    writableWords: int
    reason: Optional[str] = None


class AdminRedeemCodeCreateRequest(BaseModel):
    rewardKind: Literal["points", "balance_yuan"]
    amount: float
    scope: Literal["all", "single"]
    restrictUserId: Optional[str] = None
    restrictEmail: Optional[EmailStr] = None
    maxUses: int = 1
    expiresAt: Optional[datetime] = None
    quantity: int = 1


class RedeemUseRequest(BaseModel):
    code: str = Field(..., min_length=4, max_length=40)


class RedeemUseResponse(BaseModel):
    ok: bool
    reason: str
    points: Optional[int] = None
    balanceYuan: Optional[float] = None


class AdWatchTicketCreateResponse(BaseModel):
    ticketId: str
    watchUrl: str
    expiresAt: str


class AdWatchTicketStatusResponse(BaseModel):
    status: str
    points: Optional[int] = None


class AdWatchQrResponse(BaseModel):
    imageBase64: str
    watchUrl: str


class AdWatchCompleteRequest(BaseModel):
    ticketId: str
    sig: str
    exp: int


class AdWatchCompleteResponse(BaseModel):
    ok: bool
    reason: str
    points: Optional[int] = None


class SigninResponse(BaseModel):
    gained: int
    streak: int
    points: int


class SendEmailCodeRequest(BaseModel):
    email: EmailStr
    purpose: Literal["register"] = "register"
    captcha_token: Optional[str] = None
    local_captcha_id: Optional[str] = None
    local_captcha_answer: Optional[str] = None


class LocalCaptchaChallengeResponse(BaseModel):
    captcha_id: str
    question: str
    expires_in_seconds: int = 180


class EmailRegisterWithCodeRequest(BaseModel):
    email: EmailStr
    password: str
    code: str
    nickname: Optional[str] = None


class SimpleOkResponse(BaseModel):
    ok: bool
    detail: Optional[str] = None


class QrLoginSessionCreateRequest(BaseModel):
    frontend_origin: Optional[str] = None


class QrLoginSessionCreateResponse(BaseModel):
    session_id: str
    qr_url: str
    expires_in_seconds: int


class QrLoginSessionStatusResponse(BaseModel):
    status: Literal["pending", "approved", "expired"]
    access_token: Optional[str] = None


class QrLoginApproveRequest(BaseModel):
    email: EmailStr
    password: str


def compute_signin_reward(streak: int, tier: str = "none") -> int:
    """每日签到奖励（按会员档位）。"""
    from pricing import signin_grant_for_tier

    _ = streak
    return signin_grant_for_tier(tier)


TaskMode = Literal["polish", "reduce"]


class CreateTaskRequest(BaseModel):
    mode: TaskMode
    # 可选：如果传 raw_text，就按空行/换行拆段；如果传 paragraphs，就直接用
    raw_text: Optional[str] = None
    paragraphs: Optional[List[str]] = None


class TaskParagraph(BaseModel):
    index: int
    wordCount: int
    original: str
    polished: str


class TaskDetail(BaseModel):
    id: str
    userId: str
    mode: TaskMode
    status: str
    createdAt: str
    title: str  # 展示用论文标题（取自首段首行等）
    paragraphs: List[TaskParagraph]


class ExportResponse(BaseModel):
    taskId: str
    fullText: str


class FeedbackCreateRequest(BaseModel):
    category: Literal["bug", "feature", "experience", "other", "membership"] = "experience"
    content: str
    contact: Optional[str] = None


class FeedbackItem(BaseModel):
    id: str
    userId: str
    userEmail: str
    category: str
    content: str
    adminReply: Optional[str] = None
    contact: Optional[str] = None
    status: Literal["open", "processing", "closed"] = "open"
    createdAt: str
    updatedAt: str


class FeedbackAdminPatchRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")
    status: Optional[Literal["open", "processing", "closed"]] = None
    admin_reply: Optional[str] = Field(default=None, alias="adminReply")


def _feedback_item_from_row(db: Session, row: _entities.Feedback) -> FeedbackItem:
    owner = auth_repo.get_user_by_id(db, row.user_id)
    return FeedbackItem(
        id=row.id,
        userId=row.user_id,
        userEmail=owner.email if owner else "",
        category=row.category,
        content=row.content,
        adminReply=row.admin_reply,
        contact=row.contact,
        status=row.status,  # type: ignore[arg-type]
        createdAt=row.created_at.isoformat(),
        updatedAt=row.updated_at.isoformat(),
    )


FEEDBACK_IMAGE_MAX_BYTES = 4 * 1024 * 1024


def _feedback_uploads_dir() -> Path:
    d = Path(__file__).resolve().parent / "static" / "feedback-uploads"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _detect_feedback_image_ext(blob: bytes) -> Optional[str]:
    if len(blob) < 12:
        return None
    if blob.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if blob.startswith(b"\x89PNG\r\n\x1a\n") or blob.startswith(b"\x89PNG\n"):
        return ".png"
    if blob.startswith(b"GIF87a") or blob.startswith(b"GIF89a"):
        return ".gif"
    if blob[:4] == b"RIFF" and blob[8:12] == b"WEBP":
        return ".webp"
    return None


async def _save_feedback_uploaded_image(upload: UploadFile) -> str:
    raw = await upload.read()
    if len(raw) > FEEDBACK_IMAGE_MAX_BYTES:
        raise HTTPException(status_code=400, detail="Image too large (max 4MB)")
    ext = _detect_feedback_image_ext(raw)
    if not ext:
        raise HTTPException(status_code=400, detail="Unsupported image type")
    name = f"{uuid.uuid4().hex}{ext}"
    dest = _feedback_uploads_dir() / name
    dest.write_bytes(raw)
    return f"/static/feedback-uploads/{name}"


class DailyMetricPoint(BaseModel):
    date: str
    activeUsers: int
    adViews: int
    wordsUsed: int


class AdminOverviewResponse(BaseModel):
    userCount: int
    monthlyActiveUsers: int
    totalAdViews: int
    totalWordsQuota: int
    usedWordsQuota: int
    openFeedbackCount: int
    totalTasksCount: int
    dailyMetrics: List[DailyMetricPoint]
    users: List[Dict[str, Any]]


oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def _parse_cors_allow_origins() -> List[str]:
    """
    浏览器把 localhost 与 127.0.0.1 视为不同源；Vite 端口被占用时会顺延 5174、5175…
    未配置 CORS_ALLOW_ORIGINS 时用下面列表 + 见 _cors_allow_origin_regex 的本地端口正则。
    上线请设置 CORS_ALLOW_ORIGINS 为真实前端域名（逗号分隔），此时不再启用本地正则。
    """
    raw = os.getenv("CORS_ALLOW_ORIGINS", "").strip()
    if raw:
        return [x.strip() for x in raw.split(",") if x.strip()]
    return [
        "http://localhost:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
    ]


def _use_dev_wildcard_cors() -> bool:
    """
    本地开发若未显式配置 CORS_ALLOW_ORIGINS，直接使用 * 避免端口漂移造成登录失败。
    上线请配置 CORS_ALLOW_ORIGINS（逗号分隔）以收紧来源。
    """
    return not bool(os.getenv("CORS_ALLOW_ORIGINS", "").strip())


class Settings:
    # 线上多实例部署时请设置 JWT_SECRET_KEY，否则各实例默认密钥一致但本地验证码 JWT 会无法跨实例（且不安全）
    jwt_secret_key = os.getenv("JWT_SECRET_KEY", "dev-secret-change-me").strip() or "dev-secret-change-me"
    access_token_expire_minutes = 60 * 24
    cors_allow_all_dev = _use_dev_wildcard_cors()
    cors_allow_origins = _parse_cors_allow_origins()
    turnstile_secret_key = os.getenv("TURNSTILE_SECRET_KEY", "").strip()
    smtp_host = os.getenv("SMTP_HOST", "smtp.qq.com").strip()
    smtp_port = int(os.getenv("SMTP_PORT", "465").strip() or "465")
    smtp_user = os.getenv("SMTP_USER", "").strip()
    smtp_password = os.getenv("SMTP_PASSWORD", "").strip()
    smtp_from_email = os.getenv("SMTP_FROM_EMAIL", "").strip()
    smtp_from_name = os.getenv("SMTP_FROM_NAME", "论文润色助手").strip()


settings = Settings()


def _ad_watch_public_base() -> str:
    return (os.getenv("AD_WATCH_PUBLIC_BASE") or "http://127.0.0.1:8000").rstrip("/")


def _ad_watch_reward_points() -> int:
    return pricing_ad_watch_reward_points()


def _model_inference_disabled() -> bool:
    return os.getenv("MODEL_INFERENCE_DISABLED", "0").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )


def _ad_watch_hmac_secret() -> str:
    s = (os.getenv("AD_WATCH_HMAC_SECRET") or "").strip()
    return s or "dev-ad-watch-hmac-change-me"


def _ad_watch_ttl_seconds() -> int:
    return int((os.getenv("AD_WATCH_TICKET_TTL_SECONDS") or "900").strip() or "900")


def _ad_watch_sign(ticket_id: str, user_id: str, exp_unix: int) -> str:
    msg = f"{ticket_id}|{user_id}|{exp_unix}".encode("utf-8")
    return hmac.new(_ad_watch_hmac_secret().encode("utf-8"), msg, hashlib.sha256).hexdigest()


def _ad_watch_verify(ticket_id: str, user_id: str, exp_unix: int, sig: str) -> bool:
    expect = _ad_watch_sign(ticket_id, user_id, exp_unix)
    return hmac.compare_digest(expect, sig)


def _ad_watch_qr_png_base64(url: str) -> str:
    import qrcode

    buf = io.BytesIO()
    img = qrcode.make(url, box_size=6, border=2)
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


LOCAL_CAPTCHA_TTL_SECONDS = 180
LOCAL_CAPTCHA_JWT_TYP = "lc"
QR_LOGIN_TTL_SECONDS = 180
_qr_login_store: Dict[str, Dict[str, Any]] = {}
_qr_login_lock = threading.Lock()


def verify_turnstile_token(token: Optional[str], remote_ip: Optional[str] = None) -> bool:
    # 未配置密钥时不强制人机校验（便于本地开发）。
    if not settings.turnstile_secret_key:
        return True
    if not token:
        return False
    payload = {
        "secret": settings.turnstile_secret_key,
        "response": token.strip(),
    }
    if remote_ip:
        payload["remoteip"] = remote_ip
    data = urllib.parse.urlencode(payload).encode("utf-8")
    req = urllib.request.Request(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        data=data,
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            return bool(body.get("success"))
    except Exception:
        return False


def create_local_captcha_challenge() -> LocalCaptchaChallengeResponse:
    """无状态本地验证码：JWT 存在 captcha_id 中，适配多 worker / 云端扩容。"""
    a = random.randint(1, 9)
    b = random.randint(1, 9)
    ans = str(a + b)
    now = _now_utc()
    exp = now + timedelta(seconds=LOCAL_CAPTCHA_TTL_SECONDS)
    payload: Dict[str, Any] = {
        "t": LOCAL_CAPTCHA_JWT_TYP,
        "ans": ans,
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
    }
    token = jwt.encode(payload, settings.jwt_secret_key, algorithm=JWT_ALG)
    return LocalCaptchaChallengeResponse(
        captcha_id=token,
        question=f"{a} + {b} = ?",
        expires_in_seconds=LOCAL_CAPTCHA_TTL_SECONDS,
    )


def verify_local_captcha(captcha_id: Optional[str], answer: Optional[str]) -> bool:
    if not captcha_id or answer is None or str(answer).strip() == "":
        return False
    try:
        payload = jwt.decode(
            captcha_id.strip(),
            settings.jwt_secret_key,
            algorithms=[JWT_ALG],
        )
        if payload.get("t") != LOCAL_CAPTCHA_JWT_TYP:
            return False
        return str(payload.get("ans", "")).strip() == str(answer).strip()
    except JWTError:
        return False


def _cleanup_qr_login_sessions(now: Optional[datetime] = None) -> None:
    now_dt = now or _now_utc()
    with _qr_login_lock:
        expired = [sid for sid, item in _qr_login_store.items() if item["expires_at"] < now_dt]
        for sid in expired:
            _qr_login_store.pop(sid, None)


def _normalize_frontend_origin(origin: Optional[str]) -> str:
    raw = (origin or "").strip()
    if raw.startswith("http://") or raw.startswith("https://"):
        return raw.rstrip("/")
    return "http://localhost:5173"


def _send_email_code_via_smtp(to_email: str, code: str, expires_minutes: int = 10) -> None:
    if not settings.smtp_user or not settings.smtp_password:
        raise HTTPException(status_code=500, detail="邮件服务未配置：缺少 SMTP_USER 或 SMTP_PASSWORD")

    sender_email = settings.smtp_from_email or settings.smtp_user
    subject = "邮箱验证码"
    html = f"""
<div style="font-family:Arial,'Microsoft YaHei',sans-serif;line-height:1.75;color:#0f172a">
  <h3 style="margin:0 0 8px">邮箱验证码</h3>
  <p style="margin:0 0 10px">你的验证码是：</p>
  <p style="font-size:30px;font-weight:700;letter-spacing:4px;margin:0 0 10px">{code}</p>
  <p style="margin:0 0 6px;color:#475569">验证码 {expires_minutes} 分钟内有效，请勿泄露给他人。</p>
</div>
""".strip()

    msg = MIMEText(html, "html", "utf-8")
    msg["Subject"] = Header(subject, "utf-8")
    msg["From"] = formataddr((settings.smtp_from_name, sender_email))
    msg["To"] = to_email

    try:
        # Windows 等环境下本机主机名含中文时，EHLO 可能触发 UnicodeEncodeError，需固定 ASCII local_hostname
        with smtplib.SMTP_SSL(
            settings.smtp_host,
            settings.smtp_port,
            timeout=20,
            local_hostname="127.0.0.1",
        ) as smtp:
            smtp.login(settings.smtp_user, settings.smtp_password)
            smtp.sendmail(sender_email, [to_email], msg.as_string())
    except Exception as exc:
        print(f"[SMTP_ERROR] {type(exc).__name__}: {exc}")
        raise HTTPException(
            status_code=500,
            detail="验证码邮件发送失败：请确认云端已配置 SMTP_*（授权码）、465 出站未被防火墙拦截，并查看服务器日志 [SMTP_ERROR]",
        ) from exc


def create_access_token(user_id: str) -> str:
    now = _now_utc()
    exp = now + timedelta(minutes=settings.access_token_expire_minutes)
    payload = {"sub": user_id, "iat": int(now.timestamp()), "exp": int(exp.timestamp())}
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=JWT_ALG)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return pwd_context.verify(password, password_hash)


async def get_current_user(
    token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)
) -> Dict[str, Any]:
    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[JWT_ALG])
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    user_obj = auth_repo.get_user_by_id(db, str(user_id))
    if user_obj and user_obj.is_banned:
        raise HTTPException(status_code=403, detail="ACCOUNT_BANNED")
    user = (
        {"id": user_obj.id, "email": user_obj.email, "nickname": user_obj.nickname}
        if user_obj
        else None
    )
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


def _admin_email_allowlist() -> Optional[set[str]]:
    return admin_email_allowlist()


async def require_admin_user(
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    allow = _admin_email_allowlist()
    if allow is None:
        return user
    email = (user.get("email") or "").strip().lower()
    if email not in allow:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access denied")
    return user


DEFAULT_WORD_QUOTA = 120000

# 开发环境默认账号：避免你刚启动/重启后因为内存数据丢失导致无法登录
DEFAULT_EMAIL = "kiter"
DEFAULT_PASSWORD = "poki123"
DEFAULT_NICKNAME = "管理员"


def _collapse_reference_paragraphs(parts: List[str]) -> List[str]:
    """
    从首个以「参考文献」开头的段落起合并到列表末尾，使参考文献在 UI 中只占一个对比框。
    空段落会剔除；合并段之间用双换行拼接，以贴近常见排版。
    """
    if not parts:
        return parts
    idx = -1
    for i, p in enumerate(parts):
        s = p.strip()
        if s and re.match(r"^参考文献\s*", s):
            idx = i
            break
    if idx < 0:
        return [p.strip() for p in parts if p.strip()]
    head = [p.strip() for p in parts[:idx] if p.strip()]
    tail = [p.strip() for p in parts[idx:] if p.strip()]
    if not tail:
        return head
    merged = "\n\n".join(tail)
    return head + ([merged] if merged else [])


def _split_inline_keyword_paragraph(p: str) -> List[str]:
    """
    若一段末尾以换行或空格接上「关键词：…」「关键字：…」，拆成两段，
    便于第二段单独标记为跳过模型改写（与 _detach_inline_keyword_suffix 规则对齐）。
    亦处理「…管理关键词：」等关键词前无空格、与正文紧贴的常见排版。
    """
    s = (p or "").strip()
    if not s:
        return []
    lines = s.splitlines()
    for j in range(1, len(lines)):
        ln = lines[j].strip()
        if re.match(r"^(关键词|关键字)\s*[：:]", ln):
            head = "\n".join(lines[:j]).strip()
            tail = "\n".join(lines[j:]).strip()
            if len(head) >= 8 and len(tail) >= 4:
                return [head, tail]
            break
    for label in ("关键词", "关键字"):
        m = re.search(rf"(?s)^(.+?)(\s+{label}\s*[：:].+)$", s)
        if m and len(m.group(1).strip()) >= 8 and len(m.group(2).strip()) >= 4:
            return [m.group(1).rstrip(), m.group(2).strip()]
    # 句末标点后的「关键词：」或全文最后一次「关键词：」（紧贴前文无空格）
    for label in ("关键词", "关键字"):
        m = re.search(rf"(?s)^(.+?)([。！？…；;]\s*{label}\s*[：:].+)$", s)
        if m and len(m.group(1).strip()) >= 8 and len(m.group(2).strip()) >= 4:
            punct, rest = m.group(2)[0], m.group(2)[1:].lstrip()
            return [(m.group(1).rstrip() + punct).rstrip(), rest]
    best: Optional[Tuple[int, str, str]] = None
    for label in ("关键词", "关键字"):
        for m in re.finditer(rf"{label}\s*[：:]", s):
            pos = m.start()
            if pos < 8:
                continue
            head = s[:pos].rstrip()
            tail = s[pos:].strip()
            if len(head) < 8 or len(tail) < 4:
                continue
            if "；" in tail or ";" in tail or "、" in tail or len(tail) <= 220:
                cand = (pos, head, tail)
                if best is None or pos >= best[0]:
                    best = cand
    if best:
        return [best[1], best[2]]
    return [s]


def _expand_paragraphs_with_inline_keywords(parts: List[str]) -> List[str]:
    out: List[str] = []
    for p in parts:
        out.extend(_split_inline_keyword_paragraph(p))
    return [x for x in out if x.strip()]


def _finalize_paragraph_list(parts: List[str]) -> List[str]:
    """先拆出段末关键词块，再合并参考文献，供建任务分段使用。"""
    return _collapse_reference_paragraphs(_expand_paragraphs_with_inline_keywords(parts))


def split_into_paragraphs(req: CreateTaskRequest) -> List[str]:
    if req.paragraphs and len(req.paragraphs) > 0:
        return _finalize_paragraph_list([p.strip() for p in req.paragraphs if p.strip()])

    if not req.raw_text:
        return []

    def looks_like_paper_title_line(curr: str, next_line: Optional[str]) -> bool:
        """
        识别文稿最前面的论文题目行，避免被当作可处理段落。
        典型：第一行是标题，第二行是「摘要：」/「Abstract」等标签。
        """
        if not curr or not next_line:
            return False
        if len(curr) > 80:
            return False
        if curr.endswith(("。", "！", "？", ".", "!", "?")):
            return False
        if is_chapter_heading_line(curr):
            return False
        if re.match(r"^(摘要|abstract|关键词|关键字)\s*[：:]?.*$", curr, flags=re.IGNORECASE):
            return False
        nxt = next_line.strip()
        if re.match(r"^(摘要|abstract|关键词|关键字)\s*[：:]?.*$", nxt, flags=re.IGNORECASE):
            return True
        if is_chapter_heading_line(nxt):
            return True
        return False

    # 优先按空行拆分；如果空行拆分只得到 1 段（常见于只有单换行、没有空行的文本），
    # 则退化为按单行换行拆分，避免把整篇当成“一大段”。
    blocks = [b.strip() for b in re.split(r"\n\s*\n", req.raw_text) if b.strip()]
    if len(blocks) > 1:
        # 同样处理“标题行误入第1段”：若首段很短且次段是摘要/关键词/章节起始，则去掉首段
        first = blocks[0].strip() if blocks else ""
        second_first_line = ""
        if len(blocks) >= 2:
            second_lines = [ln.strip() for ln in blocks[1].splitlines() if ln.strip()]
            second_first_line = second_lines[0] if second_lines else ""
        if looks_like_paper_title_line(first, second_first_line):
            blocks = blocks[1:]
        return _finalize_paragraph_list(blocks)

    # 仅有单换行（无空行分段）时：按“段落”更贴近论文排版的方式做合并。
    # 目标：把类似“摘要：/关键词：”这类只起到标记作用的行，合并到后续正文所在段落，
    # 避免前端每一行都单独渲染成一个边框。
    lines = [line.strip() for line in req.raw_text.splitlines() if line.strip()]

    # 文稿首行若是“题目行”，从分段列表中去掉（题目用于展示，不作为待改写段落）
    if len(lines) >= 2 and looks_like_paper_title_line(lines[0], lines[1]):
        lines = lines[1:]

    def is_label_line(s: str) -> bool:
        # 摘要/关键词/引言等：常见就是“摘要：”单独一行
        # 「参考文献：」若以短行+冒号规则会被误判为标记行并挂到 [1] 上，需排除。
        if re.match(r"^参考文献\s*", s):
            return False
        label_words = ["摘要", "关键词", "引言", "结论", "方法", "结果", "讨论", "致谢"]
        for w in label_words:
            if re.fullmatch(rf"{w}\s*[：:]*\s*", s):
                return True
        # 或者以冒号结尾且非常短：当作标记行
        if len(s) <= 20 and (s.endswith("：") or s.endswith(":")):
            return True
        return False

    def is_reference_heading(s: str) -> bool:
        # 参考文献：允许“参考文献（示例格式）”“参考文献：”等变体
        return bool(re.match(r"^参考文献\s*[（(]?.*", s))

    def is_short_title_prefix(curr: str, next_line: Optional[str]) -> bool:
        if not next_line:
            return False
        if is_label_line(next_line):
            # 标题行通常不以句号结尾，长度相对短
            if len(curr) <= 40 and not curr.endswith(("。", "！", "？", ".", "!", "?")):
                return True
        return False

    paragraphs: List[str] = []
    pending_prefix = ""  # 等后续正文再“挂”到同一个段落里

    i = 0
    while i < len(lines):
        curr = lines[i]
        next_line = lines[i + 1] if i + 1 < len(lines) else None

        # 参考文献：标题与后续各条合并为一段，避免每条单独一框
        if is_reference_heading(curr):
            buf_ref: List[str] = [curr]
            i += 1
            while i < len(lines):
                buf_ref.append(lines[i])
                i += 1
            merged_ref = "\n".join(buf_ref).strip()
            if merged_ref:
                paragraphs.append(merged_ref)
            continue

        # 标记行：先缓存起来，等遇到下一行正文再一起拼成段落
        if is_label_line(curr) or is_short_title_prefix(curr, next_line):
            pending_prefix = (pending_prefix + ("\n" if pending_prefix else "") + curr).strip()
            i += 1
            continue

        # 认为 curr 是正文起点：拼上 pending_prefix
        buf_lines: List[str] = []
        if pending_prefix:
            buf_lines.append(pending_prefix)
            pending_prefix = ""
        buf_lines.append(curr)
        i += 1

        # 继续吸收后续“正文延续行”：遇到章节标题或标记行就停止
        while i < len(lines):
            nxt = lines[i]
            if is_chapter_heading_line(nxt) or is_label_line(nxt):
                break
            # 下一行起为「参考文献」整块：在此结束当前段，避免把标题并入正文
            if is_reference_heading(nxt):
                break
            # 如果下一行也像“短标题前缀（后接摘要/关键词等）”，也不继续吸收
            if is_short_title_prefix(nxt, lines[i + 1] if i + 1 < len(lines) else None):
                break
            buf_lines.append(nxt)
            i += 1

        paragraph = "\n".join(buf_lines).strip()
        if paragraph:
            paragraphs.append(paragraph)

    return _finalize_paragraph_list(paragraphs)


def mock_polish(mode: TaskMode, original: str) -> str:
    if mode == "polish":
        sp = split_paper_abstract_block(original)
        if sp:
            prefix, body, suffix = sp
            new_body = f"{body}（优化示例）" if body.strip() else body
            out = prefix + strip_redundant_leading_abstract_label(prefix, new_body)
            if suffix:
                out += f"\n{suffix}"
            return out
        return f"{original}（优化示例）"
    # reduce 初始阶段先不做重写，等用户点击“重降AIGC当前段”再用 Ollama 处理
    return original


def is_skip_polish_or_reduce(original: str) -> bool:
    """
    哪些段落不需要做“润色/降AIGC”，直接跳过。
    主要覆盖：
    - 整段仅为单行章节标题（如「一、引言」「1.1 研究背景」）
    - 参考文献相关标题（允许参考文献独立成框，但不处理）
    - 大标题/展望类标题（例如“未来工作将从以下方向展开：”）
    """
    text = str(original).strip()
    if not text:
        return False

    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    first_line = lines[0] if lines else ""

    # 整段只有一行且为章节/小节标题：不降重、不改写（避免误把「一、引言」交给模型）
    if len(lines) == 1 and is_chapter_heading_line(lines[0]):
        return True

    # 参考文献：通常不做润色/降重（允许“参考文献（示例格式）”“参考文献：”等）
    if re.match(r"^参考文献\s*[:：]?\s*.*$", first_line):
        return True

    # 摘要/致谢：仅标签行、无正文时不做降重/润色
    if re.match(r"^(摘要|致谢)\s*[:：]?\s*$", first_line):
        return True
    # 「关键词：…」「关键字：…」整段（含分拆后的关键词段）保持原样
    if re.match(r"^(关键词|关键字)(\s*[：:].*|\s*)$", first_line):
        return True

    # 大标题/展望类：仅当“整段只有标题”时跳过；若后面已有正文/条目，不应跳过
    if len(lines) == 1 and first_line.endswith(("：", ":")):
        keywords = ["未来工作", "展望", "结论"]
        return any(k in first_line for k in keywords)

    return False


PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
MODEL_DIR = os.getenv("LOCAL_MODEL_DIR", os.path.join(PROJECT_ROOT, "kiterforth"))
DEFAULT_RUNTIME_MODEL = os.getenv("LOCAL_MODEL_NAME", "@kiterforth")
RUNTIME_REDUCE_MODEL = os.getenv("LOCAL_REDUCE_MODEL", DEFAULT_RUNTIME_MODEL)
RUNTIME_POLISH_MODEL = os.getenv("LOCAL_POLISH_MODEL", DEFAULT_RUNTIME_MODEL)
MODEL_DEVICE = os.getenv("LOCAL_MODEL_DEVICE", "auto").strip() or "auto"
MODEL_DTYPE = os.getenv("LOCAL_MODEL_DTYPE", "auto").strip().lower()
# 降 AIGC：略提高 temperature，弱化「过于规整」的模板感
REDUCE_TEMPERATURE = float(os.getenv("LOCAL_REDUCE_TEMPERATURE", "0.78"))
REDUCE_TOP_P = float(os.getenv("LOCAL_REDUCE_TOP_P", "0.93"))
REDUCE_NUM_PREDICT = int(os.getenv("LOCAL_REDUCE_MAX_NEW_TOKENS", "1024"))
# 整段产出与原文字数差超过该阈值、或与原文几乎相同时，追加重试生成
REDUCE_RETRY_MAX_WORD_DELTA = int(os.getenv("REDUCE_RETRY_MAX_WORD_DELTA", "30"))
# 兼容旧名：REDUCE_WORDCOUNT_MISMATCH_RETRIES 表示「额外次数」，新变量表示「含首次在内的总生成次数」
_reduce_total = os.getenv("REDUCE_REVIEW_MAX_ATTEMPTS", "").strip()
if _reduce_total:
    REDUCE_REVIEW_MAX_ATTEMPTS = max(1, int(_reduce_total))
else:
    REDUCE_REVIEW_MAX_ATTEMPTS = max(
        1, int(os.getenv("REDUCE_WORDCOUNT_MISMATCH_RETRIES", "2")) + 1
    )
REDUCE_WORDCOUNT_MISMATCH_RETRIES = max(0, REDUCE_REVIEW_MAX_ATTEMPTS - 1)  # 保留供内部注释与旧逻辑理解
# 降 AIGC：长段若与原文相似度过低（可能跑题/乱改），与字数、过近一并纳入重试条件；设为 0 关闭
REDUCE_SIMILARITY_MIN_RATIO = float(os.getenv("REDUCE_SIMILARITY_MIN_RATIO", "0"))
# 降 AIGC：按标点切段时每段最大字符数（依次请求模型后再拼接）
REDUCE_CHUNK_MAX_CHARS = int(os.getenv("REDUCE_CHUNK_MAX_CHARS", "70"))
# 润色：略低 temperature，偏稳；仍可单独调
POLISH_TEMPERATURE = float(os.getenv("LOCAL_POLISH_TEMPERATURE", "0.58"))
POLISH_TOP_P = float(os.getenv("LOCAL_POLISH_TOP_P", "0.9"))
POLISH_NUM_PREDICT = int(os.getenv("LOCAL_POLISH_MAX_NEW_TOKENS", "1024"))
# 润色：服务端按字数差与文本相似度审查，未达标则同一段最多再 POLISH_REVIEW_MAX_ATTEMPTS-1 次
POLISH_REVIEW_MAX_ATTEMPTS = max(1, int(os.getenv("POLISH_REVIEW_MAX_ATTEMPTS", "3")))
POLISH_REVIEW_WORD_DELTA_RATIO = float(os.getenv("POLISH_REVIEW_WORD_DELTA_RATIO", "0.38"))
POLISH_SIMILARITY_MAX_RATIO = float(os.getenv("POLISH_SIMILARITY_MAX_RATIO", "0.989"))
POLISH_SIMILARITY_MIN_RATIO = float(os.getenv("POLISH_SIMILARITY_MIN_RATIO", "0.76"))
# 第二遍「审稿」：从跑偏输出中只抽正文（可选）
REVIEWER_ENABLED = os.getenv("LOCAL_REVIEWER_ENABLED", "0") == "1"
REVIEWER_MODEL = os.getenv("LOCAL_REVIEWER_MODEL", DEFAULT_RUNTIME_MODEL)

# 远程推理：OpenAI 兼容 Chat Completions（推荐阿里云百炼 compatible-mode / vLLM / AutoDL 等）。
# 设置 REMOTE_INFERENCE_URL 后不再加载本地权重。
REMOTE_INFERENCE_URL = os.getenv("REMOTE_INFERENCE_URL", "").strip()
REMOTE_INFERENCE_MODEL = os.getenv(
    "REMOTE_INFERENCE_MODEL", "qwen2.5-7b-instruct-306e22f5efa6-1"
).strip()
REMOTE_INFERENCE_API_KEY = (
    os.getenv("REMOTE_INFERENCE_API_KEY", "").strip()
    or os.getenv("DASHSCOPE_API_KEY", "").strip()
)
REMOTE_INFERENCE_TIMEOUT = int(os.getenv("REMOTE_INFERENCE_TIMEOUT", "300"))
# 百炼 Qwen3 等：关闭思考链，避免输出  块（compatible-mode 对应 extra_body.enable_thinking）
REMOTE_INFERENCE_ENABLE_THINKING = os.getenv("REMOTE_INFERENCE_ENABLE_THINKING", "0") == "1"
# 1=只发段落正文（适合已微调部署）；0=与本地相同，附带 system 提示词（适合通用 instruct）
REMOTE_INFERENCE_BODY_ONLY = os.getenv("REMOTE_INFERENCE_BODY_ONLY", "1") == "1"
# 远程降重/润色单次 completion 的 max_tokens 上限（中文长段若过小易被截断，接在下一段会显得像「幻觉」）
REMOTE_REDUCE_MAX_TOKENS = int(os.getenv("REMOTE_REDUCE_MAX_TOKENS", "3072"))


def _use_remote_inference() -> bool:
    return bool(REMOTE_INFERENCE_URL)


def _resolve_runtime_model(model: Optional[str] = None, *, mode: str = "reduce") -> str:
    """远程推理固定用 REMOTE_INFERENCE_MODEL，避免把本地别名 @kiterforth 发给百炼。"""
    if _use_remote_inference():
        return REMOTE_INFERENCE_MODEL
    explicit = (model or "").strip()
    if explicit:
        return explicit
    return RUNTIME_REDUCE_MODEL if mode == "reduce" else RUNTIME_POLISH_MODEL


def _is_dashscope_compatible(url: str) -> bool:
    return "dashscope.aliyuncs.com" in (url or "").lower()


def _normalize_remote_chat_url(url: str) -> str:
    """补全为 POST /v1/chat/completions（支持只填 AutoDL 映射根，如 https://xxx:8443）。"""
    u = (url or "").strip()
    if not u:
        return u
    if "chat/completions" in u:
        return u
    base = u.rstrip("/")
    low = base.lower()
    if low.endswith("/v1"):
        return base + "/chat/completions"
    return base + "/v1/chat/completions"


_REMOTE_HTTP_CLIENT: Any = None
_REMOTE_HTTP_LOCK = threading.Lock()


def _get_remote_http_client() -> Any:
    """复用 HTTPS 连接，减少 AutoDL 等远程推理每次请求的 TLS 握手开销。"""
    global _REMOTE_HTTP_CLIENT
    import httpx

    with _REMOTE_HTTP_LOCK:
        if _REMOTE_HTTP_CLIENT is None:
            _REMOTE_HTTP_CLIENT = httpx.Client(
                timeout=httpx.Timeout(REMOTE_INFERENCE_TIMEOUT, connect=30.0),
                limits=httpx.Limits(max_keepalive_connections=5, max_connections=10),
            )
        return _REMOTE_HTTP_CLIENT


def _remote_chat_sync(
    _model: str,
    prompt: str,
    *,
    system: Optional[str] = None,
    temperature: float = 0.35,
    top_p: float = 0.9,
    num_predict: Optional[int] = None,
) -> str:
    """
    POST OpenAI 兼容 /v1/chat/completions（百炼 compatible-mode / vLLM / AutoDL 等）。
    非百炼端点：远程微调模型约定合并 system 进 user，避免独立 system 干扰文段改写。
    百炼 compatible-mode：使用标准 system + user 消息；Qwen 系列默认 enable_thinking=false。
    """
    messages: List[Dict[str, str]] = []
    merge_system = not _is_dashscope_compatible(REMOTE_INFERENCE_URL)
    if system and system.strip():
        if merge_system:
            messages.append({"role": "user", "content": f"{system.strip()}\n\n{prompt}"})
        else:
            messages.append({"role": "system", "content": system.strip()})
            messages.append({"role": "user", "content": prompt})
    else:
        messages.append({"role": "user", "content": prompt})
    payload: Dict[str, Any] = {
        "model": REMOTE_INFERENCE_MODEL,
        "messages": messages,
        "temperature": float(temperature),
        "top_p": float(top_p),
        "max_tokens": int(num_predict if num_predict is not None else REDUCE_NUM_PREDICT),
    }
    if _is_dashscope_compatible(REMOTE_INFERENCE_URL):
        payload["enable_thinking"] = REMOTE_INFERENCE_ENABLE_THINKING
    endpoint = _normalize_remote_chat_url(REMOTE_INFERENCE_URL)
    import httpx

    client = _get_remote_http_client()
    h = {"Content-Type": "application/json; charset=utf-8"}
    if REMOTE_INFERENCE_API_KEY:
        h["Authorization"] = f"Bearer {REMOTE_INFERENCE_API_KEY}"
    try:
        r = client.post(endpoint, json=payload, headers=h)
        r.raise_for_status()
        raw = r.json()
    except httpx.HTTPStatusError as e:
        body = (e.response.text or "")[:2000] if e.response is not None else ""
        print("[remote_inference] HTTPError:", e.response.status_code if e.response else "?", body)
        return ""
    except httpx.RequestError as e:
        print("[remote_inference] transport:", str(e))
        return ""
    except Exception as e:
        print("[remote_inference] error:", str(e))
        return ""

    choices = raw.get("choices") or []
    if not choices:
        return ""
    msg = choices[0].get("message") or {}
    content = str(msg.get("content") or "").strip()
    if content:
        return content
    # 少数兼容实现把文本放在其它字段
    return str(raw.get("response") or raw.get("text") or "").strip()


_LOCAL_MODEL_LOCK = threading.Lock()
_LOCAL_MODEL: Any = None
_LOCAL_TOKENIZER: Any = None
_LOCAL_MODEL_PATH: Optional[str] = None
_TORCH: Any = None


def _resolve_model_path(model: str) -> str:
    candidate = (model or "").strip()
    if candidate.startswith("@"):
        candidate = candidate[1:]
    if os.path.isabs(candidate) and os.path.isdir(candidate):
        return candidate
    if candidate:
        repo_local = os.path.join(PROJECT_ROOT, candidate)
        if os.path.isdir(repo_local):
            return repo_local
    return MODEL_DIR


def _load_local_model(model: str) -> Tuple[Any, Any]:
    global _LOCAL_MODEL, _LOCAL_TOKENIZER, _LOCAL_MODEL_PATH, _TORCH
    model_path = _resolve_model_path(model)
    with _LOCAL_MODEL_LOCK:
        if _LOCAL_MODEL is not None and _LOCAL_TOKENIZER is not None and _LOCAL_MODEL_PATH == model_path:
            return _LOCAL_TOKENIZER, _LOCAL_MODEL

        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer

        dtype_map = {
            "float16": torch.float16,
            "fp16": torch.float16,
            "bfloat16": torch.bfloat16,
            "bf16": torch.bfloat16,
            "float32": torch.float32,
            "fp32": torch.float32,
        }
        kwargs: Dict[str, Any] = {"trust_remote_code": True}
        if MODEL_DTYPE in dtype_map:
            kwargs["torch_dtype"] = dtype_map[MODEL_DTYPE]
        if MODEL_DEVICE == "auto":
            kwargs["device_map"] = "auto"

        tokenizer = AutoTokenizer.from_pretrained(model_path, trust_remote_code=True, use_fast=True)
        model_obj = AutoModelForCausalLM.from_pretrained(model_path, **kwargs)
        if MODEL_DEVICE not in ("auto", "cuda"):
            model_obj = model_obj.to(MODEL_DEVICE)
        if tokenizer.pad_token_id is None and tokenizer.eos_token_id is not None:
            tokenizer.pad_token = tokenizer.eos_token
        model_obj.eval()

        _TORCH = torch
        _LOCAL_TOKENIZER = tokenizer
        _LOCAL_MODEL = model_obj
        _LOCAL_MODEL_PATH = model_path
        return tokenizer, model_obj


def _build_prompt(tokenizer: Any, prompt: str, system: Optional[str]) -> str:
    messages: List[Dict[str, str]] = []
    if system and system.strip():
        messages.append({"role": "system", "content": system.strip()})
    messages.append({"role": "user", "content": prompt})

    apply_template = getattr(tokenizer, "apply_chat_template", None)
    if callable(apply_template):
        try:
            return tokenizer.apply_chat_template(
                messages,
                tokenize=False,
                add_generation_prompt=True,
            )
        except Exception:
            pass
    if system and system.strip():
        return f"[系统]\n{system.strip()}\n\n[用户]\n{prompt}\n\n[助手]\n"
    return f"[用户]\n{prompt}\n\n[助手]\n"


def _local_chat_sync(
    model: str,
    prompt: str,
    *,
    system: Optional[str] = None,
    temperature: float = 0.35,
    top_p: float = 0.9,
    num_predict: Optional[int] = None,
) -> str:
    tokenizer, model_obj = _load_local_model(model)
    rendered_prompt = _build_prompt(tokenizer, prompt, system)
    inputs = tokenizer(rendered_prompt, return_tensors="pt")
    if hasattr(model_obj, "device"):
        inputs = {k: v.to(model_obj.device) for k, v in inputs.items()}

    max_new_tokens = int(num_predict if num_predict is not None else REDUCE_NUM_PREDICT)
    do_sample = temperature > 0
    with _TORCH.inference_mode():
        output_ids = model_obj.generate(
            **inputs,
            max_new_tokens=max_new_tokens,
            temperature=max(0.01, float(temperature)),
            top_p=float(top_p),
            do_sample=do_sample,
            pad_token_id=tokenizer.pad_token_id,
            eos_token_id=tokenizer.eos_token_id,
        )
    new_tokens = output_ids[0][inputs["input_ids"].shape[-1] :]
    return tokenizer.decode(new_tokens, skip_special_tokens=True).strip()


def select_runtime_model(mode: str, task_id: str, idx: int, original: str) -> str:
    _ = (task_id, idx, original)
    return _resolve_runtime_model(mode=mode)


async def model_chat_for_text(
    model: str,
    prompt: str,
    *,
    system: Optional[str] = None,
    temperature: float = 0.35,
    top_p: float = 0.9,
    num_predict: Optional[int] = None,
) -> str:
    if _model_inference_disabled():
        print("[model_chat_for_text] MODEL_INFERENCE_DISABLED=1, skip remote/local inference")
        return ""
    try:
        if _use_remote_inference():
            return await asyncio.to_thread(
                _remote_chat_sync,
                model,
                prompt,
                system=system,
                temperature=temperature,
                top_p=top_p,
                num_predict=num_predict,
            )
        return await asyncio.to_thread(
            _local_chat_sync,
            model,
            prompt,
            system=system,
            temperature=temperature,
            top_p=top_p,
            num_predict=num_predict,
        )
    except Exception as e:
        print("[model_chat_for_text] error:", str(e))
        return ""


REDUCE_SYSTEM_STRICT = (
    "你是「论文章节改写」工具，不是聊天助手。"
    "硬性要求：只输出改写后的正文段落，禁止输出任何其它内容。"
    "禁止：思考过程、原则列表、向用户索要原文、复述本任务、中英夹杂的计划句。"
    "若输入为中文：禁止输出英文句子、英文从句、中英混写；不要用英文复述或解释原文；"
    "除品牌名、文献题名、必要缩写（如 API、LLM）外不得无故插入英文。"
    "禁止出现：「以下是」「改写后段落字数」「改写后段落字数约为」「改写后文字数」「原文字数」"
    "「字数为原文的百分之几」「注：字数为原文」「改写后的文字段落：」「根据需要，修改如下」"
    "等统计或说明行；不要重复抄写小节标题。"
    "禁止出现：「请提供」「Here's」「I will」等套话。"
    "中文论文必须使用简体汉字（除必要外文专名、缩写、公式）。\n"
)

REDUCE_PERSONA_RULE = (
    "【写作水平】模拟普通本科生/课程论文：句子不必像期刊那样滴水不漏，可略松散、偶有口语化衔接，"
    "但必须可读、可交作业。\n"
    "【反 AI 痕迹】当前稿面疑似 AI 率偏高：少用「综上所述」「值得注意的是」「众所周知」"
    "「首先…其次…最后…」等高频模板与对称排比；不必追求教科书式严谨闭环，允许论证略跳跃、侧写式说明。\n"
    "【内容】保持原意与核心信息，不增删事实、不编造数据；以换句式、换词、拆并句为主。\n"
)

REDUCE_LANG_RULE = (
    "【语言】输出语言必须与输入完全一致：若原文为中文，则改写结果必须通篇为中文，"
    "不得输出英文说明句、英文括号注释或英文段落；"
    "禁止用「higher education…」「rapid development…」这类英文从句替代中文表述；"
    "仅在必要时保留外文专名、缩写、文献题名。"
    "不要复述任务要求或元话语（例如不要写 In this paragraph / The goal is 等）。\n"
    "【格式】不要添加任何前言、总结或对话式套话；禁止以「根据您的要求」「以下是」「如下内容」等开头；"
    "不要加引号包裹全文；直接输出改写后的正文。\n"
    "【排版】保持与原文一致：若小节标题（如 1.1、一、）与下一段正文之间原文没有空行，则不要在标题后单独空一行；"
    "若原文在标题与正文之间有空行，则保留一行空行。不要随意增删标题后的换行。\n"
    "【换行】若原文标题单独成行、正文另起一行，改写后必须把标题与正文分成两行，禁止把标题与正文首句接在同一行。\n"
    "【小节标题】若原文以「1.3 xxx」「一、xxx」等形式的小节标题开头，改写后必须保留该行（可微调措辞但须保留编号），"
    "不得删除该标题行、不得将标题并入下一句。\n"
    "【序号】保留原文中的枚举与编号形式：如 (1)(2)(3)、（一）（二）、①、1. 2. 3. 等；"
    "若原文已用括号序号或阿拉伯数字分条，不得擅自改为「首先、其次、再次、最后」等衔接词。\n"
    "【完整性】禁止用提纲、枚举小标题或一两行概括代替正文；正文必须是完整叙述，"
    "篇幅与原文同量级，不得把正文缩成新的「1. xxx」小节标题；除段首与原文一致的小节标题外，"
    "不要新增其它编号标题行。\n"
)

# 与 paper-humanizer-zh 思路一致：去模板化、降可检测 AI 痕迹；API 只收正文，故禁止模型输出诊断/自检段落
REDUCE_HUMANIZER_ZH_RULE = (
    "【去 AI 痕迹（人类化）】减少套话与空泛价值句；避免机械堆叠「此外/另外/同时/最后」；"
    "避免句句长度过于一致；少用万能升华式结尾；优先把抽象说法改具体，而非堆砌形容词。事实、数字、专名、引用与论证链条不得编造，核心信息不得无故删除。\n"
    "【输出边界】只输出改写后的正文段落；禁止输出「问题诊断」「自检报告」「各维度打分」"
    "「调整后的内容」等任何附加块；不要编号列举诊断项。\n"
)

# 润色专用：人设 +「话术」式软约束（引导模型像学长改稿，而非评审）
POLISH_PUA_FRAME = (
    "【协作人设】你是耐心带毕设/课程论文的高年级学长或学姐：默认写作者已经尽力，"
    "你只帮「把句子顺一顺、把搭配改自然、把标点理顺」。\n"
    "【话术心智】语气友好、具体、不居高临下；禁止「你的论文很差」「必须全部重写」等压迫表述；"
    "禁止「下面我逐条说明」「总结如下」等元话语或教学腔。\n"
    "【效果目标】读起来像学生自己对着改了三遍的稿子，而不是模板一键生成。\n"
)

POLISH_FORMAT_RULE = (
    "【输出】只输出润色后的段落正文，不要前言、摘要式总括、对话或编号式点评。"
    "不要加引号包裹全文；不要擅自加例子、数据或新论点。\n"
)

POLISH_LAYOUT_RULE = (
    "【排版】保持小节标题与编号与原文一致；若原文有 (1)(2) 或 1. 2. 分条，不要改成「首先、其次」等衔接词。\n"
    "【换行】若原文中小节标题单独成行、正文另起一行，润色后也必须保持标题行与正文行分离，"
    "不要把标题与正文首句写在同一行。\n"
)

POLISH_SYSTEM_STRICT = (
    "你是论文润色工具，不是聊天助手。只输出润色后的正文段落。"
    "禁止：思考过程、中英夹杂说明、教学腔点评、元话语。"
    "若原文为中文：禁止在润色结果中插入英文句子或英文从句；除专名与必要缩写外不得混写英文。"
    "在保持学术语体的前提下适度去模板化：少套话、少对称排比、连接词勿过密，句长可有节制变化；"
    "具体化优于辞藻堆砌；禁止输出诊断/自检/打分等非正文块。"
    "禁止输出字数统计、百分比、「注：字数为原文」等与正文无关的说明行；不要重复抄写小节标题。"
    "中文须用简体（除专名外文）。\n"
)


def _strip_model_think_blocks(text: str) -> str:
    """去掉 Qwen 等模型偶发在正文前输出的 think 代码块（仅剥离开头一段）。"""
    t = text.strip()
    if not t:
        return t
    # 仅处理「全文以 `...` 思考块开头」的情况，避免误伤正文中的反引号
    t = re.sub(r"^`\s*[\s\S]*?`\s*", "", t, count=1).strip()
    # 兼容 <think>...</think> 样式
    t = re.sub(r"(?is)^<think>[\s\S]*?</think>\s*", "", t, count=1).strip()
    return t


def _strip_explicit_reasoning_noise(text: str) -> str:
    """
    去掉显式“思考/推理”噪声。仅在段首剥离，降低误删风险。
    """
    t = text.strip()
    if not t:
        return t
    lines = t.splitlines()
    i = 0
    while i < len(lines):
        s = lines[i].strip()
        if not s:
            i += 1
            continue
        if re.match(r"^(思考|推理|分析|解题思路|处理思路)\s*[：:]", s):
            i += 1
            continue
        if re.match(r"^(让我|我先|先来|下面我先|首先我会)\S{0,24}(分析|思考|说明)", s):
            i += 1
            continue
        break
    return "\n".join(lines[i:]).strip()


def _strip_reduce_chinese_preamble(text: str) -> str:
    """去掉模型偶发附加的说明性前缀（与 prompt 双保险）。"""
    t = text.strip()
    if not t:
        return t
    patterns = [
        r"^根据您的要求[，,][^\n]{0,200}[:：]\s*",
        r"^根据[^\n]{0,40}要求[，,][^\n]{0,120}[:：]\s*",
        r"^根据需要[，,][^\n]{0,200}如下[：:]?\s*",
        r"^以下是[^\n]{0,80}[:：]\s*",
        r"^如下(?:内容)?[:：]\s*",
        r"^改写(?:后)?(?:如下|如下)[:：]?\s*",
    ]
    for _ in range(3):
        prev = t
        for p in patterns:
            t = re.sub(p, "", t, count=1, flags=re.MULTILINE).strip()
        if t == prev:
            break
    # 误把正文当套话剥光时，保留原输出
    if not t:
        return text.strip()
    if len(t) < max(15, len(text.strip()) * 0.12) and len(text.strip()) > 80:
        return text.strip()
    return t


def _strip_reviewer_prompt_echo(text: str) -> str:
    """
    reviewer_fix_chinese_strip_english 等在 user 里拼接「【原文】/【草稿】」；
    少数模型会把整段提示标签复述进输出，污染参考文献等块。
    """
    if "【原文】" not in text and "【草稿】" not in text:
        return text
    out_lines: List[str] = []
    for ln in text.splitlines():
        s = ln.strip()
        if s.startswith("【原文】") or s.startswith("【草稿】"):
            continue
        if re.match(r"^（请将其中英文改为中文）\s*$", s):
            continue
        out_lines.append(ln)
    return "\n".join(out_lines).strip()


WORDCOUNT_TOLERANCE_RATIO = 0.12  # 允许的相对偏差
WORDCOUNT_TOLERANCE_ABS = 25  # 允许的最大绝对偏差


def _offline_reduce_fallback(text: str) -> str:
    """
    Ollama 未返回、或返回与原文相同时的兜底：轻度中文措辞替换，
    避免「降 AIGC 后」与原文完全一致（仍建议检查 Ollama 与模型名）。
    """
    if not text.strip():
        return text
    out = text
    pairs = [
        ("与此同时", "同时"),
        ("因此", "因而"),
        ("此外", "另外"),
        ("然而", "不过"),
        ("目前", "当前"),
        ("在此背景下", "在此语境下"),
        ("本文旨在", "本研究旨在"),
        ("本文提出", "本研究提出"),
        ("综上所述", "总体来看"),
    ]
    changed = 0
    for a, b in pairs:
        if a in out:
            out2 = out.replace(a, b, 1)
            if out2 != out:
                out = out2
                changed += 1
            if changed >= 3:
                break
    # 常见连接词再试一轮（避免与上一轮重复）
    pairs2 = [
        ("可以认为", "不妨认为"),
        ("具有重要意义", "具有关键意义"),
        ("以及", "和"),
        ("通过", "借助"),
        ("并", "并且"),
    ]
    for a, b in pairs2:
        if a in out:
            out2 = out.replace(a, b, 1)
            if out2 != out:
                out = out2
                changed += 1
            if changed >= 6:
                break
    if out != text:
        return out
    # 最后手段：首处逗号改分号，保持可读且与原文可区分（仍建议接通 Ollama）
    if out == text and "，" in text:
        return text.replace("，", "；", 1)
    if out == text and "；" in text:
        return text.replace("；", "，", 1)
    if out == text and "。" in text:
        return text.replace("。", "；", 1)
    if out == text and "的" in text:
        return text.replace("的", "之", 1)
    return out


def build_reduce_system_and_user(
    text: str, target_wc: int, max_delta: int, strict: bool
) -> Tuple[str, str]:
    """
    system：硬性约束 + 语言 + 人设 + 字数（长指令放 system，user 只放原文，减轻「复述任务」）。
    """
    range_min = max(1, target_wc - max_delta)
    range_max = max(range_min, target_wc + max_delta)
    extra = (
        "字数控制：改写后段落字数必须落在 "
        f"{range_min} ~ {range_max} 之间，不要明显变短或变长。"
        if strict
        else
        "字数尽量接近原文，不要明显增减。"
    )
    lang = detect_language_directive(text)
    system = (
        f"{REDUCE_SYSTEM_STRICT}\n"
        f"{lang}\n"
        f"{REDUCE_PERSONA_RULE}\n"
        f"{REDUCE_HUMANIZER_ZH_RULE}\n"
        f"{REDUCE_LANG_RULE}\n"
        f"【字数】{extra}\n"
    )
    user = (
        "请改写下面这一段（保持原意、不编造数据）。\n"
        f"原文字数（粗略）：{target_wc}。\n\n"
        f"{text}"
    )
    return system, user


def _remote_segment_num_predict(text: str, default_cap: int) -> int:
    """
    远程「文段进文段出」：按原文字数估算 max_tokens，且受 REMOTE_REDUCE_MAX_TOKENS 封顶。
    旧版用 LOCAL_REDUCE_MAX_NEW_TOKENS（常 1024）封顶，长段中文易被截断，导出拼接后像跑题/幻觉。
    """
    wc = max(1, count_words(text))
    est = int(wc * 2.2)
    ceiling = max(default_cap, REMOTE_REDUCE_MAX_TOKENS)
    return max(96, min(ceiling, max(192, est)))


async def reviewer_extract_body(original: str, draft: str) -> str:
    """第二遍：从跑偏草稿中只抽正文（可选）。"""
    system = (
        "你只输出论文正文段落，不要任何解释。"
        "删除草稿中的：任务原则、列表、英文计划、中英夹杂说明、向用户索要原文的句子。"
    )
    user = (
        "从下面「草稿」中只保留改写后的正文，删去所有元话语与说明。\n\n"
        f"【原文参考】\n{original[:1500]}\n\n"
        f"【草稿】\n{draft[:8000]}"
    )
    out = await model_chat_for_text(
        REVIEWER_MODEL,
        user,
        system=system,
        temperature=0.15,
        top_p=0.85,
        num_predict=REDUCE_NUM_PREDICT,
    )
    out = _strip_model_think_blocks(out)
    out = _strip_reduce_chinese_preamble(out)
    return out.strip() if out.strip() else draft


def is_chinese_dominant_paragraph(text: str) -> bool:
    """与 detect_language_directive 一致：本段是否应以中文为主。"""
    t = text.strip()
    if not t:
        return False
    cjk = len(re.findall(r"[\u4e00-\u9fff]", t))
    latin = len(re.findall(r"[a-zA-Z]", t))
    return cjk >= 8 and cjk >= latin * 0.35


def detect_english_contamination_in_chinese_output(original: str, reduced: str) -> bool:
    """
    中文为主的原文，模型却在改写稿中混入大段英文从句/英文句时返回 True，
    用于触发第二遍「只把英文改回中文」的补救。
    """
    if not reduced.strip():
        return False
    if not is_chinese_dominant_paragraph(original):
        return False
    lat_o = len(re.findall(r"[a-zA-Z]", original))
    lat_r = len(re.findall(r"[a-zA-Z]", reduced))
    cjk_o = len(re.findall(r"[\u4e00-\u9fff]", original))
    # 原文几乎无英文，输出却出现大量拉丁字母
    if lat_o <= max(12, cjk_o // 50) and lat_r > 18:
        return True
    if lat_r > lat_o * 2.0 + 28:
        return True
    long_runs = re.findall(r"[a-zA-Z]{3,}(?:\s+[a-zA-Z]{2,}){4,}", reduced)
    if long_runs and sum(len(x) for x in long_runs) > 40:
        return True
    return False


async def reviewer_fix_chinese_strip_english(
    original: str, draft: str, *, model: str, num_predict: int
) -> str:
    """
    第二遍：专门把中文段落里误插入的英文句/从句改回通顺中文（不改变整体结构）。
    """
    system = (
        "你是中文学术编辑。下面「草稿」本应是中文论文段落，却混入了英文句子或英文从句。"
        "请把其中应译为中文的英文全部改写为通顺的简体中文，保持原意与逻辑衔接；"
        "仅保留必要的专有名词、产品名、框架名与常见缩写（如 Python、FastAPI、Grammarly、LLM、API 等）。"
        "不要写任何解释、前言或字数说明；只输出修正后的段落全文。"
    )
    user = (
        "【原文】\n"
        f"{original[:3000]}\n\n"
        "【草稿】（请将其中英文改为中文）\n"
        f"{draft[:8500]}"
    )
    out = await model_chat_for_text(
        model,
        user,
        system=system,
        temperature=0.1,
        top_p=0.82,
        num_predict=num_predict,
    )
    out = _strip_model_think_blocks(out)
    out = _strip_reduce_chinese_preamble(out)
    return out.strip() if out.strip() else draft


def build_polish_system_and_user(text: str) -> Tuple[str, str]:
    lang = detect_language_directive(text)
    system = (
        f"{POLISH_SYSTEM_STRICT}\n"
        f"{lang}\n"
        f"{POLISH_PUA_FRAME}\n"
        f"{POLISH_FORMAT_RULE}\n"
        f"{POLISH_LAYOUT_RULE}\n"
    )
    user = f"请润色下面这一段：\n\n{text}"
    return system, user


async def polish_with_model(original: str, *, model: Optional[str] = None) -> str:
    """润色：走本地模型；若为「摘要」结构则只润色正文部分。"""
    runtime_model = _resolve_runtime_model(model, mode="polish")
    sp = split_paper_abstract_block(original)
    if sp:
        prefix, body, suffix = sp
        if not body.strip():
            return original
        polished = await _polish_body(body, model=runtime_model)
        out = prefix + strip_redundant_leading_abstract_label(prefix, polished.strip())
        if suffix:
            out += f"\n{suffix}"
        return postprocess_model_output_quality(out)
    body_out = await _polish_body(original, model=runtime_model)
    return postprocess_model_output_quality(body_out)


async def polish_with_model_reviewed(original: str, *, model: Optional[str] = None) -> str:
    """
    润色 + 审查：字数差与改写前后相似度均达标才返回；否则同一段最多生成 POLISH_REVIEW_MAX_ATTEMPTS 次，
    仍不达标则返回最后一次结果（由上层再做字数蒸发等兜底）。
    """
    runtime_model = _resolve_runtime_model(model, mode="polish")
    last = ""
    for _ in range(POLISH_REVIEW_MAX_ATTEMPTS):
        cand = await polish_with_model(original, model=runtime_model)
        last = cand
        if _polish_output_passes_review(original, cand):
            return cand
    return last


async def _polish_body(text: str, *, model: str) -> str:
    if _use_remote_inference() and REMOTE_INFERENCE_BODY_ONLY:
        np = _remote_segment_num_predict(text, POLISH_NUM_PREDICT)
        out = await model_chat_for_text(
            model,
            text,
            system=None,
            temperature=POLISH_TEMPERATURE,
            top_p=POLISH_TOP_P,
            num_predict=np,
        )
    elif _use_remote_inference():
        psys, puser = build_polish_system_and_user(text)
        np = _remote_segment_num_predict(text, POLISH_NUM_PREDICT)
        out = await model_chat_for_text(
            model,
            puser,
            system=psys,
            temperature=POLISH_TEMPERATURE,
            top_p=POLISH_TOP_P,
            num_predict=np,
        )
    else:
        psys, puser = build_polish_system_and_user(text)
        out = await model_chat_for_text(
            model,
            puser,
            system=psys,
            temperature=POLISH_TEMPERATURE,
            top_p=POLISH_TOP_P,
            num_predict=POLISH_NUM_PREDICT,
        )
    out = _strip_model_think_blocks(out)
    out = _strip_reduce_chinese_preamble(out)
    out = sanitize_reduce_output(text, out)
    out = strip_runaway_leading_abstract_labels(out)
    if not out.strip():
        return text
    if detect_english_contamination_in_chinese_output(text, out):
        fixed = await reviewer_fix_chinese_strip_english(
            text,
            out,
            model=model,
            num_predict=POLISH_NUM_PREDICT,
        )
        if fixed.strip():
            out = fixed.strip()
    out = ensure_leading_section_heading_line(text, out)
    out = _split_glued_heading_body(text, out)
    out = normalize_heading_spacing_after_model(text, out)
    out = _normalize_blank_lines_by_original(text, out)
    if _is_severe_content_loss(text, out):
        return text
    return out.strip()


def _needs_reduce_rerun(original_full: str, reduced_full: str) -> bool:
    """字数差过大、与原文几乎相同、或相似度过低（偏离过大）时触发外层重试。"""
    o = (original_full or "").strip()
    r = (reduced_full or "").strip()
    if not o:
        return False
    ow = count_words(o)
    if ow < 40:
        return False
    if not r.strip():
        return True
    pw = count_words(r)
    if abs(ow - pw) > REDUCE_RETRY_MAX_WORD_DELTA:
        return True
    if _is_too_similar_rewrite(o, r):
        return True
    ratio = _plain_norm_similarity(o, r)
    ons = re.sub(r"\s+", "", o)
    if REDUCE_SIMILARITY_MIN_RATIO > 0 and len(ons) >= 260 and ratio < REDUCE_SIMILARITY_MIN_RATIO:
        return True
    return False


async def reduce_with_wordcount_control(text: str, *, model: Optional[str] = None) -> str:
    """
    降 AIGC：输出尽量与原文字数接近，偏差过大则在后台重改一次。
    若为「标题 + 摘要： + 正文 + 关键词」结构，仅改写摘要正文，标题/摘要行/关键词行原样保留。
    外层：字数差、过近相似度、（可选）过低相似度任一不达标时重生成，整段最多生成 REDUCE_REVIEW_MAX_ATTEMPTS 次。
    """
    runtime_model = _resolve_runtime_model(model, mode="reduce")

    async def _build_full_once(retry_attempt: int) -> str:
        sp = split_paper_abstract_block(text)
        if sp:
            prefix, body, suffix = sp
            if not body.strip():
                return text
            reduced = await _reduce_body_with_wordcount(
                body, model=runtime_model, retry_attempt=retry_attempt
            )
            stripped = strip_redundant_leading_abstract_label(prefix, reduced.strip())
            if not stripped.strip() and reduced.strip():
                stripped = reduced.strip()
            out = prefix + stripped
            if suffix:
                out += f"\n{suffix}"
            return out
        return await _reduce_body_with_wordcount(
            text, model=runtime_model, retry_attempt=retry_attempt
        )

    out = await _build_full_once(0)
    for attempt in range(1, REDUCE_REVIEW_MAX_ATTEMPTS):
        if not _needs_reduce_rerun(text, out):
            break
        out = await _build_full_once(attempt)
        if not _needs_reduce_rerun(text, out):
            break
    return out


def _split_paragraph_into_reduce_chunks(text: str, max_chars: int) -> List[str]:
    """
    按逗号、句号等标点切句并合并为每块长度 ≤ max_chars（字符数），
    供逐块调用模型；块之间拼接无额外字符（与原文字符流连续）。
    """
    s = text.replace("\r\n", "\n").strip()
    if not s:
        return []
    max_chars = max(24, int(max_chars))
    if len(s) <= max_chars:
        return [s]
    pieces = [p for p in re.split(r"([，。！？；、,.!?;:\n])", s) if p]
    chunks: List[str] = []
    buf = ""
    for p in pieces:
        if len(buf) + len(p) <= max_chars:
            buf += p
            continue
        if buf.strip():
            chunks.append(buf.strip())
        if len(p) > max_chars:
            w = p
            while len(w) > max_chars:
                chunks.append(w[:max_chars])
                w = w[max_chars:]
            buf = w
        else:
            buf = p
    if buf.strip():
        chunks.append(buf.strip())
    return [c for c in chunks if c]


async def _reduce_body_with_wordcount(text: str, *, model: str, retry_attempt: int = 0) -> str:
    """
    对单段正文做降 AIGC（字数控制）。
    超过 REDUCE_CHUNK_MAX_CHARS 时按标点切为更短子句，依次调用模型后拼接。
    """
    chunks = _split_paragraph_into_reduce_chunks(text, REDUCE_CHUNK_MAX_CHARS)
    if len(chunks) <= 1:
        return await _reduce_body_monolith(text, model=model, retry_attempt=retry_attempt)
    parts: List[str] = []
    for ck in chunks:
        if not ck.strip():
            continue
        parts.append(await _reduce_body_monolith(ck, model=model, retry_attempt=retry_attempt))
    return "".join(parts)


async def _reduce_body_monolith(text: str, *, model: str, retry_attempt: int = 0) -> str:
    """
    对一整块正文做单次（或 strict 二轮）降 AIGC；由 _reduce_body_with_wordcount 按子句调度。
    """
    original_wc = count_words(text)
    max_delta = int(max(5, min(WORDCOUNT_TOLERANCE_ABS, original_wc * WORDCOUNT_TOLERANCE_RATIO)))

    if _use_remote_inference() and REMOTE_INFERENCE_BODY_ONLY:
        np = _remote_segment_num_predict(text, REDUCE_NUM_PREDICT)
        t0 = min(1.0, REDUCE_TEMPERATURE + 0.08 * max(0, retry_attempt))
        tp0 = min(0.98, REDUCE_TOP_P + 0.015 * max(0, retry_attempt))
        first = await model_chat_for_text(
            model,
            text,
            system=None,
            temperature=t0,
            top_p=tp0,
            num_predict=np,
        )
        if _is_too_similar_rewrite(text, first):
            first_retry = await model_chat_for_text(
                model,
                text,
                system=None,
                temperature=min(1.0, REDUCE_TEMPERATURE + 0.22 + 0.05 * max(0, retry_attempt)),
                top_p=min(0.98, REDUCE_TOP_P + 0.03 + 0.01 * max(0, retry_attempt)),
                num_predict=np,
            )
            if first_retry.strip():
                first = first_retry
    elif _use_remote_inference():
        sys0, user0 = build_reduce_system_and_user(
            text=text, target_wc=original_wc, max_delta=max_delta, strict=False
        )
        np = _remote_segment_num_predict(text, REDUCE_NUM_PREDICT)
        t0 = min(1.0, REDUCE_TEMPERATURE + 0.08 * max(0, retry_attempt))
        tp0 = min(0.98, REDUCE_TOP_P + 0.015 * max(0, retry_attempt))
        first = await model_chat_for_text(
            model,
            user0,
            system=sys0,
            temperature=t0,
            top_p=tp0,
            num_predict=np,
        )
        if _is_too_similar_rewrite(text, first):
            sys1, user1 = build_reduce_system_and_user(
                text=text, target_wc=original_wc, max_delta=max_delta, strict=True
            )
            first_retry = await model_chat_for_text(
                model,
                user1,
                system=sys1,
                temperature=min(1.0, REDUCE_TEMPERATURE + 0.22 + 0.05 * max(0, retry_attempt)),
                top_p=min(0.98, REDUCE_TOP_P + 0.03 + 0.01 * max(0, retry_attempt)),
                num_predict=np,
            )
            if first_retry.strip():
                first = first_retry
    else:
        sys0, user0 = build_reduce_system_and_user(
            text=text, target_wc=original_wc, max_delta=max_delta, strict=False
        )
        first = await model_chat_for_text(
            model,
            user0,
            system=sys0,
            temperature=min(1.0, REDUCE_TEMPERATURE + 0.06 * max(0, retry_attempt)),
            top_p=REDUCE_TOP_P,
        )
    first = _strip_model_think_blocks(first)
    first = _strip_reduce_chinese_preamble(first)
    if REVIEWER_ENABLED and (
        looks_like_instruction_leakage(first) or len(first) > len(text) * 2.2
    ):
        first = await reviewer_extract_body(text, first)
    if detect_english_contamination_in_chinese_output(text, first):
        fixed = await reviewer_fix_chinese_strip_english(
            text,
            first,
            model=model,
            num_predict=REDUCE_NUM_PREDICT,
        )
        if fixed.strip():
            first = fixed.strip()
    if _is_severe_content_loss(text, first):
        first = ""
    if not first:
        return finalize_reduce_text(text, _offline_reduce_fallback(text))

    # 模型返回与原文相同（或未真正改写）
    if _is_too_similar_rewrite(text, first):
        fb = _offline_reduce_fallback(text)
        if not _is_too_similar_rewrite(text, fb):
            return finalize_reduce_text(text, fb)

    wc1 = count_words(first)
    if abs(wc1 - original_wc) <= max_delta:
        out1 = finalize_reduce_text(text, first)
        if _is_too_similar_rewrite(text, out1):
            fb = _offline_reduce_fallback(text)
            if not _is_too_similar_rewrite(text, fb):
                return finalize_reduce_text(text, fb)
        return out1

    if _use_remote_inference():
        out1 = finalize_reduce_text(text, first)
        if _is_too_similar_rewrite(text, out1):
            fb = _offline_reduce_fallback(text)
            if not _is_too_similar_rewrite(text, fb):
                return finalize_reduce_text(text, fb)
        return out1

    sys1, user1 = build_reduce_system_and_user(
        text=text, target_wc=original_wc, max_delta=max_delta, strict=True
    )
    second = await model_chat_for_text(
        model,
        user1,
        system=sys1,
        temperature=REDUCE_TEMPERATURE,
        top_p=REDUCE_TOP_P,
    )
    second = _strip_model_think_blocks(second)
    second = _strip_reduce_chinese_preamble(second)
    if REVIEWER_ENABLED and (
        looks_like_instruction_leakage(second) or len(second) > len(text) * 2.2
    ):
        second = await reviewer_extract_body(text, second)
    if detect_english_contamination_in_chinese_output(text, second):
        fixed2 = await reviewer_fix_chinese_strip_english(
            text,
            second,
            model=model,
            num_predict=REDUCE_NUM_PREDICT,
        )
        if fixed2.strip():
            second = fixed2.strip()
    if _is_severe_content_loss(text, second):
        second = ""
    if not second:
        return finalize_reduce_text(text, first)

    if _is_too_similar_rewrite(text, second):
        fb = _offline_reduce_fallback(text)
        if not _is_too_similar_rewrite(text, fb):
            return finalize_reduce_text(text, fb)

    out2 = finalize_reduce_text(text, second)
    if _is_too_similar_rewrite(text, out2):
        fb = _offline_reduce_fallback(text)
        if not _is_too_similar_rewrite(text, fb):
            return finalize_reduce_text(text, fb)
    return out2


def derive_paper_title_from_parts(parts: List[str]) -> str:
    """从首段文本推断论文标题（用于工作台展示）。"""
    if not parts:
        return "未命名文稿"
    first = parts[0].strip()
    line = next((ln.strip() for ln in first.splitlines() if ln.strip()), "")
    if not line:
        return "未命名文稿"
    # 首行仅为「摘要」标签时，用下一行或下一段首行
    if re.match(r"^摘要\s*[：:]?\s*$", line):
        lines = [ln.strip() for ln in first.splitlines() if ln.strip()]
        if len(lines) >= 2:
            line = lines[1]
        elif len(parts) >= 2:
            line = next(
                (ln.strip() for ln in parts[1].splitlines() if ln.strip()),
                "未命名文稿",
            )
    if len(line) > 80:
        return line[:80] + "…"
    return line


def derive_paper_title_from_raw_text(raw_text: Optional[str]) -> Optional[str]:
    """
    从整篇原文优先提取标题（首个非空行），用于避免“标题行被当作第一段”后任务标题缺失。
    """
    if not raw_text:
        return None
    lines = [ln.strip() for ln in raw_text.splitlines() if ln.strip()]
    if not lines:
        return None
    line = lines[0]
    if re.match(r"^题目\s*[：:]\s*(.+)$", line):
        line = re.sub(r"^题目\s*[：:]\s*", "", line).strip()
    if not line:
        return None
    if len(line) > 80:
        return line[:80] + "…"
    return line


def ensure_task_title(task: Dict[str, Any]) -> None:
    """兼容旧内存任务：补全 title。"""
    if task.get("title"):
        return
    parts = [str(p.get("original", "")) for p in task.get("paragraphs", [])]
    task["title"] = derive_paper_title_from_parts(parts)


def make_task_paragraphs(mode: TaskMode, parts: List[str]) -> List[TaskParagraph]:
    paragraphs: List[TaskParagraph] = []
    for idx, original in enumerate(parts, start=1):
        if is_skip_polish_or_reduce(original):
            polished = original
        else:
            polished = mock_polish(mode, original)
        paragraphs.append(
            TaskParagraph(
                index=idx,
                wordCount=count_words(original),
                original=original,
                polished=polished,
            )
        )
    return paragraphs


app = FastAPI(title="Paper Polish API (dev)")


@app.on_event("startup")
def _startup_db_bootstrap() -> None:
    Base.metadata.create_all(bind=engine)
    _feedback_uploads_dir()
    with SessionLocal() as db:
        auth_repo.get_or_create_seed_user(
            db,
            email=DEFAULT_EMAIL,
            password_hash=hash_password(DEFAULT_PASSWORD),
            nickname=DEFAULT_NICKNAME,
            default_quota=DEFAULT_WORD_QUOTA,
        )
        auth_repo.unban_protected_admin_accounts(db)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if settings.cors_allow_all_dev else settings.cors_allow_origins,
    allow_credentials=False if settings.cors_allow_all_dev else True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(adhub_proxy_router)

_static_root = Path(__file__).resolve().parent / "static"
if _static_root.is_dir():
    app.mount("/static", StaticFiles(directory=str(_static_root)), name="static")


@app.get("/api/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.get("/")
def root() -> Dict[str, str]:
    return {"service": "paper-polish-backend", "status": "ok", "health": "/api/health"}


@app.post("/api/auth/register", response_model=TokenResponse)
def register(req: RegisterRequest, db: Session = Depends(get_db)) -> TokenResponse:
    email = str(req.email).strip().lower()
    if auth_repo.get_user_by_email(db, email):
        raise HTTPException(status_code=400, detail="Email already registered")
    nickname = (req.nickname or "").strip() or "用户"
    user = auth_repo.create_user(
        db,
        email=email,
        password_hash=hash_password(req.password),
        nickname=nickname,
        default_quota=DEFAULT_WORD_QUOTA,
    )
    token = create_access_token(user.id)
    return TokenResponse(access_token=token)


@app.post("/api/auth/email/send-code", response_model=SimpleOkResponse)
def send_email_code(
    req: SendEmailCodeRequest,
    http_req: Request,
    db: Session = Depends(get_db),
) -> SimpleOkResponse:
    turnstile_ok = verify_turnstile_token(req.captcha_token, http_req.client.host if http_req.client else None)
    local_ok = verify_local_captcha(req.local_captcha_id, req.local_captcha_answer)
    if settings.turnstile_secret_key:
        if not (turnstile_ok or local_ok):
            raise HTTPException(status_code=400, detail="人机验证失败，请重试")
    email = str(req.email).strip().lower()
    code = f"{random.randint(0, 999999):06d}"
    now = _now_utc()
    expires = now + timedelta(minutes=10)
    _send_email_code_via_smtp(email, code, 10)
    db.add(
        EmailVerificationCode(
            email=email,
            purpose=req.purpose,
            code=code,
            expires_at=expires,
            consumed_at=None,
            created_at=now,
        )
    )
    db.commit()
    return SimpleOkResponse(ok=True, detail="验证码已发送，请前往邮箱查收")


@app.get("/api/auth/local-captcha/challenge", response_model=LocalCaptchaChallengeResponse)
def local_captcha_challenge() -> LocalCaptchaChallengeResponse:
    return create_local_captcha_challenge()


@app.post("/api/auth/qr-login/session", response_model=QrLoginSessionCreateResponse)
def create_qr_login_session(req: QrLoginSessionCreateRequest) -> QrLoginSessionCreateResponse:
    _cleanup_qr_login_sessions()
    session_id = str(uuid.uuid4())
    now = _now_utc()
    expires_at = now + timedelta(seconds=QR_LOGIN_TTL_SECONDS)
    with _qr_login_lock:
        _qr_login_store[session_id] = {
            "status": "pending",
            "access_token": None,
            "expires_at": expires_at,
        }
    origin = _normalize_frontend_origin(req.frontend_origin)
    qr_url = f"{origin}/scan-login?sid={session_id}"
    return QrLoginSessionCreateResponse(
        session_id=session_id,
        qr_url=qr_url,
        expires_in_seconds=QR_LOGIN_TTL_SECONDS,
    )


@app.get("/api/auth/qr-login/session/{session_id}", response_model=QrLoginSessionStatusResponse)
def get_qr_login_session_status(session_id: str) -> QrLoginSessionStatusResponse:
    _cleanup_qr_login_sessions()
    with _qr_login_lock:
        item = _qr_login_store.get(session_id)
        if not item:
            return QrLoginSessionStatusResponse(status="expired")
        if item["expires_at"] < _now_utc():
            _qr_login_store.pop(session_id, None)
            return QrLoginSessionStatusResponse(status="expired")
        if item["status"] == "approved" and item.get("access_token"):
            token = str(item["access_token"])
            _qr_login_store.pop(session_id, None)
            return QrLoginSessionStatusResponse(status="approved", access_token=token)
        return QrLoginSessionStatusResponse(status="pending")


@app.post("/api/auth/qr-login/session/{session_id}/approve", response_model=SimpleOkResponse)
def approve_qr_login_session(
    session_id: str,
    req: QrLoginApproveRequest,
    db: Session = Depends(get_db),
) -> SimpleOkResponse:
    _cleanup_qr_login_sessions()
    with _qr_login_lock:
        item = _qr_login_store.get(session_id)
        if not item or item["expires_at"] < _now_utc():
            raise HTTPException(status_code=400, detail="扫码会话已过期，请重新扫码")

    email = str(req.email).strip().lower()
    user = auth_repo.get_user_by_email(db, email)
    if not user:
        raise HTTPException(status_code=400, detail="账号或密码错误")
    if user.is_banned:
        raise HTTPException(status_code=400, detail="账号已被封禁")
    if not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=400, detail="账号或密码错误")

    token = create_access_token(user.id)
    with _qr_login_lock:
        item = _qr_login_store.get(session_id)
        if not item or item["expires_at"] < _now_utc():
            raise HTTPException(status_code=400, detail="扫码会话已过期，请重新扫码")
        item["status"] = "approved"
        item["access_token"] = token
    return SimpleOkResponse(ok=True, detail="已确认，请返回电脑端")


@app.post("/api/auth/email/register", response_model=TokenResponse)
def email_register(req: EmailRegisterWithCodeRequest, db: Session = Depends(get_db)) -> TokenResponse:
    email = str(req.email).strip().lower()
    if len(req.password) < 6:
        raise HTTPException(status_code=400, detail="密码至少 6 位")

    now = _now_utc()
    q = (
        select(EmailVerificationCode)
        .where(
            EmailVerificationCode.email == email,
            EmailVerificationCode.purpose == "register",
            EmailVerificationCode.code == req.code.strip(),
            EmailVerificationCode.consumed_at.is_(None),
            EmailVerificationCode.expires_at >= now,
        )
        .order_by(EmailVerificationCode.created_at.desc())
    )
    code_row = db.scalar(q)
    if not code_row:
        raise HTTPException(status_code=400, detail="验证码无效或已过期")

    existing = auth_repo.get_user_by_email(db, email)
    updated_existing = False
    if existing:
        existing.password_hash = hash_password(req.password)
        if (req.nickname or "").strip():
            existing.nickname = (req.nickname or "").strip()
        db.flush()
        user = existing
        updated_existing = True
    else:
        user = auth_repo.create_user(
            db,
            email=email,
            password_hash=hash_password(req.password),
            nickname=(req.nickname or "").strip() or "用户",
            default_quota=DEFAULT_WORD_QUOTA,
        )
    code_row.consumed_at = now
    db.commit()
    token = create_access_token(user.id)
    return TokenResponse(access_token=token, updated_existing=updated_existing)


@app.post("/api/auth/login", response_model=TokenResponse)
def login(req: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    email = req.email.strip().lower()
    user = auth_repo.get_user_by_email(db, email)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if user.is_banned:
        raise HTTPException(status_code=403, detail="ACCOUNT_BANNED")
    if not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_access_token(user.id)
    return TokenResponse(access_token=token)


@app.get("/api/auth/me", response_model=UserInfo)
async def me(user: Dict[str, Any] = Depends(get_current_user)) -> UserInfo:
    return UserInfo(id=user["id"], email=user["email"], nickname=user.get("nickname"))


def _feedback_body_meets_minimum(content: str) -> bool:
    c = (content or "").strip()
    if re.search(r"!\[[^\]]*\]\([^)]+\)", c):
        return True
    if re.search(r"<img[^>]*\ssrc\s*=", c, re.I):
        return True
    plain = re.sub(r"<[^>]+>", " ", c)
    plain = re.sub(r"\s+", " ", plain).strip()
    return len(plain) >= 8


@app.post("/api/feedback", response_model=FeedbackItem)
async def create_feedback(
    req: FeedbackCreateRequest,
    user: Dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FeedbackItem:
    content = req.content.strip()
    if not _feedback_body_meets_minimum(content):
        raise HTTPException(status_code=400, detail="反馈内容至少 8 个字符，或粘贴至少一张截图")
    row = feedback_repo.create_feedback(
        db,
        user_id=user["id"],
        category=req.category,
        content=content,
        contact=(req.contact or "").strip() or None,
    )
    return _feedback_item_from_row(db, row)


@app.get("/api/feedback/my", response_model=List[FeedbackItem])
async def list_my_feedback(
    user: Dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> List[FeedbackItem]:
    rows = feedback_repo.list_feedback_by_user(db, user["id"])
    return [_feedback_item_from_row(db, r) for r in rows]


@app.get("/api/feedback/my/pending-count")
async def feedback_my_pending_count(
    user: Dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Dict[str, int]:
    return {"pendingCount": feedback_repo.count_user_feedback_pending(db, user["id"])}


@app.post("/api/feedback/upload-image")
async def feedback_upload_image(
    file: UploadFile = File(...),
    _: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, str]:
    path = await _save_feedback_uploaded_image(file)
    return {"url": path}


@app.get("/api/admin/feedback", response_model=List[FeedbackItem])
async def list_admin_feedback(
    _: Dict[str, Any] = Depends(require_admin_user),
    db: Session = Depends(get_db),
) -> List[FeedbackItem]:
    rows = feedback_repo.list_feedback_all(db)
    return [_feedback_item_from_row(db, r) for r in rows]


@app.post("/api/admin/feedback/upload-image")
async def admin_feedback_upload_image(
    file: UploadFile = File(...),
    _: Dict[str, Any] = Depends(require_admin_user),
) -> Dict[str, str]:
    path = await _save_feedback_uploaded_image(file)
    return {"url": path}


@app.get("/api/admin/feedback/open-count")
async def admin_open_feedback_count(
    _: Dict[str, Any] = Depends(require_admin_user),
    db: Session = Depends(get_db),
) -> Dict[str, int]:
    return {"openCount": feedback_repo.count_feedback_by_status(db, status="open")}


@app.get("/api/admin/feedback/{feedback_id}", response_model=FeedbackItem)
async def get_admin_feedback(
    feedback_id: str,
    _: Dict[str, Any] = Depends(require_admin_user),
    db: Session = Depends(get_db),
) -> FeedbackItem:
    row = feedback_repo.get_feedback(db, feedback_id)
    if not row:
        raise HTTPException(status_code=404, detail="Feedback not found")
    return _feedback_item_from_row(db, row)


@app.patch("/api/admin/feedback/{feedback_id}", response_model=FeedbackItem)
async def update_admin_feedback(
    feedback_id: str,
    req: FeedbackAdminPatchRequest,
    _: Dict[str, Any] = Depends(require_admin_user),
    db: Session = Depends(get_db),
) -> FeedbackItem:
    if not req.model_fields_set:
        raise HTTPException(status_code=400, detail="No fields to update")
    touch_status = "status" in req.model_fields_set
    touch_reply = "admin_reply" in req.model_fields_set
    reply_val: str | None = None
    if touch_reply:
        if req.admin_reply is None:
            reply_val = None
        else:
            reply_val = req.admin_reply.strip() or None
    row = feedback_repo.patch_feedback_admin(
        db,
        feedback_id,
        status=req.status if touch_status else None,
        update_status=touch_status and req.status is not None,
        admin_reply=reply_val,
        update_admin_reply=touch_reply,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Feedback not found")
    return _feedback_item_from_row(db, row)


@app.get("/api/admin/overview", response_model=AdminOverviewResponse)
async def admin_overview(
    _: Dict[str, Any] = Depends(require_admin_user),
    db: Session = Depends(get_db),
) -> AdminOverviewResponse:
    user_rows, agg = admin_repo.admin_overview_rows(db)
    daily = [DailyMetricPoint(**x) for x in admin_repo.admin_daily_metrics(db)]
    return AdminOverviewResponse(
        userCount=agg["userCount"],
        monthlyActiveUsers=agg["monthlyActiveUsers"],
        totalAdViews=agg["totalAdViews"],
        totalWordsQuota=agg["totalWordsQuota"],
        usedWordsQuota=agg["usedWordsQuota"],
        openFeedbackCount=agg["openFeedbackCount"],
        totalTasksCount=agg["totalTasksCount"],
        dailyMetrics=daily,
        users=user_rows[:50],
    )


@app.post("/api/admin/users/{user_id}/ban")
async def admin_ban_user(user_id: str, _: Dict[str, Any] = Depends(require_admin_user), db: Session = Depends(get_db)) -> Dict[str, Any]:
    if auth_repo.user_is_protected_admin(db, user_id):
        raise HTTPException(status_code=400, detail="管理员账号不可封禁")
    row = auth_repo.set_user_ban_status(db, user_id, True)
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    return {"ok": True, "userId": row.id, "isBanned": True}


@app.post("/api/admin/users/{user_id}/unban")
async def admin_unban_user(user_id: str, _: Dict[str, Any] = Depends(require_admin_user), db: Session = Depends(get_db)) -> Dict[str, Any]:
    row = auth_repo.set_user_ban_status(db, user_id, False)
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    return {"ok": True, "userId": row.id, "isBanned": False}


@app.delete("/api/admin/users/{user_id}")
async def admin_delete_user(
    user_id: str, admin: Dict[str, Any] = Depends(require_admin_user), db: Session = Depends(get_db)
) -> Dict[str, Any]:
    if admin.get("id") == user_id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    if auth_repo.user_is_protected_admin(db, user_id):
        raise HTTPException(status_code=400, detail="管理员账号不可删除")
    ok = auth_repo.delete_user(db, user_id)
    if not ok:
        raise HTTPException(status_code=404, detail="User not found")
    return {"ok": True, "userId": user_id}


def _balance_yuan_for_user(db: Session, user_id: str) -> float:
    u = db.get(User, user_id)
    if not u:
        return 0.0
    return round(int(u.balance_cents or 0) / 100.0, 2)


def _redeem_code_admin_dict(db: Session, r: RedeemCode) -> Dict[str, Any]:
    email = None
    if r.restrict_user_id:
        owner = auth_repo.get_user_by_id(db, r.restrict_user_id)
        email = owner.email if owner else None
    ap = int(r.amount) if r.reward_kind == "points" else None
    ay = round(int(r.amount) / 100.0, 2) if r.reward_kind == "balance_yuan" else None
    return {
        "id": r.id,
        "code": r.code,
        "rewardKind": r.reward_kind,
        "amountPoints": ap,
        "amountBalanceYuan": ay,
        "scope": r.scope,
        "restrictUserId": r.restrict_user_id,
        "restrictEmail": email,
        "maxUses": int(r.max_uses),
        "useCount": int(r.use_count),
        "expiresAt": r.expires_at.isoformat() if r.expires_at else None,
        "createdAt": r.created_at.isoformat(),
        "disabled": bool(r.disabled),
        "effectiveStatus": redeem_repo.effective_redeem_status(r),
    }


@app.get("/api/admin/redeem-codes")
async def admin_list_redeem_codes(
    page: int = Query(1, ge=1),
    pageSize: int = Query(12, ge=1, le=100),
    _: Dict[str, Any] = Depends(require_admin_user),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    off = (page - 1) * pageSize
    rows, total = redeem_repo.list_redeem_codes_paginated(db, offset=off, limit=pageSize)
    return {"items": [_redeem_code_admin_dict(db, r) for r in rows], "total": int(total)}


@app.post("/api/admin/redeem-codes")
async def admin_create_redeem_codes(
    req: AdminRedeemCodeCreateRequest,
    _: Dict[str, Any] = Depends(require_admin_user),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    if req.scope == "single":
        uid = (req.restrictUserId or "").strip() or None
        if not uid and req.restrictEmail:
            u = auth_repo.get_user_by_email(db, str(req.restrictEmail).strip().lower())
            uid = u.id if u else None
        if not uid:
            raise HTTPException(status_code=400, detail="single scope requires valid restrictUserId or restrictEmail")
        restrict = uid
    else:
        restrict = None

    kind = req.rewardKind
    if kind == "points":
        amt = int(req.amount)
        if amt < 1 or amt > 10_000_000:
            raise HTTPException(status_code=400, detail="invalid points amount")
    else:
        if float(req.amount) < 0.01 or float(req.amount) > 1_000_000:
            raise HTTPException(status_code=400, detail="invalid balance amount (yuan)")
        amt = int(round(float(req.amount) * 100))

    if req.maxUses < 1 or req.maxUses > 10_000_000:
        raise HTTPException(status_code=400, detail="invalid maxUses")
    if req.quantity < 1 or req.quantity > 100:
        raise HTTPException(status_code=400, detail="invalid quantity")

    rows = redeem_repo.create_redeem_codes_batch(
        db,
        reward_kind=kind,
        amount=amt,
        scope=req.scope,
        restrict_user_id=restrict,
        max_uses=int(req.maxUses),
        expires_at=req.expiresAt,
        quantity=int(req.quantity),
    )
    return {"codes": [_redeem_code_admin_dict(db, r) for r in rows]}


@app.post("/api/redeem/use", response_model=RedeemUseResponse)
async def redeem_use_code(
    req: RedeemUseRequest,
    user: Dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> RedeemUseResponse:
    ok, reason, extra = redeem_repo.try_redeem(db, user_id=str(user["id"]), code_raw=req.code)
    if not ok:
        return RedeemUseResponse(ok=False, reason=reason, points=None, balanceYuan=None)
    return RedeemUseResponse(
        ok=True,
        reason=reason,
        points=int(extra.get("points", 0)),
        balanceYuan=float(extra.get("balanceYuan", 0.0)),
    )


@app.post("/api/points/signin", response_model=SigninResponse)
async def signin(
    user: Dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SigninResponse:
    user_id = user["id"]
    ps = points_repo.get_or_create_point_state(db, user_id)
    today = _iso_date_utc()
    gained = points_repo.refresh_daily_free(ps, today)
    db.commit()
    db.refresh(ps)
    return SigninResponse(
        gained=max(0, gained),
        streak=0,
        points=int(points_repo.writable_words(ps)),
    )


@app.get("/api/points/me", response_model=PointsState)
async def points_me(
    user: Dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PointsState:
    user_id = user["id"]
    bal = _balance_yuan_for_user(db, user_id)
    payload = points_repo.prepare_point_state(db, user_id, bal)
    return PointsState(**payload)


@app.post("/api/membership/activate", response_model=MembershipActivateResponse)
async def membership_activate(
    req: MembershipActivateRequest,
    user: Dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> MembershipActivateResponse:
    try:
        ps, granted = points_repo.activate_membership_demo(
            db, str(user["id"]), req.tier, trial_days=req.trialDays
        )
    except ValueError:
        return MembershipActivateResponse(
            ok=False,
            tier=req.tier,
            grantedPoints=0,
            writableWords=0,
            reason="invalid_tier",
        )
    return MembershipActivateResponse(
        ok=True,
        tier=ps.membership_tier or req.tier,
        grantedPoints=granted,
        writableWords=points_repo.writable_words(ps),
    )


@app.post("/api/ad/watch-tickets", response_model=AdWatchTicketCreateResponse)
async def ad_watch_create_ticket(
    user: Dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AdWatchTicketCreateResponse:
    user_id = user["id"]
    tid = str(uuid.uuid4())
    exp = _now_utc() + timedelta(seconds=_ad_watch_ttl_seconds())
    ps = points_repo.get_or_create_point_state(db, user_id)
    from pricing import ad_reward_for_tier, effective_membership_tier

    tier = effective_membership_tier(ps.membership_tier, ps.membership_expires_at)
    reward = ad_reward_for_tier(tier)
    exp_unix = int(exp.timestamp())
    sig = _ad_watch_sign(tid, user_id, exp_unix)
    row, reason = ad_watch_repo.create_ticket(
        db,
        user_id=user_id,
        ticket_id=tid,
        reward_points=reward,
        expires_at=exp,
    )
    if not row:
        raise HTTPException(status_code=429, detail=reason or "daily_limit")
    base = _ad_watch_public_base()
    watch_url = f"{base}/static/ad-watch/index.html?ticket={tid}&sig={sig}&exp={exp_unix}"
    return AdWatchTicketCreateResponse(ticketId=tid, watchUrl=watch_url, expiresAt=exp.isoformat())


@app.get("/api/ad/watch-tickets/{ticket_id}", response_model=AdWatchTicketStatusResponse)
async def ad_watch_ticket_status(
    ticket_id: str,
    user: Dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AdWatchTicketStatusResponse:
    uid = user["id"]
    row = ad_watch_repo.get_ticket(db, ticket_id)
    if not row or row.user_id != uid:
        raise HTTPException(status_code=404, detail="Ticket not found")
    row = ad_watch_repo.mark_ticket_expired_if_needed(db, row)
    pts: Optional[int] = None
    if row.status == "completed":
        ps = db.get(PointState, uid)
        pts = int(ps.points) if ps else 0
    return AdWatchTicketStatusResponse(status=row.status, points=pts)


@app.get("/api/ad/watch-tickets/{ticket_id}/qr", response_model=AdWatchQrResponse)
async def ad_watch_ticket_qr(
    ticket_id: str,
    user: Dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AdWatchQrResponse:
    uid = user["id"]
    row = ad_watch_repo.get_ticket(db, ticket_id)
    if not row or row.user_id != uid:
        raise HTTPException(status_code=404, detail="Ticket not found")
    row = ad_watch_repo.mark_ticket_expired_if_needed(db, row)
    if row.status != "pending":
        raise HTTPException(status_code=400, detail="Ticket is not pending")
    exp_unix = int(row.expires_at.timestamp())
    sig = _ad_watch_sign(row.id, row.user_id, exp_unix)
    base = _ad_watch_public_base()
    watch_url = f"{base}/static/ad-watch/index.html?ticket={row.id}&sig={sig}&exp={exp_unix}"
    b64 = _ad_watch_qr_png_base64(watch_url)
    return AdWatchQrResponse(imageBase64=b64, watchUrl=watch_url)


@app.post("/api/ad/watch/complete", response_model=AdWatchCompleteResponse)
def ad_watch_complete(req: AdWatchCompleteRequest, db: Session = Depends(get_db)) -> AdWatchCompleteResponse:
    row = ad_watch_repo.get_ticket(db, req.ticketId)
    if not row:
        return AdWatchCompleteResponse(ok=False, reason="not_found", points=None)
    if int(row.expires_at.timestamp()) != req.exp:
        return AdWatchCompleteResponse(ok=False, reason="exp_mismatch", points=None)
    if not _ad_watch_verify(req.ticketId, row.user_id, req.exp, req.sig):
        return AdWatchCompleteResponse(ok=False, reason="bad_signature", points=None)
    ok, reason, pts = ad_watch_repo.complete_ticket_and_credit_points(db, ticket_id=req.ticketId)
    return AdWatchCompleteResponse(ok=ok, reason=reason, points=pts)


@app.post("/api/tasks")
async def create_task(
    req: CreateTaskRequest,
    user: Dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    task_id = str(uuid.uuid4())
    citations_removed = 0
    raw_for_split = req.raw_text
    if raw_for_split and raw_for_split.strip():
        raw_for_split, citations_removed = strip_inline_citation_markers(raw_for_split)
    effective_req = CreateTaskRequest(
        mode=req.mode,
        raw_text=raw_for_split,
        paragraphs=req.paragraphs,
    )
    parts = split_into_paragraphs(effective_req)
    if not parts:
        # 兜底：前端当前大量交互仍是“界面演示”，如果没传段落，就用示例段落保证工作台可展示。
        parts = [
            "本研究旨在探讨示例段落，用于展示界面效果，与真实论文无关。",
            "方法部分描述了若干典型实验步骤，示例内容略。",
        ]
    paragraphs = make_task_paragraphs(req.mode, parts)
    task_title = derive_paper_title_from_raw_text(raw_for_split) or derive_paper_title_from_parts(parts)

    task_repo.create_task(
        db,
        task_id=task_id,
        user_id=user["id"],
        mode=req.mode,
        status="running",
        title=task_title,
        paragraphs=[p.model_dump() for p in paragraphs],
    )

    out: Dict[str, Any] = {"taskId": task_id}
    if citations_removed > 0:
        out["citationsRemoved"] = citations_removed
    return out


@app.get("/api/tasks", response_model=List[TaskDetail])
async def list_tasks(
    user: Dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> List[TaskDetail]:
    rows = task_repo.list_tasks_for_user(db, user["id"])
    out: List[TaskDetail] = []
    for t in rows:
        out.append(
            TaskDetail(
                id=t.id,
                userId=t.user_id,
                mode=t.mode,  # type: ignore[arg-type]
                status=t.status,
                createdAt=t.created_at.isoformat(),
                title=t.title,
                paragraphs=[
                    TaskParagraph(
                        index=p.idx,
                        wordCount=p.word_count,
                        original=p.original,
                        polished=p.polished,
                    )
                    for p in sorted(t.paragraphs, key=lambda x: x.idx)
                ],
            )
        )
    return out


@app.get("/api/tasks/{task_id}", response_model=TaskDetail)
async def get_task(
    task_id: str,
    user: Dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TaskDetail:
    task = task_repo.get_task_for_user(db, task_id, user["id"])
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return TaskDetail(
        id=task.id,
        userId=task.user_id,
        mode=task.mode,  # type: ignore[arg-type]
        status=task.status,
        createdAt=task.created_at.isoformat(),
        title=task.title,
        paragraphs=[
            TaskParagraph(
                index=p.idx,
                wordCount=p.word_count,
                original=p.original,
                polished=p.polished,
            )
            for p in sorted(task.paragraphs, key=lambda x: x.idx)
        ],
    )


@app.post("/api/tasks/{task_id}/paragraphs/{idx}/process")
async def process_paragraph(
    task_id: str,
    idx: int,
    user: Dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    # 每段单独请求模型，prompt 仅含本段原文，不拼接其它段落，避免上下文过长导致跑题/套话。
    task = task_repo.get_task_for_user(db, task_id, user["id"])
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    mode: TaskMode = task.mode  # type: ignore[assignment]
    target = task_repo.get_paragraph(db, task_id, idx)
    if not target:
        raise HTTPException(status_code=404, detail="Paragraph not found")
    original = str(target.original)

    skip = is_skip_polish_or_reduce(original)
    if skip:
        # 跳过：不触发 Ollama，也不做动画式逐字输出（前端会按 skipped 标记直接填回内容）
        saved = task_repo.update_task_paragraph_result(
            db, task_id=task_id, idx=idx, polished=original, word_count=count_words(original), model_used=None
        )
        return {
            "paragraph": {
                "index": idx,
                "wordCount": saved.word_count if saved else count_words(original),
                "original": original,
                "polished": original,
            },
            "skipped": True,
            "billing": {"deducted": 0, "fromDailyFree": 0, "fromPoints": 0},
        }

    ps = points_repo.get_or_create_point_state(db, user["id"])
    estimated_cost = count_words(original.strip())
    if estimated_cost > 0 and points_repo.writable_words(ps) < estimated_cost:
        raise HTTPException(status_code=402, detail="insufficient_words")

    model_used = select_runtime_model(mode, task_id, idx, original)
    if _model_inference_disabled():
        polished_text = mock_polish(mode, original)
        model_used = "mock:disabled"
    elif mode == "reduce":
        reduced = await reduce_with_wordcount_control(original, model=model_used)
        polished_text = reduced if reduced else mock_polish(mode, original)
    else:
        polished = await polish_with_model_reviewed(original, model=model_used)
        polished_text = polished if polished.strip() else mock_polish(mode, original)

    polished_text = strip_runaway_leading_abstract_labels(polished_text)
    polished_text = postprocess_model_output_quality(polished_text)
    if not polished_text.strip():
        polished_text = original
    # 非空但字数蒸发（如只剩「摘要」）：视为失败，回退原文，避免界面出现 2 字假结果
    _ow = count_words(original.strip())
    _pw = count_words((polished_text or "").strip())
    if _ow >= 80 and _pw < max(12, int(_ow * 0.18)):
        polished_text = original

    bill_amount = count_words(polished_text)
    ok_bill, bill_detail = points_repo.deduct_writable_words(ps, bill_amount)
    if not ok_bill:
        raise HTTPException(status_code=402, detail="insufficient_words")

    saved = task_repo.update_task_paragraph_result(
        db,
        task_id=task_id,
        idx=idx,
        polished=polished_text,
        word_count=bill_amount,
        model_used=model_used,
    )

    return {
        "paragraph": {
            "index": idx,
            "wordCount": saved.word_count if saved else bill_amount,
            "original": original,
            "polished": polished_text,
            "modelUsed": model_used,
        },
        "billing": {
            "deducted": bill_amount,
            "fromDailyFree": bill_detail["fromDailyFree"],
            "fromPoints": bill_detail["fromPoints"],
            "writableWordsRemaining": bill_detail["remainingWritable"],
        },
    }


@app.get("/api/tasks/{task_id}/export", response_model=ExportResponse)
async def export(
    task_id: str,
    user: Dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ExportResponse:
    task = task_repo.get_task_for_user(db, task_id, user["id"])
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    paragraphs = sorted(task.paragraphs, key=lambda p: int(p.idx))
    full_text = "\n\n".join(str(p.polished) for p in paragraphs)
    return ExportResponse(taskId=task_id, fullText=full_text)

