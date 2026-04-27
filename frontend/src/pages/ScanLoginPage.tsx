import React from "react";
import { App, Button, Card, Form, Input, Typography } from "antd";
import { apiRequest } from "../api/client";

const ScanLoginPage: React.FC = () => {
  const { message } = App.useApp();
  const [submitting, setSubmitting] = React.useState(false);
  const sid = React.useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return (params.get("sid") || "").trim();
  }, []);

  const onFinish = async (values: { email: string; password: string }) => {
    if (!sid) {
      message.error("扫码参数缺失，请重新扫码");
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiRequest<{ ok: boolean; detail?: string }>(
        `/api/auth/qr-login/session/${encodeURIComponent(sid)}/approve`,
        {
          method: "POST",
          json: { email: values.email.trim().toLowerCase(), password: values.password }
        }
      );
      message.success(res.detail || "已确认，请返回电脑端");
    } catch (e: any) {
      message.error(e?.detail || "确认失败，请重试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card style={{ width: 420, borderRadius: 16 }}>
      <Typography.Title level={4}>扫码登录确认</Typography.Title>
      <Typography.Paragraph type="secondary">
        在手机端输入账号密码确认后，电脑端会自动登录。
      </Typography.Paragraph>
      <Form layout="vertical" onFinish={onFinish} requiredMark={false}>
        <Form.Item
          label="邮箱"
          name="email"
          rules={[{ required: true, message: "请输入邮箱" }, { type: "email", message: "邮箱格式不正确" }]}
        >
          <Input placeholder="name@example.com" />
        </Form.Item>
        <Form.Item
          label="密码"
          name="password"
          rules={[{ required: true, message: "请输入密码" }]}
        >
          <Input.Password placeholder="请输入密码" />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={submitting}>
          确认登录电脑端
        </Button>
      </Form>
    </Card>
  );
};

export default ScanLoginPage;
