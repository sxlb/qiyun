"use client";

/**
 * Lucide 图标浏览器（后台用，内联形态）
 *
 * - 在**弹层容器内**平铺展示：搜索框 + 自适应图标网格，自身不产生浮层、不依赖父级宽度
 * - 网格列数由容器宽度自动决定（auto-fill + minmax），窄列与全屏弹层下都不会溢出或换行错乱
 * - 网格区域自带竖向滚动，避免把外层表单撑得过高
 * - 选中值格式为 "lucide:图标名"（kebab-case）
 *
 * 候选列表与组件映射均来自 lib/lucideIconResolver 的唯一白名单，
 * 本组件不携带第二份图标清单与 import，避免同一批图标被重复打进客户端 bundle。
 */

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Search, Check } from "lucide-react";
import {
  LUCIDE_PREFIX,
  LUCIDE_ICON_NAMES,
  LUCIDE_ICONS_BY_NAME,
} from "@/lib/lucideIconResolver";

/**
 * 将图标名包装为 lucide:xxx 格式
 */
export function toLucideIconValue(name: string): string {
  return `${LUCIDE_PREFIX}${name}`;
}

interface Props {
  /** 当前选中的图标值（lucide:xxx 格式或纯图标名） */
  value: string;
  /** 选中图标时回调，返回 lucide:xxx 格式的值 */
  onChange: (value: string) => void;
}

export default function LucideIconPicker({ value, onChange }: Props) {
  const [search, setSearch] = useState("");

  // 当前选中的纯图标名（去掉 lucide: 前缀）
  const selectedName = useMemo(() => {
    if (value.startsWith(LUCIDE_PREFIX)) {
      return value.slice(LUCIDE_PREFIX.length);
    }
    return value;
  }, [value]);

  // 按关键词过滤（名称均为 kebab-case，统一小写匹配）
  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase();
    if (!kw) return LUCIDE_ICON_NAMES;
    return LUCIDE_ICON_NAMES.filter((name) => name.includes(kw));
  }, [search]);

  return (
    <div className="space-y-3">
      {/* 搜索 */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索图标名称（如 github、mail、link）"
          spellCheck={false}
          autoComplete="off"
          className="h-10 pl-9 text-sm"
          autoFocus
        />
      </div>

      <p className="text-xs text-muted-foreground">
        {search.trim()
          ? `匹配到 ${filtered.length} / ${LUCIDE_ICON_NAMES.length} 个内置图标`
          : `内置 ${LUCIDE_ICON_NAMES.length} 个常用图标，点击即可选用`}
      </p>

      {filtered.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          没有匹配的图标，换个关键词试试
        </p>
      ) : (
        <div className="grid max-h-[46vh] grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))] gap-1.5 overflow-y-auto rounded-lg border border-border/60 bg-muted/20 p-2">
          {filtered.map((name) => {
            const IconComp = LUCIDE_ICONS_BY_NAME[name];
            if (!IconComp) return null;
            const active = selectedName === name;
            return (
              <button
                key={name}
                type="button"
                title={name}
                aria-label={name}
                aria-pressed={active}
                onClick={() => onChange(toLucideIconValue(name))}
                className={`relative flex aspect-square items-center justify-center rounded-md border transition-colors ${
                  active
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-transparent text-muted-foreground hover:border-border hover:bg-accent hover:text-foreground"
                }`}
              >
                <IconComp className="h-[18px] w-[18px]" />
                {active && (
                  <span className="absolute right-0.5 top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Check className="h-2.5 w-2.5" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
