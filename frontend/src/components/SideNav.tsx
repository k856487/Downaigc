import React from "react";
import { Menu } from "antd";
import {
  AppstoreOutlined,
  FileTextOutlined,
  HistoryOutlined,
  SettingOutlined,
  MessageOutlined,
  LineChartOutlined
} from "@ant-design/icons";
import { useLocation, useNavigate } from "react-router-dom";

interface SideNavProps {
  collapsed?: boolean;
}

const SideNav: React.FC<SideNavProps> = ({ collapsed }) => {
  const location = useLocation();
  const navigate = useNavigate();

  const selectedKey = (() => {
    if (location.pathname.startsWith("/console/polish")) return "polish";
    if (location.pathname.startsWith("/console/history")) return "history";
    if (location.pathname.startsWith("/console/journey")) return "journey";
    if (location.pathname.startsWith("/console/feedback")) return "feedback";
    if (location.pathname.startsWith("/console/settings")) return "settings";
    return "dashboard";
  })();

  return (
    <Menu
      className="console-side-menu"
      mode="inline"
      inlineCollapsed={collapsed}
      selectedKeys={[selectedKey]}
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
      items={[
        { key: "dashboard", icon: <AppstoreOutlined />, label: "概览" },
        { key: "polish", icon: <FileTextOutlined />, label: "论文优化" },
        { key: "history", icon: <HistoryOutlined />, label: "历史记录" },
        { key: "journey", icon: <LineChartOutlined />, label: "使用旅程" },
        { key: "feedback", icon: <MessageOutlined />, label: "体验反馈" },
        { key: "settings", icon: <SettingOutlined />, label: "设置" }
      ]}
    />
  );
};

export default SideNav;

