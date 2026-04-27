import React from "react";

export type ThemeMode = "light" | "dark" | "system";
export type EffectiveTheme = "light" | "dark";

type ThemeContextValue = {
  themeMode: ThemeMode;
  effectiveTheme: EffectiveTheme;
  setThemeMode: (mode: ThemeMode) => void;
};

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = "paper-polish.themeMode.v1";

function getSystemIsDark() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({
  children
}) => {
  const [themeMode, setThemeMode] = React.useState<ThemeMode>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === "light" || raw === "dark" || raw === "system") return raw;
    } catch {
      // ignore
    }
    return "system";
  });

  const [systemIsDark, setSystemIsDark] = React.useState<boolean>(() =>
    getSystemIsDark()
  );

  // 跟随系统深浅色变化（仅当用户选择了 system）
  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;

    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => setSystemIsDark(mql.matches);

    // 兼容旧浏览器监听 API
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", handler);
      return () => mql.removeEventListener("change", handler);
    }

    // eslint-disable-next-line deprecation/deprecation
    mql.addListener(handler);
    // eslint-disable-next-line deprecation/deprecation
    return () => mql.removeListener(handler);
  }, []);

  const effectiveTheme: EffectiveTheme =
    themeMode === "system" ? (systemIsDark ? "dark" : "light") : themeMode;

  // 应用到 DOM class（用于你自定义的 CSS 变量）
  React.useEffect(() => {
    document.documentElement.classList.remove("app-theme-light", "app-theme-dark");
    document.documentElement.classList.add(
      effectiveTheme === "dark" ? "app-theme-dark" : "app-theme-light"
    );
  }, [effectiveTheme]);

  // 持久化
  React.useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, themeMode);
    } catch {
      // ignore
    }
  }, [themeMode]);

  const value: ThemeContextValue = React.useMemo(
    () => ({
      themeMode,
      effectiveTheme,
      setThemeMode
    }),
    [themeMode, effectiveTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export function useThemeMode() {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) throw new Error("useThemeMode must be used within ThemeProvider");
  return ctx;
}

