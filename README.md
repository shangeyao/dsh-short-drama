# dsh-short-drama · 短剧工坊

**左侧栏只管配置，真正的活由会话里的 Agent 工具在**你当前的工作区**里干完。**

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

安装后在「设置 → 插件」确认 `dsh-short-drama` 已启用，左侧栏即出现「短剧工坊·配置」图标。

---

## 职责划分

这个插件刻意拆成两半，不要混用：

| 面 | 负责 | 不负责 |
|---|---|---|
| **左侧栏面板** | 改配置：Gemini 模型 / Key 来源、两个 CLI 命令、默认比例时长、下载目录、分镜规则；读写 profile 的 `cordis.patch.yml` | 不发起任何生成 |
| **Agent 工具** | 生成分镜词、扫素材、提交视频、查进度、下载、取消 | 不改配置 |

这样做的原因：生成要落在**当前会话的工作区**里。面板是全局的，它不知道你此刻在哪个项目；而工具拿到 `exec.agent`，能精确解析出该会话的工作目录。

---

## 工具清单

在会话里直接让我调用，路径全部相对于当前工作目录，且被限制在工作区内（越界会被拒绝）：

| 工具 | 作用 |
|---|---|
| `storyboard_write` | 按分镜规则把剧本转成分镜词，写入工作区的 Markdown 文件（默认 `storyboard.md`） |
| `short_drama_assets` | 列出工作区里可用的人像图 / 音色 / 参考视频，可按类型过滤 |
| `video_submit` | 用小云雀或 Dreamina 的 CLI 提交视频任务，立即返回任务 id；后台继续跑 |
| `video_status` | 查一个任务或列出最近任务 |
| `video_download` | 把已完成的视频复制到工作区内指定目录 |
| `video_cancel` | 取消排队中或运行中的任务 |

典型对话：

```text
把这段剧本写成分镜词，存成 ep01.md
→ storyboard_write(script=..., output="ep01.md")

工作区里有哪些人像素材？
→ short_drama_assets(type="image")

用分镜词出片，9:16，5 秒
→ video_submit(prompt=..., ratio="9:16", seconds=5)

出好了吗？好了就下载到 out/
→ video_status() → video_download(id=..., targetDir="out")
```

---

## 配置项

左侧栏可改，也可直接编辑 profile 的 `cordis.patch.yml`：

| 字段 | 说明 | 默认 |
|---|---|---|
| `geminiProvider` / `geminiModel` | 供应商与模型名 | `google` / `gemini-2.5-pro` |
| `geminiApiKeyEnv` | Key 的环境变量 / 凭据名 | `GEMINI_API_KEY` |
| `geminiBaseURL` | Gemini API 基址 | `https://generativelanguage.googleapis.com/v1beta` |
| `xiaoyunqueCommand` / `dreaminaCommand` | 两个 CLI 命令名或绝对路径 | `xiaoyunque` / `dreamina` |
| `defaultRatio` / `defaultDuration` | 提交默认比例与时长 | `9:16` / `5` |
| `downloadFolder` | 默认输出目录 | `generated-videos` |
| `assetExtensions` | 素材扫描扩展名 | 图片 / 视频 / 音频常见格式 |
| `storyboardPreset` | 分镜规则（即系统提示词） | 内置中文分镜规范 |

配置改完点「保存配置」，会写回 profile；**重启插件后生效**。

任务历史落在 `<DSH home>/short-drama/history.json`，重启后仍在；重启时仍在「生成中」的任务会被标记为失败（进程已不存在），不会无限轮询。

---

## 架构

| 文件 | 职责 |
|---|---|
| `index.js` | 宿主半端：注册 6 个 Agent 工具；挂 `/short-drama/api` 只提供配置读写；负责 Gemini 调用、CLI 执行、素材扫描、下载与历史存储 |
| `client.js` | 浏览器半端：注册 `sidebar.panellist` 图标与 `main` 面板，**只做配置表单**；单文件内联样式与中英词典 |
| `cordis.patch.yml` | 插件注册行与默认配置 |
| `locale/` | 插件管理页展示用标题与描述 |
| `icon.svg` | 侧边栏图标（齿轮，表明这是配置入口） |

两条设计约束：

- **操作归会话。** 每个工具都用 `ctx.workingDirectory.ensure(exec.agent)` 取当前会话目录，再用 `insideRoot()` 拒绝越界路径。所以素材、产物、下载都留在你正在做的项目里。
- **浏览器不碰密钥。** Key 只在 `index.js` 里读取并直接发给 Gemini，面板拿到的只有「是否已配置」和来源。

---

## 本地开发

```bash
npm run check   # node --check index.js && node --check client.js
```

改完 `index.js` / `client.js` 后，在「设置 → 插件」里关掉再开启 `dsh-short-drama`，让宿主重新加载模块；面板侧需要刷新页面。

---

## License

MIT
