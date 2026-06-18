/** 仅 sessionStorage，勿 import api/client，避免与 adminAuth 循环依赖 */

const SESSION_REDIRECT_KEY = "paper-polish.post-login-redirect.v1";

export function stashPostLoginRedirect(path: string): void {
  try {
    if (path && path.startsWith("/")) sessionStorage.setItem(SESSION_REDIRECT_KEY, path);
  } catch {
    /* ignore */
  }
}

export function consumePostLoginRedirect(): string | null {
  try {
    const v = sessionStorage.getItem(SESSION_REDIRECT_KEY);
    sessionStorage.removeItem(SESSION_REDIRECT_KEY);
    return v && v.startsWith("/") ? v : null;
  } catch {
    return null;
  }
}
