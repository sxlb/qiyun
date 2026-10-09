import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { amapSign, buildAmapParams, describeAmapError } from "@/lib/amap";

/**
 * 高德 Web 服务 API 的数字签名。
 *
 * 为什么单独成文件：**凡是调高德的地方都必须签名**。健康检查曾经只传 key 不带 sig，
 * 于是所有开了「数字签名」的 Key 都会被高德以 HTTP 200 + INVALID_USER_SIGNATURE 拒掉，
 * 被后台服务状态误报成「Key 无效或权限不足」——用户明明配对了却在找错方向。
 * 现在签名统一走 lib/amap.ts，这组测试负责锁住格式，防止有人再各写一套。
 *
 * 官方规范（FAQ「如何添加数字签名？」）：
 * - sig = MD5(请求参数（含 key）按键名升序的 "k=v&k=v" 拼接串 **直接** 拼接私钥)
 * - 拼接内容必须是 UTF-8
 * - **计算签名时参数值不做 URL 编码**，只有真正发请求时才 urlencode
 * - 排序按参数名字典序（首字母相同则比第二个字母）
 */

const SECRET = "abcsecret123";

/** 独立按官方规范再实现一遍，避免「实现与测试一起写错」时双双通过 */
function expected(params: Record<string, string>, secret: string): string {
  const query = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return createHash("md5").update(`${query}${secret}`, "utf8").digest("hex");
}

describe("高德数字签名", () => {
  it("键名升序拼接后直接拼私钥，输出小写 MD5（固定向量）", () => {
    const params = { key: "K1", city: "210000", extensions: "base" };
    // 硬编码向量：与官方示例同构（a=23&b=12&c=67&d=48&f=8bbbbb）。
    // 一旦有人改了排序方向、误加 & 前缀、或改用大写 hex，这条立刻变红
    expect(amapSign(params, SECRET)).toBe("de06c4c0a4ecc5c28338a6eab0cd1caf");
    expect(amapSign(params, SECRET)).toBe(expected(params, SECRET));
  });

  it("入参顺序不影响结果；改动任一参数值都会改变结果", () => {
    const a = amapSign({ key: "K1", city: "210000" }, SECRET);
    expect(amapSign({ city: "210000", key: "K1" }, SECRET)).toBe(a);
    expect(amapSign({ key: "K1", city: "110000" }, SECRET)).not.toBe(a);
  });

  it("中文参数值按原文参与计算（官方：签名时不 urlencode，仅请求时编码）", () => {
    const params = { key: "K1", city: "盐城市" };
    expect(amapSign(params, SECRET)).toBe("3616aa732274ab514ec64fa139ef923b");
    // 拿编码后的值去算会得到另一个签名 —— 那正是会稳定返回 INVALID_USER_SIGNATURE 的写法。
    // 这条存在的意义：中文城市名（站主配的固定城市、或 IP 定位回退出的市级名称）会真的走进签名
    expect(amapSign(params, SECRET)).not.toBe(
      amapSign({ key: "K1", city: encodeURIComponent("盐城市") }, SECRET)
    );
  });
});

describe("buildAmapParams", () => {
  it("私钥非空时附带 sig，值为按规范算出的签名", () => {
    const base = { key: "K1", city: "盐城市" };
    const sp = buildAmapParams(base, SECRET);
    expect(sp.get("sig")).toBe(amapSign(base, SECRET));
    expect(sp.get("key")).toBe("K1");
  });

  it("私钥为空时不带 sig（未开数字签名的 Key 带上无意义的 sig 反而会被拒）", () => {
    const sp = buildAmapParams({ key: "K1" }, "");
    expect(sp.get("sig")).toBeNull();
    expect(sp.get("key")).toBe("K1");
  });

  it("序列化到请求串时才做 URL 编码（与签名前的原文分离）", () => {
    const sp = buildAmapParams({ key: "K1", city: "盐城市" }, SECRET);
    // 签名用的是原文，但出站请求里的值必须是编码后的
    expect(sp.toString()).toContain(`city=${encodeURIComponent("盐城市")}`);
    expect(sp.toString()).not.toContain("city=盐城市");
  });
});

describe("describeAmapError（高德 HTTP 恒为 200，成败看 body.status）", () => {
  it("status=1 视为成功，不产生错误文案", () => {
    expect(describeAmapError({ status: "1", lives: [] })).toBeNull();
  });

  it("签名未通过时提示核对私钥，而不是误导性的「Key 无效」", () => {
    const msg = describeAmapError({ status: "0", info: "INVALID_USER_SIGNATURE", infocode: "10007" });
    expect(msg).toContain("私钥");
    expect(msg).not.toContain("Key 无效");
  });

  it("Key 本身无效或权限不足时提示 Key", () => {
    expect(describeAmapError({ status: "0", info: "INVALID_USER_KEY" })).toBe("Key 无效或权限不足");
    expect(describeAmapError({ status: "0", info: "SERVICE_NOT_AVAILABLE" })).toBe("Key 无效或权限不足");
  });

  it("其余失败原样透出高德 info，便于按原文排查", () => {
    expect(describeAmapError({ status: "0", info: "DAILY_QUERY_OVER_LIMIT" })).toBe("DAILY_QUERY_OVER_LIMIT");
  });

  it("拿不到 body（非对象 / null）时返回 null，由调用方给兜底文案", () => {
    expect(describeAmapError(null)).toBeNull();
    expect(describeAmapError(undefined)).toBeNull();
    expect(describeAmapError("oops")).toBeNull();
  });
});
