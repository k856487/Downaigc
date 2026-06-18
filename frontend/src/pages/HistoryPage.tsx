import React from "react";
import { Card, Space, Typography } from "antd";
import { useNavigate } from "react-router-dom";
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

const HistoryPage: React.FC = () => {
  const navigate = useNavigate();
  const [tasks, setTasks] = React.useState<
    Array<{
      id: string;
      name: string;
      type: "polish" | "reduce";
      paragraphs: number;
      status: "pending" | "running" | "done";
      createdAt: string;
    }>
  >([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiRequest<ApiTaskDetail[]>("/api/tasks", { method: "GET" })
      .then((res) => {
        if (cancelled) return;
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
        if (!cancelled) setTasks([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <div className="console-stagger-item console-stagger-item--1">
        <Card>
          <Typography.Text type="secondary">
            以下为当前账号下的全部任务；点击「查看」进入对应段落工作台（润色 / 降 AIGC 与「论文优化」入口一致）。
          </Typography.Text>
        </Card>
      </div>
      <div className="console-stagger-item console-stagger-item--2">
        <Card
          title="历史任务"
          styles={{
            body: {
              maxHeight: "min(260px, calc((100vh - 280px) / 2))",
              overflow: "auto",
              paddingTop: 12
            }
          }}
        >
          <TaskTable
            loading={loading}
            data={tasks}
            onView={(id) => {
              navigate(`/console/polish/${id}`);
            }}
          />
        </Card>
      </div>
    </Space>
  );
};

export default HistoryPage;
