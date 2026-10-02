// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import IconifyIcon from "@/components/IconifyIcon";

/**
 * 图标请求的竞态：icon 变化或组件卸载后，先前发出的请求若晚返回，
 * 不能覆盖当前图标（表现为「换了图标却显示上一个图标」）。
 *
 * 图标名刻意用独一无二的字符串，避开组件内模块级 LRU 缓存被其它用例命中。
 */

function svgWith(marker: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${marker}"/></svg>`;
}

/** 让每个请求挂起，由用例手动决定谁先返回 */
function stubControllableFetch() {
  const pending = new Map<string, (text: string) => void>();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (url: string) =>
        new Promise((resolve) => {
          pending.set(String(url), (text: string) =>
            resolve({ ok: true, text: async () => text })
          );
        })
    )
  );
  return pending;
}

describe("IconifyIcon 请求竞态", () => {
  it("切到新图标后，先发出的请求晚返回不应覆盖新图标", async () => {
    const pending = stubControllableFetch();

    const { container, rerender } = render(<IconifyIcon icon="race-old:probe" size={16} />);
    // 第一个请求仍挂起时切到第二个图标
    rerender(<IconifyIcon icon="race-new:probe" size={16} />);

    const oldKey = [...pending.keys()].find((k) => k.includes("race-old"));
    const newKey = [...pending.keys()].find((k) => k.includes("race-new"));
    expect(oldKey, "旧图标的请求未发出").toBeTruthy();
    expect(newKey, "新图标的请求未发出").toBeTruthy();

    // 新图标先返回
    pending.get(newKey!)!(svgWith("M-NEW"));
    await waitFor(() => expect(container.innerHTML).toContain("M-NEW"));

    // 旧图标随后返回：不得覆盖
    pending.get(oldKey!)!(svgWith("M-OLD"));
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(container.innerHTML, "旧请求的响应覆盖了新图标").toContain("M-NEW");
    expect(container.innerHTML).not.toContain("M-OLD");
  });
});
