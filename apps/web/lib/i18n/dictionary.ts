import type { SupportedLocale } from "@/lib/i18n/config";

const zhCN = {
  "metadata.title": "Navigator｜新能源企业出海工作台",
  "metadata.description": "面向新能源企业的内部合成数据出海决策演示工作台",
  "brand.tagline": "新能源企业出海工作台",
  "nav.home": "首页",
  "nav.markets": "全球市场",
  "nav.policyRisk": "政策与风险",
  "nav.tools": "出海工具",
  "nav.partners": "合作伙伴",
  "shell.brandHomeAria": "Navigator 首页",
  "shell.mainNavigation": "主导航",
  "shell.openNavigation": "打开导航",
  "shell.closeNavigation": "关闭导航",
  "shell.startPlanning": "开始出海规划",
  "shell.logout": "退出内部演示",
  "shell.demoNotice": "演示数据 / 非正式结论",
  "shell.demoBoundary": "仅限内部展示 · 不连接真实来源",
  "shell.syntheticSource": "合成演示来源",
  "shell.baselineDate": "基线日期：{date}",
  "language.switcherLabel": "界面语言",
  "language.switchToEnglish": "切换到英文",
  "language.switchToChinese": "切换到中文",
  "login.title": "内部演示入口",
  "login.intro": "输入共享演示口令，进入合成数据环境。",
  "login.preparing": "正在准备安全登录…",
  "login.boundary": "本环境不连接外部数据、模型或真实用户系统，也不构成专业结论。",
  "login.passphrase": "共享演示口令",
  "login.submit": "进入内部 Demo",
  "login.submitting": "正在验证…",
  "login.error.expired": "演示会话已结束，请重新输入口令。",
  "login.error.notConfigured": "演示访问尚未配置，请联系演示负责人。",
  "login.error.invalidRequest": "登录请求无效，请重试。",
  "login.error.invalidPassphrase": "演示口令不正确。",
  "login.error.default": "无法进入演示环境，请稍后重试。",
} as const;

export type TranslationKey = keyof typeof zhCN;
export type TranslationValues = Readonly<Record<string, string | number>>;
type Dictionary = Readonly<Record<TranslationKey, string>>;

const en = {
  "metadata.title": "Navigator | Global Expansion Workbench",
  "metadata.description":
    "An internal synthetic-data decision demo for renewable energy companies expanding globally",
  "brand.tagline": "Global Expansion Workbench",
  "nav.home": "Home",
  "nav.markets": "Global Markets",
  "nav.policyRisk": "Policy & Risk",
  "nav.tools": "Expansion Tools",
  "nav.partners": "Partners",
  "shell.brandHomeAria": "Navigator home",
  "shell.mainNavigation": "Main navigation",
  "shell.openNavigation": "Open navigation",
  "shell.closeNavigation": "Close navigation",
  "shell.startPlanning": "Start Expansion Planning",
  "shell.logout": "Leave internal demo",
  "shell.demoNotice": "Demo Data / Non-official Conclusions",
  "shell.demoBoundary": "Internal preview only · No real sources connected",
  "shell.syntheticSource": "Synthetic demo sources",
  "shell.baselineDate": "Baseline date: {date}",
  "language.switcherLabel": "Interface language",
  "language.switchToEnglish": "Switch to English",
  "language.switchToChinese": "Switch to Chinese",
  "login.title": "Internal Demo Access",
  "login.intro": "Enter the shared demo passphrase to access the synthetic-data environment.",
  "login.preparing": "Preparing secure access…",
  "login.boundary":
    "This environment does not connect to external data, models, or real-user systems and does not provide professional conclusions.",
  "login.passphrase": "Shared demo passphrase",
  "login.submit": "Enter Internal Demo",
  "login.submitting": "Verifying…",
  "login.error.expired": "Your demo session has ended. Enter the passphrase again.",
  "login.error.notConfigured": "Demo access is not configured. Contact the demo owner.",
  "login.error.invalidRequest": "The sign-in request is invalid. Please try again.",
  "login.error.invalidPassphrase": "The demo passphrase is incorrect.",
  "login.error.default": "The demo environment is unavailable. Please try again later.",
} as const satisfies Dictionary;

const dictionaries: Readonly<Record<SupportedLocale, Dictionary>> = {
  "zh-CN": zhCN,
  en,
};

export function translate(
  locale: SupportedLocale,
  key: TranslationKey,
  values?: TranslationValues,
): string {
  let message = dictionaries[locale][key] ?? dictionaries["zh-CN"][key];
  if (!values) return message;

  for (const [name, value] of Object.entries(values)) {
    message = message.replaceAll(`{${name}}`, String(value));
  }
  return message;
}
