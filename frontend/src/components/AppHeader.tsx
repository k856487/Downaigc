import React from "react";
import {
  Space,
  Segmented,
  Tooltip,
  Dropdown
} from "antd";
import { MoonOutlined, SunOutlined, LaptopOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { useThemeMode, type ThemeMode } from "../state/ThemeContext";
import { useUserProfile } from "../state/UserProfileContext";
import { createGlyphDataUrl } from "../utils/glyphCenter";

const AppHeader: React.FC = () => {
  const { themeMode, setThemeMode } = useThemeMode();
  const { profile } = useUserProfile();
  const navigate = useNavigate();
  const headerInitial = profile.nickname.charAt(0);
  const headerGlyphImage = React.useMemo(
    () => createGlyphDataUrl(headerInitial, 32, 18),
    [headerInitial]
  );

  const userMenuItems = [
    {
      key: "login-register",
      label: "登录 / 注册",
      onClick: () => navigate("/login")
    },
    {
      type: "divider"
    } as const,
    {
      key: "logout",
      label: "退出登录",
      onClick: () => navigate("/login")
    }
  ];

  return (
    <div className="console-floating-header-icons">
      <Space size={12}>
        <Tooltip title="主题切换">
          <Segmented
            size="small"
            value={themeMode}
            onChange={(val) =>
              setThemeMode(val as ThemeMode)
            }
            options={[
              {
                label: <MoonOutlined />,
                value: "dark"
              },
              {
                label: <SunOutlined />,
                value: "light"
              },
              {
                label: <LaptopOutlined />,
                value: "system"
              }
            ]}
          />
        </Tooltip>
        <Dropdown
          menu={{
            items: userMenuItems as any
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
      </Space>
    </div>
  );
};

export default AppHeader;

