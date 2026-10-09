import { describe, it, expect } from "vitest";
import { composeRegionLabel } from "@/lib/region-label";

/**
 * 地域标签组合规则。欢迎通知（"来自 X"）与天气接口的 region 字段共用这一份，
 * 最常见的坑是直辖市：ip2region 与腾讯都会给出 province=北京市 / city=北京市，
 * 直接拼接就成了"北京市 北京市"。
 */
describe("composeRegionLabel", () => {
  it("省 + 市", () => {
    expect(composeRegionLabel("广东省", "深圳市")).toBe("广东省 深圳市");
    expect(composeRegionLabel("浙江省", "杭州市")).toBe("浙江省 杭州市");
  });

  it("直辖市省市同名时只保留一个", () => {
    expect(composeRegionLabel("北京市", "北京市")).toBe("北京市");
    expect(composeRegionLabel("上海市", "上海市")).toBe("上海市");
    expect(composeRegionLabel("重庆市", "重庆市")).toBe("重庆市");
  });

  it("市名已含省名时只保留市", () => {
    expect(composeRegionLabel("上海市", "上海市浦东新区")).toBe("上海市浦东新区");
  });

  it("省 + 市 + 区（区级只有逆地理编码与腾讯 IP 库能给到）", () => {
    expect(composeRegionLabel("江苏省", "泰州市", "海陵区")).toBe("江苏省 泰州市 海陵区");
    expect(composeRegionLabel("广东省", "深圳市", "南山区")).toBe("广东省 深圳市 南山区");
  });

  it("直辖市省市同名顶替后仍追加区级", () => {
    expect(composeRegionLabel("北京市", "北京市", "东城区")).toBe("北京市 东城区");
    expect(composeRegionLabel("上海市", "上海市", "浦东新区")).toBe("上海市 浦东新区");
  });

  it("中间级缺失时跳过该级，区级照常显示", () => {
    // 腾讯对部分 IP 只给省 + 区（city 空），此时不能因为中间缺失就丢掉区
    expect(composeRegionLabel("江苏省", "", "海陵区")).toBe("江苏省 海陵区");
    expect(composeRegionLabel("江苏省", undefined, "海陵区")).toBe("江苏省 海陵区");
  });

  it("区级与市级同名时去重（如地级市直管街道场景）", () => {
    expect(composeRegionLabel("广东省", "东莞市", "东莞市")).toBe("广东省 东莞市");
  });

  it("只拿到一级就只显示那一级", () => {
    expect(composeRegionLabel("浙江省", "")).toBe("浙江省");
    expect(composeRegionLabel(undefined, "杭州市")).toBe("杭州市");
    expect(composeRegionLabel("广东省", null)).toBe("广东省");
  });

  it("两级都拿不到返回空串（调用方据此不展示地域）", () => {
    expect(composeRegionLabel("", "")).toBe("");
    expect(composeRegionLabel(undefined, undefined)).toBe("");
    expect(composeRegionLabel(null, [])).toBe("");
  });

  it("兼容外部接口返回数组的写法（高德实测会返回数组）", () => {
    expect(composeRegionLabel(["浙江省"], ["杭州市"])).toBe("浙江省 杭州市");
    expect(composeRegionLabel([], ["杭州市"])).toBe("杭州市");
    expect(composeRegionLabel([""], ["杭州市"])).toBe("杭州市");
  });

  it("去掉首尾空白（外部接口偶尔带空格）", () => {
    expect(composeRegionLabel(" 广东省 ", " 深圳市 ")).toBe("广东省 深圳市");
  });
});
