// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import Hitokoto from "@/components/home/Hitokoto";

/**
 * 一言卡片的键盘行为。
 *
 * 历史 bug：卡片外层是 role="button" + 自带 onKeyDown（Enter/空格 = 换一句），
 * 内部又嵌了一个「打开音乐」按钮且只拦了 click 没拦 keydown —— 焦点移到按钮上按 Enter，
 * keydown 冒泡到外层被 preventDefault()，结果想开音乐却换了一句名言。
 *
 * 现在音乐入口已搬到右下角的音乐侧栏，卡片里不再有嵌套按钮，这个冒泡问题从结构上消失。
 * 这里锁两件事：外层「换一句」仍然只认自己的键盘事件；卡片内不得再出现可聚焦元素
 * （一旦有人再往卡里塞按钮，就必须同时处理 keydown 冒泡，否则上面那个 bug 会复活）。
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

/** 「换一句」是 500ms 防抖后发请求，故需等过防抖窗口才能确认它有没有被触发 */
const PAST_DEBOUNCE_MS = 700;

describe("一言卡片：外层「换一句」的键盘可达性", () => {
  it("在卡片上按 Enter 会换一句", async () => {
    const fetchMock = stubHitokotoFetch();
    const { getByLabelText, findByText } = render(<Hitokoto />);

    await findByText("第一句");
    const baseline = fetchMock.mock.calls.length;

    fireEvent.keyDown(getByLabelText("点击换一句"), { key: "Enter" });

    await new Promise((resolve) => setTimeout(resolve, PAST_DEBOUNCE_MS));
    expect(fetchMock.mock.calls.length).toBe(baseline + 1);
  });

  it("在卡片上按空格也会换一句", async () => {
    const fetchMock = stubHitokotoFetch();
    const { getByLabelText, findByText } = render(<Hitokoto />);

    await findByText("第一句");
    const baseline = fetchMock.mock.calls.length;

    fireEvent.keyDown(getByLabelText("点击换一句"), { key: " " });

    await new Promise((resolve) => setTimeout(resolve, PAST_DEBOUNCE_MS));
    expect(fetchMock.mock.calls.length).toBe(baseline + 1);
  });

  it("点击卡片换一句（鼠标路径）", async () => {
    const fetchMock = stubHitokotoFetch();
    const { getByLabelText, findByText } = render(<Hitokoto />);

    await findByText("第一句");
    const baseline = fetchMock.mock.calls.length;

    fireEvent.click(getByLabelText("点击换一句"));

    await new Promise((resolve) => setTimeout(resolve, PAST_DEBOUNCE_MS));
    expect(fetchMock.mock.calls.length).toBe(baseline + 1);
  });

  it("卡片内不得再嵌可聚焦元素（嵌套交互会重新引入 Enter 冒泡冲突）", async () => {
    stubHitokotoFetch();
    const { container, findByText } = render(<Hitokoto />);
    await findByText("第一句");

    // 外层卡片自身是 role="button" + tabIndex=0，所以要从卡片**内部**查
    const card = container.querySelector('[role="button"]');
    expect(card).toBeTruthy();
    expect(card!.querySelectorAll("button, a, input, [tabindex]")).toHaveLength(0);
    // 「打开音乐」按钮已随音乐侧栏移除
    expect(container.querySelector('[aria-label="打开音乐播放器"]')).toBeNull();
  });
});
