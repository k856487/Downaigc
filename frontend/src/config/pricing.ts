/**
 * 定价常量（V3.0 商业化方案，与 backend/pricing.py 对齐）
 * 1 字 = 改写 1 个汉字；按实际输出汉字数扣费
 */
export const BENCHMARK_WORDS = 7166;
export const BENCHMARK_YUAN = 0.07;
export const YUAN_PER_WORD = BENCHMARK_YUAN / BENCHMARK_WORDS;

/** 新用户注册赠送 */
export const REGISTRATION_BONUS = 5888;

/** 普通用户每日签到 */
export const DAILY_SIGNIN_GRANT_NORMAL = 888;

/** 看一次完整激励视频（普通用户） */
export const AD_WATCH_REWARD_NORMAL = 2888;

/** 普通用户每日广告上限 */
export const AD_DAILY_LIMIT_NORMAL = 10;

export type MemberTier = "none" | "monthly" | "premium";

export type RechargePackage = {
  yuan: number;
  points: number;
  label: string;
  recommended?: boolean;
  hook?: string;
  /** 字数包永久有效 */
  permanent?: boolean;
};

/** 新用户首充礼包（限购一次） */
export const FIRST_RECHARGE_WORD_PACK = {
  yuan: 2.99,
  points: 18888,
  label: "首充礼包",
  tag: "新用户专享",
  limitOnce: true
} as const;

/** 新用户首充会员包：7 天普通会员体验（限购一次） */
export const FIRST_RECHARGE_MEMBER_PACK = {
  yuan: 2.99,
  days: 7,
  tier: "monthly" as MemberTier,
  label: "首充会员包",
  tag: "体验会员功能",
  limitOnce: true
} as const;

/** 字数包（永久有效） */
export const RECHARGE_PACKAGES: RechargePackage[] = [
  { yuan: 6.99, points: 38888, label: "体验包", hook: "适合课程作业", permanent: true },
  { yuan: 19.9, points: 128888, label: "入门包", hook: "适合课程论文", permanent: true },
  {
    yuan: 39.9,
    points: 388888,
    label: "热门包",
    recommended: true,
    hook: "适合毕业论文",
    permanent: true
  },
  { yuan: 99, points: 1288888, label: "专业包", hook: "适合长期使用", permanent: true }
];

export type MemberPlanDef = {
  tier: MemberTier;
  title: string;
  tag: string;
  tagColor: string;
  yuan: number;
  signinGrant: number;
  adReward: number;
  adDailyLimit: number;
  perks: string[];
};

/** 效率会员体系 */
export const MEMBER_PLANS: MemberPlanDef[] = [
  {
    tier: "monthly",
    title: "普通会员",
    tag: "19.9 元/月",
    tagColor: "blue",
    yuan: 19.9,
    signinGrant: 2888,
    adReward: 3888,
    adDailyLimit: 20,
    perks: [
      "每日签到 2888 字（普通 888）",
      "看广告 3888 字/次（普通 2888）",
      "每日广告 20 次",
      "快速生成模式（多段并行）",
      "会员专属标识"
    ]
  },
  {
    tier: "premium",
    title: "高级会员",
    tag: "39.9 元/月",
    tagColor: "gold",
    yuan: 39.9,
    signinGrant: 3888,
    adReward: 5888,
    adDailyLimit: 30,
    perks: [
      "每日签到 3888 字",
      "看广告 5888 字/次",
      "每日广告 30 次",
      "极速生成模式（更高并行度）",
      "超长文本处理",
      "会员专属标识"
    ]
  }
];

export function signinGrantForTier(tier: MemberTier): number {
  if (tier === "premium") return 3888;
  if (tier === "monthly") return 2888;
  return DAILY_SIGNIN_GRANT_NORMAL;
}

export function adRewardForTier(tier: MemberTier): number {
  if (tier === "premium") return 5888;
  if (tier === "monthly") return 3888;
  return AD_WATCH_REWARD_NORMAL;
}

export function adDailyLimitForTier(tier: MemberTier): number {
  if (tier === "premium") return 30;
  if (tier === "monthly") return 20;
  return AD_DAILY_LIMIT_NORMAL;
}

/** @deprecated V3 字数包为固定档位，保留仅供估算 */
export const POINTS_PER_YUAN = 3000;
export const AD_WATCH_REWARD_POINTS = AD_WATCH_REWARD_NORMAL;
export const DAILY_FREE_GRANT = DAILY_SIGNIN_GRANT_NORMAL;
export const DAILY_FREE_CAP = DAILY_SIGNIN_GRANT_NORMAL;

export function estimateApiYuan(words: number): number {
  return words * YUAN_PER_WORD;
}

export function formatWritableWords(n: number): string {
  return n.toLocaleString("zh-CN");
}

export const HOME_PROMO_COPY = {
  register: `注册送 ${REGISTRATION_BONUS.toLocaleString("zh-CN")} 字`,
  signin: `每日签到 ${DAILY_SIGNIN_GRANT_NORMAL.toLocaleString("zh-CN")} 字`,
  ad: `看广告立即获得 ${AD_WATCH_REWARD_NORMAL.toLocaleString("zh-CN")} 字`,
  firstRecharge: `${FIRST_RECHARGE_WORD_PACK.yuan} 元 · ${FIRST_RECHARGE_WORD_PACK.points.toLocaleString("zh-CN")} 字`,
  hotPack: `${RECHARGE_PACKAGES.find((p) => p.recommended)?.yuan ?? 39.9} 元 · ${(
    RECHARGE_PACKAGES.find((p) => p.recommended)?.points ?? 388888
  ).toLocaleString("zh-CN")} 字`,
  member: "提升签到/广告奖励 · 快速生成"
} as const;
