import React from "react";
import { Col, Row, Card, Slider, Switch, Typography, Space } from "antd";
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

const PolishConsolePage: React.FC = () => {
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

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <div className="console-stagger-item console-stagger-item--1">
        <Row gutter={16}>
          <Col span={16}>
            <UploadCard />
          </Col>
          <Col span={8}>
            <Card title="论文优化参数">
              <Space direction="vertical" style={{ width: "100%" }} size={16}>
                <div>
                  <Typography.Text strong>优化强度</Typography.Text>
                  <Slider defaultValue={60} />
                </div>
                <Space>
                  <Typography.Text>启用原创性增强（第二阶段）</Typography.Text>
                  <Switch defaultChecked />
                </Space>
                <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
                  模型由服务端提供，这里仅展示参数控制示意。
                </Typography.Paragraph>
              </Space>
            </Card>
          </Col>
        </Row>
      </div>

      <div className="console-stagger-item console-stagger-item--2">
        <Card title="任务列表">
          <TaskTable
            data={tasks}
            onView={(id) => {
              // workbench 会从后端加载 mode，不需要额外 query
              window.location.assign(`/console/polish/${id}`);
            }}
          />
        </Card>
      </div>
    </Space>
  );
};

export default PolishConsolePage;

