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

const ThemedApp: React.FC = () => {
  const { effectiveTheme } = useThemeMode();

  return (
    <ConfigProvider
      theme={{
        algorithm:
          effectiveTheme === "dark" ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: "#3370FF",
          borderRadius: 8
        }
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

