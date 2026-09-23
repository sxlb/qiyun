import { describe, it, expect } from "vitest";
import { profileSchema } from "@/lib/validation";
import { getChangedProfileFields, diffProfile } from "@/lib/server";

describe("getChangedProfileFields（基于 profileSchema 派生的字段清单）", () => {
  it("能识别此前被 diffProfile 漏掉的 friendLinksTitle 与 iconfontUrl", () => {
    const before = { friendLinksTitle: "友情链接", iconfontUrl: "" };
    const after = { friendLinksTitle: "友链", iconfontUrl: "https://at.alicdn.com/x.js" };
    expect(getChangedProfileFields(before, after)).toContain("friendLinksTitle");
    expect(getChangedProfileFields(before, after)).toContain("iconfontUrl");
  });

  it("无变化时返回空数组", () => {
    const base = { nickname: "无名", bio: "" };
    expect(getChangedProfileFields(base, { ...base })).toEqual([]);
  });

  it("字段清单与 profileSchema.shape 键集合一致（不再手工维护）", () => {
    const schemaKeys = Object.keys(profileSchema.shape);
    const all = schemaKeys.reduce<Record<string, unknown>>((acc, k) => {
      acc[k] = "";
      return acc;
    }, {});
    const changed = getChangedProfileFields(all, { ...all, nickname: "新名" });
    expect(changed).toEqual(["nickname"]);
  });
});

describe("diffProfile（敏感字段脱敏）", () => {
  it("amapSecretKey / txWeatherSk 不会把真实值写入日志 detail", () => {
    const { detail } = diffProfile(
      { amapSecretKey: "", txWeatherSk: "", nickname: "a" },
      { amapSecretKey: "SECRET_AMAP", txWeatherSk: "SECRET_TX", nickname: "a" }
    );
    expect(detail).not.toContain("SECRET_AMAP");
    expect(detail).not.toContain("SECRET_TX");
    expect(detail).toContain("已配置");
  });

  it("analyticsScript / headScript / siteFooterHtml 完整脚本全文不入日志，仅记已配置/未配置", () => {
    const script = "<script>console.log('TRACKING_SECRET')</script>";
    const { summary, detail } = diffProfile(
      { analyticsScript: "", headScript: "", siteFooterHtml: "", nickname: "a" },
      { analyticsScript: script, headScript: script, siteFooterHtml: script, nickname: "a" }
    );
    expect(summary).toContain("analyticsScript");
    expect(detail).not.toContain("TRACKING_SECRET");
    expect(detail).not.toContain("<script>");
    expect(detail).toContain("已配置");
  });
});