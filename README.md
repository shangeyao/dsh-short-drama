# dsh-short-drama · 短剧工坊

**在 DeepSeek Harness 侧边栏里，把剧本变成分镜词，再交给小云雀 / Dreamina 的 CLI 出片。任务跑在宿主进程，关掉页面也不中断。**

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![dsh](https://img.shields.io/badge/dsh-%E2%89%A50.2.1--rc.3-4B6BFB)](https://github.com/deepseek-ai)
[![node](https://img.shields.io/badge/node-%E2%89%A520-339933)](https://nodejs.org)

---

## 安装

**从 GitHub 安装**（跟进最新提交）

```bash
dsh plugin add github:shangeyao/dsh-short-drama
```

> 桌面版请在应用内「设置 → 插件 → 添加插件」里选择本仓库目录；CLI 在应用运行时不会改动桌面版的 profile。

安装后在「设置 → 插件」确认 `dsh-short-drama` 已启用，左侧栏即出现「短剧工坊」图标。

---

## 它解决什么问题

DeepSeek Harness 的模型调用走 `POST /v1/chat/completions`，而短剧工作流需要两件它不管的事：

| 能力 | 由谁负责 |
|---|---|
| 剧本 → 分镜词 | 宿主进程调用 Gemini `generateContent`，按你写的分镜规则出 Markdown 分镜表 |
| 分镜词 → 视频 | 宿主进程调起 `xiaoyunque` / `dreamina` CLI，产出视频文件 |
| 结果落盘 | 宿主进程写进工作区目录，浏览器全程接触不到 API Key |

这些都不在 chat 协议里。本插件由**宿主进程**直接完成，并通过一条前缀路由 `/short-drama/api/...` 给面板提供 JSON 接口。

---

## 界面

左侧栏独立入口，顶部三个页签：

| 页签 | 用途 |
|---|---|
| **分镜词** | 左栏粘贴剧本、编辑分镜规则（规则本身就是提示词，可随时改），右侧显示分镜表结果；下方是工作区资产选择 |
| **视频任务** | 供应商 / 比例 / 时长 / 模型 / 提示词 / 下载目录，提交后在右侧任务历史里看进度、下载、取消、删除 |
| **设置** | 只读展示当前生效的模型、CLI 命令、默认值与分镜规则 |

顶部徽标显示 Gemini Key 是否就绪（`Key 已就绪` / `Key 未配置`）与当前模型名，`重新检测` 立即刷新。

---

## 使用流程

1. **配置 Key**：在「设置 → 模型」里配置 google / Gemini 供应商，或在宿主环境里设置 `GEMINI_API_KEY`（也可写进 DSH 凭据）。顶部徽标变绿即就绪。
2. **写规则**：默认规则在 `cordis.patch.yml` 的 `storyboardPreset` 里，也可以在「分镜词」页签直接编辑——面板提交时会带上你当前编辑的版本。
3. **生成分镜词**：粘贴剧本 → 生成分镜词。结果会自动带入「视频任务」的提示词框（若提示词框为空）。
4. **挑资产**：在「分镜词」页签下方勾选工作区里的人物图、音色、参考视频，会作为 `--asset` 传给 CLI。
5. **出片**：切到「视频任务」，选供应商、比例、时长，提交。任务立刻返回，在宿主后台跑。
6. **下载**：任务完成后点「下载」，文件落到你填的下载目录（相对路径按工作区解析，留空则用 `downloadFolder`）。

---

## 配置项

插件行配置位于 `cordis.patch.yml`：

| 字段 | 说明 | 默认 |
|---|---|---|
| `geminiProvider` / `geminiModel` | 供应商与模型名 | `google` / `gemini-2.5-pro` |
| `geminiApiKeyEnv` | Key 的环境变量 / 凭据名 | `GEMINI_API_KEY` |
| `geminiBaseURL` | Gemini API 基址 | `https://generativelanguage.googleapis.com/v1beta` |
| `xiaoyunqueCommand` / `dreaminaCommand` | 两个 CLI 命令名或绝对路径 | `xiaoyunque` / `dreamina` |
| `defaultRatio` / `defaultDuration` | 提交默认比例与时长 | `9:16` / `5` |
| `downloadFolder` | 默认下载文件夹 | `generated-videos` |
| `assetExtensions` | 扫描哪些扩展名 | 图片 / 视频 / 音频常见格式 |
| `storyboardPreset` | 分镜词规则（即提示词） | 内置中文分镜规范 |

数据落在 `<DSH home>/short-drama/history.json`，重启后历史仍在；重启时仍在「生成中」的任务会被标记为失败（进程已不存在），不会无限轮询。

---

## 架构

| 文件 | 职责 |
|---|---|
| `index.js` | 宿主半端：用 `ctx.webServer.register({ kind: 'prefix' })` 挂 `/short-drama/api`，负责 Gemini 调用、CLI 执行、资产扫描、下载与历史存储 |
| `client.js` | 浏览器半端：注册 `sidebar.panellist` 图标与 `main` 面板；单文件内联样式与中英词典，只用 `fetch` 打自己的前缀路由 |
| `cordis.patch.yml` | 插件注册行与默认配置 |
| `locale/` | 插件管理页展示用标题与描述 |
| `icon.svg` | 侧边栏图标 |

两条设计约束：

- **任务归宿主所有。** 面板只做「提交 + 读历史」，`setInterval` 只轮询历史。所以切页签、刷新、关页面都不会丢任务。
- **浏览器不碰密钥。** Key 只在 `index.js` 里读取并直接发给 Gemini，面板拿到的只有「是否已配置」和来源。

输出目录按「工作区根 + 目标」解析：填相对路径就落在工作区内，填绝对路径就直接用；留空则用 `downloadFolder`。

---

## 本地开发

```bash
npm run check   # node --check index.js && node --check client.js
```

改完 `index.js` / `client.js` 后，在「设置 → 插件」里关掉再开启 `dsh-short-drama`，让宿主重新加载模块；面板侧需要刷新页面。

---

## License

MIT
