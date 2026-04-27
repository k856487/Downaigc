import React from "react";
import { App, Card, Form, Input, Typography } from "antd";
import { useLocation, useNavigate } from "react-router-dom";
import { apiRequest, clearAccessToken, setAccessToken } from "../../api/client";
import {
  clearAdminSession,
  hasAdminAccess,
  isAdminByEmail,
  setAdminSession
} from "../../state/adminAuth";

const AdminLoginPage: React.FC = () => {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [submitting, setSubmitting] = React.useState(false);
  const [isExiting, setIsExiting] = React.useState(false);

  React.useEffect(() => {
    if (hasAdminAccess()) {
      navigate("/admin/dashboard", { replace: true });
    }
  }, [navigate]);

  const onFinish = async (values: { email: string; password: string }) => {
    setSubmitting(true);
    try {
      const email = values.email.trim().toLowerCase();
      const res = await apiRequest<{ access_token: string }>("/api/auth/login", {
        method: "POST",
        json: { email, password: values.password }
      });

      setAccessToken(res.access_token);
      if (!isAdminByEmail(email)) {
        clearAccessToken();
        clearAdminSession();
        message.error("该账号没有管理员权限");
        return;
      }

      setAdminSession(email);
      setIsExiting(true);
      await new Promise<void>((resolve) => {
        window.setTimeout(() => resolve(), 360);
      });
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from || "/admin/dashboard", { replace: true });
    } catch (e: any) {
      message.error(e?.detail || "管理员登录失败，请重试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card
      className={isExiting ? "login-card-exit" : undefined}
      style={{
        width: 460,
        borderRadius: 16,
        border: "1px solid rgba(255,255,255,0.9)",
        background: "rgba(255,255,255,0.72)"
      }}
      styles={{ body: { padding: 28 } }}
    >
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        管理员登录
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        使用管理员账号登录后台。当前版本按邮箱白名单进行管理员判定。
      </Typography.Paragraph>

      <Form layout="vertical" requiredMark={false} onFinish={onFinish}>
        <Form.Item
          label="管理员邮箱"
          name="email"
          rules={[
            { required: true, message: "请输入管理员邮箱" },
            { type: "email", message: "邮箱格式不正确" }
          ]}
        >
          <Input className="input" placeholder="kiter" />
        </Form.Item>
        <Form.Item
          label="密码"
          name="password"
          rules={[{ required: true, message: "请输入密码" }]}
        >
          <Input.Password className="input" placeholder="请输入密码" />
        </Form.Item>
        <Form.Item style={{ marginBottom: 0 }}>
          <button
            type="submit"
            className="galaxy-btn"
            style={{ width: "100%" }}
            disabled={submitting}
            aria-busy={submitting}
          >
            <span className="galaxy-btn__content">
              <span className="galaxy-btn__text">
                {submitting ? "登录中..." : "登录管理员后台"}
              </span>
            </span>
            <span className="galaxy-btn__glow" />
            <span className="galaxy-btn__stars" />
          </button>
        </Form.Item>
      </Form>
    </Card>
  );
};

export default AdminLoginPage;

