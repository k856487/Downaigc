import React from "react";

export interface ParagraphCompareCardProps {
  index: number;
  wordCount: number;
  originalWordCount: number;
  original: string;
  polished: string;
  mode: "polish" | "reduce";
  isAwaitingApi?: boolean;
  isTypingReveal?: boolean;
  /** 逐字动画期间由父组件直写 DOM，绕过 React reconcile */
  resultBodyRef?: React.Ref<HTMLDivElement>;
  wordCountElRef?: React.Ref<HTMLSpanElement>;
}

const ParagraphCompareCard: React.FC<ParagraphCompareCardProps> = ({
  index,
  wordCount,
  originalWordCount,
  mode,
  original,
  polished,
  isAwaitingApi,
  isTypingReveal,
  resultBodyRef,
  wordCountElRef
}) => {
  const polishedLabel = mode === "polish" ? "优化后" : "降AIGC后";
  const domDrivenResult = isTypingReveal && resultBodyRef != null;

  return (
    <div
      className={[
        "paragraph-compare-wrap",
        isTypingReveal ? "paragraph-compare-wrap--typing" : ""
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="paragraph-compare-title">第 {index} 段</div>
      <div className="paragraph-compare-outer-card">
        {isAwaitingApi ? (
          <div className="paragraph-compare-typing-indicator" aria-live="polite">
            思考中
            <span className="paragraph-compare-typing-dots" aria-hidden="true">
              <span>.</span>
              <span>.</span>
              <span>.</span>
            </span>
          </div>
        ) : null}
        <div className="paragraph-compare-grid">
          <div className="paragraph-compare-inner-card">
            <div className="paragraph-compare-inner-label">原文</div>
            <div className="paragraph-compare-inner-wordcount">
              {originalWordCount} 字
            </div>
            <div className="paragraph-compare-body">{original}</div>
          </div>
          <div className="paragraph-compare-inner-card">
            <div className="paragraph-compare-inner-label">{polishedLabel}</div>
            <div className="paragraph-compare-inner-wordcount">
              {domDrivenResult && wordCountElRef ? (
                <span ref={wordCountElRef}>0 字</span>
              ) : (
                `${wordCount} 字`
              )}
            </div>
            <div
              ref={domDrivenResult ? resultBodyRef : undefined}
              className="paragraph-compare-body paragraph-compare-body--result"
            >
              {domDrivenResult ? null : polished}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default React.memo(ParagraphCompareCard);
