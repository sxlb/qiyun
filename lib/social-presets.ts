/**
 * 常用社交平台的「一键预设」。
 *
 * 目的：后台新增社交链接要手填三个字段（名称 / 图标 / 地址），而图标的取值格式
 * 又分 lucide 名、Iconify（prefix:name）、图片 URL、内联 SVG 四种，逐个回忆成本很高。
 * 这里把常用平台的名称、图标、地址前缀固化下来，点一下就生成一行，用户只补地址后半段。
 *
 * 图标取值说明：
 * - 品牌类用 `simple-icons:*`（Iconify 官方品牌图标集，名称已按上游实际存在的名字核对过）；
 *   前台 SocialLinks 与后台预览都支持 Iconify 取值，会在运行时向 Iconify 接口取 SVG。
 * - 邮箱没有品牌图标，用 lucide 的 `mail`（随包内置，零外部请求）。
 *
 * 注意：本模块会被客户端组件引用，**不得引入 node: 内置模块**。
 */

export interface SocialPreset {
  /** 平台名称（同时作为链接的显示名） */
  name: string;
  /** 图标取值（lucide 名或 Iconify 的 prefix:name） */
  icon: string;
  /**
   * 地址前缀：一键生成后填进 url 字段，用户只需补账号部分。
   * 留空表示该平台没有可拼的公开主页地址，需要用户自行填写完整地址。
   */
  urlPrefix: string;
  /** 悬停提示文案（仅社交链接有该字段） */
  tip: string;
}

/**
 * 预设清单（顺序即展示顺序，按国内站长常用程度排列）。
 *
 * 关于两个特殊项：
 * - 微信：没有可跳转的公开主页 URL，因此 urlPrefix 留空，改在「点击弹出图片」里放二维码图片。
 * - 抖音：simple-icons 没有 douyin 这个字形，用 tiktok 代替 —— 两者是同一枚音符标识。
 */
export const SOCIAL_PRESETS: SocialPreset[] = [
  {
    name: "GitHub",
    icon: "simple-icons:github",
    urlPrefix: "https://github.com/",
    tip: "去 GitHub 看看",
  },
  {
    name: "BiliBili",
    icon: "simple-icons:bilibili",
    urlPrefix: "https://space.bilibili.com/",
    tip: "(゜-゜)つロ 干杯~",
  },
  {
    name: "微博",
    icon: "simple-icons:sinaweibo",
    urlPrefix: "https://weibo.com/",
    tip: "来微博找我",
  },
  {
    name: "知乎",
    icon: "simple-icons:zhihu",
    urlPrefix: "https://www.zhihu.com/people/",
    tip: "知乎主页",
  },
  {
    name: "邮箱",
    icon: "lucide:mail",
    urlPrefix: "mailto:",
    tip: "来封 Email~",
  },
  {
    name: "X",
    icon: "simple-icons:x",
    urlPrefix: "https://x.com/",
    tip: "你懂的~",
  },
  {
    name: "Telegram",
    icon: "simple-icons:telegram",
    urlPrefix: "https://t.me/",
    tip: "Telegram 找我",
  },
  {
    name: "QQ",
    icon: "simple-icons:qq",
    urlPrefix: "https://wpa.qq.com/msgrd?v=3&uin=",
    tip: "QQ 联系",
  },
  {
    name: "微信",
    icon: "simple-icons:wechat",
    urlPrefix: "",
    tip: "点开看二维码",
  },
  {
    name: "抖音",
    icon: "simple-icons:tiktok",
    urlPrefix: "https://www.douyin.com/user/",
    tip: "抖音主页",
  },
  {
    name: "小红书",
    icon: "simple-icons:xiaohongshu",
    urlPrefix: "https://www.xiaohongshu.com/user/profile/",
    tip: "小红书主页",
  },
  {
    name: "网易云音乐",
    icon: "simple-icons:neteasecloudmusic",
    urlPrefix: "https://music.163.com/#/user/home?id=",
    tip: "网易云音乐主页",
  },
];
