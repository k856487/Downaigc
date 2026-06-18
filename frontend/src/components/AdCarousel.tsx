import React from "react";
import { Carousel, Space, Typography } from "antd";

import {
  AD_WATCH_REWARD_NORMAL,
  REGISTRATION_BONUS,
  DAILY_SIGNIN_GRANT_NORMAL,
  RECHARGE_PACKAGES
} from "../config/pricing";

export type AdItem = {
  id: string;
  title: string;
  description: string;
  bg: string;
  navigateTo?: string;
  points?: number;
};

export const WATCH_AD_REWARD_ITEM: AdItem = {
  id: "watch-demo",
  title: `看 1 次广告，领 ${AD_WATCH_REWARD_NORMAL.toLocaleString("zh-CN")} 字`,
  description: "每次完整观看可获得改写字数，用于论文润色/降 AIGC。",
  bg: "var(--ad-card-bg-1)",
  points: AD_WATCH_REWARD_NORMAL
};

const hotPack = RECHARGE_PACKAGES.find((p) => p.recommended) ?? RECHARGE_PACKAGES[2];

/** 概览轮播：次要推广位（首页主视觉已改为看广告大按钮） */
const DEFAULT_ADS: AdItem[] = [
  {
    id: "promo-free",
    title: `注册送 ${REGISTRATION_BONUS.toLocaleString("zh-CN")} 字 · 签到 ${DAILY_SIGNIN_GRANT_NORMAL.toLocaleString("zh-CN")} 字/日`,
    description: "新用户免费体验论文润色与降 AIGC，优先观看激励广告获取改写字数。",
    bg: "var(--ad-card-bg-1)",
    navigateTo: "/console/polish"
  },
  {
    id: "promo-ad",
    title: "看广告免费改",
    description: `观看完整激励视频，立即获得 ${AD_WATCH_REWARD_NORMAL.toLocaleString("zh-CN")} 字改写字数。`,
    bg: "var(--ad-card-bg-2)",
    navigateTo: "/console/wallet/points"
  },
  {
    id: "promo-hot",
    title: `${hotPack.yuan} 元 · ${hotPack.points.toLocaleString("zh-CN")} 字（推荐）`,
    description: hotPack.hook ?? "热门字数包，适合毕业论文全文改写。",
    bg: "var(--ad-card-bg-3)",
    navigateTo: "/console/wallet/recharge"
  }
];

interface AdCarouselProps {
  /** 点击某条轮播时（用于站内跳转等） */
  onClickAd: (ad: AdItem) => void;
  ads?: AdItem[];
  /** 概览页等紧凑布局：降低轮播高度 */
  compact?: boolean;
}

const AdCarousel: React.FC<AdCarouselProps> = ({ onClickAd, ads, compact = false }) => {
  const items = ads ?? DEFAULT_ADS;

  return (
    <div
      className={["ad-carousel-shell", compact ? "ad-carousel-shell--compact" : ""]
        .filter(Boolean)
        .join(" ")}
      style={{
        borderRadius: 12,
        overflow: "hidden"
      }}
    >
      <Carousel autoplay dots>
        {items.map((ad, index) => (
          <div key={ad.id}>
            <button
              type="button"
              className={[
                "ad-carousel-slide-btn",
                `ad-carousel-slide-btn--${index % 3}`
              ].join(" ")}
              onClick={() => onClickAd(ad)}
              style={{
                width: "100%",
                border: "none",
                padding: compact ? 12 : 16,
                minHeight: compact ? 108 : 160,
                textAlign: "left",
                cursor: "pointer",
                borderRadius: "inherit"
              }}
            >
              <Space direction="vertical" size={4} style={{ width: "100%" }}>
                <Typography.Text strong style={{ fontSize: 14, color: "var(--ad-card-title)" }}>
                  {ad.title}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ color: "var(--ad-card-desc)" }}>
                  {ad.description}
                </Typography.Text>
                {ad.navigateTo ? (
                  <Typography.Text style={{ color: "#3370FF" }}>点击进入 →</Typography.Text>
                ) : null}
              </Space>
            </button>
          </div>
        ))}
      </Carousel>
    </div>
  );
};

export default AdCarousel;

