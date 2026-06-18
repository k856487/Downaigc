export type RewardState = {
  /** 永久改写字数（充值/注册/广告/会员月赠） */
  points: number;
  /** 每日免费额度池（最高 3000） */
  dailyFreePoints: number;
  /** 可改写字数 = dailyFreePoints + points */
  writableWords: number;
  /** 账户余额（元），本地示意，非真实支付 */
  balanceYuan: number;
  membershipTier: "none" | "monthly" | "premium";
  adWatchesToday: number;
  adDailyLimit: number | null;
  dailyFreeCap: number;
  dailyFreeGrant: number;
  signIn: {
    lastDate: string | null;
    streak: number;
  };
};

/** 旧版单桶 key，首次按用户读取时迁移到 per-user key */
const LEGACY_STORAGE_KEY = "paper-polish.rewardState.v1";

export function rewardStorageKey(userId: string | null): string {
  if (!userId) return `${LEGACY_STORAGE_KEY}.__guest__`;
  return `${LEGACY_STORAGE_KEY}.u.${userId}`;
}

export function getTodayKey(d = new Date()): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function emptyRewardState(): RewardState {
  return {
    points: 0,
    dailyFreePoints: 0,
    writableWords: 0,
    balanceYuan: 0,
    membershipTier: "none",
    adWatchesToday: 0,
    adDailyLimit: 10,
    dailyFreeCap: 888,
    dailyFreeGrant: 888,
    signIn: { lastDate: null, streak: 0 }
  };
}

export function normalizeRewardState(raw: Partial<RewardState> | null | undefined): RewardState {
  const base = emptyRewardState();
  if (!raw || typeof raw.points !== "number") return base;
  const points = raw.points;
  const dailyFreePoints = typeof raw.dailyFreePoints === "number" ? raw.dailyFreePoints : 0;
  const writableWords =
    typeof raw.writableWords === "number" ? raw.writableWords : dailyFreePoints + points;
  return {
    points,
    dailyFreePoints,
    writableWords,
    balanceYuan: typeof raw.balanceYuan === "number" ? raw.balanceYuan : 0,
    membershipTier:
      raw.membershipTier === "monthly" || raw.membershipTier === "premium"
        ? raw.membershipTier
        : "none",
    adWatchesToday: typeof raw.adWatchesToday === "number" ? raw.adWatchesToday : 0,
    adDailyLimit:
      raw.adDailyLimit === null
        ? null
        : typeof raw.adDailyLimit === "number"
          ? raw.adDailyLimit
          : 10,
    dailyFreeCap: typeof raw.dailyFreeCap === "number" ? raw.dailyFreeCap : 3000,
    dailyFreeGrant: typeof raw.dailyFreeGrant === "number" ? raw.dailyFreeGrant : 1000,
    signIn: {
      lastDate: raw.signIn?.lastDate ?? null,
      streak: typeof raw.signIn?.streak === "number" ? raw.signIn.streak : 0
    }
  };
}

export function loadRewardState(userId: string | null): RewardState {
  const key = rewardStorageKey(userId);
  let raw = (() => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  })();

  if (!raw && userId) {
    try {
      raw = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (raw) {
        localStorage.setItem(key, raw);
      }
    } catch {
      // ignore
    }
  }

  if (!raw) {
    return emptyRewardState();
  }
  try {
    return normalizeRewardState(JSON.parse(raw) as Partial<RewardState>);
  } catch {
    return emptyRewardState();
  }
}

export function saveRewardState(state: RewardState, userId: string | null) {
  try {
    localStorage.setItem(rewardStorageKey(userId), JSON.stringify(state));
  } catch {
    // ignore
  }
}

/** @deprecated 每日免费改由服务端发放 */
export function computeSignInReward(_streak: number): number {
  return 1000;
}

export type PointsMePayload = {
  points: number;
  dailyFreePoints?: number;
  writableWords?: number;
  balanceYuan?: number;
  membershipTier?: RewardState["membershipTier"];
  adWatchesToday?: number;
  adDailyLimit?: number | null;
  dailyFreeCap?: number;
  dailyFreeGrant?: number;
  signIn?: { lastDate?: string | null; streak?: number };
};

export function mergePointsFromServer(
  local: RewardState,
  pts: PointsMePayload
): RewardState {
  return normalizeRewardState({
    ...local,
    points: pts.points,
    dailyFreePoints: pts.dailyFreePoints,
    writableWords: pts.writableWords,
    balanceYuan: typeof pts.balanceYuan === "number" ? pts.balanceYuan : local.balanceYuan,
    membershipTier: pts.membershipTier ?? local.membershipTier,
    adWatchesToday: pts.adWatchesToday ?? local.adWatchesToday,
    adDailyLimit: pts.adDailyLimit ?? local.adDailyLimit,
    dailyFreeCap: pts.dailyFreeCap ?? local.dailyFreeCap,
    dailyFreeGrant: pts.dailyFreeGrant ?? local.dailyFreeGrant,
    signIn: {
      lastDate: pts.signIn?.lastDate ?? local.signIn.lastDate,
      streak: typeof pts.signIn?.streak === "number" ? pts.signIn.streak : local.signIn.streak
    }
  });
}
