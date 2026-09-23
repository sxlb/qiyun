import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { LinkIconPreview } from "@/components/admin/LinksPanel";

describe("LinkIconPreview 图标解析", () => {
  it("lucide: 前缀解析为 lucide 图标", () => {
    render(<LinkIconPreview icon="lucide:github" />);
    expect(document.querySelector("svg")).not.toBeNull();
  });

  it("icon- 前缀渲染 iconfont symbol", () => {
    render(<LinkIconPreview icon="icon-github" />);
    const use = document.querySelector("use");
    expect(use?.getAttribute("href")).toBe("#icon-github");
  });

  it("未知图标兜底 Globe", () => {
    render(<LinkIconPreview icon="unknown-xyz" />);
    expect(document.querySelector("svg")).not.toBeNull();
  });

  it("内联 SVG 代码原样渲染（而非兜底地球）", () => {
    render(
      <LinkIconPreview icon='<svg t="1" viewBox="0 0 1024 1024" width="200" height="200"><path d="M1 2" p-id="9"/></svg>' />
    );
    const svg = document.querySelector("svg");
    expect(svg).not.toBeNull();
    // 尺寸被规范化为 20（列表预览尺寸），不会保留后台粘贴的 200×200
    expect(svg?.getAttribute("width")).toBe("20");
  });

  it("Iconify（prefix:name）渲染 iconify 容器，不落到 Globe 兜底", () => {
    render(<LinkIconPreview icon="fa:github" />);
    expect(document.querySelector('[data-testid="iconify-icon"]')).not.toBeNull();
  });

  it("本地图片路径渲染为 img（而非兜底地球）", () => {
    render(<LinkIconPreview icon="/images/icon/github.png" />);
    const img = document.querySelector("img");
    expect(img?.getAttribute("src")).toBe("/images/icon/github.png");
  });

  it("@vicons/fa 预设名映射为对应 lucide 图标", () => {
    render(<LinkIconPreview icon="CompactDisc" />);
    expect(document.querySelector("svg")).not.toBeNull();
  });
});
