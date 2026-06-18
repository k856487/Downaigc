import React from "react";
import {
  Card,
  Upload,
  Typography,
  Space,
  Switch,
  Select,
  Radio,
  Input
} from "antd";
import { InboxOutlined, FileTextOutlined } from "@ant-design/icons";
import type { UploadProps } from "antd";
import GooeySplitButton from "./GooeySplitButton";
import { useReward } from "../state/RewardContext";
import { useUploadDraft } from "../state/UploadDraftContext";
import { countBillingChars, countThesisWords } from "../utils/textStats";
import { resolveTaskCharge } from "../utils/taskBilling";

const { Dragger } = Upload;
const { TextArea } = Input;

/** 预览区展示的最大字符数（超出则截断并提示全文字数） */
const FILE_PREVIEW_CHAR_LIMIT = 8000;

type OutlineItem = {
  title: string;
  level: number;
  line: number;
  kind: "heading" | "section";
};

const UploadCard: React.FC = () => {
  const { state: rewardState } = useReward();
  const imeComposingRef = React.useRef(false);
  const {
    inputMode,
    pastedText,
    preview,
    setInputMode,
    setPastedText,
    setPreview,
    clearDraft
  } = useUploadDraft();

  const rawForPoints = inputMode === "text" ? pastedText : (preview?.rawText ?? "");
  const estimatedPointCost = React.useMemo(
    () => countBillingChars(rawForPoints.trim()),
    [rawForPoints]
  );
  const taskCharge = React.useMemo(
    () => resolveTaskCharge(estimatedPointCost, rewardState.writableWords),
    [estimatedPointCost, rewardState.writableWords]
  );

  const outlineFromText = React.useCallback((text: string): OutlineItem[] => {
    const lines = text.split(/\r?\n/);
    const result: OutlineItem[] = [];
    const seen = new Set<string>();

    const pushUnique = (item: OutlineItem) => {
      const key = `${item.kind}|${item.title}|${item.line}`;
      if (seen.has(key)) return;
      seen.add(key);
      result.push(item);
    };

    for (let idx = 0; idx < lines.length; idx++) {
      const raw = lines[idx];
      const line = raw.trim();
      if (!line) continue;

      const mMd = line.match(/^(#{1,6})\s+(.+)$/);
      if (mMd) {
        pushUnique({
          kind: "heading",
          title: mMd[2].trim(),
          level: Math.min(4, mMd[1].length),
          line: idx + 1
        });
        continue;
      }

      const mNum = line.match(/^(\d+(?:\.\d+){0,4})[\s、.．)\]]+(.+)$/);
      if (mNum) {
        const level = Math.min(4, mNum[1].split(".").length);
        pushUnique({
          kind: "heading",
          title: `${mNum[1]} ${mNum[2].trim()}`,
          level,
          line: idx + 1
        });
        continue;
      }

      const mCnChapter = line.match(/^第([一二三四五六七八九十百千0-9]+)[章节篇部分卷节]\s*(.+)?$/);
      if (mCnChapter) {
        pushUnique({
          kind: "heading",
          title: line,
          level: 1,
          line: idx + 1
        });
        continue;
      }

      const mCnSub = line.match(/^[（(]([一二三四五六七八九十0-9]+)[)）]\s*(.+)$/);
      if (mCnSub) {
        pushUnique({
          kind: "heading",
          title: line,
          level: 2,
          line: idx + 1
        });
        continue;
      }

      const mCnSub2 = line.match(/^[一二三四五六七八九十]+[、.．]\s*(.+)$/);
      if (mCnSub2) {
        pushUnique({
          kind: "heading",
          title: line,
          level: 2,
          line: idx + 1
        });
        continue;
      }
    }

    const sectionDefs: Array<{ label: string; regex: RegExp }> = [
      { label: "摘要", regex: /^摘\s*要[:：]?$/i },
      { label: "关键词", regex: /^关\s*键\s*词[:：]?$/i },
      { label: "Abstract", regex: /^abstract[:：]?$/i },
      { label: "Keywords", regex: /^keywords?[:：]?$/i },
      { label: "引言/绪论", regex: /^(引言|绪论|前言)[:：]?$/i },
      { label: "结论", regex: /^(结论|总结|结语)[:：]?$/i },
      { label: "致谢", regex: /^致谢[:：]?$/i },
      { label: "参考文献", regex: /^(参考文献|references|bibliography)[:：]?$/i }
    ];

    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx].trim();
      if (!line) continue;
      for (const section of sectionDefs) {
        if (section.regex.test(line)) {
          pushUnique({
            kind: "section",
            title: section.label,
            level: 1,
            line: idx + 1
          });
          break;
        }
      }
    }

    result.sort((a, b) => a.line - b.line || a.level - b.level);
    return result.slice(0, 80);
  }, []);

  const textOutline = React.useMemo(() => outlineFromText(pastedText), [outlineFromText, pastedText]);

  const handleClearContent = React.useCallback(() => {
    clearDraft();
  }, [clearDraft]);

  const beforeUpload: UploadProps["beforeUpload"] = (file) => {
    const name = file.name || "未命名";
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    const textLike =
      /^(txt|md|markdown|json|csv)$/i.test(ext) ||
      file.type.startsWith("text/") ||
      file.type === "application/json";

    if (!textLike) {
      setPastedText("");
      setPreview({
        name,
        text: "",
        rawText: "",
        wordCount: 0,
        error:
          "当前示例仅支持预览 .txt / .md 等纯文本。PDF / Word 需服务端解析后再接入预览。"
      });
      return Upload.LIST_IGNORE;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      setPastedText("");
      const raw = String(e.target?.result ?? "");
      const wordCount = countThesisWords(raw);
      setPreview({
        name,
        text: raw,
        rawText: raw,
        wordCount
      });
    };
    reader.onerror = () => {
      setPastedText("");
      setPreview({
        name,
        text: "",
        rawText: "",
        wordCount: 0,
        error: "文件读取失败，请重试或换用 UTF-8 编码的文本文件。"
      });
    };
    reader.readAsText(file, "UTF-8");
    return Upload.LIST_IGNORE;
  };

  return (
    <Card
      title="上传论文文件"
      extra={
        <Space size={8} wrap align="center" className="upload-card-points-extra">
          <Typography.Text type="secondary">预估消耗</Typography.Text>
          <Typography.Text strong>
            {taskCharge.wordsDue.toLocaleString("zh-CN")}
          </Typography.Text>
          <Typography.Text type="secondary">字（按输出扣费）</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            剩余可改 {rewardState.writableWords.toLocaleString("zh-CN")} 字
          </Typography.Text>
          {!taskCharge.ok ? (
            <Typography.Text type="danger" style={{ fontSize: 12 }}>
              可改写字数不足
            </Typography.Text>
          ) : null}
        </Space>
      }
      styles={{ body: { overflow: "visible" } }}
    >
      <Space direction="vertical" style={{ width: "100%" }} size={20}>
        <div className="upload-card-input-band">
          <Radio.Group
            className="upload-card-mode-radio"
            value={inputMode}
            onChange={(e) => setInputMode(e.target.value as "file" | "text")}
            optionType="button"
            buttonStyle="solid"
          >
            <Radio.Button value="file">上传文件</Radio.Button>
            <Radio.Button value="text">粘贴文本</Radio.Button>
          </Radio.Group>
        </div>
        <Typography.Text type="secondary">
          支持 PDF / Word / Markdown，系统会自动按段落拆分并统计字数（当前为前端示例，不会真实上传）。
        </Typography.Text>
        {inputMode === "file" ? (
          <Dragger
            multiple={false}
            showUploadList={false}
            beforeUpload={beforeUpload}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">点击或拖拽文件到此区域上传</p>
            <p className="ant-upload-hint">文件不会离开本地，仅用于界面预览示意。</p>
          </Dragger>
        ) : (
          <TextArea
            className="upload-paste-textarea"
            value={pastedText}
            onCompositionStart={() => {
              imeComposingRef.current = true;
            }}
            onCompositionEnd={(e) => {
              imeComposingRef.current = false;
              setPastedText(e.currentTarget.value);
              setPreview(null);
            }}
            onChange={(e) => {
              if (imeComposingRef.current) return;
              setPastedText(e.target.value);
              setPreview(null);
            }}
            placeholder="在此直接粘贴论文文本，系统将提取标题并展示目录结构。"
            rows={7}
            style={{ marginBottom: 4 }}
          />
        )}
      </Space>

      <div className="upload-card-toolbar-wrap">
        <div className="upload-card-tool-preview-row">
          <div className="upload-card-tool-preview-row__controls">
            <div className="upload-card-controls">
              <div className="upload-card-controls__options">
                <Space size={8} align="center">
                  <Typography.Text>自动分段预览</Typography.Text>
                  <Switch defaultChecked />
                </Space>
                <Space size={8} align="center">
                  <Typography.Text>论文语言</Typography.Text>
                  <Select
                    defaultValue="zh"
                    options={[
                      { label: "中文", value: "zh" },
                      { label: "英文", value: "en" }
                    ]}
                    style={{ width: 100 }}
                  />
                </Space>
              </div>
              <div className="upload-card-controls__actions">
                <div className="upload-gooey-toolbar-row">
                  <button
                    type="button"
                    className="upload-gooey-btn upload-gooey-main upload-gooey-main--inline"
                    title="清空当前已上传文件与粘贴文本"
                    aria-label="清空当前已上传文件与粘贴文本"
                    onClick={handleClearContent}
                  >
                    清空内容
                  </button>
                  <GooeySplitButton rawText={inputMode === "text" ? pastedText : preview?.rawText} />
                </div>
              </div>
              <Typography.Paragraph
                type="secondary"
                className="upload-card-controls__hint"
              >
                准备好内容后点击「开始」选择润色、降 AI 等步骤；「清空内容」始终可点，会同时清空文件预览与粘贴文本。
              </Typography.Paragraph>
            </div>
          </div>
          <div className="upload-card-tool-preview-row__preview">
            <div className="upload-preview-box">
              <div className="upload-preview-box__header-row">
                <div className="upload-preview-box__head">
                  <FileTextOutlined className="upload-preview-box__icon" />
                  <Typography.Text strong>
                    {inputMode === "text" ? "目录预览" : "内容预览"}
                  </Typography.Text>
                </div>
                <div className="upload-preview-box__header-aside">
                  {inputMode === "text" ? (
                    <Typography.Text type="secondary" className="upload-preview-box__header-meta-text">
                      约 {countThesisWords(pastedText).toLocaleString()} 字
                    </Typography.Text>
                  ) : preview ? (
                    <div className="upload-preview-box__meta">
                      <Typography.Text ellipsis title={preview.name}>
                        {preview.name}
                      </Typography.Text>
                      <Typography.Text type="secondary">
                        {preview.error ? "—" : `约 ${preview.wordCount.toLocaleString()} 字`}
                      </Typography.Text>
                    </div>
                  ) : null}
                </div>
              </div>
              {inputMode === "file" ? (
                <>
                  {!preview && (
                    <Typography.Text type="secondary" className="upload-preview-box__placeholder">
                      上传文本类文件后，将在此显示摘要与字数统计。
                    </Typography.Text>
                  )}
                  {preview && (
                    <>
                      {preview.error ? (
                        <Typography.Text type="danger" className="upload-preview-box__error">
                          {preview.error}
                        </Typography.Text>
                      ) : (
                        <pre
                          className="upload-preview-box__body"
                          tabIndex={0}
                          aria-label="文件正文预览"
                        >
                          {preview.text.length > FILE_PREVIEW_CHAR_LIMIT
                            ? preview.text.slice(0, FILE_PREVIEW_CHAR_LIMIT)
                            : preview.text}
                        </pre>
                      )}
                    </>
                  )}
                </>
              ) : (
                <>
                  {textOutline.length === 0 ? (
                    <Typography.Text type="secondary" className="upload-preview-box__placeholder">
                      暂未识别到标题，请使用如“# 标题”“1. 标题”或“第一章 ...”等格式。
                    </Typography.Text>
                  ) : (
                    <ol className="upload-outline-list">
                      {textOutline.map((item, idx) => (
                        <li
                          key={`${item.title}-${item.line}-${idx}`}
                          title={item.title}
                          style={{ paddingLeft: `${Math.max(0, item.level - 1) * 14}px` }}
                        >
                          <span className={`upload-outline-badge upload-outline-badge--${item.kind}`}>
                            {item.kind === "section" ? "区块" : `L${item.level}`}
                          </span>
                          <span className="upload-outline-title">{item.title}</span>
                          <span className="upload-outline-line">第 {item.line} 行</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
};

export default UploadCard;
