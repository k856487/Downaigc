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
}

const TaskTable: React.FC<TaskTableProps> = ({ data, onView }) => {
  const rows =
    data ??
    [
      {
        id: "demo-1",
        name: "示例任务",
        type: "polish" as const,
        paragraphs: 3,
        status: "done" as const,
        createdAt: "2026-03-14 10:00"
      }
    ];

  return (
    <Table
      rowKey="id"
      size="small"
      dataSource={rows}
      pagination={false}
      columns={[
        { title: "任务名称", dataIndex: "name" },
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

