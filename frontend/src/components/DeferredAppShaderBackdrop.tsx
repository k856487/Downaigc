import React from "react";
import { useThemeMode } from "../state/ThemeContext";

const AppShaderBackdrop = React.lazy(() => import("./AppShaderBackdrop"));

/** 暗色主题下按需加载 Three.js 极光背景 */
const DeferredAppShaderBackdrop: React.FC = () => {
  const { effectiveTheme } = useThemeMode();
  if (effectiveTheme !== "dark") return null;
  return (
    <React.Suspense fallback={null}>
      <AppShaderBackdrop />
    </React.Suspense>
  );
};

export default DeferredAppShaderBackdrop;
