export type PerfTier = "full" | "lite";

export type PerfProfile = {
  tier: PerfTier;
  maxDpr: number;
  shaderFps: number;
  shaderStreakMax: number;
  shaderExtraPassWeight: number;
  cursorParallax: boolean;
};

let cached: PerfProfile | null = null;

function estimatePixelLoad(): number {
  const dpr = window.devicePixelRatio || 1;
  return window.innerWidth * window.innerHeight * dpr * dpr;
}

function isChromiumEdge(): boolean {
  return /Edg\//.test(navigator.userAgent);
}

function fullProfile(): PerfProfile {
  return {
    tier: "full",
    maxDpr: Math.min(window.devicePixelRatio || 1, 2),
    shaderFps: 60,
    shaderStreakMax: 35,
    shaderExtraPassWeight: 1,
    cursorParallax: true
  };
}

function liteProfile(): PerfProfile {
  return {
    tier: "lite",
    maxDpr: 1,
    shaderFps: 30,
    shaderStreakMax: 22,
    shaderExtraPassWeight: 0.4,
    cursorParallax: false
  };
}

export function resolvePerfProfile(): PerfProfile {
  if (typeof window === "undefined") return fullProfile();

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return liteProfile();
  }

  const pixels = estimatePixelLoad();
  const cores = navigator.hardwareConcurrency ?? 8;
  const edge = isChromiumEdge();

  /* Edge 全屏 + 毛玻璃透视 WebGL 合成成本明显高于小窗预览 */
  const useLite =
    edge || pixels > 2_400_000 || (pixels > 1_400_000 && cores <= 6);

  return useLite ? liteProfile() : fullProfile();
}

export function getPerfProfile(): PerfProfile {
  if (!cached) cached = resolvePerfProfile();
  return cached;
}

/** 启动时挂到 <html>，供 CSS / 组件读取 */
export function applyPerfProfile(): PerfProfile {
  const profile = getPerfProfile();
  document.documentElement.classList.toggle("app-perf-lite", profile.tier === "lite");
  return profile;
}
