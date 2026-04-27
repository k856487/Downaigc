import React from "react";
import { Layout } from "antd";
import AppHeader from "../components/AppHeader";
import { Outlet } from "react-router-dom";
import AdminSideNav from "../components/AdminSideNav";

const { Sider } = Layout;

const AdminLayout: React.FC = () => {
  return (
    <Layout style={{ minHeight: "100vh", background: "var(--bg-page)" }}>
      <AppHeader />
      <Layout className="console-main-layout" style={{ background: "transparent" }}>
        <Sider
          width={204}
          className="console-main-sider"
          style={{
            background: "var(--bg-surface)"
          }}
        >
          <AdminSideNav />
        </Sider>
        <div
          className="console-content-shell"
          style={{
            padding: "84px 24px 16px",
            flex: 1,
            minWidth: 0
          }}
        >
          <Outlet />
        </div>
      </Layout>
    </Layout>
  );
};

export default AdminLayout;

