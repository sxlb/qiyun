# FONT_LICENSES — 字体授权清单

本项目全部字体均已 **本地自托管**（`/public/fonts`），不依赖任何外部 CDN / Google Fonts 运行时下载。
以下列出项目引入的字体及其授权信息，供合规使用参考。

> 说明：授权类型以各上游仓库发布的最终 LICENSE 为准。本站多数字体遵循 **SIL Open Font License 1.1**（可自由商用、不可单独转售字库、需附带版权声明）。本项目仅在这些授权允许的范围内内嵌/自托管使用。

---

## 一、本次本地化的 Google 字体（`public/fonts/google-local/`）

| 文件 | 字体 | 样式 | 授权 | 来源 |
| --- | --- | --- | --- | --- |
| font-noto-sc.woff2 | Noto Sans SC（思源黑体） | 全站中文正文 | SIL OFL 1.1 | Google Fonts |
| font-inter.woff2 | Inter | 西文兜底 | SIL OFL 1.1 | Google Fonts |
| font-tech-mono.woff2 | Share Tech Mono | 数字时钟 / 等宽 | SIL OFL 1.1 | Google Fonts |
| font-ma-shan.woff2 | Ma Shan Zheng（马善政毛笔楷书） | 昵称艺术字 | SIL OFL 1.1 | Google Fonts |
| font-zcool.woff2 | ZCOOL KuaiLe（站酷快乐体） | 昵称艺术字 | SIL OFL 1.1 | Google Fonts |
| font-long-cang.woff2 | Long Cang（龙藏手写体） | 昵称艺术字 | SIL OFL 1.1 | Google Fonts |
| font-zcool-xw.woff2 | ZCOOL XiaoWei（站酷小薇） | 昵称艺术字 | SIL OFL 1.1 | Google Fonts |
| font-zcool-qk.woff2 | ZCOOL QingKe HuangYou（站酷庆科黄油） | 昵称艺术字 | SIL OFL 1.1 | Google Fonts |
| font-liu-jian.woff2 | Liu Jian Mao Cao（柳建毛草） | 昵称艺术字 | SIL OFL 1.1 | Google Fonts |
| font-zhi-mang.woff2 | Zhi Mang Xing（智莽星行草） | 昵称艺术字 | SIL OFL 1.1 | Google Fonts |
| font-noto-serif-sc.woff2 | Noto Serif SC（思源宋体） | 昵称艺术字 | SIL OFL 1.1 | Google Fonts |

> 注：上述字体取自 Google Fonts 并已做 **子集化**（仅保留中英文常用字符）以减小体积，仍保留授权头信息。

---

## 二、有爱圆体 + Baloo 2（`public/fonts/nowar-rounded/`）

| 文件 | 字体 | 样式 | 授权 | 来源 |
| --- | --- | --- | --- | --- |
| NowarRounded-Regular.woff2 / NowarRounded-Bold.woff2 | 有爱圆体（Nowar Rounded） | 昵称艺术字（中文） | 开源、可免费商用，详见上游 LICENSE.txt | https://gitee.com/nowar-fonts/Nowar-Rounded |
| Baloo2-Variable.woff2 | Baloo 2 | 昵称艺术字（西文） | SIL OFL 1.1 | Google Fonts |

---

## 三、其他本地 / 分片字体（`public/fonts/` 其余目录）

以下字体经由 `@font-face`（`app/globals.css`）或 `ArtFontsLoader` 分片加载，均随仓库一并托管：

| 字体 | 样式 | 授权 | 说明 |
| --- | --- | --- | --- |
| 得意黑（Smiley Sans） | 昵称艺术字 | 开源可商用 | 本地完整字库 `font-smiley-sans` |
| 猫啃什锦黑（Maoken Sans） | 昵称艺术字 | 开源可商用 | 本地完整字库 `font-maoken-sans` |
| 悠哉字体（Yozai Medium） | 昵称艺术字 | 开源可商用 | 项目 `cn-fontsource-yozai-medium` 分片 |
| 霞鹜文楷（LXGW WenKai） | 昵称艺术字 | SIL OFL 1.1 | 分片 |
| 阿里妈妈东方大楷 | 昵称艺术字 | 阿里开源 | 分片 |
| 钉钉进步体 | 昵称艺术字 | 阿里开源 | 分片 |
| 鸿雷行书 | 昵称艺术字 | 开源可商用 | 分片 |
| 小赖手写体（Xiaolai SC） | 昵称艺术字 | 开源可商用 | 分片 |
| 演示春风楷（Slidefu） | 昵称艺术字 | 开源可商用 | 分片 |
| 演示秋鸿（Slideqiuhong） | 昵称艺术字 | 开源可商用 | 分片 |

---

## 使用提示

- 本仓库自托管字体均已随项目源码/镜像一并分发，**部署构建不再访问 Google Fonts**，无网络依赖，离线可构建。
- 若后续对某字体做二次分发、商用或安装，请以对应上游 LICENSE 原文与署名要求为准。