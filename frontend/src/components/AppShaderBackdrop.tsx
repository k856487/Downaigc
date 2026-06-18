import React from "react";
import AnimatedShaderBackground from "./ui/animated-shader-background";
import { useThemeMode } from "../state/ThemeContext";

/** 暗色主题下全站极光 shader 背景 */
const AppShaderBackdrop: React.FC = () => {
  const { effectiveTheme } = useThemeMode();
  if (effectiveTheme !== "dark") return null;
  return <AnimatedShaderBackground />;
};

export default AppShaderBackdrop;
