import React from "react";
import { App, Card, Space, Typography, Alert, Tag } from "antd";
import { WalletOutlined, SafetyCertificateOutlined, CrownOutlined, GiftOutlined } from "@ant-design/icons";
import { useReward } from "../state/RewardContext";
import { useMembership } from "../state/MembershipContext";
import {
  RECHARGE_PACKAGES,
  FIRST_RECHARGE_WORD_PACK,
  FIRST_RECHARGE_MEMBER_PACK
} from "../config/pricing";
import {
  hasUsedFirstMemberPack,
  hasUsedFirstWordPack,
  markFirstMemberPackUsed,
  markFirstWordPackUsed
} from "../utils/firstRechargeStorage";

const y = (n: number) =>
  n.toLocaleString("zh-CN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** 顶栏「充值 +」：字数包与首充（演示本地到账） */
const WalletRechargePage: React.FC = () => {
  const { message } = App.useApp();
  const { state, addPoints } = useReward();
  const { setVipTier } = useMembership();
  const [firstWordUsed, setFirstWordUsed] = React.useState(hasUsedFirstWordPack);
  const [firstMemberUsed, setFirstMemberUsed] = React.useState(hasUsedFirstMemberPack);

  const onBuy = React.useCallback(
    (yuan: number, points: number, label: string) => {
      addPoints(points);
      message.success(`已充值 ¥${yuan}，获得 ${points.toLocaleString("zh-CN")} 字改写字数（${label}）`);
    },
    [addPoints, message]
  );

  const onFirstWord = React.useCallback(() => {
    if (firstWordUsed) {
      message.info("首充礼包仅限购买一次");
      return;
    }
    onBuy(FIRST_RECHARGE_WORD_PACK.yuan, FIRST_RECHARGE_WORD_PACK.points, FIRST_RECHARGE_WORD_PACK.label);
    markFirstWordPackUsed();
    setFirstWordUsed(true);
  }, [firstWordUsed, message, onBuy]);

  const onFirstMember = React.useCallback(async () => {
    if (firstMemberUsed) {
      message.info("首充会员包仅限购买一次");
      return;
    }
    const ok = await setVipTier({
      tier: FIRST_RECHARGE_MEMBER_PACK.tier,
      tagColor: "blue",
      planTitle: FIRST_RECHARGE_MEMBER_PACK.label,
      trialDays: FIRST_RECHARGE_MEMBER_PACK.days
    });
    if (!ok) {
      message.error("开通失败，请登录后重试");
      return;
    }
    markFirstMemberPackUsed();
    setFirstMemberUsed(true);
    message.success(`已开通 ${FIRST_RECHARGE_MEMBER_PACK.days} 天普通会员体验`);
  }, [firstMemberUsed, message, setVipTier]);

  return (
    <Space direction="vertical" size={12} className="wallet-recharge-page" style={{ width: "100%" }}>
      <div className="console-stagger-item console-stagger-item--1">
        <Card className="wallet-recharge-hero" styles={{ body: { padding: "12px 16px" } }}>
          <div className="wallet-recharge-hero__row">
            <div className="wallet-recharge-hero__lead">
              <Typography.Title level={5} style={{ margin: 0 }}>
                <WalletOutlined style={{ marginRight: 8, color: "var(--color-primary, #3370ff)" }} />
                字数包充值
              </Typography.Title>
              <Typography.Text type="secondary" className="wallet-recharge-hero__meta">
                字数永久有效 · 演示环境点击即到账
              </Typography.Text>
            </div>
            <div className="wallet-recharge-hero__balance">
              <Typography.Text type="secondary" className="wallet-recharge-hero__balance-label">
                剩余可改写字数
              </Typography.Text>
              <Typography.Text strong className="wallet-recharge-hero__balance-num">
                {state.writableWords.toLocaleString("zh-CN")} 字
              </Typography.Text>
            </div>
          </div>
        </Card>
      </div>

      <div className="console-stagger-item console-stagger-item--1b">
        <Typography.Title level={5} className="wallet-recharge-section-title">
          新用户首充（限购一次）
        </Typography.Title>
        <div className="wallet-recharge-first-grid">
          <button
            type="button"
            className={[
              "cursor-target",
              "wallet-recharge-pack-tile",
              "console-click-panel",
              firstWordUsed ? "wallet-recharge-pack-tile--used" : "wallet-recharge-pack-tile--first"
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={onFirstWord}
            disabled={firstWordUsed}
          >
            <div className="wallet-recharge-pack-tile__head">
              <GiftOutlined aria-hidden />
              <Typography.Text strong>{FIRST_RECHARGE_WORD_PACK.label}</Typography.Text>
              <Tag color="volcano">{FIRST_RECHARGE_WORD_PACK.tag}</Tag>
            </div>
            <Typography.Text strong className="wallet-recharge-pack-tile__price">
              ¥{y(FIRST_RECHARGE_WORD_PACK.yuan)}
            </Typography.Text>
            <Typography.Text type="secondary" className="wallet-recharge-pack-tile__points">
              {FIRST_RECHARGE_WORD_PACK.points.toLocaleString("zh-CN")} 字
            </Typography.Text>
            <Typography.Text type="secondary" className="wallet-recharge-pack-tile__hint">
              {firstWordUsed ? "已购买" : "点击购买 →"}
            </Typography.Text>
          </button>
          <button
            type="button"
            className={[
              "cursor-target",
              "wallet-recharge-pack-tile",
              "console-click-panel",
              firstMemberUsed ? "wallet-recharge-pack-tile--used" : "wallet-recharge-pack-tile--first"
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => void onFirstMember()}
            disabled={firstMemberUsed}
          >
            <div className="wallet-recharge-pack-tile__head">
              <CrownOutlined aria-hidden />
              <Typography.Text strong>{FIRST_RECHARGE_MEMBER_PACK.label}</Typography.Text>
              <Tag color="blue">{FIRST_RECHARGE_MEMBER_PACK.tag}</Tag>
            </div>
            <Typography.Text strong className="wallet-recharge-pack-tile__price">
              ¥{y(FIRST_RECHARGE_MEMBER_PACK.yuan)}
            </Typography.Text>
            <Typography.Text type="secondary" className="wallet-recharge-pack-tile__points">
              {FIRST_RECHARGE_MEMBER_PACK.days} 天普通会员
            </Typography.Text>
            <Typography.Text type="secondary" className="wallet-recharge-pack-tile__hint">
              {firstMemberUsed ? "已购买" : "点击开通 →"}
            </Typography.Text>
          </button>
        </div>
      </div>

      <div className="console-stagger-item console-stagger-item--2">
        <Typography.Title level={5} className="wallet-recharge-section-title">
          字数包
        </Typography.Title>
        <div className="wallet-recharge-pack-grid wallet-recharge-pack-grid--four">
          {RECHARGE_PACKAGES.map((pkg) => (
            <button
              key={pkg.yuan}
              type="button"
              className={[
                "cursor-target",
                "wallet-recharge-pack-tile",
                "console-click-panel",
                pkg.recommended ? "wallet-recharge-pack-tile--hot" : ""
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => onBuy(pkg.yuan, pkg.points, pkg.label)}
            >
              <div className="wallet-recharge-pack-tile__head">
                <Typography.Text strong className="wallet-recharge-pack-tile__label">
                  {pkg.label}
                </Typography.Text>
                {pkg.recommended ? (
                  <Tag color="red" icon={<CrownOutlined />} className="wallet-recharge-pack-tile__tag">
                    推荐
                  </Tag>
                ) : null}
              </div>
              <Typography.Text strong className="wallet-recharge-pack-tile__price">
                ¥{y(pkg.yuan)}
              </Typography.Text>
              <Typography.Text type="secondary" className="wallet-recharge-pack-tile__points">
                {pkg.points.toLocaleString("zh-CN")} 字
              </Typography.Text>
              {pkg.hook ? (
                <Typography.Text type="secondary" className="wallet-recharge-pack-tile__hook">
                  {pkg.hook}
                </Typography.Text>
              ) : (
                <span className="wallet-recharge-pack-tile__hook wallet-recharge-pack-tile__hook--placeholder" />
              )}
              <Typography.Text type="secondary" className="wallet-recharge-pack-tile__hint">
                点击购买 →
              </Typography.Text>
            </button>
          ))}
        </div>
      </div>

      <div className="console-stagger-item console-stagger-item--3">
        <Alert
          type="info"
          showIcon
          icon={<SafetyCertificateOutlined />}
          className="wallet-recharge-footnote"
          message="数据说明"
          description="演示充值写入本地并叠加到可改写字数；登录后与服务器同步，刷新后以服务端为准。建议优先观看激励广告获取免费字数。"
        />
      </div>
    </Space>
  );
};

export default WalletRechargePage;
