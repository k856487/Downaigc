import React from "react";

type Datum = {
  label: string;
  value: number;
};

type SimpleLineChartProps = {
  data: Datum[];
  height?: number;
  stroke?: string;
  title?: string;
};

const SimpleLineChart: React.FC<SimpleLineChartProps> = ({
  data,
  height = 180,
  stroke = "#1677ff",
  title
}) => {
  const width = 760;
  const padding = 24;
  const values = data.map((d) => d.value);
  const max = Math.max(1, ...values);
  const min = Math.min(...values, 0);
  const xStep = data.length > 1 ? (width - padding * 2) / (data.length - 1) : 0;

  const points = data
    .map((d, i) => {
      const x = padding + i * xStep;
      const ratio = (d.value - min) / Math.max(1, max - min);
      const y = height - padding - ratio * (height - padding * 2);
      return `${x},${y}`;
    })
    .join(" ");

  const latest = data[data.length - 1]?.value ?? 0;

  return (
    <div style={{ width: "100%" }}>
      {title ? (
        <div style={{ marginBottom: 8, display: "flex", justifyContent: "space-between" }}>
          <strong>{title}</strong>
          <span style={{ color: "#64748b", fontSize: 12 }}>最新：{latest.toLocaleString()}</span>
        </div>
      ) : null}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label={title || "line chart"}
      >
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#e5e7eb" />
        <polyline fill="none" stroke={stroke} strokeWidth="3" points={points} />
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#64748b" }}>
        <span>{data[0]?.label || "-"}</span>
        <span>{data[Math.floor(data.length / 2)]?.label || "-"}</span>
        <span>{data[data.length - 1]?.label || "-"}</span>
      </div>
    </div>
  );
};

export default SimpleLineChart;

