import React from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../api/client";

const MERGE_MS = 520;

/** 上传卡片内：果冻分裂 / 聚拢（润 / 降AI / 返回） */
type GooeySplitButtonProps = {
  rawText?: string;
};

const GooeySplitButton: React.FC<GooeySplitButtonProps> = ({ rawText }) => {
  const navigate = useNavigate();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = React.useState(false);
  /** 收起过程中短时保留 goo 滤镜，让「水滴聚拢」更明显 */
  const [merging, setMerging] = React.useState(false);
  const [jellyBtn, setJellyBtn] = React.useState<1 | 2 | 3 | null>(null);
  const expandedRef = React.useRef(false);
  const pendingNavTimerRef = React.useRef<number | null>(null);
  React.useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);

  const clearPendingNav = React.useCallback(() => {
    if (pendingNavTimerRef.current) {
      window.clearTimeout(pendingNavTimerRef.current);
      pendingNavTimerRef.current = null;
    }
  }, []);

  const createMockTaskId = React.useCallback((mode: "polish" | "reduce") => {
    // mock taskId：仅用于展示工作台路由跳转效果
    return `mock-${mode}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  }, []);

  const beginMerge = React.useCallback(() => {
    if (!expandedRef.current) return;
    setExpanded(false);
    setMerging(true);
    window.setTimeout(() => setMerging(false), MERGE_MS);
  }, []);

  React.useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        if (expanded) beginMerge();
      }
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [expanded, beginMerge]);

  const runJelly = (btn: 1 | 2 | 3, action: "polish" | "reduce" | "cancel") => {
    if (action === "cancel") {
      beginMerge();
      return;
    }

    setJellyBtn(btn);
    window.setTimeout(() => setJellyBtn(null), 800);

    window.setTimeout(() => {
      // eslint-disable-next-line no-console
      console.log("Gooey action:", action);
    }, 800);
  };

  const gooClass = expanded || merging ? " upload-gooey-container--goo" : "";

  React.useEffect(() => {
    return () => clearPendingNav();
  }, [clearPendingNav]);

  return (
    <div className="upload-gooey-wrapper" ref={containerRef}>
      <svg className="upload-gooey-svg-filters" aria-hidden="true" focusable="false">
        <defs>
          <filter id="uploadGooFilter" colorInterpolationFilters="sRGB">
            <feGaussianBlur in="SourceGraphic" stdDeviation="8" result="blur" />
            <feColorMatrix
              in="blur"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -8"
              result="goo"
            />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" />
          </filter>
        </defs>
      </svg>

      <div
        className={`upload-gooey-container${expanded ? " upload-gooey-container--active" : ""}${gooClass}`}
      >
        <button
          type="button"
          className={`upload-gooey-btn upload-gooey-sub upload-gooey-sub-1 ${jellyBtn === 1 ? "upload-gooey-jelly" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            clearPendingNav();
            runJelly(1, "polish");

            const payload: any = { mode: "polish" };
            if (rawText && rawText.trim().length > 0) payload.raw_text = rawText;

            const createTaskPromise = apiRequest<{ taskId: string }>("/api/tasks", {
              method: "POST",
              json: payload
            });

            // 让动画先播放，再跳转到段落工作台（主题=优化）
            pendingNavTimerRef.current = window.setTimeout(() => {
              createTaskPromise
                .then((res) => {
                  navigate(`/console/polish/${res.taskId}?mode=polish`);
                })
                .catch(() => {
                  // apiRequest 内部会处理 401 跳转
                });
            }, 820);
          }}
        >
          润
        </button>
        <button
          type="button"
          className={`upload-gooey-btn upload-gooey-sub upload-gooey-sub-2 ${jellyBtn === 2 ? "upload-gooey-jelly" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            clearPendingNav();
            runJelly(2, "reduce");

            const payload: any = { mode: "reduce" };
            if (rawText && rawText.trim().length > 0) payload.raw_text = rawText;

            const createTaskPromise = apiRequest<{ taskId: string }>("/api/tasks", {
              method: "POST",
              json: payload
            });

            // 让动画先播放，再跳转到段落工作台
            pendingNavTimerRef.current = window.setTimeout(() => {
              createTaskPromise
                .then((res) => {
                  navigate(`/console/polish/${res.taskId}?mode=reduce`);
                })
                .catch(() => {
                  // apiRequest 内部会处理 401 跳转
                });
            }, 820);
          }}
        >
          ↓ai
        </button>
        <button
          type="button"
          className={`upload-gooey-btn upload-gooey-sub upload-gooey-sub-3 ${jellyBtn === 3 ? "upload-gooey-jelly" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            clearPendingNav();
            runJelly(3, "cancel");
          }}
        >
          ↩
        </button>

        <button
          type="button"
          className="upload-gooey-btn upload-gooey-main"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(true);
            setMerging(false);
          }}
        >
          开始
        </button>
      </div>
    </div>
  );
};

export default GooeySplitButton;
