import React from "react";
import { Layout } from "antd";
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ArrowLeftOutlined
} from "@ant-design/icons";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import AppHeader from "../components/AppHeader";
import { SideNav } from "../components/SideNav";
import { UploadDraftProvider } from "../state/UploadDraftContext";
import "../styles/auth.css";
import "../styles/workbench.css";

const { Sider } = Layout;

function isPolishWorkbenchPath(pathname: string): boolean {
  return /^\/console\/polish\/[^/]+/.test(pathname);
}

const ConsoleLayout: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const hideConsoleNav = isPolishWorkbenchPath(location.pathname);
  const [collapsed, setCollapsed] = React.useState(false);
  /** 工作台 ⇄ 主控制台切换时关闭 content 区 margin 过渡，避免与纵向 stagger 叠成斜向渐显 */
  const [shellMarginInstant, setShellMarginInstant] = React.useState(false);
  const prevHideConsoleNavRef = React.useRef(hideConsoleNav);

  React.useLayoutEffect(() => {
    if (prevHideConsoleNavRef.current === hideConsoleNav) return;
    prevHideConsoleNavRef.current = hideConsoleNav;
    setShellMarginInstant(true);
    const id = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => setShellMarginInstant(false));
    });
    return () => window.cancelAnimationFrame(id);
  }, [hideConsoleNav]);

  const handleToggleSider = React.useCallback(() => {
    setCollapsed((v) => !v);
  }, []);

  return (
    <Layout style={{ minHeight: "100vh", background: "var(--bg-page)" }}>
      <AppHeader />
      <Layout
        className={[
          "console-main-layout",
          hideConsoleNav ? "console-main-layout--no-console-nav" : ""
        ]
          .filter(Boolean)
          .join(" ")}
        style={{ background: "var(--bg-page)" }}
      >
        {hideConsoleNav ? (
          <button
            type="button"
            className="workbench-back-nav-btn"
            aria-label="返回论文优化"
            title="返回论文优化"
            onClick={() => navigate("/console/polish")}
          >
            <ArrowLeftOutlined />
          </button>
        ) : null}
        {!hideConsoleNav ? (
          <Sider
            className="console-main-sider"
            width={204}
            collapsible
            collapsed={collapsed}
            collapsedWidth={56}
            trigger={null}
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
        ) : null}
        <div
          className={[
            "console-content-shell",
            "console-fixed-layout",
            !hideConsoleNav && collapsed ? "console-content-shell--collapsed" : "",
            hideConsoleNav ? "console-content-shell--no-console-nav" : "",
            shellMarginInstant ? "console-content-shell--instant-margin" : ""
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <UploadDraftProvider>
            <Outlet />
          </UploadDraftProvider>
        </div>
      </Layout>
    </Layout>
  );
};

export default ConsoleLayout;
