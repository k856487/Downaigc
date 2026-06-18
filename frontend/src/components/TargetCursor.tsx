import { useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import type { gsap as GSAP } from "gsap";
import { TARGET_CURSOR_INPUT_SELECTOR } from "./targetCursorConstants";
import {
  createInputFrameState,
  inputStillFocused,
  isInputFrameLocked,
  resolveInputTarget,
  type InputFrameState
} from "./targetCursorInputFrame";
import "./TargetCursor.css";

const isInputLikeElement = (el: Element) => el.matches(TARGET_CURSOR_INPUT_SELECTOR);

const isPointerOverInput = (x: number, y: number) => {
  const el = document.elementFromPoint(x, y);
  if (el?.closest(TARGET_CURSOR_INPUT_SELECTOR)) return true;
  const ae = document.activeElement;
  if (ae instanceof HTMLElement && ae.closest(TARGET_CURSOR_INPUT_SELECTOR)) return true;
  return false;
};

const syncDotForPointer = (
  gsap: typeof GSAP,
  x: number,
  y: number,
  dot: HTMLDivElement
) => {
  const overInput = isPointerOverInput(x, y);
  document.documentElement.classList.toggle("target-cursor-over-input", overInput);
  gsap.set(dot, { opacity: overInput ? 0 : 1, scale: 1 });
};

const getContainingBlock = (element: HTMLElement | null): HTMLElement | null => {
  let node = element?.parentElement;
  while (node && node !== document.documentElement) {
    const style = getComputedStyle(node);
    if (
      style.transform !== "none" ||
      style.perspective !== "none" ||
      style.filter !== "none" ||
      style.willChange.includes("transform") ||
      style.willChange.includes("perspective") ||
      style.willChange.includes("filter") ||
      /paint|layout|strict|content/.test(style.contain)
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
};

const getContainingBlockOffset = (block: HTMLElement | null) => {
  if (!block) return { x: 0, y: 0 };
  const rect = block.getBoundingClientRect();
  return { x: rect.left + block.clientLeft, y: rect.top + block.clientTop };
};

export type TargetCursorProps = {
  targetSelector?: string;
  spinDuration?: number;
  hideDefaultCursor?: boolean;
  hoverDuration?: number;
  parallaxOn?: boolean;
  idleSpreadScale?: number;
};

const TargetCursor = ({
  targetSelector = ".cursor-target",
  spinDuration = 2,
  hideDefaultCursor = true,
  hoverDuration = 0.2,
  parallaxOn = true,
  idleSpreadScale = 0.72
}: TargetCursorProps) => {
  const cursorRef = useRef<HTMLDivElement>(null);
  const cornersRef = useRef<NodeListOf<Element> | null>(null);
  const spinTl = useRef<ReturnType<typeof GSAP.timeline> | null>(null);
  const dotRef = useRef<HTMLDivElement>(null);
  const containingBlockRef = useRef<HTMLElement | null>(null);
  const isActiveRef = useRef(false);
  const targetCornerPositionsRef = useRef<Array<{ x: number; y: number }> | null>(null);
  const tickerFnRef = useRef<(() => void) | null>(null);
  const activeStrengthRef = useRef({ current: 0 });

  const isMobile = useMemo(() => {
    if (typeof window === "undefined") return false;
    const hasTouchScreen = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    const isSmallScreen = window.innerWidth <= 768;
    const ua = navigator.userAgent || navigator.vendor || "";
    return (hasTouchScreen && isSmallScreen) || /android|iphone|ipad|mobile/i.test(ua);
  }, []);

  const constants = useMemo(
    () => ({ borderWidth: 2, cornerSize: 10, idleSpreadScale }),
    [idleSpreadScale]
  );

  const gsapRef = useRef<typeof GSAP | null>(null);

  const getIdleCornerPositions = useCallback(() => {
    const { cornerSize, idleSpreadScale: scale } = constants;
    const spread = cornerSize * 1.5 * scale;
    return [
      { x: -spread, y: -spread },
      { x: cornerSize * 0.5 * scale, y: -spread },
      { x: cornerSize * 0.5 * scale, y: cornerSize * 0.5 * scale },
      { x: -spread, y: cornerSize * 0.5 * scale }
    ];
  }, [constants]);

  useEffect(() => {
    if (isMobile || !cursorRef.current) return;

    let cancelled = false;
    let dispose: (() => void) | undefined;

    void import("gsap").then(({ gsap }) => {
      if (cancelled || !cursorRef.current) return;
      gsapRef.current = gsap;

      const moveCursor = (x: number, y: number) => {
        if (!cursorRef.current) return;
        const { x: offsetX, y: offsetY } = getContainingBlockOffset(containingBlockRef.current);
        gsap.to(cursorRef.current, {
          x: x - offsetX,
          y: y - offsetY,
          duration: 0.1,
          ease: "power3.out"
        });
      };

      const originalCursor = document.body.style.cursor;
      if (hideDefaultCursor) {
        document.body.style.cursor = "none";
        document.documentElement.classList.add("target-cursor-active");
      }

      const cursor = cursorRef.current;
      cornersRef.current = cursor.querySelectorAll(".target-cursor-corner");
      containingBlockRef.current = getContainingBlock(cursor);
      const getOffset = () => getContainingBlockOffset(containingBlockRef.current);

      let activeTarget: Element | null = null;
      let currentLeaveHandler: (() => void) | null = null;
      let resumeTimeout: ReturnType<typeof setTimeout> | null = null;
      let lastPointer = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
      let blurTimer: ReturnType<typeof setTimeout> | null = null;

      const inputFrame: InputFrameState = createInputFrameState();

      const resolveInput = (el: Element | null) =>
        resolveInputTarget(el, TARGET_CURSOR_INPUT_SELECTOR);

      const cleanupTarget = (target: Element) => {
        if (currentLeaveHandler) {
          target.removeEventListener("mouseleave", currentLeaveHandler);
        }
        currentLeaveHandler = null;
      };

      const updateTargetCorners = (target: Element) => {
        if (!cursorRef.current || !cornersRef.current) return;
        const rect = target.getBoundingClientRect();
        const { borderWidth, cornerSize } = constants;
        const { x: offsetX, y: offsetY } = getOffset();
        const cursorX = gsap.getProperty(cursorRef.current, "x") as number;
        const cursorY = gsap.getProperty(cursorRef.current, "y") as number;

        targetCornerPositionsRef.current = [
          { x: rect.left - borderWidth - offsetX, y: rect.top - borderWidth - offsetY },
          { x: rect.right + borderWidth - cornerSize - offsetX, y: rect.top - borderWidth - offsetY },
          {
            x: rect.right + borderWidth - cornerSize - offsetX,
            y: rect.bottom + borderWidth - cornerSize - offsetY
          },
          { x: rect.left - borderWidth - offsetX, y: rect.bottom + borderWidth - cornerSize - offsetY }
        ];

        Array.from(cornersRef.current).forEach((corner, i) => {
          gsap.to(corner, {
            x: targetCornerPositionsRef.current![i].x - cursorX,
            y: targetCornerPositionsRef.current![i].y - cursorY,
            duration: 0.2,
            ease: "power2.out"
          });
        });
      };

      const deactivateTarget = () => {
        if (!activeTarget) return;
        const target = activeTarget;
        if (tickerFnRef.current) gsap.ticker.remove(tickerFnRef.current);

        isActiveRef.current = false;
        targetCornerPositionsRef.current = null;
        gsap.set(activeStrengthRef.current, { current: 0, overwrite: true });
        activeTarget = null;

        if (cornersRef.current) {
          const cornerEls = Array.from(cornersRef.current);
          gsap.killTweensOf(cornerEls);
          const positions = getIdleCornerPositions();
          const tl = gsap.timeline();
          cornerEls.forEach((corner, index) => {
            tl.to(
              corner,
              {
                x: positions[index].x,
                y: positions[index].y,
                duration: 0.3,
                ease: "power3.out"
              },
              0
            );
          });
        }

        resumeTimeout = setTimeout(() => {
          if (!activeTarget && cursorRef.current && spinTl.current) {
            const rot = (gsap.getProperty(cursorRef.current, "rotation") as number) % 360;
            spinTl.current.kill();
            spinTl.current = gsap
              .timeline({ repeat: -1 })
              .to(cursorRef.current, { rotation: "+=360", duration: spinDuration, ease: "none" });
            gsap.to(cursorRef.current, {
              rotation: rot + 360,
              duration: spinDuration * (1 - rot / 360),
              ease: "none",
              onComplete: () => spinTl.current?.restart()
            });
          }
          resumeTimeout = null;
        }, 50);

        cleanupTarget(target);
      };

      const activateTarget = (target: Element) => {
        if (!cursorRef.current || !cornersRef.current) return;
        if (activeTarget === target) {
          if (isInputLikeElement(target)) updateTargetCorners(target);
          return;
        }
        if (activeTarget) cleanupTarget(activeTarget);
        if (resumeTimeout) {
          clearTimeout(resumeTimeout);
          resumeTimeout = null;
        }

        activeTarget = target;
        gsap.killTweensOf(Array.from(cornersRef.current));
        gsap.killTweensOf(cursorRef.current, "rotation");
        spinTl.current?.pause();
        gsap.set(cursorRef.current, { rotation: 0 });

        updateTargetCorners(target);
        isActiveRef.current = true;
        gsap.ticker.add(tickerFnRef.current!);
        gsap.to(activeStrengthRef.current, { current: 1, duration: hoverDuration, ease: "power2.out" });

        const leaveHandler = () => {
          if (isInputLikeElement(target) && isInputFrameLocked(inputFrame)) return;
          if (activeTarget === target) deactivateTarget();
        };
        currentLeaveHandler = leaveHandler;
        target.addEventListener("mouseleave", leaveHandler);
      };

      const pinInputFrame = (input: Element) => {
        if (blurTimer) {
          clearTimeout(blurTimer);
          blurTimer = null;
        }
        inputFrame.focusedInput = input;
        activateTarget(input);
      };

      const scheduleInputBlurCheck = (input: Element) => {
        if (blurTimer) clearTimeout(blurTimer);
        blurTimer = window.setTimeout(() => {
          blurTimer = null;
          if (isInputFrameLocked(inputFrame)) return;
          if (inputStillFocused(input, inputFrame.composingEl)) return;
          if (inputFrame.focusedInput === input) inputFrame.focusedInput = null;
          if (activeTarget === input) deactivateTarget();
        }, 160);
      };

      gsap.set(cursor, {
        xPercent: -50,
        yPercent: -50,
        x: window.innerWidth / 2 - getOffset().x,
        y: window.innerHeight / 2 - getOffset().y
      });

      if (cornersRef.current) {
        const idle = getIdleCornerPositions();
        cornersRef.current.forEach((corner, i) => gsap.set(corner, idle[i]));
      }

      spinTl.current = gsap
        .timeline({ repeat: -1 })
        .to(cursor, { rotation: "+=360", duration: spinDuration, ease: "none" });

      const tickerFn = () => {
        if (!targetCornerPositionsRef.current || !cursorRef.current || !cornersRef.current) return;
        if (activeStrengthRef.current.current === 0) return;

        const cursorX = gsap.getProperty(cursorRef.current, "x") as number;
        const cursorY = gsap.getProperty(cursorRef.current, "y") as number;

        Array.from(cornersRef.current).forEach((corner, i) => {
          const cx = gsap.getProperty(corner, "x") as number;
          const cy = gsap.getProperty(corner, "y") as number;
          const tx = targetCornerPositionsRef.current![i].x - cursorX;
          const ty = targetCornerPositionsRef.current![i].y - cursorY;
          const s = activeStrengthRef.current.current;
          const finalX = cx + (tx - cx) * s;
          const finalY = cy + (ty - cy) * s;
          const duration = s >= 0.99 ? (parallaxOn ? 0.2 : 0) : 0.05;
          gsap.to(corner, {
            x: finalX,
            y: finalY,
            duration,
            ease: duration === 0 ? "none" : "power1.out",
            overwrite: "auto"
          });
        });
      };
      tickerFnRef.current = tickerFn;

      const moveHandler = (e: MouseEvent) => {
        lastPointer = { x: e.clientX, y: e.clientY };
        moveCursor(e.clientX, e.clientY);
        if (dotRef.current) syncDotForPointer(gsap, e.clientX, e.clientY, dotRef.current);
      };

      const enterHandler = (e: MouseEvent) => {
        if (isInputFrameLocked(inputFrame) && inputFrame.focusedInput) {
          pinInputFrame(inputFrame.focusedInput);
          return;
        }

        let node: Element | null = e.target as Element;
        while (node && node !== document.body) {
          if (node.matches(targetSelector)) {
            activateTarget(node);
            return;
          }
          node = node.parentElement;
        }
      };

      const focusInHandler = (e: FocusEvent) => {
        const input = resolveInput(e.target as Element);
        if (!input) return;
        pinInputFrame(input);
        if (dotRef.current) syncDotForPointer(gsap, lastPointer.x, lastPointer.y, dotRef.current);
      };

      const focusOutHandler = (e: FocusEvent) => {
        const input = resolveInput(e.target as Element);
        if (!input) return;
        if (isInputFrameLocked(inputFrame)) return;
        scheduleInputBlurCheck(input);
      };

      const keyDownHandler = (e: KeyboardEvent) => {
        const input = resolveInput(e.target as Element);
        if (!input) return;
        pinInputFrame(input);
      };

      const compositionStartHandler = (e: CompositionEvent) => {
        inputFrame.composingEl = (e.target as Element) ?? null;
        const input = resolveInput(inputFrame.composingEl) ?? inputFrame.focusedInput;
        if (input) pinInputFrame(input);
      };

      const compositionEndHandler = () => {
        inputFrame.composingEl = null;
        if (inputFrame.focusedInput) updateTargetCorners(inputFrame.focusedInput);
      };

      const scrollHandler = () => {
        if (!activeTarget) return;
        if (
          isInputLikeElement(activeTarget) &&
          inputFrame.focusedInput === activeTarget &&
          (isInputFrameLocked(inputFrame) || inputStillFocused(activeTarget, inputFrame.composingEl))
        ) {
          updateTargetCorners(activeTarget);
          return;
        }
        const under = document.elementFromPoint(lastPointer.x, lastPointer.y);
        const stillOver =
          under &&
          (under === activeTarget || under.closest(targetSelector) === activeTarget);
        if (!stillOver) deactivateTarget();
      };

      const hideCursorOnWindowLeave = () => {
        if (!cursorRef.current) return;
        gsap.set(cursorRef.current, { opacity: 0, visibility: "hidden" });
        spinTl.current?.pause();
        if (activeTarget) deactivateTarget();
      };

      const showCursorOnWindowEnter = (e: MouseEvent) => {
        if (!cursorRef.current) return;
        lastPointer = { x: e.clientX, y: e.clientY };
        gsap.set(cursorRef.current, { opacity: 1, visibility: "visible" });
        moveCursor(e.clientX, e.clientY);
        if (!activeTarget) spinTl.current?.play();
      };

      const mouseDownHandler = (e: MouseEvent) => {
        if (!dotRef.current || isPointerOverInput(e.clientX, e.clientY)) return;
        gsap.to(dotRef.current, { scale: 0.7, duration: 0.3 });
        gsap.to(cursorRef.current, { scale: 0.9, duration: 0.2 });
      };

      const mouseUpHandler = (e: MouseEvent) => {
        if (!dotRef.current || isPointerOverInput(e.clientX, e.clientY)) return;
        gsap.to(dotRef.current, { scale: 1, duration: 0.3 });
        gsap.to(cursorRef.current, { scale: 1, duration: 0.2 });
      };

      window.addEventListener("mousemove", moveHandler);
      document.documentElement.addEventListener("mouseleave", hideCursorOnWindowLeave);
      document.documentElement.addEventListener("mouseenter", showCursorOnWindowEnter);
      window.addEventListener("mouseover", enterHandler, { passive: true });
      window.addEventListener("scroll", scrollHandler, { passive: true });
      window.addEventListener("mousedown", mouseDownHandler);
      window.addEventListener("mouseup", mouseUpHandler);
      document.addEventListener("focusin", focusInHandler, true);
      document.addEventListener("focusout", focusOutHandler, true);
      document.addEventListener("keydown", keyDownHandler, true);
      document.addEventListener("compositionstart", compositionStartHandler, true);
      document.addEventListener("compositionend", compositionEndHandler, true);

      const resizeHandler = () => {
        containingBlockRef.current = getContainingBlock(cursor);
      };
      window.addEventListener("resize", resizeHandler);

      dispose = () => {
        if (tickerFnRef.current) gsap.ticker.remove(tickerFnRef.current);
        window.removeEventListener("mousemove", moveHandler);
        document.documentElement.removeEventListener("mouseleave", hideCursorOnWindowLeave);
        document.documentElement.removeEventListener("mouseenter", showCursorOnWindowEnter);
        window.removeEventListener("mouseover", enterHandler);
        window.removeEventListener("scroll", scrollHandler);
        window.removeEventListener("mousedown", mouseDownHandler);
        window.removeEventListener("mouseup", mouseUpHandler);
        window.removeEventListener("resize", resizeHandler);
        document.removeEventListener("focusin", focusInHandler, true);
        document.removeEventListener("focusout", focusOutHandler, true);
        document.removeEventListener("keydown", keyDownHandler, true);
        document.removeEventListener("compositionstart", compositionStartHandler, true);
        document.removeEventListener("compositionend", compositionEndHandler, true);
        if (blurTimer) clearTimeout(blurTimer);
        if (activeTarget) cleanupTarget(activeTarget);
        spinTl.current?.kill();
        document.body.style.cursor = originalCursor;
        document.documentElement.classList.remove("target-cursor-active");
        document.documentElement.classList.remove("target-cursor-over-input");
      };
    });

    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [
    targetSelector,
    spinDuration,
    constants,
    hideDefaultCursor,
    isMobile,
    hoverDuration,
    parallaxOn,
    getIdleCornerPositions
  ]);

  useEffect(() => {
    const gsap = gsapRef.current;
    if (isMobile || !cursorRef.current || !gsap || !spinTl.current) return;
    if (spinTl.current.isActive()) {
      spinTl.current.kill();
      spinTl.current = gsap
        .timeline({ repeat: -1 })
        .to(cursorRef.current, { rotation: "+=360", duration: spinDuration, ease: "none" });
    }
  }, [spinDuration, isMobile]);

  if (isMobile) return null;

  return createPortal(
    <div ref={cursorRef} className="target-cursor-wrapper">
      <div ref={dotRef} className="target-cursor-dot" />
      <div className="target-cursor-corner corner-tl" />
      <div className="target-cursor-corner corner-tr" />
      <div className="target-cursor-corner corner-br" />
      <div className="target-cursor-corner corner-bl" />
    </div>,
    document.body
  );
};

export default TargetCursor;

export { TARGET_CURSOR_SELECTOR, TARGET_CURSOR_INPUT_SELECTOR } from "./targetCursorConstants";
