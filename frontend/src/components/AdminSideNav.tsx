import React from "react";
import { Badge, Menu, type MenuProps } from "antd";
import { AppstoreOutlined, GiftOutlined, MessageOutlined, TeamOutlined } from "@ant-design/icons";
import { useLocation, useNavigate } from "react-router-dom";
import { apiRequest } from "../api/client";
import { ADMIN_OPEN_FEEDBACK_CHANGED } from "../state/adminFeedbackOpenCountEvents";

const AdminSideNav: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [openFeedbackCount, setOpenFeedbackCount] = React.useState<number | null>(null);

  const selectedKey = location.pathname.startsWith("/admin/feedback")
    ? "feedback"
    : location.pathname.startsWith("/admin/redeem-codes")
      ? "redeem-codes"
      : location.pathname.startsWith("/admin/users")
        ? "users"
        : "dashboard";

  const loadOpenFeedbackCount = React.useCallback(() => {
    apiRequest<{ openCount: number }>("/api/admin/feedback/open-count", { method: "GET" })
      .then((r) => setOpenFeedbackCount(typeof r.openCount === "number" ? r.openCount : 0))
      .catch(() => setOpenFeedbackCount(null));
  }, []);

  React.useEffect(() => {
    loadOpenFeedbackCount();
    const timer = window.setInterval(loadOpenFeedbackCount, 60_000);
    const onVis = () => {
      if (document.visibilityState === "visible") loadOpenFeedbackCount();
    };
    const onCustom = () => loadOpenFeedbackCount();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener(ADMIN_OPEN_FEEDBACK_CHANGED, onCustom);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener(ADMIN_OPEN_FEEDBACK_CHANGED, onCustom);
    };
  }, [loadOpenFeedbackCount]);

  React.useEffect(() => {
    if (location.pathname.startsWith("/admin/feedback")) loadOpenFeedbackCount();
  }, [location.pathname, loadOpenFeedbackCount]);

  const items = React.useMemo<MenuProps["items"]>(
    () => [
      { key: "dashboard", icon: <AppstoreOutlined />, label: "管理概览" },
      { key: "users", icon: <TeamOutlined />, label: "用户列表" },
      { key: "redeem-codes", icon: <GiftOutlined />, label: "兑换码" },
      {
        key: "feedback",
        icon: <MessageOutlined />,
        label: (
          <span className="admin-sidenav-feedback-item">
            <span className="admin-sidenav-feedback-item__text">用户反馈</span>
            {openFeedbackCount != null && openFeedbackCount > 0 ? (
              <Badge
                className="admin-sidenav-feedback-badge"
                count={openFeedbackCount}
                size="small"
                overflowCount={99}
              />
            ) : null}
          </span>
        )
      }
    ],
    [openFeedbackCount]
  );

  return (
    <Menu
      mode="inline"
      className="console-side-menu"
      selectedKeys={[selectedKey]}
      items={items}
      onClick={(info) => {
        if (info.key === "feedback") navigate("/admin/feedback");
        else if (info.key === "users") navigate("/admin/users");
        else if (info.key === "redeem-codes") navigate("/admin/redeem-codes");
        else navigate("/admin/dashboard");
      }}
    />
  );
};

export default AdminSideNav;
