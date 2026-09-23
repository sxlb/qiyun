"use client";

import { useState } from "react";
import { Share2, Globe, Users, Link2 } from "lucide-react";
import LinksPanel from "@/components/admin/LinksPanel";
import FriendLinksPanel from "@/components/admin/FriendLinksPanel";

/** 子 tab 标识 */
type LinkSubTab = "social" | "site" | "friend";

const SUB_TABS: { id: LinkSubTab; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "social", label: "社交链接", Icon: Share2 },
  { id: "site", label: "网站链接", Icon: Globe },
  { id: "friend", label: "友情链接", Icon: Users },
];

/**
 * 链接管理：内部三个子 Tab（社交链接 / 网站链接 / 友情链接）。
 *
 * 全局保存注册由各子面板自行完成（见 useLinkList：按面板 id 注册，自带校验与
 * 「保存期间又有新改动」的竞态处理）。此容器**不再**重复注册转发 —— 否则一次
 * 「保存全部修改」会遍历到两条登记项，把同一面板保存两遍。
 *
 * 已访问过的子 Tab 保持挂载（仅用 hidden 切换）：切回时不丢失未保存的编辑。
 */
export default function LinksManager() {
  const [sub, setSub] = useState<LinkSubTab>("social");
  const [mountedSubs, setMountedSubs] = useState<Set<LinkSubTab>>(() => new Set(["social"]));

  const selectSub = (next: LinkSubTab) => {
    setSub(next);
    setMountedSubs((prev) => (prev.has(next) ? prev : new Set(prev).add(next)));
  };

  return (
    <div className="space-y-4">
      {/* 内部 Tab 切换 */}
      <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1 shadow-sm">
        {SUB_TABS.map((t) => {
          const Icon = t.Icon;
          const active = sub === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => selectSub(t.id)}
              className={`flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-2.5 text-xs transition-all duration-150 ease-out sm:gap-1.5 sm:px-3 sm:py-2 sm:text-sm ${
                active
                  ? "bg-primary text-primary-foreground font-medium shadow-sm"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* 当前子 Tab 对应的独立面板 */}
      <div className="flex items-start gap-2 px-1 text-xs text-muted-foreground sm:justify-center sm:text-sm">
        <Link2 className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          {sub === "social" && "管理主页显示的社交入口（GitHub、邮箱等）。"}
          {sub === "site" && "管理主页网站列表（博客、网盘、图床等）。"}
          {sub === "friend" && "管理首页友情链接与合作伙伴。"}
        </span>
      </div>

      {mountedSubs.has("social") && (
        <div className={sub === "social" ? "" : "hidden"}>
          <LinksPanel
            apiPath="/api/social-links"
            emptyText="暂无社交链接，点击右上角「添加链接」创建"
            successMessage="社交链接保存成功"
            tabLabel="社交链接"
            showTip
            namePlaceholder="如 GitHub"
            iconPlaceholder="图标名 / Iconify(fa:github) / 图片URL或路径 / SVG代码 / random:关键词"
            urlPlaceholder="https://github.com/yourname 或 mailto:xxx"
          />
        </div>
      )}
      {mountedSubs.has("site") && (
        <div className={sub === "site" ? "" : "hidden"}>
          <LinksPanel
            apiPath="/api/site-links"
            emptyText="暂无网站链接，点击右上角「添加链接」创建"
            successMessage="网站链接保存成功"
            tabLabel="网站链接"
            namePlaceholder="如 博客"
            iconPlaceholder="图标名 / Iconify(fa:github) / 图片URL或路径 / SVG代码 / random:关键词"
            urlPlaceholder="https://blog.example.com"
          />
        </div>
      )}
      {mountedSubs.has("friend") && (
        <div className={sub === "friend" ? "" : "hidden"}>
          <FriendLinksPanel />
        </div>
      )}
    </div>
  );
}
