import { describe, it, expect } from "vitest";
import {
  LUCIDE_PREFIX,
  LUCIDE_ICON_WHITELIST,
  LUCIDE_ICONS_BY_NAME,
  LUCIDE_ICON_NAMES,
  pascalToKebabCase,
  isLucideIcon,
  extractLucideIconName,
  getLucideIconByName,
  resolveLucideIcon,
} from "@/components/lucideIconResolver";

/**
 * Lucide 图标解析器：白名单是唯一数据源。
 *
 * 后台选择器的候选列表与前台渲染的查表都从 LUCIDE_ICON_WHITELIST 派生。
 * 这里锁住该契约的核心不变量 —— **PascalCase 导出名转 kebab 后不得互相碰撞**，
 * 一旦碰撞就会有图标被静默吞掉（选择器里看得见、存进去却查不到）。
 */

describe("pascalToKebabCase：转换规则", () => {
  it("驼峰转连字符", () => {
    expect(pascalToKebabCase("ChevronsRight")).toBe("chevrons-right");
    expect(pascalToKebabCase("ArrowUpRight")).toBe("arrow-up-right");
    expect(pascalToKebabCase("BookOpen")).toBe("book-open");
  });

  it("字母与数字之间补连字符（避免 settings2 这类不可读名）", () => {
    expect(pascalToKebabCase("Settings2")).toBe("settings-2");
    expect(pascalToKebabCase("BarChart3")).toBe("bar-chart-3");
    expect(pascalToKebabCase("Gamepad2")).toBe("gamepad-2");
  });

  it("单词名原样小写", () => {
    expect(pascalToKebabCase("Github")).toBe("github");
    expect(pascalToKebabCase("Zap")).toBe("zap");
  });
});

describe("白名单派生：单一数据源无碰撞", () => {
  it("派生出的 kebab 条目数与白名单一致（说明无重名碰撞）", () => {
    expect(Object.keys(LUCIDE_ICONS_BY_NAME).length).toBe(
      Object.keys(LUCIDE_ICON_WHITELIST).length
    );
  });

  it("白名单规模符合预期（合并两套清单后的并集）", () => {
    expect(LUCIDE_ICON_NAMES.length).toBe(163);
  });

  it("全部派生名均为合法 kebab 格式（小写字母/数字，连字符分隔）", () => {
    for (const name of LUCIDE_ICON_NAMES) {
      expect(name, `非法图标名: ${name}`).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });

  it("名称列表与映射表键集合一致", () => {
    expect(new Set(LUCIDE_ICON_NAMES)).toEqual(new Set(Object.keys(LUCIDE_ICONS_BY_NAME)));
  });
});

describe("查表与解析", () => {
  it("getLucideIconByName 命中白名单内的 kebab 名", () => {
    expect(getLucideIconByName("github")).toBe(LUCIDE_ICONS_BY_NAME.github);
    expect(getLucideIconByName("settings-2")).toBe(LUCIDE_ICONS_BY_NAME["settings-2"]);
  });

  it("每个派生名都能通过 lucide: 值解析回同一组件（存与取闭环）", () => {
    for (const name of LUCIDE_ICON_NAMES) {
      expect(resolveLucideIcon(`${LUCIDE_PREFIX}${name}`), `解析失败: ${name}`).toBe(
        LUCIDE_ICONS_BY_NAME[name]
      );
    }
  });

  it("未收录的名字返回 null（调用方据此回退默认图标）", () => {
    expect(getLucideIconByName("not-a-real-icon")).toBeNull();
    expect(resolveLucideIcon("lucide:not-a-real-icon")).toBeNull();
  });

  it("非 lucide 值不进入 lucide 解析分支", () => {
    expect(resolveLucideIcon("mdi:home")).toBeNull();
    expect(resolveLucideIcon("https://example.com/a.png")).toBeNull();
    expect(resolveLucideIcon("")).toBeNull();
  });
});

describe("前缀判定", () => {
  it("isLucideIcon 只认 lucide: 前缀", () => {
    expect(isLucideIcon("lucide:github")).toBe(true);
    expect(isLucideIcon("github")).toBe(false);
    expect(isLucideIcon("fa6-solid:user")).toBe(false);
  });

  it("extractLucideIconName 去掉前缀，非 lucide 值返回空串", () => {
    expect(extractLucideIconName("lucide:chevron-right")).toBe("chevron-right");
    expect(extractLucideIconName("mdi:home")).toBe("");
  });
});