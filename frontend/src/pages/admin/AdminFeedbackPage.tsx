import React from "react";
import { App, Button, Card, Input, Select, Space, Table, Tag, Typography } from "antd";
import { ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { Link } from "react-router-dom";
import { apiRequest } from "../../api/client";
import { FeedbackContentView } from "../../utils/feedbackContent";

type FeedbackItem = {
  id: string;
  userId: string;
  userEmail: string;
  category: "bug" | "feature" | "experience" | "other" | "membership";
  content: string;
  adminReply?: string | null;
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
  membership: "咨询开通",
  other: "其他"
} as const;

const AdminFeedbackPage: React.FC = () => {
  const { message } = App.useApp();
  const [rows, setRows] = React.useState<FeedbackItem[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [statusFilter, setStatusFilter] = React.useState<string>("all");
  const [categoryFilter, setCategoryFilter] = React.useState<string>("all");
  const [keyword, setKeyword] = React.useState("");

  const loadRows = React.useCallback(() => {
    setLoading(true);
    apiRequest<FeedbackItem[]>("/api/admin/feedback", { method: "GET" })
      .then(setRows)
      .catch((e: { detail?: string }) =>
        message.error(e?.detail === "Admin access denied" ? "无管理员权限" : "加载反馈列表失败")
      )
      .finally(() => setLoading(false));
  }, [message]);

  React.useEffect(() => {
    loadRows();
  }, [loadRows]);

  const filteredRows = React.useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (categoryFilter !== "all" && r.category !== categoryFilter) return false;
      if (!kw) return true;
      return (
        r.userEmail.toLowerCase().includes(kw) ||
        r.content.toLowerCase().includes(kw) ||
        (r.contact || "").toLowerCase().includes(kw)
      );
    });
  }, [rows, statusFilter, categoryFilter, keyword]);

  const openCount = React.useMemo(() => rows.filter((r) => r.status === "open").length, [rows]);

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <div className="console-stagger-item console-stagger-item--1">
        <Space direction="vertical" size={4} style={{ width: "100%" }}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            用户反馈管理
          </Typography.Title>
          <Typography.Text type="secondary">
            数据来自数据库；待处理 <Tag color="warning">{openCount}</Tag> 条。筛选为前端过滤，刷新可拉取最新列表。
          </Typography.Text>
        </Space>
      </div>

      <div className="console-stagger-item console-stagger-item--2">
        <Card>
          <Space wrap style={{ marginBottom: 16 }} size={[12, 12]}>
            <Select
              allowClear
              placeholder="全部状态"
              style={{ width: 140 }}
              value={statusFilter === "all" ? null : statusFilter}
              onChange={(v) => setStatusFilter(v || "all")}
              options={[
                { value: "open", label: "待处理" },
                { value: "processing", label: "处理中" },
                { value: "closed", label: "已关闭" }
              ]}
            />
            <Select
              allowClear
              placeholder="全部分类"
              style={{ width: 140 }}
              value={categoryFilter === "all" ? null : categoryFilter}
              onChange={(v) => setCategoryFilter(v || "all")}
              options={[
                { value: "bug", label: "问题" },
                { value: "feature", label: "需求" },
                { value: "experience", label: "体验" },
                { value: "membership", label: "咨询开通" },
                { value: "other", label: "其他" }
              ]}
            />
            <Input
              allowClear
              placeholder="搜索邮箱 / 内容 / 联系方式"
              style={{ width: 280 }}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              prefix={<SearchOutlined style={{ color: "#94a3b8" }} />}
            />
            <Button icon={<ReloadOutlined />} onClick={() => loadRows()} loading={loading}>
              刷新
            </Button>
          </Space>
          <Table
            rowKey="id"
            loading={loading}
            dataSource={filteredRows}
            pagination={{
              pageSize: 10,
              showSizeChanger: true,
              showTotal: (t, range) => `第 ${range[0]}-${range[1]} 条，共 ${t} 条（全量 ${rows.length}）`
            }}
            scroll={{ x: 1080 }}
            columns={[
              {
                title: "用户邮箱",
                dataIndex: "userEmail",
                width: 200
              },
              {
                title: "分类",
                dataIndex: "category",
                width: 100,
                render: (v: FeedbackItem["category"]) => categoryText[v] || v
              },
              {
                title: "反馈内容",
                dataIndex: "content",
                width: 260,
                render: (v: string) => (
                  <div style={{ maxHeight: 140, overflow: "auto" }}>
                    <FeedbackContentView text={v} emptyFallback="（空）" />
                  </div>
                )
              },
              {
                title: "联系方式",
                dataIndex: "contact",
                width: 130,
                render: (v: string | null | undefined) => v || "-"
              },
              {
                title: "提交时间",
                dataIndex: "createdAt",
                width: 168,
                render: (v: string) => new Date(v).toLocaleString()
              },
              {
                title: "状态",
                dataIndex: "status",
                width: 120,
                render: (v: FeedbackItem["status"], row: FeedbackItem) => (
                  row.status === "open" ? (
                    <Link to={`/admin/feedback/${row.id}`}>待处理</Link>
                  ) : (
                    <Tag color={statusColor[v]}>{statusText[v]}</Tag>
                  )
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
