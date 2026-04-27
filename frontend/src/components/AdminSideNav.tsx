import React from "react";
import { Menu } from "antd";
import { AppstoreOutlined, MessageOutlined } from "@ant-design/icons";
import { useLocation, useNavigate } from "react-router-dom";

const AdminSideNav: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const selectedKey = location.pathname.startsWith("/admin/feedback")
    ? "feedback"
    : "dashboard";

  return (
    <Menu
      mode="inline"
      className="console-side-menu"
      selectedKeys={[selectedKey]}
      items={[
        { key: "dashboard", icon: <AppstoreOutlined />, label: "管理概览" },
        { key: "feedback", icon: <MessageOutlined />, label: "用户反馈" }
      ]}
      onClick={(info) => {
        if (info.key === "feedback") navigate("/admin/feedback");
        else navigate("/admin/dashboard");
      }}
    />
  );
};

export default AdminSideNav;

