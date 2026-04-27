export type ApiError = {
  status: number;
  detail?: string;
};

const TOKEN_KEY = "paper-polish.accessToken.v1";
const API_BASE_FALLBACK = "http://localhost:8000";
const BANNED_POPUP_FLAG = "paper-polish.banned-popup.v1";

export function getAccessToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAccessToken(token: string | null) {
  try {
    if (!token) localStorage.removeItem(TOKEN_KEY);
    else localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // ignore
  }
}

export function clearAccessToken() {
  setAccessToken(null);
}

function getApiBase(): string {
  const envBase = import.meta.env.VITE_API_BASE as string | undefined;
  return envBase && envBase.trim().length > 0 ? envBase : API_BASE_FALLBACK;
}

function buildUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const base = getApiBase().replace(/\/+$/, "");
  return `${base}${path.startsWith("/") ? "" : "/"}${path}`;
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit & { json?: any } = {}
): Promise<T> {
  const token = getAccessToken();

  const headers: Record<string, string> = {
    Accept: "application/json"
  };

  if (token) headers.Authorization = `Bearer ${token}`;

  let body: BodyInit | undefined = undefined;
  if (init.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.json);
  }

  const res = await fetch(buildUrl(path), {
    ...init,
    headers: { ...headers, ...(init.headers as any) },
    body
  });

  if (res.status === 401) {
    clearAccessToken();
    const to = window.location.pathname.startsWith("/admin")
      ? "/admin/login"
      : "/login";
    // 最简单的跳转方式（不依赖 react-router hooks）
    // 如果当前已经在登录页，避免重复触发“刷新一次”
    if (window.location.pathname !== to) {
      window.location.assign(to);
    }
    throw { status: 401, detail: "Unauthorized" } as ApiError;
  }

  if (res.status === 403) {
    let detail = "Forbidden";
    try {
      const data = await res.json();
      detail = data?.detail ?? detail;
    } catch {
      // ignore
    }
    if (String(detail) === "ACCOUNT_BANNED") {
      clearAccessToken();
      try {
        if (sessionStorage.getItem(BANNED_POPUP_FLAG) !== "1") {
          sessionStorage.setItem(BANNED_POPUP_FLAG, "1");
          window.alert("账号已被管理员封禁，请联系管理员处理。");
        }
      } catch {
        window.alert("账号已被管理员封禁，请联系管理员处理。");
      }
      const to = window.location.pathname.startsWith("/admin") ? "/admin/login" : "/login";
      if (window.location.pathname !== to) {
        window.location.assign(to);
      }
    }
    throw { status: 403, detail } as ApiError;
  }

  if (!res.ok) {
    let detail: string | undefined = undefined;
    try {
      const data = await res.json();
      const rawDetail = data?.detail ?? data?.message;
      if (typeof rawDetail === "string") {
        detail = rawDetail;
      } else if (Array.isArray(rawDetail)) {
        detail = rawDetail
          .map((it) => {
            if (typeof it === "string") return it;
            if (!it || typeof it !== "object") return "";
            const msg =
              (it as any)?.msg ?? (it as any)?.message ?? (it as any)?.type;
            return typeof msg === "string" ? msg : "";
          })
          .filter(Boolean)
          .join("; ");
        if (!detail) detail = "请求参数错误";
      } else if (rawDetail && typeof rawDetail === "object") {
        const msg =
          (rawDetail as any)?.msg ??
          (rawDetail as any)?.message ??
          (rawDetail as any)?.type;
        if (typeof msg === "string") detail = msg;
        else detail = JSON.stringify(rawDetail);
      } else {
        detail = "请求失败";
      }
    } catch {
      // ignore
    }
    throw { status: res.status, detail } as ApiError;
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

