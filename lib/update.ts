import fs from "fs";
import path from "path";
import { CURRENT_VERSION } from "./version";

/**
 * 更新执行握手协议（应用容器 <-> 宿主机）。
 *
 * 背景：运行中的容器无法自我重建，因此"更新/回滚"由后台把请求写入共享数据卷
 * （宿主机 ~/qiyun/data 与容器 /app/data 是同一卷），宿主机上的定时器
 * （scripts/update-watch.sh，每分钟轮询）检测到请求后执行 git 拉取/重建/重启，
 * 完成后把结果写回，应用侧读取结果并在后台展示进度与历史。
 *
 * 数据卷目录 data/deploy/ 下：
 *   request.json       已提交、待执行的请求        {id,action,version,requestedBy,createdAt}
 *   running-<id>.json  宿主机正在执行（认领后 rename）
 *   result-<id>.json   执行结果                    {id,action,version,status,message,at}
 *   versions.json      版本/历史权威记录            {currentVersion,updatedAt,history:[{version,action,at}]}
 *   backups/*.db       每次更新前的数据库快照
 */

export type UpdateAction = "update" | "rollback";

/** 更新执行方式：build=宿主机自建构建（git 拉取+本地 docker构建）；image=拉取已发布的镜像 */
export type UpdateMethod = "build" | "image";

export interface UpdateRequest {
  id: string;
  action: UpdateAction;
  method: UpdateMethod;
  version: string; // 发布 tag，如 v1.2.0 或 home-2026-8-26-01-19-01
  estimatedSeconds?: number;
  requestedBy: string;
  createdAt: string; // ISO
}

export interface UpdateResult {
  id: string;
  action: UpdateAction;
  method: UpdateMethod;
  version: string;
  status: "running" | "success" | "failed";
  message: string;
  at: string;
}

export interface DeployVersionEntry {
  version: string;
  action: UpdateAction;
  at: string;
}

export interface DeployVersions {
  currentVersion: string;
  updatedAt: string;
  history: DeployVersionEntry[];
}

/** 默认数据目录：容器内为 /app/data（与应用 SQLite 同一卷） */
export function dataDir(): string {
  return process.env.DATA_DIR || path.join(process.cwd(), "data");
}

export function deployDir(base = dataDir()): string {
  return path.join(base, "deploy");
}

/** 秒级唯一 id（请求/结果文件命名用） */
export function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function ensureDirSync(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * 部署目录不可写：容器以非 root（uid 1001）运行，而 data/deploy 由宿主机脚本以 root 创建时
 * 属主为 root 且非组可写 → 写入握手请求 EACCES。带上目录与修复命令，便于直接照做。
 */
export class DeployDirError extends Error {
  readonly dir: string;
  readonly cause?: unknown;

  constructor(dir: string, cause?: unknown) {
    super(
      `宿主机部署目录 ${dir} 对应用不可写，无法提交更新请求（容器以非 root 运行，而该目录属主为 root）。` +
        `请在服务器执行：sudo chown -R 1001:1001 ${dir} && sudo chmod 775 ${dir}，` +
        `或重跑 scripts/setup-update.sh 修正权限后重试`
    );
    this.name = "DeployDirError";
    this.dir = dir;
    this.cause = cause;
  }
}

/**
 * 检查部署目录是否可写：可写返回 null，不可写返回面向用户的修复提示。
 * 触发更新前先调用，把「服务器内部错误」换成可照做的具体原因。
 */
export function checkDeployDirWritable(base = dataDir()): string | null {
  const dir = deployDir(base);
  try {
    ensureDirSync(dir);
    fs.accessSync(dir, fs.constants.W_OK);
    return null;
  } catch {
    return new DeployDirError(dir).message;
  }
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeAtomic(file: string, data: unknown): void {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function listFiles(dir: string, prefix: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.startsWith(prefix))
      .sort();
  } catch {
    return [];
  }
}

function fileMtime(dir: string, name: string): number {
  try {
    return fs.statSync(path.join(dir, name)).mtimeMs;
  } catch {
    return 0;
  }
}

/* ---------------- 请求 / 结果 / 运行状态 ---------------- */

export function writeRequest(req: UpdateRequest, base = dataDir()): void {
  const dir = deployDir(base);
  try {
    ensureDirSync(dir); // 目标目录可能尚未创建（首次触发前）
    const id = req.id || newId();
    const full: UpdateRequest = { ...req, id };
    writeAtomic(path.join(dir, "request.json"), full);
  } catch (e) {
    // 写入失败最多见的原因是目录不可写（属主 root + 容器非 root），转成可照做的提示
    throw new DeployDirError(dir, e);
  }
}

export function readRequest(base = dataDir()): UpdateRequest | null {
  return readJson<UpdateRequest>(path.join(deployDir(base), "request.json"));
}

export function readRunning(base = dataDir()): UpdateResult | null {
  const dir = deployDir(base);
  const files = listFiles(dir, "running-");
  if (files.length === 0) return null;
  return readJson<UpdateResult>(path.join(dir, files[files.length - 1]));
}

export function writeResult(result: UpdateResult, base = dataDir()): void {
  writeAtomic(path.join(deployDir(base), `result-${result.id}.json`), result);
}

/** 最新的执行结果（按写入时间倒序） */
export function readLatestResult(base = dataDir()): UpdateResult | null {
  const dir = deployDir(base);
  const files = listFiles(dir, "result-");
  if (files.length === 0) return null;
  const newest = files.reduce((a, b) => (fileMtime(dir, b) > fileMtime(dir, a) ? b : a));
  const r = readJson<UpdateResult>(path.join(dir, newest));
  return r ? { ...r, at: r.at || new Date().toISOString() } : null;
}

/** 汇总运行状态：pending=已提交未执行；running=执行中；idle=空闲 */
export type ExecStateKind = "pending" | "running" | "idle";

export interface ExecState {
  kind: ExecStateKind;
  request?: UpdateRequest;
  running?: UpdateResult;
  lastResult?: UpdateResult;
}

export function execState(base = dataDir()): ExecState {
  const dir = deployDir(base);
  // 目录不可创建时不在此抛错：状态查询应当降级为"空闲"，把可写性问题留给触发更新时报明确原因
  try {
    ensureDirSync(dir);
  } catch {
    return { kind: "idle" };
  }
  if (readRequest(base)) {
    return { kind: "pending", request: readRequest(base) ?? undefined };
  }
  const running = readRunning(base);
  if (running) return { kind: "running", running, lastResult: readLatestResult(base) ?? undefined };
  return { kind: "idle", lastResult: readLatestResult(base) ?? undefined };
}

/* ---------------- 版本历史与回滚目标 ---------------- */

export function readVersions(base = dataDir()): DeployVersions | null {
  return readJson<DeployVersions>(path.join(deployDir(base), "versions.json"));
}

/** 可回滚的目标版本（历史中出现过的、且非当前版本，做过去重） */
export function rollbackTargets(base = dataDir(), current = CURRENT_VERSION): string[] {
  const versions = readVersions(base);
  if (!versions) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const h of [...versions.history].reverse()) {
    if (h.version === current) continue;
    if (seen.has(h.version)) continue;
    seen.add(h.version);
    out.push(h.version);
  }
  return out;
}

/* ---------------- 数据库快照（回档数据点） ---------------- */

export interface BackupSnapshot {
  version: string; // 该快照对应的版本（文件名来源版本）
  file: string; // 文件名
  at: number; // mtime
}

/** 列出 data/deploy/backups/ 下的数据库快照（按时间倒序） */
export function listBackupSnapshots(base = dataDir()): BackupSnapshot[] {
  const dir = path.join(deployDir(base), "backups");
  const files = listFiles(dir, "prod-");
  return files
    .map((f) => {
      const m = /^prod-(.+?)-(\d{8}-\d{6})\.db$/.exec(f);
      return {
        version: m ? m[1] : "unknown",
        file: f,
        at: fileMtime(dir, f),
      };
    })
    .sort((a, b) => b.at - a.at);
}