import React from "react";
import { Table, Tag } from "antd";

export interface TaskRow {
  id: string;
  name: string;
  type: "polish" | "reduce";
  paragraphs: number;
  status: "pending" | "running" | "done";
  createdAt: string;
}

interface TaskTableProps {
  data?: TaskRow[];
  onView?: (id: string) => void;
  /** 为 true 时 data 视为已请求结果（可为空数组），不再回退到内置示例行 */
  loading?: boolean;
}

const TaskTable: React.FC<TaskTableProps> = ({ data, onView, loading }) => {
  const demoRows: TaskRow[] = [
    {
      id: "demo-1",
      name: "示例任务",
      type: "polish",
      paragraphs: 3,
      status: "done",
      createdAt: "2026-03-14 10:00"
    }
  ];
  const rows = loading || data !== undefined ? (data ?? []) : demoRows;

  return (
    <Table
      rowKey="id"
      size="small"
      dataSource={rows}
      loading={!!loading}
      pagination={false}
      tableLayout="fixed"
      scroll={{ x: "max-content" }}
      columns={[
        {
          title: "任务名称",
          dataIndex: "name",
          ellipsis: true,
          width: "36%"
        },
        {
          title: "类型",
          dataIndex: "type",
          render: (value: TaskRow["type"]) =>
            value === "polish" ? "论文优化" : "降AIGC"
        },
        { title: "段落数", dataIndex: "paragraphs", width: 80 },
        {
          title: "状态",
          dataIndex: "status",
          width: 100,
          render: (value: TaskRow["status"]) => {
            if (value === "done") return <Tag color="green">已完成</Tag>;
            if (value === "running") return <Tag color="blue">进行中</Tag>;
            return <Tag>待开始</Tag>;
          }
        },
        { title: "创建时间", dataIndex: "createdAt", width: 180 },
        {
          title: "操作",
          width: 100,
          render: (_, record: TaskRow) => (
            <a onClick={() => onView?.(record.id)}>查看</a>
          )
        }
      ]}
    />
  );
};

export default TaskTable;

