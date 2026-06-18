import { getApiBase } from "../api/client";

/** 反馈内嵌图相对容器最大宽度（约为原先的 1/5） */
export const FEEDBACK_IMAGE_MAX_WIDTH_PCT = "20%";

const FEEDBACK_IMG_STYLE_ATTR = `max-width:${FEEDBACK_IMAGE_MAX_WIDTH_PCT};height:auto;display:block;margin:8px 0;border-radius:6px`;

export function escapeHtmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function escapeAttr(s: string): string {
  return escapeHtmlText(s);
}

export function resolveFeedbackAssetUrl(href: string): string {
  const u = href.trim();
  if (!u) return u;
  if (u.startsWith("http://") || u.startsWith("https://")) return u;
  const base = getApiBase().replace(/\/+$/, "");
  if (u.startsWith("/")) return `${base}${u}`;
  return `${base}/${u}`;
}

export function isSafeFeedbackImageUrl(url: string): boolean {
  const u = url.trim();
  if (!u) return false;
  const lower = u.toLowerCase();
  if (lower.startsWith("javascript:") || lower.startsWith("data:")) return false;
  if (u.startsWith("/static/feedback-uploads/")) return true;
  try {
    const p = new URL(u, "http://_");
    return p.pathname.startsWith("/static/feedback-uploads/");
  } catch {
    return false;
  }
}

/** 旧数据：纯 Markdown 或混排，转为可放进 contenteditable 的安全 HTML */
export function legacyMarkdownToEditorHtml(raw: string): string {
  if (!raw) return "";
  const re = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let last = 0;
  const chunks: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    if (m.index > last) {
      chunks.push(textChunkToHtmlDivs(raw.slice(last, m.index)));
    }
    const url = m[2].trim();
    if (isSafeFeedbackImageUrl(url)) {
      const src = resolveFeedbackAssetUrl(url);
      chunks.push(`<img src="${escapeAttr(src)}" alt="" style="${FEEDBACK_IMG_STYLE_ATTR}"/>`);
    }
    last = m.index + m[0].length;
  }
  if (last < raw.length) {
    chunks.push(textChunkToHtmlDivs(raw.slice(last)));
  }
  return chunks.join("");
}

function textChunkToHtmlDivs(t: string): string {
  if (!t) return "";
  const lines = t.split(/\n/);
  return lines
    .map((line) => `<div>${line ? escapeHtmlText(line) : "<br/>"}</div>`)
    .join("");
}

export function feedbackContentLooksLikeHtml(s: string): boolean {
  return /<\s*[a-z][\s\S]*>/i.test(s);
}

/** 展示 / 回填编辑器：统一成安全 HTML（含合法 img） */
export function normalizeToEditorHtml(raw: string): string {
  if (!raw || !raw.trim()) return "";
  if (feedbackContentLooksLikeHtml(raw)) {
    return sanitizeFeedbackDisplayHtml(raw);
  }
  return legacyMarkdownToEditorHtml(raw);
}

function serializeSafeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const t = node.textContent || "";
    if (!t) return "";
    return escapeHtmlText(t);
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as HTMLElement;
  const tag = el.tagName;
  if (tag === "BR") return "<br/>";
  if (tag === "IMG") {
    const src = el.getAttribute("src") || "";
    if (!isSafeFeedbackImageUrl(src)) return "";
    const abs = resolveFeedbackAssetUrl(src);
    return `<img src="${escapeAttr(abs)}" alt="" style="${FEEDBACK_IMG_STYLE_ATTR}"/>`;
  }
  const inner = Array.from(node.childNodes).map(serializeSafeNode).join("");
  if (tag === "SPAN") return inner ? `<span>${inner}</span>` : "";
  if (tag === "P" || tag === "DIV") {
    return inner ? `<${tag.toLowerCase()}>${inner}</${tag.toLowerCase()}>` : "";
  }
  return inner;
}

/** 用于 dangerouslySetInnerHTML 与编辑器回填 */
export function sanitizeFeedbackDisplayHtml(raw: string): string {
  const doc = new DOMParser().parseFromString(raw, "text/html");
  return Array.from(doc.body.childNodes).map(serializeSafeNode).join("");
}

export function feedbackHtmlHasImage(html: string): boolean {
  return /<img[^>]*\ssrc\s*=/i.test(html) || /!\[[^\]]*\]\([^)]+\)/.test(html);
}

export function feedbackHtmlPlainTextLen(html: string): number {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const t = (doc.body.textContent || "").replace(/\s+/g, " ").trim();
  return t.length;
}
