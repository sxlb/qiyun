"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";
import { loadProfile, setCachedProfile, type ProfileShape } from "./profileShared";

/**
 * 后台「全局保存」注册中心。
 *
 * 背景：各面板原本各自保存，切到别的 tab 后未保存的改动就丢了；且站点信息 / 主题 / 音乐
 * 三个面板都是「PUT 完整 profile」，逐个保存会互相覆盖。
 *
 * 因此这里统一注册各面板的保存能力：
 * - profile 类面板（站点信息/主题/音乐）提供 profilePatch()，全局保存时**合并成一次 PUT**，
 *   彻底避免互相覆盖；patch 只包含该面板真正改动过的字段。
 * - 自带 API 的面板（链接/技能/作品/公告）提供 save()，全局保存时串行执行。
 */
export interface SaveEntry {
  /** 面板唯一标识 */
  id: string;
  /** 面板名称（用于提示） */
  label: string;
  /** 是否有未保存改动 */
  dirty: boolean;
  /** 本面板改动过的 profile 字段（仅含改过的键） */
  profilePatch?: () => Record<string, unknown> | null;
  /** 自带 API 的保存逻辑，返回是否成功 */
  save?: () => Promise<boolean>;
  /** 当前编辑修订号（见同文件 useEditRevision）：用于判断保存期间是否又有新改动 */
  revision?: () => number;
  /**
   * 保存成功后清除脏标记。
   * 仅 profile 类面板需要实现：它们的写入由注册中心合并后统一发起，
   * 自带 API 的面板在自己的 save() 里管理脏标记（避免被注册中心提前清掉）。
   */
  markClean?: (outcome: SaveOutcome) => void;
  /** 保存前本地校验；返回文案表示阻止保存 */
  validate?: () => string | null;
}

/** 一次合并保存的结果，回传给 profile 类面板用于决定基线/脏标记 */
export interface SaveOutcome {
  /** 本次提交对应的编辑修订号 */
  revision: number;
  /** 实际提交到服务端的完整配置（若无则面板沿用自身表单值作基线） */
  payload?: ProfileShape;
}

/**
 * 汇总一次全局保存的结果（纯函数，便于单测）。
 * 优先级：失败 > 保存期间又有新改动 > 全部成功。
 */
export function summarizeSaveOutcome(
  failed: string[],
  stillDirty: string[]
): { level: "success" | "warning" | "error"; message: string } {
  if (failed.length > 0) {
    return { level: "error", message: `以下面板保存失败：${failed.join("、")}` };
  }
  if (stillDirty.length > 0) {
    return {
      level: "warning",
      message: `已保存，但${stillDirty.join("、")}在保存期间又有新的修改，请再次保存`,
    };
  }
  return { level: "success", message: "全部修改已保存" };
}

interface GlobalSaveContextValue {
  register: (entry: SaveEntry) => void;
  unregister: (id: string) => void;
  saveAll: () => Promise<void>;
  saving: boolean;
  dirtyCount: number;
  dirtyLabels: string[];
}

const GlobalSaveContext = createContext<GlobalSaveContextValue | null>(null);

export function GlobalSaveProvider({ children }: { children: ReactNode }) {
  const entriesRef = useRef(new Map<string, SaveEntry>());
  const [, forceRender] = useState(0);
  const [saving, setSaving] = useState(false);

  const register = useCallback((entry: SaveEntry) => {
    const prev = entriesRef.current.get(entry.id);
    entriesRef.current.set(entry.id, entry);
    // 只在「脏状态 / 名称」变化时刷新，避免任意字段输入都触发全局重渲染
    if (!prev || prev.dirty !== entry.dirty || prev.label !== entry.label) {
      forceRender((v) => v + 1);
    }
  }, []);

  const unregister = useCallback((id: string) => {
    if (entriesRef.current.delete(id)) forceRender((v) => v + 1);
  }, []);

  const saveAll = useCallback(async () => {
    const entries = Array.from(entriesRef.current.values()).filter((e) => e.dirty);
    if (entries.length === 0) {
      toast.info("没有需要保存的修改");
      return;
    }

    // 1) 先做本地校验，任一不通过就整体中止，避免出现「保存了一半」
    for (const entry of entries) {
      const message = entry.validate?.();
      if (message) {
        toast.error(`${entry.label}：${message}`);
        return;
      }
    }

    setSaving(true);
    try {
      // 2) profile 类面板：合并补丁后一次性提交
      const profileEntries = entries.filter((e) => e.profilePatch);
      const merged: Record<string, unknown> = {};
      // 修订号紧挨着补丁读取：保证「提交内容」与「提交时刻」严格对应，
      // 之后面板据此判断保存期间是否又有新改动
      const revisions = new Map<string, number>();
      for (const entry of profileEntries) {
        const patch = entry.profilePatch?.();
        if (patch) Object.assign(merged, patch);
        revisions.set(entry.id, entry.revision?.() ?? 0);
      }
      if (profileEntries.length > 0) {
        const base = await loadProfile(true);
        if (!base) {
          toast.error("读取站点配置失败，请刷新后重试");
          return;
        }
        const payload = { ...base, ...merged } as ProfileShape;
        const res = await fetch("/api/profile", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          toast.error(data?.error || "站点配置保存失败");
          return;
        }
        setCachedProfile(payload);
        profileEntries.forEach((entry) =>
          entry.markClean?.({ revision: revisions.get(entry.id) ?? 0, payload })
        );
      }

      // 3) 自带 API 的面板：串行保存（SQLite 单写，顺序执行更稳）。
      //    这里不代它们清脏标记：各自的 save() 会依据「保存期间是否又有新改动」
      //    自行决定能否清，注册中心提前清除会让用户误以为已保存。
      const failed: string[] = [];
      for (const entry of entries) {
        if (!entry.save) continue;
        try {
          const ok = await entry.save();
          if (!ok) failed.push(entry.label);
        } catch {
          failed.push(entry.label);
        }
      }

      // 保存结束后重新读取注册表：拿到各面板最新的脏状态
      // （保存期间用户继续编辑的面板仍为脏，提示再存一次，而不是谎报「已保存」）
      const stillDirty = Array.from(entriesRef.current.values())
        .filter((e) => e.dirty)
        .map((e) => e.label);
      const outcome = summarizeSaveOutcome(failed, stillDirty);
      if (outcome.level === "error") toast.error(outcome.message);
      else if (outcome.level === "warning") toast.warning(outcome.message);
      else toast.success(outcome.message);
    } finally {
      setSaving(false);
    }
  }, []);

  const entries = Array.from(entriesRef.current.values());
  const dirtyEntries = entries.filter((e) => e.dirty);

  return (
    <GlobalSaveContext.Provider
      value={{
        register,
        unregister,
        saveAll,
        saving,
        dirtyCount: dirtyEntries.length,
        dirtyLabels: dirtyEntries.map((e) => e.label),
      }}
    >
      {children}
    </GlobalSaveContext.Provider>
  );
}

/** 面板注册自身保存能力的 Hook（同一 id 重复注册会覆盖） */
export function useRegisterSave(entry: SaveEntry) {
  const ctx = useContext(GlobalSaveContext);
  const latest = useRef(entry);
  latest.current = entry;

  const { id, label, dirty } = entry;
  const register = ctx?.register;
  const unregister = ctx?.unregister;

  useEffect(() => {
    if (!register || !unregister) return;
    // 只暴露面板**真正提供**的能力：saveAll 以「是否提供 profilePatch」区分
    // profile 类面板（合并补丁一次性提交）与自带 API 的面板（各自 save）。
    // 若无条件提供空函数，所有面板都会被当成 profile 面板，导致合并分支提交后
    // 就把全部面板的脏标记清掉 —— 一旦某个面板的 save() 随后失败，用户会误以为已保存。
    register({
      id,
      label,
      dirty,
      profilePatch: latest.current.profilePatch
        ? () => latest.current.profilePatch?.() ?? null
        : undefined,
      save: latest.current.save ? () => latest.current.save?.() ?? Promise.resolve(true) : undefined,
      revision: () => latest.current.revision?.() ?? 0,
      markClean: (outcome) => latest.current.markClean?.(outcome),
      validate: () => latest.current.validate?.() ?? null,
    });
    return () => unregister(id);
  }, [id, label, dirty, register, unregister]);
}

/** 全局保存状态（供面板按钮禁用等场景读取） */
export function useGlobalSaveState() {
  const ctx = useContext(GlobalSaveContext);
  return {
    saving: ctx?.saving ?? false,
    dirtyCount: ctx?.dirtyCount ?? 0,
    dirtyLabels: ctx?.dirtyLabels ?? [],
    saveAll: ctx?.saveAll ?? (async () => {}),
  };
}

/**
 * 全局保存悬浮按钮：任一页面有未保存改动时出现，一键保存全部面板改动。
 * 挂在后台外壳上，因此切换 tab 也不会丢失入口。
 */
export function GlobalSaveFab() {
  const { saving, dirtyCount, dirtyLabels, saveAll } = useGlobalSaveState();

  if (dirtyCount === 0 && !saving) return null;

  return (
    <button
      type="button"
      onClick={() => void saveAll()}
      disabled={saving}
      title={`待保存：${dirtyLabels.join("、") || "无"}`}
      aria-label={`保存全部修改（${dirtyCount} 个面板）`}
      className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-lg transition-all hover:opacity-90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-70"
    >
      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
      {saving ? "保存中…" : "保存全部修改"}
      {dirtyCount > 0 && (
        <span className="ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary-foreground/20 px-1.5 text-xs tabular-nums">
          {dirtyCount}
        </span>
      )}
    </button>
  );
}

// ===== 编辑修订号（合并自 useEditRevision.ts） =====

/**
 * 编辑修订号：每次数据改动 +1，用于判断「一次异步保存期间用户是否又改了东西」。
 *
 * 背景：保存是一次 PUT 往返（几百毫秒到一两秒），这期间用户完全可能继续输入。
 * 若保存成功后无条件清掉「有未保存的更改」、并用服务端结果覆盖本地状态，会出现两个问题：
 *   1. 漏提示：界面显示已保存，其实最后几次输入根本没提交；
 *   2. 吞输入：本地状态被服务端结果覆盖，刚敲的内容当场消失。
 *
 * 用法：改动数据时调用 markEdited()（与 setDirty(true) 成对出现），保存前记录
 * currentRevision()，保存成功后用 isStale(savedRevision) 判断：
 *   - false（期间没有新改动）：本次提交覆盖了全部改动 → 可清脏标记、可用服务端结果同步本地；
 *   - true（期间又有新改动）：保留脏标记与本地输入，提示用户再保存一次。
 */
export function useEditRevision() {
  const revisionRef = useRef(0);

  /** 数据被改动时调用 */
  const markEdited = useCallback(() => {
    revisionRef.current += 1;
  }, []);

  /** 这次保存之后是否又产生了新改动 */
  const isStale = useCallback((savedRevision: number) => revisionRef.current !== savedRevision, []);

  /** 供全局保存注册中心读取当前修订号 */
  const currentRevision = useCallback(() => revisionRef.current, []);

  return { markEdited, isStale, currentRevision };
}
