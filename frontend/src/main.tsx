import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App as AntApp, ConfigProvider, theme } from "antd";
import App from "./App";
import "antd/dist/reset.css";
import "./styles.css";
import { RewardProvider } from "./state/RewardContext";
import { ThemeProvider, useThemeMode } from "./state/ThemeContext";
import { UserProfileProvider } from "./state/UserProfileContext";

const rootElement = document.getElementById("root") as HTMLElement;

const lightToken = {
  colorPrimary: "#3370FF",
  borderRadius: 8
} as const;

/** 暗色：neutral-900 / neutral-800 / zinc，贴近 v0 输入面板 */
const darkToken = {
  ...lightToken,
  colorPrimary: "#fafafa",
  colorPrimaryHover: "#ffffff",
  colorPrimaryActive: "#e5e5e5",
  colorBgBase: "#0a0a0a",
  colorBgLayout: "#0a0a0a",
  colorBgContainer: "#171717",
  colorBgElevated: "#262626",
  colorBorder: "#262626",
  colorBorderSecondary: "#3f3f46",
  colorText: "#ffffff",
  colorTextSecondary: "#a3a3a3",
  colorTextTertiary: "#737373",
  colorTextQuaternary: "#525252",
  colorFillSecondary: "rgba(255, 255, 255, 0.08)",
  colorFillTertiary: "rgba(255, 255, 255, 0.06)",
  colorFillQuaternary: "rgba(255, 255, 255, 0.04)"
} as const;

const ThemedApp: React.FC = () => {
  const { effectiveTheme } = useThemeMode();
  const isDark = effectiveTheme === "dark";

  return (
    <ConfigProvider
      theme={{
        algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: isDark ? { ...darkToken } : { ...lightToken }
      }}
    >
      <UserProfileProvider>
        <RewardProvider>
          <AntApp>
            <BrowserRouter
              future={{
                v7_startTransition: true,
                v7_relativeSplatPath: true
              }}
            >
              <App />
            </BrowserRouter>
          </AntApp>
        </RewardProvider>
      </UserProfileProvider>
    </ConfigProvider>
  );
};

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <ThemedApp />
    </ThemeProvider>
  </React.StrictMode>
);

