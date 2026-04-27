import React from "react";
import { Carousel, Space, Typography } from "antd";

export type AdItem = {
  id: string;
  title: string;
  description: string;
  bg: string;
  points: number;
};

const DEFAULT_ADS: AdItem[] = [
  {
    id: "ad-1",
    title: "看 1 次广告，领积分",
    description: "每次完整观看可获得积分，用于论文润色/降重。",
    bg: "var(--ad-card-bg-1)",
    points: 8
  },
  {
    id: "ad-2",
    title: "签到也能领积分",
    description: "连续签到领取更多积分，适合重度写作场景。",
    bg: "var(--ad-card-bg-2)",
    points: 0
  },
  {
    id: "ad-3",
    title: "段落级对比，改动更清晰",
    description: "改前改后一眼对比，逐段确认再导出全文。",
    bg: "var(--ad-card-bg-3)",
    points: 0
  }
];

interface AdCarouselProps {
  onClickAd: (ad: AdItem) => void;
  ads?: AdItem[];
}

const AdCarousel: React.FC<AdCarouselProps> = ({ onClickAd, ads }) => {
  const items = ads ?? DEFAULT_ADS;

  return (
    <div
      className="ad-carousel-shell"
      style={{
        borderRadius: 12,
        overflow: "hidden"
      }}
    >
      <Carousel autoplay dots>
        {items.map((ad) => (
          <div key={ad.id}>
            <button
              type="button"
              onClick={() => onClickAd(ad)}
              style={{
                width: "100%",
                border: "none",
                background: ad.bg,
                padding: 16,
                minHeight: 160,
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
                {ad.points > 0 ? (
                  <Typography.Text style={{ color: "#3370FF" }}>
                    完整观看可得 {ad.points} 积分
                  </Typography.Text>
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

