/** 论文字数统计：中文按字，英文按词（预览/展示用） */
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

/** 计费口径（与后端 count_words 一致）：仅统计汉字，1 字 = 1 汉字 */
export function countBillingChars(text: string): number {
  const t = text ?? "";
  const matches = t.match(/[\u4e00-\u9fff]/g);
  return matches ? matches.length : 0;
}

/** @deprecated 使用 countBillingChars */
export function countBackendWords(text: string): number {
  return countBillingChars(text);
}

/** 创建任务预估扣费：按输入汉字数粗估（实际按输出扣费） */
export function pointsForTaskSubmission(rawText: string | undefined | null): number {
  return countBillingChars(rawText ?? "");
}

export function truncatePreview(text: string, max = 6000): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n…（仅预览前 ${max} 字）`;
}
