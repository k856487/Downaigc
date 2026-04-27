import React from "react";
import { App, Card, Select, Space, Table, Tag, Typography } from "antd";
import { apiRequest } from "../../api/client";

type FeedbackItem = {
  id: string;
  userId: string;
  userEmail: string;
  category: "bug" | "feature" | "experience" | "other";
  content: string;
  contact?: string | null;
  status: "open" | "processing" | "closed";
  createdAt: string;
  updatedAt: string;
};

const statusColor = {
  open: "warning",
  processing: "processing",
  closed: "success"
} as const;

const statusText = {
  open: "待处理",
  processing: "处理中",
  closed: "已关闭"
} as const;

const categoryText = {
  bug: "问题",
  feature: "需求",
  experience: "体验",
  other: "其他"
} as const;

const AdminFeedbackPage: React.FC = () => {
  const { message } = App.useApp();
  const [rows, setRows] = React.useState<FeedbackItem[]>([]);
  const [loading, setLoading] = React.useState(false);

  const loadRows = React.useCallback(() => {
    setLoading(true);
    apiRequest<FeedbackItem[]>("/api/admin/feedback", { method: "GET" })
      .then(setRows)
      .catch(() => message.error("加载反馈列表失败"))
      .finally(() => setLoading(false));
  }, [message]);

  React.useEffect(() => {
    loadRows();
  }, [loadRows]);

  const updateStatus = React.useCallback(
    async (id: string, status: FeedbackItem["status"]) => {
      await apiRequest<FeedbackItem>(`/api/admin/feedback/${id}`, {
        method: "PATCH",
        json: { status }
      });
      message.success("状态已更新");
      loadRows();
    },
    [loadRows, message]
  );

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <div className="console-stagger-item console-stagger-item--1">
        <Typography.Title level={4} style={{ margin: 0 }}>
          用户反馈管理
        </Typography.Title>
      </div>

      <div className="console-stagger-item console-stagger-item--2">
        <Card>
          <Table
            rowKey="id"
            loading={loading}
            dataSource={rows}
            pagination={{ pageSize: 10 }}
            scroll={{ x: 980 }}
            columns={[
              {
                title: "用户邮箱",
                dataIndex: "userEmail",
                width: 220
              },
              {
                title: "分类",
                dataIndex: "category",
                width: 90,
                render: (v: FeedbackItem["category"]) => categoryText[v] || v
              },
              {
                title: "反馈内容",
                dataIndex: "content",
                render: (v: string) => (
                  <Typography.Paragraph ellipsis={{ rows: 2, expandable: true }} style={{ marginBottom: 0 }}>
                    {v}
                  </Typography.Paragraph>
                )
              },
              {
                title: "联系方式",
                dataIndex: "contact",
                width: 140,
                render: (v: string | null | undefined) => v || "-"
              },
              {
                title: "提交时间",
                dataIndex: "createdAt",
                width: 170,
                render: (v: string) => new Date(v).toLocaleString()
              },
              {
                title: "状态",
                dataIndex: "status",
                width: 140,
                render: (v: FeedbackItem["status"], row: FeedbackItem) => (
                  <Select
                    size="small"
                    value={v}
                    style={{ width: 120 }}
                    onChange={(next) => {
                      if (next !== row.status) {
                        updateStatus(row.id, next);
                      }
                    }}
                    options={[
                      { value: "open", label: "待处理" },
                      { value: "processing", label: "处理中" },
                      { value: "closed", label: "已关闭" }
                    ]}
                  />
                )
              },
              {
                title: "当前状态",
                width: 110,
                render: (_: unknown, row: FeedbackItem) => (
                  <Tag color={statusColor[row.status]}>{statusText[row.status]}</Tag>
                )
              }
            ]}
          />
        </Card>
      </div>
    </Space>
  );
};

export default AdminFeedbackPage;

