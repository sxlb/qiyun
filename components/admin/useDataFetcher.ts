"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

/**
 * 后台「拉取型面板」通用数据层：竞态守卫 + 加载态 + 统一错误提示。
 *
 * 背景：健康检测 / 媒体库 / 操作日志三个面板各自复制了同一套约 28 行的骨架：
 *   seqRef（请求序号）+ mountedRef（卸载守卫）+ try/catch/finally 里的
 *   「响应到达时若已过期就整个丢弃」+ loading 收尾 + 两类错误文案。
 *
 * 为什么需要请求序号：这些面板是**命令式**触发请求的（连点刷新、快速翻页、
 * 频繁切筛选），不会重跑 useEffect，因此「effect cleanup 置 cancelled」那套
 * 写法并不适用 —— 必须显式比较序号，否则先发的旧响应会覆盖新数据。
 * （反过来，依赖变化触发的请求用 effect cleanup 就够了，无需本 hook。）
 *
 * 语义：
 * - 只有**最后一次** run() 的结果会写入 data / loading，过期响应被静默丢弃；
 * - 组件卸载后不再 setState，也不弹提示；
 * - 非 2xx 与网络异常分别提示，文案由调用方给定。
 */

export interface UseDataFetcherOptions<A extends unknown[]> {
  /** 挂载后自动执行一次的请求参数；不传则不自动请求（由调用方自行 run） */
  initialArgs?: A;
  /** 响应非 2xx 时的提示；传 null 表示静默（沿用调用方原有行为） */
  notOkMessage?: string | null;
  /** 网络异常时的提示 */
  networkMessage?: string;
}

export interface UseDataFetcherResult<T, A extends unknown[]> {
  /** 最近一次成功响应的数据；首次成功前为 null */
  data: T | null;
  /** 是否有请求在途 */
  loading: boolean;
  /** 手动触发一次请求（刷新 / 翻页 / 筛选）；过期或出错时返回 null */
  run: (...args: A) => Promise<T | null>;
}

export function useDataFetcher<T, A extends unknown[] = []>(
  fetcher: (...args: A) => Promise<Response>,
  options: UseDataFetcherOptions<A> = {}
): UseDataFetcherResult<T, A> {
  const { initialArgs, notOkMessage = "加载失败", networkMessage = "网络错误" } = options;

  const [data, setData] = useState<T | null>(null);
  // 有 initialArgs 说明挂载即请求，初始就应处于 loading
  const [loading, setLoading] = useState(initialArgs !== undefined);

  // fetcher 每次渲染都是新函数身份；放 ref 里避免它成为 useCallback/useEffect 的依赖
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  // 请求序号：命令式连点场景下只让最后一次生效
  const seqRef = useRef(0);
  // 卸载标记：组件已销毁则不再 setState / 弹提示
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const run = useCallback(
    async (...args: A): Promise<T | null> => {
      const seq = ++seqRef.current;
      /** 本次请求是否仍是「最新且在挂载中」的那一次 */
      const isCurrent = () => mountedRef.current && seq === seqRef.current;

      setLoading(true);
      try {
        const res = await fetcherRef.current(...args);
        if (!isCurrent()) return null;
        if (!res.ok) {
          if (notOkMessage) toast.error(notOkMessage);
          return null;
        }
        const json = (await res.json()) as T;
        // 解析 body 也是异步的：回来后再确认一次，避免解析期间又发了新请求
        if (!isCurrent()) return null;
        setData(json);
        return json;
      } catch {
        if (isCurrent()) toast.error(networkMessage);
        return null;
      } finally {
        if (isCurrent()) setLoading(false);
      }
    },
    [notOkMessage, networkMessage]
  );

  // 挂载自动请求：initialArgs 用 ref 固定，避免调用方传数组字面量导致重复请求
  const initialArgsRef = useRef(initialArgs);
  useEffect(() => {
    const args = initialArgsRef.current;
    if (args) void run(...args);
  }, [run]);

  return { data, loading, run };
}
