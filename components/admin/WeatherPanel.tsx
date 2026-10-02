"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2, MapPin, Cloud, CloudSun, Eye, EyeOff, Check, Settings2 } from "lucide-react";
import { PanelLoading } from "./panel";
import { useRegisterSave } from "./GlobalSave";
import { loadProfile, setCachedProfile } from "./profileShared";

type Provider = "amap" | "tencent" | "tencent-key" | "tencent-loc-amap";

/** 表单快照键：用于判断是否存在未保存改动（字段间用不可见字符分隔，避免拼接歧义） */
function formSnapshot(v: {
  provider: string;
  amapKey: string;
  amapSecretKey: string;
  txWeatherKey: string;
  txWeatherSk: string;
  weatherCity: string;
}): string {
  return [v.provider, v.amapKey, v.amapSecretKey, v.txWeatherKey, v.txWeatherSk, v.weatherCity].join("\u0000");
}

const PROVIDERS: { id: Provider; name: string; desc: string; icon: typeof Cloud }[] = [
  { id: "tencent", name: "腾讯天气", desc: "免费无需 Key，需填写城市", icon: Cloud },
  { id: "tencent-key", name: "腾讯天气 Key 版", desc: "需腾讯位置服务 Key，IP 定位 + 实况", icon: Cloud },
  { id: "amap", name: "高德地图", desc: "免费，需申请 Web 服务 Key", icon: MapPin },
  {
    id: "tencent-loc-amap",
    name: "混合模式",
    desc: "腾讯 IP 定位（精确到区县）+ 高德实况天气，需两方 Key",
    icon: CloudSun,
  },
];

export default function WeatherPanel() {
  const [provider, setProvider] = useState<Provider>("tencent");
  const [amapKey, setAmapKey] = useState("");
  const [amapSecretKey, setAmapSecretKey] = useState("");
  const [txWeatherKey, setTxWeatherKey] = useState("");
  const [txWeatherSk, setTxWeatherSk] = useState("");
  const [weatherCity, setWeatherCity] = useState("");
  const [showAmapKey, setShowAmapKey] = useState(false);
  const [showAmapSk, setShowAmapSk] = useState(false);
  const [showTxKey, setShowTxKey] = useState(false);
  const [showTxSk, setShowTxSk] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  /** 是否存在未保存改动：驱动「保存全部修改」是否纳入本面板 */
  const [dirty, setDirty] = useState(false);
  /** 载入 / 保存成功时的基线快照 */
  const baselineRef = useRef<string>("");

  /** 当前表单快照 */
  const snapshot = formSnapshot({ provider, amapKey, amapSecretKey, txWeatherKey, txWeatherSk, weatherCity });

  useEffect(() => {
    if (loading) return;
    setDirty(snapshot !== baselineRef.current);
  }, [snapshot, loading]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        // 统一从 /api/profile 读取天气配置（与 ProfilePanel 共享同一数据源）
        const res = await fetch("/api/profile");
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          // 兼容历史配置：wttr / uapis 已下线，落到默认腾讯天气
          const wp: string = data.weatherProvider || "tencent";
          const loaded = {
            provider: (["amap", "tencent", "tencent-key", "tencent-loc-amap"].includes(wp)
              ? wp
              : "tencent") as Provider,
            amapKey: (data.amapKey as string) || "",
            amapSecretKey: (data.amapSecretKey as string) || "",
            txWeatherKey: (data.txWeatherKey as string) || "",
            txWeatherSk: (data.txWeatherSk as string) || "",
            weatherCity: (data.weatherCity as string) || "",
          };
          setProvider(loaded.provider);
          setAmapKey(loaded.amapKey);
          setAmapSecretKey(loaded.amapSecretKey);
          setTxWeatherKey(loaded.txWeatherKey);
          setTxWeatherSk(loaded.txWeatherSk);
          setWeatherCity(loaded.weatherCity);
          // 记录基线：此后与快照比对即可判断是否有未保存改动
          baselineRef.current = formSnapshot(loaded);
        } else {
          toast.error("加载配置失败");
        }
      } catch {
        if (!cancelled) toast.error("网络错误");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  /** 保存前本地校验：返回文案表示阻止保存（手动保存与「保存全部修改」共用） */
  function validateWeather(): string | null {
    if (provider === "amap" && !amapKey.trim()) return "请填写高德 API Key";
    if (provider === "tencent-key" && !txWeatherKey.trim()) return "请填写腾讯位置服务 Key";
    if (provider === "tencent" && !weatherCity.trim()) return "请填写城市名称";
    if (provider === "tencent-loc-amap") {
      if (!txWeatherKey.trim() || !amapKey.trim())
        return "混合模式需同时填写腾讯位置服务 Key 与高德 API Key";
    }
    return null;
  }

  /** 保存天气配置到统一 /api/profile 端点；返回是否成功（供全局保存判断） */
  async function save(): Promise<boolean> {
    // 前端校验：高德需 Key，腾讯 Key 版需腾讯位置服务 Key，腾讯免费版需城市
    const invalid = validateWeather();
    if (invalid) {
      toast.error(invalid);
      return false;
    }
    // 签名密钥为条件必填（控制台开启数字签名时）：系统无法感知是否开启，
    // 此处做提示性校验，避免"开启签名却漏填密钥导致接口签名失败"的静默故障
    if ((provider === "amap" || provider === "tencent-loc-amap") && amapKey.trim() && !amapSecretKey.trim()) {
      toast.warning("若高德 Key 已开启数字签名，请填写对应私钥（未开启可忽略）");
    }
    if (
      (provider === "tencent-key" || provider === "tencent-loc-amap") &&
      txWeatherKey.trim() &&
      !txWeatherSk.trim()
    ) {
      toast.warning("若腾讯位置服务 Key 已开启数字签名，请填写对应密钥 SK（未开启可忽略）");
    }

    setSaving(true);
    try {
      // 【关键】必须基于「最新完整配置」合并后再提交：/api/profile 是**整表替换**，
      // 只提交天气字段时，profileSchema 的 .default() 会把昵称/头像/主题/SEO 等
      // 未提交字段全部重置为默认值（静默数据丢失）。此处与 useProfileForm 保持一致。
      const base = await loadProfile(true);
      if (!base) {
        toast.error("读取站点配置失败，请刷新后重试");
        return false;
      }
      const payload = {
        ...base,
        weatherProvider: provider,
        amapKey: amapKey.trim(),
        amapSecretKey: amapSecretKey.trim(),
        txWeatherKey: txWeatherKey.trim(),
        txWeatherSk: txWeatherSk.trim(),
        weatherCity: weatherCity.trim(),
      };
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        // 同步内存缓存，避免其它面板切回时读到旧配置
        setCachedProfile(payload);
        toast.success("天气配置已保存");
        // 基线推进到「已落库的内容」，脏标记随之清零
        baselineRef.current = formSnapshot({
          provider,
          amapKey,
          amapSecretKey,
          txWeatherKey,
          txWeatherSk,
          weatherCity,
        });
        setDirty(false);
        return true;
      }
      const data = await res.json().catch(() => null);
      toast.error(data?.error || "保存失败");
      return false;
    } catch {
      toast.error("网络错误");
      return false;
    } finally {
      setSaving(false);
    }
  }

  // 注册到「保存全部修改」：此前本面板未注册，用户在天气面板改完再点全局保存会漏存
  useRegisterSave({
    id: "weather",
    label: "天气设置",
    dirty,
    save,
    validate: validateWeather,
  });

  if (loading) {
    return <PanelLoading />;
  }

  return (
    <Card>
      {/* 页面级标题/描述由 admin/page.tsx 提供，卡内不再重复标题 */}
      <CardContent className="space-y-5">
        {/* 数据源选择 */}
        <div className="space-y-3">
          <Label className="text-xs font-medium text-muted-foreground">天气数据源</Label>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {PROVIDERS.map((p) => {
              const Icon = p.icon;
              const active = provider === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => setProvider(p.id)}
                  className={`group relative overflow-hidden rounded-xl border p-4 text-left transition-all duration-200 ${
                    active
                      ? "border-primary bg-primary/[0.08] shadow-sm shadow-primary/10"
                      : "border-border bg-card hover:border-primary/40 hover:bg-accent/30"
                  }`}
                >
                  {/* 选中标记 */}
                  {active && (
                    <div className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Check className="h-3 w-3" />
                    </div>
                  )}
                  {/* 图标容器 */}
                  <div className={`mb-3 flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${
                    active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary"
                  }`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="text-sm font-semibold">{p.name}</div>
                  <div className="mt-1 text-xs text-muted-foreground leading-relaxed">{p.desc}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 参数配置 */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Settings2 className="h-3.5 w-3.5" />
            </div>
            <span className="text-sm font-medium">参数配置</span>
          </div>
          <div className="space-y-4 rounded-xl border bg-muted/20 p-4">
            {(provider === "amap" || provider === "tencent-loc-amap") && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="amapKey" className="text-xs font-medium text-muted-foreground">
                    高德 Web 服务 API Key{" "}
                    <span className="text-destructive">*</span>
                  </Label>
                  <div className="relative">
                    <Input
                      id="amapKey"
                      type={showAmapKey ? "text" : "password"}
                      value={amapKey}
                      onChange={(e) => setAmapKey(e.target.value)}
                      placeholder="如 8a4f...（16 位十六进制）"
                      className="h-10 pr-10 sm:h-9"
                    />
                    <button
                      type="button"
                      onClick={() => setShowAmapKey((v) => !v)}
                      className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                      aria-label={showAmapKey ? "隐藏 Key" : "显示 Key"}
                      tabIndex={-1}
                    >
                      {showAmapKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    前往{" "}
                    <a
                      href="https://console.amap.com/dev/key/app"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-primary"
                    >
                      高德开放平台
                    </a>{" "}
                    创建「Web 服务」类型的 Key（免费，每日有调用额度）
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="amapSecretKey" className="text-xs font-medium text-muted-foreground">
                    高德私钥（签名密钥）
                  </Label>
                  <div className="relative">
                    <Input
                      id="amapSecretKey"
                      type={showAmapSk ? "text" : "password"}
                      value={amapSecretKey}
                      onChange={(e) => setAmapSecretKey(e.target.value)}
                      placeholder="Key 开启数字签名时填写，未开启可留空"
                      className="h-10 pr-10 sm:h-9"
                    />
                    <button
                      type="button"
                      onClick={() => setShowAmapSk((v) => !v)}
                      className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                      aria-label={showAmapSk ? "隐藏私钥" : "显示私钥"}
                      tabIndex={-1}
                    >
                      {showAmapSk ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Key 在控制台开启了「数字签名」时需填写对应的私钥；未开启签名可留空直接调用。
                    系统将按高德官方规范（参数排序 + 私钥 + MD5）自动生成 sig。
                  </p>
                </div>
              </div>
            )}

            {(provider === "tencent-key" || provider === "tencent-loc-amap") && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="txWeatherKey" className="text-xs font-medium text-muted-foreground">
                    腾讯位置服务 Key <span className="text-destructive">*</span>
                  </Label>
                  <div className="relative">
                    <Input
                      id="txWeatherKey"
                      type={showTxKey ? "text" : "password"}
                      value={txWeatherKey}
                      onChange={(e) => setTxWeatherKey(e.target.value)}
                      placeholder="如 JXVBZ-...（腾讯位置服务 Key）"
                      className="h-10 pr-10 sm:h-9"
                    />
                    <button
                      type="button"
                      onClick={() => setShowTxKey((v) => !v)}
                      className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                      aria-label={showTxKey ? "隐藏 Key" : "显示 Key"}
                      tabIndex={-1}
                    >
                      {showTxKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="txWeatherSk" className="text-xs font-medium text-muted-foreground">
                    腾讯位置服务密钥（SK）
                  </Label>
                  <div className="relative">
                    <Input
                      id="txWeatherSk"
                      type={showTxSk ? "text" : "password"}
                      value={txWeatherSk}
                      onChange={(e) => setTxWeatherSk(e.target.value)}
                      placeholder="如 XXXX-XXXX（Key 开启数字签名时必填）"
                      className="h-10 pr-10 sm:h-9"
                    />
                    <button
                      type="button"
                      onClick={() => setShowTxSk((v) => !v)}
                      className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                      aria-label={showTxSk ? "隐藏密钥" : "显示密钥"}
                      tabIndex={-1}
                    >
                      {showTxSk ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Key 在控制台开启了「数字签名」时需填写对应的密钥（SK）；未开启签名可留空。
                    系统将自动按腾讯签名规范（参数排序 + SK + MD5）生成 sig 调用。
                  </p>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  前往{" "}
                  <a
                    href="https://console.map.qq.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-primary"
                  >
                    腾讯位置服务
                  </a>{" "}
                  创建 Key 并开通「WebServiceAPI」权限；将自动使用腾讯 IP 定位获取 adcode 再查询实况天气
                </p>
              </div>
            )}

            {provider === "tencent" && (
              <div className="space-y-1.5">
                <Label htmlFor="weatherCity" className="text-xs font-medium text-muted-foreground">
                  城市名称 <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="weatherCity"
                  value={weatherCity}
                  onChange={(e) => setWeatherCity(e.target.value)}
                  placeholder="如 深圳、广州、北京"
                  className="h-10 sm:h-9"
                />
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  填写需要查询天气的城市名称，无需配置 Key
                </p>
              </div>
            )}
          </div>
        </div>

        {/* 城市（高德可选；混合模式留空走腾讯 IP 自动定位） */}
        {(provider === "amap" || provider === "tencent-loc-amap") && (
          <div className="space-y-1.5">
            <Label htmlFor="weatherCity-amap" className="text-xs font-medium text-muted-foreground">
              城市（可选）
            </Label>
            <Input
              id="weatherCity-amap"
              value={weatherCity}
              onChange={(e) => setWeatherCity(e.target.value)}
              placeholder={provider === "tencent-loc-amap" ? "如 440100 或 广州，留空走腾讯 IP 定位" : "如 440100 或 广州，留空则使用默认定位"}
              className="h-10 sm:h-9"
            />
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {provider === "tencent-loc-amap"
                ? "留空时使用腾讯 IP 定位（精确到区县）后查高德天气；填写则跳过定位直接查该城市天气"
                : "可填城市 adcode 或城市名，留空使用高德默认定位"}
            </p>
          </div>
        )}

        <Button onClick={save} disabled={saving} className="w-full gap-1.5">
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              保存中...
            </>
          ) : (
            "保存天气配置"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
