// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import MediaPicker from "@/components/admin/MediaPicker";

const TAB_NAMES = ["URL/路径", "Lucide", "Iconify", "SVG代码"];

const INLINE_SVG =
  '<svg t="1789304190843" class="icon" viewBox="0 0 1024 1024" width="200" height="200"><path d="M1 2" fill="#FAAD08"/></svg>';

/** 收集容器内按钮的可见文案 */
const buttonTexts = (root: HTMLElement) =>
  Array.from(root.querySelectorAll("button")).map((b) => b.textContent?.trim() ?? "");

/** 按可见文案找按钮 */
const findButton = (root: HTMLElement, text: string) =>
  Array.from(root.querySelectorAll("button")).find((b) => b.textContent?.trim() === text);

/** 打开选择弹层（字段行的「选择」按钮） */
function openDialog(container: HTMLElement) {
  const trigger = findButton(container, "选择");
  expect(trigger).toBeTruthy();
  fireEvent.click(trigger!);
}

describe("MediaPicker 图标来源（弹层形态的多种来源入口）", () => {
  it("字段行是紧凑单行：输入框 + 「选择」按钮，有值时出现清除按钮", () => {
    const { container } = render(<MediaPicker value="" onChange={() => {}} />);
    expect(container.querySelector("input")).not.toBeNull();
    expect(findButton(container, "选择")).toBeTruthy();
    // 空值时没有可清除的内容
    expect(container.querySelector('[aria-label="清除当前值"]')).toBeNull();

    const { container: withValue } = render(<MediaPicker value="lucide:github" onChange={() => {}} />);
    expect(withValue.querySelector('[aria-label="清除当前值"]')).not.toBeNull();
  });

  it("弹层内提供全部来源 Tab（URL/路径、Lucide、Iconify、SVG代码），且四等分不换行", () => {
    const { container } = render(<MediaPicker value="" onChange={() => {}} />);
    openDialog(container);
    const texts = buttonTexts(container);
    for (const name of TAB_NAMES) {
      expect(texts).toContain(name);
    }
    // 弹层 Tab 容器使用 4 列网格，列数固定 => 窄屏也不会掉行
    const tabGrid = container.querySelector('[role="dialog"] .grid-cols-4');
    expect(tabGrid).not.toBeNull();
  });

  it("不复存在已移除的「图标库」「FontAwesome」Tab", () => {
    const { container } = render(<MediaPicker value="" onChange={() => {}} />);
    openDialog(container);
    const texts = buttonTexts(container);
    expect(texts).not.toContain("图标库");
    // FontAwesome 已并入 Iconify（fa6-* 本就是 Iconify 的图标集），不再单独占一个 Tab
    expect(texts).not.toContain("FontAwesome");
  });

  it("弹层默认关闭：未点击「选择」时不渲染任何对话层", () => {
    const { container } = render(<MediaPicker value="" onChange={() => {}} />);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("FontAwesome 值（fa6-solid:）渲染 Iconify 预览", () => {
    const { container } = render(<MediaPicker value="fa6-solid:user" onChange={() => {}} />);
    expect(container.querySelector('[data-testid="iconify-icon"]')).not.toBeNull();
  });

  it("Iconify 值默认定位到「Iconify」Tab", () => {
    const { container } = render(<MediaPicker value="fa:github" onChange={() => {}} />);
    openDialog(container);
    const iconifyTab = findButton(container, "Iconify");
    expect(iconifyTab?.getAttribute("aria-pressed")).toBe("true");
    const urlTab = findButton(container, "URL/路径");
    expect(urlTab?.getAttribute("aria-pressed")).toBe("false");
  });

  it("内联 SVG 值：字段行显示状态摘要，弹层内用多行 Textarea 编辑", () => {
    const { container } = render(<MediaPicker value={INLINE_SVG} onChange={() => {}} />);
    // 字段行不再把 10KB 代码塞进单行输入框，而是给出摘要
    expect(container.textContent).toContain("已识别为 SVG 代码");
    expect(container.querySelector("input")).toBeNull();

    openDialog(container);
    // 值形态决定默认落在「SVG代码」Tab
    const svgTab = findButton(container, "SVG代码");
    expect(svgTab?.getAttribute("aria-pressed")).toBe("true");

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
    openDialog(container);
    const clearBtn = findButton(container, "清空");
    expect(clearBtn).toBeTruthy();
    fireEvent.click(clearBtn!);
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("点击 Lucide 网格里的图标回传 lucide:xxx", () => {
    const onChange = vi.fn();
    const { container } = render(<MediaPicker value="" onChange={onChange} />);
    openDialog(container);
    // 空值默认落在 Lucide Tab，网格按钮以图标名为 title
    const iconBtn = container.querySelector('button[title="github"]');
    expect(iconBtn).not.toBeNull();
    fireEvent.click(iconBtn!);
    expect(onChange).toHaveBeenCalledWith("lucide:github");
  });

  it("Esc 关闭弹层", () => {
    const { container } = render(<MediaPicker value="" onChange={() => {}} />);
    openDialog(container);
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
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

  it("URL/路径页签内嵌图片选择器：可直接挑媒体库 / 壁纸缓存，无需手敲路径", () => {
    // 内嵌的 MediaImagePicker 挂载即请求两份数据源，桩掉 fetch 避免真实网络
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ items: [], total: 0 }) }) as unknown as Response)
    );
    try {
      const { container } = render(<MediaPicker value="" onChange={() => {}} />);
      openDialog(container);
      fireEvent.click(findButton(container, "URL/路径")!);

      const entry = findButton(container, "打开图片选择器");
      expect(entry).toBeTruthy();
      fireEvent.click(entry!);

      // 嵌套弹层出现，提供两个来源页签
      const dialogs = container.querySelectorAll('[role="dialog"]');
      expect(dialogs.length).toBe(2);
      const texts = buttonTexts(container);
      expect(texts).toContain("媒体库");
      expect(texts).toContain("壁纸缓存");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
