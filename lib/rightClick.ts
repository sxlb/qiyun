/**
 * 前端右键行为（后台「站点信息 → 前端右键行为」三选一）。
 *
 * - `default`  浏览器原生菜单（默认，等于不改现状）
 * - `disabled` 静默禁用右键。**只是提高复制门槛，不是内容保护**：
 *              F12、地址栏直接访问、禁用 JS、抓包都能绕过。
 * - `menu`     弹本站自定义功能菜单。定位是「本站能力清单」而非通用导航菜单
 *              （首页 / 前进 / 后退这类浏览器自己就有，不复刻），条目按当前上下文裁剪。
 *              唯一的例外是「重新加载页面」：右键一旦被接管，原生菜单里的重载也一并没了，
 *              只剩工具栏那一个入口，补回来才算接管得完整。
 *
 * 本模块只放纯数据与纯函数，图标与副作用留在组件里 —— 这样「什么情况下出现哪些条目」
 * 可以脱离 DOM 单测。
 */

export type RightClickMode = "default" | "disabled" | "menu";

/** 后台下拉选项（后台面板与文档共用同一份，避免两处各写一份文案） */
export const RIGHT_CLICK_MODE_OPTIONS: {
  value: RightClickMode;
  label: string;
  hint: string;
}[] = [
  { value: "default", label: "浏览器原生菜单", hint: "不做任何拦截（默认）" },
  {
    value: "disabled",
    label: "禁用右键",
    hint: "右键静默失效；输入框与可编辑区域内仍保留原生菜单，否则无法粘贴",
  },
  {
    value: "menu",
    label: "自定义站内功能菜单",
    hint: "弹出音乐控制 / 换壁纸 / 回到顶部 / 重新加载 / 复制等本站功能，按上下文裁剪条目",
  },
];

const RIGHT_CLICK_MODE_VALUES: string[] = RIGHT_CLICK_MODE_OPTIONS.map((o) => o.value);

/**
 * 收敛任意来源的取值：非法值 / 空值 / 历史脏值一律回落 `default`。
 * 不做「非法值也当 menu」之类的兜底 —— 那会让后台填错一个字就把访客的右键换掉。
 */
export function normalizeRightClickMode(value: unknown): RightClickMode {
  return typeof value === "string" && RIGHT_CLICK_MODE_VALUES.includes(value)
    ? (value as RightClickMode)
    : "default";
}

/** 菜单项动作：组件按它决定图标与执行逻辑 */
export type ContextMenuAction =
  | "open-link"
  | "copy-link-address"
  | "copy-selection"
  | "search-selection"
  | "toggle-play"
  | "prev-track"
  | "next-track"
  | "open-playlist"
  | "next-wallpaper"
  | "scroll-top"
  | "open-command-palette"
  | "copy-page-link"
  | "reload-page";

/** 分组：换组时渲染一条分隔线，让「链接 / 选中 / 音乐 / 页面」四类一眼可分 */
export type ContextMenuGroup = "link" | "selection" | "music" | "page";

export interface ContextMenuItem {
  action: ContextMenuAction;
  label: string;
  group: ContextMenuGroup;
}

export interface ContextMenuContext {
  /** 当前页面有选中文字（选中时把「复制 / 搜索选中」提到最前，这是右键最高频的意图） */
  hasSelection: boolean;
  /** 歌单已加载：没有歌单时切歌类条目没有意义，直接不出现 */
  hasPlaylist: boolean;
  /**
   * 壁纸源是否支持「换一张」。
   * 只有随机源（风景 / 动漫）才谈得上换 —— 必应每日一图当天是同一张、自定义地址是固定值，
   * 这两类点了不会有变化，因此不展示该条目。菜单里最忌讳点了没反应。
   * （服务端也只对这两类源接受 force 参数，两边条件保持一致。）
   */
  canSwitchWallpaper: boolean;
  /** 命令面板开关（后台关掉后不再展示入口） */
  commandPaletteEnabled: boolean;
  /** 右键落点是链接时填其 href（用于「在新标签页打开 / 复制链接地址」） */
  linkHref: string;
}

/** 选中文字的搜索入口：百度对国内网络可直连，不依赖外网可达性 */
export const SELECTION_SEARCH_BASE = "https://www.baidu.com/s?wd=";

/** 播放控制组（歌单为空时不出现） */
const MUSIC_ITEMS: ContextMenuItem[] = [
  { action: "toggle-play", label: "播放 / 暂停", group: "music" },
  { action: "prev-track", label: "上一首", group: "music" },
  { action: "next-track", label: "下一首", group: "music" },
];

/**
 * 按当前上下文组装菜单（顺序即展示顺序）。
 *
 * 恒存在的「打开音乐列表」放在音乐组末尾：歌单没配好时它依然有用 ——
 * 弹窗里会直接提示去后台填写歌单 ID，比让用户猜要好。
 */
export function buildContextMenu(ctx: ContextMenuContext): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];

  if (ctx.linkHref) {
    items.push(
      { action: "open-link", label: "在新标签页打开", group: "link" },
      { action: "copy-link-address", label: "复制链接地址", group: "link" }
    );
  }

  if (ctx.hasSelection) {
    items.push(
      { action: "copy-selection", label: "复制选中文字", group: "selection" },
      { action: "search-selection", label: "搜索选中文字", group: "selection" }
    );
  }

  if (ctx.hasPlaylist) items.push(...MUSIC_ITEMS);
  items.push({ action: "open-playlist", label: "打开音乐列表", group: "music" });

  if (ctx.canSwitchWallpaper) {
    items.push({ action: "next-wallpaper", label: "换一张壁纸", group: "page" });
  }
  items.push({ action: "scroll-top", label: "回到顶部", group: "page" });
  if (ctx.commandPaletteEnabled) {
    items.push({ action: "open-command-palette", label: "打开命令面板", group: "page" });
  }

  items.push({ action: "copy-page-link", label: "复制本页链接", group: "page" });
  // 放在最末：重载会丢掉页面内的临时状态（音乐播放进度、已展开的面板），
  // 与高频条目拉开距离，减少误点
  items.push({ action: "reload-page", label: "重新加载页面", group: "page" });

  return items;
}

/** 表单控件 / 可编辑区域：右键一律放行原生菜单（否则连粘贴都用不了） */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return true;
  }
  // 同时看属性与 isContentEditable：jsdom 未实现后者（返回 undefined），
  // 只看它会让这条判断在测试环境里静默失效
  return target.isContentEditable === true || target.contentEditable === "true";
}

/**
 * 是否应拦截这次右键。
 *
 * 两条放行规则：
 * 1. 表单控件 / 可编辑区域 —— 原生菜单里的粘贴、拼写检查不可替代；
 * 2. 粗指针（触屏）—— 长按会派发 contextmenu，拦掉会让移动端既没原生菜单、
 *    也没法长按选词，体验直接崩掉。桌面触屏混用设备按「主指针是否为粗指针」判断。
 */
export function shouldInterceptContextMenu(input: {
  target: EventTarget | null;
  mode: RightClickMode;
  coarsePointer: boolean;
}): boolean {
  if (input.mode === "default") return false;
  if (input.coarsePointer) return false;
  if (isEditableTarget(input.target)) return false;
  return true;
}

/** 从右键落点向上找最近的链接 href（相对地址补全为绝对地址），没有则返回空串 */
export function findLinkHref(target: EventTarget | null, baseUrl: string): string {
  if (!(target instanceof Element)) return "";
  const anchor = target.closest("a[href]");
  const href = anchor?.getAttribute("href")?.trim() || "";
  if (!href) return "";
  // 站内锚点（#xxx）与 javascript: 之类不当作可打开的链接
  if (!/^https?:\/\//i.test(href) && !href.startsWith("/")) return "";
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return "";
  }
}
