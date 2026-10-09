"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface HitokotoData {
  text: string;
  from: string;
}

const FALLBACK: HitokotoData = { text: "这里应该显示一句话", from: "无名" };

interface Props {
  /** 一言类型（空=随机；a动画 b漫画 c游戏 d文学 e原创 f网络 g其他 h影视 i诗词 j网易云 k哲学 l抖机灵） */
  type?: string;
}

/**
 * 一言组件（对齐 home .hitokoto）
 * - 默认 .cards 样式：border-radius 6px, backdrop-blur(10px), hover scale(1.01), active scale(0.98)
 * - padding 20px（home），字号 1.1rem，来源右对齐 `-「 from 」`
 * - 3 行省略，点击换一句
 *
 * 卡片上原本还有一个「打开音乐」按钮（音乐面板与一言共用这一格）。音乐改到右下角的
 * 音乐侧栏后按钮一并去掉 —— 卡片重新变成纯粹的一句话，内部不再嵌可聚焦元素，
 * 也就不会再出现「焦点在内层按钮上按 Enter 却被外层当成换一句」那类冒泡问题。
 */
export default function Hitokoto({ type = "" }: Props) {
  const [data, setData] = useState<HitokotoData>(FALLBACK);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchHitokoto = useCallback(async () => {
    setLoading(true);
    try {
      const query = type ? `?c=${encodeURIComponent(type)}` : "";
      const res = await fetch(`/api/hitokoto${query}`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const json = await res.json();
        if (json.text) {
          setData({ text: json.text, from: json.from || "无名" });
          return;
        }
      }
    } catch (e) {
      if (process.env.NODE_ENV === "development") console.error("一言获取失败:", e);
    } finally {
      setLoading(false);
    }
  }, [type]);

  // 防抖：500ms 内多次点击只触发一次
  function onClick() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => fetchHitokoto(), 500);
  }

  // 键盘可达：Enter/空格 触发换一句（读屏/纯键盘用户）
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick();
    }
  }

  useEffect(() => {
    fetchHitokoto();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [fetchHitokoto]);

  return (
    <div
      onClick={onClick}
      onKeyDown={onKeyDown}
      role="button"
      tabIndex={0}
      aria-label="点击换一句"
      className="card-glass card-func flex h-full w-full cursor-pointer flex-col justify-between p-5"
      style={{ justifyContent: "space-between" }}
      title="点击换一句"
    >
      {/* 打开音乐面板按钮：已随音乐侧栏一并移除（音乐入口改到右下角常驻圆钮） */}
      <p
        className={`w-full break-words text-[15px] leading-loose transition-opacity duration-300 md:text-lg md:leading-loose ${
          loading ? "opacity-50" : "opacity-100"
        }`}
        style={{
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
          letterSpacing: "0.02em",
        }}
      >
        {data.text}
      </p>
      <span className="self-end text-[13px] font-medium tracking-wide text-white/80 md:text-sm" style={{ letterSpacing: "0.04em" }}>
        —「 {data.from} 」
      </span>
    </div>
  );
}
