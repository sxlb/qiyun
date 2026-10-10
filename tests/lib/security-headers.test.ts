import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

/**
 * 安全响应头的关键项断言。
 *
 * 为什么单独锁住 Permissions-Policy 的 geolocation：它是「静默失败」的典型 ——
 * 写成 `geolocation=()` 等于把 allowlist 置空，浏览器**不弹授权框**，
 * `getCurrentPosition` 直接回调 PERMISSION_DENIED，前台只表现为
 * 「点了没反应 / 地域标签还是 IP 归属地」，控制台连报错都没有。
 * 收紧安全头时很容易顺手把定位一并禁掉，所以用断言把「必须放行同源」钉住。
 *
 * 断言的是 `nextConfig.headers()` 的返回值（真实生效值），而非源码文本，
 * 这样调整配置写法不会误报，只有行为真的变了才会失败。
 */
describe("安全响应头 · Permissions-Policy", () => {
  it("放行同源定位（浏览器精确定位依赖），摄像头与麦克风继续禁用", async () => {
    const groups = (await nextConfig.headers?.()) ?? [];
    const value = groups
      .flatMap((group) => group.headers)
      .find((header) => header.key === "Permissions-Policy")?.value;

    expect(value).toBeTruthy();
    expect(value).toContain("geolocation=(self)");
    // 空 allowlist 会让访客端定位静默失效，是本仓库踩过的坑，单独钉一道
    expect(value).not.toContain("geolocation=()");
    expect(value).toContain("camera=()");
    expect(value).toContain("microphone=()");
  });
});
