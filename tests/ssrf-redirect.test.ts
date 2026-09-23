import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchFollowingSafeRedirects, MAX_SAFE_REDIRECTS, UnsafeUrlError } from "@/lib/ssrf";

/**
 * 出站请求的逐跳 SSRF 校验（fetchFollowingSafeRedirects）。
 *
 * 用例全部使用**字面量 IP** 而不是域名：
 * assertPublicHttpUrl 对字面量 IP 直接判定、不做 DNS 解析，测试因此零网络依赖。
 * 公网用 93.184.216.34（example.com 的固定地址），内网用 169.254.169.254（云元数据）。
 */
const PUBLIC = "http://93.184.216.34";
const METADATA = "http://169.254.169.254";

function redirect(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
}

function ok(body = "hello"): Response {
  return new Response(body, { status: 200 });
}

describe("fetchFollowingSafeRedirects（逐跳 SSRF 校验）", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("公网直达：只请求一次，返回最终 URL，且禁止 fetch 自动跟随重定向", async () => {
    fetchMock.mockResolvedValue(ok());

    const { response, finalUrl } = await fetchFollowingSafeRedirects(`${PUBLIC}/a`);

    expect(response.status).toBe(200);
    expect(finalUrl).toBe(`${PUBLIC}/a`);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // 关键：必须用 manual。用 follow 会静默跳过所有中间地址的校验
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
  });

  it("跟随公网重定向，并把相对 Location 基于当前 URL 解析", async () => {
    fetchMock
      .mockResolvedValueOnce(redirect(`${PUBLIC}/b`))
      .mockResolvedValueOnce(redirect("/c"))
      .mockResolvedValueOnce(ok());

    const { finalUrl } = await fetchFollowingSafeRedirects(`${PUBLIC}/a`);

    expect(finalUrl).toBe(`${PUBLIC}/c`);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("重定向到内网/云元数据地址时拒绝，且从不请求该地址（防盲 SSRF）", async () => {
    fetchMock.mockResolvedValueOnce(redirect(`${METADATA}/latest/meta-data`));

    await expect(fetchFollowingSafeRedirects(`${PUBLIC}/a`)).rejects.toBeInstanceOf(UnsafeUrlError);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.every(([u]) => !String(u).includes("169.254.169.254"))).toBe(true);
  });

  it("多跳中任意一跳落到内网都会被拦截", async () => {
    fetchMock
      .mockResolvedValueOnce(redirect(`${PUBLIC}/b`))
      .mockResolvedValueOnce(redirect(`${METADATA}/x`));

    await expect(fetchFollowingSafeRedirects(`${PUBLIC}/a`)).rejects.toBeInstanceOf(UnsafeUrlError);
    expect(fetchMock.mock.calls.every(([u]) => !String(u).includes("169.254.169.254"))).toBe(true);
  });

  it("起始地址本身为内网时直接拒绝，不发起任何请求", async () => {
    await expect(fetchFollowingSafeRedirects(`${METADATA}/x`)).rejects.toBeInstanceOf(UnsafeUrlError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("非 http/https 协议直接拒绝", async () => {
    await expect(fetchFollowingSafeRedirects("file:///etc/passwd")).rejects.toBeInstanceOf(UnsafeUrlError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("重定向次数超过上限时拒绝", async () => {
    let n = 0;
    fetchMock.mockImplementation(async () => redirect(`${PUBLIC}/hop-${++n}`));

    await expect(fetchFollowingSafeRedirects(`${PUBLIC}/a`)).rejects.toThrow(/重定向次数/);
    // 循环覆盖 hop = 0..maxRedirects，共 maxRedirects + 1 次请求
    expect(fetchMock).toHaveBeenCalledTimes(MAX_SAFE_REDIRECTS + 1);
  });

  it("自定义 maxRedirects 生效", async () => {
    let n = 0;
    fetchMock.mockImplementation(async () => redirect(`${PUBLIC}/hop-${++n}`));

    await expect(fetchFollowingSafeRedirects(`${PUBLIC}/a`, { maxRedirects: 1 })).rejects.toThrow(/重定向次数/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("3xx 缺少 Location 时抛错，而不是把 3xx 当成功结果返回", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 302 }));

    await expect(fetchFollowingSafeRedirects(`${PUBLIC}/a`)).rejects.toThrow(/Location/);
  });

  it("3xx 响应体会被主动取消，避免占住连接导致连接池泄漏", async () => {
    const withBody = new Response("redirect-body-should-be-dropped", {
      status: 302,
      headers: { location: `${PUBLIC}/b` },
    });
    const cancel = vi.spyOn(withBody.body!, "cancel");
    fetchMock.mockResolvedValueOnce(withBody).mockResolvedValueOnce(ok());

    await fetchFollowingSafeRedirects(`${PUBLIC}/a`);

    expect(cancel).toHaveBeenCalled();
  });

  it("allowPrivate 放行内网（仅用于管理员显式配置的自建服务）", async () => {
    fetchMock.mockResolvedValue(ok());

    const { response } = await fetchFollowingSafeRedirects("http://127.0.0.1:3000/api", {
      allowPrivate: true,
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("非 2xx 的错误响应原样交还调用方判断", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 404 }));

    const { response } = await fetchFollowingSafeRedirects(`${PUBLIC}/missing`);

    expect(response.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("透传 signal 与自定义请求头", async () => {
    fetchMock.mockResolvedValue(ok());
    const controller = new AbortController();

    await fetchFollowingSafeRedirects(`${PUBLIC}/a`, {
      signal: controller.signal,
      headers: { "User-Agent": "test-agent" },
    });

    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      signal: controller.signal,
      headers: { "User-Agent": "test-agent" },
      method: "GET",
    });
  });
});
