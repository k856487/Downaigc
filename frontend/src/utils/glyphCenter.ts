let canvasCtx: CanvasRenderingContext2D | null = null;

const offsetCache = new Map<string, number>();

function getCtx(): CanvasRenderingContext2D | null {
  if (canvasCtx) return canvasCtx;
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  canvasCtx = canvas.getContext("2d");
  return canvasCtx;
}

/**
 * 计算单字符在字母基线位于中心时，需要施加的 dy 偏移（px）
 * 使字形视觉中心尽量与容器中心重合。
 */
export function getGlyphCenterOffset(char: string, fontSize: number): number {
  if (!char) return 0;
  const key = `${char}|${fontSize}`;
  const cached = offsetCache.get(key);
  if (cached !== undefined) return cached;

  const ctx = getCtx();
  if (!ctx) return 0;

  ctx.font =
    `700 ${fontSize}px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif`;

  const m = ctx.measureText(char);
  const ascent = m.actualBoundingBoxAscent || fontSize * 0.75;
  const descent = m.actualBoundingBoxDescent || fontSize * 0.25;

  // 基线在中心时，字形中心相对基线偏移为 (descent - ascent)/2
  // 取反即可把视觉中心拉回容器中心。
  const dy = (ascent - descent) / 2;
  const rounded = Math.round(dy * 2) / 2;
  offsetCache.set(key, rounded);
  return rounded;
}

export function createGlyphDataUrl(
  char: string,
  size: number,
  fontSize: number,
  color = "#111827"
): string | null {
  if (!char) return null;
  const ctx = getCtx();
  if (!ctx) return null;

  const canvas = ctx.canvas;
  canvas.width = size;
  canvas.height = size;
  ctx.clearRect(0, 0, size, size);

  ctx.font =
    `700 ${fontSize}px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  // Pass 1: draw near center using font metrics as a rough guess.
  const m = ctx.measureText(char);
  const ascent = m.actualBoundingBoxAscent || fontSize * 0.75;
  const descent = m.actualBoundingBoxDescent || fontSize * 0.25;
  const roughY = size / 2 + (ascent - descent) / 2;
  ctx.fillText(char, size / 2, roughY);

  // Pass 2: scan actual painted pixels and center by real bitmap bounds.
  const image = ctx.getImageData(0, 0, size, size);
  const alpha = image.data;
  let top = -1;
  let bottom = -1;
  const rowStride = size * 4;
  const alphaThreshold = 10;

  for (let y = 0; y < size; y++) {
    const rowOffset = y * rowStride;
    let hasInk = false;
    for (let x = 0; x < size; x++) {
      if (alpha[rowOffset + x * 4 + 3] > alphaThreshold) {
        hasInk = true;
        break;
      }
    }
    if (hasInk) {
      top = y;
      break;
    }
  }

  for (let y = size - 1; y >= 0; y--) {
    const rowOffset = y * rowStride;
    let hasInk = false;
    for (let x = 0; x < size; x++) {
      if (alpha[rowOffset + x * 4 + 3] > alphaThreshold) {
        hasInk = true;
        break;
      }
    }
    if (hasInk) {
      bottom = y;
      break;
    }
  }

  if (top >= 0 && bottom >= top) {
    const glyphCenter = (top + bottom) / 2;
    const targetCenter = (size - 1) / 2;
    const delta = targetCenter - glyphCenter;
    ctx.clearRect(0, 0, size, size);
    ctx.fillText(char, size / 2, roughY + delta);
  }

  return canvas.toDataURL("image/png");
}

