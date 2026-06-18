import React from "react";
import { App } from "antd";
import { apiUploadFeedbackImage } from "../api/client";
import { FEEDBACK_IMAGE_MAX_WIDTH_PCT, normalizeToEditorHtml, resolveFeedbackAssetUrl } from "../utils/feedbackHtml";

type Props = {
  /** 与 Form.Item 对接：首次挂载时作为初始 HTML */
  value?: string;
  onChange?: (html: string) => void;
  uploadPath: string;
  disabled?: boolean;
  placeholder?: string;
  minHeight?: number;
};

function isVisuallyEmpty(el: HTMLElement): boolean {
  return !el.textContent?.trim() && !el.querySelector("img");
}

function insertNodeAtCaret(root: HTMLElement, node: Node) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !root.contains(sel.anchorNode)) {
    root.appendChild(node);
    return;
  }
  const range = sel.getRangeAt(0);
  range.deleteContents();
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

/**
 * 所见即所得：截图粘贴后以 <img> 显示在编辑区内（存储为 HTML，不再使用 Markdown 链接）。
 */
export const FeedbackRichEditor: React.FC<Props> = (props) => {
  const { value, onChange, uploadPath, disabled, placeholder, minHeight = 220 } = props;
  const { message } = App.useApp();
  const ref = React.useRef<HTMLDivElement>(null);
  const composingRef = React.useRef(false);
  const initHtmlRef = React.useRef<string | null>(null);
  if (initHtmlRef.current === null) {
    initHtmlRef.current = normalizeToEditorHtml(value ?? "");
  }
  const [showPh, setShowPh] = React.useState(false);
  const [focused, setFocused] = React.useState(false);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = initHtmlRef.current || "";
    setShowPh(isVisuallyEmpty(el));
  }, []);

  const emit = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setShowPh(isVisuallyEmpty(el));
    onChange?.(el.innerHTML);
  }, [onChange]);

  const onPaste = React.useCallback(
    async (e: React.ClipboardEvent<HTMLDivElement>) => {
      const items = e.clipboardData?.items;
      if (!items?.length) return;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.kind === "file" && it.type.startsWith("image/")) {
          e.preventDefault();
          const file = it.getAsFile();
          if (!file || disabled) return;
          const root = ref.current;
          if (!root) return;
          try {
            message.loading({ content: "正在上传截图…", key: "fb-up", duration: 0 });
            const { url } = await apiUploadFeedbackImage(uploadPath, file);
            message.destroy("fb-up");
            const src = resolveFeedbackAssetUrl(url);
            const img = document.createElement("img");
            img.src = src;
            img.alt = "";
            img.style.maxWidth = FEEDBACK_IMAGE_MAX_WIDTH_PCT;
            img.style.height = "auto";
            img.style.display = "block";
            img.style.margin = "8px 0";
            img.style.borderRadius = "6px";
            insertNodeAtCaret(root, img);
            const br = document.createElement("br");
            insertNodeAtCaret(root, br);
            emit();
            message.success("图片已插入");
          } catch (err) {
            message.destroy("fb-up");
            const d =
              typeof err === "object" && err && "detail" in err ? String((err as { detail?: string }).detail) : "";
            message.error(d || "图片上传失败");
          }
          return;
        }
      }
    },
    [disabled, emit, message, uploadPath]
  );

  return (
    <div className="feedback-rich-editor-shell">
      {placeholder && showPh && !focused ? (
        <div className="feedback-rich-editor-ph" aria-hidden>
          {placeholder}
        </div>
      ) : null}
      <div
        ref={ref}
        className="feedback-rich-editor"
        contentEditable={!disabled}
        suppressContentEditableWarning
        style={{ minHeight }}
        onInput={() => {
          if (!composingRef.current) emit();
        }}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          emit();
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          emit();
        }}
        onPaste={onPaste}
      />
    </div>
  );
};
