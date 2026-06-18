import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App as AntApp, ConfigProvider, theme } from "antd";
import zhCN from "antd/locale/zh_CN";
import App from "./App";
import DeferredAppShaderBackdrop from "./components/DeferredAppShaderBackdrop";
import DeferredTargetCursor from "./components/DeferredTargetCursor";
import "antd/dist/reset.css";
import "./styles.css";
import { RewardProvider } from "./state/RewardContext";
import { MembershipProvider } from "./state/MembershipContext";
import { ThemeProvider, useThemeMode } from "./state/ThemeContext";
import { UserProfileProvider } from "./state/UserProfileContext";
import { applyPerfProfile } from "./utils/perfProfile";

applyPerfProfile();

/**
 * 固定桌面栅格：各断点 min/max 均为 0，通过 antd 校验且 lg/md/sm 列宽始终生效
 * （不可使用 0/99999 混配，会触发 screenXSMax <= screenSMMin 校验失败）
 */
const fixedLayoutScreenToken = {
  screenXS: 0,
  screenXSMin: 0,
  screenXSMax: 0,
  screenSM: 0,
  screenSMMin: 0,
  screenSMMax: 0,
  screenMD: 0,
  screenMDMin: 0,
  screenMDMax: 0,
  screenLG: 0,
  screenLGMin: 0,
  screenLGMax: 0,
  screenXL: 0,
  screenXLMin: 0,
  screenXLMax: 0,
  screenXXL: 0,
  screenXXLMin: 0
} as const;

const rootElement = document.getElementById("root") as HTMLElement;

const lightToken = {
  colorPrimary: "#3370FF",
  borderRadius: 8,
  ...fixedLayoutScreenToken
} as const;

/** 暗色：neutral 底 + 玻璃面板 token（与 styles.css 一致） */
const darkToken = {
  ...lightToken,
  colorPrimary: "#e5e5e5",
  colorPrimaryHover: "#fafafa",
  colorPrimaryActive: "#d4d4d4",
  colorBgBase: "#000000",
  colorBgLayout: "transparent",
  colorBgContainer: "rgba(255, 255, 255, 0.06)",
  colorBgElevated: "rgba(255, 255, 255, 0.08)",
  colorBorder: "rgba(255, 255, 255, 0.08)",
  colorBorderSecondary: "rgba(255, 255, 255, 0.05)",
  colorText: "#ffffff",
  colorTextSecondary: "#a3a3a3",
  colorTextTertiary: "#737373",
  colorTextQuaternary: "#525252",
  colorFillSecondary: "rgba(255, 255, 255, 0.08)",
  colorFillTertiary: "rgba(255, 255, 255, 0.06)",
  colorFillQuaternary: "rgba(255, 255, 255, 0.04)"
} as const;

/** 捕获子树渲染错误，避免 React 18 卸载整棵树后只剩空白 #root */
class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (error) {
      return (
        <div
          style={{
            boxSizing: "border-box",
            minHeight: "100vh",
            padding: 24,
            fontFamily: "system-ui, sans-serif",
            background: "#fafafa",
            color: "#111"
          }}
        >
          <h1 style={{ fontSize: 18, margin: "0 0 12px" }}>界面加载失败</h1>
          <p style={{ margin: "0 0 8px", opacity: 0.85 }}>
            请打开浏览器开发者工具（F12）查看 Console 完整堆栈，或点击下方按钮刷新重试。
          </p>
          <pre
            style={{
              padding: 12,
              background: "#fff",
              border: "1px solid #e5e5e5",
              borderRadius: 8,
              fontSize: 13,
              overflow: "auto",
              maxHeight: "40vh",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word"
            }}
          >
            {error.message}
          </pre>
          <button
            type="button"
            style={{ marginTop: 16, padding: "8px 16px", cursor: "pointer" }}
            onClick={() => window.location.reload()}
          >
            刷新页面
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const ThemedApp: React.FC = () => {
  const { effectiveTheme } = useThemeMode();
  const isDark = effectiveTheme === "dark";

  const darkComponents = {
    Layout: {
      bodyBg: "transparent",
      headerBg: "transparent",
      siderBg: "transparent",
      triggerBg: "transparent"
    },
    Card: {
      colorBgContainer: "rgba(255, 255, 255, 0.02)"
    },
    Modal: {
      contentBg: "rgba(255, 255, 255, 0.02)",
      headerBg: "transparent",
      footerBg: "transparent"
    },
    Button: {
      defaultBg: "rgba(255, 255, 255, 0.04)",
      defaultBorderColor: "rgba(255, 255, 255, 0.08)",
      defaultColor: "#d4d4d4"
    },
    Segmented: {
      trackBg: "rgba(255, 255, 255, 0.04)",
      itemSelectedBg: "rgba(255, 255, 255, 0.1)"
    },
    Table: {
      headerBg: "rgba(255, 255, 255, 0.04)",
      rowHoverBg: "rgba(255, 255, 255, 0.03)"
    }
  } as const;

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: isDark ? { ...darkToken } : { ...lightToken },
        components: isDark ? darkComponents : undefined
      }}
    >
      <UserProfileProvider>
        <RewardProvider>
          <MembershipProvider>
            <AntApp className="app-ui-layer">
              <BrowserRouter
                future={{
                  v7_startTransition: true,
                  v7_relativeSplatPath: true
                }}
              >
                <DeferredAppShaderBackdrop />
                <DeferredTargetCursor />
                <App />
              </BrowserRouter>
            </AntApp>
          </MembershipProvider>
        </RewardProvider>
      </UserProfileProvider>
    </ConfigProvider>
  );
};

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <ThemeProvider>
        <ThemedApp />
      </ThemeProvider>
    </RootErrorBoundary>
  </React.StrictMode>
);

