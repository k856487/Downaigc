import React from "react";

/** 路由懒加载占位：纯 CSS，不引入 Ant Spin 避免额外 chunk */
const RouteFallback: React.FC = () => (
  <div className="route-lazy-fallback" role="status" aria-live="polite">
    <span className="route-lazy-fallback__dot" />
    <span className="route-lazy-fallback__label">加载中</span>
  </div>
);

export default RouteFallback;
