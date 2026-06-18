import React from "react";
import { Space, Segmented, Tooltip, Dropdown, type MenuProps } from "antd";
import { MoonOutlined, SunOutlined, LaptopOutlined, PlusOutlined, CrownOutlined } from "@ant-design/icons";
import { useLocation, useNavigate } from "react-router-dom";
import { useThemeMode, type ThemeMode } from "../state/ThemeContext";
import { useUserProfile } from "../state/UserProfileContext";
import { useReward } from "../state/RewardContext";
import { clearAccessToken, getAccessToken } from "../api/client";
import { createGlyphDataUrl } from "../utils/glyphCenter";
import { useMembership } from "../state/MembershipContext";
import { memberTagColorToHex } from "../utils/memberTierColor";

/** 顶部余额条：金币 emoji */
const WalletGoldCoinIcon: React.FC = () => (
  <span className="app-top-wallet-strip__coin" role="img" aria-label="金币">
    🪙
  </span>
);

/** 改写字数：六边形 + 星形，偏紫蓝 */
const WalletPointsIcon: React.FC = () => {
  const pid = React.useId().replace(/:/g, "");
  return (
    <svg className="app-top-wallet-strip__points-ico" width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <defs>
        <linearGradient id={`wpi-${pid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#a78bfa" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>
      </defs>
      <path
        fill={`url(#wpi-${pid})`}
        stroke="#4c1d95"
        strokeWidth="0.6"
        d="M12 2.2l8.2 4.7v9.4L12 21l-8.2-4.7V6.9L12 2.2z"
      />
      <path
        fill="#eef2ff"
        d="M12 7.2l1.1 2.2 2.4.3-1.7 1.7.4 2.4-2.2-1.2-2.2 1.2.4-2.4-1.7-1.7 2.4-.3L12 7.2z"
      />
    </svg>
  );
};

const AppHeader: React.FC = () => {
  const { themeMode, setThemeMode } = useThemeMode();
  const { profile } = useUserProfile();
  const navigate = useNavigate();
  const location = useLocation();
  const headerInitial = (profile.nickname ?? "").charAt(0);
  const headerGlyphImage = React.useMemo(
    () => createGlyphDataUrl(headerInitial, 32, 18),
    [headerInitial]
  );

  const isLoggedIn = Boolean(getAccessToken());
  const hideUserMenuOnAuthRoute =
    location.pathname === "/login" ||
    location.pathname === "/register" ||
    location.pathname === "/scan-login";
  const hideTopWalletStrip = hideUserMenuOnAuthRoute || location.pathname.startsWith("/admin");
  const { state: rewardState } = useReward();
  const { vip, clearVipTier } = useMembership();

  const userMenuItems: MenuProps["items"] = isLoggedIn
    ? [
        {
          key: "logout",
          label: "退出登录",
          onClick: () => {
            clearVipTier();
            clearAccessToken();
            navigate("/login");
          }
        }
      ]
    : [
        {
          key: "login-register",
          label: "登录 / 注册",
          onClick: () => navigate("/login")
        }
      ];

  return (
    <div
      className={[
        "app-top-right-cluster",
        hideTopWalletStrip ? "app-top-right-cluster--icons-only" : ""
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="console-floating-header-icons">
        <Space size={12} align="center" wrap>
          <Tooltip title="主题切换">
            <Segmented
              size="small"
              value={themeMode}
              onChange={(val) => setThemeMode(val as ThemeMode)}
              options={[
                { label: <MoonOutlined />, value: "dark" },
                { label: <SunOutlined />, value: "light" },
                { label: <LaptopOutlined />, value: "system" }
              ]}
            />
          </Tooltip>
        {hideUserMenuOnAuthRoute ? (
          <div
            className="header-user-avatar"
            style={{
              cursor: "default",
              backgroundImage: profile.avatarUrl ? `url("${profile.avatarUrl}")` : undefined
            }}
            aria-label="用户头像"
          >
            {!profile.avatarUrl && headerInitial ? (
              <span key={headerInitial} className="header-user-avatar__glyph header-user-avatar__glyph--pop">
                {headerGlyphImage ? (
                  <img className="avatar-glyph-image" src={headerGlyphImage} alt="" aria-hidden />
                ) : null}
              </span>
            ) : null}
          </div>
        ) : (
          <Dropdown
            menu={{
              items: userMenuItems
            }}
            placement="bottomRight"
            trigger={["click"]}
          >
            <div
              className="header-user-avatar"
              style={{
                cursor: "pointer",
                backgroundImage: profile.avatarUrl ? `url("${profile.avatarUrl}")` : undefined
              }}
              onClick={(e) => e.preventDefault()}
              aria-label="用户头像菜单"
              role="button"
            >
              {!profile.avatarUrl && headerInitial ? (
                <span key={headerInitial} className="header-user-avatar__glyph header-user-avatar__glyph--pop">
                  {headerGlyphImage ? (
                    <img className="avatar-glyph-image" src={headerGlyphImage} alt="" aria-hidden />
                  ) : null}
                </span>
              ) : null}
            </div>
          </Dropdown>
        )}
        </Space>
      </div>
      {!hideTopWalletStrip ? (
        <div className="app-top-wallet-inline app-top-wallet-on-bg" role="region" aria-label="余额与改写字数">
          <div className="app-top-wallet-strip__chunk app-top-wallet-strip__chunk--balance">
            {vip ? (
              <Tooltip title={`当前示意：${vip.planTitle}`}>
                <CrownOutlined
                  className="app-top-wallet-strip__vip-icon"
                  aria-label={`会员：${vip.planTitle}`}
                  role="img"
                  style={{ color: memberTagColorToHex(vip.tagColor) }}
                />
              </Tooltip>
            ) : null}
            <WalletGoldCoinIcon />
            <span className="app-top-wallet-strip__currency" aria-hidden>
              ¥
            </span>
            <span className="app-top-wallet-strip__amount">
              {rewardState.balanceYuan.toLocaleString("zh-CN", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
              })}
            </span>
            <Tooltip title="进入金币充值页">
              <button
                type="button"
                className="app-top-wallet-recharge-mini"
                aria-label="金币充值"
                onClick={() => navigate("/console/wallet/balance")}
              >
                <PlusOutlined />
              </button>
            </Tooltip>
          </div>
          <span className="app-top-wallet-strip__sep" aria-hidden />
          <div
            className="app-top-wallet-strip__chunk app-top-wallet-strip__chunk--points"
            aria-label={`可改写字数 ${rewardState.writableWords.toLocaleString("zh-CN")}`}
          >
            <WalletPointsIcon />
            <span className="app-top-wallet-strip__points-num">
              {rewardState.writableWords.toLocaleString("zh-CN")}
            </span>
            <Tooltip title="进入字数中心（看广告、签到、充值）">
              <button
                type="button"
                className="app-top-wallet-recharge-mini app-top-wallet-recharge-mini--points"
                aria-label="增加改写字数"
                onClick={() => navigate("/console/wallet/points")}
              >
                <PlusOutlined />
              </button>
            </Tooltip>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default AppHeader;

