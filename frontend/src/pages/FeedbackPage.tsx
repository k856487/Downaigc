import React from "react";
import { App, Button, Card, Form, Input, Select, Space, Table, Tag, Typography } from "antd";
import { apiRequest } from "../api/client";
import { FeedbackRichEditor } from "../components/FeedbackRichEditor";
import { FeedbackContentView } from "../utils/feedbackContent";
import { feedbackHtmlHasImage, feedbackHtmlPlainTextLen } from "../utils/feedbackHtml";

type FeedbackItem = {
  id: string;
  category: "bug" | "feature" | "experience" | "other" | "membership";
  content: string;
  adminReply?: string | null;
  contact?: string | null;
  status: "open" | "processing" | "closed";
  createdAt: string;
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

const FeedbackPage: React.FC = () => {
  const { message } = App.useApp();
  const [form] = Form.useForm<{ category: FeedbackItem["category"]; content: string; contact?: string }>();
  const [loading, setLoading] = React.useState(false);
  const [rows, setRows] = React.useState<FeedbackItem[]>([]);
  const [contentEditorKey, setContentEditorKey] = React.useState(0);

  const loadRows = React.useCallback(() => {
    setLoading(true);
    apiRequest<FeedbackItem[]>("/api/feedback/my", { method: "GET" })
      .then(setRows)
      .catch(() => message.error("加载反馈记录失败"))
      .finally(() => setLoading(false));
  }, [message]);

  React.useEffect(() => {
    loadRows();
  }, [loadRows]);

  const onFinish = async (values: { category: FeedbackItem["category"]; content: string; contact?: string }) => {
    await apiRequest("/api/feedback", {
      method: "POST",
      json: values
    });
    message.success("反馈已提交，感谢你的建议");
    form.resetFields();
    setContentEditorKey((k) => k + 1);
    loadRows();
  };

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <div className="console-stagger-item console-stagger-item--1">
        <Card title="体验反馈">
          <Form
            form={form}
            layout="vertical"
            requiredMark={false}
            initialValues={{ category: "experience" }}
            onFinish={(values) => {
              onFinish(values).catch(() => message.error("提交失败，请重试"));
            }}
          >
            <Form.Item label="反馈类型" name="category" rules={[{ required: true, message: "请选择反馈类型" }]}>
              <Select
                options={[
                  { value: "bug", label: "问题反馈" },
                  { value: "feature", label: "功能建议" },
                  { value: "experience", label: "体验优化" },
                  { value: "membership", label: "咨询开通" },
                  { value: "other", label: "其他" }
                ]}
              />
            </Form.Item>
            <Form.Item
              label="反馈内容"
              name="content"
              getValueFromEvent={(v: string) => v}
              rules={[
                { required: true, message: "请填写反馈内容" },
                {
                  validator: async (_, v: string) => {
                    const html = v || "";
                    if (feedbackHtmlPlainTextLen(html) >= 8) return;
                    if (feedbackHtmlHasImage(html)) return;
                    throw new Error("请至少输入 8 个字符，或在编辑区内粘贴截图（Ctrl+V）");
                  }
                }
              ]}
            >
              <FeedbackRichEditor
                key={contentEditorKey}
                uploadPath="/api/feedback/upload-image"
                minHeight={200}
                placeholder="输入文字说明；配图时在框内 Ctrl+V 粘贴截图，图片会直接显示在输入区。"
              />
            </Form.Item>
            <Form.Item label="联系方式（可选）" name="contact">
              <Input placeholder="邮箱 / 微信 / QQ（便于我们回访）" />
            </Form.Item>
            <Button type="primary" htmlType="submit">
              提交反馈
            </Button>
          </Form>
        </Card>
      </div>

      <div className="console-stagger-item console-stagger-item--2">
        <Card title="我的反馈记录">
          <Table
            rowKey="id"
            loading={loading}
            dataSource={rows}
            pagination={{ pageSize: 8 }}
            columns={[
              {
                title: "类型",
                dataIndex: "category",
                width: 110,
                render: (v: FeedbackItem["category"]) =>
                  ({
                    bug: "问题",
                    feature: "需求",
                    experience: "体验",
                    membership: "咨询开通",
                    other: "其他"
                  }[v] || v)
              },
              {
                title: "内容",
                dataIndex: "content",
                width: 280,
                render: (v: string) => <FeedbackContentView text={v} emptyFallback="（空）" />
              },
              {
                title: "官方回复",
                dataIndex: "adminReply",
                width: 220,
                render: (v: string | null | undefined) => (
                  <FeedbackContentView text={v || ""} emptyFallback="—" />
                )
              },
              {
                title: "提交时间",
                dataIndex: "createdAt",
                width: 180,
                render: (v: string) => new Date(v).toLocaleString()
              },
              {
                title: "状态",
                dataIndex: "status",
                width: 110,
                render: (v: FeedbackItem["status"]) => <Tag color={statusColor[v]}>{statusText[v]}</Tag>
              }
            ]}
          />
        </Card>
      </div>
    </Space>
  );
};

export default FeedbackPage;

