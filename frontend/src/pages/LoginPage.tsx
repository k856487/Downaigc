import React from "react";
import { App, Card, Form, Input, Button, Typography, Checkbox } from "antd";
import {
  GithubOutlined,
  WechatOutlined,
  PhoneOutlined,
  GoogleOutlined,
  QqOutlined,
  PlusOutlined,
  MinusOutlined
} from "@ant-design/icons";
import { Link, useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";
import AuthMethodModal from "../components/AuthMethodModal";
import { apiRequest, setAccessToken } from "../api/client";
import { Avatar } from "antd";
import { useUserProfile } from "../state/UserProfileContext";
import { createGlyphDataUrl } from "../utils/glyphCenter";
import { clearAdminSession, isAdminByEmail, setAdminSession } from "../state/adminAuth";

const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const { profile, setNickname: saveNickname, setAvatarUrl: saveAvatarUrl } = useUserProfile();
  const [nickname, setNickname] = React.useState(profile.nickname);
  const [avatarImageUrl, setAvatarImageUrl] = React.useState<string | null>(profile.avatarUrl);
  const [showRegisterOptions, setShowRegisterOptions] = React.useState(false);
  const [authMethod, setAuthMethod] = React.useState<
    "email" | "phone" | "wechat" | "qq" | "github" | "google"
  >("email");
  const [showAuthModal, setShowAuthModal] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [isExiting, setIsExiting] = React.useState(false);
  const avatarFileInputRef = React.useRef<HTMLInputElement | null>(null);

  const openAuthMethod = React.useCallback(
    (nextMethod: "email" | "phone" | "wechat" | "qq" | "github" | "google") => {
      setAuthMethod(nextMethod);
      setShowAuthModal(true);
      // 让旧层与新弹窗淡入有一段重叠，避免底层登录卡片短暂露出。
      window.setTimeout(() => setShowRegisterOptions(false), 220);
    },
    []
  );

  const onFinish = async (values: { email: string; password: string }) => {
    setSubmitting(true);
    try {
      const res = await apiRequest<{ access_token: string }>(
        "/api/auth/login",
        {
          method: "POST",
          json: { email: values.email, password: values.password }
        }
      );
      setAccessToken(res.access_token);
      const normalizedEmail = values.email.trim().toLowerCase();
      if (isAdminByEmail(normalizedEmail)) {
        setAdminSession(normalizedEmail);
      } else {
        // 普通端登录后清理管理员会话，避免后续 /admin 误判继承旧状态。
        clearAdminSession();
      }
      setIsExiting(true);
      await new Promise<void>((resolve) => {
        window.setTimeout(() => resolve(), 360);
      });
      navigate(isAdminByEmail(normalizedEmail) ? "/admin/dashboard" : "/console/dashboard");
    } catch (e: any) {
      message.error(e?.detail || "登录失败，请重试");
    } finally {
      setSubmitting(false);
    }
  };

  const avatarInitial = nickname.charAt(0);
  const bigGlyphImage = React.useMemo(
    () => createGlyphDataUrl(avatarInitial, 264, 136),
    [avatarInitial]
  );

  React.useEffect(() => {
    saveAvatarUrl(avatarImageUrl);
  }, [avatarImageUrl, saveAvatarUrl]);

  React.useEffect(() => {
    return () => {
      /* keep avatar URL for header/profile persistence */
    };
  }, []);

  const handlePickAvatar = React.useCallback(() => {
    avatarFileInputRef.current?.click();
  }, []);

  const handleAvatarAction = React.useCallback(() => {
    if (avatarImageUrl) {
      URL.revokeObjectURL(avatarImageUrl);
      setAvatarImageUrl(null);
      return;
    }
    handlePickAvatar();
  }, [avatarImageUrl, handlePickAvatar]);

  const handleAvatarFileChange = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        message.warning("请选择图片文件作为头像");
        e.target.value = "";
        return;
      }
      const nextUrl = URL.createObjectURL(file);
      setAvatarImageUrl(nextUrl);
      e.target.value = "";
    },
    [message]
  );

  return (
    <>
    <Card
      className={`auth-main-card ${isExiting ? "login-card-exit" : ""}`}
      style={{
        width: 760,
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
          position: "relative",
          padding: 32,
          borderRadius: 24,
          background: "rgba(255,255,255,0.72)",
          border: "1px solid rgba(255,255,255,0.9)",
          boxShadow: "0 1px 0 rgba(255,255,255,0.92) inset"
        }
      }}
    >
      <button
        className="login-avatar-action-btn"
        type="button"
        onClick={handleAvatarAction}
        aria-label={avatarImageUrl ? "删除头像" : "上传头像"}
        data-tip={avatarImageUrl ? "删除头像" : "上传头像"}
        style={{
          position: "absolute",
          top: 16,
          left: 16,
          border: "none",
          background: "transparent",
          color: "#0f172a",
          fontSize: 20,
          fontWeight: 700,
          lineHeight: 1,
          padding: 2,
          cursor: "pointer",
          zIndex: 2
        }}
      >
        {avatarImageUrl ? <MinusOutlined /> : <PlusOutlined />}
      </button>
      <input
        ref={avatarFileInputRef}
        type="file"
        accept="image/*"
        onChange={handleAvatarFileChange}
        style={{ display: "none" }}
      />
      <div
        className="auth-method-layout"
        style={{ gridTemplateColumns: "1.25fr 1.2fr", columnGap: 36 }}
      >
        <div className="auth-method-left">
          <div
            className="auth-qrcode-card"
            style={{
              background: "transparent",
              border: "none",
              boxShadow: "none",
              padding: "4px 2px 0",
              minHeight: 350,
              display: "flex",
              flexDirection: "column"
            }}
          >
            <div className="auth-qrcode-box" style={{ marginBottom: 10 }}>
              <div style={{ position: "relative", width: 264, height: 264 }}>
                <Avatar
                  size={264}
                  src={avatarImageUrl ?? undefined}
                  icon={undefined}
                  style={{
                    background: "#ffffff",
                    color: "#1f2937",
                    border: "1px solid rgba(255,255,255,0.92)",
                    boxShadow:
                      "0 10px 22px rgba(15,23,42,0.14), 0 1px 0 rgba(255,255,255,0.95) inset"
                  }}
                />
                {!avatarImageUrl && avatarInitial ? (
                  <span key={avatarInitial} className="login-avatar-glyph login-avatar-glyph--pop">
                    {bigGlyphImage ? <img className="avatar-glyph-image" src={bigGlyphImage} alt="" aria-hidden /> : null}
                  </span>
                ) : null}
              </div>
            </div>
            <div
              style={{
                marginTop: "auto",
                marginBottom: "auto",
                transform: "translateY(14px)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 10
              }}
            >
              <Typography.Text style={{ fontSize: 15, color: "#1f2937", fontWeight: 600 }}>
                昵称
              </Typography.Text>
              <input
                value={nickname}
                onChange={(e) => {
                  const next = e.target.value;
                  setNickname(next);
                  saveNickname(next);
                }}
                placeholder="请输入"
                style={{
                  width: 178,
                  border: "none",
                  borderBottom: "2px solid rgba(51, 65, 85, 0.35)",
                  background: "transparent",
                  outline: "none",
                  fontSize: 15,
                  color: "#0f172a",
                  padding: "3px 0"
                }}
              />
            </div>
          </div>
        </div>
        <div className="auth-method-right">
          <Typography.Title level={4} style={{ marginBottom: 8 }}>
            {nickname ? `${nickname} 同学，你好呀 ` : "同学，你好呀 "}
            <span style={{ whiteSpace: "nowrap" }}>(｡･ω･｡)ﾉ♡ 嗨~</span>
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
            提笔行文思漫漫，润稿提质解君难
          </Typography.Paragraph>

          <Form layout="vertical" onFinish={onFinish} requiredMark={false}>
            <Form.Item
              label="邮箱"
              name="email"
              rules={[{ required: true, message: "请输入邮箱" }]}
            >
              <Input className="input" placeholder="name@example.com" />
            </Form.Item>
            <Form.Item
              label="密码"
              name="password"
              rules={[{ required: true, message: "请输入密码" }]}
            >
              <Input.Password className="input" placeholder="请输入密码" />
            </Form.Item>
            <Form.Item style={{ marginBottom: 8 }}>
              <button
                type="submit"
                className="galaxy-btn"
                style={{ width: "100%" }}
                disabled={submitting}
                aria-busy={submitting}
              >
                {submitting ? (
                  <span className="login-circle-loading" aria-hidden />
                ) : (
                  <span className="galaxy-btn__content">
                    <span className="galaxy-btn__text">登录</span>
                  </span>
                )}
                <span className="galaxy-btn__glow" />
                <span className="galaxy-btn__stars" />
              </button>
            </Form.Item>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              暂无账号？
              <a
                href="#register"
                onClick={(e) => {
                  e.preventDefault();
                  setShowRegisterOptions(true);
                }}
              >
                立即注册
              </a>
              {" / "}
              <a
                href="#other-login"
                onClick={(e) => {
                  e.preventDefault();
                  setShowRegisterOptions(true);
                }}
              >
                其他登录方式
              </a>
            </Typography.Text>
            <Form.Item
              className="login-form-agreement"
              name="agreement"
              valuePropName="checked"
              style={{ marginTop: 8, marginBottom: 0 }}
              rules={[
                {
                  validator: (_, value) =>
                    value
                      ? Promise.resolve()
                      : Promise.reject(new Error("请先阅读并同意下方协议"))
                }
              ]}
            >
              <Checkbox style={{ fontSize: 12 }}>
                我已阅读并同意：本工具仅用于学术写作辅助，不对因不当使用产生的后果负责。
              </Checkbox>
            </Form.Item>
          </Form>
        </div>
      </div>
      <AuthMethodModal
        open={showAuthModal}
        method={authMethod}
        onClose={() => {
          setShowAuthModal(false);
          setShowRegisterOptions(true);
        }}
        onSuccessClose={() => {
          setShowAuthModal(false);
          setShowRegisterOptions(false);
        }}
      />
    </Card>
    {showRegisterOptions && typeof document !== "undefined"
      ? createPortal(
          <div
            className={`login-register-overlay ${showAuthModal ? "login-register-overlay-handoff" : ""}`}
            onClick={() => setShowRegisterOptions(false)}
          >
            <div
              className="login-register-panel"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="login-register-panel-title">选择注册/登录方式</div>
              <div className="login-register-panel-desc">
                你可以先随便选一种方式占个账号，后续再在设置页完善信息。
              </div>
              <ul className="login-register-wrapper">
                <li
                  className="icon qq"
                  onClick={() => {
                    openAuthMethod("qq");
                  }}
                >
                  <span className="tooltip">QQ</span>
                  <QqOutlined />
                </li>
                <li
                  className="icon github"
                  onClick={() => {
                    openAuthMethod("github");
                  }}
                >
                  <span className="tooltip">GitHub</span>
                  <GithubOutlined />
                </li>
                <li
                  className="icon wechat"
                  onClick={() => {
                    openAuthMethod("wechat");
                  }}
                >
                  <span className="tooltip">微信</span>
                  <WechatOutlined />
                </li>
                <li
                  className="icon phone"
                  onClick={() => {
                    openAuthMethod("phone");
                  }}
                >
                  <span className="tooltip">手机号</span>
                  <PhoneOutlined />
                </li>
                <li
                  className="icon google"
                  onClick={() => {
                    openAuthMethod("google");
                  }}
                >
                  <span className="tooltip">Google</span>
                  <GoogleOutlined />
                </li>
              </ul>
              <Typography.Text
                className="login-register-close-text"
                onClick={() => setShowRegisterOptions(false)}
              >
                先继续使用账号密码登录
              </Typography.Text>
            </div>
          </div>,
          document.body
        )
      : null}
    </>
  );
};

export default LoginPage;

