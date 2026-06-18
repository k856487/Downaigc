import type { NavigateFunction } from "react-router-dom";
import { clearAdminSession, isAdminByEmail, setAdminSession } from "../state/adminAuth";
import { consumePostLoginRedirect } from "./sessionRedirectStorage";

/**
 * 登录成功后：管理员进 /admin 目标或仪表盘，普通用户进控制台。
 * `locationState` 可为 `useLocation().state`，含 `{ from?: string }`（如从 AdminRouteGuard 传来）。
 */
export function navigateAfterLogin(navigate: NavigateFunction, email: string, locationState: unknown): void {
  const normalized = email.trim().toLowerCase();
  const fromState = (locationState as { from?: string } | null)?.from;
  let from: string | null = null;
  if (typeof fromState === "string" && fromState.startsWith("/")) {
    consumePostLoginRedirect();
    from = fromState;
  } else {
    from = consumePostLoginRedirect();
  }

  if (isAdminByEmail(normalized)) {
    setAdminSession(normalized);
    if (from && from.startsWith("/admin")) {
      navigate(from, { replace: true });
    } else {
      navigate("/admin/dashboard", { replace: true });
    }
  } else {
    clearAdminSession();
    navigate("/console/dashboard", { replace: true });
  }
}
