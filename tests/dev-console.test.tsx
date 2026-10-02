// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { DevConsole } from "@/components/DecorativeEffects";

describe("DevConsole", () => {
  it("enabled=false 时不输出任何 console 内容", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    render(<DevConsole enabled={false} siteName="测试站" />);
    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("enabled=true 时输出 ASCII 艺术字（多行）", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    render(<DevConsole enabled siteName="测试站" />);
    // 艺术字第一行 + 站点名横幅 + 版权提示 = 3 次 console.log
    expect(logSpy).toHaveBeenCalledTimes(3);
    logSpy.mockRestore();
  });

  it("ASCII 艺术字内容包含站点标识字样", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    render(<DevConsole enabled siteName="我的主页" />);
    const firstCall = logSpy.mock.calls[0] ?? [];
    const formatted = firstCall.map(String).join("");
    // 艺术字由块字符组成，应包含类块字符
    expect(formatted).toMatch(/[█▀▄╔╗╚╝═]/);
    logSpy.mockRestore();
  });

  it("横幅信息包含站点名与欢迎语", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    render(<DevConsole enabled siteName="我的主页" />);
    const secondCall = logSpy.mock.calls[1] ?? [];
    const formatted = secondCall.map(String).join("");
    expect(formatted).toContain("我的主页");
    expect(formatted).toContain("欢迎访问");
    logSpy.mockRestore();
  });

  it("siteName 缺省时使用默认名称", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    render(<DevConsole enabled />);
    const secondCall = logSpy.mock.calls[1] ?? [];
    expect(secondCall.map(String).join("")).toContain("个人主页");
    logSpy.mockRestore();
  });

  it("组件渲染结果为空（无 DOM 输出）", () => {
    const { container } = render(<DevConsole enabled />);
    expect(container).toBeEmptyDOMElement();
  });
});
