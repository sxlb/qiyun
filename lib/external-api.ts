/**
 * 外部服务地址配置（前后端共用，纯函数模块）。
 *
 * 背景：壁纸 / 头像 / 在线图标等能力依赖第三方免费接口，而这些接口随时可能
 * 失效。项目历史上已两次踩坑（vvhan 壁纸源、vvhan 一言源先后下线），当时只能改代码、
 * 重新构建部署。现把地址抽成后台可配置项：在「外部服务」面板填写即生效，留空则回退
 * 内置默认值，做到上游失效时无需改代码即可换源。
 *
 * 占位符约定（仅对「模板型」条目生效，填写时按需包含）：
 * - `{host}`：目标域名（如 favicon 服务）
 *
 * 注意：本模块不得引入 node: 内置模块，客户端组件（MediaPicker 等）会直接引用。
 */

/** 外部服务地址的内置默认值（与 prisma/schema.prisma 的 Profile 字段一一对应） */
export const EXTERNAL_API_DEFAULTS = {
  /** 随机风景壁纸直链（t.mwm.moe 免费图床） */
  wallpaperLandscapeApi: "https://t.mwm.moe/fj",
  /** 随机动漫壁纸直链 */
  wallpaperAnimeApi: "https://t.mwm.moe/mp",
  /** 随机头像接口：约定返回 JSON `{ data: "图片地址" }` 或纯文本地址 */
  randomAvatarApi: "https://v2.xxapi.cn/api/head?return=json",
  /** Iconify 在线图标 API 基地址（取图标 SVG 与图标集清单） */
  iconifyApi: "https://api.iconify.design",
  /** favicon 服务模板：留空表示不启用自定义源，仅用内置多源回退 */
  faviconApi: "",
  /** 必应每日壁纸接口 */
  bingWallpaperApi: "https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=zh-CN",
} as const;

/** 外部服务配置项的键名 */
export type ExternalApiKey = keyof typeof EXTERNAL_API_DEFAULTS;

/** 形如 Profile 的外部服务字段集合（取自数据库，空串代表「未配置」） */
export type ExternalApiConfig = Partial<Record<ExternalApiKey, string | null | undefined>>;

/**
 * 读取单个外部服务地址：配置为空（未填 / 空白）时回退内置默认值。
 *
 * @param config Profile 中读取到的外部服务字段集合（可为 null）
 * @param key    服务键名
 * @returns      有效地址（始终非空字符串，除非该项默认值本身为空）
 */
export function resolveExternalApi(
  config: ExternalApiConfig | null | undefined,
  key: ExternalApiKey
): string {
  const value = (config?.[key] ?? "").trim();
  return value || EXTERNAL_API_DEFAULTS[key];
}

/**
 * 从 Profile 行中提取全部外部服务配置。
 * 抽成函数是为了让「新增配置项」只需改本文件与 schema，调用方无需逐个取值。
 */
export function pickExternalApis(
  profile: ExternalApiConfig | null | undefined
): ExternalApiConfig {
  if (!profile) return {};
  const picked: ExternalApiConfig = {};
  for (const key of Object.keys(EXTERNAL_API_DEFAULTS) as ExternalApiKey[]) {
    picked[key] = profile[key] ?? "";
  }
  return picked;
}

/** 模板占位符的取值 */
export interface TemplateVars {
  /** 宽（像素） */
  w?: number;
  /** 高（像素） */
  h?: number;
  /** 关键词（会自动 URI 编码） */
  kw?: string;
  /** 目标域名 */
  host?: string;
}

/**
 * 填充地址模板中的占位符。
 *
 * 未提供的占位符会被替换为空串而非原样保留：例如模板只有 `{w}` 时，
 * `{h}` 不应作为字面量残留在最终 URL 里导致请求 404。
 * 关键词与域名做 URI 编码，避免空格 / 斜杠破坏 URL 结构。
 */
export function fillTemplate(template: string, vars: TemplateVars): string {
  const kw = (vars.kw ?? "").trim();
  return template
    .replace(/\{w\}/g, vars.w === undefined ? "" : String(vars.w))
    .replace(/\{h\}/g, vars.h === undefined ? "" : String(vars.h))
    .replace(/\{kw\}/g, encodeURIComponent(kw || "random"))
    .replace(/\{host\}/g, encodeURIComponent((vars.host ?? "").trim()));
}

/**
 * 安全拼接基地址与子路径。
 * 管理员填写的基地址可能带（或不带）结尾斜杠，直接模板拼接会出现 `//collection`
 * 或缺斜杠的畸形 URL，故统一在此规整。
 */
export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}
