import React from "react";
import type { ColumnsType } from "antd/es/table";
import {
  App,
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Radio,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography
} from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { apiRequest } from "../../api/client";

type RedeemEffectiveStatus = "active" | "disabled" | "expired" | "depleted";

type RedeemRow = {
  id: string;
  code: string;
  rewardKind: "points" | "balance_yuan";
  amountPoints: number | null;
  amountBalanceYuan: number | null;
  scope: "all" | "single";
  restrictUserId: string | null;
  restrictEmail: string | null;
  maxUses: number;
  useCount: number;
  expiresAt: string | null;
  createdAt: string;
  disabled: boolean;
  /** 服务端按停用 / 过期 / 用尽 综合判定，与兑换接口一致 */
  effectiveStatus?: RedeemEffectiveStatus;
};

function redeemStatusHint(s: RedeemEffectiveStatus): string {
  switch (s) {
    case "active":
      return "当前可兑换（未停用、未过期且仍有剩余次数）";
    case "disabled":
      return "管理员已停用，用户无法兑换";
    case "expired":
      return "已超过过期时间，用户无法兑换";
    case "depleted":
      return "总兑换次数已用尽，用户无法兑换";
    default:
      return "";
  }
}

function RedeemStatusTag({ status }: { status: RedeemEffectiveStatus | undefined }) {
  const s = status ?? "active";
  const tag =
    s === "active" ? (
      <Tag color="success">可用</Tag>
    ) : s === "disabled" ? (
      <Tag color="default">停用</Tag>
    ) : s === "expired" ? (
      <Tag color="warning">已过期</Tag>
    ) : (
      <Tag color="volcano">已用尽</Tag>
    );
  const title = redeemStatusHint(s);
  return title ? <Tooltip title={title}>{tag}</Tooltip> : tag;
}

type FormValues = {
  rewardKind: "points" | "balance_yuan";
  amount: number;
  scope: "all" | "single";
  restrictEmail?: string;
  maxUses: number;
  expiresAt?: { toISOString: () => string } | null;
  quantity: number;
};

const AdminRedeemCodesPage: React.FC = () => {
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  const [rows, setRows] = React.useState<RedeemRow[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(12);
  const [loading, setLoading] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const scope = Form.useWatch("scope", form);

  const genFormColumns: ColumnsType<{ key: string }> = React.useMemo(
    () => [
      {
        title: "类型",
        key: "rewardKind",
        width: 168,
        render: () => (
          <Form.Item name="rewardKind" rules={[{ required: true }]} style={{ marginBottom: 0 }}>
            <Radio.Group
              size="small"
              optionType="button"
              options={[
                { value: "points", label: "改写字数" },
                { value: "balance_yuan", label: "金币（元）" }
              ]}
            />
          </Form.Item>
        )
      },
      {
        title: "数量",
        key: "amount",
        width: 132,
        render: () => (
          <Form.Item noStyle shouldUpdate={(p, c) => p.rewardKind !== c.rewardKind}>
            {() => {
              const rk = form.getFieldValue("rewardKind") as FormValues["rewardKind"];
              return rk === "balance_yuan" ? (
                <Form.Item
                  name="amount"
                  rules={[{ required: true, type: "number", min: 0.01, max: 1_000_000 }]}
                  style={{ marginBottom: 0 }}
                >
                  <InputNumber size="small" style={{ width: "100%" }} min={0.01} step={0.01} precision={2} />
                </Form.Item>
              ) : (
                <Form.Item
                  name="amount"
                  rules={[{ required: true, type: "number", min: 1, max: 10_000_000 }]}
                  style={{ marginBottom: 0 }}
                >
                  <InputNumber size="small" style={{ width: "100%" }} min={1} step={1} precision={0} />
                </Form.Item>
              );
            }}
          </Form.Item>
        )
      },
      {
        title: "适用范围",
        key: "scope",
        width: 200,
        render: () => (
          <Form.Item name="scope" rules={[{ required: true }]} style={{ marginBottom: 0 }}>
            <Radio.Group
              size="small"
              optionType="button"
              options={[
                { value: "all", label: "全部用户" },
                { value: "single", label: "单用户" }
              ]}
            />
          </Form.Item>
        )
      },
      {
        title: "用户邮箱",
        key: "restrictEmail",
        width: 200,
        render: () => (
          <Form.Item
            name="restrictEmail"
            rules={
              scope === "single"
                ? [{ required: true, type: "email", message: "请输入有效邮箱" }]
                : []
            }
            style={{ marginBottom: 0 }}
          >
            <Input
              size="small"
              disabled={scope !== "single"}
              placeholder={scope === "single" ? "已注册用户的邮箱" : "选「单用户」后填写"}
            />
          </Form.Item>
        )
      },
      {
        title: "总可兑换次数",
        key: "maxUses",
        width: 120,
        render: () => (
          <Form.Item name="maxUses" rules={[{ required: true, type: "number", min: 1 }]} style={{ marginBottom: 0 }}>
            <InputNumber size="small" style={{ width: "100%" }} min={1} max={10_000_000} />
          </Form.Item>
        )
      },
      {
        title: "一次生成条数",
        key: "quantity",
        width: 120,
        render: () => (
          <Form.Item name="quantity" rules={[{ required: true, type: "number", min: 1 }]} style={{ marginBottom: 0 }}>
            <InputNumber size="small" style={{ width: "100%" }} min={1} max={100} />
          </Form.Item>
        )
      },
      {
        title: "过期时间（可选）",
        key: "expiresAt",
        width: 200,
        render: () => (
          <Form.Item name="expiresAt" style={{ marginBottom: 0 }}>
            <DatePicker showTime size="small" style={{ width: "100%" }} />
          </Form.Item>
        )
      },
      {
        title: "操作",
        key: "action",
        width: 96,
        fixed: "right",
        render: () => (
          <Button type="primary" size="small" htmlType="submit" loading={submitting}>
            生成
          </Button>
        )
      }
    ],
    [form, scope, submitting]
  );

  const loadRows = React.useCallback(
    (override?: { page?: number; pageSize?: number }) => {
      const p = override?.page ?? page;
      const ps = override?.pageSize ?? pageSize;
      setLoading(true);
      const q = new URLSearchParams({
        page: String(p),
        pageSize: String(ps)
      });
      apiRequest<{ items: RedeemRow[]; total: number }>(`/api/admin/redeem-codes?${q.toString()}`, { method: "GET" })
        .then((res) => {
          setRows(res.items ?? []);
          setTotal(Number(res.total) || 0);
        })
        .catch((e: { detail?: string }) =>
          message.error(e?.detail === "Admin access denied" ? "无管理员权限" : "加载兑换码失败")
        )
        .finally(() => setLoading(false));
    },
    [message, page, pageSize]
  );

  React.useEffect(() => {
    loadRows();
  }, [loadRows]);

  const onCreate = async (v: FormValues) => {
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        rewardKind: v.rewardKind,
        amount: v.amount,
        scope: v.scope,
        maxUses: v.maxUses,
        quantity: v.quantity
      };
      if (v.scope === "single") {
        const em = (v.restrictEmail || "").trim();
        if (!em) {
          message.warning("指定用户时请填写用户邮箱");
          return;
        }
        payload.restrictEmail = em.toLowerCase();
      }
      if (v.expiresAt && typeof v.expiresAt.toISOString === "function") {
        payload.expiresAt = v.expiresAt.toISOString();
      }
      const res = await apiRequest<{ codes: RedeemRow[] }>("/api/admin/redeem-codes", {
        method: "POST",
        json: payload
      });
      message.success(`已生成 ${res.codes?.length ?? 0} 个兑换码`);
      form.resetFields();
      form.setFieldsValue({
        rewardKind: "points",
        scope: "all",
        maxUses: 1,
        quantity: 1
      });
      setPage(1);
      loadRows({ page: 1, pageSize });
    } catch (e: unknown) {
      const d = typeof e === "object" && e && "detail" in e ? String((e as { detail?: string }).detail) : "";
      message.error(d || "生成失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <div className="console-stagger-item console-stagger-item--1">
        <Typography.Title level={4} style={{ margin: 0 }}>
          兑换码生成
        </Typography.Title>
        <Typography.Text type="secondary" style={{ fontSize: 13 }}>
          改写字数类型写入服务端改写字数；金币类型增加账户余额（与顶栏「¥」一致）。全站码需设置总可兑换次数；单用户码默认每人仅可用一次。
        </Typography.Text>
      </div>

      <div className="console-stagger-item console-stagger-item--2">
        <Card title="生成新码" styles={{ body: { padding: 0 } }}>
          <Form<FormValues>
            form={form}
            initialValues={{
              rewardKind: "points",
              scope: "all",
              maxUses: 1,
              quantity: 1,
              amount: 100
            }}
            onFinish={onCreate}
          >
            <Table<{ key: string }>
              className="admin-redeem-gen-form-table"
              rowKey="key"
              dataSource={[{ key: "gen-row" }]}
              columns={genFormColumns}
              pagination={false}
              bordered
              size="middle"
              scroll={{ x: "max-content" }}
            />
          </Form>
        </Card>
      </div>

      <div className="console-stagger-item console-stagger-item--3">
        <Card
          title="已生成兑换码"
            extra={
            <Button icon={<ReloadOutlined />} onClick={() => loadRows()} loading={loading}>
              刷新
            </Button>
          }
        >
          <Table<RedeemRow>
            rowKey="id"
            loading={loading}
            dataSource={rows}
            pagination={{
              current: page,
              pageSize,
              total,
              showSizeChanger: true,
              pageSizeOptions: [12, 24, 48, 100],
              showTotal: (t, range) => `${range[0]}-${range[1]} 共 ${t} 条`,
              onChange: (p, ps) => {
                setPage(p);
                setPageSize(ps);
              }
            }}
            scroll={{ x: 1100 }}
            columns={[
              {
                title: "兑换码",
                dataIndex: "code",
                width: 160,
                render: (c: string) => (
                  <Typography.Text copyable code>
                    {c}
                  </Typography.Text>
                )
              },
              {
                title: "类型",
                dataIndex: "rewardKind",
                width: 100,
                render: (k: string) =>
                  k === "balance_yuan" ? <Tag color="gold">金币</Tag> : <Tag color="blue">改写字数</Tag>
              },
              {
                title: "面额",
                key: "amt",
                width: 120,
                render: (_: unknown, r: RedeemRow) =>
                  r.rewardKind === "points"
                    ? `${(r.amountPoints ?? 0).toLocaleString()} 字`
                    : `¥ ${(r.amountBalanceYuan ?? 0).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}`
              },
              {
                title: "范围",
                dataIndex: "scope",
                width: 110,
                render: (s: string) => (s === "all" ? <Tag>全站</Tag> : <Tag color="purple">单用户</Tag>)
              },
              {
                title: "限定邮箱",
                dataIndex: "restrictEmail",
                width: 200,
                render: (v: string | null) => v || "-"
              },
              {
                title: "已用/上限",
                key: "uses",
                width: 110,
                render: (_: unknown, r: RedeemRow) => `${r.useCount} / ${r.maxUses}`
              },
              {
                title: "过期",
                dataIndex: "expiresAt",
                width: 168,
                render: (v: string | null) => (v ? new Date(v).toLocaleString() : "-")
              },
              {
                title: "创建时间",
                dataIndex: "createdAt",
                width: 168,
                render: (v: string) => new Date(v).toLocaleString()
              },
              {
                title: "状态",
                key: "effectiveStatus",
                width: 100,
                render: (_: unknown, r: RedeemRow) => <RedeemStatusTag status={r.effectiveStatus} />
              }
            ]}
          />
        </Card>
      </div>

      <Typography.Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 12 }}>
        用户侧在「改写字数」页可输入兑换码领取；单用户码仅限绑定邮箱的账号；全站码在总次数用尽前可被不同用户各用一次（每人每码一次）。
      </Typography.Paragraph>
    </Space>
  );
};

export default AdminRedeemCodesPage;
