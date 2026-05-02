import React from "react";
import { Card, Col, Row, Segmented, Space, Statistic, Typography } from "antd";

type PeriodKey = "7d" | "30d";

function buildSeries(days: number) {
  const labels: string[] = [];
  const values: number[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    labels.push(`${d.getMonth() + 1}/${d.getDate()}`);
    const base = days === 7 ? 22 : 18;
    const wave = Math.sin((days - i) / 2.3) * 6 + Math.cos((days - i) / 3.9) * 4;
    const trend = days === 30 ? (days - i) * 0.4 : (days - i) * 0.7;
    values.push(Math.max(6, Math.round(base + wave + trend)));
  }
  return { labels, values };
}

const JourneyInsightsPage: React.FC = () => {
  const [period, setPeriod] = React.useState<PeriodKey>("7d");

  const current = React.useMemo(() => buildSeries(period === "7d" ? 7 : 30), [period]);
  const previous = React.useMemo(() => {
    const vals = current.values.map((v, idx) => Math.max(4, Math.round(v * (0.76 + (idx % 5) * 0.03))));
    return { labels: current.labels, values: vals };
  }, [current]);

  const currentTotal = current.values.reduce((acc, v) => acc + v, 0);
  const previousTotal = previous.values.reduce((acc, v) => acc + v, 0);
  const deltaPct = previousTotal === 0 ? 0 : ((currentTotal - previousTotal) / previousTotal) * 100;

  const maxValue = Math.max(...current.values, ...previous.values, 1);
  const chartWidth = 1100;
  const chartHeight = 260;
  const pad = { top: 18, right: 20, bottom: 42, left: 32 };
  const innerWidth = chartWidth - pad.left - pad.right;
  const innerHeight = chartHeight - pad.top - pad.bottom;
  const count = current.labels.length;
  const stepX = count > 1 ? innerWidth / (count - 1) : 0;

  const toPoint = (idx: number, value: number) => {
    const x = pad.left + idx * stepX;
    const y = pad.top + innerHeight - (value / maxValue) * innerHeight;
    return { x, y };
  };

  const currentPoints = current.values.map((v, idx) => toPoint(idx, v));
  const previousPoints = previous.values.map((v, idx) => toPoint(idx, v));
  const currentPath = currentPoints.map((p, idx) => `${idx === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const previousPath = previousPoints.map((p, idx) => `${idx === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <div className="console-stagger-item console-stagger-item--1">
        <Card
          title="使用旅程分析"
          extra={
            <Segmented
              value={period}
              onChange={(v) => setPeriod(v as PeriodKey)}
              options={[
                { label: "近 7 天", value: "7d" },
                { label: "近 30 天", value: "30d" }
              ]}
            />
          }
        >
          <Row gutter={[16, 16]}>
            <Col xs={24} md={8}>
              <Statistic title="当前周期总字数" value={currentTotal} suffix="字" />
            </Col>
            <Col xs={24} md={8}>
              <Statistic title="上个周期总字数" value={previousTotal} suffix="字" />
            </Col>
            <Col xs={24} md={8}>
              <Statistic
                title="环比变化"
                value={Number(deltaPct.toFixed(1))}
                suffix="%"
                valueStyle={{ color: deltaPct >= 0 ? "#3f8600" : "#cf1322" }}
              />
            </Col>
          </Row>
        </Card>
      </div>

      <div className="console-stagger-item console-stagger-item--2">
        <Card title="日期对比折线图">
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <div style={{ width: "100%", overflowX: "auto" }}>
              <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} style={{ minWidth: chartWidth, width: "100%", height: 260 }}>
                <line
                  x1={pad.left}
                  y1={pad.top + innerHeight}
                  x2={pad.left + innerWidth}
                  y2={pad.top + innerHeight}
                  stroke="rgba(100,116,139,0.28)"
                  strokeWidth="1"
                />

                <path d={previousPath} fill="none" stroke="rgba(0,0,0,0.55)" strokeWidth="1" strokeDasharray="5 4" />
                <path d={currentPath} fill="none" stroke="#000000" strokeWidth="1.25" />

                {currentPoints.map((p, idx) => (
                  <g key={current.labels[idx]}>
                    <circle cx={p.x} cy={p.y} r="2.5" fill="#000000" />
                    <text x={p.x} y={p.y - 10} textAnchor="middle" fontSize="11" fill="#334155">
                      {current.values[idx]}
                    </text>
                    <text x={p.x} y={pad.top + innerHeight + 18} textAnchor="middle" fontSize="11" fill="#64748b">
                      {current.labels[idx]}
                    </text>
                  </g>
                ))}
              </svg>
            </div>

            <Space size={18} wrap>
              <Space size={6}>
                <span style={{ width: 18, height: 2, background: "#000000", display: "inline-block" }} />
                <Typography.Text type="secondary">当前周期</Typography.Text>
              </Space>
              <Space size={6}>
                <span
                  style={{
                    width: 18,
                    height: 0,
                    borderTop: "2px dashed rgba(0,0,0,0.55)",
                    display: "inline-block",
                    verticalAlign: "middle"
                  }}
                />
                <Typography.Text type="secondary">上个周期</Typography.Text>
              </Space>
            </Space>
          </Space>
        </Card>
      </div>
    </Space>
  );
};

export default JourneyInsightsPage;
