// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { bioCounterClass } from "@/components/admin/ProfilePanel";
import { BIO_MAX_LENGTH, profileSchema } from "@/lib/validation";

/**
 * 个性签名字数反馈。
 *
 * 后台在「个性签名」输入框右上角显示 `已用 / 上限`，并按用量变色。
 * 这里锁住两件事：进度文案读的上限与保存校验是同一个常量；变色阈值符合预期。
 */

describe("BIO_MAX_LENGTH", () => {
  it("上限为 280，且保存校验与之同源", () => {
    expect(BIO_MAX_LENGTH).toBe(280);
    // 正好 280 通过、281 拒绝 —— 计数器的上限和校验规则必须一致，否则会出现
    // 「计数器显示没超，保存却被拒」或反过来的错位
    expect(profileSchema.safeParse({ bio: "a".repeat(BIO_MAX_LENGTH) }).success).toBe(true);
    expect(profileSchema.safeParse({ bio: "a".repeat(BIO_MAX_LENGTH + 1) }).success).toBe(false);
  });
});

describe("bioCounterClass", () => {
  it("正常区间用次要文本色", () => {
    expect(bioCounterClass(0)).toContain("text-muted-foreground");
    expect(bioCounterClass(100)).toContain("text-muted-foreground");
  });

  it("超过九成上限转警示色（此时仍未超限）", () => {
    const warning = Math.floor(BIO_MAX_LENGTH * 0.9) + 1;
    expect(bioCounterClass(warning)).toContain("text-amber");
  });

  it("刚好等于上限只是警示色，不算超限", () => {
    const cls = bioCounterClass(BIO_MAX_LENGTH);
    expect(cls).toContain("text-amber");
    expect(cls).not.toContain("text-destructive");
  });

  it("超出上限转错误色", () => {
    expect(bioCounterClass(BIO_MAX_LENGTH + 1)).toContain("text-destructive");
  });

  it("始终带等宽数字，避免字数变化时整行抖动", () => {
    expect(bioCounterClass(0)).toContain("tabular-nums");
    expect(bioCounterClass(BIO_MAX_LENGTH + 1)).toContain("tabular-nums");
  });
});
