"use client";

/**
 * 阿里云矢量图标库（iconfont）图标选择器（后台用）
 * - 自动读取后台配置的 iconfontUrl 并按需加载脚本
 * - 弹出面板展示全部已注册 symbol，支持搜索与点击选中
 * - 未配置图标库时显示引导提示
 */

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { loadIconfont, useIconfontSymbols } from "@/components/Iconfont";

interface Props {
  /** 当前选中的图标名 */
  value: string;
  /** 选中图标时回调 */
  onChange: (name: string) => void;
}

export default function IconfontPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  // 配置读取状态：区分"未配置图标库"与"读取失败"，避免网络错误误报为未配置
  const [loadState, setLoadState] = useState<"loading" | "ok" | "not-configured" | "error">("loading");
  const symbols = useIconfontSymbols();

  // 读取后台 iconfont 配置并加载脚本
  useEffect(() => {
    let cancelled = false;
    fetch("/api/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (!data?.iconfontUrl) {
          setLoadState("not-configured");
          return;
        }
        loadIconfont(data.iconfontUrl);
        setLoadState("ok");
      })
      .catch(() => {
        if (!cancelled) setLoadState("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 按关键词过滤 + 限制渲染数量（图标库可能上百个）
  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase();
    const list = kw ? symbols.filter((s) => s.toLowerCase().includes(kw)) : symbols;
    return list.slice(0, 150);
  }, [symbols, search]);

  // 未配置图标库：给出引导，不渲染选择器；读取失败单独提示，避免误报
  if (loadState === "error") {
    return (
      <p className="text-xs text-destructive">
        读取图标库配置失败，请刷新后重试
      </p>
    );
  }
  if (loadState === "not-configured") {
    return (
      <p className="text-xs text-muted-foreground">
        未配置图标库：请在「站点信息 → 图标库地址」填入 iconfont 链接后使用
      </p>
    );
  }

  return (
    <div className="relative">
      <div className="flex min-w-0 items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOpen((v) => !v)}
          disabled={symbols.length === 0}
          className="min-w-0 truncate"
        >
          {symbols.length ? `从图标库选择（${symbols.length}）` : "图标库加载中..."}
        </Button>
        {value && symbols.includes(value) && (
          <svg className="h-5 w-5 shrink-0" aria-hidden="true" focusable="false">
            <use href={`#${value}`} />
          </svg>
        )}
      </div>

      {/* 移动优先：小屏内联全宽；≥sm 改为右对齐浮层（从字段右缘向左展开），避免右列字段顶出视口 */}
      {open && (
        <div className="z-50 mt-2 w-full rounded-lg border bg-background p-3 shadow-lg sm:absolute sm:right-0 sm:top-full sm:w-80 sm:max-w-[calc(100vw-2rem)]">
          <div className="mb-2 flex items-center gap-2">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索图标（如 github）"
              className="h-10 sm:h-8"
              autoFocus
            />
          </div>
          {filtered.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">暂无匹配图标</p>
          ) : (
            <div className="grid max-h-56 grid-cols-6 gap-1 overflow-y-auto">
              {filtered.map((name) => (
                <button
                  key={name}
                  type="button"
                  title={name}
                  onClick={() => {
                    onChange(name);
                    setOpen(false);
                    setSearch("");
                  }}
                  className={`flex h-10 w-10 items-center justify-center rounded-md transition-colors hover:bg-accent ${
                    value === name ? "bg-accent ring-1 ring-primary" : ""
                  }`}
                >
                  <svg className="h-5 w-5" aria-hidden="true" focusable="false">
                    <use href={`#${name}`} />
                  </svg>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
