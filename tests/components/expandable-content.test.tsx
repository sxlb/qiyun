// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ExpandableContent from "@/components/home/ExpandableContent";

/**
 * 折叠展示组件（简介正文 / 技能标签区共用）。
 *
 * 它是「内容超出屏幕」这条修复的落点：超过固定行数就收起，底部给一个有文案的入口，
 * 点击用弹窗展示全文。这里锁住三件事：
 * 1. 内容没超出时完全静默 —— 没有入口、没有底部渐隐，与改动前一致；
 * 2. 真的超出时才出现入口，并把 is-clamped 挂上（底部渐隐只该在此时生效）；
 * 3. 点开后弹窗里是完整内容，Esc 能关。
 */

/** jsdom 不做布局，scrollHeight / clientHeight 恒为 0：手动指定以模拟溢出 */
function setHeights(el: HTMLElement, scroll: number, client: number): void {
  Object.defineProperty(el, "scrollHeight", { value: scroll, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: client, configurable: true });
}

/** 触发一次重测（组件监听 window resize） */
async function remeasure(): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new Event("resize"));
  });
}

function renderBlock(body: string, dialogBody: string) {
  return render(
    <ExpandableContent
      className="min-w-0 flex-1"
      clampClass="bio-clamp"
      label="展开全文"
      dialogTitle="个人简介"
      dialogContent={<p>{dialogBody}</p>}
    >
      <p>{body}</p>
    </ExpandableContent>
  );
}

/** 取折叠容器（挂 bio-clamp 的那个） */
function clampBox(): HTMLElement {
  const el = document.querySelector(".bio-clamp");
  if (!el) throw new Error("未找到折叠容器");
  return el as HTMLElement;
}

beforeEach(() => {
  // 组件会访问 document.fonts；jsdom 没有该属性，按需补一个已就绪的桩
  Object.defineProperty(document, "fonts", {
    value: { ready: Promise.resolve() },
    configurable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ExpandableContent", () => {
  it("内容没超出时不显示入口，也不挂底部渐隐", async () => {
    renderBlock("短简介", "短简介");
    setHeights(clampBox(), 80, 80);
    await remeasure();

    expect(screen.queryByRole("button", { name: /展开全文/ })).toBeNull();
    expect(clampBox().classList.contains("is-clamped")).toBe(false);
  });

  it("内容超出时出现入口，并挂上 is-clamped（底部渐隐只在此时生效）", async () => {
    renderBlock("很长很长的简介", "很长很长的简介");
    setHeights(clampBox(), 240, 100);
    await remeasure();

    expect(screen.getByRole("button", { name: /展开全文/ })).toBeTruthy();
    expect(clampBox().classList.contains("is-clamped")).toBe(true);
  });

  it("点开入口后弹窗给出完整内容，收起态的内容不受影响", async () => {
    const user = userEvent.setup();
    renderBlock("收起态文本", "完整全文内容");
    setHeights(clampBox(), 240, 100);
    await remeasure();

    await user.click(screen.getByRole("button", { name: /展开全文/ }));

    const dialog = await screen.findByRole("dialog", { name: "个人简介" });
    expect(dialog.textContent).toContain("完整全文内容");
    // 收起态仍在文档里（弹窗是叠加层，不是替换）
    expect(clampBox().textContent).toContain("收起态文本");
  });

  it("Esc 关闭弹窗", async () => {
    const user = userEvent.setup();
    renderBlock("收起态文本", "完整全文内容");
    setHeights(clampBox(), 240, 100);
    await remeasure();

    await user.click(screen.getByRole("button", { name: /展开全文/ }));
    await screen.findByRole("dialog", { name: "个人简介" });

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "个人简介" })).toBeNull();
  });

  it("窗口尺寸变化后重新判定（拉高窗口可能就不再需要展开了）", async () => {
    renderBlock("很长很长的简介", "很长很长的简介");
    setHeights(clampBox(), 240, 100);
    await remeasure();
    expect(screen.getByRole("button", { name: /展开全文/ })).toBeTruthy();

    // 窗口变高 / 内容区变宽后不再溢出
    setHeights(clampBox(), 240, 240);
    await remeasure();

    expect(screen.queryByRole("button", { name: /展开全文/ })).toBeNull();
    expect(clampBox().classList.contains("is-clamped")).toBe(false);
  });
});
