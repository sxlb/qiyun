"use client";

/**
 * 后台组件读取「外部服务」配置（壁纸 / 随机头像 / Iconify / favicon 等地址）。
 *
 * 后台各面板共用 profileShared 的内存缓存（首次挂载拉一次 /api/profile，之后即时命中），
 * 因此这里不会产生重复请求。返回值是**原始配置**：空串表示未配置，使用方应回退到内置默认
 * 地址（见 lib/external-api.ts 的 EXTERNAL_API_DEFAULTS / resolveExternalApi）。
 */

import { useEffect, useState } from "react";
import { loadProfile } from "./profileShared";
import {
  EXTERNAL_API_DEFAULTS,
  type ExternalApiConfig,
  type ExternalApiKey,
} from "@/lib/external-api";

/** 初始值：全部视为未配置（读取到配置前的首帧按内置默认渲染） */
const EMPTY_CONFIG: ExternalApiConfig = Object.fromEntries(
  (Object.keys(EXTERNAL_API_DEFAULTS) as ExternalApiKey[]).map((key) => [key, ""])
) as ExternalApiConfig;

export function useExternalApi(): ExternalApiConfig {
  const [config, setConfig] = useState<ExternalApiConfig>(EMPTY_CONFIG);

  useEffect(() => {
    let mounted = true;
    loadProfile()
      .then((profile) => {
        if (!mounted || !profile) return;
        const next: ExternalApiConfig = {};
        for (const key of Object.keys(EXTERNAL_API_DEFAULTS) as ExternalApiKey[]) {
          next[key] = profile[key] ?? "";
        }
        setConfig(next);
      })
      .catch(() => {
        /* 读取失败：保持空配置，使用方回退内置默认地址 */
      });
    return () => {
      mounted = false;
    };
  }, []);

  return config;
}
