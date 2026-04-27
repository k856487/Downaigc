/** 论文字数统计：中文按字，英文按词（粗略） */
export function countThesisWords(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  const cn = (t.match(/[\u4e00-\u9fff]/g) || []).length;
  const withoutCn = t.replace(/[\u4e00-\u9fff]/g, " ");
  const enWords = withoutCn
    .trim()
    .split(/\s+/)
    .filter((w) => /[a-zA-Z]/.test(w)).length;
  return cn + enWords;
}

/** 与后端 `count_words()` 保持一致的粗略计数口径：
 *  - 英数字连续串按 1 个
 *  - 中文按单字
 */
export function countBackendWords(text: string): number {
  const t = text ?? "";
  const matches = t.match(/[A-Za-z0-9]+|[\u4e00-\u9fff]/g);
  return matches ? matches.length : 0;
}

export function truncatePreview(text: string, max = 6000): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n…（仅预览前 ${max} 字）`;
}
