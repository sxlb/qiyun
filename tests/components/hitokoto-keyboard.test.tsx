// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import Hitokoto from "@/components/home/Hitokoto";

/**
 * 一言卡片外层是 role="button" + 自带 onKeyDown（Enter/空格 = 换一句），内部又嵌了一个
 * 「打开音乐」按钮。内层按钮此前只 stopPropagation 了 click，没有拦 keydown：
 * 焦点移到「打开音乐」后按 Enter，keydown 冒泡到外层 → 外层 preventDefault() 取消了按钮
 * 本该触发的激活行为，同时外层 onClick 被调用 —— 结果是想开音乐，却换了一句名言。
 *
 * 这里锁定修复后的行为：键盘操作内层按钮不能再触发外层的「换一句」。
 */

/** 首次获取一言的桩：记录调用次数，便于断言「有没有被多触发一次」 */
function stubHitokotoFetch() {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ text: "第一句", from: "测试" }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** 外层「换一句」是 500ms 防抖后发请求，故需等过防抖窗口才能确认它没被触发 */
const PAST_DEBOUNCE_MS = 700;

describe("一言卡片：内嵌按钮的键盘事件不应被外层卡片截走", () => {
  it("焦点在「打开音乐」上按 Enter，不应触发换一句", async () => {
    const fetchMock = stubHitokotoFetch();
    const onOpenMusic = vi.fn();
    const { getByLabelText, findByText } = render(<Hitokoto onOpenMusic={onOpenMusic} />);

    await findByText("第一句");
    const baseline = fetchMock.mock.calls.length;

    const btn = getByLabelText("打开音乐播放器");
    fireEvent.keyDown(btn, { key: "Enter" });

    await new Promise((resolve) => setTimeout(resolve, PAST_DEBOUNCE_MS));
    expect(fetchMock.mock.calls.length, "内层按钮的 Enter 被外层当成「换一句」了").toBe(baseline);
  });

  it("在内层按钮上按空格，同样不应触发换一句", async () => {
    const fetchMock = stubHitokotoFetch();
    const { getByLabelText, findByText } = render(<Hitokoto onOpenMusic={() => {}} />);

    await findByText("第一句");
    const baseline = fetchMock.mock.calls.length;

    fireEvent.keyDown(getByLabelText("打开音乐播放器"), { key: " " });

    await new Promise((resolve) => setTimeout(resolve, PAST_DEBOUNCE_MS));
    expect(fetchMock.mock.calls.length).toBe(baseline);
  });

  it("点击「打开音乐」只打开音乐，不换一句（回归保护）", async () => {
    const fetchMock = stubHitokotoFetch();
    const onOpenMusic = vi.fn();
    const { getByLabelText, findByText } = render(<Hitokoto onOpenMusic={onOpenMusic} />);

    await findByText("第一句");
    const baseline = fetchMock.mock.calls.length;

    fireEvent.click(getByLabelText("打开音乐播放器"));

    expect(onOpenMusic).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setTimeout(resolve, PAST_DEBOUNCE_MS));
    expect(fetchMock.mock.calls.length).toBe(baseline);
  });
});
