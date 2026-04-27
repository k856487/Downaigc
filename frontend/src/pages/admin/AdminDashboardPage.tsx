import React from "react";
import { App, Button, Card, Col, Popconfirm, Row, Space, Statistic, Table, Tag } from "antd";
import { apiRequest } from "../../api/client";
import SimpleLineChart from "../../components/admin/SimpleLineChart";

type OverviewResponse = {
  userCount: number;
  monthlyActiveUsers: number;
  totalAdViews: number;
  totalWordsQuota: number;
  usedWordsQuota: number;
  dailyMetrics: Array<{
    date: string;
    activeUsers: number;
    adViews: number;
    wordsUsed: number;
  }>;
  users: Array<{
    id: string;
    email: string;
    nickname: string;
    isBanned: boolean;
    adViews: number;
    wordsQuota: number;
    wordsUsed: number;
    remainingQuota: number;
    monthlyActive: boolean;
  }>;
};

const AdminDashboardPage: React.FC = () => {
  const { message } = App.useApp();
  const [data, setData] = React.useState<OverviewResponse | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    setLoading(true);
    apiRequest<OverviewResponse>("/api/admin/overview", { method: "GET" })
      .then(setData)
      .catch(() => message.error("加载管理员统计失败"))
      .finally(() => setLoading(false));
  }, [message]);

  const reload = React.useCallback(() => {
    setLoading(true);
    apiRequest<OverviewResponse>("/api/admin/overview", { method: "GET" })
      .then(setData)
      .catch(() => message.error("加载管理员统计失败"))
      .finally(() => setLoading(false));
  }, [message]);

  const toggleBan = React.useCallback(
    async (row: OverviewResponse["users"][number]) => {
      const path = row.isBanned
        ? `/api/admin/users/${row.id}/unban`
        : `/api/admin/users/${row.id}/ban`;
      await apiRequest(path, { method: "POST" });
      message.success(row.isBanned ? "已解封用户" : "已封禁用户");
      reload();
    },
    [message, reload]
  );

  const removeUser = React.useCallback(
    async (row: OverviewResponse["users"][number]) => {
      await apiRequest(`/api/admin/users/${row.id}`, { method: "DELETE" });
      message.success("账号已删除");
      reload();
    },
    [message, reload]
  );

  const userColumns = [
    { title: "邮箱", dataIndex: "email", key: "email", width: 220 },
    { title: "昵称", dataIndex: "nickname", key: "nickname", width: 120 },
    { title: "看广次数", dataIndex: "adViews", key: "adViews", width: 110 },
    {
      title: "额度使用",
      key: "quota",
      width: 170,
      render: (_: unknown, row: OverviewResponse["users"][number]) =>
        `${row.wordsUsed.toLocaleString()} / ${row.wordsQuota.toLocaleString()}`
    },
    {
      title: "剩余额度",
      dataIndex: "remainingQuota",
      key: "remainingQuota",
      width: 120,
      render: (v: number) => v.toLocaleString()
    },
    {
      title: "月活",
      key: "monthlyActive",
      width: 90,
      render: (_: unknown, row: OverviewResponse["users"][number]) =>
        row.monthlyActive ? <Tag color="success">活跃</Tag> : <Tag>未活跃</Tag>
    },
    {
      title: "账号状态",
      key: "isBanned",
      width: 100,
      render: (_: unknown, row: OverviewResponse["users"][number]) =>
        row.isBanned ? <Tag color="error">已封禁</Tag> : <Tag color="success">正常</Tag>
    },
    {
      title: "操作",
      key: "actions",
      width: 220,
      render: (_: unknown, row: OverviewResponse["users"][number]) => (
        <Space size={8}>
          <Popconfirm
            title={row.isBanned ? "确认解封此账号？" : "确认封禁此账号？"}
            onConfirm={() => {
              toggleBan(row).catch(() => message.error("操作失败，请重试"));
            }}
          >
            <Button size="small">{row.isBanned ? "解封" : "封号"}</Button>
          </Popconfirm>
          <Popconfirm
            title="确认删除此账号？该操作不可恢复"
            okButtonProps={{ danger: true }}
            onConfirm={() => {
              removeUser(row).catch(() => message.error("删除失败，请重试"));
            }}
          >
            <Button size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <div className="console-stagger-item console-stagger-item--1">
        <Row gutter={[12, 12]}>
          <Col xs={24} md={12} lg={6}>
            <Card>
              <Statistic title="用户总数" value={data?.userCount ?? 0} />
            </Card>
          </Col>
          <Col xs={24} md={12} lg={6}>
            <Card>
              <Statistic title="月活用户数" value={data?.monthlyActiveUsers ?? 0} />
            </Card>
          </Col>
          <Col xs={24} md={12} lg={6}>
            <Card>
              <Statistic title="累计看广次数" value={data?.totalAdViews ?? 0} />
            </Card>
          </Col>
          <Col xs={24} md={12} lg={6}>
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
        </Row>
      </div>

      <div className="console-stagger-item console-stagger-item--2">
        <Row gutter={[12, 12]}>
          <Col xs={24} lg={12}>
            <Card>
              <SimpleLineChart
                title="近30天月活趋势（按日活跃用户）"
                data={(data?.dailyMetrics ?? []).map((d) => ({
                  label: d.date,
                  value: d.activeUsers
                }))}
              />
            </Card>
          </Col>
          <Col xs={24} lg={12}>
            <Card>
              <SimpleLineChart
                title="近30天看广次数趋势"
                stroke="#8b5cf6"
                data={(data?.dailyMetrics ?? []).map((d) => ({
                  label: d.date,
                  value: d.adViews
                }))}
              />
            </Card>
          </Col>
        </Row>
      </div>

      <div className="console-stagger-item console-stagger-item--3">
        <Card title="用户统计表">
          <Table
            rowKey="id"
            loading={loading}
            columns={userColumns}
            dataSource={data?.users ?? []}
            pagination={{ pageSize: 10 }}
            scroll={{ x: 860 }}
          />
        </Card>
      </div>
    </Space>
  );
};

export default AdminDashboardPage;

