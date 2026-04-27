import React from "react";
import { Card, Space, Typography } from "antd";
import TaskTable from "../components/TaskTable";

const HistoryPage: React.FC = () => {
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <div className="console-stagger-item console-stagger-item--1">
        <Card>
          <Typography.Text type="secondary">
            这里展示所有历史任务记录，当前为静态示例数据，后续可接入真实 API。
          </Typography.Text>
        </Card>
      </div>
      <div className="console-stagger-item console-stagger-item--2">
        <Card>
          <TaskTable />
        </Card>
      </div>
    </Space>
  );
};

export default HistoryPage;

