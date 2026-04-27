import React from "react";
import { App, Card, Col, Row, Space, Typography } from "antd";
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

      <div className="console-stagger-item console-stagger-item--3">
        <Card title="最近一次论文润色">
          <Space direction="vertical">
            <Typography.Text strong>示例论文：机器学习综述</Typography.Text>
            <Typography.Text type="secondary">
              3 个段落 · 最近一次执行完成 · 示例数据，仅供界面预览
            </Typography.Text>
          </Space>
        </Card>
      </div>

      <div className="console-stagger-item console-stagger-item--4">
        <Card title="我的使用旅程">
          <Row gutter={16}>
            <Col span={8}>
              <Card variant="borderless">
                <Typography.Text strong>Step 1 · 准备论文</Typography.Text>
                <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
                  上传整篇论文或分章节文档，系统会自动进行分段与字数统计。
                </Typography.Paragraph>
              </Card>
            </Col>
            <Col span={8}>
              <Card variant="borderless">
                <Typography.Text strong>Step 2 · 润色与降重</Typography.Text>
                <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
                  选择段落、调整参数，逐段对比原文与润色后版本。
                </Typography.Paragraph>
              </Card>
            </Col>
            <Col span={8}>
              <Card variant="borderless">
                <Typography.Text strong>Step 3 · 导出与提交</Typography.Text>
                <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
                  确认所有段落修改后，一键导出润色后的全文草稿。
                </Typography.Paragraph>
              </Card>
            </Col>
          </Row>
        </Card>
      </div>
    </Space>
  );
};

export default DashboardPage;

