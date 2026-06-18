import React from "react";
import {
  App,
  Button,
  Card,
  Col,
  Input,
  Row,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
  Alert
} from "antd";
import AdHubWatchEmbed from "../components/AdHubWatchEmbed";
import { adhubRequest, clearAdhubToken, getAdhubQrCode, getAdhubToken, setAdhubToken } from "../api/adhubClient";

type Campaign = {
  id: string;
  title: string;
  description?: string;
  durationSec: number;
  publisherRewardPoints: number;
  viewsTotal: number;
  viewsValid: number;
  viewsSuspicious: number;
  companyName?: string;
};

type CampaignStats = Campaign & {
  linkedQrCount: number;
  recentEvents: Array<{
    id: string;
    qrCode: string;
    durationSec: number;
    suspicious: boolean;
    publisherRewardPoints: number;
    createdAt: string;
  }>;
};

type RevenuePreview = {
  totalRewardPoints: number;
  validViews: number;
  suspiciousViews: number;
  recent: Array<{ campaignId: string | null; rewardPoints: number; suspicious: boolean; createdAt: string }>;
};

const AdHubPromoPage: React.FC = () => {
  const { message } = App.useApp();
  const [tokenReady, setTokenReady] = React.useState(!!getAdhubToken());
  const [qrCode, setQrCode] = React.useState(getAdhubQrCode());
  const [campaignTitle, setCampaignTitle] = React.useState("downAiGC 测试推广 30秒");
  const [campaigns, setCampaigns] = React.useState<Campaign[]>([]);
  const [linked, setLinked] = React.useState<Campaign[]>([]);
  const [revenue, setRevenue] = React.useState<RevenuePreview | null>(null);
  const [stats, setStats] = React.useState<CampaignStats | null>(null);
  const [statsCampaignId, setStatsCampaignId] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  const refreshMarket = React.useCallback(async () => {
    const res = await adhubRequest<{ items: Campaign[] }>("/api/adhub/market/campaigns");
    setCampaigns(res.items || []);
  }, []);

  const refreshPublisher = React.useCallback(async () => {
    try {
      const [links, rev] = await Promise.all([
        adhubRequest<{ items: Campaign[] }>("/api/adhub/me/qr/campaigns"),
        adhubRequest<RevenuePreview>("/api/adhub/me/revenue-preview")
      ]);
      setLinked(links.items || []);
      setRevenue(rev);
    } catch {
      setLinked([]);
      setRevenue(null);
    }
  }, []);

  const devLogin = async (asAdvertiser: boolean) => {
    setLoading(true);
    try {
      const res = await adhubRequest<{ accessToken: string }>("/api/adhub/web/dev-login", {
        method: "POST",
        auth: false,
        json: {
          nickname: asAdvertiser ? "广告商测试" : "流量主测试",
          asAdvertiser,
          companyName: asAdvertiser ? "测试广告商公司" : ""
        }
      });
      setAdhubToken(res.accessToken);
      setTokenReady(true);
      message.success(asAdvertiser ? "已连接广告商测试身份" : "已连接流量主测试身份");
      await refreshMarket();
      if (!asAdvertiser) await refreshPublisher();
    } catch (e: unknown) {
      const detail = typeof e === "object" && e && "detail" in e ? String((e as { detail?: string }).detail) : "连接失败";
      message.error(detail);
    } finally {
      setLoading(false);
    }
  };

  const publishCampaign = async () => {
    setLoading(true);
    try {
      await adhubRequest("/api/adhub/advertiser/campaigns", {
        method: "POST",
        json: {
          title: campaignTitle.trim(),
          description: "downAiGC 联调 · 30 秒倒计时广告",
          durationSec: 30,
          publisherRewardPoints: 1888
        }
      });
      message.success("广告已发布到广场");
      await refreshMarket();
    } catch (e: unknown) {
      const detail = typeof e === "object" && e && "detail" in e ? String((e as { detail?: string }).detail) : "发布失败";
      message.error(detail);
    } finally {
      setLoading(false);
    }
  };

  const attachCampaign = async (campaignId: string) => {
    setLoading(true);
    try {
      await adhubRequest("/api/adhub/me/qr/campaigns", {
        method: "POST",
        json: { campaignId }
      });
      message.success("已加单到你的专属二维码（需在小程序完成实名）");
      await refreshPublisher();
    } catch (e: unknown) {
      const detail = typeof e === "object" && e && "detail" in e ? String((e as { detail?: string }).detail) : "加单失败";
      message.error(detail);
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async (campaignId?: string) => {
    const id = campaignId || statsCampaignId;
    if (!id) return;
    setStatsCampaignId(id);
    try {
      const res = await adhubRequest<CampaignStats>(`/api/adhub/advertiser/campaigns/${encodeURIComponent(id)}/stats`);
      setStats(res);
    } catch {
      setStats(null);
    }
  };

  React.useEffect(() => {
    if (!tokenReady) return;
    void refreshMarket();
  }, [tokenReady, refreshMarket]);

  React.useEffect(() => {
    if (!tokenReady || !statsCampaignId) return;
    const t = window.setInterval(() => {
      void loadStats(statsCampaignId);
    }, 3000);
    return () => window.clearInterval(t);
  }, [tokenReady, statsCampaignId]);

  return (
    <Space direction="vertical" size={16} style={{ width: "100%", maxWidth: 960 }}>
      <Alert
        type="info"
        showIcon
        message="扫码看广 × downAiGC 联调"
        description={
          <>
            后端经 downAiGC（8000）代理 API 到扫码看广（8001）。专属二维码
            <code> {getAdhubQrCode()} </code>
            已在改写字数页挂载；小程序侧在「广场 → 申请接单」挂载广告后，H5 观看页会播放对应素材。
          </>
        }
      />

      <Card title="1. 连接测试身份">
        <Space wrap>
          <Button loading={loading} onClick={() => devLogin(true)}>
            广告商测试身份
          </Button>
          <Button loading={loading} onClick={() => devLogin(false)}>
            流量主测试身份
          </Button>
          <Button
            danger
            onClick={() => {
              clearAdhubToken();
              setTokenReady(false);
              setStats(null);
              message.info("已断开");
            }}
          >
            断开
          </Button>
          {tokenReady ? <Tag color="success">已连接</Tag> : <Tag>未连接</Tag>}
        </Space>
      </Card>

      <Tabs
        items={[
          {
            key: "watch",
            label: "观看预览",
            children: (
              <Card title="专属二维码观看页">
                <Space direction="vertical" style={{ width: "100%" }}>
                  <Input
                    addonBefore="QR code"
                    value={qrCode}
                    onChange={(e) => setQrCode(e.target.value)}
                    placeholder={getAdhubQrCode()}
                  />
                  <AdHubWatchEmbed code={qrCode.trim() || getAdhubQrCode()} showIframe={false} />
                </Space>
              </Card>
            )
          },
          {
            key: "advertiser",
            label: "广告商",
            disabled: !tokenReady,
            children: (
              <Space direction="vertical" style={{ width: "100%" }} size={16}>
                <Card title="发布 30 秒推广">
                  <Space direction="vertical" style={{ width: "100%" }}>
                    <Input value={campaignTitle} onChange={(e) => setCampaignTitle(e.target.value)} placeholder="广告标题" />
                    <Button type="primary" loading={loading} onClick={publishCampaign}>
                      发布到广场
                    </Button>
                  </Space>
                </Card>
                <Card title="推广状态（3 秒刷新）">
                  {stats ? (
                    <Row gutter={16}>
                      <Col span={6}><Statistic title="总观看" value={stats.viewsTotal} /></Col>
                      <Col span={6}><Statistic title="有效" value={stats.viewsValid} /></Col>
                      <Col span={6}><Statistic title="可疑" value={stats.viewsSuspicious} /></Col>
                      <Col span={6}><Statistic title="挂载二维码" value={stats.linkedQrCount} /></Col>
                    </Row>
                  ) : (
                    <Typography.Text type="secondary">选择下方广告查看实时推广数据</Typography.Text>
                  )}
                  <Table
                    style={{ marginTop: 16 }}
                    size="small"
                    rowKey="id"
                    dataSource={campaigns}
                    pagination={false}
                    columns={[
                      { title: "标题", dataIndex: "title" },
                      { title: "时长", dataIndex: "durationSec", render: (v) => `${v}s` },
                      { title: "有效观看", dataIndex: "viewsValid" },
                      {
                        title: "操作",
                        render: (_, row) => (
                          <Button size="small" onClick={() => loadStats(row.id)}>
                            查看推广
                          </Button>
                        )
                      }
                    ]}
                  />
                  {stats?.recentEvents?.length ? (
                    <Table
                      style={{ marginTop: 16 }}
                      size="small"
                      rowKey="id"
                      dataSource={stats.recentEvents}
                      pagination={false}
                      columns={[
                        { title: "二维码", dataIndex: "qrCode" },
                        { title: "收益预览", dataIndex: "publisherRewardPoints" },
                        { title: "可疑", dataIndex: "suspicious", render: (v) => (v ? "是" : "否") },
                        { title: "时间", dataIndex: "createdAt" }
                      ]}
                    />
                  ) : null}
                </Card>
              </Space>
            )
          },
          {
            key: "publisher",
            label: "流量主",
            disabled: !tokenReady,
            children: (
              <Space direction="vertical" style={{ width: "100%" }} size={16}>
                <Card title="广场广告 · 加单到二维码">
                  <Table
                    size="small"
                    rowKey="id"
                    dataSource={campaigns}
                    pagination={false}
                    columns={[
                      { title: "标题", dataIndex: "title" },
                      { title: "时长", dataIndex: "durationSec", render: (v) => `${v}s` },
                      { title: "收益预览", dataIndex: "publisherRewardPoints" },
                      {
                        title: "操作",
                        render: (_, row) => (
                          <Button size="small" loading={loading} onClick={() => attachCampaign(row.id)}>
                            加单
                          </Button>
                        )
                      }
                    ]}
                  />
                </Card>
                <Card title="已挂载 & 收益预览">
                  {revenue ? (
                    <Row gutter={16}>
                      <Col span={8}><Statistic title="近7天有效观看" value={revenue.validViews} /></Col>
                      <Col span={8}><Statistic title="累计收益预览" value={revenue.totalRewardPoints} suffix="字" /></Col>
                      <Col span={8}><Statistic title="可疑观看" value={revenue.suspiciousViews} /></Col>
                    </Row>
                  ) : (
                    <Typography.Text type="secondary">需小程序实名账号 token，或流量主测试身份且已生成二维码</Typography.Text>
                  )}
                  {linked.length ? (
                    <ul style={{ marginTop: 12 }}>
                      {linked.map((c) => (
                        <li key={c.id}>{c.title} · {c.durationSec}s · {c.publisherRewardPoints} 字</li>
                      ))}
                    </ul>
                  ) : null}
                  <Button style={{ marginTop: 12 }} onClick={() => refreshPublisher()}>
                    刷新
                  </Button>
                </Card>
              </Space>
            )
          }
        ]}
      />
    </Space>
  );
};

export default AdHubPromoPage;
