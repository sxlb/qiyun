"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, X } from "lucide-react";

/**
 * 折叠展示：内容超过上限时收起为固定几行，底部给出「展开」入口，点击用弹窗展示完整内容。
 *
 * 为什么是折叠 + 弹窗，而不是卡片内部滚动：玻璃卡片里塞一条细滚动条既不好看也不好按
 * （触摸设备上尤其），滚动区还会与卡片 hover 抬升的动效打架；折叠给的是一个有文案的
 * 明确入口，全文在弹窗里读起来也更舒展。
 *
 * 判定是否溢出用的是 scrollHeight 与 clientHeight 的比较：折叠态靠 CSS 的
 * max-height + overflow:hidden 实现，内容装不下时两者必然不等。
 * 内容不超出时这段逻辑完全静默——没有入口、没有底部渐隐，与改动前一致。
 */
export default function ExpandableContent({
  className,
  clampClass,
  label,
  dialogTitle,
  children,
  dialogContent,
}: {
  /** 外层容器（折叠区 + 入口的整体）的类，通常由调用方给出 flex 布局相关的约束 */
  className?: string;
  /** 折叠高度对应的类（见 globals.css：.bio-clamp / .skills-clamp） */
  clampClass: string;
  /** 展开入口的文案 */
  label: string;
  /** 弹窗标题 */
  dialogTitle: string;
  /** 折叠态渲染的内容 */
  children: ReactNode;
  /** 弹窗中的完整内容 */
  dialogContent: ReactNode;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [clamped, setClamped] = useState(false);
  const [open, setOpen] = useState(false);

  const measure = useCallback(() => {
    const el = boxRef.current;
    if (!el) return;
    // +1 容忍亚像素误差，避免刚好贴合时误判为溢出
    setClamped(el.scrollHeight > el.clientHeight + 1);
  }, []);

  useEffect(() => {
    measure();
    // 自定义字体加载完成后行高会变，需要复测；否则会出现「明明超了却没有展开入口」
    if (typeof document !== "undefined") {
      const fonts = document.fonts;
      if (fonts) void fonts.ready.then(measure).catch(() => {});
    }
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure, children]);

  // 弹窗键盘可达：Esc 关闭，打开时焦点移入关闭按钮
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <div className={`relative ${className ?? ""}`.trim()}>
        <div ref={boxRef} className={`${clampClass}${clamped ? " is-clamped" : ""}`}>
          {children}
        </div>
        {clamped && (
          <button
            type="button"
            className="expand-trigger"
            onClick={() => setOpen(true)}
            aria-haspopup="dialog"
          >
            {label}
            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
      </div>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          // 挂到 body：内容区在 section 的 z-10 层叠上下文里，就地渲染的 z-index
          // 会被限制在该上下文内，压不过公告弹窗（z-85）。
          <div
            role="dialog"
            aria-modal="true"
            aria-label={dialogTitle}
            className="fixed inset-0 z-[150] flex items-center justify-center p-4 sm:p-6"
          >
            <button
              type="button"
              aria-label="关闭"
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
              onClick={() => setOpen(false)}
            />
            <div className="relative flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#0d1626]/95 shadow-2xl backdrop-blur-xl">
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-5 py-3.5">
                <h3 className="text-sm font-medium text-white">{dialogTitle}</h3>
                <button
                  ref={closeRef}
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="关闭"
                  className="flex h-7 w-7 items-center justify-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="overflow-y-auto px-5 py-4">{dialogContent}</div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
