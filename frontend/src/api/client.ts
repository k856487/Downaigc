import { stashPostLoginRedirect } from "../utils/sessionRedirectStorage";

export type ApiError = {
  status: number;
  detail?: string;
};

const TOKEN_KEY = "paper-polish.accessToken.v1";
const API_BASE_FALLBACK = "http://localhost:8000";
const BANNED_POPUP_FLAG = "paper-polish.banned-popup.v1";

/** 登录/登出后派发，供 RewardProvider 等按账号重新拉取状态 */
export const AUTH_CHANGED_EVENT = "paper-polish-auth-changed";

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
  try {
    window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
  } catch {
    // ignore
  }
}

export function clearAccessToken() {
  setAccessToken(null);
}

export function getApiBase(): string {
  const envBase = import.meta.env.VITE_API_BASE as string | undefined;
  return envBase && envBase.trim().length > 0 ? envBase : API_BASE_FALLBACK;
}

function buildUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const base = getApiBase().replace(/\/+$/, "");
  return `${base}${path.startsWith("/") ? "" : "/"}${path}`;
}

function redirectToLoginAfterAuthLoss() {
  try {
    const path = window.location.pathname + (window.location.search || "");
    if (path.startsWith("/admin")) stashPostLoginRedirect(path);
  } catch {
    /* ignore */
  }
  if (window.location.pathname !== "/login") {
    window.location.assign("/login");
  }
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
    redirectToLoginAfterAuthLoss();
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
      redirectToLoginAfterAuthLoss();
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

/** 反馈/回复中粘贴截图：multipart 上传，返回后端 `url`（一般为 `/static/feedback-uploads/...`）。 */
export async function apiUploadFeedbackImage(uploadPath: string, file: File): Promise<{ url: string }> {
  const token = getAccessToken();
  const fd = new FormData();
  fd.append("file", file);
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(buildUrl(uploadPath), { method: "POST", headers, body: fd });
  if (res.status === 401) {
    clearAccessToken();
    redirectToLoginAfterAuthLoss();
    throw { status: 401, detail: "Unauthorized" } as ApiError;
  }
  if (!res.ok) {
    let detail: string | undefined;
    try {
      const data = await res.json();
      detail = typeof data?.detail === "string" ? data.detail : undefined;
    } catch {
      // ignore
    }
    throw { status: res.status, detail } as ApiError;
  }
  return (await res.json()) as { url: string };
}

