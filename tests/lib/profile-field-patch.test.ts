import { describe, expect, it } from "vitest";
import { profileFieldPatch } from "@/components/admin/profileShared";

/**
 * 三个 profile 面板（站点信息 / 主题与壁纸 / 音乐设置）读写同一份配置。
 * 保存时必须只提交本面板改动过的字段，否则用面板挂载时的旧快照整份 PUT
 * 会把其它面板刚保存的字段覆盖回旧值 —— 这里覆盖该补丁计算的关键边界。
 */
describe("profileFieldPatch（本面板字段改动补丁）", () => {
  it("只返回相对基线真正变化的键", () => {
    const baseline = { nickname: "旧名", bio: "旧签名", theme: "system" };
    const current = { nickname: "新名", bio: "旧签名", theme: "dark" };
    expect(profileFieldPatch(current, baseline)).toEqual({ nickname: "新名", theme: "dark" });
  });

  it("无改动时返回空对象（不会误带其它面板的字段）", () => {
    const baseline = { nickname: "名", bio: "签", theme: "dark", accentColor: "#fff" };
    expect(profileFieldPatch({ ...baseline }, baseline)).toEqual({});
  });

  it("基线为 null/undefined（尚未载入）时视为无改动，避免把整份表单当成改动提交", () => {
    expect(profileFieldPatch({ nickname: "名" }, null)).toEqual({});
    expect(profileFieldPatch({ nickname: "名" }, undefined)).toEqual({});
  });

  it("能识别新增键与显式清空（置空字符串/0/false 都算改动）", () => {
    const baseline = { accentColor: "#7dd3fc", glassOpacity: 28, dynamicTitle: true };
    const current = { accentColor: "", glassOpacity: 0, dynamicTitle: false };
    expect(profileFieldPatch(current, baseline)).toEqual({
      accentColor: "",
      glassOpacity: 0,
      dynamicTitle: false,
    });
  });

  it("改变字段类型（数字→字符串）同样视为改动", () => {
    expect(profileFieldPatch({ wallpaperRefresh: "10" }, { wallpaperRefresh: 10 })).toEqual({
      wallpaperRefresh: "10",
    });
  });

  it("不修改传入对象（纯函数）", () => {
    const current = { nickname: "新名", bio: "" };
    const baseline = { nickname: "旧名", bio: "" };
    const snapshotCurrent = { ...current };
    const snapshotBaseline = { ...baseline };
    profileFieldPatch(current, baseline);
    expect(current).toEqual(snapshotCurrent);
    expect(baseline).toEqual(snapshotBaseline);
  });
});
