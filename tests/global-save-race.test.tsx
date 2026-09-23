import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  GlobalSaveFab,
  GlobalSaveProvider,
  summarizeSaveOutcome,
  useEditRevision,
  useRegisterSave,
} from "@/components/admin/GlobalSave";

/** 悬浮保存按钮（有未保存改动时才存在） */
function fab() {
  return document.querySelector('button[aria-label^="保存全部修改"]');
}

/**
 * 模拟「自带 API 的面板」：save() 成功后是否清脏标记由面板自己决定。
 * 忠实于真实面板的两种收尾：期间无新改动 → 清脏；期间又有改动 → 保留脏标记。
 */
function FakeApiPanel({ editDuringSave }: { editDuringSave: boolean }) {
  const [dirty, setDirty] = useState(false);
  const { markEdited, currentRevision } = useEditRevision();

  useRegisterSave({
    id: "fake-api",
    label: "接口面板",
    dirty,
    revision: currentRevision,
    save: async () => {
      if (editDuringSave) {
        // 模拟「保存请求还在路上，用户又改了一处」
        markEdited();
        setDirty(true);
        return true;
      }
      setDirty(false);
      return true;
    },
  });

  return (
    <button
      type="button"
      onClick={() => {
        markEdited();
        setDirty(true);
      }}
    >
      编辑
    </button>
  );
}

describe("全局保存：保存期间的并发编辑", () => {
  it("保存期间没有新改动 → 面板自行清脏，悬浮按钮消失", async () => {
    const user = userEvent.setup();
    render(
      <GlobalSaveProvider>
        <FakeApiPanel editDuringSave={false} />
        <GlobalSaveFab />
      </GlobalSaveProvider>
    );

    expect(fab()).toBeNull();
    await user.click(screen.getByRole("button", { name: "编辑" }));
    expect(fab()).not.toBeNull();

    await user.click(fab()!);

    await waitFor(() => expect(fab()).toBeNull());
  });

  it("保存期间又有新改动 → 脏标记与悬浮按钮都保留，不谎报「已保存」", async () => {
    const user = userEvent.setup();
    render(
      <GlobalSaveProvider>
        <FakeApiPanel editDuringSave />
        <GlobalSaveFab />
      </GlobalSaveProvider>
    );

    await user.click(screen.getByRole("button", { name: "编辑" }));
    await user.click(fab()!);

    // 等保存流程走完（按钮从「保存中…」恢复为「保存全部修改」）
    await waitFor(() => expect(fab()?.textContent).toContain("保存全部修改"));
    // 关键断言：保存期间的新改动没被当成已保存
    expect(fab()).not.toBeNull();
    expect(fab()?.textContent).toContain("1");
  });

  it("注册中心不代自带 API 的面板清脏标记（清了会让失败/并发场景误报已保存）", async () => {
    const markClean = vi.fn();

    function PanelWithMarkClean() {
      const [dirty, setDirty] = useState(false);
      const { markEdited, currentRevision } = useEditRevision();
      useRegisterSave({
        id: "fake-api-2",
        label: "接口面板",
        dirty,
        revision: currentRevision,
        save: async () => true,
        markClean,
      });
      return (
        <button
          type="button"
          onClick={() => {
            markEdited();
            setDirty(true);
          }}
        >
          编辑
        </button>
      );
    }

    const user = userEvent.setup();
    render(
      <GlobalSaveProvider>
        <PanelWithMarkClean />
        <GlobalSaveFab />
      </GlobalSaveProvider>
    );

    await user.click(screen.getByRole("button", { name: "编辑" }));
    await user.click(fab()!);
    await waitFor(() => expect(fab()?.textContent).toContain("保存全部修改"));

    expect(markClean).not.toHaveBeenCalled();
  });
});

describe("summarizeSaveOutcome（全局保存结果汇总）", () => {
  it("全部成功且无残留脏状态 → success", () => {
    expect(summarizeSaveOutcome([], [])).toEqual({
      level: "success",
      message: "全部修改已保存",
    });
  });

  it("保存期间又有新改动 → warning，并点名具体面板", () => {
    const outcome = summarizeSaveOutcome([], ["技能云"]);
    expect(outcome.level).toBe("warning");
    expect(outcome.message).toContain("技能云");
    expect(outcome.message).toContain("请再次保存");
  });

  it("有面板保存失败 → error，且优先于「又有新改动」提示", () => {
    const outcome = summarizeSaveOutcome(["作品集"], ["技能云"]);
    expect(outcome.level).toBe("error");
    expect(outcome.message).toContain("作品集");
  });
});

describe("useEditRevision（编辑修订号）", () => {
  it("markEdited 推进修订号，isStale 据此判断期间是否又有改动", () => {
    let api: ReturnType<typeof useEditRevision> | null = null;

    function Probe() {
      api = useEditRevision();
      return null;
    }
    render(<Probe />);

    const before = api!.currentRevision();
    expect(api!.isStale(before)).toBe(false);

    api!.markEdited();
    expect(api!.isStale(before)).toBe(true);
    expect(api!.isStale(api!.currentRevision())).toBe(false);
  });
});
