#!/usr/bin/env python3
"""
生成 RELEASE_NOTES.md（供 GitHub Actions 发布时使用）。

逻辑：
- 读取 .github/scripts/release-notes-template.md（含 {{占位符}}）
- 用环境变量 / git 信息填充占位符并写出 RELEASE_NOTES.md
- 变更列表取「上一版本 tag 到 HEAD」的提交（最多列 MAX_CHANGES 条）

注意：发布说明刻意保持精简（标题 + 变更 + 升级提示 + 对比链接）。
部署步骤、环境变量、回滚方案等长文档统一放在 README / docs，不在这里重复，避免每次发版都刷一屏。
"""
import datetime
import os
import pathlib
import re
import subprocess

ROOT = pathlib.Path(os.environ.get("GITHUB_WORKSPACE", "."))
VERSION = os.environ["VERSION"]
# 中国时区（Asia/Shanghai）发布时间：如 "2026-09-05 15:30"；缺省降级为构建机 UTC 日期
CN_TIME = os.environ.get("CN_TIME", "")
DATE = CN_TIME or datetime.date.today().strftime("%Y-%m-%d")
# Git tag 不使用冒号（Windows 下载兼容）；语义化 tag 天然无冒号，此处与 VERSION 一致
TAG = os.environ.get("TAG", VERSION)
REPO = os.environ.get("REPO", "sxlb/qiyun")
# 变更列表最多列出的条数，超出部分合并为一行
MAX_CHANGES = 10

# 提交类型 → 中文分组；未匹配的类型统一归入「其他」，并去掉类型前缀只留描述。
# 分组顺序即发布说明中的展示顺序，无内容的分组自动省略。
GROUP_LABELS = (("feat", "新增"), ("fix", "修复"))
OTHER_GROUP = "其他"
GROUP_ORDER = ("新增", "修复", OTHER_GROUP)
_COMMIT_RE = re.compile(r"^([a-zA-Z]+)(?:\([^)]*\))?!?:\s*(.+)$")

# 超过 MAX_CHANGES 时的占位说明（追加到「其他」分组）
TRUNCATED_HINT = "…另有 {n} 条提交"


def normalize(tag: str) -> str:
    """去掉可选的 v 前缀，便于跨写法比较（v0.0.3 与 0.0.3 视为同一版本）"""
    return re.sub(r"^v", "", tag)


def group_subject(subject: str):
    """把 conventional commit 标题拆成 (中英分组, 描述)；非规范标题原样归入「其他」"""
    m = _COMMIT_RE.match(subject)
    if not m:
        return OTHER_GROUP, subject
    kind, desc = m.group(1).lower(), m.group(2)
    for key, label in GROUP_LABELS:
        if kind == key:
            return label, desc
    return OTHER_GROUP, desc


def semver_key(tag: str):
    parts = normalize(tag).split(".")
    return tuple(int(p) for p in parts[:3])


def git(*args: str) -> str:
    return subprocess.run(
        ["git", *args], capture_output=True, text=True, check=False
    ).stdout.strip()


def main() -> None:
    all_tags = [t for t in git("tag", "-l").splitlines() if t]
    semver_tags = [t for t in all_tags if re.match(r"^v?\d+\.\d+\.\d+$", t)]

    # 上一版本候选：必须剔除「本次发布版本」自身。
    # 触发用的 tag（v0.0.3）与发布 tag（0.0.3）都会出现在 tag 列表中，
    # 若不剔除会得到空的 "v0.0.3..HEAD" 区间，变更列表退化成「首次发布」。
    candidates = [t for t in semver_tags if normalize(t) != normalize(TAG)]
    prev = max(candidates, key=semver_key) if candidates else ""

    log_range = f"{prev}..HEAD" if prev else "HEAD"
    # 多取一条用于判断是否被截断
    log = git("log", "--oneline", "--no-merges", f"-{MAX_CHANGES + 1}", log_range)
    subjects = [line.split(maxsplit=1)[-1] for line in log.splitlines() if line.strip()]

    if not subjects:
        changes = "### 变更\n- 首次发布"
    else:
        buckets: dict[str, list[str]] = {g: [] for g in GROUP_ORDER}
        for subject in subjects[:MAX_CHANGES]:
            group, desc = group_subject(subject)
            buckets[group].append(desc)
        extra = len(subjects) - MAX_CHANGES
        if extra > 0:
            buckets[OTHER_GROUP].append(TRUNCATED_HINT.format(n=extra))
        changes = "\n\n".join(
            f"### {group}\n" + "\n".join(f"- {desc}" for desc in buckets[group])
            for group in GROUP_ORDER
            if buckets[group]
        )

    if prev:
        link = f"https://github.com/{REPO}/compare/{prev}...{TAG}"
    else:
        link = f"https://github.com/{REPO}/commits/{TAG}"

    template = (ROOT / ".github/scripts/release-notes-template.md").read_text(encoding="utf-8")
    notes = (
        template.replace("{{VERSION}}", VERSION)
        .replace("{{TAG}}", TAG)
        .replace("{{DATE}}", DATE)
        .replace("{{CHANGES}}", changes)
        .replace("{{COMPARE_LINK}}", link)
    )
    (ROOT / "RELEASE_NOTES.md").write_text(notes, encoding="utf-8")
    print(f"Generated RELEASE_NOTES.md for {VERSION} (prev tag: {prev or 'none'})")


if __name__ == "__main__":
    main()
