# FONT_LICENSES — 字体授权清单

本项目全部字体均已 **本地自托管**（`/public/fonts`），不依赖任何外部 CDN / Google Fonts 运行时下载。
以下列出仓库内**实际包含**的字体及其授权信息，供合规使用参考。

> 说明：授权类型以各上游仓库发布的最终 LICENSE 为准。本站多数字体遵循 **SIL Open Font License 1.1**（可自由商用、不可单独转售字库、需附带版权声明）。本项目仅在这些授权允许的范围内内嵌/自托管使用。
>
> 字体授权与代码授权相互独立：代码本体按 [LICENSE](LICENSE)（AGPL-3.0）授权，字体不随该协议变化。

---

## 一、正文字体与西文兜底（`public/fonts/google-local/`）

| 文件 | 字体 | 用途 | 字形数 | 授权 | 来源 |
| --- | --- | --- | --- | --- | --- |
| font-noto-sc.woff2 | Noto Sans SC（思源黑体） | 全站中文正文 | 3811 | SIL OFL 1.1 | Google Fonts |
| font-inter.woff2 | Inter | 西文兜底 | 230 | SIL OFL 1.1 | Google Fonts |
| font-tech-mono.woff2 | Share Tech Mono | 数字时钟 / 等宽 | 216 | SIL OFL 1.1 | Google Fonts |

## 二、昵称艺术字（`public/fonts/nowar-rounded/`）

| 文件 | 字体 | 用途 | 字形数 | 授权 | 来源 |
| --- | --- | --- | --- | --- | --- |
| NowarRounded-Regular.woff2 | 有爱圆体（Nowar Rounded） | 昵称艺术字（中文） | 3811 | 开源可商用，详见上游 LICENSE.txt | https://gitee.com/nowar-fonts/Nowar-Rounded |
| Baloo2-Variable.woff2 | Baloo 2 | 昵称艺术字（西文） | 230 | SIL OFL 1.1 | Google Fonts |

> 昵称艺术字仅注册 Regular(400) 字重。`.font-art-nowar` 应用于首页昵称 `h1`，而 Tailwind preflight 会把 `h1`~`h6` 重置为 `font-weight: inherit`，全站又没有祖先元素设置粗体，计算字重恒为 400，因此仓库不再携带 700 字重文件（该文件从未被浏览器请求）。

---

## 使用提示

- 仓库内字体均已 **子集化**（CJK 保留 3811 个常用字形，西文保留 95 个可见字符）并保留授权头信息，字形数可用 `fontTools` 复核。
- 后台「自定义字体」填写的是访问者本机已安装的 CSS `font-family` 名称，**不下发任何字体文件，不涉及第三方授权**。
- 若后续对某字体做二次分发、商用或安装，请以对应上游 LICENSE 原文与署名要求为准。
