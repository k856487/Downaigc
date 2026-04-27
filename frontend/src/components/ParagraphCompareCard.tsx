import React from "react";
import { Card, Col, Row, Space, Typography } from "antd";

export interface ParagraphCompareCardProps {
  index: number;
  wordCount: number;
  originalWordCount: number;
  original: string;
  polished: string;
  mode: "polish" | "reduce";
  /** 后端请求进行中（思考中），右侧尚无最终正文，不逐字；仅接口返回最终正文后再由右侧逐字播放 */
  isAwaitingApi?: boolean;
}

const ParagraphCompareCard: React.FC<ParagraphCompareCardProps> = ({
  index,
  wordCount,
  originalWordCount,
  mode,
  original,
  polished,
  isAwaitingApi
}) => {
  const polishedLabel = mode === "polish" ? "优化后" : "降AIGC后";

  return (
    <div className="paragraph-compare-wrap">
      <div className="paragraph-compare-title">第 {index} 段</div>
      <div className="paragraph-compare-outer-card" style={{ padding: 12 }}>
        {isAwaitingApi ? (
          <div className="paragraph-compare-typing-indicator">思考中...</div>
        ) : null}
        <Space direction="vertical" style={{ width: "100%" }} size={12}>
          <Row gutter={16}>
            <Col span={12}>
              <Card
                size="small"
                className="paragraph-compare-inner-card"
                styles={{ body: { padding: 12 } }}
              >
                <Typography.Text strong style={{ fontSize: 12 }}>
                  原文
                </Typography.Text>
                <div className="paragraph-compare-inner-wordcount">
                  {originalWordCount} 字
                </div>
                <Typography.Paragraph
                  style={{
                    marginTop: 8,
                    marginBottom: 0,
                    fontSize: 13,
                    whiteSpace: "pre-wrap", // 保留段落换行，逐字输出时也不折叠
                    wordBreak: "break-word"
                  }}
                >
                  {original}
                </Typography.Paragraph>
              </Card>
            </Col>
            <Col span={12}>
              <Card
                size="small"
                className="paragraph-compare-inner-card"
                styles={{ body: { padding: 12 } }}
              >
                <Typography.Text strong style={{ fontSize: 12 }}>
                  {polishedLabel}
                </Typography.Text>
                <div className="paragraph-compare-inner-wordcount">
                  {wordCount} 字
                </div>
                <Typography.Paragraph
                  style={{
                    marginTop: 8,
                    marginBottom: 0,
                    fontSize: 13,
                    whiteSpace: "pre-wrap", // 保留段落换行
                    wordBreak: "break-word"
                  }}
                >
                  {polished}
                </Typography.Paragraph>
              </Card>
            </Col>
          </Row>
        </Space>
      </div>
    </div>
  );
};

export default ParagraphCompareCard;

