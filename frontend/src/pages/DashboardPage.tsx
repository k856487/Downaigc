import React from "react";
import { App, Card, Space, Typography, Row, Col, Tag } from "antd";
import { PlayCircleOutlined, GiftOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import GalaxyButton from "../components/GalaxyButton";
import AdWatchQrModal from "../components/AdWatchQrModal";
import { useMembership } from "../state/MembershipContext";
import { useReward } from "../state/RewardContext";
import {
  HOME_PROMO_COPY,
  MEMBER_PLANS,
  RECHARGE_PACKAGES,
  FIRST_RECHARGE_WORD_PACK,
  adRewardForTier
} from "../config/pricing";
import {
  hasUsedFirstWordPack,
  markFirstWordPackUsed
} from "../utils/firstRechargeStorage";

const y = (n: number) =>
  n.toLocaleString("zh-CN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const hotPack = RECHARGE_PACKAGES.find((p) => p.recommended) ?? RECHARGE_PACKAGES[2];

const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const { setVipTier, membershipTier } = useMembership();
  const { state, addPoints } = useReward();
  const [adQrOpen, setAdQrOpen] = React.useState(false);
  const [firstWordUsed, setFirstWordUsed] = React.useState(hasUsedFirstWordPack);

  const adReward = adRewardForTier(membershipTier);
  const adLimit =
    state.adDailyLimit == null ? "不限" : `${state.adDailyLimit} 次/日`;

  const onActivatePlan = React.useCallback(
    async (plan: (typeof MEMBER_PLANS)[number]) => {
      const ok = await setVipTier({
        tier: plan.tier,
        tagColor: plan.tagColor,
        planTitle: plan.title
      });
      if (!ok) {
        message.error("开通失败，请登录后重试");
        return;
      }
      message.success(`开通成功：${plan.title}`);
    },
    [message, setVipTier]
  );

  const onFirstRechargeWord = React.useCallback(() => {
    if (firstWordUsed) {
      message.info("首充礼包仅限购买一次");
      navigate("/console/wallet/recharge");
      return;
    }
    addPoints(FIRST_RECHARGE_WORD_PACK.points);
    markFirstWordPackUsed();
    setFirstWordUsed(true);
    message.success(
      `首充成功：¥${FIRST_RECHARGE_WORD_PACK.yuan}，获得 ${FIRST_RECHARGE_WORD_PACK.points.toLocaleString("zh-CN")} 字`
    );
  }, [addPoints, firstWordUsed, message, navigate]);

  return (
    <Space direction="vertical" size={12} className="dashboard-page" style={{ width: "100%" }}>
      <AdWatchQrModal open={adQrOpen} onClose={() => setAdQrOpen(false)} />

      <div className="console-stagger-item console-stagger-item--1">
        <Card className="dashboard-ad-hero" styles={{ body: { padding: "20px 24px" } }}>
          <div className="dashboard-ad-hero__inner">
            <div className="dashboard-ad-hero__copy">
              <Typography.Text type="secondary" className="dashboard-ad-hero__eyebrow">
                免费获得改写字数
              </Typography.Text>
              <Typography.Title level={3} className="dashboard-ad-hero__title">
                观看完整广告
              </Typography.Title>
              <Typography.Title level={2} className="dashboard-ad-hero__reward">
                立即获得 {adReward.toLocaleString("zh-CN")} 字
              </Typography.Title>
              <Typography.Text type="secondary" className="dashboard-ad-hero__meta">
                {HOME_PROMO_COPY.register} · {HOME_PROMO_COPY.signin} · 每日最多 {adLimit}
              </Typography.Text>
            </div>
            <GalaxyButton
              className="cursor-target dashboard-ad-hero__cta"
              onClick={() => setAdQrOpen(true)}
            >
              <PlayCircleOutlined style={{ marginRight: 8 }} aria-hidden />
              立即领取
            </GalaxyButton>
          </div>
        </Card>
      </div>

      <div className="console-stagger-item console-stagger-item--1b">
        <div className="dashboard-promo-grid">
          <button
            type="button"
            className="cursor-target dashboard-promo-tile dashboard-promo-tile--first console-click-panel"
            onClick={onFirstRechargeWord}
          >
            <div className="dashboard-promo-tile__head">
              <GiftOutlined aria-hidden />
              <Typography.Text strong>新用户专享</Typography.Text>
              {!firstWordUsed ? <Tag color="volcano">限购一次</Tag> : <Tag>已购买</Tag>}
            </div>
            <Typography.Text className="dashboard-promo-tile__price">
              ¥{y(FIRST_RECHARGE_WORD_PACK.yuan)}
            </Typography.Text>
            <Typography.Text type="secondary">
              {FIRST_RECHARGE_WORD_PACK.points.toLocaleString("zh-CN")} 字 · {FIRST_RECHARGE_WORD_PACK.label}
            </Typography.Text>
            <Typography.Text type="secondary" className="dashboard-click-panel__hint">
              点击购买 →
            </Typography.Text>
          </button>

          <button
            type="button"
            className="cursor-target dashboard-promo-tile dashboard-promo-tile--hot console-click-panel"
            onClick={() => navigate("/console/wallet/recharge")}
          >
            <Typography.Text strong className="dashboard-promo-tile__cta">
              查看全部字数包 →
            </Typography.Text>
            <Typography.Text type="secondary" className="dashboard-promo-tile__meta">
              热门毕业论文包 · 推荐 · ¥{y(hotPack.yuan)} · {hotPack.points.toLocaleString("zh-CN")} 字
              {hotPack.hook ? ` · ${hotPack.hook}` : ""}
            </Typography.Text>
          </button>
        </div>
      </div>

      <div className="console-stagger-item console-stagger-item--2">
        <Typography.Title level={5} className="dashboard-section-title">
          会员中心
        </Typography.Title>
        <Typography.Paragraph type="secondary" className="dashboard-member-intro">
          {HOME_PROMO_COPY.member}：提升签到与广告奖励，开启快速/极速生成模式。
        </Typography.Paragraph>
        <Row gutter={[12, 12]} className="dashboard-member-plans" align="stretch">
          {MEMBER_PLANS.map((plan) => (
            <Col key={plan.tier} xs={24} lg={12}>
              <Card
                className="cursor-target dashboard-member-plan-card dashboard-click-panel"
                size="small"
                title={plan.title}
                extra={<Tag color={plan.tagColor}>{plan.tag}</Tag>}
                onClick={() => void onActivatePlan(plan)}
                hoverable
              >
                <Typography.Title level={4} className="dashboard-member-plan-price">
                  ¥{y(plan.yuan)}
                  <Typography.Text type="secondary" className="dashboard-member-plan-unit">
                    / 月
                  </Typography.Text>
                </Typography.Title>
                <Typography.Paragraph className="dashboard-member-plan-grant">
                  签到 {plan.signinGrant.toLocaleString("zh-CN")} 字/日 · 广告{" "}
                  {plan.adReward.toLocaleString("zh-CN")} 字/次 · 每日 {plan.adDailyLimit} 次
                </Typography.Paragraph>
                <ul className="dashboard-member-plan-perks">
                  {plan.perks.slice(3).map((perk) => (
                    <li key={perk}>
                      <Typography.Text type="secondary">{perk}</Typography.Text>
                    </li>
                  ))}
                </ul>
                <Typography.Text type="secondary" className="dashboard-click-panel__hint">
                  点击开通 →
                </Typography.Text>
              </Card>
            </Col>
          ))}
        </Row>
      </div>
    </Space>
  );
};

export default DashboardPage;
