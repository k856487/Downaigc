import { getApiBase } from "./client";

const ADHUB_TOKEN_KEY = "adhub_access_token";

export function getAdhubToken(): string | null {
  return sessionStorage.getItem(ADHUB_TOKEN_KEY);
}

export function setAdhubToken(token: string): void {
  sessionStorage.setItem(ADHUB_TOKEN_KEY, token);
}

export function clearAdhubToken(): void {
  sessionStorage.removeItem(ADHUB_TOKEN_KEY);
}

/** 经 downAiGC 后端代理到扫码看广 API（8001） */
export async function adhubRequest<T>(
  path: string,
  options: { method?: string; json?: unknown; auth?: boolean } = {}
): Promise<T> {
  const base = getApiBase();
  const method = options.method || "GET";
  const auth = options.auth !== false;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.json !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const token = getAdhubToken();
  if (auth && token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: options.json !== undefined ? JSON.stringify(options.json) : undefined
  });
  const data = (await res.json().catch(() => ({}))) as T & { detail?: string };
  if (!res.ok) {
    const err = new Error(typeof data.detail === "string" ? data.detail : res.statusText);
    (err as Error & { detail?: string }).detail = typeof data.detail === "string" ? data.detail : res.statusText;
    throw err;
  }
  return data;
}

/** 小程序流量主专属二维码 code，可在 .env 用 VITE_ADHUB_QR_CODE 覆盖 */
export function getAdhubQrCode(): string {
  return (import.meta.env.VITE_ADHUB_QR_CODE as string | undefined)?.trim() || "1zbovxyaowp";
}

export function adhubWatchUrl(code?: string): string {
  const qr = (code || getAdhubQrCode()).trim();
  const proxyBase = (import.meta.env.VITE_ADHUB_WATCH_BASE as string | undefined)?.replace(/\/$/, "");
  if (proxyBase) {
    return `${proxyBase}/static/adhub-watch/index.html?code=${encodeURIComponent(qr)}`;
  }
  const apiBase = getApiBase().replace(/\/$/, "");
  return `${apiBase}/static/adhub-watch/index.html?code=${encodeURIComponent(qr)}`;
}
