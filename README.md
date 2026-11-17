# dsh-short-drama（短剧工坊）

[![GitHub](https://img.shields.io/badge/repo-shangeyao%2Fdsh--short--drama-blue)](https://github.com/shangeyao/dsh-short-drama)

一个 [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) 插件，在左侧栏提供 **短剧工坊** 入口，把短剧剧本 → Gemini 分镜词 → AI 视频生成串成一条工作流。

## 功能

1. **Gemini 分镜词生成** — 粘贴剧本，按可自定义的分镜词规则（预设可在插件配置里编辑）调用 Gemini，输出 Markdown 分镜表格。默认模型 `gemini-2.5-pro`，可通过 DSH 内置 `google` LLM 供应商或 `GEMINI_API_KEY` 凭据调用。
2. **CLI 视频生成** — 根据分镜词，通过 **小云雀 (xiaoyunque)** 或 **Dreamina** 的 CLI 生成视频，可设置比例、时长、模型。
3. **工作区资产关联** — 自动扫描工作区内的人像 / 音色 / 视频资产，勾选后作为 `--asset` 传给 CLI。
4. **任务管理** — 异步提交、轮询状态、取消任务，任务台账持久化（重启后不会残留假的“运行中”状态）。
5. **下载到项目目录** — 成功后把视频下载到工作区的指定文件夹，也支持下载 CLI 返回的远程链接（`downloadUrl`）。

## 安装

在 DSH 的 **Plugins（插件） → Add plugin（添加插件）** 中选择本仓库目录即可安装；也可用插件管理器命令行安装本地目录。

安装后从左侧栏点击 **短剧工坊 / Short Drama Studio** 打开面板。

## 使用前准备

- 在 DSH **设置 → 模型** 中配置 `google` / Gemini 供应商，或设置 `GEMINI_API_KEY`（也可用 `GOOGLE_API_KEY`）凭据 / 环境变量。
- 将 `xiaoyunque`、`dreamina` 两个 CLI 加入 `PATH`；若命令名不同，请在插件 **设置** 标签页修改对应命令（可填绝对路径）。

## 配置

插件行配置位于 `cordis.patch.yml`，主要字段：

| 字段 | 说明 | 默认 |
|---|---|---|
| `geminiProvider` / `geminiModel` | LLM 供应商与 Gemini 模型 | `google` / `gemini-2.5-pro` |
| `geminiApiKeyRef` | API Key 凭据名 | `GEMINI_API_KEY` |
| `storyboardPreset` | 分镜词规则（可自定义） | 内置中文规则 |
| `xiaoyunqueCommand` / `dreaminaCommand` | 两个 CLI 命令 | `xiaoyunque` / `dreamina` |
| `defaultRatio` / `defaultDuration` | 默认视频比例与时长 | `9:16` / `5` |
| `downloadFolder` | 默认下载文件夹 | `generated-videos` |

也可在面板的 **设置** 标签页里修改并保存（写回 profile 配置）。

## 架构

- `index.js` — Host 半端：Typert Remote 服务 `shortDrama`，暴露 `config`、`saveConfig`、`listAssets`、`generateStoryboard`、`submitVideo`、`jobStatus`、`listJobs`、`cancelJob`、`downloadJob`、`downloadUrl`。Gemini 走 `ctx.llm.stream`，CLI 走 `ctx.subprocess`，下载走全局 `fetch` + `node:fs`。
- `client.js` — 浏览器半端：注册 `main` 面板与 `sidebar.panellist` 左侧栏图标；三个标签页：分镜词 / 视频任务 / 设置。通过 `ctx.remote.shortDrama.*` 调用 Host。
- `cordis.patch.yml` — 插件注册行与默认配置。
- `locale/`、`icon.svg`、`docs/` — 展示元数据、图标与功能预览。

Remote 方法使用源码级 `@Remote` 标记（由 `Remote()` 以标准方法装饰器的形式在纯 JS 中手动应用），由 Gateway 的 SRC 发现机制识别，无需额外的 Typert 代码生成步骤。

## License

MIT
