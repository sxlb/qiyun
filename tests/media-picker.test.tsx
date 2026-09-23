import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import MediaPicker from "@/components/admin/MediaPicker";

const TAB_NAMES = ["URL/路径", "图标库", "Lucide", "Iconify", "SVG代码", "随机图", "Openverse"];

const INLINE_SVG =
  '<svg t="1789304190843" class="icon" viewBox="0 0 1024 1024" width="200" height="200"><path d="M1 2" fill="#FAAD08"/></svg>';

describe("MediaPicker 图标来源（六种来源的后台入口）", () => {
  it("渲染全部来源 Tab（含新增的 Iconify / SVG代码）", () => {
    render(<MediaPicker value="" onChange={() => {}} />);
    const texts = Array.from(document.querySelectorAll("button")).map((b) => b.textContent?.trim() ?? "");
    for (const name of TAB_NAMES) {
      expect(texts).toContain(name);
    }
  });

  it("内联 SVG 值默认落在「SVG代码」Tab，并用多行 Textarea 编辑", () => {
    const { container } = render(<MediaPicker value={INLINE_SVG} onChange={() => {}} />);
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement | null;
    expect(textarea).not.toBeNull();
    expect(textarea?.value).toBe(INLINE_SVG);
    // 预览按 28px 内联渲染（不会保留粘贴时的 200×200）
    expect(container.querySelector("svg")?.getAttribute("width")).toBe("28");
    expect(container.textContent).toContain("已识别为 SVG 代码");
  });

  it("「清空」按钮回传空值", () => {
    const onChange = vi.fn();
    const { container } = render(<MediaPicker value={INLINE_SVG} onChange={onChange} />);
    const clearBtn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === "清空");
    expect(clearBtn).toBeTruthy();
    fireEvent.click(clearBtn!);
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("Iconify 值默认落在「Iconify」Tab，并渲染在线图标容器", () => {
    const { container } = render(<MediaPicker value="fa:github" onChange={() => {}} />);
    expect(container.querySelector('[data-testid="iconify-icon"]')).not.toBeNull();
  });

  it("本地图片路径按 URL/路径 处理并预览为 img", () => {
    const { container } = render(<MediaPicker value="/images/icon/github.png" onChange={() => {}} />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/images/icon/github.png");
  });

  it("lucide: 前缀不会被误判为 Iconify（仍走 lucide 预览）", () => {
    const { container } = render(<MediaPicker value="lucide:github" onChange={() => {}} />);
    expect(container.querySelector('[data-testid="iconify-icon"]')).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });
});
