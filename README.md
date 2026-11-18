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
| `storyboard_write` | 把长剧本按规则拆成有序分镜词，按序号写成 `NNN.md`（001.md、002.md…）到分镜文件夹，并生成 `index.json` 清单 |
| `storyboard_list` | 列出已有分镜（序号、文件）以及每个序号对应的成片，只读 |
| `short_drama_assets` | 列出工作区里可用的人像图 / 音色 / 参考视频，可按类型过滤 |
| `video_submit` | 传 `number` 时自动读取对应序号的分镜词作为提示词、成片也按该序号命名（001.mp4…），与分镜一一对应；也可直接传 `prompt`。用小云雀/即梦官方 CLI 真实语法提交，自动轮询下载 |
| `video_status` | 查一个任务或列出最近任务 |
| `video_download` | 把已完成的视频复制到工作区内指定目录 |
| `video_cancel` | 取消排队中或运行中的任务 |

### 按序号贯穿的流水线

长剧本 → 分镜词 → 视频，全程用同一个序号对应：

```text
1) 按规则拆分长剧本
→ storyboard_write(script=长剧本)
   写出 分镜词/001.md、002.md… + index.json，返回每个镜头的序号和文件

2) 看看拆成了哪些镜头
→ storyboard_list()
   001 → 002 → 003 …（以及各自已生成的视频）

3) 按序号出片（自动读取该分镜词，成片命名 001.mp4）
→ video_submit(number=1, ratio="9:16", seconds=5)
→ video_submit(number=2, ...)

4) 出好了吗？
→ video_status()   （每项带 #序号，成片名也是该序号）
```

分镜文件夹可在左侧栏「分镜词文件夹」配置（默认 `storyboards`），全部落在当前会话工作区内。

典型对话：

```text
把这段剧本按我的规则拆成有序分镜，存进「分镜词」文件夹
→ storyboard_write(script=..., folder="分镜词")

给第 3 个镜头出片
→ video_submit(number=3)

列出所有分镜和对应视频
→ storyboard_list()
```

---

## 配置项

左侧栏可改，也可直接编辑 profile 的 `cordis.patch.yml`：

| 字段 | 说明 | 默认 |
|---|---|---|
| `geminiModel` | 模型（面板**下拉选择**，由 Gemini API 自动获取） | `gemini-2.5-pro` |
| `geminiApiKeyEnv` | Key 的候选凭据名之一（**会自动探测多个**，通常不用改） | `GEMINI_API_KEY` |
| `geminiBaseURL` | Gemini API 基址（兼容代理时可改） | `https://generativelanguage.googleapis.com/v1beta` |
| `xiaoyunqueCommand` / `dreaminaCommand` | CLI 兜底命令名（**路径自动探测，通常不用填**） | `pippit-tool-cli` / `dreamina` |
| `xiaoyunqueModel` | 小云雀模型（面板**下拉选择**，由 `model list` 自动获取） | 空（自动选第一个） |
| `dreaminaModelVersion` | 即梦模型（面板**下拉选择**，由 `text2video -h` 自动获取） | `seedance2.0mini` |
| `xiaoyunqueResolution` / `dreaminaResolution` | 分辨率（下拉/可填） | `720p` / `720p` |
| `defaultRatio` / `defaultDuration` | 提交默认比例与时长 | `9:16` / `5` |
| `storyboardFolder` | 分镜词文件夹（按序号写 `NNN.md` + `index.json`） | `storyboards` |
| `downloadFolder` | 默认输出目录 | `generated-videos` |
| `assetExtensions` | 素材扫描扩展名 | 图片 / 视频 / 音频常见格式 |
| `storyboardPreset` | 分镜规则（即系统提示词） | 内置中文分镜规范 |

配置改完点「保存配置」，会写回 profile；**重启插件后生效**。

---

## Gemini 连接也是自动的

面板打开时插件会按 `geminiApiKeyEnv`、`GEMINI_API_KEY`、`GOOGLE_API_KEY`、`GOOGLE_GENERATIVE_AI_API_KEY` 等候选引用，自动在 DSH 凭据库和环境变量里找已存过的 Key（包括你在「设置 → 模型 → google」配过的），找到即显示「已连接」并标出来源。模型列表直接调 Gemini `models` 接口拉取，下拉选择，不用手填模型名。

如果本机确实没有 Key，面板里粘贴一次即可——插件通过 `ctx.credentials.set()` 把 Key 存进 DSH 凭据库（`<DSH_HOME>/.credentials.yaml`，写保护、**不进 cordis.patch.yml**），之后所有会话自动复用，无需重复输入。

> 密钥始终只留在宿主进程，浏览器面板只看到「是否已连接 + 来源」，拿不到明文。

---

## 出片 CLI 的安装与真实用法

插件直接调用两家**官方 CLI**，参数按各自真实语法生成，不是臆测的 `generate --output`。

**模型不用手填。** 面板打开时插件会自动探测两个 CLI 装在哪（PATH、`~/.local/bin`、npm 全局目录），再直接问它们当前有哪些模型——小云雀跑 `pippit-tool-cli model list`，即梦读 `dreamina text2video -h` 里的 `model_version:` 行——列成下拉框给你选。若没装 CLI，会显示一份内置模型清单兜底。

**登录状态也能看。** 检测时插件会顺带查登录态：小云雀跑 `pippit-tool-cli status`（`logged_in` / `source` / `expires_at`），即梦跑 `dreamina user_credit`（`user_name` / `vip_level` / `total_credit` / `has_cli_permission`）。面板上每个 CLI 都有「已登录 / 未登录」徽章，即梦还会显示是否高级会员。

**CLI 可以在配置面板里直接更新。** 每个 CLI 卡片下方的「更新 CLI」按钮：

- 小云雀 → 跑官方自更新 `pippit-tool-cli update`（内部 `npm install -g @pippit-dev/cli@latest`）
- 即梦 → 官方**没有** `update` 子命令，正确做法是重跑安装脚本；插件会找到 Git Bash 并执行 `curl -fsSL https://jimeng.jianying.com/cli | bash` 覆盖安装

更新完插件自动重新探测、刷新模型列表。改完 CLI 或重装后也可以点顶部的「重新检测」。

### 即梦走「全能参考」模式，素材自动带入

即梦出片默认用它的旗舰**全能参考**模式（`dreamina multimodal2video`，旧名 ref2video），而不是纯文生视频。提交时插件会**自动扫描当前工作区**的素材，按扩展名分门别类带进去：

- 图片（png/jpg/jpeg/webp/gif）→ 可重复的 `--image`
- 视频（mp4/mov/webm/mkv/avi）→ 可重复的 `--video`
- 音频（mp3/wav/m4a/aac/flac）→ 可重复的 `--audio`

数量按模型版本自动限（来自官方校验器，避免超限报错）：

| 模型 | 图片 | 视频 | 音频 | 合计 |
|---|---|---|---|---|
| seedance2.5 | 30 | 10 | 10 | 50（可纯音频） |
| seedance2.0 系列 | 9 | 3 | 3 | 12（至少一张图或一个视频） |

已生成的输出目录会被排除，成片不会回流成下一次的参考素材。提交命令形如：

```bash
dreamina multimodal2video --image a.png --image b.png --audio voice.mp3 \
  --prompt "..." --model_version seedance2.0mini --video_resolution 720p \
  --duration 5 --poll=0
```

没有可用素材时才退回 `text2video`。每次任务在 `video_status` 里会显示带了多少素材（图/视/音）。

### 小云雀也自动带素材

小云雀同样会**自动扫描当前工作区**素材，按扩展名带入 `generate-video` 的可重复 `--image` / `--video` / `--audio`。官方 CLI 没有明确的素材数量上限，插件采用保守策略（图 ≤9、视 ≤3、音 ≤3、合计 ≤12），避免服务端超载。输出目录同样被排除，已生成成片不会回流成参考素材。已生成的 `video_status` 计数字段对小云雀任务一样有效。

### 小云雀（Pippit，`pippit-tool-cli`）

```bash
npm install -g @pippit-dev/cli      # 提供二进制 pippit-tool-cli
pippit-tool-cli login               # 浏览器授权；CI 可改用环境变量 XYQ_ACCESS_KEY
pippit-tool-cli model list          # 查 --model 要用的模型 key
```

提交与下载（插件内部自动执行）：

```bash
pippit-tool-cli generate-video --prompt "..." --model Seedance_2.0_mini_lite \
  --ratio 9:16 --duration 5 --resolution 720p [--image 人像.png] [--audio 配音.mp3]
# -> JSON { thread_id, run_id }
pippit-tool-cli query-result --thread-id T --run-id R --download-dir out/
```

### 即梦（dreamina）

```bash
curl -fsSL https://jimeng.jianying.com/cli | bash   # 安装 dreamina
export PATH="$HOME/.local/bin:$PATH"
dreamina login --headless                            # OAuth 设备码登录
dreamina user_credit                                 # 查登录态与会员等级
```

提交与查询（插件内部自动执行）：

```bash
dreamina text2video --prompt "..." --model_version seedance2.0mini \
  --ratio 9:16 --video_resolution 720p --duration 5 --poll=0
# -> JSON { submit_id }
dreamina query_result --submit_id=ID --download_dir=out/
```

> 注意：即梦官方 CLI 出片**仅限高级会员**；普通网页登录能生成不等于有 CLI 权限。模型 `model_version` 由 `dreamina text2video -h` 里的 `model_version:` 行列出。

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
