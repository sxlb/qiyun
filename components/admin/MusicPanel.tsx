"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { PanelLoading } from "./panel";
import { useProfileForm } from "./useProfileForm";
import { SONG_SERVERS, SONG_API_PRESETS, selectClass } from "./profileShared";

/**
 * 音乐设置面板：歌单 API 源、平台、歌单 ID。
 *
 * 保存走 useProfileForm（与「站点信息」「主题与壁纸」一致）：
 * 该 Hook 只提交本面板**改动过**的字段，再与服务端最新配置合并后 PUT。
 * 这一点至关重要 —— /api/profile 会把请求体里的全部字段写库，若只提交部分字段，
 * 缺失字段会被 profileSchema 的默认值填充，导致昵称 / 头像 / 主题等整站配置被重置。
 */

/** 快捷歌单（网易云歌单 ID） */
const QUICK_PLAYLISTS = [
  { id: "3778678", name: "热歌榜" },
  { id: "2884035", name: "网易原创榜" },
  { id: "3779629", name: "新歌榜" },
  { id: "991319590", name: "华语金曲榜" },
];

/** 歌单 API 地址本地校验（与后端 zod 一致），返回文案表示不通过 */
function validateSongApi(p: { songApi: string }): string | null {
  const v = p.songApi.trim();
  if (v === "" || /^https?:\/\//.test(v)) return null;
  return "歌单 API 地址须以 http:// 或 https:// 开头";
}

export default function MusicPanel() {
  // 注册到全局保存：否则「保存全部修改」会漏掉音乐设置
  const { profile, loading, saving, set, save } = useProfileForm({
    id: "music",
    label: "音乐设置",
    validate: () => validateSongApi(profile),
  });

  // 当前 songApi 是否命中预设（未命中且非空时，下拉显示"自定义"占位项）
  const matchedPreset = SONG_API_PRESETS.find((p) => p.value === profile.songApi);

  if (loading) {
    return <PanelLoading />;
  }

  return (
    <Card>
      <CardContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            // 本地校验：非法地址直接拦下，避免等服务端 zod 拒绝后整批保存失败
            const message = validateSongApi(profile);
            if (message) {
              toast.error(message);
              return;
            }
            save();
          }}
          className="space-y-5 pb-16"
        >
          <div className="space-y-5 rounded-lg border border-border bg-card px-5 py-5 shadow-sm">
            {/* ── 歌单 API 源 ── */}
            <div className="space-y-2">
              <Label htmlFor="songApiPreset">选择 API 源</Label>
              <select
                id="songApiPreset"
                className={selectClass}
                value={matchedPreset ? matchedPreset.value : "__custom__"}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === "__custom__") return;
                  set("songApi", val);
                }}
              >
                {SONG_API_PRESETS.map((o) => (
                  <option key={o.value || "custom"} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                {matchedPreset?.desc || "当前为自定义地址，可在下方直接编辑"}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="songApi">歌单 API 地址</Label>
              <Input
                id="songApi"
                value={profile.songApi}
                onChange={(e) => set("songApi", e.target.value)}
                placeholder="https://music.example.com"
              />
              <p className="text-xs text-muted-foreground">
                支持 NeteaseCloudMusicApi / meting 类接口，须为 http(s) 开头的完整地址。
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="songServer">主源平台</Label>
                <select
                  id="songServer"
                  className={selectClass}
                  value={profile.songServer}
                  onChange={(e) => set("songServer", e.target.value)}
                >
                  {SONG_SERVERS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="songId">歌单 ID</Label>
                <Input
                  id="songId"
                  value={profile.songId}
                  onChange={(e) => set("songId", e.target.value)}
                  placeholder="网易云歌单 ID"
                />
              </div>
            </div>

            {/* ── 快捷歌单 ── */}
            <div className="space-y-2">
              <Label>快捷歌单</Label>
              <div className="flex flex-wrap gap-2">
                {QUICK_PLAYLISTS.map((pl) => {
                  const active = profile.songId === pl.id;
                  return (
                    <button
                      key={pl.id}
                      type="button"
                      onClick={() => set("songId", pl.id)}
                      aria-pressed={active}
                      className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                        active
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border hover:border-primary/50 hover:bg-muted/50"
                      }`}
                    >
                      {pl.name}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── 自动播放 ── */}
            <label
              htmlFor="musicAutoplay"
              className="flex cursor-pointer items-center justify-between rounded-lg border border-input bg-background/50 px-3 py-2.5 transition-colors hover:bg-muted/30"
            >
              <span className="flex flex-col">
                <span className="text-sm font-medium">自动播放</span>
                <span className="text-xs text-muted-foreground">
                  访客打开页面后自动播放歌单（浏览器可能拦截未交互页面的自动播放，被拦截时保持静默）
                </span>
              </span>
              <input
                id="musicAutoplay"
                type="checkbox"
                checked={profile.musicAutoplay}
                onChange={(e) => set("musicAutoplay", e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
            </label>
          </div>

          <Button type="submit" disabled={saving} className="w-full">
            {saving ? "保存中..." : "保存音乐设置"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
