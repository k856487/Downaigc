import React from "react";
import { TARGET_CURSOR_SELECTOR } from "./targetCursorConstants";
import { getPerfProfile } from "../utils/perfProfile";

const TargetCursor = React.lazy(() => import("./TargetCursor"));

const isDesktopPointerEnv = () => {
  if (typeof window === "undefined") return false;
  const hasTouchScreen = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  const isSmallScreen = window.innerWidth <= 768;
  const userAgent = navigator.userAgent || navigator.vendor || "";
  const mobileRegex = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i;
  const isMobileUserAgent = mobileRegex.test(userAgent.toLowerCase());
  return !((hasTouchScreen && isSmallScreen) || isMobileUserAgent);
};

/** 桌面端按需加载 GSAP 自定义光标 */
const DeferredTargetCursor: React.FC = () => {
  const [enabled, setEnabled] = React.useState(false);

  React.useEffect(() => {
    if (isDesktopPointerEnv()) {
      setEnabled(true);
    }
  }, []);

  if (!enabled) return null;

  const { cursorParallax } = getPerfProfile();

  return (
    <React.Suspense fallback={null}>
      <TargetCursor
        targetSelector={TARGET_CURSOR_SELECTOR}
        spinDuration={2}
        hideDefaultCursor
        parallaxOn={cursorParallax}
        hoverDuration={0.2}
        idleSpreadScale={0.72}
      />
    </React.Suspense>
  );
};

export default DeferredTargetCursor;
