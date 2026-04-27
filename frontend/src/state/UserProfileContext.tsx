import React from "react";

export type UserProfileState = {
  nickname: string;
  avatarUrl: string | null;
};

type UserProfileContextValue = {
  profile: UserProfileState;
  setNickname: (nickname: string) => void;
  setAvatarUrl: (avatarUrl: string | null) => void;
};

const STORAGE_KEY = "paper-polish.userProfile.v1";

const UserProfileContext = React.createContext<UserProfileContextValue | null>(null);

function loadInitialProfile(): UserProfileState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { nickname: "", avatarUrl: null };
    const parsed = JSON.parse(raw) as Partial<UserProfileState>;
    return {
      nickname: typeof parsed.nickname === "string" ? parsed.nickname : "",
      avatarUrl: typeof parsed.avatarUrl === "string" ? parsed.avatarUrl : null
    };
  } catch {
    return { nickname: "", avatarUrl: null };
  }
}

export function UserProfileProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = React.useState<UserProfileState>(() => loadInitialProfile());

  React.useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    } catch {
      /* ignore */
    }
  }, [profile]);

  const setNickname = React.useCallback((nickname: string) => {
    setProfile((prev) => ({ ...prev, nickname }));
  }, []);

  const setAvatarUrl = React.useCallback((avatarUrl: string | null) => {
    setProfile((prev) => ({ ...prev, avatarUrl }));
  }, []);

  return (
    <UserProfileContext.Provider value={{ profile, setNickname, setAvatarUrl }}>
      {children}
    </UserProfileContext.Provider>
  );
}

export function useUserProfile() {
  const ctx = React.useContext(UserProfileContext);
  if (!ctx) throw new Error("useUserProfile must be used within UserProfileProvider");
  return ctx;
}

