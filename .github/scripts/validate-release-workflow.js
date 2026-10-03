#!/usr/bin/env node
/**
 * 发布链路结构校验 —— 对 .github/workflows/release.yml 做静态断言。
 *
 * 为什么需要它：这套流程里出过多次「改了流程但没有任何东西验证它」的事故，
 * 而它们大多只在真正的发布时才暴露，代价是一次失败的发布。典型两例：
 *   1) 合成多架构清单时按 `sha256:*` 去匹配 digest 文件名，但构建阶段落盘的是
 *      **去掉前缀的裸十六进制串**，一个文件都取不到 → 合成阶段必然中止；
 *   2) 多个镜像仓库写成重复的 `name=` 字段。它不报错，但后一个会覆盖前一个，
 *      只有最后一个仓库收到清单 → 合成时从主仓库取不到来源 digest。
 * 这两条都属于「不报错、但结果不对」，靠人眼审查很难拦住，因此写成断言。
 *
 * 运行：node .github/scripts/validate-release-workflow.js
 * 依赖：js-yaml（已在 devDependencies 中显式声明，不再依赖传递依赖）
 */
/* eslint-disable @typescript-eslint/no-require-imports -- 这是以 CommonJS 运行的 CI 工具脚本，
   不经打包器处理，require 是它在 Node 下的正确写法；其余规则仍然生效 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const WORKFLOW = path.join(ROOT, ".github", "workflows", "release.yml");

const results = [];
const check = (ok, label, hint) => results.push({ ok: !!ok, label, hint });

// ---------- 解析 ----------
let raw = "";
let doc = null;
try {
  raw = fs.readFileSync(WORKFLOW, "utf8");
  doc = require("js-yaml").load(raw);
} catch (e) {
  console.error(`✗ 无法解析 ${path.relative(ROOT, WORKFLOW)}：${e.message}`);
  process.exit(1);
}

// YAML 1.1 会把裸 `on` 解析成布尔键 true，两种都兼容
const on = doc.on || doc[true] || {};
const jobs = doc.jobs || {};
const jobNames = Object.keys(jobs);

const prepare = jobs.prepare || {};
const pkg = jobs.package || {};
const image = jobs.image || {};
const publish = jobs.publish || {};

const stepsOf = (job) => job.steps || [];
const findStep = (job, re) => stepsOf(job).find((s) => re.test(s.name || ""));
const runOf = (step) => (step && typeof step.run === "string" ? step.run : "");
const jsonOf = (job) => JSON.stringify(stepsOf(job));

// ---------- 触发与并发 ----------
check(Array.isArray(on.push?.tags) && on.push.tags[0] === "[0-9]+.[0-9]+.[0-9]+",
  "标签触发只接受无 v 前缀的语义化版本");
check(!!on.pull_request, "保留了 PR 门禁触发");
check(on.workflow_dispatch?.inputs?.dry_run?.type === "boolean",
  "workflow_dispatch 提供 dry_run 布尔开关（用于打标签前干跑）");
check(!!doc.concurrency?.group && doc.concurrency["cancel-in-progress"] === false,
  "发布流程串行且不取消排队中的 run");
check(/github\.event_name == 'pull_request'/.test(String(doc.concurrency?.group || "")),
  "PR 走独立并发分组，不会顶掉排队中的发布");

// ---------- job 结构 ----------
check(
  JSON.stringify(jobNames) === JSON.stringify(["test", "prepare", "package", "image", "publish"]),
  "job 拆分符合预期（test / prepare / package / image / publish）",
  `实际为：${jobNames.join(", ")}`
);
check(prepare.needs === "test", "prepare 依赖 test 门禁");
check(
  ["VERSION", "TAG", "CN_TIME"].every((k) => prepare.outputs?.[k]),
  "prepare 统一输出 VERSION / TAG / CN_TIME"
);
check(
  Array.isArray(publish.needs) &&
    ["prepare", "package", "image"].every((n) => publish.needs.includes(n)),
  "publish 依赖 prepare / package / image"
);

// 版本号只有一处来源：否则各 job 可能算出不同的值
const jobsUsingStepVersion = Object.entries(jobs)
  .filter(([, job]) => jsonOf(job).includes("steps.version.outputs"))
  .map(([name]) => name);
check(
  jobsUsingStepVersion.every((n) => n === "prepare" || n === "package"),
  "steps.version 引用只出现在 prepare / package",
  `出现在：${jobsUsingStepVersion.join(", ")}`
);
check(!!findStep(pkg, /Resolve version/), "package 内把 job 输出落回 step 输出（沿用旧引用）");

// ---------- 多架构构建 ----------
check(image["runs-on"] === "${{ matrix.runner }}", "image 由矩阵决定运行环境");
const matrix = image.strategy?.matrix?.include || [];
check(matrix.length === 2, "image 矩阵恰好两个架构");
check(matrix.some((m) => m.platform === "linux/amd64" && m.runner === "ubuntu-latest"),
  "amd64 用 ubuntu-latest");
check(matrix.some((m) => m.platform === "linux/arm64" && m.runner === "ubuntu-24.04-arm"),
  "arm64 用免费原生 runner（不用 QEMU 模拟）");

const buildStep = findStep(image, /Build and push by digest/);
const namesStep = findStep(image, /Compose image names/);
const namesRun = runOf(namesStep);
check(!!buildStep, "存在按 digest 推送的构建步骤");
check(!!namesStep, "存在镜像仓库拼装步骤");
check(/steps\.names\.outputs\.outputs/.test(buildStep?.with?.outputs || ""),
  "构建步骤消费拼装好的 outputs");
check(/push-by-digest=true/.test(namesRun) && /name-canonical=true/.test(namesRun),
  "构建按 digest 推送，而非直接打版本标签");
check(buildStep?.with?.provenance === false && buildStep?.with?.sbom === false,
  "关闭 provenance / sbom（否则每个架构推的是索引，合成后成为嵌套清单）");
check(!("push-by-digest" in (buildStep?.with || {})) && !("name-canonical" in (buildStep?.with || {})),
  "未把 push-by-digest / name-canonical 误写成 build-push-action 的顶层输入");
check(/"name=[^"\n]+,[^"\n]+"/.test(namesRun),
  "多仓库写成「单个 name 字段 + 引号包裹 + 逗号分隔」的官方写法");
(() => {
  const withHub = (namesRun.match(/outputs=type=image[^\n]*/g) || []).find((l) => l.includes("docker.io")) || "";
  const nameKeys = (withHub.match(/(?:^|[,"])name=/g) || []).length;
  check(nameKeys === 1, "多仓库只写一个 name 字段（重复写会互相覆盖，只剩最后一个）",
    `实际出现 ${nameKeys} 个 name= 字段`);
})();
check(/name=\$\{GHCR_REPO\}/.test(namesRun) && /GHCR_REPO="ghcr\.io\/sxlb\/qiyun"/.test(namesRun),
  "每个架构都推到 GHCR（合成时的来源仓库）");
const digestSteps = stepsOf(image).filter((s) => /digest/i.test(s.name || ""));
check(digestSteps.filter((s) => s.if).length >= 2, "干跑时不导出、不上传 digest（避免留下空构件）");
check(/Upload digest/.test(jsonOf(image)), "非干跑时上传各架构 digest");

// ---------- 合成阶段（干跑覆盖不到，重点防呆）----------
const mergeStep = findStep(publish, /Create multi-arch manifest/);
const mergeRun = runOf(mergeStep);
const verifyStep = findStep(publish, /Verify manifest covers both architectures/);
const releaseStep = findStep(publish, /Create GitHub Release/);

check(publish.if && /!inputs\.dry_run/.test(String(publish.if)), "publish 在干跑时被跳过");
// buildx 的 type=gha 缓存本身也会以构件形式出现在同一次运行里（名为 sxlb~qiyun~XXX.dockerbuild），
// 全量下载会连它们一起拉，而它们下载必然失败。0.0.4 的首次发布就是这样卡在 publish 第一步的。
(() => {
  const dl = stepsOf(publish).filter((s) => /download-artifact/.test(String(s.uses || "")));
  const unscoped = dl.filter((s) => !(s.with && (s.with.name || s.with.pattern)));
  check(dl.length >= 2, "publish 分别取回 digest 与打包产物");
  check(
    dl.length > 0 && unscoped.length === 0,
    "下载构件时显式指定 name / pattern（全量下载会把 buildx 缓存构件也拉下来并失败）",
    `未限定的下载步骤：${unscoped.map((s) => s.name).join(", ")}`
  );
})();
check(!!mergeStep && /imagetools create/.test(mergeRun), "publish 合成多架构清单");
check(!mergeRun.includes("name 'sha256:*'"),
  "digest 收集没有按 sha256:* 匹配（文件名是裸十六进制，那样会一个都取不到）");
check(mergeRun.includes("/[0-9a-f]{64}$"),
  "digest 收集按 64 位十六进制文件名匹配");
check(/\[ "\$\{#FILES\[@\]\}" -lt 2 \]/.test(mergeRun),
  "digest 少于 2 个时明确报错退出（而不是拿半个清单去发布）");
check(/imagetools inspect "\$ref"/.test(mergeRun),
  "合成前预检来源 digest 在主仓库可取到（把晦涩的 manifest unknown 变成指向根因的提示）");
check(/-t "\$\{SRC\}:\$\{TAG\}"\s*$/.test(mergeRun.trim()) || /TAGS\+=\(-t "\$\{SRC\}:\$\{TAG\}"\)/.test(mergeRun),
  "GHCR 的标签最后打（中途失败时不留标签，可直接重打而不必原地重发）");
check(!!verifyStep && /linux\/amd64/.test(runOf(verifyStep)) && /linux\/arm64/.test(runOf(verifyStep)),
  "合成后校验清单确实包含两个架构（少一个架构同样会返回成功）");
check(/-t .*docker\.io/.test(mergeRun) === /DOCKERHUB_TOKEN/.test(mergeRun),
  "Docker Hub 标签与是否配置密钥保持一致");
check(!!releaseStep && /artifacts\/packages\//.test(JSON.stringify(releaseStep.with || {})),
  "Release 使用构件里的 Notes 与两个 tar 包");

// ---------- 输出 ----------
const failed = results.filter((r) => !r.ok);
console.log(`发布链路结构校验：${results.length} 项`);
for (const r of results) {
  console.log(`  ${r.ok ? "✓" : "✗"} ${r.label}`);
  if (!r.ok && r.hint) console.log(`      ${r.hint}`);
}
if (failed.length) {
  console.log("");
  console.error(`✗ ${failed.length} 项不通过，已中止（这属于流程自身的回归，不是业务代码问题）`);
  for (const r of failed) {
    console.error(`::error file=.github/workflows/release.yml::${r.label}${r.hint ? " —— " + r.hint : ""}`);
  }
  process.exit(1);
}
console.log(`\n✓ 全部 ${results.length} 项通过`);
