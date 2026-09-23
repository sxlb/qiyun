"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { useProfileForm } from "./useProfileForm";
import UploadButton from "./UploadButton";
import { SectionBlock, SubTitle, PanelLoading } from "./panel";
import {
  COVER_TYPES,
  SWITCH_INTERVALS,
  WALLPAPER_REFRESH,
  THEMES,
  AVATAR_SHAPES,
  selectClass,
  rangeClass,
} from "./profileShared";

/** 滑块组（含左侧标签 / 右侧当前值） */
function RangeField({
  id,
  label,
  hint,
  value,
  min,
  max,
  suffix,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor={id} className="text-sm font-normal">{label}</Label>
        <span className="rounded-md bg-background px-2 py-0.5 text-xs font-medium tabular-nums text-foreground shadow-sm">
          {value}{suffix}
        </span>
      </div>
      <input id={id} type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} className={rangeClass} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** 颜色字段格式校验：非空须为合法 hex（与后端 zod 一致），返回文案表示不通过 */
function validateColors(profile: { accentColor: string; avatarBorderColor: string }): string | null {
  const bad = [profile.accentColor, profile.avatarBorderColor].find(
    (c) => c.trim() !== "" && !/^#[0-9a-fA-F]{3,8}$/.test(c.trim())
  );
  return bad === undefined ? null : `颜色值不合法：${bad}（应为 #RRGGBB 格式）`;
}

export default function ThemePanel() {
  // validate 注册到全局保存：否则点「保存全部修改」会绕过颜色校验，被服务端 zod 拒绝后整批失败
  const { profile, loading, saving, set, save } = useProfileForm({
    id: "theme",
    label: "主题与壁纸",
    validate: () => validateColors(profile),
  });

  if (loading) {
    return <PanelLoading />;
  }

  return (
    <Card>
      {/* 页面级标题头由 admin/page.tsx 提供，卡内不再重复标题 */}
      <CardContent>
        {/* 主题实时预览：CSS 变量随表单实时值变化，保存后前台同源生效 */}
        <div className="mb-5">
          <ThemePreview
            accentColor={profile.accentColor}
            glassOpacity={profile.glassOpacity}
            glassBlur={profile.glassBlur}
          />
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            // 颜色字段格式校验：非空须为合法 hex（与后端 zod 一致），避免保存非法值
            const message = validateColors(profile);
            if (message) {
              toast.error(message);
              return;
            }
            save();
          }}
          className="space-y-3 pb-16"
        >
          {/* ========== 壁纸与主题 ========== */}
          <SectionBlock
            open
            title="壁纸与主题"
            subtitle="背景来源 · 自动切换 · 主题模式"
            dotClass="bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"
          >
            <div className="space-y-3.5">
              <SubTitle>壁纸与主题</SubTitle>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="coverType">壁纸种类</Label>
                  <select
                    id="coverType"
                    className={selectClass}
                    value={profile.coverType}
                    onChange={(e) => set("coverType", e.target.value)}
                  >
                    {COVER_TYPES.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="autoBGSwitchInterval">壁纸自动切换</Label>
                  <select
                    id="autoBGSwitchInterval"
                    className={selectClass}
                    value={String(profile.autoBGSwitchInterval)}
                    onChange={(e) => set("autoBGSwitchInterval", Number(e.target.value))}
                    disabled={profile.coverType === "custom" || !!profile.bgApi}
                  >
                    {SWITCH_INTERVALS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  {(profile.coverType === "custom" || !!profile.bgApi) && (
                    <p className="text-[11px] text-muted-foreground">自定义地址不支持自动切换</p>
                  )}
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="wallpaperRefresh">壁纸缓存刷新</Label>
                  <select
                    id="wallpaperRefresh"
                    className={selectClass}
                    value={String(profile.wallpaperRefresh)}
                    onChange={(e) => set("wallpaperRefresh", Number(e.target.value))}
                  >
                    {WALLPAPER_REFRESH.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">缓存到服务器（最多 100 张），到期自动换入新壁纸</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bgApi">自定义壁纸地址</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="bgApi"
                      value={profile.bgApi}
                      onChange={(e) => set("bgApi", e.target.value)}
                      placeholder="https://example.com/wallpaper.jpg"
                    />
                    <UploadButton onUploaded={(url) => set("bgApi", url)} label="上传" />
                  </div>
                  <p className="text-xs text-muted-foreground">填写后优先于壁纸种类使用（图片直链）</p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="theme">主题模式</Label>
                <select
                  id="theme"
                  className={selectClass}
                  value={profile.theme}
                  onChange={(e) => set("theme", e.target.value)}
                >
                  {THEMES.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">「跟随壁纸」模式会根据壁纸明暗自动切换深浅色</p>
              </div>
            </div>
          </SectionBlock>

          {/* ========== 视觉氛围 ========== */}
          <SectionBlock
            title="视觉氛围"
            subtitle="强调色 · 玻璃效果 · 头像样式"
            dotClass="bg-violet-500 shadow-[0_0_8px_rgba(139,92,246,0.5)]"
          >
            <div className="space-y-3.5">
              <SubTitle>视觉与氛围</SubTitle>

              <div className="space-y-2">
                <Label htmlFor="accentColor">主题强调色</Label>
                <div className="flex items-center gap-2 rounded-lg border border-input bg-background p-1.5 pr-3">
                  <input
                    id="accentColor"
                    type="color"
                    value={/^#[0-9a-fA-F]{6}$/.test(profile.accentColor) ? profile.accentColor : "#7dd3fc"}
                    onChange={(e) => set("accentColor", e.target.value)}
                    className="h-10 w-12 cursor-pointer rounded-md border-0 bg-transparent sm:h-9 [color-scheme:light]"
                  />
                  <div className="h-6 w-px bg-border" />
                  <Input
                    value={profile.accentColor}
                    onChange={(e) => set("accentColor", e.target.value)}
                    placeholder="#7dd3fc"
                    className="border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
                  />
                </div>
                <p className="text-xs text-muted-foreground">时钟 / 站名发光色，留空使用默认天蓝色</p>
              </div>

              {/* 滑块组：玻璃效果 */}
              <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-4">
                <h5 className="text-xs font-medium text-muted-foreground">玻璃效果参数</h5>
                <RangeField
                  id="glassOpacity"
                  label="玻璃卡片不透明度"
                  hint="值越大卡片越深、壁纸越透不出来"
                  value={profile.glassOpacity}
                  min={0}
                  max={80}
                  suffix="%"
                  onChange={(v) => set("glassOpacity", v)}
                />
                <RangeField
                  id="glassBlur"
                  label="玻璃模糊强度"
                  value={profile.glassBlur}
                  min={0}
                  max={40}
                  suffix="px"
                  onChange={(v) => set("glassBlur", v)}
                />
              </div>

              {/* 滑块：背景遮罩 */}
              <div className="space-y-1.5 rounded-lg border border-border bg-muted/20 p-4">
                <RangeField
                  id="bgOverlay"
                  label="背景遮罩暗化"
                  hint="壁纸过亮导致文字看不清时调高"
                  value={profile.bgOverlay}
                  min={0}
                  max={80}
                  suffix="%"
                  onChange={(v) => set("bgOverlay", v)}
                />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="avatarShape">头像形状</Label>
                  <select
                    id="avatarShape"
                    className={selectClass}
                    value={profile.avatarShape}
                    onChange={(e) => set("avatarShape", e.target.value)}
                  >
                    {AVATAR_SHAPES.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="avatarBorderColor">头像边框颜色</Label>
                  <div className="flex items-center gap-2 rounded-lg border border-input bg-background p-1.5 pr-3">
                    <input
                      id="avatarBorderColor"
                      type="color"
                      value={/^#[0-9a-fA-F]{6}$/.test(profile.avatarBorderColor) ? profile.avatarBorderColor : "#ffffff"}
                      onChange={(e) => set("avatarBorderColor", e.target.value)}
                      className="h-10 w-12 cursor-pointer rounded-md border-0 bg-transparent sm:h-9 [color-scheme:light]"
                    />
                    <div className="h-6 w-px bg-border" />
                    <Input
                      value={profile.avatarBorderColor}
                      onChange={(e) => set("avatarBorderColor", e.target.value)}
                      placeholder="#ffffff"
                      className="border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
                    />
                  </div>
                </div>
              </div>
            </div>
          </SectionBlock>

          <Button type="submit" disabled={saving} className="w-full">
            {saving ? "保存中..." : "保存主题设置"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ===== 主题实时预览（内联自 ThemePreview.tsx） =====

function ThemePreview({
  accentColor,
  glassOpacity,
  glassBlur,
}: {
  accentColor: string;
  glassOpacity: number;
  glassBlur: number;
}) {
  const accent = accentColor && /^#[0-9a-fA-F]{3,8}$/.test(accentColor) ? accentColor : "#7dd3fc";
  const glassAlpha = String(Math.max(0, Math.min(80, glassOpacity)) / 100);
  const glassBlurPx = `${Math.max(0, Math.min(40, glassBlur))}px`;

  return (
    <div
      className="overflow-hidden rounded-xl border"
      style={
        {
          "--accent-color": accent,
          "--card-alpha": glassAlpha,
          "--glass-blur": glassBlurPx,
        } as React.CSSProperties
      }
    >
      <div className="relative bg-gradient-to-br from-[#1a1a2e] via-[#16213e] to-[#0f3460] p-6">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-xl text-white ring-2 ring-white/30">
            A
          </div>
          <div>
            <p className="text-glow-accent text-2xl font-semibold text-white">示例昵称</p>
            <p className="text-xs text-white/50">预览效果随下方设置实时变化</p>
          </div>
        </div>
        <div className="card-glass card-info rounded-2xl p-4">
          <div className="mb-2 h-[3px] w-24 rounded-full" style={{ background: accent }} />
          <div className="flex items-center gap-2 text-sm text-white/90">
            <svg viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
              <path d="M12 2a10 10 0 1 0 10 10" />
            </svg>
            <span>玻璃卡片质感示例</span>
          </div>
          <p className="mt-2 text-xs text-white/60">
            不透明度 {glassOpacity}% · 模糊 {glassBlur}px · 强调色 {accent}
          </p>
        </div>
      </div>
    </div>
  );
}