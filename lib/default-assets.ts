/**
 * 项目内置的默认媒体资源。
 *
 * 背景：首页壁纸与头像此前完全依赖第三方接口（必应每日壁纸 / t.mwm.moe 图床 / 随机头像接口）。
 * lib/external-api.ts 解决了「上游失效时能换源」，但没有解决「换不到源时至少还有图」——
 * 部署环境无外网、或上游临时挂掉时，首页会退化成一块纯色噪点占位，头像位留空。
 *
 * 这里把若干图片随仓库与镜像一起发布（public/images/ 下的静态资源，运行时零外部请求），
 * 作为最后兜底：外部源与服务端缓存都拿不到图时使用，保证首页永远有一张真实背景与头像。
 *
 * 素材来源与处理（自用项目，非商用）：
 * - 风景 01-03 与 06-07：https://t.mwm.moe/fj（对应 EXTERNAL_API_DEFAULTS.wallpaperLandscapeApi）
 * - 动漫 04-05：https://t.mwm.moe/mp（对应 EXTERNAL_API_DEFAULTS.wallpaperAnimeApi）
 * - 头像：由站点所有者提供的 640×640 PNG 处理得到，非第三方素材
 *
 * 尺寸口径：7 张壁纸统一 1920×1080 / WebP，**全部为原生分辨率（无放大）**。
 * 随机源会返回竖图（实测动漫源 12 次抽样全是竖图），直接交给前台 cover 铺满会被裁成中间一条
 * 横带，故入库前统一裁成横版构图（竖图走 attention 策略自动定位主体，横图居中裁）。
 *
 * 说明：06-07 曾因只保留过候选缩略图而一度是「放大到 1920×1080」的版本，清晰度偏软；
 * 后经从同一随机源反复抽样并比对平均哈希，找回了这两张原图并以原生分辨率重做，现与其余几张一致。
 *
 * 注意：本模块会被客户端组件（Background）引用，**不得引入 node: 内置模块**。
 */

/** 内置默认壁纸（风景） */
export const DEFAULT_LANDSCAPE_WALLPAPERS: readonly string[] = [
  "/images/wallpaper/01.webp",
  "/images/wallpaper/02.webp",
  "/images/wallpaper/03.webp",
  "/images/wallpaper/06.webp",
  "/images/wallpaper/07.webp",
];

/** 内置默认壁纸（动漫） */
export const DEFAULT_ANIME_WALLPAPERS: readonly string[] = [
  "/images/wallpaper/04.webp",
  "/images/wallpaper/05.webp",
];

/** 全部内置默认壁纸 */
export const DEFAULT_WALLPAPERS: readonly string[] = [
  ...DEFAULT_LANDSCAPE_WALLPAPERS,
  ...DEFAULT_ANIME_WALLPAPERS,
];

/** 内置默认头像 */
export const DEFAULT_AVATAR = "/images/avatar/default.webp";

/**
 * 随机取一张内置默认壁纸。
 *
 * 按 coverType 尽量取同类：landscape 只取风景、anime 只取动漫，
 * 其余（bing / custom / 未配置）从全部里取 —— 这样兜底图与后台选的壁纸种类保持一致，
 * 不会出现「选了动漫，兜底却给一张风景」的错位。
 */
export function pickRandomDefaultWallpaper(coverType?: string): string {
  const pool =
    coverType === "landscape"
      ? DEFAULT_LANDSCAPE_WALLPAPERS
      : coverType === "anime"
        ? DEFAULT_ANIME_WALLPAPERS
        : DEFAULT_WALLPAPERS;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * 头像兜底：配置为空（含 null / undefined / 纯空白）时使用内置默认头像。
 * 随机头像接口失败会返回空串，正是走这里兜底，避免头像位留空。
 */
export function avatarOrDefault(avatar: string | null | undefined): string {
  return (avatar ?? "").trim() || DEFAULT_AVATAR;
}
