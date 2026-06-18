/** Ant Design Tag `color` 预设 → 顶栏 VIP 图标用实色（与会员卡片角标一致） */
export const MEMBER_TAG_COLOR_HEX: Record<string, string> = {
  volcano: "#fa541c",
  cyan: "#13c2c2",
  blue: "#1677ff",
  geekblue: "#2f54eb",
  purple: "#722ed1",
  gold: "#faad14",
  orange: "#fa8c16",
  magenta: "#eb2f96"
};

export function memberTagColorToHex(tagColor: string): string {
  return MEMBER_TAG_COLOR_HEX[tagColor] ?? "#faad14";
}
