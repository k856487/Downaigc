import React from "react";
import { Col, Row, Card, Slider, Typography, Space } from "antd";
import UploadCard from "../components/UploadCard";
import TaskTable from "../components/TaskTable";
import { apiRequest } from "../api/client";

type ApiTaskDetail = {
  id: string;
  mode: "polish" | "reduce";
  status: "pending" | "running" | "done";
  createdAt: string;
  title: string;
  paragraphs: Array<{ index: number; original: string; polished: string; wordCount: number }>;
};

/** 参数卡片内滑条仅作界面示意；与后端 POLISH_* / REDUCE_* 阈值无自动联动 */
function wordDeltaMaxChars(v: number): number {
  return Math.round(8 + (v / 100) * 120);
}

const PolishConsolePage: React.FC = () => {
  const [wordSlider, setWordSlider] = React.useState(60);
  /** 相似度示意：仅 90%～100% 整数档 */
  const [similarityPct, setSimilarityPct] = React.useState(96);
  const [tasks, setTasks] = React.useState<
    Array<{
      id: string;
      name: string;
      type: "polish" | "reduce";
      paragraphs: number;
      status: "pending" | "running" | "done";
      createdAt: string;
    }> | undefined
  >(undefined);

  React.useEffect(() => {
    apiRequest<ApiTaskDetail[]>("/api/tasks", { method: "GET" })
      .then((res) => {
        setTasks(
          res.map((t) => ({
            id: t.id,
            name: t.title?.trim() || "未命名文稿",
            type: t.mode,
            paragraphs: t.paragraphs?.length ?? 0,
            status: t.status,
            createdAt: t.createdAt
          }))
        );
      })
      .catch(() => {
        // 401 会由 apiRequest 处理重定向
      });
  }, []);

  /** 任务表区域：大屏用原公式；窄屏用 dvh 上限，避免与双列/顶栏抢高 */
  const taskListBodyStyle = React.useMemo(
    () => ({
      maxHeight: "min(calc(260px * 8 / 7), calc((100dvh - 280px) * 4 / 7))",
      overflowY: "auto" as const,
      overflowX: "hidden" as const,
      paddingTop: 12
    }),
    []
  );

  return (
    <div className="polish-console-page-stack">
      <div className="console-stagger-item console-stagger-item--1">
        <Row className="polish-console-upload-split" gutter={[16, 16]} align="top">
          <Col xs={24} sm={24} md={24} lg={16} xl={16}>
            <UploadCard />
          </Col>
          <Col xs={24} sm={24} md={24} lg={8} xl={8}>
            <Card title="参数设置">
              <Space direction="vertical" style={{ width: "100%" }} size={14}>
                <div style={{ width: "100%" }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                      gap: 8,
                      marginBottom: 6
                    }}
                  >
                    <Typography.Text strong>改写前后字数差</Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 13, whiteSpace: "nowrap" }}>
                      {wordDeltaMaxChars(wordSlider)}字
                    </Typography.Text>
                  </div>
                  <Slider
                    value={wordSlider}
                    onChange={setWordSlider}
                    tooltip={{ open: false }}
                  />
                  <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0, marginTop: 8 }}>
                    后端按词数对比原文与输出；限制越严越容易重试，单段耗时通常越长。
                  </Typography.Paragraph>
                </div>

                <div style={{ width: "100%" }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                      gap: 8,
                      marginBottom: 6
                    }}
                  >
                    <Typography.Text strong>改写前后相似度</Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 13, whiteSpace: "nowrap" }}>
                      {similarityPct}%
                    </Typography.Text>
                  </div>
                  <Slider
                    min={90}
                    max={100}
                    step={1}
                    value={similarityPct}
                    onChange={setSimilarityPct}
                    tooltip={{ open: false }}
                  />
                  <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0, marginTop: 8 }}>
                    示意目标相似度（90%～100%）；均通过才落库。每段最多约 3 次生成，具体见服务端环境变量。
                  </Typography.Paragraph>
                </div>
              </Space>
            </Card>
          </Col>
        </Row>
      </div>

      <div className="console-stagger-item console-stagger-item--2">
        <Card title="任务列表" className="polish-console-task-scroll-card" styles={{ body: taskListBodyStyle }}>
          <TaskTable
            data={tasks}
            onView={(id) => {
              window.location.assign(`/console/polish/${id}`);
            }}
          />
        </Card>
      </div>
    </div>
  );
};

export default PolishConsolePage;
