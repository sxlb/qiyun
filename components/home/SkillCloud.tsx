"use client";

import Image from "next/image";
import type { SkillRow } from "@/app/home-data";
import { resolveLucideIcon, isLucideIcon, LUCIDE_PREFIX } from "@/lib/lucideIconResolver";
import { useIconfontSymbols } from "@/components/home/Iconfont";
import { resolveIconImageSrc } from "@/lib/iconValue";
import ExpandableContent from "@/components/home/ExpandableContent";

/** 技能胶囊图标（支持 lucide / iconfont / 网络图片） */
function SkillIcon({ icon }: { icon: string }) {
  const iconfontSymbols = useIconfontSymbols();

  if (!icon) return null;

  // 图片型：网络图片 URL / 本地图片路径
  const imgSrc = resolveIconImageSrc(icon);
  if (imgSrc) {
    return (
      <Image
        src={imgSrc}
        alt=""
        width={16}
        height={16}
        className="h-4 w-4 shrink-0 rounded-full object-cover"
        unoptimized
        onError={(e) => { e.currentTarget.style.display = "none"; }}
      />
    );
  }

  // lucide 图标：支持 "lucide:xxx" 前缀，也兼容历史数据的裸图标名（如 code）
  const lucideValue = isLucideIcon(icon) ? icon : `${LUCIDE_PREFIX}${icon}`;
  const LucideComp = resolveLucideIcon(lucideValue);
  if (LucideComp) {
    return <LucideComp className="h-4 w-4 shrink-0 text-white/70" />;
  }

  // iconfont 图标
  if (iconfontSymbols.includes(icon)) {
    return (
      <svg className="h-4 w-4 shrink-0 text-white/70" aria-hidden="true" focusable="false">
        <use href={`#${icon}`} />
      </svg>
    );
  }

  return null;
}

/** 技能云卡片（并入首屏，位于链接导航下方；无数据时不渲染） */
export default function SkillCloud({
  skills,
}: {
  skills: SkillRow[];
}) {
  if (skills.length === 0) return null;

  /** 技能胶囊：折叠态与弹窗态共用同一份渲染，避免两处样式各改一半而漂移 */
  const pills = skills.map((s) => (
    <span
      key={s.id}
      className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 py-1 pl-2.5 pr-2.5 text-sm text-white/90"
    >
      <SkillIcon icon={s.icon} />
      {s.name}
      {s.level > 0 && (
        <span className="ml-0.5 h-1.5 w-12 overflow-hidden rounded-full bg-white/10" aria-hidden>
          <span
            className="block h-full rounded-full"
            style={{
              width: `${Math.min(100, Math.max(0, s.level))}%`,
              background:
                "linear-gradient(90deg, color-mix(in srgb, var(--accent-color, #7dd3fc) 60%, white), var(--accent-color, #7dd3fc))",
            }}
          />
        </span>
      )}
    </span>
  ));

  return (
    <div className="card-glass w-full rounded-2xl p-4 lg:p-5">
      <h2 className="mb-3 text-base font-semibold tracking-wide text-white">
        技能 <span className="ml-1 text-xs font-normal text-white/40">Skill Set</span>
      </h2>
      {/* 标签区超过固定高度就收起，底部给「展开全部」入口（见 globals.css 的 .skills-clamp）——
          技能加多了不再把整页顶出屏幕，标题「技能」也不会被裁掉 */}
      <ExpandableContent
        clampClass="skills-clamp flex flex-wrap gap-2"
        label="展开全部"
        dialogTitle="全部技能"
        dialogContent={<div className="flex flex-wrap gap-2">{pills}</div>}
      >
        {pills}
      </ExpandableContent>
    </div>
  );
}
