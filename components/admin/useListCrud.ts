"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useGlobalSaveState, useRegisterSave, useEditRevision } from "./GlobalSave";

/**
 * 后台「列表型面板」通用数据层：状态机 + 增删改 + 批量保存 + 全局保存注册。
 *
 * 背景：公告 / 作品 / 技能三个面板先前各自复制了同一套骨架（约 150 行/个）：
 *   items/loading/saving/dirty 状态 → GET 拉列表 → addItem/removeItem/update
 *   → 本地校验 → PUT 整表替换 → 修订号防竞态 → useRegisterSave 注册
 * 三份实现只在「字段、校验规则、提示文案」上不同，逻辑完全一致。
 * 这里把不变的骨架收敛到一处，面板只保留字段定义与行内 JSX。
 *
 * 保存语义（与改造前保持一致）：
 * - 仅提交 isSubmittable 通过的行（如标题非空）；
 * - PUT 整表替换，服务端返回 { list, createdCount, updatedCount, deletedCount }；
 * - 请求往返期间用户继续编辑（修订号变化）→ 保留本地改动与脏标记，提示再次保存；
 * - 保存失败/网络异常 → 保留脏标记，返回 false，由全局保存汇总提示。
 */

/** 列表项公共结构：服务端 id + 前端本地唯一标识（新增行在保存前使用，服务端不持久化） */
export interface CrudItem {
  id?: number;
  clientId?: number;
  name?: string;
}

/** 批量保存返回的增/改/删计数 */
export interface CrudCounts {
  createdCount: number;
  updatedCount: number;
  deletedCount: number;
}

export interface UseListCrudOptions<T extends CrudItem> {
  /** 全局保存注册标识（同一 id 重复注册会覆盖） */
  id: string;
  /** 面板名称（全局保存提示用） */
  label: string;
  /** REST 接口：GET 拉取列表，PUT 批量保存 */
  api: string;
  /** 新增行模板；入参为新增行将落的索引（便于写入 sort） */
  makeEmpty: (index: number) => Omit<T, "clientId">;
  /** 仅提交满足该判定的行；缺省表示全部提交 */
  isSubmittable?: (item: T) => boolean;
  /** 提交前的载荷转换（如把 datetime-local 转 ISO）；缺省表示原样提交 */
  toPayload?: (item: T) => unknown;
  /** 本地校验：返回错误文案表示阻止保存，返回 null 表示通过 */
  validate?: (items: T[]) => string | null;
  /** 逐行校验器数组：每行依次执行，用于 URL 协议 / 图标必填等定位到具体行的错误 */
  rowValidators?: Array<(item: T, index: number) => string | null>;
  /** 保存成功提示文案 */
  successMessage: (counts: CrudCounts) => string;
  /** 加载失败提示（默认「网络错误」） */
  loadError?: string;
  /** 保存异常提示（默认「网络错误」） */
  saveError?: string;
  /** 保存成功后的额外收尾（如收起展开行、重置本地 UI 状态） */
  onSaved?: () => void;
}

/** 新增行本地唯一 id 计数器（模块级，页面内单调递增） */
let clientIdCounter = 0;
const nextClientId = () => ++clientIdCounter;

export function useListCrud<T extends CrudItem>(options: UseListCrudOptions<T>) {
  // 用 ref 持有最新配置：save/validate 会被注册中心在任意时刻调用，
  // 若直接闭包捕获 options 会读到首次渲染的旧值（如过期的 items）。
  const optsRef = useRef(options);
  optsRef.current = options;

  const { api } = options;
  const { markEdited, isStale, currentRevision } = useEditRevision();
  // 全局保存进行中：提示统一由注册中心汇总，面板内不再重复弹
  const { saving: globalSaving } = useGlobalSaveState();

  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  /** 拉取远端列表（首次加载与保存后的兜底刷新共用） */
  const fetchList = useCallback(async (): Promise<T[] | null> => {
    const res = await fetch(api);
    if (!res.ok) return null;
    return (await res.json()) as T[];
  }, [api]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchList();
        if (cancelled) return;
        if (data) setItems(data);
        else toast.error(optsRef.current.loadError ?? "网络错误");
      } catch {
        if (!cancelled) toast.error(optsRef.current.loadError ?? "网络错误");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchList]);

  const addItem = useCallback(() => {
    setItems((prev) => {
      const draft = optsRef.current.makeEmpty(prev.length);
      return [...prev, { ...draft, clientId: nextClientId() } as T];
    });
    markEdited();
    setDirty(true);
  }, [markEdited]);

  const removeItem = useCallback(
    (index: number) => {
      setItems((prev) => prev.filter((_, i) => i !== index));
      markEdited();
      setDirty(true);
    },
    [markEdited]
  );

  // 字段名与值类型放宽为 keyof T / T[keyof T]：
  // 面板行组件通常以 (field, value) 的松散签名回调，泛型 K 会造成调用点推断冲突。
  const update = useCallback(
    (index: number, field: keyof T, value: T[keyof T]) => {
      setItems((prev) => {
        const next = [...prev];
        next[index] = { ...next[index], [field]: value } as T;
        return next;
      });
      markEdited();
      setDirty(true);
    },
    [markEdited]
  );

  const collectErrors = useCallback((): string | null => {
    // 1. 表格级校验（如公告必填标题）
    const tableMsg = optsRef.current.validate?.(items) ?? null;
    if (tableMsg) return tableMsg;
    // 2. 逐行校验（URL 协议 / 图标必填等，定位到具体行报错）
    const rows = optsRef.current.rowValidators;
    if (!rows || !rows.length) return null;
    const errors: string[] = [];
    items.forEach((item, i) => {
      // 跳过空名称/标题行（保存时被 isSubmittable 过滤）
      if (!item.name?.trim()) return;
      for (const validator of rows) {
        const msg = validator(item, i + 1);
        if (msg) errors.push(msg);
      }
    });
    return errors.length > 0 ? errors.join("；") : null;
  }, [items]);

  const save = useCallback(async (): Promise<boolean> => {
    const { isSubmittable, toPayload, successMessage, saveError } = optsRef.current;

    const message = optsRef.current.validate?.(items) ?? null;
    if (message) {
      toast.error(message);
      return false;
    }

    const rows = isSubmittable ? items.filter(isSubmittable) : items;
    const payload = toPayload ? rows.map(toPayload) : rows;
    // 记录提交时刻的修订号：请求往返期间用户仍可能继续编辑
    const savedRevision = currentRevision();

    setSaving(true);
    try {
      const res = await fetch(api, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(d.error || "保存失败");
        return false;
      }

      if (isStale(savedRevision)) {
        // 保存期间又有新改动：保留本地列表（含新改动）与脏标记，别用服务端结果覆盖
        if (!globalSaving) toast.warning("已保存，但保存期间又有新的修改，请再次保存");
        return true;
      }

      const data = (await res.json().catch(() => null)) as
        | ({ list?: T[] } & Partial<CrudCounts>)
        | null;
      toast.success(
        successMessage({
          createdCount: data?.createdCount ?? 0,
          updatedCount: data?.updatedCount ?? 0,
          deletedCount: data?.deletedCount ?? 0,
        })
      );

      if (data && Array.isArray(data.list)) setItems(data.list);
      else {
        // 服务端未回传列表：主动重取，避免本地与服务端漂移
        const fresh = await fetchList();
        if (fresh) setItems(fresh);
      }
      setDirty(false);
      optsRef.current.onSaved?.();
      return true;
    } catch {
      toast.error(saveError ?? "网络错误");
      return false;
    } finally {
      setSaving(false);
    }
  }, [items, api, currentRevision, isStale, globalSaving, fetchList]);

  // 接入全局保存：脏标记由本 hook 的 save() 自行维护，注册中心不会代清。
  useRegisterSave({
    id: options.id,
    label: options.label,
    dirty,
    save,
    revision: currentRevision,
    validate: () => collectErrors(),
  });

  return { items, loading, saving, dirty, addItem, removeItem, update, collectErrors, save };
}
