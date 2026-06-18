import React from "react";
import { MEMBER_PLANS, type MemberTier } from "../config/pricing";
import { apiRequest } from "../api/client";
import { useReward } from "./RewardContext";

const STORAGE_KEY = "downaigc_membership_vip";

export type VipTierSelection = {
  tier: MemberTier;
  tagColor: string;
  planTitle: string;
  activatedAt: string;
};

function normalizeSelection(raw: unknown): VipTierSelection | null {
  if (!raw || typeof raw !== "object") return null;
  const j = raw as Partial<VipTierSelection & { planKey?: string }>;
  const tier =
    j.tier === "monthly" || j.tier === "premium"
      ? j.tier
      : j.planKey === "m30" || j.planKey === "monthly"
        ? "monthly"
        : j.planKey === "premium"
          ? "premium"
          : null;
  if (!tier || typeof j.tagColor !== "string" || typeof j.planTitle !== "string") {
    return null;
  }
  return {
    tier,
    tagColor: j.tagColor,
    planTitle: j.planTitle,
    activatedAt: typeof j.activatedAt === "string" ? j.activatedAt : new Date().toISOString()
  };
}

function loadSelection(): VipTierSelection | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normalizeSelection(JSON.parse(raw));
  } catch {
    return null;
  }
}

function saveSelection(v: VipTierSelection | null) {
  try {
    if (!v) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

type MembershipContextValue = {
  vip: VipTierSelection | null;
  membershipTier: MemberTier;
  setVipTier: (v: {
    tier: MemberTier;
    tagColor: string;
    planTitle: string;
    trialDays?: number;
  }) => Promise<boolean>;
  clearVipTier: () => void;
};

const MembershipContext = React.createContext<MembershipContextValue | null>(null);

export function MembershipProvider({ children }: { children: React.ReactNode }) {
  const { state, refreshPointsFromServer } = useReward();
  const [vip, setVip] = React.useState<VipTierSelection | null>(() =>
    typeof window === "undefined" ? null : loadSelection()
  );

  React.useEffect(() => {
    if (state.membershipTier === "none") {
      if (vip) setVip(null);
      return;
    }
    const plan = MEMBER_PLANS.find((p) => p.tier === state.membershipTier);
    if (!plan) return;
    setVip((prev) => {
      if (prev?.tier === state.membershipTier) return prev;
      return {
        tier: state.membershipTier,
        tagColor: plan.tagColor,
        planTitle: plan.title,
        activatedAt: new Date().toISOString()
      };
    });
  }, [state.membershipTier, vip]);

  React.useEffect(() => {
    saveSelection(vip);
  }, [vip]);

  const setVipTier = React.useCallback(
    async (v: { tier: MemberTier; tagColor: string; planTitle: string; trialDays?: number }) => {
      if (v.tier === "none") return false;
      try {
        const res = await apiRequest<{
          ok: boolean;
          tier: string;
          grantedPoints: number;
          writableWords: number;
        }>("/api/membership/activate", {
          method: "POST",
          json: { tier: v.tier, trialDays: v.trialDays ?? null }
        });
        if (!res.ok) return false;
        setVip({
          tier: v.tier,
          tagColor: v.tagColor,
          planTitle: v.planTitle,
          activatedAt: new Date().toISOString()
        });
        await refreshPointsFromServer();
        return true;
      } catch {
        return false;
      }
    },
    [refreshPointsFromServer]
  );

  const clearVipTier = React.useCallback(() => {
    setVip(null);
  }, []);

  const membershipTier: MemberTier =
    state.membershipTier !== "none" ? state.membershipTier : vip?.tier ?? "none";

  const value = React.useMemo(
    () => ({
      vip,
      membershipTier,
      setVipTier,
      clearVipTier
    }),
    [vip, membershipTier, setVipTier, clearVipTier]
  );

  return <MembershipContext.Provider value={value}>{children}</MembershipContext.Provider>;
}

export function useMembership() {
  const ctx = React.useContext(MembershipContext);
  if (!ctx) throw new Error("useMembership must be used within MembershipProvider");
  return ctx;
}
