import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * 后台列表面板的「列表底部添加」入口。
 *
 * 需求：添加入口原本只在面板右上角，条目一多就得先滚回顶部才能接着加，手机上尤其别扭。
 * 现在所有列表型面板的末尾都再提供一个能力相同的入口；顶部那个保留 ——
 * 在顶部时没必要先滚到底。
 *
 * 这里锁住两件事，避免以后新增面板又漏掉、或有人「顺手」把顶部入口删掉：
 * 1. 每个列表型面板都真的用上了 AddRowButton；
 * 2. 顶部与底部两处入口同时存在（不是替换关系）。
 */

const ROOT = new URL("../../", import.meta.url);

/** 列表型面板：文件名 → 顶部添加入口的文案 */
const PANELS: Array<[file: string, label: string]> = [
  ["SkillsPanel.tsx", "添加技能"],
  ["ProjectsPanel.tsx", "添加作品"],
  ["FriendLinksPanel.tsx", "添加链接"],
  ["LinksPanel.tsx", "添加链接"],
  ["AnnouncementPanel.tsx", "新增公告"],
  ["MediaPanel.tsx", "上传图片"],
];

function read(file: string): string {
  return readFileSync(new URL(`components/admin/${file}`, ROOT), "utf8");
}

describe("后台列表面板的底部添加入口", () => {
  it.each(PANELS)("%s 用上了 AddRowButton", (file) => {
    const src = read(file);
    expect(src).toContain("AddRowButton");
    // 必须真的渲染，而不只是 import
    expect(src, `${file} 只导入了 AddRowButton 却没有使用`).toMatch(/<AddRowButton\s/);
  });

  it.each(PANELS)("%s 顶部与底部两处入口并存（底部是补充，不是替换）", (file, label) => {
    const src = read(file);
    const hits = src.split(label).length - 1;
    expect(
      hits,
      `${file} 里「${label}」只出现 ${hits} 次：顶部按钮与底部入口应各一处`
    ).toBeGreaterThanOrEqual(2);
  });

  it("入口抽在公共组件里，样式是整行虚线框（一眼看出是可添加的占位）", () => {
    const panel = read("panel.tsx");
    expect(panel).toMatch(/export function AddRowButton/);
    const body = panel.slice(panel.indexOf("export function AddRowButton"));
    expect(body).toMatch(/border-dashed/);
    expect(body).toMatch(/w-full/);
    // 上传中 / 保存中要能禁用
    expect(body).toMatch(/disabled:opacity-50/);
  });
});
