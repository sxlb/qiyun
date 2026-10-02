// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import IconifyIcon from "@/components/home/IconifyIcon";

/**
 * IconifyIcon 会把第三方图源返回的 SVG 直接 innerHTML 注入，
 * 因此这里锁定「注入前必须清洗」这条底线：图源被投毒 / 被误配成第三方地址时，
 * 事件属性与脚本子标签不能落到页面上。
 *
 * 图标名刻意用独一无二的字符串，避开组件内模块级 LRU 缓存被其它用例命中。
 */

const EVIL =
  '<svg viewBox="0 0 24 24" onload="alert(1)"><script>alert(2)</script><path d="M1 2"/></svg>';

const NORMAL =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="currentColor" d="M256 8C119 8 8 119 8 256"/></svg>';

describe("IconifyIcon 远程 SVG 清洗（防前台 XSS）", () => {
  it("注入型 SVG 落地后不含事件属性与脚本标签", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, text: async () => EVIL }))
    );
    const { container } = render(<IconifyIcon icon="evil-probe:sanitize" size={20} />);

    await waitFor(() => expect(container.querySelector("svg")).not.toBeNull());
    expect(container.innerHTML).not.toMatch(/onload/i);
    expect(container.innerHTML).not.toMatch(/<script/i);
    // 图形本体保留，说明是「清洗」而不是整段丢弃
    expect(container.innerHTML).toContain("<path");
  });

  it("正常图标照常渲染，且尺寸被规范化为传入值", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, text: async () => NORMAL }))
    );
    const { container } = render(<IconifyIcon icon="ok-probe:sanitize" size={18} />);

    await waitFor(() => expect(container.querySelector("svg")).not.toBeNull());
    const svg = container.querySelector("svg") as SVGElement;
    expect(svg.getAttribute("width")).toBe("18");
    expect(svg.getAttribute("height")).toBe("18");
    expect(container.innerHTML).toContain('d="M256 8C119 8 8 119 8 256"');
  });

  it("图源返回非 SVG 内容时兜底为本地链接图标（不透传原始内容）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, text: async () => "<html>not an svg</html>" }))
    );
    const { container } = render(<IconifyIcon icon="html-probe:notsvg" size={16} />);

    await waitFor(() => expect(container.querySelector("svg")).not.toBeNull());
    expect(container.innerHTML).not.toMatch(/<html/i);
    expect(container.innerHTML).not.toMatch(/not an svg/i);
  });
});
