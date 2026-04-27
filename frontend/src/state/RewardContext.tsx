import React from "react";
import {
  RewardState,
  loadRewardState,
  saveRewardState,
  getTodayKey,
  computeSignInReward
} from "./rewardState";

type RewardContextValue = {
  state: RewardState;
  addPoints: (delta: number) => void;
  canSignInToday: boolean;
  signInToday: () => { gained: number; streak: number } | null;
  syncFromServer: (next: RewardState) => void;
};

const RewardContext = React.createContext<RewardContextValue | null>(null);

export function RewardProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<RewardState>(() => loadRewardState());

  React.useEffect(() => {
    saveRewardState(state);
  }, [state]);

  const today = getTodayKey();
  const canSignInToday = state.signIn.lastDate !== today;

  const addPoints = React.useCallback((delta: number) => {
    setState((s) => ({ ...s, points: Math.max(0, s.points + delta) }));
  }, []);

  const signInToday = React.useCallback(() => {
    if (!canSignInToday) return null;

    const last = state.signIn.lastDate;
    const yesterdayKey = getTodayKey(new Date(Date.now() - 24 * 60 * 60 * 1000));
    const nextStreak = last === yesterdayKey ? state.signIn.streak + 1 : 1;
    const gained = computeSignInReward(nextStreak);

    setState((s) => ({
      ...s,
      points: s.points + gained,
      signIn: { lastDate: today, streak: nextStreak }
    }));

    return { gained, streak: nextStreak };
  }, [canSignInToday, state.signIn.lastDate, state.signIn.streak, today]);

  const syncFromServer = React.useCallback((next: RewardState) => {
    setState(next);
  }, []);

  return (
    <RewardContext.Provider
      value={{
        state,
        addPoints,
        canSignInToday,
        signInToday,
        syncFromServer
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

