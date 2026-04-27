export type RewardState = {
  points: number;
  signIn: {
    lastDate: string | null; // YYYY-MM-DD
    streak: number;
  };
};

const STORAGE_KEY = "paper-polish.rewardState.v1";

export function getTodayKey(d = new Date()): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function loadRewardState(): RewardState {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return { points: 0, signIn: { lastDate: null, streak: 0 } };
  }
  try {
    const parsed = JSON.parse(raw) as RewardState;
    if (
      typeof parsed?.points !== "number" ||
      typeof parsed?.signIn?.streak !== "number"
    ) {
      return { points: 0, signIn: { lastDate: null, streak: 0 } };
    }
    return {
      points: parsed.points,
      signIn: {
        lastDate: parsed.signIn.lastDate ?? null,
        streak: parsed.signIn.streak
      }
    };
  } catch {
    return { points: 0, signIn: { lastDate: null, streak: 0 } };
  }
}

export function saveRewardState(state: RewardState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function computeSignInReward(streak: number): number {
  // 递增但限制上限，避免无限膨胀：10, 12, 14...最高 30
  return Math.min(30, 10 + Math.max(0, streak - 1) * 2);
}

