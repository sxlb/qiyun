# 栖云 · Qiyun — 发布流程

> **适用对象**：维护本仓库的开发者
>
> **发布方式**：推送语义化版本标签，由 GitHub Actions 自动完成构建与发布
>
> **工作流**：`.github/workflows/release.yml`

---

## 版本号规则

版本号**不带 `v` 前缀**，形如 `0.0.1`；工作流只接受 `[0-9]+.[0-9]+.[0-9]+` 形式的标签推送。

之所以不接受 `v` 前缀：发布动作本身会以同名创建标签，如果 `v*` 也能触发，一次发布会同时留下 `v0.0.1` 与 `0.0.1` 两个标签，而在线更新链路只认无 `v` 写法，两边容易对不上。

## 发布步骤

```bash
# 1. 同步版本号：package.json、package-lock.json（根与 packages[""] 两处）、
#    README 徽章、教程与本文档里的示例版本号，以及 CHANGELOG 新增条目
# 2. 提交并推送：git add -u && git commit -m 'chore: 发版 0.0.3' && git push
# 3. 确认工作区干净、与远端同步
git status --short

# 4. 打标签并推送（版本号与 package.json 保持一致，工作流会再次同步）
git tag 0.0.3
git push origin 0.0.3
```

推送后工作流分五个任务执行：

| 任务 | 运行环境 | 内容 |
|------|---------|------|
| test | ubuntu-latest | 安装依赖、数据库迁移、ESLint、类型检查、全部单测 |
| prepare | ubuntu-latest | 计算版本号并输出给下游（避免各 job 各算一次算出不同的值） |
| package | ubuntu-latest | 构建应用、打包两个 tar 包、校验发布包、生成 Release Notes |
| image | 矩阵：ubuntu-latest + ubuntu-24.04-arm | 两个架构各自**原生**构建，按 digest 推送 |
| publish | ubuntu-latest | 合成多架构清单、校验清单含两个架构、创建 Release |

`package` 与 `image` 并行，任一环节失败都不会产出发布，失败原因在 Actions 的运行日志里。

### 为什么 arm64 要单独跑一台机器

Dockerfile 是在镜像内跑 `npm ci` + `next build` 的完整构建，产物里含平台相关的二进制（Prisma 查询引擎、`@next/swc`）。**跨架构复用产物会构建成功、运行时报错**，比单架构更糟。用 QEMU 在 amd64 上模拟 arm64 虽然只需要两行配置，但整条 Node 构建链路在模拟下通常要几十分钟且容易 OOM。GitHub 对公开仓库免费提供 arm64 原生 runner（`ubuntu-24.04-arm`），因此按架构分两台机器、各自原生构建，再用 `publish` 合成清单。仓库若转为私有，这部分会开始计费。

### 先干跑再正式发版

改动构建链路后，用手动派发的干跑模式验证两个架构都能编译通过，再打标签：

```bash
# 只构建不发布：两个架构各编译一次，不推镜像、不建 Release
gh workflow run release.yml -f dry_run=true
```

没装 `gh` 时直接用 REST：

```bash
curl -X POST \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/sxlb/qiyun/actions/workflows/release.yml/dispatches \
  -d '{"ref":"master","inputs":{"dry_run":"true"}}'
```

干跑会跳过 `publish`，因此镜像仓库里不会留下任何标签与无标签残留。

> 干跑**不覆盖** `publish` 的合成逻辑（构建用缓存导出、digest 也不上传）。合成阶段有两个实测踩过的坑，已在代码里写成注释防止回退：digest 文件名是去掉 `sha256:` 前缀的裸十六进制串，按 `sha256:*` 匹配会一个都取不到；多仓库必须写成「单个 `name` 字段 + 引号包裹 + 逗号分隔」，重复写 `name=` 不会报错但只有最后一个仓库生效。

## 发布产物

| 产物 | 说明 |
|------|------|
| `ghcr.io/sxlb/qiyun:<版本>` | 预编译镜像，多架构（linux/amd64 + linux/arm64），服务器从此拉取 |
| `docker.io/sxlb/qiyun:<版本>` | 同上，Docker Hub 镜像，仅在配置了对应密钥时推送 |
| `qiyun-<版本>.tar.gz` | 部署包，含 `deploy.sh` 与镜像部署所需文件 |
| `qiyun-src-<版本>.tar.gz` | 源码包，供不使用 Docker 的部署方式 |

只推版本标签，**不推 `latest`**。`latest` 是浮动标签，回滚时容易把「回退旧版」误做成「拉到最新版」。

## 两条硬约束

### 版本不可覆盖

推送镜像前，工作流会检查该版本的镜像是否已存在，存在即中止。

原因是覆盖同一个标签会把上一次的 OCI index 及其子清单变成无标签残留，既污染包的版本列表，也让「当前跑的是哪份构建」变得不可追溯。需要修已发布版本时，递增版本号即可。

### 发布包必须包含部署文件

发布链路上有两道校验，第一道检查打包前的目录树，第二道检查成品 `.tar.gz`，缺任一文件即中止发布：

| 文件 | 作用 |
|------|------|
| `server.js` | 应用启动入口 |
| `deploy.sh` | 一键部署脚本 |
| `docker-compose.yml` | 容器编排定义 |
| `.env.deploy.example` | `deploy.sh` 据此生成 `.env.deploy` |

同时校验包内除 `*.example` 模板外不含任何 `.env` 类文件，避免密钥随包外泄。这两条都来自实际踩过的坑：曾因清理规则里的 `.env.*` 通配符连模板一起删掉，导致一键部署在第一步就报 `cp: cannot stat`。

## 确需原地重发

只在极少数情况使用（例如首发即坏、下载量为零）。顺序不能颠倒，否则会在仓库里留下孤儿对象：

1. 删除 Release。删标签会把 Release 转成草稿而不会删除，所以草稿也要一并删掉。
2. 删除远端标签：`git push origin --delete <版本>`。
3. 删除本地同名标签：`git tag -d <版本>`。
4. 删除镜像版本：在 GHCR 的 package `Versions` 页面删掉带该版本标签的那一条。这一步是必需的，否则第 5 步会被防覆盖校验拦下。
5. 重新打标签并推送。

## 无标签镜像清单

每次构建会向仓库推送三个清单：OCI index、`linux/amd64` 镜像、Buildx 默认附加的 provenance 证明。当标签被覆盖或删除后，失去引用的清单会以 `sha256` 形式留在 `Versions` 列表里。

它们不影响 `docker pull`，留着无害，也可以在页面上逐条删除。想减少这类条目，可在构建步骤加 `provenance: false`，代价是失去镜像来源证明。

## 回滚

后台「系统更新」面板列出的历史版本可一键回滚；命令行等价操作是指定版本重新部署：

```bash
./deploy.sh 0.0.3
```

因为回滚依赖服务器端存在对应 tag，历史标签不要随意删除。
