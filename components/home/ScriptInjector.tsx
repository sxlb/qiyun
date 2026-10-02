"use client";

import { useEffect, useRef } from "react";

const EVENT_ATTR_RE = /^on/i;
const UNSAFE_URL_RE = /^\s*(javascript|vbscript|data):/i;
const URL_ATTRS = ["href", "src", "action", "formaction", "xlink:href"];
// 直接禁止的属性：srcdoc 内容本身即 HTML、可内嵌脚本，协议白名单无法兜底，一律拦截
const BLOCKED_ATTRS = ["srcdoc"];

/** 仅放行安全属性：拦截 on* 事件属性、srcdoc，以及 javascript:/vbscript:/data: 协议 URL */
function isSafeAttribute(name: string, value: string): boolean {
  const lower = name.toLowerCase();
  if (EVENT_ATTR_RE.test(lower)) return false;
  if (BLOCKED_ATTRS.includes(lower)) return false;
  if (URL_ATTRS.includes(lower)) return !UNSAFE_URL_RE.test(value);
  return true;
}

/** 将源元素的安全属性拷贝到目标元素 */
function copySafeAttributes(source: Element, target: Element): void {
  for (const attr of Array.from(source.attributes)) {
    if (isSafeAttribute(attr.name, attr.value)) {
      target.setAttribute(attr.name, attr.value);
    }
  }
}

/**
 * 后台配置的脚本/标签注入器：
 * - scripts：立即注入（站长验证 meta、自定义 head 脚本等）
 * - deferScripts：延迟注入（统计代码等非关键资源，浏览器空闲时再加载，不阻塞首屏交互）
 *
 * 支持三类输入：
 * 1. 带 <script> 标签的完整片段（统计服务复制来的代码通常自带标签）
 * 2. <meta> / <link> / <style> 等任意 head 标签
 * 3. 裸 JS 代码（无任何标签时视为脚本正文）
 * 页面挂载后注入 <head>，卸载时移除。
 */
export default function ScriptInjector({
  scripts,
  deferScripts = [],
}: {
  scripts: string[];
  /** 延迟到浏览器空闲时段注入的代码片段（如统计脚本） */
  deferScripts?: string[];
}) {
  // 持久化已注入的 deferred 节点：当 deferScripts 从非空变为空时，
  // 需要清除此前已追加到 DOM 中的 deferred 节点
  const deferredRef = useRef<Element[]>([]);
  const nodesRef = useRef<Element[]>([]);

  useEffect(() => {
    const nodes: Element[] = [];
    const deferred: Element[] = [];
    let cancelled = false;

    // 立即注入：headScript 等关键片段
    for (const code of scripts) {
      nodes.push(...injectSnippet(code));
    }
    for (const node of nodes) {
      document.head.appendChild(node);
    }
    nodesRef.current = nodes;

    // 延迟注入：统计代码等非关键资源（requestIdleCallback，回退 2s 定时器）
    if (deferScripts.length > 0) {
      const flush = () => {
        if (cancelled) return;
        for (const code of deferScripts) {
          deferred.push(...injectSnippet(code));
        }
        for (const node of deferred) {
          document.head.appendChild(node);
        }
      };
      let cancel: () => void;
      if (typeof window.requestIdleCallback === "function") {
        const id = window.requestIdleCallback(flush, { timeout: 2000 });
        cancel = () => window.cancelIdleCallback(id);
      } else {
        const id = window.setTimeout(flush, 2000);
        cancel = () => window.clearTimeout(id);
      }

      deferredRef.current = deferred;

      return () => {
        cancelled = true;
        cancel();
        for (const node of [...nodes, ...deferred]) {
          node.parentNode?.removeChild(node);
        }
      };
    }

    // deferScripts 为空：清理上一次 render 中已注入的 deferred 节点（从非空→空的变化）
    const prevDeferred = deferredRef.current;
    deferredRef.current = [];

    return () => {
      for (const node of nodes) {
        node.parentNode?.removeChild(node);
      }
      // 清理上一次的 deferred 节点（在 effect teardown 时执行，确保变更生效）
      for (const node of prevDeferred) {
        node.parentNode?.removeChild(node);
      }
    };
  }, [scripts, deferScripts]);

  return null;
}

/** 解析片段并返回需要追加到 <head> 的节点 */
function injectSnippet(code: string): Element[] {
  const trimmed = code.trim();
  if (!trimmed) return [];

  // 无任何标签的裸 JS：直接作为脚本正文
  if (!/<[\w-]/.test(trimmed)) {
    return [createScript(trimmed)];
  }

  // 含标签：用 DOMParser 解析，保留 head 中全部有效元素（script/meta/link/style 等）
  const doc = new DOMParser().parseFromString(trimmed, "text/html");
  const nodes: Element[] = [];
  for (const child of Array.from(doc.head.childNodes)) {
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const el = child as Element;
    if (el.tagName.toLowerCase() === "script") {
      const script = createScript(el.textContent || "");
      // 保留外部脚本的 src 属性（<script src="...">），仅限安全协议
      const src = el.getAttribute("src");
      if (src && isSafeAttribute("src", src)) {
        script.src = src;
        script.textContent = "";
      }
      nodes.push(script);
    } else if (el.tagName.toLowerCase() === "style") {
      const style = document.createElement("style");
      style.textContent = el.textContent || "";
      nodes.push(style);
    } else {
      // meta / link / 其他自闭合标签
      const node = document.createElement(el.tagName);
      copySafeAttributes(el, node);
      nodes.push(node);
    }
  }
  return nodes;
}

/** 创建可执行的 <script> 元素 */
function createScript(body: string): HTMLScriptElement {
  const el = document.createElement("script");
  el.textContent = body;
  return el;
}
