import React from "react";
import { App, Modal, Tabs, Form, Input, Button, Typography } from "antd";
import { apiRequest, setAccessToken } from "../api/client";
import { useNavigate } from "react-router-dom";
import * as QRCode from "qrcode";

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, options: Record<string, any>) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

type AuthMethod = "email" | "phone" | "wechat" | "qq" | "github" | "google";

interface AuthMethodModalProps {
  open: boolean;
  method: AuthMethod;
  onClose: () => void;
  onSuccessClose: () => void;
}

const { Paragraph, Text, Title } = Typography;

const AuthMethodModal: React.FC<AuthMethodModalProps> = ({
  open,
  method,
  onClose,
  onSuccessClose
}) => {
  const [form] = Form.useForm();
  const [emailForm] = Form.useForm();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [sendingEmailCode, setSendingEmailCode] = React.useState(false);
  const [emailSubmitting, setEmailSubmitting] = React.useState(false);
  const [emailCodeCountdown, setEmailCodeCountdown] = React.useState(0);
  const [showCaptchaModal, setShowCaptchaModal] = React.useState(false);
  const [captchaError, setCaptchaError] = React.useState("");
  const [pendingCodeEmail, setPendingCodeEmail] = React.useState("");
  const [useLocalCaptcha, setUseLocalCaptcha] = React.useState(false);
  const [localCaptchaId, setLocalCaptchaId] = React.useState("");
  const [localCaptchaQuestion, setLocalCaptchaQuestion] = React.useState("");
  const [localCaptchaAnswer, setLocalCaptchaAnswer] = React.useState("");
  const [loadingLocalCaptcha, setLoadingLocalCaptcha] = React.useState(false);
  const [emailSuccessExiting, setEmailSuccessExiting] = React.useState(false);
  const [qrSessionId, setQrSessionId] = React.useState("");
  const [qrImageUrl, setQrImageUrl] = React.useState("");
  const [qrUrlRaw, setQrUrlRaw] = React.useState("");
  const [qrExpired, setQrExpired] = React.useState(false);
  const captchaHostRef = React.useRef<HTMLDivElement | null>(null);
  const captchaWidgetIdRef = React.useRef<string | null>(null);
  const turnstileSiteKey = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined)?.trim();

  React.useEffect(() => {
    if (emailCodeCountdown <= 0) return;
    const t = window.setTimeout(() => setEmailCodeCountdown((v) => v - 1), 1000);
    return () => window.clearTimeout(t);
  }, [emailCodeCountdown]);

  const createQrSession = React.useCallback(async () => {
    const res = await apiRequest<{ session_id: string; qr_url: string }>(
      "/api/auth/qr-login/session",
      {
        method: "POST",
        json: { frontend_origin: window.location.origin }
      }
    );
    setQrSessionId(res.session_id);
    setQrUrlRaw(res.qr_url);
    try {
      // 优先本地生成 DataURL，避免外链二维码服务被网络拦截导致不显示。
      const localDataUrl = await QRCode.toDataURL(res.qr_url, { width: 156, margin: 1 });
      setQrImageUrl(localDataUrl);
    } catch {
      // 兜底：使用外部二维码图片服务
      setQrImageUrl(
        `https://api.qrserver.com/v1/create-qr-code/?size=156x156&margin=1&data=${encodeURIComponent(
          res.qr_url
        )}`
      );
    }
    setQrExpired(false);
  }, []);

  React.useEffect(() => {
    if (!open || emailSuccessExiting) return;
    createQrSession().catch(() => {
      setQrImageUrl("");
      setQrSessionId("");
      setQrUrlRaw("");
      setQrExpired(true);
    });
  }, [open, emailSuccessExiting, createQrSession]);

  React.useEffect(() => {
    if (!open || !qrSessionId || emailSuccessExiting) return;
    const timer = window.setInterval(async () => {
      try {
        const status = await apiRequest<{ status: "pending" | "approved" | "expired"; access_token?: string }>(
          `/api/auth/qr-login/session/${encodeURIComponent(qrSessionId)}`
        );
        if (status.status === "expired") {
          setQrExpired(true);
          window.clearInterval(timer);
          return;
        }
        if (status.status === "approved" && status.access_token) {
          setAccessToken(status.access_token);
          setEmailSuccessExiting(true);
          window.clearInterval(timer);
          window.setTimeout(() => {
            onSuccessClose();
            navigate("/console/dashboard");
          }, 360);
        }
      } catch {
        // ignore polling jitter
      }
    }, 1800);
    return () => window.clearInterval(timer);
  }, [open, qrSessionId, emailSuccessExiting, navigate, onSuccessClose]);

  const sendCodeRequest = React.useCallback(
    (email: string, captchaToken?: string, localCaptchaIdValue?: string, localCaptchaAnswerValue?: string) => {
      setSendingEmailCode(true);
      apiRequest<{ ok: boolean; detail?: string }>("/api/auth/email/send-code", {
        method: "POST",
        json: {
          email,
          purpose: "register",
          captcha_token: captchaToken,
          local_captcha_id: localCaptchaIdValue,
          local_captcha_answer: localCaptchaAnswerValue
        }
      })
        .then((res) => {
          message.success(res.detail || "验证码已发送");
          setEmailCodeCountdown(60);
        })
        .catch((e: any) => {
          message.error(e?.detail || "发送验证码失败");
        })
        .finally(() => {
          setSendingEmailCode(false);
          setPendingCodeEmail("");
          setUseLocalCaptcha(false);
          setLocalCaptchaId("");
          setLocalCaptchaQuestion("");
          setLocalCaptchaAnswer("");
        });
    },
    [message]
  );

  const loadLocalCaptcha = React.useCallback(() => {
    setLoadingLocalCaptcha(true);
    setCaptchaError("");
    apiRequest<{ captcha_id: string; question: string }>("/api/auth/local-captcha/challenge")
      .then((res) => {
        setUseLocalCaptcha(true);
        setLocalCaptchaId(res.captcha_id);
        setLocalCaptchaQuestion(res.question);
        setLocalCaptchaAnswer("");
      })
      .catch((e: any) => {
        setCaptchaError(e?.detail || "本地验证码加载失败");
      })
      .finally(() => setLoadingLocalCaptcha(false));
  }, []);

  React.useEffect(() => {
    if (!showCaptchaModal || !turnstileSiteKey || !captchaHostRef.current) return;
    const host = captchaHostRef.current;
    let cancelled = false;

    const ensureTurnstile = async () => {
      if (window.turnstile) return;
      await new Promise<void>((resolve, reject) => {
        const existing = document.querySelector<HTMLScriptElement>('script[data-turnstile="cf"]');
        if (existing) {
          if (window.turnstile) {
            resolve();
            return;
          }
          const onLoad = () => resolve();
          const onError = () => reject(new Error("load error"));
          existing.addEventListener("load", onLoad, { once: true });
          existing.addEventListener("error", onError, { once: true });
          return;
        }
        const script = document.createElement("script");
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        script.defer = true;
        script.setAttribute("data-turnstile", "cf");
        script.addEventListener("load", () => resolve(), { once: true });
        script.addEventListener("error", () => reject(new Error("load error")), { once: true });
        document.head.appendChild(script);
      });
    };

    const renderCaptcha = async () => {
      try {
        setCaptchaError("");
        await ensureTurnstile();
        if (cancelled || !window.turnstile) return;
        host.innerHTML = "";
        captchaWidgetIdRef.current = window.turnstile.render(host, {
          sitekey: turnstileSiteKey,
          theme: "light",
          callback: (token: string) => {
            setShowCaptchaModal(false);
            if (pendingCodeEmail) {
              sendCodeRequest(pendingCodeEmail, token);
            }
          },
          "error-callback": () => {
            setCaptchaError("云端验证失败，已切换本地验证");
            loadLocalCaptcha();
          }
        });
        window.setTimeout(() => {
          if (!captchaWidgetIdRef.current && !useLocalCaptcha) {
            setCaptchaError("云端验证未加载，已切换本地验证");
            loadLocalCaptcha();
          }
        }, 2500);
      } catch {
        if (cancelled) return;
        setCaptchaError("云端验证脚本加载失败，已切换本地验证");
        loadLocalCaptcha();
      }
    };

    renderCaptcha();
    return () => {
      cancelled = true;
    };
  }, [showCaptchaModal, turnstileSiteKey, pendingCodeEmail, sendCodeRequest, useLocalCaptcha, loadLocalCaptcha]);

  React.useEffect(() => {
    if (open) {
      // 仅在重新打开时重置退场态，避免关闭尾帧闪回清晰态。
      setEmailSuccessExiting(false);
    }
    if ((!open || !showCaptchaModal) && window.turnstile && captchaWidgetIdRef.current) {
      window.turnstile.remove(captchaWidgetIdRef.current);
      captchaWidgetIdRef.current = null;
    }
    if (!open) {
      setShowCaptchaModal(false);
      setCaptchaError("");
      setPendingCodeEmail("");
      setUseLocalCaptcha(false);
      setLocalCaptchaId("");
      setLocalCaptchaQuestion("");
      setLocalCaptchaAnswer("");
      setQrSessionId("");
      setQrImageUrl("");
      setQrUrlRaw("");
      setQrExpired(false);
    }
  }, [open, showCaptchaModal]);

  const renderPhoneContent = () => {
    return (
      <div className="auth-method-layout">
        <div className="auth-method-left">
          <div className="auth-qrcode-card">
            <div className="auth-qrcode-title">App 扫码登录</div>
            <div className="auth-qrcode-box">
              <div className="auth-qrcode-placeholder" />
            </div>
            <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 4 }}>
              使用手机 App 扫码快速登录。
            </Paragraph>
            <Paragraph type="secondary" style={{ fontSize: 12 }}>
              二维码仅为示意，暂未接入真实扫码登录。
            </Paragraph>
          </div>
        </div>
        <div className="auth-method-right">
          <Tabs
            activeKey="phone"
            items={[
              { key: "account", label: "账号登录" },
              { key: "phone", label: "手机号登录" },
              { key: "other", label: "其他方式" }
            ]}
          />
          <Form
            form={form}
            layout="vertical"
            requiredMark={false}
            style={{ marginTop: 8 }}
            onFinish={onClose}
          >
            <Form.Item label="手机号">
              <Input
                className="input"
                addonBefore="+86"
                placeholder="请输入手机号"
              />
            </Form.Item>
            <Form.Item label="验证码">
              <div className="auth-phone-code-row">
                <Input className="input" placeholder="请输入验证码" />
                <Button style={{ marginLeft: 8 }}>获取验证码</Button>
              </div>
            </Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              block
              style={{ marginTop: 8 }}
            >
              立即登录
            </Button>
            <Paragraph
              type="secondary"
              style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}
            >
              登录成功后，将自动为你创建并绑定手机号账号。
            </Paragraph>
          </Form>
        </div>
      </div>
    );
  };

  const renderPlaceholder = (label: string) => (
    <div className="auth-method-layout">
      <div className="auth-method-left">
        <div className="auth-qrcode-card">
          <div className="auth-qrcode-title">{label}</div>
          <div className="auth-qrcode-box">
            {qrImageUrl ? (
              <img className="auth-qr-image" src={qrImageUrl} alt="扫码登录二维码" />
            ) : (
              <div className="auth-qrcode-placeholder" />
            )}
          </div>
          <Paragraph type="secondary" style={{ fontSize: 12 }}>
            此登录方式界面为占位示意，后续可接入真实鉴权流程。
          </Paragraph>
        </div>
      </div>
      <div className="auth-method-right">
        <Title level={5} style={{ marginBottom: 8 }}>
          {label} 登录
        </Title>
        <Paragraph type="secondary" style={{ fontSize: 13 }}>
          点击下方按钮将使用 {label} 账号完成登录。本版本仅展示 UI，未接入真实
          OAuth / 扫码能力。
        </Paragraph>
        <Button type="primary" block disabled>
          敬请期待
        </Button>
        <Text type="secondary" style={{ display: "block", marginTop: 8, fontSize: 12 }}>
          你可以先使用账号密码或手机号登录，后续再绑定 {label} 账号。
        </Text>
      </div>
    </div>
  );

  const renderEmailRegister = (entryLabel: string) => (
    <div className="auth-method-layout">
      <div className="auth-method-left">
        <div className="auth-qrcode-card">
          <div className="auth-qrcode-title">扫码登录</div>
          <div className="auth-qrcode-box">
            <div className="auth-qrcode-placeholder" />
          </div>
          <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 4 }}>
            发送验证码到邮箱，完成{entryLabel}账号注册或登录。
          </Paragraph>
          <Paragraph type="secondary" style={{ fontSize: 12 }}>
            使用手机扫码后输入账号密码即可确认登录。
          </Paragraph>
          {qrExpired ? (
            <Text className="auth-captcha-switch-text" onClick={() => createQrSession().catch(() => undefined)}>
              二维码已过期，点击刷新
            </Text>
          ) : null}
          {qrUrlRaw ? (
            <Text style={{ fontSize: 12 }}>
              扫码失败可直接打开：
              <a href={qrUrlRaw} target="_blank" rel="noreferrer">
                手机确认页
              </a>
            </Text>
          ) : null}
        </div>
      </div>
      <div className="auth-method-right">
        <Form
          className="email-register-form"
          form={emailForm}
          layout="vertical"
          requiredMark={false}
          onFinish={(values: { email: string; code: string; password: string }) => {
            (async () => {
              setEmailSubmitting(true);
              try {
                const res = await apiRequest<{ access_token: string; updated_existing?: boolean }>("/api/auth/email/register", {
                  method: "POST",
                  json: {
                    email: values.email.trim().toLowerCase(),
                    code: values.code.trim(),
                    password: values.password
                  }
                });
                setAccessToken(res.access_token);
                message.success(res.updated_existing ? "账号已存在，密码已更新并自动登录" : "注册成功，已自动登录");
                setEmailSuccessExiting(true);
                await new Promise<void>((resolve) => {
                  window.setTimeout(() => resolve(), 360);
                });
                onSuccessClose();
                navigate("/console/dashboard");
              } catch (e: any) {
                message.error(e?.detail || "注册失败，请重试");
              } finally {
                setEmailSubmitting(false);
              }
            })().catch(() => {
              setEmailSubmitting(false);
            });
          }}
        >
          <Form.Item
            name="email"
            rules={[
              { required: true, message: "请输入邮箱" },
              { type: "email", message: "邮箱格式不正确" }
            ]}
          >
            <div className="auth-inline-field">
              <span className="auth-inline-label">邮箱</span>
              <Input className="underline-input" placeholder="name@example.com" />
            </div>
          </Form.Item>
          <Form.Item
            name="password"
            rules={[
              { required: true, message: "请输入密码" },
              { min: 6, message: "密码至少 6 位" }
            ]}
          >
            <div className="auth-inline-field">
              <span className="auth-inline-label">密码</span>
              <Input.Password className="underline-input" placeholder="至少 6 位" />
            </div>
          </Form.Item>
          <Form.Item required>
            <div className="auth-inline-field">
              <span className="auth-inline-label">验证码</span>
              <div className="auth-phone-code-row auth-inline-code-row">
              <Form.Item
                name="code"
                noStyle
                rules={[
                  { required: true, message: "请输入验证码" },
                  { len: 6, message: "验证码应为 6 位" }
                ]}
              >
                <Input className="underline-input" placeholder="6 位验证码" />
              </Form.Item>
              <Button
                style={{ marginLeft: 8 }}
                loading={sendingEmailCode}
                disabled={emailCodeCountdown > 0}
                onClick={() => {
                  const email = String(emailForm.getFieldValue("email") || "").trim().toLowerCase();
                  if (!email) {
                    message.warning("请先填写邮箱");
                    return;
                  }
                  if (turnstileSiteKey) {
                    setPendingCodeEmail(email);
                    setShowCaptchaModal(true);
                    return;
                  }
                  sendCodeRequest(email);
                }}
              >
                {emailCodeCountdown > 0 ? `${emailCodeCountdown}s` : "发送验证码"}
              </Button>
              </div>
            </div>
          </Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            block
            loading={emailSubmitting}
            className="email-register-submit"
          >
            注册/登录
          </Button>
        </Form>
      </div>
    </div>
  );

  let title = "";
  let content: React.ReactNode = null;

  switch (method) {
    case "phone":
      title = "手机号注册";
      content = renderEmailRegister("手机号");
      break;
    case "email":
      title = "邮箱注册";
      content = renderEmailRegister("邮箱");
      break;
    case "wechat":
      title = "微信注册";
      content = renderEmailRegister("微信");
      break;
    case "qq":
      title = "QQ 注册";
      content = renderEmailRegister("QQ");
      break;
    case "github":
      title = "GitHub 注册";
      content = renderEmailRegister("GitHub");
      break;
    case "google":
      title = "Google 注册";
      content = renderEmailRegister("Google");
      break;
    default:
      break;
  }

  return (
    <Modal
      open={open}
      title={title}
      onCancel={onClose}
      footer={null}
      width={760}
      centered
      zIndex={1400}
      transitionName="ant-fade"
      maskTransitionName="ant-fade"
      rootClassName={`auth-method-modal ${emailSuccessExiting ? "auth-method-modal-exit" : ""}`}
      styles={{
        mask: {
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          background: "rgba(15, 23, 42, 0.45)"
        }
      }}
      destroyOnHidden
    >
      {content}
      <div style={{ marginTop: 16, textAlign: "right" }}>
        <Text className="auth-modal-back-text" onClick={onClose}>
          返回其他登录方式
        </Text>
      </div>
      <Modal
        open={showCaptchaModal}
        title="请完成人机验证"
        footer={null}
        onCancel={() => setShowCaptchaModal(false)}
        centered
        destroyOnHidden
        width={380}
        zIndex={1500}
        styles={{
          mask: {
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            background: "rgba(15, 23, 42, 0.42)"
          }
        }}
      >
        {!useLocalCaptcha ? <div className="turnstile-popup-host" ref={captchaHostRef} /> : null}
        {useLocalCaptcha ? (
          <div className="local-captcha-wrap">
            <Text>请计算：{localCaptchaQuestion}</Text>
            <Input
              className="input"
              placeholder="输入答案"
              value={localCaptchaAnswer}
              onChange={(e) => setLocalCaptchaAnswer(e.target.value)}
              style={{ marginTop: 10, marginBottom: 10 }}
            />
            <Button
              type="primary"
              block
              loading={sendingEmailCode}
              onClick={() => {
                if (!pendingCodeEmail) {
                  message.warning("邮箱为空，请重新操作");
                  return;
                }
                if (!localCaptchaAnswer.trim()) {
                  message.warning("请输入本地验证码答案");
                  return;
                }
                setShowCaptchaModal(false);
                sendCodeRequest(pendingCodeEmail, undefined, localCaptchaId, localCaptchaAnswer);
              }}
            >
              验证并发送验证码
            </Button>
            <Button
              type="text"
              block
              style={{ marginTop: 6 }}
              loading={loadingLocalCaptcha}
              onClick={loadLocalCaptcha}
            >
              换一题
            </Button>
          </div>
        ) : null}
        {captchaError ? (
          <Text type="danger" style={{ fontSize: 12 }}>
            {captchaError}
          </Text>
        ) : (
          <Text type="secondary" style={{ fontSize: 12 }}>
            若云端验证未出现，将自动切换本地验证。
          </Text>
        )}
        {!useLocalCaptcha ? (
          <Text
            className="auth-captcha-switch-text"
            onClick={() => {
              if (loadingLocalCaptcha) return;
              loadLocalCaptcha();
            }}
          >
            {loadingLocalCaptcha ? "本地验证加载中..." : "云端验证不可用？改用本地验证"}
          </Text>
        ) : null}
      </Modal>
    </Modal>
  );
};

export default AuthMethodModal;

