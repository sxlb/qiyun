#!/usr/bin/env python3
"""
生成 RELEASE_NOTES.md（供 GitHub Actions 发布时使用）。

逻辑：
- 读取 .github/scripts/release-notes-template.md（含 {{占位符}}）
- 用环境变量 / git 信息填充占位符并写出 RELEASE_NOTES.md
- 变更列表取"上一版本 tag 到 HEAD"的提交（无 tag 时取最近 20 条）
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


def semver_key(tag: str):
    parts = re.sub(r"^v", "", tag).split(".")
    return tuple(int(p) for p in parts[:3])


def git(*args: str) -> str:
    return subprocess.run(
        ["git", *args], capture_output=True, text=True, check=False
    ).stdout.strip()


def main() -> None:
    # 上一版本 tag：从已有标签中取最大的语义化版本（0.0.1 / v0.0.1）
    all_tags = [t for t in git("tag", "-l").splitlines() if t]
    semver_tags = [t for t in all_tags if re.match(r"^v?\d+\.\d+\.\d+$", t)]
    prev = max(semver_tags, key=semver_key) if semver_tags else ""

    # 变更列表（去掉 commit hash，保留提交信息；无历史时兜底）
    log_range = f"{prev}..HEAD" if prev and prev != TAG else "HEAD"
    log = git("log", "--oneline", "--no-merges", "-20", log_range)
    if log:
        changes = "\n".join(
            f"- {line.split(maxsplit=1)[-1]}" for line in log.splitlines()
        )
    else:
        changes = "- 首次发布"

    # CHANGELOG 对比链接（使用无冒号的 TAG，与 git tag 保持一致）
    if prev and prev != TAG:
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
