import React from "react";

const TOP_GUTTER = 10;
const BOTTOM_GUTTER = 10;

/** 侧栏高度随窗口变化置底（避免 overflow/sticky 下 100dvh 不可靠） */
export function useConsoleSiderHeight(active: boolean) {
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useLayoutEffect(() => {
    const root = scrollRef.current;
    if (!root || !active) return;

    const sync = () => {
      const vh = window.visualViewport?.height ?? window.innerHeight;
      const height = Math.max(
        320,
        Math.round(vh - TOP_GUTTER - BOTTOM_GUTTER)
      );
      root.style.setProperty("--console-sider-height-px", `${height}px`);
    };

    sync();
    const raf = window.requestAnimationFrame(sync);
    window.addEventListener("resize", sync);
    window.visualViewport?.addEventListener("resize", sync);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", sync);
      window.visualViewport?.removeEventListener("resize", sync);
    };
  }, [active]);

  return scrollRef;
}
