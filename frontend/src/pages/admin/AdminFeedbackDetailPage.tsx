import React from "react";
import { App, Button, Card, Descriptions, Empty, Select, Space, Tag, Typography } from "antd";
import { ArrowLeftOutlined, ReloadOutlined } from "@ant-design/icons";
import { useNavigate, useParams } from "react-router-dom";
import { apiRequest } from "../../api/client";
import { notifyAdminOpenFeedbackChanged } from "../../state/adminFeedbackOpenCountEvents";
import { FeedbackRichEditor } from "../../components/FeedbackRichEditor";
import { FeedbackContentView } from "../../utils/feedbackContent";
import { normalizeToEditorHtml } from "../../utils/feedbackHtml";

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

const AdminFeedbackDetailPage: React.FC = () => {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const { feedbackId } = useParams<{ feedbackId: string }>();
  const [row, setRow] = React.useState<FeedbackItem | null>(null);
  const [replyDraft, setReplyDraft] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [savingReply, setSavingReply] = React.useState(false);
  const [replyEditorKey, setReplyEditorKey] = React.useState(0);

  const loadRow = React.useCallback(() => {
    if (!feedbackId) return;
    setLoading(true);
    apiRequest<FeedbackItem>(`/api/admin/feedback/${feedbackId}`, { method: "GET" })
      .then((data) => {
        setRow(data);
        setReplyDraft(normalizeToEditorHtml(data.adminReply ?? ""));
        setReplyEditorKey((k) => k + 1);
      })
      .catch((e: { detail?: string }) => {
        if (e?.detail === "Feedback not found") {
          setRow(null);
          setReplyDraft("");
          message.error("反馈不存在或已删除");
          return;
        }
        message.error(e?.detail === "Admin access denied" ? "无管理员权限" : "加载反馈详情失败");
      })
      .finally(() => setLoading(false));
  }, [feedbackId, message]);

  React.useEffect(() => {
    loadRow();
  }, [loadRow]);

  const updateStatus = React.useCallback(
    async (status: FeedbackItem["status"]) => {
      if (!feedbackId || !row || status === row.status) return;
      setSaving(true);
      try {
        const next = await apiRequest<FeedbackItem>(`/api/admin/feedback/${feedbackId}`, {
          method: "PATCH",
          json: { status }
        });
        setRow(next);
        notifyAdminOpenFeedbackChanged();
        message.success("状态已更新");
      } catch (e) {
        const detail = typeof e === "object" && e && "detail" in e ? String((e as { detail?: string }).detail) : "";
        message.error(detail || "更新状态失败");
      } finally {
        setSaving(false);
      }
    },
    [feedbackId, message, row]
  );

  const saveReply = React.useCallback(async () => {
    if (!feedbackId) return;
    setSavingReply(true);
    try {
      const next = await apiRequest<FeedbackItem>(`/api/admin/feedback/${feedbackId}`, {
        method: "PATCH",
        json: { adminReply: replyDraft }
      });
      setRow(next);
      setReplyDraft(normalizeToEditorHtml(next.adminReply ?? ""));
      setReplyEditorKey((k) => k + 1);
      message.success("处理回复已保存");
    } catch (e) {
      const detail = typeof e === "object" && e && "detail" in e ? String((e as { detail?: string }).detail) : "";
      message.error(detail || "保存回复失败");
    } finally {
      setSavingReply(false);
    }
  }, [feedbackId, message, replyDraft]);

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <div className="console-stagger-item console-stagger-item--1">
        <Space direction="vertical" size={4} style={{ width: "100%" }}>
          <Space align="center" size={8} wrap>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate("/admin/feedback")}>
              返回反馈列表
            </Button>
            <Typography.Title level={4} style={{ margin: 0 }}>
              反馈处理页
            </Typography.Title>
          </Space>
          <Typography.Text type="secondary">
            查看用户反馈与图片；下方回复区为所见即所得，粘贴截图后图片直接显示在输入区内，保存后用户侧同步展示。
          </Typography.Text>
        </Space>
      </div>

      <div className="console-stagger-item console-stagger-item--2">
        <Card
          loading={loading}
          title="反馈详情"
          extra={
            <Button icon={<ReloadOutlined />} onClick={() => loadRow()} loading={loading}>
              刷新
            </Button>
          }
        >
          {row ? (
            <Space direction="vertical" size={16} style={{ width: "100%" }}>
              <Descriptions bordered column={{ xs: 1, md: 2 }}>
                <Descriptions.Item label="用户邮箱">{row.userEmail || "-"}</Descriptions.Item>
                <Descriptions.Item label="反馈分类">{categoryText[row.category] || row.category}</Descriptions.Item>
                <Descriptions.Item label="当前状态">
                  <Tag color={statusColor[row.status]}>{statusText[row.status]}</Tag>
                </Descriptions.Item>
                <Descriptions.Item label="联系方式">{row.contact || "-"}</Descriptions.Item>
                <Descriptions.Item label="提交时间">{new Date(row.createdAt).toLocaleString()}</Descriptions.Item>
                <Descriptions.Item label="最后更新">{new Date(row.updatedAt).toLocaleString()}</Descriptions.Item>
                <Descriptions.Item label="反馈 ID" span={2}>
                  <Typography.Text copyable code>
                    {row.id}
                  </Typography.Text>
                </Descriptions.Item>
              </Descriptions>

              <Card size="small" title="用户反馈内容">
                <FeedbackContentView text={row.content} emptyFallback="（无内容）" />
              </Card>

              <Card size="small" title="处理操作">
                <Space wrap align="center">
                  <Typography.Text type="secondary">修改状态：</Typography.Text>
                  <Select
                    value={row.status}
                    style={{ width: 140 }}
                    loading={saving}
                    onChange={(next) => updateStatus(next)}
                    options={[
                      { value: "open", label: "待处理" },
                      { value: "processing", label: "处理中" },
                      { value: "closed", label: "已关闭" }
                    ]}
                  />
                </Space>
              </Card>

              <Card size="small" title="处理回复（对用户可见）">
                <Space direction="vertical" style={{ width: "100%" }} size={12}>
                  <Typography.Text type="secondary">
                    Ctrl+V 粘贴截图会自动上传，图片显示在下方编辑区内（与用户在「我的反馈」中看到的一致）。
                  </Typography.Text>
                  <FeedbackRichEditor
                    key={`${feedbackId}-${replyEditorKey}`}
                    uploadPath="/api/admin/feedback/upload-image"
                    value={replyDraft}
                    onChange={setReplyDraft}
                    minHeight={260}
                    placeholder="填写对用户可见的回复；需要配图时在框内粘贴截图。"
                    disabled={savingReply}
                  />
                  <Button type="primary" onClick={() => saveReply().catch(() => {})} loading={savingReply}>
                    保存回复
                  </Button>
                </Space>
              </Card>
            </Space>
          ) : (
            <Empty description="未找到反馈记录" />
          )}
        </Card>
      </div>
    </Space>
  );
};

export default AdminFeedbackDetailPage;
