// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import SocialLinks from "@/components/home/SocialLinks";

/**
 * 「点击弹出图片」的行为回归（微信 / QQ 这类没有可跳转主页的平台）。
 *
 * 关键不变量：
 * 1. 配了 popupImage 的条目**不能**再是 <a> —— 否则浏览器会先尝试跳转，
 *    弹窗还没看清页面就走了；必须换成 <button> 只负责开弹层。
 * 2. 没配的条目要保持原样（<a href> 新标签打开），不能被这次改动带跑。
 * 3. 弹层的三条关闭路径（关闭按钮 / Esc / 点遮罩）都要能用。
 */

const base = { tip: "", sort: 0 };

describe("社交链接的「点击弹出图片」", () => {
  it("配了弹出图片：渲染为按钮而非链接，点击后弹出该图", () => {
    render(
      <SocialLinks
        initialLinks={[
          { id: 1, name: "微信", icon: "simple-icons:wechat", url: "", popupImage: "/api/uploads/file/qr.png", ...base },
        ]}
      />
    );

    // 不能是链接：点了不该跳转
    const bar = document.querySelector(".social-links-bar")!;
    expect(bar.querySelector("a")).toBeNull();
    const trigger = bar.querySelector("button")!;
    expect(trigger.getAttribute("aria-label")).toBe("微信");

    // 初始没有弹层
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-label")).toBe("微信 二维码");
    expect(dialog.querySelector("img")?.getAttribute("src")).toBe("/api/uploads/file/qr.png");
    expect(dialog.querySelector("img")?.getAttribute("alt")).toBe("微信 二维码");
  });

  it("没配弹出图片：仍然是新标签打开的链接", () => {
    render(
      <SocialLinks
        initialLinks={[{ id: 2, name: "GitHub", icon: "github", url: "https://github.com/x", ...base }]}
      />
    );

    const link = document.querySelector(".social-links-bar a") as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.getAttribute("href")).toBe("https://github.com/x");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(document.querySelector(".social-links-bar button")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("地址与弹出图片都填时以弹出图片为准（不跳转）", () => {
    render(
      <SocialLinks
        initialLinks={[
          { id: 3, name: "微信", icon: "simple-icons:wechat", url: "https://example.com/x", popupImage: "/qr.png", ...base },
        ]}
      />
    );

    expect(document.querySelector(".social-links-bar a")).toBeNull();
    fireEvent.click(document.querySelector(".social-links-bar button")!);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("三条关闭路径都有效：关闭按钮 / Esc / 点遮罩", () => {
    const { container } = render(
      <SocialLinks
        initialLinks={[
          { id: 4, name: "微信", icon: "simple-icons:wechat", url: "", popupImage: "/qr.png", ...base },
        ]}
      />
    );
    const open = () => fireEvent.click(container.querySelector(".social-links-bar button")!);

    open();
    fireEvent.click(screen.getByLabelText("关闭"));
    expect(screen.queryByRole("dialog")).toBeNull();

    open();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();

    open();
    fireEvent.click(document.querySelector(".social-qr-backdrop")!);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("同时存在两类条目时各自渲染成对应标签", () => {
    render(
      <SocialLinks
        initialLinks={[
          { id: 5, name: "微信", icon: "simple-icons:wechat", url: "", popupImage: "/qr.png", ...base },
          { id: 6, name: "GitHub", icon: "github", url: "https://github.com/x", ...base },
        ]}
      />
    );

    const bar = document.querySelector(".social-links-bar")!;
    expect(bar.querySelectorAll("button")).toHaveLength(1);
    expect(bar.querySelectorAll("a")).toHaveLength(1);
  });
});
