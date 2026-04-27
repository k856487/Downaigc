import React from "react";
import { Card, Form, Input, Space, Typography } from "antd";
import GalaxyButton from "../components/GalaxyButton";

const SettingsPage: React.FC = () => {
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <div className="console-stagger-item console-stagger-item--1">
        <Card title="账号信息">
          <Form layout="vertical" style={{ maxWidth: 480 }}>
            <Form.Item label="邮箱" name="email">
              <Input className="input" disabled placeholder="demo@example.com" />
            </Form.Item>
            <Form.Item label="昵称" name="nickname">
              <Input className="input" placeholder="填写你的昵称" />
            </Form.Item>
            <Form.Item>
              <GalaxyButton block onClick={() => {}}>
                保存账号信息
              </GalaxyButton>
            </Form.Item>
          </Form>
        </Card>
      </div>

      {/* 模型配置（示意）卡片暂不展示 */}
    </Space>
  );
};

export default SettingsPage;

