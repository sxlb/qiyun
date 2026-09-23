import { describe, it, expect } from "vitest";
import { sanitizeHtml } from "@/lib/utils";

/**
 * sanitizeHtml：页脚自定义 HTML 的白名单清理（供 dangerouslySetInnerHTML 使用）。
 *
 * 此前闭合标签的 "/" 被丢弃（`</p>` 还原成 `<p>`），且属性段不允许出现 `&amp;`，
 * 导致含 & 的属性整段匹配不上、标签退化成可见源码。
 */

describe("sanitizeHtml", () => {
  it("保留白名单标签，闭合标签不丢斜杠", () => {
    expect(sanitizeHtml("<p>hi</p>")).toBe("<p>hi</p>");
  });

  it("多个兄弟节点不会被错误嵌套", () => {
    expect(sanitizeHtml("<div>a</div><div>b</div>")).toBe("<div>a</div><div>b</div>");
  });

  it("非白名单标签被剥离，文本保留", () => {
    expect(sanitizeHtml("<script>alert(1)</script>")).toBe("alert(1)");
  });

  it("事件属性被剥离，安全属性保留", () => {
    expect(sanitizeHtml('<a href="https://x.com" onclick="evil()">x</a>')).toBe(
      '<a href="https://x.com">x</a>'
    );
  });

  it("危险协议被剥离", () => {
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).toBe("<a>x</a>");
  });

  it("属性值含 & 时标签仍能被还原（不显示为源码）", () => {
    expect(sanitizeHtml('<a href="https://x.com/?a=1&b=2">x</a>')).toBe(
      '<a href="https://x.com/?a=1&amp;b=2">x</a>'
    );
  });

  it("空输入返回空串", () => {
    expect(sanitizeHtml("")).toBe("");
  });
});
