import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import SocialLinks from "@/components/SocialLinks";

const base = { tip: "", sort: 0, url: "https://example.com" };

describe("社交链接图标渲染（显示错误图标的回归）", () => {
  it("图片类图标（后台「从网站获取」写入的 favicon）渲染为图片，而不是兜底地球图标", () => {
    render(
      <SocialLinks
        initialLinks={[{ id: 1, name: "GitHub", icon: "https://favicon.im/github.com", ...base }]}
      />
    );
    const img = document.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("https://favicon.im/github.com");
    expect(img?.getAttribute("alt")).toBe("GitHub");
  });

  it("lucide 图标名渲染为 svg", () => {
    render(<SocialLinks initialLinks={[{ id: 2, name: "Email", icon: "mail", ...base }]} />);
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("svg")).not.toBeNull();
  });

  it("带 lucide: 前缀的值同样解析为 svg", () => {
    render(<SocialLinks initialLinks={[{ id: 3, name: "Twitter", icon: "lucide:twitter", ...base }]} />);
    expect(document.querySelector("svg")).not.toBeNull();
  });

  it("图片加载失败时回退为内置图标（不留空白）", () => {
    render(
      <SocialLinks
        initialLinks={[{ id: 4, name: "坏图标", icon: "https://example.com/not-found.png", ...base }]}
      />
    );
    const img = document.querySelector("img");
    expect(img).not.toBeNull();
    fireEvent.error(img!);
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("svg")).not.toBeNull();
  });

  it("空列表不渲染任何内容", () => {
    const { container } = render(<SocialLinks initialLinks={[]} />);
    expect(container.querySelector(".social-links-bar")).toBeNull();
  });

  it("内联 SVG 代码（iconfont 粘贴）按 32×32 内联渲染", () => {
    render(
      <SocialLinks
        initialLinks={[
          {
            id: 5,
            name: "小猪",
            icon: '<svg t="1789304190843" viewBox="0 0 1024 1024" width="200" height="200"><path d="M1 2" fill="#FAAD08"/></svg>',
            ...base,
          },
        ]}
      />
    );
    const holder = document.querySelector('[data-testid="social-icon-inline-svg"]');
    expect(holder).not.toBeNull();
    const svg = holder?.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("32");
    expect(svg?.getAttribute("height")).toBe("32");
  });

  it("@vicons/fa 预设名（历史数据）渲染为 lucide 图标而非兜底地球", () => {
    render(<SocialLinks initialLinks={[{ id: 6, name: "博客", icon: "Blog", ...base }]} />);
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("svg")).not.toBeNull();
  });

  it("本地图片路径渲染为 img", () => {
    render(<SocialLinks initialLinks={[{ id: 7, name: "本地图标", icon: "/images/icon/github.png", ...base }]} />);
    expect(document.querySelector("img")?.getAttribute("src")).toBe("/images/icon/github.png");
  });
});
