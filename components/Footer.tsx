"use client";

import { useEffect, useMemo, useState } from "react";
import { Shield, Zap, History } from "lucide-react";
import { sanitizeHtml } from "@/lib/utils";

/**
 * 页脚版权信息中的作者名与跳转链接均写死在此：
 * - 作者名文本固定为 PROJECT_AUTHOR_NAME
 * - 作者名点击统一跳转到项目作者主页 PROJECT_AUTHOR_URL
 * 后台站点设置不再提供相关配置项，如需修改请直接编辑以下常量。
 */
const PROJECT_AUTHOR_NAME = "生性凉薄";
const PROJECT_AUTHOR_URL = "https://sxlb.xyz";

interface Props {
  siteIcp?: string;
  siteMps?: string;
  siteStart?: string;
  showStats?: boolean;
  /** 页脚自定义 HTML（管理员可信内容，显示在版权行上方） */
  siteFooterHtml?: string;
  /** 当前应用版本（由服务端 CURRENT_VERSION 传入，供后台更新后核验） */
  appVersion?: string;
}

interface StatsData {
  todayPv: number;
  todayUv: number;
  totalPv: number;
  totalUv: number;
}

function calcDays(siteStart: string): number {
  const start = new Date(siteStart);
  if (Number.isNaN(start.getTime())) return 0;
  return Math.floor((Date.now() - start.getTime()) / 86_400_000);
}

function getResponseTime(): number {
  try {
    const perfData = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (perfData) {
      return Math.round(perfData.responseEnd - perfData.requestStart);
    }
  } catch { /* silent */ }
  return 0;
}

/** 页脚统计单项：淡标签 + 高亮数字（tabular-nums 对齐更稳） */
function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="opacity-75">{label}</span>
      <strong className="font-semibold tabular-nums text-white/90">{value}</strong>
    </span>
  );
}

/** 页脚分隔圆点 */
function Dot() {
  return <span className="h-1 w-1 flex-none rounded-full bg-white/20" />;
}

/** 使用 useMemo 构建页脚分组，避免每次 render 重建 DOM 树 */
function useFooterGroups(
  icp: string,
  mps: string,
  showStats: boolean,
  stats: StatsData | null,
  days: number,
  loadTime: number,
) {
  return useMemo(() => {
    type Group = { key: string; node: React.ReactNode };
    const groups: Group[] = [];

    // 第 1 组：备案号
    if (icp || mps) {
      const items: React.ReactNode[] = [];
      if (icp) {
        items.push(
          <a key="icp" href="https://beian.miit.gov.cn" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-white">
            <Shield className="h-3 w-3" />{icp}
          </a>,
        );
      }
      if (mps) {
        if (items.length > 0) items.push(<span key="sep-mps" className="text-white/25">·</span>);
        items.push(
          <a key="mps" href="https://beian.mps.gov.cn" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-white">
            <Shield className="h-3 w-3" />{mps}
          </a>,
        );
      }
      groups.push({ key: "beian", node: <span className="inline-flex items-center gap-x-2">{items}</span> });
    }

    // 第 2 组：访客统计
    const todayPv = stats?.todayPv ?? 0;
    const pv = stats?.totalPv ?? 0;
    const uv = stats?.totalUv ?? 0;
    if (showStats && (todayPv > 0 || pv > 0 || uv > 0)) {
      groups.push({
        key: "visitors",
        node: (
          <span className="inline-flex items-center gap-x-3" title="浏览量=访问次数，独立访客=去重后的用户数">
            <Stat label="今日浏览量" value={todayPv} />
            <Dot />
            <Stat label="累计浏览量" value={pv} />
            <Dot />
            <Stat label="独立访客" value={uv} />
          </span>
        ),
      });
    }

    // 第 3 组：运行天数 + 速度
    if (days > 0 || loadTime > 0) {
      const parts: React.ReactNode[] = [];
      if (days > 0) {
        parts.push(
          <span key="days" className="inline-flex items-center gap-1.5">
            <History className="h-3 w-3 opacity-60" />
            <span className="opacity-75">已运行</span>
            <strong className="font-semibold tabular-nums text-white/90">{days} 天</strong>
          </span>,
        );
      }
      if (loadTime > 0) {
        if (parts.length > 0) parts.push(<Dot key="sep-time" />);
        parts.push(
          <span key="speed" className="inline-flex items-center gap-1.5">
            <Zap className="h-3 w-3 opacity-60" />
            <span className="opacity-75">加载耗时</span>
            <strong className={`font-semibold tabular-nums ${loadTime < 500 ? "text-emerald-400" : loadTime < 1000 ? "text-amber-400" : "text-red-400"}`}>
              {loadTime} ms
            </strong>
          </span>,
        );
      }
      groups.push({ key: "runtime-speed", node: <span className="inline-flex items-center gap-x-3">{parts}</span> });
    }

    return groups;
  }, [icp, mps, showStats, stats, days, loadTime]);
}

export default function Footer({
  siteIcp = "",
  siteMps = "",
  siteStart = "",
  showStats = false,
  siteFooterHtml = "",
  appVersion = "",
}: Props) {
  const year = new Date().getFullYear();
  const icp = siteIcp.trim();
  const mps = siteMps.trim();
  const footerHtml = siteFooterHtml.trim();

  const [days, setDays] = useState(0);
  const [loadTime, setLoadTime] = useState(0);
  const [stats, setStats] = useState<StatsData | null>(null);

  // 运行天数（每分钟更新）
  useEffect(() => {
    if (!siteStart) return;
    setDays(calcDays(siteStart));
    const timer = setInterval(() => setDays(calcDays(siteStart)), 60_000);
    return () => clearInterval(timer);
  }, [siteStart]);

  // 页面加载耗时
  useEffect(() => {
    const handler = () => setLoadTime(getResponseTime());
    if (document.readyState === "complete") handler();
    else window.addEventListener("load", handler);
    return () => window.removeEventListener("load", handler);
  }, []);

  // 统计数据：上报本次访问（PV）并一次请求拿回统计结果用于展示
  // （原 SiteStats 组件功能已合并至此，保证统计记录与显示不分离）
  // UV 去重由服务端 Cookie 判定；POST 响应即含统计结果，无需再单独发 GET
  //
  // 开关语义：后台「站点访问统计」关闭时**既不上报、也不展示**。
  // 此前该开关只控制展示、采集照旧执行，用户以为关掉即停止统计，实际仍在上报。
  useEffect(() => {
    if (!showStats) return;
    let cancelled = false;

    fetch("/api/stats", {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!cancelled && json?.ok) setStats(json as StatsData);
      })
      .catch(() => {
        /* 上报失败不影响页面 */
      });

    return () => {
      cancelled = true;
    };
  }, [showStats]);

  // memo 化页脚分组
  const groups = useFooterGroups(icp, mps, showStats, stats, days, loadTime);

  // 非固定页脚：位于主内容之后（文档流），滚动到页面底部时自然出现，不遮挡内容；
  // mt-6 保证与上方主内容的间距，正常浏览时页脚不在视口内
  return (
    <footer className="z-10 mt-4 w-full border-t border-white/5 bg-black/15 py-2.5 text-center text-sm text-white/55 backdrop-blur-md">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4">
        {groups.map((group) => (
          <span key={group.key} className="inline-flex items-center gap-x-2 text-center text-xs md:text-sm">
            {group.node}
          </span>
        ))}
        {footerHtml && (
          <div
            className="text-xs md:text-sm"
            // siteFooterHtml 是管理员后台配置的内容，用 HTML 白名单清理后渲染，防止 on* 事件和危险协议注入。
            // data-* 属性和 href(仅 http/https/mailto/tel) 放行，其余属性全部过滤。
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(footerHtml) }}
          />
        )}
        {/* Copyright 随页脚同行排布：作者名高亮为焦点，版本号弱化 */}
        <div className="mt-0.5 text-[11px] tracking-wide text-white/40 md:text-xs">
          <span className="shine-text inline-flex items-center gap-x-2">
            <span>Copyright © {year}</span>
            <span className="h-0.5 w-0.5 rounded-full bg-white/25" />
            <a href={PROJECT_AUTHOR_URL} target="_blank" rel="noopener noreferrer" className="font-medium text-white/70 transition-colors hover:text-white">
              {PROJECT_AUTHOR_NAME}
            </a>
            {appVersion && (
              <>
                <span className="h-0.5 w-0.5 rounded-full bg-white/25" />
                <span className="tabular-nums text-white/25">v{appVersion.trim()}</span>
              </>
            )}
          </span>
        </div>
      </div>
    </footer>
  );
}
