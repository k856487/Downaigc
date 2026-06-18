import React from "react";
import { Layout } from "antd";
import AppHeader from "../components/AppHeader";
import { Outlet } from "react-router-dom";
import AdminSideNav from "../components/AdminSideNav";
import "../styles/admin.css";
import "../styles/auth.css";

const { Sider } = Layout;

const AdminLayout: React.FC = () => {
  return (
    <Layout style={{ minHeight: "100vh", background: "var(--bg-page)" }}>
      <AppHeader />
      <Layout className="console-main-layout" style={{ background: "var(--bg-page)" }}>
        <Sider width={204} className="console-main-sider">
          <AdminSideNav />
        </Sider>
        <div className="console-content-shell console-fixed-layout">
          <Outlet />
        </div>
      </Layout>
    </Layout>
  );
};

export default AdminLayout;
