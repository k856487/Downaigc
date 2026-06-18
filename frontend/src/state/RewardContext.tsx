import React from "react";
import {
  RewardState,
  loadRewardState,
  saveRewardState,
  getTodayKey,
  mergePointsFromServer,
  PointsMePayload,
  emptyRewardState
} from "./rewardState";
import { apiRequest, AUTH_CHANGED_EVENT, getAccessToken } from "../api/client";

type AuthMe = { id: string; email: string; nickname?: string | null };

type RewardContextValue = {
  state: RewardState;
  /** 本地示意加减永久改写字数（演示充值等） */
  addPoints: (delta: number) => void;
  addBalanceYuan: (delta: number) => void;
  /** 用服务端快照覆盖（登录/bootstrap/段落扣费后） */
  syncFromServer: (next: RewardState) => void;
  syncPointsFromApi: (pts: PointsMePayload) => void;
  canClaimDailyFreeToday: boolean;
  claimDailyFree: () => Promise<{ gained: number } | null>;
  refreshPointsFromServer: () => Promise<void>;
};

const RewardContext = React.createContext<RewardContextValue | null>(null);

export function RewardProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<RewardState>(() => loadRewardState(null));
  const [persistUserId, setPersistUserId] = React.useState<string | null>(null);
  const [persistReady, setPersistReady] = React.useState(false);

  const applyPointsPayload = React.useCallback((pts: PointsMePayload) => {
    setState((local) => mergePointsFromServer(local, pts));
  }, []);

  const runBootstrap = React.useCallback(async () => {
    const token = getAccessToken();
    if (!token) {
      setPersistUserId(null);
      setState(loadRewardState(null));
      return;
    }
    try {
      const me = await apiRequest<AuthMe>("/api/auth/me");
      const local = loadRewardState(me.id);
      setPersistUserId(me.id);
      try {
        const pts = await apiRequest<PointsMePayload>("/api/points/me");
        setState(mergePointsFromServer(local, pts));
      } catch {
        setState(local);
      }
    } catch {
      setPersistUserId(null);
      setState(loadRewardState(null));
    }
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setPersistReady(false);
      await runBootstrap();
      if (!cancelled) setPersistReady(true);
    })();
    const onAuth = () => {
      void (async () => {
        setPersistReady(false);
        await runBootstrap();
        if (!cancelled) setPersistReady(true);
      })();
    };
    window.addEventListener(AUTH_CHANGED_EVENT, onAuth);
    return () => {
      cancelled = true;
      window.removeEventListener(AUTH_CHANGED_EVENT, onAuth);
    };
  }, [runBootstrap]);

  React.useEffect(() => {
    if (!persistReady) return;
    saveRewardState(state, persistUserId);
  }, [state, persistUserId, persistReady]);

  const today = getTodayKey();
  const canClaimDailyFreeToday = state.signIn.lastDate !== today;

  const addPoints = React.useCallback((delta: number) => {
    setState((s) => {
      const points = Math.max(0, s.points + delta);
      return {
        ...s,
        points,
        writableWords: s.dailyFreePoints + points
      };
    });
  }, []);

  const addBalanceYuan = React.useCallback((delta: number) => {
    setState((s) => ({
      ...s,
      balanceYuan: Math.max(0, Math.round((s.balanceYuan + delta) * 100) / 100)
    }));
  }, []);

  const syncFromServer = React.useCallback((next: RewardState) => {
    setState(mergePointsFromServer(emptyRewardState(), next));
  }, []);

  const syncPointsFromApi = React.useCallback(
    (pts: PointsMePayload) => {
      applyPointsPayload(pts);
    },
    [applyPointsPayload]
  );

  const refreshPointsFromServer = React.useCallback(async () => {
    try {
      const pts = await apiRequest<PointsMePayload>("/api/points/me");
      applyPointsPayload(pts);
    } catch {
      /* ignore */
    }
  }, [applyPointsPayload]);

  const claimDailyFree = React.useCallback(async () => {
    try {
      const res = await apiRequest<{ gained: number; streak: number; points: number }>(
        "/api/points/signin",
        { method: "POST" }
      );
      setState((s) =>
        mergePointsFromServer(s, {
          writableWords: res.points,
          signIn: { lastDate: getTodayKey(), streak: 0 }
        })
      );
      await refreshPointsFromServer();
      return { gained: res.gained };
    } catch {
      return null;
    }
  }, [refreshPointsFromServer]);

  return (
    <RewardContext.Provider
      value={{
        state,
        addPoints,
        addBalanceYuan,
        syncFromServer,
        syncPointsFromApi,
        canClaimDailyFreeToday,
        claimDailyFree,
        refreshPointsFromServer
      }}
    >
      {children}
    </RewardContext.Provider>
  );
}

export function useReward() {
  const ctx = React.useContext(RewardContext);
  if (!ctx) {
    throw new Error("useReward must be used within RewardProvider");
  }
  return ctx;
}
