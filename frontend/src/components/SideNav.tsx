import React from "react";
import { Badge, Menu, type MenuProps } from "antd";
import {
  AppstoreOutlined,
  FileTextOutlined,
  HistoryOutlined,
  SettingOutlined,
  MessageOutlined,
  LineChartOutlined
} from "@ant-design/icons";
import { useLocation, useNavigate } from "react-router-dom";
import { apiRequest, AUTH_CHANGED_EVENT, getAccessToken } from "../api/client";
import { USER_FEEDBACK_PENDING_CHANGED } from "../state/userFeedbackPendingEvents";

interface SideNavProps {
  collapsed?: boolean;
}

export function SideNav({ collapsed }: SideNavProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [pendingFeedbackCount, setPendingFeedbackCount] = React.useState<number | null>(null);

  const selectedKey = (() => {
    if (location.pathname.startsWith("/console/polish")) return "polish";
    if (location.pathname.startsWith("/console/history")) return "history";
    if (location.pathname.startsWith("/console/journey")) return "journey";
    if (location.pathname.startsWith("/console/feedback")) return "feedback";
    if (location.pathname.startsWith("/console/settings")) return "settings";
    if (location.pathname.startsWith("/console/wallet")) return undefined;
    return "dashboard";
  })();

  const loadPendingFeedbackCount = React.useCallback(() => {
    if (!getAccessToken()) {
      setPendingFeedbackCount(null);
      return;
    }
    apiRequest<{ pendingCount: number }>("/api/feedback/my/pending-count", { method: "GET" })
      .then((r) =>
        setPendingFeedbackCount(typeof r.pendingCount === "number" ? r.pendingCount : 0)
      )
      .catch(() => setPendingFeedbackCount(null));
  }, []);

  React.useEffect(() => {
    loadPendingFeedbackCount();
    const timer = window.setInterval(loadPendingFeedbackCount, 60_000);
    const onVis = () => {
      if (document.visibilityState === "visible") loadPendingFeedbackCount();
    };
    const onPending = () => loadPendingFeedbackCount();
    const onAuth = () => loadPendingFeedbackCount();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener(USER_FEEDBACK_PENDING_CHANGED, onPending);
    window.addEventListener(AUTH_CHANGED_EVENT, onAuth);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener(USER_FEEDBACK_PENDING_CHANGED, onPending);
      window.removeEventListener(AUTH_CHANGED_EVENT, onAuth);
    };
  }, [loadPendingFeedbackCount]);

  React.useEffect(() => {
    if (location.pathname.startsWith("/console/feedback")) loadPendingFeedbackCount();
  }, [location.pathname, loadPendingFeedbackCount]);

  const items = React.useMemo<MenuProps["items"]>(() => {
    const showBadge = pendingFeedbackCount != null && pendingFeedbackCount > 0;
    const feedbackIcon =
      collapsed && showBadge ? (
        <Badge
          count={pendingFeedbackCount}
          size="small"
          className="console-sidenav-feedback-icon-badge"
          overflowCount={99}
        >
          <MessageOutlined />
        </Badge>
      ) : (
        <MessageOutlined />
      );
    const feedbackLabel =
      !collapsed && showBadge ? (
        <span className="console-sidenav-feedback-item">
          <span className="console-sidenav-feedback-item__text">体验反馈</span>
          <Badge
            count={pendingFeedbackCount}
            size="small"
            className="console-sidenav-feedback-badge"
            overflowCount={99}
          />
        </span>
      ) : (
        "体验反馈"
      );

    return [
      { key: "dashboard", icon: <AppstoreOutlined />, label: "概览" },
      { key: "polish", icon: <FileTextOutlined />, label: "论文优化" },
      { key: "history", icon: <HistoryOutlined />, label: "历史记录" },
      { key: "journey", icon: <LineChartOutlined />, label: "使用旅程" },
      { key: "feedback", icon: feedbackIcon, label: feedbackLabel },
      { key: "settings", icon: <SettingOutlined />, label: "设置" }
    ];
  }, [collapsed, pendingFeedbackCount]);

  return (
    <Menu
      className="console-side-menu"
      mode="inline"
      inlineCollapsed={collapsed}
      selectedKeys={selectedKey ? [selectedKey] : []}
      onClick={(info) => {
        switch (info.key) {
          case "dashboard":
            navigate("/console/dashboard");
            break;
          case "polish":
            navigate("/console/polish");
            break;
          case "history":
            navigate("/console/history");
            break;
          case "journey":
            navigate("/console/journey");
            break;
          case "settings":
            navigate("/console/settings");
            break;
          case "feedback":
            navigate("/console/feedback");
            break;
        }
      }}
      items={items}
    />
  );
}
