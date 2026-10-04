// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * update-watch.sh 旧镜像清理的结构契约。
 *
 * 为什么用「读源码断言」而不是跑脚本：清理依赖真实的 docker 与容器，
 * 本机（Windows）没有 bash、CI 上也不适合在测试里起 docker。
 * 而这块真正会出事的地方是「删错东西」—— 写成 prune -a 就会顺手删掉同一台机器上
 * 别的服务的镜像，且完全不会报错。这类回归靠跑一遍正常更新根本发现不了，
 * 所以把关键写法直接钉住。
 */

const script = readFileSync(join(process.cwd(), "scripts/update-watch.sh"), "utf8");

/**
 * 剥掉注释行后的代码。
 * 必须剥：脚本里正好有一行注释在解释「不做 docker image prune -a」，
 * 不剥注释的话「禁止 prune -a」这条断言会被自己的说明文字触发，变成永远失败的假警报。
 */
const code = script
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("#"))
  .join("\n");

describe("update-watch.sh 的旧镜像清理", () => {
  it("定义了 prune_old_image，且在启动新容器之后才调用", () => {
    expect(script).toContain("prune_old_image() {");
    const upIdx = script.indexOf("up --no-build -d");
    const pruneIdx = script.indexOf('prune_old_image "${OLD_IMAGE:-}"');
    expect(upIdx).toBeGreaterThan(-1);
    expect(pruneIdx).toBeGreaterThan(-1);
    // 顺序不能反：容器还在用旧镜像时删不掉（docker rmi 会失败）
    expect(pruneIdx).toBeGreaterThan(upIdx);
  });

  it("旧镜像引用在重建容器之前采集（compose up 之后就查不到旧引用了）", () => {
    const captureIdx = script.indexOf('OLD_IMAGE="$(docker inspect');
    const stopIdx = script.indexOf('docker compose --env-file "$ENV_FILE" stop');
    expect(captureIdx).toBeGreaterThan(-1);
    expect(stopIdx).toBeGreaterThan(captureIdx);
  });

  it("只删上一个版本的那一个镜像，绝不使用 prune -a", () => {
    expect(code).toContain('docker rmi "$1"');
    // prune -a 会连同一台机器上其它容器的镜像一起删掉，且不报错 —— 一票否决
    expect(code).not.toMatch(/docker\s+image\s+prune[^\n]*-a/);
    // 只清无标签悬空层是安全的，保留
    expect(code).toContain("docker image prune -f");
  });

  it("清理失败不会把一次成功的更新变成失败，并保留开关与结果回执", () => {
    // 删不掉时只记日志：docker rmi 放在 if 条件里，失败不会触发 set -e 中止脚本
    expect(script).toMatch(/if docker rmi "\$1" >\/dev\/null 2>&1; then/);
    // 开关：不想要这个行为时可以关掉
    expect(script).toContain("PRUNE_OLD_IMAGES");
    // 清理结果要写回后台，否则用户不知道到底省没省下空间
    expect(script).toContain("${PRUNED_NOTE:-}");
  });
});
