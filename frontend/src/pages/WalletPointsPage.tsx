import React from "react";
import { App, Button, Card, Input, Space, Typography, Alert, Tooltip } from "antd";
import { GiftOutlined, BulbOutlined, PlayCircleOutlined } from "@ant-design/icons";
import GalaxyButton from "../components/GalaxyButton";
import AdWatchQrModal from "../components/AdWatchQrModal";
import { useReward } from "../state/RewardContext";
import { apiRequest } from "../api/client";
import {
  adRewardForTier,
  AD_WATCH_REWARD_NORMAL,
  DAILY_SIGNIN_GRANT_NORMAL,
  MEMBER_PLANS,
  signinGrantForTier
} from "../config/pricing";
import { memberTagColorToHex } from "../utils/memberTierColor";

const WalletPointsPage: React.FC = () => {
  const { message } = App.useApp();
  const {
    state,
    canClaimDailyFreeToday,
    claimDailyFree,
    refreshPointsFromServer
  } = useReward();
  const [adQrOpen, setAdQrOpen] = React.useState(false);
  const [redeemInput, setRedeemInput] = React.useState("");
  const [redeemLoading, setRedeemLoading] = React.useState(false);

  const tier = state.membershipTier;
  const signinGrant = signinGrantForTier(tier);
  const adReward = adRewardForTier(tier);
  const adMemberBonus = adReward - AD_WATCH_REWARD_NORMAL;
  const signinMemberBonus = signinGrant - DAILY_SIGNIN_GRANT_NORMAL;
  const memberAccentColor =
    tier === "none"
      ? undefined
      : memberTagColorToHex(MEMBER_PLANS.find((p) => p.tier === tier)?.tagColor ?? "blue");

  const redeemReasonText: Record<string, string> = {
    invalid_code: "兑换码无效",
    disabled: "兑换码已停用",
    expired: "兑换码已过期",
    depleted: "兑换次数已用尽",
    not_eligible: "该码不适用当前账号",
    already_used: "您已使用过该码",
    banned: "账号已封禁"
  };

  const adLimitLabel =
    state.adDailyLimit == null
      ? "不限"
      : `${state.adWatchesToday}/${state.adDailyLimit} 次`;

  const onRedeem = () => {
    const code = redeemInput.trim().toUpperCase();
    if (code.length < 4) {
      message.warning("请输入兑换码");
      return;
    }
    setRedeemLoading(true);
    (async () => {
      try {
        const res = await apiRequest<{ ok: boolean; reason: string; points?: number; balanceYuan?: number }>(
          "/api/redeem/use",
          { method: "POST", json: { code } }
        );
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

  const onClaimDaily = () => {
    void (async () => {
      const res = await claimDailyFree();
      if (!res) return;
      if (res.gained > 0) {
        message.success(`签到成功，获得 ${res.gained.toLocaleString("zh-CN")} 字改写字数`);
      } else {
        message.info("今日已签到");
      }
    })();
  };

  return (
    <Space direction="vertical" size={16} style={{ width: "100%", maxWidth: 720 }}>
      <AdWatchQrModal open={adQrOpen} onClose={() => setAdQrOpen(false)} />

      <div className="console-stagger-item console-stagger-item--1">
        <Card>
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Typography.Title level={4} style={{ margin: 0 }}>
              <GiftOutlined style={{ marginRight: 10, color: "#6366f1" }} />
              改写字数
            </Typography.Title>
            <Typography.Text type="secondary">
              1 字 = 改写 1 个汉字，按实际输出扣费。优先通过看广告、签到获取；也可购买字数包。
            </Typography.Text>
            <div>
              <Typography.Text type="secondary">剩余可改写字数</Typography.Text>
              <Typography.Title level={2} style={{ margin: "4px 0 0", fontVariantNumeric: "tabular-nums" }}>
                {state.writableWords.toLocaleString("zh-CN")} 字
              </Typography.Title>
            </div>
            <Typography.Text type="secondary" className="wallet-points-page__breakdown">
              永久 {state.points.toLocaleString("zh-CN")} 字 · 今日免费 {state.dailyFreePoints.toLocaleString("zh-CN")} 字
            </Typography.Text>
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
        <Card title="免费获得改写字数">
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Typography.Paragraph style={{ marginBottom: 0 }}>
              优先观看激励广告：每次{" "}
              <RewardWordsBreakdown
                base={AD_WATCH_REWARD_NORMAL}
                memberBonus={adMemberBonus}
                accentColor={memberAccentColor}
              />
              （今日 {adLimitLabel}）。 每日签到{" "}
              <RewardWordsBreakdown
                base={DAILY_SIGNIN_GRANT_NORMAL}
                memberBonus={signinMemberBonus}
                accentColor={memberAccentColor}
              />
              。
            </Typography.Paragraph>
            <div className="wallet-points-row wallet-points-row--second">
              <Tooltip title="弹出二维码：微信扫一扫观看激励视频">
                <GalaxyButton onClick={() => setAdQrOpen(true)} aria-label="看广告领改写字数">
                  <PlayCircleOutlined style={{ marginRight: 6 }} aria-hidden />
                  看广告 +{adReward.toLocaleString("zh-CN")} 字
                </GalaxyButton>
              </Tooltip>
              <GalaxyButton
                className="galaxy-btn--surface-light"
                disabled={!canClaimDailyFreeToday}
                onClick={onClaimDaily}
              >
                {canClaimDailyFreeToday
                  ? `每日签到 +${signinGrant.toLocaleString("zh-CN")} 字`
                  : "今日已签到"}
              </GalaxyButton>
              <GalaxyButton
                className="galaxy-btn--surface-light"
                onClick={() => (window.location.href = "/console/wallet/recharge")}
              >
                字数包充值
              </GalaxyButton>
            </div>
          </Space>
        </Card>
      </div>

      <div className="console-stagger-item console-stagger-item--3">
        <Alert
          type="info"
          showIcon
          icon={<BulbOutlined />}
          message="使用建议"
          description="优先看广告获取免费改写字数；急需使用时再购买首充礼包或字数包；高频用户可开通会员提升签到/广告奖励与生成速度。"
        />
      </div>
    </Space>
  );
};

const TagMembership: React.FC<{ tier: "monthly" | "premium" }> = ({ tier }) => (
  <Typography.Text type="success">
    当前会员：{tier === "premium" ? "高级会员" : "普通会员"}
  </Typography.Text>
);

const RewardWordsBreakdown: React.FC<{
  base: number;
  memberBonus: number;
  accentColor?: string;
}> = ({ base, memberBonus, accentColor }) => (
  <>
    +{base.toLocaleString("zh-CN")}
    {memberBonus > 0 && accentColor ? (
      <span style={{ color: accentColor }}> (+{memberBonus.toLocaleString("zh-CN")})</span>
    ) : null}
    {" 字"}
  </>
);

export default WalletPointsPage;
