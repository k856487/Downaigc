import React from "react";
import { App, Layout, Menu, Space, Typography } from "antd";
import {
  PauseOutlined,
  CaretRightOutlined,
  CheckCircleFilled,
  AimOutlined
} from "@ant-design/icons";
import { useParams, useSearchParams } from "react-router-dom";
import ParagraphCompareCard from "../components/ParagraphCompareCard";
import GalaxyButton from "../components/GalaxyButton";
import { apiRequest } from "../api/client";
import { countBackendWords } from "../utils/textStats";

const { Sider, Content } = Layout;

const FOLLOW_SCROLL_STORAGE_KEY = "workbench-follow-scroll.v1";

/** 任务创建时间 → 展示用 YYYY/MM/DD（本地时区） */
function formatTaskDateYmd(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

/** Windows 文件名非法字符替换为下划线，确保 a.download 可用 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]/g, "_") // 重点：日期里的 "/" 也会被替换
    .replace(/\s+/g, " ")
    .trim();
}

function getNextParagraphIndex(
  list: Array<{ index: number }>,
  afterIdx: number
): number | null {
  const sorted = [...list].sort((a, b) => a.index - b.index);
  const i = sorted.findIndex((p) => p.index === afterIdx);
  if (i < 0 || i >= sorted.length - 1) return null;
  return sorted[i + 1].index;
}

const PolishWorkbenchPage: React.FC = () => {
  const { taskId } = useParams<{ taskId: string }>();
  const [searchParams] = useSearchParams();
  const queryMode =
    (searchParams.get("mode") as "polish" | "reduce" | null) ?? "reduce";

  type ApiTaskDetail = {
    id: string;
    userId: string;
    mode: "polish" | "reduce";
    status: "pending" | "running" | "done";
    createdAt: string;
    title: string;
    paragraphs: Array<{
      index: number;
      wordCount: number;
      original: string;
      polished: string;
    }>;
  };

  type ParagraphUI = ApiTaskDetail["paragraphs"][number] & {
    originalWordCount: number;
  };

  const { message } = App.useApp();

  const [taskMode, setTaskMode] = React.useState<"polish" | "reduce">(queryMode);
  const [paragraphs, setParagraphs] = React.useState<ParagraphUI[]>([]);
  const paragraphsRef = React.useRef<ParagraphUI[]>([]);
  paragraphsRef.current = paragraphs;
  const [currentParagraphIdx, setCurrentParagraphIdx] = React.useState<number>(1);
  const [loading, setLoading] = React.useState(false);
  const autoProcessedRef = React.useRef(false);
  /** reduce 模式：进入工作台后自动连续跑各段；用户点「中止」后关闭 */
  const reduceAutoBatchActiveRef = React.useRef(false);
  /**
   * 降 AIGC 自动连段被「中止」时记录当时处理到的段落号；
   * 用于：未开启跟随时先点选其它段并「重降当前段」处理完后，再滚回该段恢复连段。
   */
  const pausedReduceBatchParagraphIdxRef = React.useRef<number | null>(null);
  /** 当前段 API+逐字（或跳过）完全结束后的回调（链式恢复用） */
  const paragraphOnFullyDoneRef = React.useRef<((finishedIdx: number) => void) | null>(
    null
  );
  /**
   * 「先完成选中段再恢复中断连段」时，第一段完成会设 naturalFinishIdx；
   * 跳过一次 reduce 连段 effect，避免与 onFullyDone 里启动的暂停段处理打架。
   */
  const suppressNextReduceChainEffectRef = React.useRef(false);
  const processingInFlightRef = React.useRef(false);
  /** 防止「打断后立刻新开一段」时，旧请求的 finally 误伤新请求 */
  const processEpochRef = React.useRef(0);
  const typingTimerRef = React.useRef<number | null>(null);
  const typingFullTextRef = React.useRef("");
  const typingTargetIdxRef = React.useRef(0);
  const typingPosRef = React.useRef(0);
  const abortProcessRef = React.useRef<AbortController | null>(null);
  const [typingIdx, setTypingIdx] = React.useState<number | null>(null);
  const typingIdxRef = React.useRef<number | null>(null);
  typingIdxRef.current = typingIdx;
  /** 仅表示「等待 /process 返回」；逐字动画仅在拿到最终 polished 后由 typingIdx + revealTyping 驱动 */
  const [awaitingParagraphIdx, setAwaitingParagraphIdx] = React.useState<
    number | null
  >(null);
  const awaitingParagraphIdxRef = React.useRef<number | null>(null);
  awaitingParagraphIdxRef.current = awaitingParagraphIdx;
  /**
   * 跟随滚动用锚点：与「正在生成」的段落一致；思考阶段点「暂停」会中止请求并清空 typingIdx，
   * 但保留本字段，避免跟随失效（仍可对应该段）。
   */
  const [followScrollAnchorIdx, setFollowScrollAnchorIdx] = React.useState<
    number | null
  >(null);
  /** 仅表示「逐字输出」被暂停，可与继续配对 */
  const [typingPaused, setTypingPaused] = React.useState(false);
  const typingPausedRef = React.useRef(false);
  typingPausedRef.current = typingPaused;
  /** 逐字输出自然跑完的段落 index；与 currentParagraphIdx 一致时圆钮空闲禁用（不再点一次就重跑） */
  const [naturalFinishIdx, setNaturalFinishIdx] = React.useState<number | null>(null);
  /** 左侧菜单：已跑完（逐字结束或跳过）的段落 index */
  const [doneParagraphIdxs, setDoneParagraphIdxs] = React.useState<number[]>([]);
  const [taskTitle, setTaskTitle] = React.useState("");
  const [taskCreatedAt, setTaskCreatedAt] = React.useState<string | null>(null);
  /** 生成过程中是否自动滚动到当前处理段落 */
  const [realtimeFollowScroll, setRealtimeFollowScroll] = React.useState(() => {
    try {
      return window.localStorage.getItem(FOLLOW_SCROLL_STORAGE_KEY) !== "0";
    } catch {
      return true;
    }
  });
  /** 异步回调（跳过、连段）里读取最新开关，避免闭包陈旧 */
  const realtimeFollowScrollRef = React.useRef(realtimeFollowScroll);
  realtimeFollowScrollRef.current = realtimeFollowScroll;

  /**
   * 降 AIGC 自动连段下一目标：若曾中止在某段（paused），优先回到该段，而不是按文档顺序取「刚完成段」的下一段。
   * 当刚完成的段就是中止段时，清空中止记录，再按顺序往下。
   */
  const resolveNextReduceChainIdx = React.useCallback(
    (finishedIdx: number): number | null => {
      const list = paragraphsRef.current;
      const paused = pausedReduceBatchParagraphIdxRef.current;
      if (paused !== null) {
        if (finishedIdx === paused) {
          pausedReduceBatchParagraphIdxRef.current = null;
          return getNextParagraphIndex(list, finishedIdx);
        }
        return paused;
      }
      return getNextParagraphIndex(list, finishedIdx);
    },
    []
  );

  /** 思考中/逐字中/逐字暂停中：需要先打断再开始「重降当前段」 */
  const needsInterruptBeforeManualStart = React.useCallback(
    (targetSel: number) => {
      if (abortProcessRef.current !== null) return true;
      if (typingTimerRef.current !== null) return true;
      if (typingIdxRef.current !== null && typingIdxRef.current !== targetSel)
        return true;
      if (
        awaitingParagraphIdxRef.current !== null &&
        awaitingParagraphIdxRef.current !== targetSel
      )
        return true;
      if (
        typingIdxRef.current !== null &&
        typingIdxRef.current === targetSel &&
        typingPausedRef.current
      )
        return true;
      return false;
    },
    []
  );

  /**
   * 中止当前请求或逐字，便于立即开始选中段；降 AIGC 下把被打断的段记入 paused，便于选中段跑完后继续。
   * 与圆钮「停止生成」不同：不关 reduceAutoBatch，不弹「已停止」。
   */
  const interruptOngoingForManualRun = React.useCallback(
    (targetParaIdx: number) => {
      const cur =
        typingIdxRef.current ?? awaitingParagraphIdxRef.current;
      if (taskMode === "reduce" && cur !== null && cur !== targetParaIdx) {
        pausedReduceBatchParagraphIdxRef.current = cur;
        reduceAutoBatchActiveRef.current = true;
      }
      paragraphOnFullyDoneRef.current = null;
      suppressNextReduceChainEffectRef.current = false;

      if (abortProcessRef.current) {
        abortProcessRef.current.abort();
        abortProcessRef.current = null;
        processingInFlightRef.current = false;
        setLoading(false);
      }
      if (typingTimerRef.current) {
        window.clearInterval(typingTimerRef.current);
        typingTimerRef.current = null;
      }
      setTypingPaused(false);
      setTypingIdx(null);
      setAwaitingParagraphIdx(null);
      setFollowScrollAnchorIdx(null);
      setNaturalFinishIdx(null);
    },
    [taskMode]
  );

  React.useEffect(() => {
    if (!taskId) return;
    setLoading(true);
    setNaturalFinishIdx(null);
    setDoneParagraphIdxs([]);
    setFollowScrollAnchorIdx(null);
    setAwaitingParagraphIdx(null);
    pausedReduceBatchParagraphIdxRef.current = null;
    suppressNextReduceChainEffectRef.current = false;
    setTaskTitle("");
    setTaskCreatedAt(null);
    apiRequest<ApiTaskDetail>(`/api/tasks/${taskId}`, { method: "GET" })
      .then((res) => {
        setTaskMode(res.mode);
        setTaskTitle((res.title ?? "").trim());
        setTaskCreatedAt(res.createdAt ?? null);
        setParagraphs(
          res.paragraphs.map((p) => ({
            ...p,
            originalWordCount: countBackendWords(p.original)
          }))
        );
        const first = res.paragraphs?.[0]?.index;
        setCurrentParagraphIdx(first ?? 1);
        autoProcessedRef.current = false;
        reduceAutoBatchActiveRef.current = res.mode === "reduce";
      })
      .catch(() => {
        message.error("加载工作台失败，请重试");
      })
      .finally(() => setLoading(false));
  }, [taskId, message]);

  /**
   * 仅「实时跟随」开启时：滚到当前生成段。
   * typingIdx（逐字）优先；等待接口时用 awaitingParagraphIdx；中止后可用 followScrollAnchorIdx。
   */
  React.useEffect(() => {
    if (!taskId || !realtimeFollowScroll) return;
    const idx =
      typingIdx ?? awaitingParagraphIdx ?? followScrollAnchorIdx;
    if (idx === null) return;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        document
          .getElementById(`workbench-paragraph-${idx}`)
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }, [
    taskId,
    realtimeFollowScroll,
    typingIdx,
    typingPaused,
    awaitingParagraphIdx,
    followScrollAnchorIdx
  ]);

  const isPolish = taskMode === "polish";

  const taskHeadingText = React.useMemo(() => {
    if (!taskId) return "示例任务";
    const titlePart = taskTitle.trim() || "未命名文稿";
    const modePart = isPolish ? "润色" : "降AIGC";
    const datePart = taskCreatedAt ? formatTaskDateYmd(taskCreatedAt) : "";
    return `${titlePart}（${modePart}）${datePart}`;
  }, [taskId, taskTitle, taskCreatedAt, isPolish]);

  /** 是否处于可「暂停」的生成中：请求中，或正在逐字输出（未点暂停） */
  const isGenerationRunning =
    loading || (typingIdx !== null && !typingPaused);

  /** 圆形按钮：暂停中显示双竖线；逐字暂停待继续显示三角；空闲/结束后显示三角（非暂停态，避免灰条误认） */
  const circleIcon =
    typingPaused && typingIdx !== null ? (
      <CaretRightOutlined />
    ) : isGenerationRunning ? (
      <PauseOutlined />
    ) : (
      <CaretRightOutlined />
    );

  const circleIdleAfterNaturalComplete =
    naturalFinishIdx !== null &&
    naturalFinishIdx === currentParagraphIdx &&
    !isGenerationRunning &&
    !typingPaused;

  /** 无任务禁用；当前段已自然生成完成则禁用（点击无反应）；中止后仍可点圆钮重新开始 */
  const circleDisabled = !taskId || circleIdleAfterNaturalComplete;
  const circleTitle = !taskId
    ? "无任务"
    : circleIdleAfterNaturalComplete
      ? "当前段已生成完成"
      : typingPaused
        ? "继续生成"
        : isGenerationRunning
          ? "暂停生成"
          : isPolish
            ? "重优化当前段"
            : "重降当前段";

  const runTypingInterval = React.useCallback(() => {
    if (typingTimerRef.current) {
      window.clearInterval(typingTimerRef.current);
      typingTimerRef.current = null;
    }
    const tick = () => {
      const full = typingFullTextRef.current;
      const idx = typingTargetIdxRef.current;
      let pos = typingPosRef.current;
      pos = Math.min(full.length, pos + 1);
      typingPosRef.current = pos;
      const nextText = full.slice(0, pos);
      setParagraphs((prev) =>
        prev.map((p) =>
          p.index === idx
            ? { ...p, polished: nextText, wordCount: countBackendWords(nextText) }
            : p
        )
      );
      if (pos >= full.length) {
        if (typingTimerRef.current) {
          window.clearInterval(typingTimerRef.current);
          typingTimerRef.current = null;
        }
        setTypingIdx(null);
        setFollowScrollAnchorIdx(null);
        setTypingPaused(false);
        setNaturalFinishIdx(idx);
        setDoneParagraphIdxs((prev) =>
          prev.includes(idx) ? prev : [...prev, idx]
        );
        const doneCb = paragraphOnFullyDoneRef.current;
        paragraphOnFullyDoneRef.current = null;
        if (doneCb) {
          queueMicrotask(() => doneCb(idx));
        }
      }
    };
    typingTimerRef.current = window.setInterval(tick, 18);
  }, []);

  const revealTyping = React.useCallback(
    (idx: number, fullText: string) => {
      setAwaitingParagraphIdx(null);
      if (typingTimerRef.current) {
        window.clearInterval(typingTimerRef.current);
        typingTimerRef.current = null;
      }
      setTypingPaused(false);
      typingFullTextRef.current = fullText;
      typingTargetIdxRef.current = idx;
      typingPosRef.current = 0;

      setParagraphs((prev) =>
        prev.map((p) =>
          p.index === idx ? { ...p, polished: "", wordCount: 0 } : p
        )
      );
      setTypingIdx(idx);
      runTypingInterval();
    },
    [runTypingInterval]
  );

  const startProcessCurrentParagraph = React.useCallback(
    async (
      idx: number,
      options?: { onFullyDone?: (finishedIdx: number) => void }
    ) => {
      if (!taskId) return;
      if (processingInFlightRef.current) return;

      if (!options?.onFullyDone && pausedReduceBatchParagraphIdxRef.current === idx) {
        pausedReduceBatchParagraphIdxRef.current = null;
      }
      paragraphOnFullyDoneRef.current = options?.onFullyDone ?? null;
      if (options?.onFullyDone) {
        suppressNextReduceChainEffectRef.current = true;
      }

      const epoch = ++processEpochRef.current;
      processingInFlightRef.current = true;
      setNaturalFinishIdx(null);
      setDoneParagraphIdxs((prev) => prev.filter((x) => x !== idx));
      setLoading(true);
      setTypingPaused(false);

      const ac = new AbortController();
      abortProcessRef.current = ac;

      // 思考阶段：仅标 awaiting，不把 typingIdx 当作逐字（typingIdx 仅在 revealTyping 设置）
      setFollowScrollAnchorIdx(idx);
      setAwaitingParagraphIdx(idx);
      setParagraphs((prev) =>
        prev.map((p) => (p.index === idx ? { ...p, polished: "", wordCount: 0 } : p))
      );

      try {
        const res = await apiRequest<{
          paragraph: ApiTaskDetail["paragraphs"][number];
          skipped?: boolean;
        }>(`/api/tasks/${taskId}/paragraphs/${idx}/process`, {
          method: "POST",
          signal: ac.signal
        });

        if (res.skipped) {
          setAwaitingParagraphIdx(null);
          const skIdx = res.paragraph.index;
          setParagraphs((prev) =>
            prev.map((p) =>
              p.index === res.paragraph.index
                ? { ...res.paragraph, originalWordCount: p.originalWordCount }
                : p
            )
          );
          setTypingIdx(null);
          setFollowScrollAnchorIdx(null);
          setDoneParagraphIdxs((prev) =>
            prev.includes(skIdx) ? prev : [...prev, skIdx]
          );
          message.success("已跳过（无需润色/降重）");
          const skipDoneCb = paragraphOnFullyDoneRef.current;
          paragraphOnFullyDoneRef.current = null;
          if (skipDoneCb) {
            /* 跳过不会触发 naturalFinishIdx，避免 suppress 残留误伤后续连段 */
            suppressNextReduceChainEffectRef.current = false;
            queueMicrotask(() => skipDoneCb(skIdx));
          }
          if (
            reduceAutoBatchActiveRef.current &&
            taskMode === "reduce" &&
            taskId
          ) {
            const nextIdx = resolveNextReduceChainIdx(skIdx);
            if (nextIdx !== null) {
              setCurrentParagraphIdx(nextIdx);
              if (realtimeFollowScrollRef.current) {
                window.requestAnimationFrame(() => {
                  window.requestAnimationFrame(() => {
                    const el = document.getElementById(
                      `workbench-paragraph-${nextIdx}`
                    );
                    el?.scrollIntoView({ behavior: "smooth", block: "start" });
                  });
                });
              }
              // 等 finally 释放 processingInFlightRef 后再启动下一段
              queueMicrotask(() => {
                void startProcessCurrentParagraph(nextIdx);
              });
            }
          }
          return;
        }

        revealTyping(res.paragraph.index, res.paragraph.polished);
      } catch (e: unknown) {
        const aborted =
          (e instanceof Error && e.name === "AbortError") ||
          (typeof e === "object" &&
            e !== null &&
            (e as { name?: string }).name === "AbortError");
        if (aborted) {
          setAwaitingParagraphIdx(null);
          paragraphOnFullyDoneRef.current = null;
          suppressNextReduceChainEffectRef.current = false;
          return;
        }
        paragraphOnFullyDoneRef.current = null;
        suppressNextReduceChainEffectRef.current = false;
        setAwaitingParagraphIdx(null);
        setNaturalFinishIdx(null);
        setFollowScrollAnchorIdx(null);
        message.error("处理失败（已保持原文）");
      } finally {
        if (processEpochRef.current === epoch) {
          if (abortProcessRef.current === ac) {
            abortProcessRef.current = null;
          }
          processingInFlightRef.current = false;
          setLoading(false);
        }
      }
    },
    [taskId, revealTyping, message, taskMode, resolveNextReduceChainIdx]
  );

  /** reduce：某段逐字自然结束后，自动处理下一段 */
  React.useEffect(() => {
    if (!taskId) return;
    if (taskMode !== "reduce") return;
    if (!reduceAutoBatchActiveRef.current) return;
    if (naturalFinishIdx === null) return;
    if (suppressNextReduceChainEffectRef.current) {
      suppressNextReduceChainEffectRef.current = false;
      return;
    }

    const nextIdx = resolveNextReduceChainIdx(naturalFinishIdx);
    if (nextIdx === null) return;

    setCurrentParagraphIdx(nextIdx);
    if (realtimeFollowScroll) {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          const el = document.getElementById(`workbench-paragraph-${nextIdx}`);
          el?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      });
    }
    queueMicrotask(() => {
      void startProcessCurrentParagraph(nextIdx);
    });
  }, [
    naturalFinishIdx,
    taskId,
    taskMode,
    startProcessCurrentParagraph,
    realtimeFollowScroll,
    resolveNextReduceChainIdx
  ]);

  /** 暂停：中止网络请求或暂停逐字；继续：仅恢复逐字；空闲：等同「重降当前段」 */
  const pauseOrResumeGeneration = React.useCallback(() => {
    if (typingPaused && typingIdx !== null) {
      const full = typingFullTextRef.current;
      if (full.length > 0 && typingPosRef.current < full.length) {
        runTypingInterval();
        setTypingPaused(false);
        return;
      }
      setTypingPaused(false);
      return;
    }

    if (typingTimerRef.current) {
      window.clearInterval(typingTimerRef.current);
      typingTimerRef.current = null;
      setTypingPaused(true);
      /* 与「思考中止」一致：记录连段断点，便于前面段重跑完后仍回到此处继续 */
      if (taskMode === "reduce" && typingIdx !== null) {
        pausedReduceBatchParagraphIdxRef.current = typingIdx;
      }
      return;
    }

    if (abortProcessRef.current) {
      const activeIdx = typingIdx ?? awaitingParagraphIdx;
      if (taskMode === "reduce" && activeIdx !== null) {
        pausedReduceBatchParagraphIdxRef.current = activeIdx;
      }
      paragraphOnFullyDoneRef.current = null;
      suppressNextReduceChainEffectRef.current = false;
      abortProcessRef.current.abort();
      abortProcessRef.current = null;
      processingInFlightRef.current = false;
      setLoading(false);
      setTypingIdx(null);
      setAwaitingParagraphIdx(null);
      setTypingPaused(false);
      setNaturalFinishIdx(null);
      reduceAutoBatchActiveRef.current = false;
      message.info("已停止生成");
      return;
    }

    // 空闲：圆钮与「重降/重优化当前段」同效，便于中止后再次开始（自然完成后圆钮已禁用不会进此分支）
    if (taskId) {
      const sel = currentParagraphIdx;
      if (needsInterruptBeforeManualStart(sel)) {
        interruptOngoingForManualRun(sel);
      } else {
        reduceAutoBatchActiveRef.current = false;
        pausedReduceBatchParagraphIdxRef.current = null;
      }
      void startProcessCurrentParagraph(currentParagraphIdx);
    }
  }, [
    typingPaused,
    typingIdx,
    awaitingParagraphIdx,
    runTypingInterval,
    message,
    taskId,
    taskMode,
    startProcessCurrentParagraph,
    currentParagraphIdx,
    needsInterruptBeforeManualStart,
    interruptOngoingForManualRun
  ]);

  React.useEffect(() => {
    return () => {
      if (typingTimerRef.current) {
        window.clearInterval(typingTimerRef.current);
        typingTimerRef.current = null;
      }
    };
  }, []);

  // reduce 任务进入工作台后：自动先处理当前段（只执行一次）
  React.useEffect(() => {
    if (!taskId) return;
    if (taskMode !== "reduce") return;
    if (autoProcessedRef.current) return;
    if (!paragraphs || paragraphs.length === 0) return;

    const idx = currentParagraphIdx;
    autoProcessedRef.current = true;
    startProcessCurrentParagraph(idx);
  }, [taskId, taskMode, paragraphs, currentParagraphIdx, startProcessCurrentParagraph]);

  return (
    <Layout className="workbench-page-root">
      <Sider
        className="workbench-inner-sider"
        width={220}
        style={{
          background: "var(--bg-surface)",
          borderRight: "1px solid var(--border-subtle)",
          paddingTop: 16
        }}
      >
        <Space direction="vertical" style={{ width: "100%", padding: "0 16px" }}>
          <Typography.Text strong>段落列表</Typography.Text>
        </Space>
        <Menu
          mode="inline"
          className="workbench-paragraph-menu"
          selectedKeys={[String(currentParagraphIdx)]}
          items={paragraphs.map((p) => ({
            key: String(p.index),
            label: (
              <span className="workbench-menu-para-row">
                <span>第 {p.index} 段</span>
                {doneParagraphIdxs.includes(p.index) ? (
                  <CheckCircleFilled
                    className="workbench-menu-para-check"
                    aria-hidden
                  />
                ) : null}
              </span>
            )
          }))}
          onClick={(info) => {
            const next = Number(info.key);
            if (!Number.isFinite(next)) return;
            setCurrentParagraphIdx(next);
            /* 手动选段：关闭自动跟随，避免后续生成又与当前阅读位置打架 */
            setRealtimeFollowScroll(false);
            setFollowScrollAnchorIdx(null);
            try {
              window.localStorage.setItem(FOLLOW_SCROLL_STORAGE_KEY, "0");
            } catch {
              /* ignore */
            }
            /* 左侧列表：始终滚到对应段，不受「实时跟随」开关影响 */
            window.requestAnimationFrame(() => {
              window.requestAnimationFrame(() => {
                const el = document.getElementById(`workbench-paragraph-${next}`);
                el?.scrollIntoView({ behavior: "smooth", block: "start" });
              });
            });
          }}
        />
      </Sider>
      <Content className="workbench-inner-content">
        <div
          className="workbench-toolbar workbench-stagger-item"
          style={{ ["--wb-delay" as "--wb-delay"]: "40ms" } as React.CSSProperties}
        >
          <Space
            align="center"
            style={{
              justifyContent: "space-between",
              width: "100%"
            }}
          >
            <div style={{ minWidth: 0, flex: "1 1 auto" }}>
              <Typography.Text
                strong
                ellipsis={{ tooltip: taskHeadingText }}
                style={{ display: "block", maxWidth: "100%" }}
              >
                {taskHeadingText}
              </Typography.Text>
              <Typography.Paragraph
                type="secondary"
                style={{ margin: 0, fontSize: 12 }}
              >
                当前模型：示例；界面仅用于展示「按段落{isPolish ? "优化" : "降AIGC"}」的工作台布局。
              </Typography.Paragraph>
            </div>
            <Space align="center" size={10}>
              <GalaxyButton
                type="button"
                className={[
                  "workbench-galaxy-circle-btn",
                  realtimeFollowScroll
                    ? ""
                    : "workbench-galaxy-circle-btn--follow-off"
                ]
                  .filter(Boolean)
                  .join(" ")}
                aria-label={
                  realtimeFollowScroll
                    ? "已开启实时跟随当前段落"
                    : "已关闭实时跟随"
                }
                title={
                  realtimeFollowScroll
                    ? "实时跟随：开启（处理/逐字时自动滚到当前段；连段切换时也会滚）。点击左侧段落列表会自动关闭"
                    : "实时跟随：关闭（自动处理时不滚动；左侧段落列表点击仍会定位，并自动关闭本开关）"
                }
                onClick={() => {
                  setRealtimeFollowScroll((v) => {
                    const next = !v;
                    try {
                      window.localStorage.setItem(
                        FOLLOW_SCROLL_STORAGE_KEY,
                        next ? "1" : "0"
                      );
                    } catch {
                      /* ignore */
                    }
                    return next;
                  });
                }}
              >
                <span className="workbench-follow-icon-wrap" aria-hidden="true">
                  <AimOutlined />
                </span>
              </GalaxyButton>
              <GalaxyButton
                type="button"
                className={[
                  "workbench-galaxy-circle-btn",
                  !isGenerationRunning &&
                  !typingPaused &&
                  taskId &&
                  !circleIdleAfterNaturalComplete
                    ? "workbench-galaxy-circle-btn--idle"
                    : ""
                ]
                  .filter(Boolean)
                  .join(" ")}
                aria-label={circleTitle}
                title={circleTitle}
                disabled={circleDisabled}
                onClick={pauseOrResumeGeneration}
              >
                {circleIcon}
              </GalaxyButton>
              <GalaxyButton
                className="workbench-galaxy-btn workbench-galaxy-btn--pill"
                title={
                  taskMode === "reduce" && !realtimeFollowScroll
                    ? "若有被中止的自动连段：先完成当前选中段，再滚回中断处继续连段"
                    : undefined
                }
                onClick={() => {
                  if (!taskId) return;
                  const paused = pausedReduceBatchParagraphIdxRef.current;
                  const sel = currentParagraphIdx;
                  const shouldDeferResume =
                    taskMode === "reduce" &&
                    !realtimeFollowScroll &&
                    paused !== null &&
                    paused !== sel;

                  if (shouldDeferResume) {
                    if (needsInterruptBeforeManualStart(sel)) {
                      interruptOngoingForManualRun(sel);
                    }
                    void startProcessCurrentParagraph(sel, {
                      onFullyDone: () => {
                        const target = pausedReduceBatchParagraphIdxRef.current;
                        if (target === null || target !== paused) return;
                        pausedReduceBatchParagraphIdxRef.current = null;
                        reduceAutoBatchActiveRef.current = true;
                        setCurrentParagraphIdx(target);
                        window.requestAnimationFrame(() => {
                          window.requestAnimationFrame(() => {
                            document
                              .getElementById(`workbench-paragraph-${target}`)
                              ?.scrollIntoView({
                                behavior: "smooth",
                                block: "start"
                              });
                          });
                        });
                        void startProcessCurrentParagraph(target);
                      }
                    });
                    return;
                  }
                  /* 思考/逐字进行中：先打断再跑选中段，并记录断点以便跑完后回到该段继续 */
                  if (needsInterruptBeforeManualStart(sel)) {
                    interruptOngoingForManualRun(sel);
                    void startProcessCurrentParagraph(sel);
                    return;
                  }
                  /* 手动单段重跑：结束自动连段语义，避免完成后仍按断点/顺序接着跑 */
                  reduceAutoBatchActiveRef.current = false;
                  pausedReduceBatchParagraphIdxRef.current = null;
                  void startProcessCurrentParagraph(sel);
                }}
                type="button"
              >
                {isPolish ? "重优化当前段" : "重降AIGC当前段"}
              </GalaxyButton>
              <GalaxyButton
                className="workbench-galaxy-btn workbench-galaxy-btn--pill"
                onClick={() => {
                  if (!taskId) return;
                  setLoading(true);
                  apiRequest<{ taskId: string; fullText: string }>(
                    `/api/tasks/${taskId}/export`,
                    { method: "GET" }
                  )
                    .then((res) => {
                      const blob = new Blob([res.fullText], {
                        type: "text/plain;charset=utf-8"
                      });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      const rawName = taskHeadingText || `workbench-export-${taskId}`;
                      const safeName = sanitizeFilename(rawName) || `workbench-export-${taskId}`;
                      a.download = `${safeName}.txt`;
                      document.body.appendChild(a);
                      a.click();
                      a.remove();
                      URL.revokeObjectURL(url);
                      message.success("导出成功");
                    })
                    .catch(() => {
                      message.error("导出失败");
                    })
                    .finally(() => setLoading(false));
                }}
                type="button"
              >
                {isPolish ? "导出优化后全文" : "导出降AIGC后全文"}
              </GalaxyButton>
            </Space>
          </Space>
        </div>
        <div className="workbench-paragraph-scroll">
          <div className="workbench-paragraph-stack">
            {paragraphs.map((p) => (
              <div
                key={p.index}
                id={`workbench-paragraph-${p.index}`}
                className="workbench-paragraph-anchor workbench-stagger-item"
                style={
                  {
                    ["--wb-delay" as "--wb-delay"]: `${Math.min(620, 120 + (p.index - 1) * 70)}ms`
                  } as React.CSSProperties
                }
              >
                <ParagraphCompareCard
                  {...p}
                  mode={taskMode}
                  isAwaitingApi={awaitingParagraphIdx === p.index}
                />
              </div>
            ))}
          </div>
        </div>
      </Content>
    </Layout>
  );
};

export default PolishWorkbenchPage;

