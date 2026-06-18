import React from "react";
import { App, Spin } from "antd";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { apiRequest, getAccessToken } from "../api/client";
import { isAdminByEmail, setAdminSession } from "../state/adminAuth";

type Me = { id: string; email: string; nickname?: string | null };

const AdminRouteGuard: React.FC = () => {
  const location = useLocation();
  const { message } = App.useApp();
  const [phase, setPhase] = React.useState<"loading" | "ok" | "login" | "forbidden">("loading");

  React.useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      setPhase("login");
      return;
    }
    let cancelled = false;
    apiRequest<Me>("/api/auth/me", { method: "GET" })
      .then((me) => {
        if (cancelled) return;
        const email = (me.email || "").trim().toLowerCase();
        if (isAdminByEmail(email)) {
          setAdminSession(email);
          setPhase("ok");
        } else {
          message.warning("当前账号无管理员权限");
          setPhase("forbidden");
        }
      })
      .catch(() => {
        if (!cancelled) setPhase("login");
      });
    return () => {
      cancelled = true;
    };
  }, [message]);

  if (phase === "loading") {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "40vh" }}>
        <Spin size="large" tip="校验管理员权限…" />
      </div>
    );
  }
  if (phase === "login") {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: `${location.pathname}${location.search || ""}` }}
      />
    );
  }
  if (phase === "forbidden") {
    return <Navigate to="/console/dashboard" replace />;
  }
  return <Outlet />;
};

export default AdminRouteGuard;
