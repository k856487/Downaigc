import React from "react";
import { App, Card, Form, Input, Button, Typography } from "antd";
import { Link, useNavigate } from "react-router-dom";
import { apiRequest, setAccessToken } from "../api/client";

const RegisterPage: React.FC = () => {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [submitting, setSubmitting] = React.useState(false);
  const [isExiting, setIsExiting] = React.useState(false);

  const onFinish = async (values: {
    email: string;
    password: string;
    confirm: string;
    invite?: string;
  }) => {
    setSubmitting(true);
    try {
      const res = await apiRequest<{ access_token: string }>("/api/auth/register", {
        method: "POST",
        json: {
          email: values.email.trim().toLowerCase(),
          password: values.password,
          nickname: undefined
        }
      });
      setAccessToken(res.access_token);
      setIsExiting(true);
      await new Promise<void>((resolve) => {
        window.setTimeout(() => resolve(), 360);
      });
      navigate("/console/dashboard");
    } catch (e: any) {
      message.error(e?.detail || "注册失败，请重试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card
      className={`auth-main-card ${isExiting ? "login-card-exit" : ""}`}
      style={{
        width: 420,
        borderRadius: 24,
        border: "1px solid rgba(255,255,255,0.92)",
        background: "rgba(255,255,255,0.68)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        boxShadow:
          "0 28px 60px rgba(15,23,42,0.16), 0 2px 0 rgba(255,255,255,0.95) inset"
      }}
      styles={{
        body: {
          padding: 32,
          borderRadius: 24,
          background: "rgba(255,255,255,0.72)",
          border: "1px solid rgba(255,255,255,0.9)",
          boxShadow: "0 1px 0 rgba(255,255,255,0.92) inset"
        }
      }}
    >
      <Typography.Title level={4} style={{ marginBottom: 8 }}>
        创建账户
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 24 }}>
        注册后即可管理你的论文润色与降重任务。
      </Typography.Paragraph>
        <Form layout="vertical" onFinish={onFinish}>
        <Form.Item
          label="邮箱"
          name="email"
          rules={[
            { required: true, message: "请输入邮箱" },
            { type: "email", message: "邮箱格式不正确" }
          ]}
        >
          <Input className="input" placeholder="name@example.com" />
        </Form.Item>
        <Form.Item
          label="密码"
          name="password"
          rules={[
            { required: true, message: "请输入密码" },
            { min: 6, message: "密码至少 6 位" }
          ]}
        >
          <Input.Password className="input" placeholder="至少 8 位密码" />
        </Form.Item>
        <Form.Item
          label="确认密码"
          name="confirm"
          dependencies={["password"]}
          rules={[
            { required: true, message: "请再次输入密码" },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue("password") === value) {
                  return Promise.resolve();
                }
                return Promise.reject(new Error("两次输入的密码不一致"));
              }
            })
          ]}
        >
          <Input.Password className="input" placeholder="请再次输入密码" />
        </Form.Item>
        <Form.Item label="邀请码（可选）" name="invite">
          <Input className="input" placeholder="如有邀请码可填写" />
        </Form.Item>
        <Form.Item style={{ marginBottom: 8 }}>
          <Button type="primary" htmlType="submit" block loading={submitting}>
            注册并登录
          </Button>
        </Form.Item>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          已有账号？<Link to="/login">返回登录</Link>
        </Typography.Text>
      </Form>
    </Card>
  );
};

export default RegisterPage;

