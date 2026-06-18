import React from "react";
import { App, Button, Card, Input, Space, Typography, InputNumber } from "antd";
import { WalletOutlined } from "@ant-design/icons";
import * as QRCode from "qrcode";
import GalaxyButton from "../components/GalaxyButton";
import { useReward } from "../state/RewardContext";
import { apiRequest } from "../api/client";

type PayChannel = "wechat" | "alipay";

const PRESET_AMOUNTS: { yuan: number; recommended?: boolean }[] = [
  { yuan: 10 },
  { yuan: 30 },
  { yuan: 50, recommended: true },
  { yuan: 100 },
  { yuan: 200 }
];

const y = (n: number) =>
  n.toLocaleString("zh-CN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** 顶栏金币「+」：账户余额充值（兑换码上方同字数页，下方为扫码支付面板） */
const WalletBalancePage: React.FC = () => {
  const { message } = App.useApp();
  const { state, addBalanceYuan, refreshPointsFromServer } = useReward();
  const [redeemInput, setRedeemInput] = React.useState("");
  const [redeemLoading, setRedeemLoading] = React.useState(false);
  const [payChannel, setPayChannel] = React.useState<PayChannel>("wechat");
  const [selectedYuan, setSelectedYuan] = React.useState<number | null>(50);
  const [customYuan, setCustomYuan] = React.useState<number | null>(null);
  const [useCustom, setUseCustom] = React.useState(false);
  const [qrDataUrl, setQrDataUrl] = React.useState("");
  const [qrLoading, setQrLoading] = React.useState(false);

  const effectiveYuan = useCustom ? customYuan : selectedYuan;

  const redeemReasonText: Record<string, string> = {
    invalid_code: "兑换码无效",
    disabled: "兑换码已停用",
    expired: "兑换码已过期",
    depleted: "兑换次数已用尽",
    not_eligible: "该码不适用当前账号",
    already_used: "您已使用过该码",
    banned: "账号已封禁"
  };

  const onRedeem = () => {
    const code = redeemInput.trim().toUpperCase();
    if (code.length < 4) {
      message.warning("请输入兑换码");
      return;
    }
    setRedeemLoading(true);
    (async () => {
      try {
        const res = await apiRequest<{
          ok: boolean;
          reason: string;
          points?: number;
          balanceYuan?: number;
        }>("/api/redeem/use", { method: "POST", json: { code } });
        if (!res.ok) {
          message.error(redeemReasonText[res.reason] || res.reason || "兑换失败");
          return;
        }
        await refreshPointsFromServer();
        message.success("兑换成功");
        setRedeemInput("");
      } finally {
        setRedeemLoading(false);
      }
    })().catch(() => {
      setRedeemLoading(false);
    });
  };

  React.useEffect(() => {
    if (effectiveYuan == null || effectiveYuan <= 0) {
      setQrDataUrl("");
      return;
    }
    let cancelled = false;
    setQrLoading(true);
    const payload = `coin-recharge:${payChannel}:${effectiveYuan.toFixed(2)}`;
    QRCode.toDataURL(payload, { width: 240, margin: 2 })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl("");
      })
      .finally(() => {
        if (!cancelled) setQrLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [effectiveYuan, payChannel]);

  const onConfirmPay = () => {
    const yuan = effectiveYuan;
    if (yuan == null || yuan <= 0) {
      message.warning("请选择或输入充值金额");
      return;
    }
    addBalanceYuan(yuan);
    message.success(
      `演示到账：¥${yuan.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}（${payChannel === "wechat" ? "微信" : "支付宝"}）`
    );
  };

  const pickPreset = (yuan: number) => {
    setUseCustom(false);
    setCustomYuan(null);
    setSelectedYuan(yuan);
  };

  const pickCustom = () => {
    setUseCustom(true);
    setSelectedYuan(null);
    if (customYuan == null) setCustomYuan(1);
  };

  return (
    <Space direction="vertical" size={16} className="wallet-balance-page" style={{ width: "100%", maxWidth: 720 }}>
      <div className="console-stagger-item console-stagger-item--1">
        <Card>
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Typography.Title level={4} style={{ margin: 0 }}>
              <WalletOutlined style={{ marginRight: 10, color: "#eab308" }} />
              我的金币
            </Typography.Title>
            <Typography.Text type="secondary">
              账户金币（元）可用于购买字数包、开通会员等；下方扫码充值到账。
            </Typography.Text>
            <div>
              <Typography.Text type="secondary">金币余额</Typography.Text>
              <Typography.Title level={2} style={{ margin: "4px 0 0", fontVariantNumeric: "tabular-nums" }}>
                ¥
                {state.balanceYuan.toLocaleString("zh-CN", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2
                })}
              </Typography.Title>
            </div>
            {state.membershipTier !== "none" ? (
              <TagMembership tier={state.membershipTier} />
            ) : null}
          </Space>
        </Card>
      </div>

      <div className="console-stagger-item console-stagger-item--1b">
        <Card title="兑换码">
          <Space.Compact className="wallet-redeem-compact" style={{ width: "100%", maxWidth: 480 }}>
            <Input
              placeholder="输入兑换码"
              value={redeemInput}
              onChange={(e) => setRedeemInput(e.target.value)}
              onPressEnter={onRedeem}
              allowClear
            />
            <Button type="primary" onClick={onRedeem} loading={redeemLoading}>
              兑换
            </Button>
          </Space.Compact>
        </Card>
      </div>

      <div className="console-stagger-item console-stagger-item--2">
        <Card title="金币充值" className="wallet-coin-pay-card">
          <div className="wallet-coin-pay-panel">
            <div className="wallet-coin-pay-panel__qr-wrap">
              <div className="wallet-coin-pay-panel__qr" aria-label="支付二维码">
                {qrLoading ? (
                  <Typography.Text type="secondary">生成二维码…</Typography.Text>
                ) : qrDataUrl ? (
                  <img src={qrDataUrl} alt="支付二维码" className="wallet-coin-pay-panel__qr-img" />
                ) : (
                  <Typography.Text type="secondary">请选择金额</Typography.Text>
                )}
              </div>
              <Typography.Text type="secondary" className="wallet-coin-pay-panel__qr-hint">
                支付二维码
              </Typography.Text>
            </div>

            <div className="wallet-coin-pay-panel__controls">
              <div className="wallet-coin-pay-panel__methods" role="group" aria-label="支付方式">
                <button
                  type="button"
                  className={[
                    "wallet-coin-pay-panel__method",
                    payChannel === "wechat" ? "wallet-coin-pay-panel__method--active" : ""
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => setPayChannel("wechat")}
                  aria-pressed={payChannel === "wechat"}
                >
                  <span className="wallet-coin-pay-panel__method-icon wallet-coin-pay-panel__method-icon--wechat" />
                  <span>微信</span>
                </button>
                <button
                  type="button"
                  className={[
                    "wallet-coin-pay-panel__method",
                    payChannel === "alipay" ? "wallet-coin-pay-panel__method--active" : ""
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => setPayChannel("alipay")}
                  aria-pressed={payChannel === "alipay"}
                >
                  <span className="wallet-coin-pay-panel__method-icon wallet-coin-pay-panel__method-icon--alipay" />
                  <span>支付宝</span>
                </button>
              </div>

              <div className="wallet-coin-pay-panel__amount-grid">
                {PRESET_AMOUNTS.map((item) => (
                  <button
                    key={item.yuan}
                    type="button"
                    className={[
                      "wallet-coin-pay-panel__amount",
                      !useCustom && selectedYuan === item.yuan
                        ? "wallet-coin-pay-panel__amount--active"
                        : "",
                      item.recommended ? "wallet-coin-pay-panel__amount--rec" : ""
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => pickPreset(item.yuan)}
                  >
                    ¥{y(item.yuan)}
                    {item.recommended ? (
                      <span className="wallet-coin-pay-panel__rec-tag">推荐</span>
                    ) : null}
                  </button>
                ))}
                <button
                  type="button"
                  className={[
                    "wallet-coin-pay-panel__amount",
                    "wallet-coin-pay-panel__amount--custom",
                    useCustom ? "wallet-coin-pay-panel__amount--active" : ""
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={pickCustom}
                >
                  {useCustom ? (
                    <InputNumber
                      min={0.01}
                      max={99999}
                      step={1}
                      precision={2}
                      value={customYuan ?? undefined}
                      prefix="¥"
                      size="small"
                      controls={false}
                      className="wallet-coin-pay-panel__custom-input"
                      onClick={(e) => e.stopPropagation()}
                      onChange={(v) => setCustomYuan(typeof v === "number" ? v : null)}
                    />
                  ) : (
                    <span>自定义</span>
                  )}
                </button>
              </div>

              <GalaxyButton block className="wallet-coin-pay-panel__confirm" onClick={onConfirmPay}>
                确认金额
                {effectiveYuan != null && effectiveYuan > 0
                  ? ` · ¥${y(effectiveYuan)}`
                  : ""}
              </GalaxyButton>
            </div>
          </div>
        </Card>
      </div>
    </Space>
  );
};

const TagMembership: React.FC<{ tier: "monthly" | "premium" }> = ({ tier }) => (
  <Typography.Text type="success">
    当前会员：{tier === "premium" ? "高级会员" : "普通会员"}
  </Typography.Text>
);

export default WalletBalancePage;
