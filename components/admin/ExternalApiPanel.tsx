"use client";

/**
 * 后台「外部服务」面板：集中管理站点依赖的第三方接口地址。
 *
 * 背景：壁纸 / 头像 / 在线图标等能力依赖第三方免费接口，这些接口随时可能失效——
 * 项目历史上 vvhan 壁纸源与一言源先后下线，当时只能改代码重新部署。这里的每一项都支持
 * 「留空使用内置默认、填写即覆盖」，并可就地探活，做到上游失效时在后台换源即可恢复。
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { CheckCircle2, Loader2, RotateCcw, XCircle } from "lucide-react";
import { useProfileForm } from "./useProfileForm";
import { PanelLoading, SectionBlock, SubTitle } from "./panel";
import { EXTERNAL_API_DEFAULTS, fillTemplate, type ExternalApiKey } from "@/lib/external-api";

/* ==================== 配置项定义 ==================== */

interface ApiFieldSpec {
  key: ExternalApiKey;
  label: string;
  /** 该地址实际支撑的能力，让管理员知道改了会影响哪里 */
  usage: string;
  /** 模板型地址可用的占位符（如 favicon 服务的 {host}），用于额外提示 */
  placeholders?: string;
}

const IMAGE_FIELDS: ApiFieldSpec[] = [
  { key: "wallpaperLandscapeApi", label: "随机风景壁纸", usage: "壁纸种类选「随机风景」时使用" },
  { key: "wallpaperAnimeApi", label: "随机动漫壁纸", usage: "壁纸种类选「随机动漫」时使用" },
  { key: "bingWallpaperApi", label: "必应每日壁纸", usage: "壁纸种类选「必应每日壁纸」时使用" },
  { key: "randomAvatarApi", label: "随机头像接口", usage: "开启「随机头像」且未设置头像时使用" },
];

const ICON_FIELDS: ApiFieldSpec[] = [
  { key: "iconifyApi", label: "Iconify 图标接口", usage: "在线图标（prefix:name）与后台图标浏览器（可切换任意图标集）" },
  {
    key: "faviconApi",
    label: "自定义 favicon 服务",
    usage: "后台「从网站获取」图标时优先尝试（留空则只用内置多源）",
    placeholders: "{host}",
  },
];

const FIELD_GROUPS: {
  title: string;
  subtitle: string;
  dotClass: string;
  fields: ApiFieldSpec[];
}[] = [
  {
    title: "图片服务",
    subtitle: "壁纸 · 头像",
    dotClass: "bg-sky-500 shadow-[0_0_8px_rgba(14,165,233,0.5)]",
    fields: IMAGE_FIELDS,
  },
  {
    title: "图标服务",
    subtitle: "Iconify · favicon",
    dotClass: "bg-violet-500 shadow-[0_0_8px_rgba(139,92,246,0.5)]",
    fields: ICON_FIELDS,
  },
];

/** 探测用占位符取值：把模板填成可直接访问的具体地址（{host} 用示例域名） */
function fillForTest(template: string): string {
  return fillTemplate(template, { w: 200, h: 200, kw: "test", host: "example.com" });
}

/* ==================== 单个配置项 ==================== */

type TestResult = { ok: boolean; message: string } | null;

function ApiField({
  spec,
  value,
  onChange,
}: {
  spec: ApiFieldSpec;
  value: string;
  onChange: (v: string) => void;
}) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult>(null);
  const defaultValue = EXTERNAL_API_DEFAULTS[spec.key];
  const usingDefault = (value || "").trim() === "";

  /** 探活：未填写时测内置默认地址；模板型地址先填好占位符再请求 */
  const handleTest = async () => {
    const raw = (value || "").trim() || defaultValue;
    if (!raw) {
      toast.error("该服务没有内置默认地址，请先填写后再测试");
      return;
    }
    setTesting(true);
    setResult(null);
    try {
      const res = await fetch("/api/external-apis/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: fillForTest(raw) }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; message?: string; latencyMs?: number; error?: string }
        | null;
      if (!res.ok) {
        toast.error(data?.error || "测试失败");
        return;
      }
      setResult({
        ok: !!data?.ok,
        message: `${data?.message || ""}${data?.latencyMs ? ` · ${data.latencyMs}ms` : ""}`,
      });
    } catch {
      toast.error("网络错误，测试未完成");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor={spec.key} className="text-sm font-normal">
          {spec.label}
        </Label>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={handleTest}
            disabled={testing}
          >
            {testing && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            测试
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => {
              onChange("");
              setResult(null);
            }}
            disabled={usingDefault}
            title="清空自定义地址，恢复使用内置默认"
          >
            <RotateCcw className="mr-1 h-3 w-3" />
            默认
          </Button>
        </div>
      </div>
      <Input
        id={spec.key}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={defaultValue || "未内置默认值，请填写完整地址"}
        spellCheck={false}
        autoComplete="off"
      />
      <p className="text-xs text-muted-foreground">
        {spec.usage}
        {spec.placeholders && `；可用占位符 ${spec.placeholders}`}
        {usingDefault && "；当前使用内置默认地址"}
      </p>
      {result && (
        <p
          className={`flex items-center gap-1 text-xs ${
            result.ok ? "text-emerald-600" : "text-destructive"
          }`}
        >
          {result.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
          {result.message}
        </p>
      )}
    </div>
  );
}

/* ==================== 面板 ==================== */

export default function ExternalApiPanel() {
  const { profile, loading, set, save } = useProfileForm({
    id: "external-api",
    label: "外部服务",
  });

  if (loading) {
    return <PanelLoading />;
  }

  return (
    <Card>
      <CardContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          className="space-y-3 pb-16"
        >
          <p className="rounded-lg border border-border bg-muted/30 px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">
            这里集中管理站点依赖的第三方服务地址。免费接口随时可能下线（此前壁纸源与一言源都失效过，当时只能改代码重新部署）。
            <span className="font-medium text-foreground">留空即使用内置默认地址</span>
            ，填写后立即生效、无需重新构建；改完可点「测试」当场验证连通性。
          </p>

          {FIELD_GROUPS.map((group) => (
            <SectionBlock
              key={group.title}
              open
              title={group.title}
              subtitle={group.subtitle}
              dotClass={group.dotClass}
            >
              <div className="space-y-3.5">
                <SubTitle>{group.title}</SubTitle>
                {group.fields.map((spec) => (
                  <ApiField
                    key={spec.key}
                    spec={spec}
                    value={profile[spec.key]}
                    onChange={(v) => set(spec.key, v)}
                  />
                ))}
              </div>
            </SectionBlock>
          ))}

          <p className="text-xs text-muted-foreground">
            说明：连通性测试由服务器发起，出于安全考虑会拒绝探测内网 / 本机地址；
            若服务自建在内网，测试会提示被拒绝，但不影响前台实际使用。
          </p>
          <p className="text-xs text-muted-foreground">
            提示：壁纸源变更后，服务器已缓存的旧壁纸会在「主题与壁纸 → 壁纸缓存刷新」的周期到达后
            自动替换为新源的图；若该项设为「不刷新」，可临时切换一次壁纸种类以触发重新下载。
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
