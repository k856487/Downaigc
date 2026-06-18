import React from "react";
import { App } from "antd";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useReward } from "../state/RewardContext";
import { countBillingChars } from "../utils/textStats";
import { resolveTaskCharge } from "../utils/taskBilling";

const MERGE_MS = 520;

/** 上传卡片内：果冻分裂 / 聚拢（润 / 降AI / 返回） */
type GooeySplitButtonProps = {
  rawText?: string;
};

const GooeySplitButton: React.FC<GooeySplitButtonProps> = ({ rawText }) => {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const { state: rewardState } = useReward();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = React.useState(false);
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

  const beginMerge = React.useCallback(() => {
    if (!expandedRef.current) return;
    setExpanded(false);
    setMerging(true);
    window.setTimeout(() => setMerging(false), MERGE_MS + 80);
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

  const gooClass = expanded || merging ? "upload-gooey-container--goo" : "";
  const wrapperClass = expanded ? " upload-gooey-wrapper--expanded" : "";
  const containerClass = [
    "upload-gooey-container",
    expanded ? "upload-gooey-container--active" : "",
    gooClass.trim(),
    merging ? "upload-gooey-container--merging" : ""
  ]
    .filter(Boolean)
    .join(" ");

  React.useEffect(() => {
    return () => clearPendingNav();
  }, [clearPendingNav]);

  /** 预估校验（实际按输出汉字数在服务端扣费） */
  const canStartTask = React.useCallback(
    (estimatedChars: number) => {
      const charge = resolveTaskCharge(estimatedChars, rewardState.writableWords);
      if (!charge.ok) {
        message.warning(charge.message ?? "可改写字数不足");
        return false;
      }
      return true;
    },
    [message, rewardState.writableWords]
  );

  return (
    <div className={`upload-gooey-wrapper${wrapperClass}`} ref={containerRef}>
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

      <div className={containerClass}>
        <button
          type="button"
          className={`upload-gooey-btn upload-gooey-sub upload-gooey-sub-1 ${jellyBtn === 1 ? "upload-gooey-jelly" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            clearPendingNav();
            const estimated = countBillingChars((rawText ?? "").trim());
            if (!canStartTask(estimated)) return;
            runJelly(1, "polish");

            const payload: any = { mode: "polish" };
            if (rawText && rawText.trim().length > 0) payload.raw_text = rawText;

            const createTaskPromise = apiRequest<{
              taskId: string;
              citationsRemoved?: number;
            }>("/api/tasks", {
              method: "POST",
              json: payload
            });

            pendingNavTimerRef.current = window.setTimeout(() => {
              createTaskPromise
                .then((res) => {
                  const n = res.citationsRemoved ?? 0;
                  if (n > 0) {
                    try {
                      window.sessionStorage.setItem(
                        `taskCitationStrip:${res.taskId}`,
                        String(n)
                      );
                    } catch {
                      /* ignore */
                    }
                  }
                  navigate(`/console/polish/${res.taskId}?mode=polish`);
                })
                .catch(() => {
                  /* apiRequest 内部会处理 401 跳转 */
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
            const estimated = countBillingChars((rawText ?? "").trim());
            if (!canStartTask(estimated)) return;
            runJelly(2, "reduce");

            const payload: any = { mode: "reduce" };
            if (rawText && rawText.trim().length > 0) payload.raw_text = rawText;

            const createTaskPromise = apiRequest<{
              taskId: string;
              citationsRemoved?: number;
            }>("/api/tasks", {
              method: "POST",
              json: payload
            });

            pendingNavTimerRef.current = window.setTimeout(() => {
              createTaskPromise
                .then((res) => {
                  const n = res.citationsRemoved ?? 0;
                  if (n > 0) {
                    try {
                      window.sessionStorage.setItem(
                        `taskCitationStrip:${res.taskId}`,
                        String(n)
                      );
                    } catch {
                      /* ignore */
                    }
                  }
                  navigate(`/console/polish/${res.taskId}?mode=reduce`);
                })
                .catch(() => {
                  /* apiRequest 内部会处理 401 跳转 */
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
