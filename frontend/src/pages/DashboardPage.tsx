import React from "react";
import { App, Card, Space, Typography } from "antd";
import AdCarousel, { type AdItem } from "../components/AdCarousel";
import AdPlayerModal from "../components/AdPlayerModal";
import { useReward } from "../state/RewardContext";
import GalaxyButton from "../components/GalaxyButton";
import { apiRequest } from "../api/client";
import { getTodayKey } from "../state/rewardState";

const DashboardPage: React.FC = () => {
  const { message } = App.useApp();
  const { canSignInToday, signInToday, state, syncFromServer } = useReward();
  const [adOpen, setAdOpen] = React.useState(false);
  const [selectedAd, setSelectedAd] = React.useState<AdItem | null>(null);

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <div className="console-stagger-item console-stagger-item--1">
        <AdCarousel
          onClickAd={(ad) => {
            setSelectedAd(ad);
            setAdOpen(true);
          }}
        />
      </div>
      <AdPlayerModal
        open={adOpen}
        ad={selectedAd}
        onClose={() => setAdOpen(false)}
      />

      <div className="console-stagger-item console-stagger-item--2">
        <Card title="积分中心">
          <Space direction="vertical" size={8} style={{ width: "100%" }}>
            <Typography.Text>当前积分：{state.points}</Typography.Text>
            <Typography.Text type="secondary">
              看一次广告可获得积分；签到也可领取积分，连续签到奖励递增。
            </Typography.Text>
            <Space>
              <GalaxyButton
                disabled={!canSignInToday}
                onClick={() => {
                  (async () => {
                    const res = await apiRequest<{
                      gained: number;
                      streak: number;
                      points: number;
                    }>("/api/points/signin", { method: "POST" });

                    syncFromServer({
                      ...state,
                      points: res.points,
                      signIn: {
                        lastDate: getTodayKey(),
                        streak: res.streak
                      }
                    });

                    message.success(
                      `签到成功：+${res.gained} 积分（连签 ${res.streak} 天）`
                    );
                  })().catch(() => {
                    // apiRequest 内部会处理 401 跳转登录
                  });
                }}
              >
                {canSignInToday ? "今日签到领积分" : "今日已签到"}
              </GalaxyButton>
              <Typography.Text type="secondary">
                连签天数：{state.signIn.streak}
              </Typography.Text>
            </Space>
          </Space>
        </Card>
      </div>

    </Space>
  );
};

export default DashboardPage;

