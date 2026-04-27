import React from "react";
import { Layout } from "antd";
import { MenuFoldOutlined, MenuUnfoldOutlined } from "@ant-design/icons";
import { Outlet } from "react-router-dom";
import AppHeader from "../components/AppHeader";
import SideNav from "../components/SideNav";

const { Sider } = Layout;

const ConsoleLayout: React.FC = () => {
  const [collapsed, setCollapsed] = React.useState(false);
  const handleToggleSider = React.useCallback(() => {
    setCollapsed((v) => !v);
  }, []);

  return (
    <Layout style={{ minHeight: "100vh", background: "var(--bg-page)" }}>
      <AppHeader />
      <Layout className="console-main-layout" style={{ background: "transparent" }}>
        <Sider
          className="console-main-sider"
          width={204}
          collapsible
          collapsed={collapsed}
          collapsedWidth={56}
          trigger={null}
          style={{
            background: "var(--bg-surface)"
          }}
        >
          <div
            className="console-sider-toggle"
            onClick={handleToggleSider}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleToggleSider();
              }
            }}
            role="button"
            tabIndex={0}
            aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
            title={collapsed ? "展开" : "收起"}
          >
            {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          </div>
          <SideNav collapsed={collapsed} />
        </Sider>
        <div
          className={`console-content-shell ${collapsed ? "console-content-shell--collapsed" : ""}`}
          style={{
            padding: "84px 24px 16px",
            flex: 1,
            minWidth: 0,
            background: "transparent"
          }}
        >
          <Outlet />
        </div>
      </Layout>
    </Layout>
  );
};

export default ConsoleLayout;

