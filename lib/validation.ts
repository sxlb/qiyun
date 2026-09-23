import { z } from "zod";
import { isInlineSvgValue, isLocalImagePath } from "@/lib/iconValue";

// ===== URL 合法性辅助函数 =====

/** 检查相对路径是否为合法 URL pathname（不含非法字符） */
function isValidRelativePath(path: string): boolean {
  // URL pathname 只允许：字母、数字、. - _ ~ ! $ & ' ( ) * + , ; = : @ / % 以及 Unicode
  // 拒绝控制字符、空格、尖括号、引号等危险/非法字符
  return /^[A-Za-z0-9\-._~!$&'()*+,;=:@/%]+$/.test(path);
}

// 站点公告新增/编辑校验 schema（title 必填、content 必填、时间区间可空）
export const announcementSchema = z.object({
  title: z.string().trim().min(1, "标题不能为空").max(100, "标题过长"),
  content: z.string().trim().min(1, "内容不能为空").max(5000, "内容过长"),
  pinned: z.boolean().default(false),
  enabled: z.boolean().default(true),
  sort: z.number().int().min(0).max(9999).default(0),
  startAt: z.string().datetime({ offset: true, message: "startAt 需为 ISO 时间" }).nullable().default(null),
  endAt: z.string().datetime({ offset: true, message: "endAt 需为 ISO 时间" }).nullable().default(null),
});
// 编辑时允许部分字段：标题/内容/置顶/上线/排序/时间
export const announcementPatchSchema = announcementSchema.partial();

// 公告批量保存：数组，每项可含可选 id（有则更新、无则新增）
export const announcementBatchSchema = z.array(
  announcementSchema.extend({ id: z.number().int().positive().optional() })
);

// 右上角欢迎通知：默认 5 句欢迎语（{siteName} 会被替换为站点昵称）
export const DEFAULT_WELCOME_MESSAGES = [
  "欢迎来到 {siteName} 的小站～",
  "很高兴遇见你，祝你愉快！",
  "愿时光温柔，伴你左右",
  "相逢即是缘分，欢迎光临",
  "欢迎回来，好久不见",
];

// 图片地址：允许 http(s) 外链，以及后台「上传」按钮产出的媒体库相对路径（/api/uploads/file/xxx）。
// 注意：只写 ^https?:// 会导致「上传成功但保存失败」—— 上传接口返回的正是相对路径。
const IMAGE_SRC_RE = /^(https?:\/\/|\/api\/uploads\/)/;

// 站点 SEO 默认文案：后台留空时前后台统一使用（避免搜索引擎抓到空描述/空关键词）
export const DEFAULT_SITE_TITLE = "个人主页";
export const DEFAULT_SITE_DESCRIPTION = "记录我的作品与生活，这里是我的个人主页，欢迎交流指教。";
export const DEFAULT_SITE_KEYWORDS = "个人主页,个人博客,作品集,技术分享,前端开发";

// Profile 校验 schema：用于 PUT /api/profile 请求体校验
export const profileSchema = z.object({
  avatar: z
    .string()
    .max(2048, "头像 URL 过长")
    .refine((v) => v === "" || IMAGE_SRC_RE.test(v), "头像须为 http(s) 外链或 /api/uploads/ 上传路径")
    .optional()
    .default(""),
  // 网站图标（favicon / Logo）：后台配置后动态替换浏览器标签页图标
  siteIcon: z
    .string()
    .max(2048, "网站图标 URL 过长")
    .refine((v) => v === "" || IMAGE_SRC_RE.test(v), "网站图标须为 http(s) 外链或 /api/uploads/ 上传路径")
    .optional()
    .default(""),
  nickname: z
    .string()
    .trim()
    .min(1, "昵称不能为空")
    .max(32, "昵称最长 32 字符")
    .optional()
    .default("无名"),
  bio: z
    .string()
    .max(280, "个性签名最长 280 字符")
    .optional()
    .default(""),
  github: z
    .string()
    .max(2048, "GitHub 链接过长")
    .refine(
      (v) => v === "" || /^https:\/\/(github\.com|gist\.github\.com)\//.test(v),
      "GitHub 链接必须为 https://github.com/ 开头"
    )
    .optional()
    .default(""),
  email: z
    .string()
    .max(254, "邮箱过长")
    .refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "邮箱格式不正确")
    .optional()
    .default(""),
  // 壁纸自定义地址（图片直链，可由后台上传）：留空则使用所选壁纸种类
  bgApi: z
    .string()
    .max(2048, "壁纸 API 地址过长")
    .refine(
      (v) => v === "" || (IMAGE_SRC_RE.test(v) && !v.startsWith("//")),
      "壁纸须为 http(s) 外链或 /api/uploads/ 上传路径（不允许协议相对地址）"
    )
    .optional()
    .default(""),
  // 天气配置：仅保留腾讯 / 高德（wttr.in 已移除）。
  // "wttr" / "uapis" 枚举值仅为兼容存量数据保留（路由不再调用），新保存均为 amap / tencent / tencent-key
  weatherProvider: z
    .enum(["wttr", "amap", "tencent", "tencent-key", "tencent-loc-amap", "uapis"], {
      errorMap: () => ({ message: "数据源必须是 amap / tencent / tencent-key / tencent-loc-amap" }),
    })
    .optional()
    .default("tencent"),
  amapKey: z
    .string()
    .max(64, "高德 Key 过长")
    .optional()
    .default(""),
  // 高德私钥（数字签名）：key 在控制台开启数字签名时必填，未开启可留空直调
  amapSecretKey: z
    .string()
    .max(64, "高德私钥过长")
    .optional()
    .default(""),
  // 腾讯位置服务 Key（"tencent-key" 数据源使用，IP 定位 + 天气实况）
  txWeatherKey: z
    .string()
    .max(64, "腾讯 Key 过长")
    .optional()
    .default(""),
  // 腾讯位置服务密钥（数字签名）：key 在控制台开启签名校验时必填，留空则无签名直调
  txWeatherSk: z
    .string()
    .max(64, "腾讯密钥过长")
    .optional()
    .default(""),
  weatherCity: z
    .string()
    .max(64, "城市名最长 64 字符")
    .optional()
    .default(""),
  // 壁纸配置：种类 + 定时切换间隔
  coverType: z
    .enum(["bing", "landscape", "anime", "custom"], {
      errorMap: () => ({ message: "壁纸种类必须是 bing / landscape / anime / custom" }),
    })
    .optional()
    .default("bing"),
  autoBGSwitchInterval: z
    .number()
    .int()
    .min(0, "间隔值不能为负数")
    .max(3, "间隔值最大为 3")
    .optional()
    .default(0),
  // 壁纸服务端缓存刷新间隔（分钟）：0=不刷新 / 5 / 10 / 30
  wallpaperRefresh: z
    .number()
    .int()
    .refine((v) => [0, 5, 10, 30].includes(v), "刷新间隔只能是 0 / 5 / 10 / 30 分钟")
    .optional()
    .default(0),
  // 主题模式
  theme: z
    .enum(["system", "time", "bg", "light", "dark"], {
      errorMap: () => ({ message: "主题模式必须是 system / time / bg / light / dark" }),
    })
    .optional()
    .default("system"),
  // 音乐多源配置（默认：meting 公共 API + 网易云热歌榜，开箱即用）
  songApi: z
    .string()
    .max(2048, "音乐 API 地址过长")
    .refine((v) => v === "" || /^https?:\/\//.test(v), "音乐 API 必须为 http(s):// 开头的 URL")
    .optional()
    .default("https://api.injahow.cn/meting"),
  songServer: z
    .enum(["netease", "tencent"], {
      errorMap: () => ({ message: "音乐源必须是 netease / tencent" }),
    })
    .optional()
    .default("netease"),
  songId: z
    .string()
    .max(64, "歌单 ID 过长")
    .optional()
    .default("3778678"),
  // 音乐自动播放：开启后前台歌单加载完成即尝试自动播放（浏览器可能拦截，拦截时静默放弃）
  musicAutoplay: z.boolean().optional().default(false),
  // 页脚配置
  siteUrl: z
    .string()
    .max(2048, "站点地址过长")
    .refine((v) => v === "" || /^https?:\/\//.test(v), "站点地址必须为 http(s):// 开头的 URL")
    .optional()
    .default(""),
  siteIcp: z
    .string()
    .max(64, "备案号过长")
    .optional()
    .default(""),
  // 公安备案号（可选）
  siteMps: z
    .string()
    .max(64, "公安备案号过长")
    .optional()
    .default(""),
  // 建站日期（YYYY-MM-DD，用于计算网站运行天数）
  siteStart: z
    .string()
    .max(16, "建站日期过长")
    .refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v), "建站日期格式须为 YYYY-MM-DD")
    .optional()
    .default(""),
  // 昵称标题是否使用艺术字体
  logoArtFont: z.boolean().optional().default(true),
  // 首页是否显示全屏加载动画
  loadingScreen: z.boolean().optional().default(true),
  // 点击粒子特效
  clickEffect: z.boolean().optional().default(true),
  // 控制台彩蛋
  consoleEgg: z.boolean().optional().default(true),
  // 站点访问统计
  showStats: z.boolean().optional().default(true),
  // 动态页面标题
  dynamicTitle: z.boolean().optional().default(true),
  // 顶部音乐进度条
  topProgressBar: z.boolean().optional().default(true),
  // 季节装饰特效（萤火虫/雪花/灯笼）
  seasonalEffectEnabled: z.boolean().optional().default(false),
  // 命令面板（Ctrl/Cmd+K）
  commandPalette: z.boolean().optional().default(true),
  // 昵称艺术字体（内置仅一款「有爱圆体」，因此只保留开关，不再提供字体选择）
  // 自定义字体（方案 A：输入 CSS 字体名，不存文件）
  customFontEnabled: z.boolean().optional().default(false),
  customFontFamily: z
    .string()
    .trim()
    .max(64, "字体名最长 64 字符")
    .refine(
      (v) => v === "" || /^[\u4e00-\u9fa5A-Za-z0-9 "'-,]+$/.test(v),
      "字体名仅支持中英文、数字、空格、引号与连字符"
    )
    .optional()
    .default(""),
  // 应用范围：nickname=仅昵称 / all=全站
  customFontScope: z
    .enum(["nickname", "all"], {
      errorMap: () => ({ message: "应用范围必须是 nickname / all" }),
    })
    .optional()
    .default("nickname"),
  // 网站链接区标题
  siteLinksTitle: z
    .string()
    .trim()
    .max(32, "标题最长 32 字符")
    .optional()
    .default("我的网站"),
  siteLinksIcon: z
    .string()
    .trim()
    .max(64, "图标名最长 64 字符")
    .optional()
    .default("link"),
  // 友情链接区标题
  friendLinksTitle: z
    .string()
    .trim()
    .max(32, "标题最长 32 字符")
    .optional()
    .default("友情链接"),
  // 阿里云矢量图标库（iconfont.cn）symbol 模式脚本地址：
  // 仅允许 iconfont 官方托管域名 at.alicdn.com，避免注入任意第三方脚本
  iconfontUrl: z
    .string()
    .trim()
    .max(2048, "图标库地址过长")
    .refine(
      (v) =>
        v === "" ||
        /^(https?:)?\/\/at\.alicdn\.com\//.test(v),
      "仅支持 iconfont.cn 官方脚本（https://at.alicdn.com/ 开头）"
    )
    .optional()
    .default(""),
  // 随机头像开关（配合 XXAPI 随机头像接口）
  useRandomAvatar: z.boolean().optional().default(false),
  // 右上角欢迎通知
  welcomeEnabled: z.boolean().optional().default(true),
  welcomeIndex: z
    .number()
    .int()
    .min(0, "欢迎语序号不能为负数")
    .max(99, "欢迎语序号过大")
    .optional()
    .default(0),
  welcomeMessages: z
    .string()
    .max(2000, "欢迎语配置过长")
    .refine((v) => {
      try {
        const arr = JSON.parse(v);
        return (
          Array.isArray(arr) &&
          arr.length >= 1 &&
          arr.length <= 20 &&
          arr.every((s) => typeof s === "string")
        );
      } catch {
        return false;
      }
    }, "欢迎语必须为 JSON 字符串数组（1-20 句）")
    .optional()
    .default(JSON.stringify(DEFAULT_WELCOME_MESSAGES)),
  // ===== 高级配置（后台可改，无需重新构建） =====
  // SEO 元信息（空则使用默认值）
  siteTitle: z
    .string()
    .trim()
    .max(128, "站点标题最长 128 字符")
    .optional()
    .default(""),
  siteDescription: z
    .string()
    .trim()
    .max(500, "站点描述最长 500 字符")
    .optional()
    .default(""),
  siteKeywords: z
    .string()
    .trim()
    .max(200, "站点关键词最长 200 字符")
    .optional()
    .default(""),
  // 主题强调色（hex 或留空用默认）
  accentColor: z
    .string()
    .trim()
    .max(16, "强调色最长 16 字符")
    .refine((v) => v === "" || /^#[0-9a-fA-F]{3,8}$/.test(v), "强调色须为 #RRGGBB 格式")
    .optional()
    .default(""),
  // 玻璃卡片：不透明度 0-80（黑底 alpha 百分比）+ 模糊 0-40（px）
  glassOpacity: z
    .number()
    .int()
    .min(0, "不透明度最小为 0")
    .max(80, "不透明度最大为 80")
    .optional()
    .default(28),
  glassBlur: z
    .number()
    .int()
    .min(0, "模糊最小为 0")
    .max(40, "模糊最大为 40")
    .optional()
    .default(16),
  // 统计代码 / 自定义 head 脚本（管理员录入，含基本 XSS 防护）
  // 【High 修复】禁止 iframe / form / javascript: / vbscript: 等危险标签和协议
  analyticsScript: z
    .string()
    .max(20000, "统计代码过长")
    .refine(
      (v) => !/<iframe|<form|action\s*=|javascript:|vbscript:/i.test(v),
      "统计代码不能包含 iframe/form/javascript: 等危险内容"
    )
    .optional()
    .default(""),
  headScript: z
    .string()
    .max(20000, "自定义脚本过长")
    .refine(
      (v) => !/<iframe|<form|action\s*=|javascript:|vbscript:/i.test(v),
      "自定义脚本不能包含 iframe/form/javascript: 等危险内容"
    )
    .optional()
    .default(""),
  // 时钟格式
  timeFormat: z
    .enum(["24", "12"], {
      errorMap: () => ({ message: "时钟格式必须是 24 / 12" }),
    })
    .optional()
    .default("24"),
  showSeconds: z.boolean().optional().default(true),
  dateFormat: z
    .string()
    .trim()
    .max(64, "日期格式最长 64 字符")
    .optional()
    .default("YYYY年M月D日 dddd"),
  // 一言类型（空=随机；a动画 b漫画 c游戏 d文学 e原创 f网络 g其他 h影视 i诗词 j网易云 k哲学 l抖机灵）
  hitokotoType: z
    .enum(["", "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"], {
      errorMap: () => ({ message: "一言类型不合法" }),
    })
    .optional()
    .default(""),
  // 背景遮罩暗化强度 0-80（%）
  bgOverlay: z
    .number()
    .int()
    .min(0, "遮罩强度最小为 0")
    .max(80, "遮罩强度最大为 80")
    .optional()
    .default(0),
  // 头像形状 / 边框颜色
  avatarShape: z
    .enum(["circle", "rounded", "square"], {
      errorMap: () => ({ message: "头像形状必须是 circle / rounded / square" }),
    })
    .optional()
    .default("circle"),
  avatarBorderColor: z
    .string()
    .trim()
    .max(16, "边框颜色最长 16 字符")
    .refine((v) => v === "" || /^#[0-9a-fA-F]{3,8}$/.test(v), "边框颜色须为 #RRGGBB 格式")
    .optional()
    .default(""),
  // 页脚自定义 HTML（管理员录入，视为可信内容，与 analyticsScript 同信任级）
  siteFooterHtml: z
    .string()
    .max(20000, "页脚 HTML 过长")
    .optional()
    .default(""),
});

// 图标字段公共校验：允许以下任一形态（供社交链接、网站链接、友情链接、技能等 icon 字段共用）：
// 1) 纯图标名（lucide:xxx / iconfont symbol / @vicons 预设名）
// 2) Iconify 在线图标（prefix:name，如 fa:github、mdi:home）
// 3) 内联 SVG 代码（<svg …>，长度上限放宽）
// 4) 图片：http(s) 外链、本地上传 /api/uploads/、静态图片路径（/images/…）、随机图 random:/unsplash:
const ICON_NAME_RE = /^[a-zA-Z0-9:_-]+$/;
// 媒体/图片型值：http(s) 外链、站点内相对路径（/images/x.png、/api/uploads/...）、随机图前缀
const MEDIA_VALUE_RE = /^(https?:\/\/|\/(?!\/)|random:|unsplash:)/;
const ICONIFY_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:-[a-z0-9]+)*$/i;

const iconOrMediaValue = (required: boolean) =>
  z
    .string()
    .trim()
    .superRefine((v, ctx) => {
      if (v === "") {
        if (required) ctx.addIssue({ code: "custom", message: "图标不能为空" });
        return;
      }
      // 内联 SVG：单独放行，长度上限放宽（粘贴的 iconfont svg 可能较长）
      if (isInlineSvgValue(v)) {
        if (v.length > 20000) ctx.addIssue({ code: "custom", message: "图标值过长" });
        return;
      }
      if (v.length > 2048) {
        ctx.addIssue({ code: "custom", message: "图标值过长" });
        return;
      }
      const okName = ICON_NAME_RE.test(v);
      const okMedia = MEDIA_VALUE_RE.test(v);
      const okIconify = ICONIFY_RE.test(v);
      // 媒体路径以 / 开头时，额外做 URL 合法性检查（防止非法字符入库）
      const pathOk = !okMedia || !isLocalImagePath(v) || isValidRelativePath(v);
      const ok = okName || (okMedia && pathOk) || okIconify;
      if (!ok) {
        ctx.addIssue({
          code: "custom",
          message: "须为图标名、iconify(prefix:name)、内联 SVG、http(s) 外链、本地图片路径或 random:关键词",
        });
      }
    });

// SocialLink 校验 schema
export const socialLinkSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "名称不能为空")
    .max(32, "名称最长 32 字符"),
  icon: iconOrMediaValue(true),
  url: z
    .string()
    .max(2048, "链接过长")
    .refine(
      (v) => /^(https?:\/\/|mailto:|tel:)/.test(v),
      "链接必须以 http://, https://, mailto: 或 tel: 开头"
    ),
  tip: z
    .string()
    .max(100, "提示文本最长 100 字符")
    .optional()
    .default(""),
  sort: z
    .number()
    .int()
    .min(0, "排序值不能为负数")
    .max(9999, "排序值过大")
    .optional()
    .default(0),
});

export const socialLinkCreateSchema = socialLinkSchema;

// SiteLink 校验 schema
export const siteLinkSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "名称不能为空")
    .max(32, "名称最长 32 字符"),
  icon: iconOrMediaValue(true),
  url: z
    .string()
    .max(2048, "链接过长")
    .refine(
      // music: 为触发页面音乐播放器的伪协议（见 components/SiteLinks.tsx）
      (v) => /^(https?:\/\/|mailto:|tel:|music:)/.test(v),
      "链接必须以 http://, https://, mailto:, tel: 或 music: 开头"
    ),
  sort: z
    .number()
    .int()
    .min(0, "排序值不能为负数")
    .max(9999, "排序值过大")
    .optional()
    .default(0),
});

export const siteLinkCreateSchema = siteLinkSchema;

// FriendLink 校验 schema
export const friendLinkSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "名称不能为空")
    .max(64, "名称最长 64 字符"),
  url: z
    .string()
    .max(2048, "链接过长")
    .refine(
      (v) => /^https?:\/\//.test(v),
      "链接必须以 http:// 或 https:// 开头"
    ),
  icon: iconOrMediaValue(false).optional().default(""),
  description: z
    .string()
    .max(200, "描述最长 200 字符")
    .optional()
    .default(""),
  sort: z
    .number()
    .int()
    .min(0, "排序值不能为负数")
    .max(9999, "排序值过大")
    .optional()
    .default(0),
});

export const friendLinkCreateSchema = friendLinkSchema;

// 作品/项目校验 schema（url/image 允许 http 外链或媒体库相对路径 /api/uploads/...）
const mediaOrUrl = (msg: string) =>
  z.string().max(2048, msg).refine(
    (v) => v === "" || /^(https?:\/\/|\/api\/uploads\/)/.test(v),
    "须为 http(s):// 外链或以 /api/uploads/ 开头的媒体路径"
  );

// 图片字段：在 mediaOrUrl 基础上额外支持关键词随机图（random: / 旧 unsplash:，后台 MediaPicker 可产出）
const imageOrMediaValue = (msg: string) =>
  z.string().max(2048, msg).refine(
    (v) => v === "" || /^(https?:\/\/|\/api\/uploads\/|random:|unsplash:)/.test(v),
    "须为 http(s):// 外链、/api/uploads/ 媒体路径或 random:关键词"
  );

export const projectSchema = z.object({
  title: z.string().trim().min(1, "标题不能为空").max(128, "标题最长 128 字符"),
  description: z.string().max(500, "描述最长 500 字符").optional().default(""),
  url: mediaOrUrl("链接过长").optional().default(""),
  image: imageOrMediaValue("封面图地址过长").optional().default(""),
  tags: z.string().max(200, "标签过长").optional().default(""),
  featured: z.boolean().optional().default(false),
  enabled: z.boolean().optional().default(true),
  sort: z.number().int().min(0).max(9999).optional().default(0),
});

export const projectBatchSchema = z.array(projectSchema.extend({ id: z.number().int().positive().optional() }));

// 技能校验 schema
export const skillSchema = z.object({
  name: z.string().trim().min(1, "技能名不能为空").max(32, "技能名最长 32 字符"),
  level: z.number().int().min(0).max(100).optional().default(0),
  icon: iconOrMediaValue(false).optional().default(""),
  sort: z.number().int().min(0).max(9999).optional().default(0),
});

export const skillBatchSchema = z.array(skillSchema.extend({ id: z.number().int().positive().optional() }));

// 媒体库记录（ImageAsset）校验 schema：用于备份恢复。
// 注意：这里只校验数据库记录，不含图片文件本身——文件位于 data/uploads，需随目录一并拷贝。
export const imageAssetSchema = z.object({
  url: z.string().trim().min(1, "媒体地址不能为空").max(2048, "媒体地址过长"),
  fileName: z.string().trim().min(1, "文件名不能为空").max(255, "文件名过长"),
  mimeType: z.string().trim().max(128, "MIME 过长").optional().default("image/png"),
  size: z.number().int().min(0, "文件大小不能为负").optional().default(0),
  width: z.number().int().min(0, "宽度不能为负").optional().default(0),
  height: z.number().int().min(0, "高度不能为负").optional().default(0),
  usage: z.string().max(64, "用途标识过长").optional().default(""),
});

// 链接点击统计（SiteLinkClick）校验 schema：唯一键为 (kind, linkId)，恢复时按主键回填。
// kind 缺省为 site：v3 及更早备份不含该字段，历史行语义即为「网站链接」，保持向后兼容。
export const linkClickSchema = z.object({
  kind: z.enum(["site", "friend", "project"]).optional().default("site"),
  linkId: z.number().int().positive("链接 ID 必须为正整数"),
  name: z.string().max(100, "名称过长").optional().default(""),
  url: z.string().max(2000, "链接过长").optional().default(""),
  count: z.number().int().min(0, "点击数不能为负").optional().default(0),
});

// 天气设置校验 schema：兼容旧版 /api/weather-setting 调用（已迁移至统一 PUT /api/profile）。
// 注：wttr.in 已下线，路由仅使用 amap / tencent / tencent-key；
// "wttr" / "uapis" 枚举值仅为兼容历史存量数据保留（保存后仍会继续存储，但不会被执行）
export const weatherSettingSchema = z
  .object({
    weatherProvider: z.enum(["wttr", "amap", "tencent", "tencent-key", "tencent-loc-amap", "uapis"], {
      errorMap: () => ({ message: "数据源必须是 amap / tencent / tencent-key / tencent-loc-amap" }),
    }),
    amapKey: z
      .string()
      .trim()
      .max(64, "高德 Key 最长 64 字符")
      .optional()
      .default(""),
    // 高德私钥（数字签名）：key 开启数字签名时必填，未开启可留空
    amapSecretKey: z
      .string()
      .trim()
      .max(64, "高德私钥最长 64 字符")
      .optional()
      .default(""),
    txWeatherKey: z
      .string()
      .trim()
      .max(64, "腾讯 Key 最长 64 字符")
      .optional()
      .default(""),
    // 腾讯位置服务密钥（数字签名）：key 开启签名时必填
    txWeatherSk: z
      .string()
      .trim()
      .max(64, "腾讯密钥最长 64 字符")
      .optional()
      .default(""),
    weatherCity: z
      .string()
      .trim()
      .max(64, "城市名最长 64 字符")
      .optional()
      .default(""),
  })
  .refine(
    (data) => {
      // 高德必须配置 Key；腾讯 Key 版必须配置腾讯位置服务 Key；腾讯（免费版）必须配置城市；
      // 混合模式（腾讯定位 + 高德天气）两方 Key 缺一不可
      if (data.weatherProvider === "amap" && !data.amapKey) return false;
      if (data.weatherProvider === "tencent-key" && !data.txWeatherKey) return false;
      if (data.weatherProvider === "tencent" && !data.weatherCity) return false;
      if (data.weatherProvider === "tencent-loc-amap" && (!data.txWeatherKey || !data.amapKey)) return false;
      return true;
    },
    {
      message:
        "高德需填写 API Key，腾讯 Key 版需填写腾讯位置服务 Key，腾讯免费版需填写城市，混合模式需同时填写腾讯 Key 与高德 Key",
      path: ["root"],
    }
  );
