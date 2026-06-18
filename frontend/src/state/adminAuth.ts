import { getAccessToken } from "../api/client";

const ADMIN_SESSION_KEY = "paper-polish.admin-session.v1";

type AdminSession = {
  email: string;
  at: number;
};

function adminEmailsFromEnv(): string[] {
  try {
    const raw = (import.meta.env.VITE_ADMIN_EMAILS as string | undefined) || "";
    if (!raw.trim()) return [];
    return raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * 与后端 ADMIN_EMAILS 对齐：配置了 VITE_ADMIN_EMAILS 则严格白名单。
 * 未配置时兼容本地种子账号邮箱 `kiter`（与后端 DEFAULT_EMAIL 一致）。
 */
export function isAdminByEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  const list = adminEmailsFromEnv();
  if (list.length > 0) {
    return list.includes(normalized);
  }
  return normalized === "kiter";
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
