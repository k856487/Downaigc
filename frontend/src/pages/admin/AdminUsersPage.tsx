import React from "react";
import { App, Button, Card, Popconfirm, Segmented, Space, Table, Tabs, Tag, Typography } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { apiRequest } from "../../api/client";

export type UserSegment =
  | "normal"
  | "vip_week"
  | "vip_month"
  | "vip_season"
  | "vip_year"
  | "vip_lifetime"
  | "banned"
  | "over_quota";

type OverviewUser = {
  id: string;
  email: string;
  nickname: string;
  isBanned: boolean;
  isAdmin?: boolean;
  adViews: number;
  points: number;
  wordsQuota: number;
  wordsUsed: number;
  remainingQuota: number;
  monthlyActive: boolean;
  createdAt: string;
  userSegment: UserSegment;
};

type OverviewResponse = {
  users: OverviewUser[];
};

type MainTab = "all" | "normal" | "vip" | "banned" | "over_quota";
type VipSub = "all" | UserSegment;

const SEGMENT_META: Record<
  UserSegment,
  { label: string; color: string; hint?: string }
> = {
  normal: { label: "普通用户", color: "default" },
  vip_week: { label: "VIP·入门", color: "cyan", hint: "额度高于默认免费档" },
  vip_month: { label: "VIP·月度档", color: "blue" },
  vip_season: { label: "VIP·季度档", color: "geekblue" },
  vip_year: { label: "VIP·年卡档", color: "purple" },
  vip_lifetime: { label: "VIP·终身档", color: "gold" },
  banned: { label: "已封禁", color: "error" },
  over_quota: { label: "额度超限", color: "volcano", hint: "用量大于分配额度，建议核查" }
};

const VIP_SEGMENTS: UserSegment[] = [
  "vip_week",
  "vip_month",
  "vip_season",
  "vip_year",
  "vip_lifetime"
];

function isVipSegment(s: UserSegment): boolean {
  return VIP_SEGMENTS.includes(s);
}

const AdminUsersPage: React.FC = () => {
  const { message } = App.useApp();
  const [users, setUsers] = React.useState<OverviewUser[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [mainTab, setMainTab] = React.useState<MainTab>("all");
  const [vipSub, setVipSub] = React.useState<VipSub>("all");
  const [scrollY, setScrollY] = React.useState(420);

  const reload = React.useCallback(() => {
    setLoading(true);
    apiRequest<OverviewResponse>("/api/admin/overview", { method: "GET" })
      .then((d) => setUsers(d.users ?? []))
      .catch((e: { detail?: string }) =>
        message.error(e?.detail === "Admin access denied" ? "无管理员权限" : "加载用户列表失败")
      )
      .finally(() => setLoading(false));
  }, [message]);

  React.useEffect(() => {
    reload();
  }, [reload]);

  React.useLayoutEffect(() => {
    const measure = () => {
      setScrollY(Math.max(280, window.innerHeight - 320));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const toggleBan = React.useCallback(
    async (row: OverviewUser) => {
      const path = row.isBanned ? `/api/admin/users/${row.id}/unban` : `/api/admin/users/${row.id}/ban`;
      await apiRequest(path, { method: "POST" });
      message.success(row.isBanned ? "已解封用户" : "已封禁用户");
      reload();
    },
    [message, reload]
  );

  const removeUser = React.useCallback(
    async (row: OverviewUser) => {
      await apiRequest(`/api/admin/users/${row.id}`, { method: "DELETE" });
      message.success("账号已删除");
      reload();
    },
    [message, reload]
  );

  const counts = React.useMemo(() => {
    const c: Record<MainTab, number> = {
      all: users.length,
      normal: 0,
      vip: 0,
      banned: 0,
      over_quota: 0
    };
    const vipBy: Record<string, number> = {};
    for (const s of VIP_SEGMENTS) vipBy[s] = 0;
    for (const u of users) {
      const seg = (u.userSegment || "normal") as UserSegment;
      if (seg === "normal") c.normal += 1;
      if (isVipSegment(seg)) {
        c.vip += 1;
        vipBy[seg] = (vipBy[seg] || 0) + 1;
      }
      if (seg === "banned") c.banned += 1;
      if (seg === "over_quota") c.over_quota += 1;
    }
    vipBy.all = c.vip;
    return { main: c, vipBy };
  }, [users]);

  const filteredUsers = React.useMemo(() => {
    return users.filter((u) => {
      const seg = (u.userSegment || "normal") as UserSegment;
      if (mainTab === "all") return true;
      if (mainTab === "normal") return seg === "normal";
      if (mainTab === "banned") return seg === "banned";
      if (mainTab === "over_quota") return seg === "over_quota";
      if (mainTab === "vip") {
        if (!isVipSegment(seg)) return false;
        if (vipSub === "all") return true;
        return seg === vipSub;
      }
      return true;
    });
  }, [users, mainTab, vipSub]);

  const columns = [
    { title: "邮箱", dataIndex: "email", key: "email", width: 196, render: (v: string, row: OverviewUser) => (
        <Space size={6}>
          <span>{v}</span>
          {row.isAdmin ? <Tag color="blue">管理员</Tag> : null}
        </Space>
      ) },
    { title: "昵称", dataIndex: "nickname", key: "nickname", width: 96 },
    {
      title: "分类",
      dataIndex: "userSegment",
      key: "userSegment",
      width: 128,
      render: (seg: UserSegment) => {
        const m = SEGMENT_META[seg] || SEGMENT_META.normal;
        return (
          <Tag color={m.color} title={m.hint}>
            {m.label}
          </Tag>
        );
      }
    },
    {
      title: "注册时间",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 164,
      render: (v: string) => (v ? new Date(v).toLocaleString() : "-")
    },
    {
      title: "改写字数",
      dataIndex: "points",
      key: "points",
      width: 80,
      render: (v: number) => v.toLocaleString()
    },
    {
      title: "看广完成",
      dataIndex: "adViews",
      key: "adViews",
      width: 96,
      render: (v: number) => v.toLocaleString()
    },
    {
      title: "字数用量",
      key: "quota",
      width: 156,
      render: (_: unknown, row: OverviewUser) =>
        `${row.wordsUsed.toLocaleString()} / ${row.wordsQuota.toLocaleString()}`
    },
    {
      title: "剩余额度",
      dataIndex: "remainingQuota",
      key: "remainingQuota",
      width: 100,
      render: (v: number) => v.toLocaleString()
    },
    {
      title: "月活",
      key: "monthlyActive",
      width: 80,
      render: (_: unknown, row: OverviewUser) =>
        row.monthlyActive ? <Tag color="success">活跃</Tag> : <Tag>未活跃</Tag>
    },
    {
      title: "账号状态",
      key: "isBanned",
      width: 88,
      render: (_: unknown, row: OverviewUser) =>
        row.isBanned ? <Tag color="error">已封禁</Tag> : <Tag color="success">正常</Tag>
    },
    {
      title: "操作",
      key: "actions",
      width: 188,
      fixed: "right" as const,
      render: (_: unknown, row: OverviewUser) =>
        row.isAdmin ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            管理员受保护
          </Typography.Text>
        ) : (
          <Space size={8}>
            <Popconfirm
              title={row.isBanned ? "确认解封此账号？" : "确认封禁此账号？"}
              onConfirm={() => {
                toggleBan(row).catch((e: { detail?: string }) => message.error(e?.detail || "操作失败，请重试"));
              }}
            >
              <Button size="small">{row.isBanned ? "解封" : "封号"}</Button>
            </Popconfirm>
            <Popconfirm
              title="确认删除此账号？该操作不可恢复"
              okButtonProps={{ danger: true }}
              onConfirm={() => {
                removeUser(row).catch((e: { detail?: string }) =>
                  message.error(e?.detail || "删除失败，请重试")
                );
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

  const tabItems = [
    { key: "all" as const, label: `全部 (${counts.main.all})` },
    { key: "normal" as const, label: `普通用户 (${counts.main.normal})` },
    { key: "vip" as const, label: `VIP 用户 (${counts.main.vip})` },
    { key: "banned" as const, label: `已封禁 (${counts.main.banned})` },
    { key: "over_quota" as const, label: `额度超限 (${counts.main.over_quota})` }
  ];

  const vipSegOptions = [
    { label: `全部 (${counts.vipBy.all})`, value: "all" },
    { label: `入门 (${counts.vipBy.vip_week ?? 0})`, value: "vip_week" },
    { label: `月度 (${counts.vipBy.vip_month ?? 0})`, value: "vip_month" },
    { label: `季度 (${counts.vipBy.vip_season ?? 0})`, value: "vip_season" },
    { label: `年卡 (${counts.vipBy.vip_year ?? 0})`, value: "vip_year" },
    { label: `终身 (${counts.vipBy.vip_lifetime ?? 0})`, value: "vip_lifetime" }
  ];

  return (
    <div className="admin-users-page">
      <Space direction="vertical" size={12} style={{ width: "100%", flexShrink: 0 }}>
        <Space align="start" style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <div>
            <Typography.Title level={4} style={{ margin: 0 }}>
              用户列表
            </Typography.Title>
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              分类规则：已封禁 / 用量大于分配额度为风险；VIP
              按字数额度高于默认免费档（12 万）分档，便于与运营调额对齐。表格区域固定高度，内部滚动。
            </Typography.Text>
          </div>
          <Button icon={<ReloadOutlined />} onClick={() => reload()} loading={loading}>
            刷新
          </Button>
        </Space>
      </Space>

      <Card className="admin-users-page__card console-stagger-item console-stagger-item--2" style={{ marginTop: 8 }}>
        <Tabs
          className="admin-users-page__tabs"
          activeKey={mainTab}
          onChange={(k) => {
            setMainTab(k as MainTab);
            if (k !== "vip") setVipSub("all");
          }}
          items={tabItems.map((t) => ({ key: t.key, label: t.label }))}
        />
        {mainTab === "vip" ? (
          <Segmented
            className="admin-users-page__vip-seg"
            value={vipSub}
            onChange={(v) => setVipSub(v as VipSub)}
            options={vipSegOptions}
          />
        ) : null}
        <div className="admin-users-page__table-wrap">
          <Table
            rowKey="id"
            loading={loading}
            columns={columns}
            dataSource={filteredUsers}
            pagination={{
              pageSize: 10,
              showSizeChanger: true,
              showTotal: (t, range) => `第 ${range[0]}-${range[1]} 条 / 共 ${t} 条（全量 ${users.length}）`
            }}
            scroll={{ x: 1320, y: scrollY }}
          />
        </div>
      </Card>
    </div>
  );
};

export default AdminUsersPage;
