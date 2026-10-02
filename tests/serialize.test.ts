import { describe, it, expect } from "vitest";
import { serialized } from "@/lib/server";

describe("serialized 写串行队列", () => {
  it("并发任务严格按提交顺序执行，互不交错", async () => {
    const order: string[] = [];
    await Promise.all([
      serialized(async () => {
        order.push("a1");
        await new Promise((r) => setTimeout(r, 20));
        order.push("a2");
      }),
      serialized(async () => {
        order.push("b");
      }),
      serialized(async () => {
        order.push("c");
      }),
    ]);
    expect(order).toEqual(["a1", "a2", "b", "c"]);
  });

  it("前序任务失败不会阻塞后续任务", async () => {
    const order: string[] = [];
    const failed = serialized(async () => {
      throw new Error("boom");
    });
    const ok = serialized(async () => {
      order.push("ok");
    });
    await expect(failed).rejects.toThrow("boom");
    await ok;
    expect(order).toEqual(["ok"]);
  });

  it("返回各自任务的结果", async () => {
    const [a, b] = await Promise.all([
      serialized(async () => 1),
      serialized(async () => 2),
    ]);
    expect(a).toBe(1);
    expect(b).toBe(2);
  });
});
