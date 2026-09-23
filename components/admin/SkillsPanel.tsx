"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Trash2, Loader2, GripVertical, Sparkles } from "lucide-react";
import { PanelHeader, EmptyState, PanelLoading } from "./panel";
import { useListCrud } from "./useListCrud";
import MediaPicker from "./MediaPicker";

interface SkillItem {
  id?: number;
  clientId?: number;
  name: string;
  level: number;
  icon: string;
  sort: number;
}

const EMPTY: Omit<SkillItem, "clientId"> = { name: "", level: 60, icon: "", sort: 0 };

/** 技能管理：增删改 + 批量保存（level 0-100，icon 可选；level=0 且无图标时按纯标签展示） */
export default function SkillsPanel() {
  const { items, loading, saving, dirty, addItem, removeItem, update, save } = useListCrud<SkillItem>({
    id: "skills",
    label: "技能云",
    api: "/api/skills",
    makeEmpty: (index) => ({ ...EMPTY, sort: index }),
    isSubmittable: (it) => it.name.trim() !== "",
    /** 本地校验：熟练度越界时定位到具体行（行号按可见行计算，空名称行不参与但占位） */
    validate: (rows) => {
      const bad = rows.findIndex(
        (it) => it.name.trim() !== "" && (it.level < 0 || it.level > 100)
      );
      return bad >= 0 ? `第 ${bad + 1} 行：熟练度须在 0-100 之间` : null;
    },
    successMessage: ({ createdCount, updatedCount, deletedCount }) =>
      `技能保存成功：新增 ${createdCount} / 更新 ${updatedCount} / 删除 ${deletedCount}`,
  });

  if (loading) return <PanelLoading />;

  return (
    <Card>
      <CardContent className="space-y-3">
        <PanelHeader
          actions={
            <Button size="sm" onClick={addItem} className="gap-1.5">
              <Plus className="h-4 w-4" />
              添加技能
            </Button>
          }
        />
        {items.length === 0 && (
          <EmptyState icon={<Sparkles className="h-5 w-5" />} title="暂无技能，点击右上角「添加技能」创建" />
        )}
        {items.map((it, i) => (
          <div key={it.id ?? it.clientId ?? i} className="group relative rounded-xl border bg-card p-3 pl-12 transition-all hover:border-primary/30 hover:shadow-sm">
            <div title="按「排序」数值排列" className="absolute left-0 top-0 flex h-full w-10 flex-col items-center justify-center gap-1 border-r border-border/50 bg-muted/30 text-muted-foreground/60">
              <GripVertical className="h-4 w-4" />
              <span className="text-[10px] font-semibold tabular-nums">{String(i + 1).padStart(2, "0")}</span>
            </div>
            <Button variant="ghost" size="icon" onClick={() => removeItem(i)}
              className="absolute right-2 top-2 h-7 w-7 text-muted-foreground transition-all hover:bg-destructive/10 hover:text-destructive"
              aria-label="删除">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>

            <div className="grid gap-2.5 pr-8 sm:grid-cols-[minmax(0,1fr)_110px_minmax(0,1fr)_70px]">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">技能名</Label>
                <Input value={it.name} onChange={(e) => update(i, "name", e.target.value)} placeholder="如 TypeScript" className="h-10 sm:h-8" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">熟练度</Label>
                <Input type="number" min={0} max={100} value={it.level} onChange={(e) => update(i, "level", Number(e.target.value))} className="h-10 sm:h-8" />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`skill-icon-${i}`} className="text-xs text-muted-foreground">图标</Label>
                <MediaPicker
                  id={`skill-icon-${i}`}
                  value={it.icon}
                  onChange={(v) => update(i, "icon", v)}
                  placeholder="图标名 / 图片URL / random:关键词"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">排序</Label>
                <Input type="number" min={0} value={it.sort} onChange={(e) => update(i, "sort", e.target.value === "" ? 0 : Number(e.target.value))} className="h-10 sm:h-8" />
              </div>
            </div>
          </div>
        ))}
        <Button onClick={save} disabled={saving} className={`w-full gap-1.5 ${dirty ? "ring-2 ring-primary/40" : ""}`}>
          {saving ? (<><Loader2 className="h-4 w-4 animate-spin" />保存中...</>) : dirty ? "● 有未保存的更改" : "保存技能"}
        </Button>
      </CardContent>
    </Card>
  );
}
