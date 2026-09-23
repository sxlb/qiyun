import { describe, it, expect } from "vitest";
import { csvEscape, toCsv } from "@/lib/utils";

describe("csv（导出格式）", () => {
  it("含 BOM 头部，Excel 打开中文不乱码", () => {
    const csv = toCsv(["时间"], [["2026-09-04"]]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
  });

  it("逗号/引号/换行单元格被正确转义与包裹", () => {
    expect(csvEscape("hello, world")).toBe('"hello, world"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape("a\nb")).toBe('"a\nb"');
    expect(csvEscape("plain")).toBe("plain");
    // null / undefined 转为空串
    expect(csvEscape(null)).toBe("");
    expect(csvEscape(undefined)).toBe("");
  });

  it("以 = + - @ 开头的文本加前缀，防止表格软件当公式执行", () => {
    expect(csvEscape("=1+1")).toBe("'=1+1");
    expect(csvEscape("+cmd")).toBe("'+cmd");
    expect(csvEscape("@sum")).toBe("'@sum");
    // 纯数字（含负数）是正常数据，不加前缀
    expect(csvEscape("-5")).toBe("-5");
    expect(csvEscape(-5)).toBe("-5");
  });

  it("多行多列按 CRLF 拼接", () => {
    const csv = toCsv(["a", "b"], [
      [1, 2],
      [3, 4],
    ]);
    const lines = csv.slice(1).split("\r\n").filter(Boolean);
    // BOM + 表头 + 2 行数据
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("a,b");
    expect(lines[1]).toBe("1,2");
  });
});