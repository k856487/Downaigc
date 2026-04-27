import { getAccessToken } from "../api/client";

const ADMIN_SESSION_KEY = "paper-polish.admin-session.v1";

type AdminSession = {
  email: string;
  at: number;
};

const ADMIN_EMAIL_WHITELIST = [
  "kiter"
];

export function isAdminByEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  return ADMIN_EMAIL_WHITELIST.includes(normalized);
}

export function setAdminSession(email: string) {
  try {
    const payload: AdminSession = {
      email: email.trim().toLowerCase(),
      at: Date.now()
    };
    localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

export function getAdminSession(): AdminSession | null {
  try {
    const raw = localStorage.getItem(ADMIN_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AdminSession>;
    if (!parsed || typeof parsed.email !== "string" || typeof parsed.at !== "number") {
      return null;
    }
    return { email: parsed.email, at: parsed.at };
  } catch {
    return null;
  }
}

export function clearAdminSession() {
  try {
    localStorage.removeItem(ADMIN_SESSION_KEY);
  } catch {
    // ignore
  }
}

export function hasAdminAccess(): boolean {
  const token = getAccessToken();
  const session = getAdminSession();
  return Boolean(token && session && isAdminByEmail(session.email));
}

