import React from "react";
import { App, Button, Card, Col, Row, Space, Statistic, Typography } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../../api/client";
import SimpleLineChart from "../../components/admin/SimpleLineChart";

type OverviewResponse = {
  userCount: number;
  monthlyActiveUsers: number;
  totalAdViews: number;
  totalWordsQuota: number;
  usedWordsQuota: number;
  openFeedbackCount: number;
  totalTasksCount: number;
  dailyMetrics: Array<{
    date: string;
    activeUsers: number;
    adViews: number;
    wordsUsed: number;
  }>;
};

const AdminDashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [data, setData] = React.useState<OverviewResponse | null>(null);
  const [loading, setLoading] = React.useState(false);

  const reload = React.useCallback(() => {
    setLoading(true);
    apiRequest<OverviewResponse>("/api/admin/overview", { method: "GET" })
      .then(setData)
      .catch((e: { detail?: string }) =>
        message.error(e?.detail === "Admin access denied" ? "无管理员权限（请配置 ADMIN_EMAILS 与登录邮箱一致）" : "加载管理员统计失败")
      )
      .finally(() => setLoading(false));
  }, [message]);

  React.useEffect(() => {
    reload();
  }, [reload]);

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <div className="console-stagger-item console-stagger-item--1">
        <Row justify="space-between" align="middle" style={{ marginBottom: 4 }} gutter={[8, 8]}>
          <Col flex="1 1 280px">
            <Typography.Title level={4} style={{ margin: 0 }}>
              管理概览
            </Typography.Title>
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              看广次数来自已完成扫码广告票据；月活含近 30 天内有任务或完成看广的用户。账号与封禁请前往{" "}
              <Typography.Link onClick={() => navigate("/admin/users")}>用户列表</Typography.Link>。
            </Typography.Text>
          </Col>
          <Col>
            <Space>
              <Button onClick={() => navigate("/admin/users")}>用户列表</Button>
              <Button icon={<ReloadOutlined />} onClick={() => reload()} loading={loading}>
                刷新数据
              </Button>
            </Space>
          </Col>
        </Row>
        <Row gutter={[12, 12]}>
          <Col xs={24} sm={12} lg={8}>
            <Card>
              <Statistic title="用户总数" value={data?.userCount ?? 0} />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={8}>
            <Card>
              <Statistic title="月活用户数" value={data?.monthlyActiveUsers ?? 0} />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={8}>
            <Card>
              <Statistic title="累计看广完成次数" value={data?.totalAdViews ?? 0} />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={8}>
            <Card>
              <Statistic
                title="字数额度使用率"
                value={
                  data?.totalWordsQuota
                    ? Number(((data.usedWordsQuota / data.totalWordsQuota) * 100).toFixed(2))
                    : 0
                }
                suffix="%"
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={8}>
            <Card>
              <Statistic title="待处理反馈" value={data?.openFeedbackCount ?? 0} valueStyle={{ color: "#d97706" }} />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={8}>
            <Card>
              <Statistic title="任务总数" value={data?.totalTasksCount ?? 0} />
            </Card>
          </Col>
        </Row>
      </div>

      <div className="console-stagger-item console-stagger-item--2">
        <Row gutter={[12, 12]}>
          <Col xs={24} lg={8}>
            <Card>
              <SimpleLineChart
                title="近30天活跃用户数（按日）"
                data={(data?.dailyMetrics ?? []).map((d) => ({
                  label: d.date,
                  value: d.activeUsers
                }))}
              />
            </Card>
          </Col>
          <Col xs={24} lg={8}>
            <Card>
              <SimpleLineChart
                title="近30天看广完成次数（按日）"
                stroke="#8b5cf6"
                data={(data?.dailyMetrics ?? []).map((d) => ({
                  label: d.date,
                  value: d.adViews
                }))}
              />
            </Card>
          </Col>
          <Col xs={24} lg={8}>
            <Card>
              <SimpleLineChart
                title="近30天润色字数（按日）"
                stroke="#059669"
                data={(data?.dailyMetrics ?? []).map((d) => ({
                  label: d.date,
                  value: d.wordsUsed
                }))}
              />
            </Card>
          </Col>
        </Row>
      </div>
    </Space>
  );
};

export default AdminDashboardPage;
