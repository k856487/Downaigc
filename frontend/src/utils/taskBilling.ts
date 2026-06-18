/** 任务扣费：按可改写字数（免费额度 + 永久改写字数）校验 */
export function resolveTaskCharge(
  wordCost: number,
  writableWords: number
): { ok: boolean; wordsDue: number; message?: string } {
  if (wordCost <= 0) {
    return { ok: true, wordsDue: 0 };
  }
  if (wordCost > writableWords) {
    return {
      ok: false,
      wordsDue: wordCost,
      message: `可改写字数不足：还需 ${wordCost.toLocaleString("zh-CN")} 字（当前 ${writableWords.toLocaleString("zh-CN")} 字）`
    };
  }
  return { ok: true, wordsDue: wordCost };
}
