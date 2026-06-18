import React from "react";
import { Typography } from "antd";
import {
  FEEDBACK_IMAGE_MAX_WIDTH_PCT,
  feedbackContentLooksLikeHtml,
  isSafeFeedbackImageUrl,
  resolveFeedbackAssetUrl,
  sanitizeFeedbackDisplayHtml
} from "./feedbackHtml";

const MD_IMG = /!\[([^\]]*)\]\(([^)]+)\)/g;

export { isSafeFeedbackImageUrl, resolveFeedbackAssetUrl } from "./feedbackHtml";

export function FeedbackContentView(props: { text: string; emptyFallback?: string }) {
  const { text, emptyFallback = "—" } = props;
  if (!text.trim()) {
    return <Typography.Text type="secondary">{emptyFallback}</Typography.Text>;
  }

  if (feedbackContentLooksLikeHtml(text)) {
    const safe = sanitizeFeedbackDisplayHtml(text);
    if (!safe.trim()) {
      return <Typography.Text type="secondary">{emptyFallback}</Typography.Text>;
    }
    return (
      <div
        className="feedback-content-view feedback-content-view--html"
        dangerouslySetInnerHTML={{ __html: safe }}
      />
    );
  }

  const nodes: React.ReactNode[] = [];
  let last = 0;
  const re = new RegExp(MD_IMG.source, "g");
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      nodes.push(
        <span key={key++} style={{ whiteSpace: "pre-wrap" }}>
          {text.slice(last, m.index)}
        </span>
      );
    }
    const href = m[2].trim();
    if (isSafeFeedbackImageUrl(href)) {
      const src = resolveFeedbackAssetUrl(href);
      nodes.push(
        <img
          key={key++}
          src={src}
          alt={m[1] || "image"}
          style={{
            maxWidth: FEEDBACK_IMAGE_MAX_WIDTH_PCT,
            height: "auto",
            display: "block",
            margin: "8px 0",
            borderRadius: 6
          }}
        />
      );
    } else {
      nodes.push(
        <Typography.Text key={key++} type="warning">
          [无效图片]
        </Typography.Text>
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    nodes.push(
      <span key={key++} style={{ whiteSpace: "pre-wrap" }}>
        {text.slice(last)}
      </span>
    );
  }
  return <div className="feedback-content-view">{nodes}</div>;
}
