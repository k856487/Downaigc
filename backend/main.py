from __future__ import annotations

import asyncio
import json
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

from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.orm import Session
from passlib.context import CryptContext

from db.base import Base
from db.session import engine, get_db, SessionLocal
from repositories import admin_repo, auth_repo, feedback_repo, task_repo
from models import entities as _entities  # noqa: F401
from models.entities import PointState, TaskParagraph
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
    简化版词数：中英文混合时，按“英数字串/中文单字”计数。
    仅用于前端 UI 演示，不追求学术严格口径。
    """
    return len(re.findall(r"[A-Za-z0-9]+|[\u4e00-\u9fff]", text))


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
            if re.match(r"^关键词\s*[：:]", s) or re.match(r"^关键词\s*$", s):
                return i
        return None

    lines = text.splitlines()
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
            return (prefix, body, "")
        body = "\n".join(rest[:kw_idx]).strip()
        suffix = rest[kw_idx].rstrip()
        return (prefix, body, suffix)

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
            return (prefix, body, suffix)

    body = "\n".join(body_lines).strip()
    if not body:
        return None
    return (prefix, body, "")


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
    x = ensure_leading_section_heading_line(original, x)
    x = _split_glued_heading_body(original, x)
    return normalize_heading_spacing_after_model(original, x)


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
    signIn: Dict[str, Any]


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


def compute_signin_reward(streak: int) -> int:
    # 与前端 rewardState 逻辑保持一致：10, 12, 14...上限 30
    return min(30, 10 + max(0, streak - 1) * 2)


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
    category: Literal["bug", "feature", "experience", "other"] = "experience"
    content: str
    contact: Optional[str] = None


class FeedbackItem(BaseModel):
    id: str
    userId: str
    userEmail: str
    category: str
    content: str
    contact: Optional[str] = None
    status: Literal["open", "processing", "closed"] = "open"
    createdAt: str
    updatedAt: str


class FeedbackStatusUpdateRequest(BaseModel):
    status: Literal["open", "processing", "closed"]


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


DEFAULT_WORD_QUOTA = 120000

# 开发环境默认账号：避免你刚启动/重启后因为内存数据丢失导致无法登录
DEFAULT_EMAIL = "kiter"
DEFAULT_PASSWORD = "poki123"
DEFAULT_NICKNAME = "管理员"


def split_into_paragraphs(req: CreateTaskRequest) -> List[str]:
    if req.paragraphs and len(req.paragraphs) > 0:
        return [p.strip() for p in req.paragraphs if p.strip()]

    if not req.raw_text:
        return []

    # 优先按空行拆分；如果空行拆分只得到 1 段（常见于只有单换行、没有空行的文本），
    # 则退化为按单行换行拆分，避免把整篇当成“一大段”。
    blocks = [b.strip() for b in re.split(r"\n\s*\n", req.raw_text) if b.strip()]
    if len(blocks) > 1:
        return blocks

    # 仅有单换行（无空行分段）时：按“段落”更贴近论文排版的方式做合并。
    # 目标：把类似“摘要：/关键词：”这类只起到标记作用的行，合并到后续正文所在段落，
    # 避免前端每一行都单独渲染成一个边框。
    lines = [line.strip() for line in req.raw_text.splitlines() if line.strip()]

    def is_label_line(s: str) -> bool:
        # 摘要/关键词/引言等：常见就是“摘要：”单独一行
        # 注意：这里刻意“不把“参考文献”算作可合并标记行”，
        # 否则它会被并入后续第一条条目，导致 UI 上无法单独成框。
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
            # 参考文献标题：让它从上一段“断开”，单独成为一段框
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

    return paragraphs


def mock_polish(mode: TaskMode, original: str) -> str:
    if mode == "polish":
        sp = split_paper_abstract_block(original)
        if sp:
            prefix, body, suffix = sp
            new_body = f"{body}（优化示例）" if body.strip() else body
            out = prefix + new_body
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

    # 摘要/关键词/致谢：按你的需求通常也不做降重/润色
    if re.match(r"^(摘要|关键词|致谢)\s*[:：]?\s*$", first_line):
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
# 润色：略低 temperature，偏稳；仍可单独调
POLISH_TEMPERATURE = float(os.getenv("LOCAL_POLISH_TEMPERATURE", "0.58"))
POLISH_TOP_P = float(os.getenv("LOCAL_POLISH_TOP_P", "0.9"))
POLISH_NUM_PREDICT = int(os.getenv("LOCAL_POLISH_MAX_NEW_TOKENS", "1024"))
# 第二遍「审稿」：从跑偏输出中只抽正文（可选）
REVIEWER_ENABLED = os.getenv("LOCAL_REVIEWER_ENABLED", "0") == "1"
REVIEWER_MODEL = os.getenv("LOCAL_REVIEWER_MODEL", DEFAULT_RUNTIME_MODEL)

# 云 GPU：OpenAI 兼容 Chat Completions（如 vLLM / TGI）。设置后不再加载本地权重。
REMOTE_INFERENCE_URL = os.getenv("REMOTE_INFERENCE_URL", "").strip()
REMOTE_INFERENCE_MODEL = os.getenv("REMOTE_INFERENCE_MODEL", "kiterforth").strip()
REMOTE_INFERENCE_API_KEY = os.getenv("REMOTE_INFERENCE_API_KEY", "").strip()
REMOTE_INFERENCE_TIMEOUT = int(os.getenv("REMOTE_INFERENCE_TIMEOUT", "300"))


def _use_remote_inference() -> bool:
    return bool(REMOTE_INFERENCE_URL)


def _remote_chat_sync(
    _model: str,
    prompt: str,
    *,
    system: Optional[str] = None,
    temperature: float = 0.35,
    top_p: float = 0.9,
    num_predict: Optional[int] = None,
) -> str:
    """POST OpenAI 兼容 /v1/chat/completions；云 GPU 上单独部署 kiterforth 时指向该地址即可。"""
    messages: List[Dict[str, str]] = []
    if system and system.strip():
        messages.append({"role": "system", "content": system.strip()})
    messages.append({"role": "user", "content": prompt})
    payload: Dict[str, Any] = {
        "model": REMOTE_INFERENCE_MODEL,
        "messages": messages,
        "temperature": float(temperature),
        "top_p": float(top_p),
        "max_tokens": int(num_predict if num_predict is not None else REDUCE_NUM_PREDICT),
    }
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        REMOTE_INFERENCE_URL,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json; charset=utf-8"},
    )
    if REMOTE_INFERENCE_API_KEY:
        req.add_header("Authorization", f"Bearer {REMOTE_INFERENCE_API_KEY}")
    try:
        with urllib.request.urlopen(req, timeout=REMOTE_INFERENCE_TIMEOUT) as resp:
            raw = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")[:2000]
        print("[remote_inference] HTTPError:", e.code, err_body)
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
    return RUNTIME_REDUCE_MODEL if mode == "reduce" else RUNTIME_POLISH_MODEL


async def model_chat_for_text(
    model: str,
    prompt: str,
    *,
    system: Optional[str] = None,
    temperature: float = 0.35,
    top_p: float = 0.9,
    num_predict: Optional[int] = None,
) -> str:
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
    for a, b in pairs:
        if a in out:
            out = out.replace(a, b, 1)
            if out != text:
                return out
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
            out = out.replace(a, b, 1)
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
    runtime_model = model or RUNTIME_POLISH_MODEL
    sp = split_paper_abstract_block(original)
    if sp:
        prefix, body, suffix = sp
        if not body.strip():
            return original
        polished = await _polish_body(body, model=runtime_model)
        out = prefix + polished.strip()
        if suffix:
            out += f"\n{suffix}"
        return out
    return await _polish_body(original, model=runtime_model)


async def _polish_body(text: str, *, model: str) -> str:
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


async def reduce_with_wordcount_control(text: str, *, model: Optional[str] = None) -> str:
    """
    降 AIGC：输出尽量与原文字数接近，偏差过大则在后台重改一次。
    若为「标题 + 摘要： + 正文 + 关键词」结构，仅改写摘要正文，标题/摘要行/关键词行原样保留。
    """
    runtime_model = model or RUNTIME_REDUCE_MODEL
    sp = split_paper_abstract_block(text)
    if sp:
        prefix, body, suffix = sp
        if not body.strip():
            return text
        reduced = await _reduce_body_with_wordcount(body, model=runtime_model)
        out = prefix + reduced.strip()
        if suffix:
            out += f"\n{suffix}"
        return out
    return await _reduce_body_with_wordcount(text, model=runtime_model)


async def _reduce_body_with_wordcount(text: str, *, model: str) -> str:
    """
    对单段正文做降 AIGC（字数控制）。
    """
    original_wc = count_words(text)
    max_delta = int(max(5, min(WORDCOUNT_TOLERANCE_ABS, original_wc * WORDCOUNT_TOLERANCE_RATIO)))

    sys0, user0 = build_reduce_system_and_user(
        text=text, target_wc=original_wc, max_delta=max_delta, strict=False
    )
    first = await model_chat_for_text(
        model,
        user0,
        system=sys0,
        temperature=REDUCE_TEMPERATURE,
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
    if first.strip() == text.strip():
        fb = _offline_reduce_fallback(text)
        if fb != text:
            return finalize_reduce_text(text, fb)

    wc1 = count_words(first)
    if abs(wc1 - original_wc) <= max_delta:
        out1 = finalize_reduce_text(text, first)
        if out1.strip() == text.strip():
            fb = _offline_reduce_fallback(text)
            if fb != text:
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

    if second.strip() == text.strip():
        fb = _offline_reduce_fallback(text)
        if fb != text:
            return finalize_reduce_text(text, fb)

    out2 = finalize_reduce_text(text, second)
    if out2.strip() == text.strip():
        fb = _offline_reduce_fallback(text)
        if fb != text:
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
    with SessionLocal() as db:
        auth_repo.get_or_create_seed_user(
            db,
            email=DEFAULT_EMAIL,
            password_hash=hash_password(DEFAULT_PASSWORD),
            nickname=DEFAULT_NICKNAME,
            default_quota=DEFAULT_WORD_QUOTA,
        )

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if settings.cors_allow_all_dev else settings.cors_allow_origins,
    allow_credentials=False if settings.cors_allow_all_dev else True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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


@app.post("/api/feedback", response_model=FeedbackItem)
async def create_feedback(
    req: FeedbackCreateRequest,
    user: Dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FeedbackItem:
    content = req.content.strip()
    if len(content) < 8:
        raise HTTPException(status_code=400, detail="反馈内容至少 8 个字符")
    row = feedback_repo.create_feedback(
        db,
        user_id=user["id"],
        category=req.category,
        content=content,
        contact=(req.contact or "").strip() or None,
    )
    return FeedbackItem(
        id=row.id,
        userId=row.user_id,
        userEmail=user["email"],
        category=row.category,
        content=row.content,
        contact=row.contact,
        status=row.status,  # type: ignore[arg-type]
        createdAt=row.created_at.isoformat(),
        updatedAt=row.updated_at.isoformat(),
    )


@app.get("/api/feedback/my", response_model=List[FeedbackItem])
async def list_my_feedback(
    user: Dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> List[FeedbackItem]:
    rows = feedback_repo.list_feedback_by_user(db, user["id"])
    return [
        FeedbackItem(
            id=r.id,
            userId=r.user_id,
            userEmail=user["email"],
            category=r.category,
            content=r.content,
            contact=r.contact,
            status=r.status,  # type: ignore[arg-type]
            createdAt=r.created_at.isoformat(),
            updatedAt=r.updated_at.isoformat(),
        )
        for r in rows
    ]


@app.get("/api/admin/feedback", response_model=List[FeedbackItem])
async def list_admin_feedback(
    user: Dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> List[FeedbackItem]:
    # 开发版：管理员鉴权由前端守卫控制，后续接入真实 role 后在此处补后端权限判断。
    _ = user
    rows = feedback_repo.list_feedback_all(db)
    user_map = {
        u.id: u.email for u in db.scalars(select(_entities.User)).all()
    }
    return [
        FeedbackItem(
            id=r.id,
            userId=r.user_id,
            userEmail=user_map.get(r.user_id, ""),
            category=r.category,
            content=r.content,
            contact=r.contact,
            status=r.status,  # type: ignore[arg-type]
            createdAt=r.created_at.isoformat(),
            updatedAt=r.updated_at.isoformat(),
        )
        for r in rows
    ]


@app.patch("/api/admin/feedback/{feedback_id}", response_model=FeedbackItem)
async def update_admin_feedback_status(
    feedback_id: str,
    req: FeedbackStatusUpdateRequest,
    user: Dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FeedbackItem:
    _ = user
    row = feedback_repo.update_feedback_status(db, feedback_id, req.status)
    if not row:
        raise HTTPException(status_code=404, detail="Feedback not found")
    owner = auth_repo.get_user_by_id(db, row.user_id)
    return FeedbackItem(
        id=row.id,
        userId=row.user_id,
        userEmail=owner.email if owner else "",
        category=row.category,
        content=row.content,
        contact=row.contact,
        status=row.status,  # type: ignore[arg-type]
        createdAt=row.created_at.isoformat(),
        updatedAt=row.updated_at.isoformat(),
    )


@app.get("/api/admin/overview", response_model=AdminOverviewResponse)
async def admin_overview(
    user: Dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AdminOverviewResponse:
    _ = user
    user_rows, agg = admin_repo.admin_overview_rows(db)
    daily = [DailyMetricPoint(**x) for x in admin_repo.admin_daily_metrics(db)]
    return AdminOverviewResponse(
        userCount=agg["userCount"],
        monthlyActiveUsers=agg["monthlyActiveUsers"],
        totalAdViews=agg["totalAdViews"],
        totalWordsQuota=agg["totalWordsQuota"],
        usedWordsQuota=agg["usedWordsQuota"],
        dailyMetrics=daily,
        users=user_rows[:50],
    )


@app.post("/api/admin/users/{user_id}/ban")
async def admin_ban_user(user_id: str, _: Dict[str, Any] = Depends(get_current_user), db: Session = Depends(get_db)) -> Dict[str, Any]:
    row = auth_repo.set_user_ban_status(db, user_id, True)
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    return {"ok": True, "userId": row.id, "isBanned": True}


@app.post("/api/admin/users/{user_id}/unban")
async def admin_unban_user(user_id: str, _: Dict[str, Any] = Depends(get_current_user), db: Session = Depends(get_db)) -> Dict[str, Any]:
    row = auth_repo.set_user_ban_status(db, user_id, False)
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    return {"ok": True, "userId": row.id, "isBanned": False}


@app.delete("/api/admin/users/{user_id}")
async def admin_delete_user(user_id: str, _: Dict[str, Any] = Depends(get_current_user), db: Session = Depends(get_db)) -> Dict[str, Any]:
    ok = auth_repo.delete_user(db, user_id)
    if not ok:
        raise HTTPException(status_code=404, detail="User not found")
    return {"ok": True, "userId": user_id}


@app.post("/api/points/signin", response_model=SigninResponse)
async def signin(
    user: Dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SigninResponse:
    user_id = user["id"]
    point_state = db.get(PointState, user_id)
    if not point_state:
        point_state = PointState(user_id=user_id, points=0, last_signin_date=None, streak=0)
        db.add(point_state)
        db.commit()
        db.refresh(point_state)
    st_last = point_state.last_signin_date
    st_streak = int(point_state.streak or 0)

    today = _iso_date_utc()
    if st_last == today:
        # 今日已签到：不给增益
        return SigninResponse(gained=0, streak=st_streak, points=int(point_state.points))

    last_date = st_last
    yesterday = _iso_date_utc(datetime.fromtimestamp((_now_utc() - timedelta(days=1)).timestamp(), tz=timezone.utc))
    next_streak = st_streak
    if last_date == yesterday:
        next_streak += 1
    else:
        next_streak = 1

    gained = compute_signin_reward(next_streak)
    point_state.points = int(point_state.points or 0) + gained
    point_state.last_signin_date = today
    point_state.streak = next_streak
    db.commit()

    return SigninResponse(gained=gained, streak=next_streak, points=int(point_state.points))


@app.get("/api/points/me", response_model=PointsState)
async def points_me(
    user: Dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PointsState:
    user_id = user["id"]
    point_state = db.get(PointState, user_id)
    if not point_state:
        return PointsState(points=0, signIn={"lastDate": None, "streak": 0})
    return PointsState(
        points=int(point_state.points),
        signIn={"lastDate": point_state.last_signin_date, "streak": int(point_state.streak)},
    )


@app.post("/api/tasks")
async def create_task(
    req: CreateTaskRequest,
    user: Dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    task_id = str(uuid.uuid4())
    parts = split_into_paragraphs(req)
    if not parts:
        # 兜底：前端当前大量交互仍是“界面演示”，如果没传段落，就用示例段落保证工作台可展示。
        parts = [
            "本研究旨在探讨示例段落，用于展示界面效果，与真实论文无关。",
            "方法部分描述了若干典型实验步骤，示例内容略。",
        ]
    paragraphs = make_task_paragraphs(req.mode, parts)

    task_repo.create_task(
        db,
        task_id=task_id,
        user_id=user["id"],
        mode=req.mode,
        status="running",
        title=derive_paper_title_from_parts(parts),
        paragraphs=[p.model_dump() for p in paragraphs],
    )

    return {"taskId": task_id}


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
        }

    model_used = select_runtime_model(mode, task_id, idx, original)
    if mode == "reduce":
        reduced = await reduce_with_wordcount_control(original, model=model_used)
        polished_text = reduced if reduced else mock_polish(mode, original)
    else:
        polished = await polish_with_model(original, model=model_used)
        polished_text = polished if polished.strip() else mock_polish(mode, original)

    saved = task_repo.update_task_paragraph_result(
        db,
        task_id=task_id,
        idx=idx,
        polished=polished_text,
        word_count=count_words(polished_text),
        model_used=model_used,
    )

    return {
        "paragraph": {
            "index": idx,
            "wordCount": saved.word_count if saved else count_words(polished_text),
            "original": original,
            "polished": polished_text,
            "modelUsed": model_used,
        }
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

