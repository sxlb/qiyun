// ScriptInjector 净化逻辑测试：on* 事件 / javascript: 协议 / srcdoc 应被拦截
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import ScriptInjector from "@/components/ScriptInjector";

afterEach(() => {
  cleanup(); // 卸载组件会触发 ScriptInjector 的 cleanup，移除注入的 head 节点
});

function headMeta(name: string): HTMLElement | null {
  return document.head.querySelector(`meta[name="${name}"]`);
}

describe("ScriptInjector（后台脚本注入净化）", () => {
  it("on* 事件属性被拦截", () => {
    render(<ScriptInjector scripts={['<meta name="safe1" content="ok" onclick="alert(1)" />']} />);
    const meta = headMeta("safe1");
    expect(meta).not.toBeNull();
    expect(meta).not.toHaveAttribute("onclick");
    expect(meta).toHaveAttribute("content", "ok");
  });

  it("javascript: 协议 URL 被拦截", () => {
    render(<ScriptInjector scripts={['<link rel="stylesheet" href="javascript:alert(1)" />']} />);
    const link = document.head.querySelector('link[rel="stylesheet"][href^="javascript"]');
    // href 未携带 javascript: 协议（可能整条未注入或 href 被剥离）
    expect(link).toBeNull();
  });

  it("data: 协议 URL 被拦截", () => {
    render(<ScriptInjector scripts={['<link rel="stylesheet" href="data:text/html,<script>1</script>" />']} />);
    const link = document.head.querySelector('link[href^="data:"]');
    expect(link).toBeNull();
  });

  it("srcdoc 属性被直接拦截（内容即 HTML，可内嵌脚本）", () => {
    render(
      <ScriptInjector
        scripts={['<meta name="safe2" content="ok" srcdoc="<script>alert(1)</script>" />']}
      />
    );
    const meta = headMeta("safe2");
    expect(meta).not.toBeNull();
    expect(meta).not.toHaveAttribute("srcdoc");
  });

  it("裸 JS 作为脚本正文注入", () => {
    render(<ScriptInjector scripts={["window.__test_marker = 42;"]} />);
    const script = Array.from(document.head.querySelectorAll("script")).find((s) =>
      s.textContent?.includes("__test_marker")
    );
    expect(script).toBeDefined();
    expect(script?.textContent).toContain("window.__test_marker = 42;");
  });

  it("外部 script 的合法 src 保留，非法 src 被剥离", () => {
    render(
      <ScriptInjector
        scripts={[
          '<script src="https://example.com/analytics.js"></script>',
          '<script src="javascript:alert(1)"></script>',
        ]}
      />
    );
    const ok = document.head.querySelector('script[src="https://example.com/analytics.js"]');
    expect(ok).not.toBeNull();
    const bad = document.head.querySelector('script[src^="javascript:"]');
    expect(bad).toBeNull();
  });

  it("卸载后注入节点被移除", () => {
    const { unmount } = render(
      <ScriptInjector scripts={['<meta name="safe3" content="ok" />']} />
    );
    expect(headMeta("safe3")).not.toBeNull();
    unmount();
    expect(headMeta("safe3")).toBeNull();
  });
});
