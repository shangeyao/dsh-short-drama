/**
 * Host half of `dsh-short-drama`（短剧工坊）.
 *
 * Two faces, deliberately separated:
 *
 *   - **Operations are agent tools.** `storyboard_write`, `short_drama_assets`,
 *     `video_submit`, `video_status`, `video_download` run inside the calling
 *     Session and resolve every path against that Session's working directory,
 *     so a script, a scan and a download all stay in the workspace the user is
 *     already in. Nothing is relative to a panel.
 *   - **The sidebar panel only configures.** It reads and saves the plugin
 *     config over one prefix route; it never starts a generation.
 *
 * The API key, the Gemini call and the two CLI invocations all live here, so the
 * browser never holds a secret.
 */

import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

const VERSION = '1.2.0'

/** Prefix route owned by the configuration panel. */
const ROUTE_PREFIX = '/short-drama/api'

const DEFAULTS = {
  geminiProvider: 'google',
  geminiModel: 'gemini-2.5-pro',
  geminiApiKeyEnv: 'GEMINI_API_KEY',
  geminiBaseURL: 'https://generativelanguage.googleapis.com/v1beta',
  // 真实二进制：小云雀是 Pippit 官方 CLI `pippit-tool-cli`（npm @pippit-dev/cli），
  // 即梦是官方 `dreamina` CLI（curl https://jimeng.jianying.com/cli | bash）。
  xiaoyunqueCommand: 'pippit-tool-cli',
  dreaminaCommand: 'dreamina',
  defaultRatio: '9:16',
  defaultDuration: 5,
  // 出片模型由 model list 发现，默认不猜；留空则调用 CLI 的 model list 取第一个。
  xiaoyunqueModel: '',
  dreaminaModelVersion: 'seedance2.0mini',
  xiaoyunqueResolution: '720p',
  dreaminaResolution: '720p',
  downloadFolder: 'generated-videos',
  storyboardPreset: [
    '你是一位资深短剧分镜师。请把用户提供的剧本转换为可直接用于 AI 视频生成的分镜词列表。',
    '要求：',
    '1. 按镜头顺序输出，每个镜头包含：镜头编号、景别、画面描述、台词/旁白、时长(秒)、情绪氛围、所需资产、备注。',
    '2. 画面描述必须具体、可视化，写清主体、动作、运镜、光线与氛围。',
    '3. 单镜头不超过 15 秒，时长总和应与剧本长度匹配。',
    '4. 使用 Markdown 表格输出，表头固定为：镜头 | 景别 | 画面 | 台词 | 时长 | 氛围 | 资产 | 备注。',
    '5. 只输出表格，不要输出任何解释文字。',
  ].join('\n'),
}

const CONFIG_KEYS = [
  'geminiProvider',
  'geminiModel',
  'geminiApiKeyEnv',
  'geminiBaseURL',
  'xiaoyunqueCommand',
  'dreaminaCommand',
  'defaultRatio',
  'defaultDuration',
  'xiaoyunqueModel',
  'dreaminaModelVersion',
  'xiaoyunqueResolution',
  'dreaminaResolution',
  'downloadFolder',
  'storyboardPreset',
  'assetExtensions',
]

const MAX_SCRIPT = 200000
const MAX_PROMPT = 20000
const HISTORY_LIMIT = 100
const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024
const TASK_DEADLINE_MS = 40 * 60 * 1000

const VIDEO_EXT = new Set(['.mp4', '.mov', '.webm', '.mkv', '.avi'])
const AUDIO_EXT = new Set(['.mp3', '.wav', '.m4a', '.aac', '.flac'])
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

/** Tool-facing failure: surfaced to the model as a normal error result. */
class ToolError extends Error {}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/* ------------------------------------------------------------------ helpers */

function sendJson(res, status, value) {
  if (res.headersSent) {
    res.end()
    return
  }
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(value))
}

async function readJson(req, limit = 1024 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new HttpError(413, '请求体过大')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HttpError(400, '请求体不是合法 JSON')
  }
}

function asList(value, fallback) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean)
  if (typeof value === 'string' && value.trim()) {
    return value.split(/[,\s]+/).map((item) => item.trim()).filter(Boolean)
  }
  return fallback
}

function asInt(value, fallback, min, max) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback
}

function assetKind(ext) {
  const lower = ext.toLowerCase()
  if (VIDEO_EXT.has(lower)) return 'video'
  if (AUDIO_EXT.has(lower)) return 'audio'
  if (IMAGE_EXT.has(lower)) return 'image'
  return 'other'
}

/** Keep a resolved path inside `root`; refuse anything that escapes it. */
function insideRoot(root, candidate) {
  const resolvedRoot = path.resolve(root)
  const resolved = path.resolve(candidate)
  const relative = path.relative(resolvedRoot, resolved)
  if (relative === '') return resolved
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new ToolError(`路径必须位于当前工作区内：${resolved}`)
  }
  return resolved
}

/* -------------------------------------------------------------------- store */

/**
 * Task history kept in memory and mirrored to JSON on disk. A Host restart
 * demotes anything still "running": no CLI survived it, and leaving the row
 * running would poll forever.
 */
function createStore(file) {
  let items = []
  let writing = Promise.resolve()

  const ready = (async () => {
    try {
      const raw = JSON.parse(await readFile(file, 'utf8'))
      if (!Array.isArray(raw)) return
      items = raw.map((item) => (
        item.status === 'queued' || item.status === 'running'
          ? { ...item, status: 'failed', stage: '', error: '宿主重启，任务已中断；请重新提交。' }
          : item
      ))
    } catch {
      items = []
    }
  })()

  function persist() {
    const snapshot = JSON.stringify(items.slice(0, HISTORY_LIMIT), null, 2)
    writing = writing
      .then(async () => {
        await mkdir(path.dirname(file), { recursive: true })
        await writeFile(file, snapshot, 'utf8')
      })
      .catch(() => {})
    return writing
  }

  return {
    ready,
    list() {
      return items.slice(0, HISTORY_LIMIT)
    },
    find(id) {
      return items.find((item) => item.id === id)
    },
    add(item) {
      items.unshift(item)
      if (items.length > HISTORY_LIMIT) items.length = HISTORY_LIMIT
      void persist()
      return item
    },
    update(id, patch) {
      const index = items.findIndex((item) => item.id === id)
      if (index < 0) return undefined
      items[index] = { ...items[index], ...patch, updatedAt: new Date().toISOString() }
      void persist()
      return items[index]
    },
    remove(id) {
      const before = items.length
      items = items.filter((item) => item.id !== id)
      if (items.length !== before) void persist()
      return items.length !== before
    },
  }
}

/* ------------------------------------------------------------------- assets */

async function scanAssets(root, exts, limit = 800) {
  const found = []
  const wanted = new Set(exts.map((ext) => ext.toLowerCase()))

  async function walk(dir, depth) {
    if (depth > 5 || found.length >= limit) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (found.length >= limit) return
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      const ext = path.extname(entry.name).toLowerCase()
      if (!wanted.has(ext)) continue
      let size = 0
      try {
        size = (await stat(full)).size
      } catch {
        continue
      }
      found.push({
        path: full,
        name: entry.name,
        relative: path.relative(root, full).split(path.sep).join('/'),
        type: assetKind(ext),
        size,
      })
    }
  }

  await walk(root, 0)
  return { assets: found, truncated: found.length >= limit }
}

/* ------------------------------------------------------------------ task run */

/**
 * Run one CLI to completion, streaming bounded output into the task record.
 * The child is tracked in `live` so a Host unload can kill it.
 */
function runCli({ command, args, cwd, signal, onLine }) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(command, args, {
        cwd,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        shell: process.platform === 'win32',
      })
    } catch (error) {
      reject(new ToolError(`无法启动命令 ${command}：${messageOf(error)}`))
      return
    }

    const abort = () => {
      try {
        child.kill('SIGTERM')
      } catch {
        /* already gone */
      }
    }
    if (signal) {
      if (signal.aborted) abort()
      else signal.addEventListener('abort', abort, { once: true })
    }

    child.on('error', (error) => reject(new ToolError(`无法启动命令 ${command}：${messageOf(error)}`)))
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk) => onLine(String(chunk), 'stdout'))
    child.stderr?.on('data', (chunk) => onLine(String(chunk), 'stderr'))
    child.on('close', (code) => resolve({ code: code === null ? -1 : code }))
  })
}

/* -------------------------------------------------------------------- apply */

/** The browser carrier must exist before this half can mount its config route. */
export const inject = ['webServer', 'tools']

export function apply(ctx, config = {}) {
  const settings = {
    geminiProvider: String(config.geminiProvider || DEFAULTS.geminiProvider),
    geminiModel: String(config.geminiModel || DEFAULTS.geminiModel),
    geminiApiKeyEnv: String(config.geminiApiKeyEnv || DEFAULTS.geminiApiKeyEnv),
    geminiBaseURL: String(config.geminiBaseURL || DEFAULTS.geminiBaseURL).replace(/\/+$/, ''),
    xiaoyunqueCommand: String(config.xiaoyunqueCommand || DEFAULTS.xiaoyunqueCommand),
    dreaminaCommand: String(config.dreaminaCommand || DEFAULTS.dreaminaCommand),
    defaultRatio: String(config.defaultRatio || DEFAULTS.defaultRatio),
    defaultDuration: asInt(config.defaultDuration, DEFAULTS.defaultDuration, 1, 60),
    xiaoyunqueModel: String(config.xiaoyunqueModel || DEFAULTS.xiaoyunqueModel),
    dreaminaModelVersion: String(config.dreaminaModelVersion || DEFAULTS.dreaminaModelVersion),
    xiaoyunqueResolution: String(config.xiaoyunqueResolution || DEFAULTS.xiaoyunqueResolution),
    dreaminaResolution: String(config.dreaminaResolution || DEFAULTS.dreaminaResolution),
    downloadFolder: String(config.downloadFolder || DEFAULTS.downloadFolder),
    storyboardPreset: String(config.storyboardPreset || DEFAULTS.storyboardPreset),
    assetExtensions: asList(config.assetExtensions, ['.png', '.jpg', '.jpeg', '.webp', '.mp4', '.mov', '.mp3', '.wav']),
  }
  // Keep the raw row config so the panel can rewrite only what it owns.
  let rawConfig = { ...config }

  const home = process.env.DSH_HOME || path.join(homedir(), '.dsh')
  const store = createStore(path.join(home, 'short-drama', 'history.json'))
  const live = new Map()

  /* ------------------------------------------------------------ workspace */

  /**
   * The directory every operation is relative to: the calling Session's current
   * working directory. This is the whole point — a tool run lands where the user
   * already is, not in some plugin-owned folder.
   */
  async function sessionRoot(agent, signal) {
    if (agent === undefined) {
      throw new ToolError('该操作需要一个 Agent 会话上下文（无法确定工作区目录）')
    }
    const directory = ctx.get('workingDirectory')
    if (directory === undefined) throw new ToolError('workingDirectory 服务不可用，无法定位工作区')
    return directory.ensure(agent, signal)
  }

  function resolveIn(root, value, fallback) {
    const text = String(value || '').trim() || fallback
    return insideRoot(root, path.isAbsolute(text) ? text : path.join(root, text))
  }

  /* --------------------------------------------------------------- gemini */

  async function credentialOf(envName) {
    const direct = process.env[envName]
    if (direct && direct.trim()) return { key: direct.trim(), source: `env:${envName}` }
    try {
      const credentials = ctx.get('credentials')
      if (credentials && typeof credentials.resolve === 'function') {
        const hit = await credentials.resolve(envName)
        const value = typeof hit === 'string' ? hit : hit?.value
        if (value && String(value).trim()) return { key: String(value).trim(), source: `dsh:${envName}` }
      }
    } catch {
      /* the credential service is optional */
    }
    return { key: '', source: '' }
  }

  async function generateStoryboard(script, preset, model, apiKey) {
    const rule = String(preset || '').trim() || settings.storyboardPreset
    const url = `${settings.geminiBaseURL}/models/${encodeURIComponent(model)}:generateContent`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: rule }] },
        contents: [{ role: 'user', parts: [{ text: script }] }],
        generationConfig: { temperature: 0.7 },
      }),
    })
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 400)
      throw new Error(`Gemini 请求失败（HTTP ${response.status}）：${detail}`)
    }
    const payload = await response.json()
    const parts = payload?.candidates?.[0]?.content?.parts
    const text = Array.isArray(parts)
      ? parts.filter((part) => typeof part?.text === 'string').map((part) => part.text).join('')
      : ''
    if (!text.trim()) throw new Error('Gemini 没有返回分镜词内容')
    return text
  }

  /* ---------------------------------------------------------------- video */

  /**
   * CLIs print log lines and then one JSON object on stdout. Parse the LAST
   * JSON object/line, which is the machine-readable result (both official CLIs
   * do this). Returns null when stdout contains no JSON.
   */
  function parseCliJson(text) {
    if (typeof text !== 'string' || !text.trim()) return null
    const trimmed = text.trim()
    try {
      return JSON.parse(trimmed)
    } catch {
      /* fall through: logs are mixed with the JSON line */
    }
    // Prefer the last line that starts with { — that is the result object.
    const lines = trimmed.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index]
      if (!line.startsWith('{')) continue
      try {
        return JSON.parse(line)
      } catch {
        /* keep scanning backwards */
      }
    }
    // Last resort: the largest {...} block in the whole output.
    const first = trimmed.indexOf('{')
    const last = trimmed.lastIndexOf('}')
    if (first !== -1 && last > first) {
      try {
        return JSON.parse(trimmed.slice(first, last + 1))
      } catch {
        /* no JSON at all */
      }
    }
    return null
  }

  /** Classify a CLI failure from its combined output using the documented strings. */
  function classifyCliFailure(text) {
    const clean = String(text || '').replace(/[\u0000-\u001f\u007f]/gu, ' ').trim()
    if (/没有\s*dreamina_cli\s*使用权限|仅限高级|plan_generation_unsupported/iu.test(clean)) {
      return '即梦账号未开通 CLI 生成权限：官方 CLI 仅限高级会员（普通网页登录不等于 CLI 权限）。'
    }
    if (/未检测到有效登录态|请先执行\s*dreamina\s*login|请先登录|unauthori[sz]ed|not logged in|未登录/iu.test(clean)) {
      return 'CLI 未登录：请先在运行宿主的环境里执行一次登录（dreamina login --headless 或 pippit-tool-cli login）。'
    }
    if (/AigcComplianceConfirmationRequired|合规/iu.test(clean)) {
      return '内容合规确认未完成：需要到对应网页端完成一次授权后再重试。'
    }
    return clean.slice(-600) || 'CLI 执行失败'
  }

  /** Collect a CLI run's stdout/stderr into a bounded tail on the task record. */
  async function cliRun(item, command, args, controller, stage) {
    store.update(item.id, { status: 'running', command, args, stage })
    let tail = ''
    const outcome = await runCli({
      command,
      args,
      cwd: item.cwd,
      signal: controller.signal,
      onLine: (chunk, stream) => {
        tail = (tail + chunk).slice(-8000)
        store.update(item.id, { stage: stream === 'stderr' ? 'CLI 输出…' : stage, tail })
      },
    })
    return { outcome, tail }
  }

  /**
   * Dreamina (即梦) real flow:
   *   submit:  dreamina text2video --prompt X --model_version M --ratio R
   *              --video_resolution RES --duration N --poll=0   (or image2video with --image)
   *   poll:    dreamina query_result --submit_id=ID
   *   download: dreamina query_result --submit_id=ID --download_dir=DIR  (or URL download)
   */
  async function runDreamina(item, controller, deadline) {
    const command = settings.dreaminaCommand
    const modelVersion = String(item.model || settings.dreaminaModelVersion || '').trim()
    const ratio = item.ratio
    const resolution = settings.dreaminaResolution || '720p'

    let submitArgs = [
      'text2video',
      '--prompt', item.prompt,
      '--model_version', modelVersion,
      '--ratio', ratio,
      '--video_resolution', resolution,
      '--duration', String(item.seconds),
      '--poll=0',
    ]
    // An image reference switches to image2video, which uses --image (singular)
    // and has no --ratio flag.
    if (item.assets.length > 0) {
      submitArgs = [
        'image2video',
        '--image', item.assets[0],
        '--prompt', item.prompt,
        '--video_resolution', resolution,
        '--duration', String(item.seconds),
        '--model_version', modelVersion,
        '--poll=0',
      ]
    }

    store.update(item.id, { stage: '提交生成任务…' })
    const { outcome, tail } = await cliRun(item, command, submitArgs, controller, '生成中…')
    if (Date.now() > deadline) throw new Error('任务超时')
    if (controller.signal.aborted) return
    if (outcome.code !== 0) {
      store.update(item.id, { status: 'failed', stage: '', error: classifyCliFailure(tail) })
      return
    }

    const submitted = parseCliJson(tail)
    const submitId = submitted?.submit_id || submitted?.data?.submit_id
    if (!submitId) {
      store.update(item.id, {
        status: 'failed', stage: '',
        error: `提交成功但未找到 submit_id：${tail.trim().slice(-400) || 'CLI 无输出'}`,
      })
      return
    }
    store.update(item.id, { submitId, stage: '任务已提交，等待成片…' })

    // Poll query_result until success/fail.
    const pollIntervalMs = 3000
    while (!controller.signal.aborted && Date.now() <= deadline) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
      const pollArgs = ['query_result', `--submit_id=${submitId}`, `--download_dir=${item.outDir}`]
      const polled = await cliRun(item, command, pollArgs, controller, '查询结果…')
      if (controller.signal.aborted) return
      if (polled.outcome.code !== 0) {
        store.update(item.id, { status: 'failed', stage: '', error: classifyCliFailure(polled.tail) })
        return
      }
      const result = parseCliJson(polled.tail)
      const genStatus = result?.gen_status || result?.data?.gen_status
      if (genStatus === 'success' || genStatus === 'succeed' || genStatus === 'completed') {
        const produced = await newestVideo(item.outDir) || await newestMediaUrl(result, item.outDir, item.id)
        store.update(item.id, {
          status: produced ? 'succeeded' : 'completed',
          stage: '', resultFile: produced || '',
          resultName: produced ? path.basename(produced) : '',
          error: produced ? '' : '生成成功，但未能定位输出文件（可查看 tail 中的下载地址）',
        })
        return
      }
      if (genStatus === 'fail' || genStatus === 'failed') {
        store.update(item.id, {
          status: 'failed', stage: '',
          error: String(result?.fail_reason || result?.data?.fail_reason || '生成失败').slice(-600),
        })
        return
      }
      store.update(item.id, { stage: `生成中…（${genStatus || 'querying'}）` })
    }
    if (controller.signal.aborted) return
    store.update(item.id, { status: 'failed', stage: '', error: '查询超时，任务仍可能在服务端生成中' })
  }

  /**
   * XiaoYunque / Pippit real flow:
   *   submit:  pippit-tool-cli generate-video --prompt X --model M --ratio R
   *              --duration N --resolution RES [--image P ...] [--audio P ...]
   *            -> JSON { thread_id, run_id }
   *   poll:    pippit-tool-cli query-result --thread-id T --run-id R --download-dir DIR [--wait]
   */
  async function runXiaoyunque(item, controller, deadline) {
    const command = settings.xiaoyunqueCommand
    const model = String(item.model || settings.xiaoyunqueModel || '').trim()
    const ratio = item.ratio
    const resolution = settings.xiaoyunqueResolution || '720p'

    if (!model) {
      store.update(item.id, {
        status: 'failed', stage: '',
        error: '未配置小云雀模型：先在面板「小云雀模型 key」里填 model list 中的模型，或在提交时传入 model 参数。',
      })
      return
    }

    const submitArgs = [
      'generate-video',
      '--prompt', item.prompt,
      '--model', model,
      '--ratio', ratio,
      '--duration', String(item.seconds),
      '--resolution', resolution,
    ]
    // Pippit supports repeatable --image / --video / --audio. Route workspace
    // assets by their extension (portraits -> --image, voices -> --audio).
    for (const asset of item.assets) {
      const ext = path.extname(asset).toLowerCase()
      if (IMAGE_EXT.has(ext)) submitArgs.push('--image', asset)
      else if (AUDIO_EXT.has(ext)) submitArgs.push('--audio', asset)
      else if (VIDEO_EXT.has(ext)) submitArgs.push('--video', asset)
    }

    store.update(item.id, { stage: '提交生成任务…' })
    const { outcome, tail } = await cliRun(item, command, submitArgs, controller, '生成中…')
    if (Date.now() > deadline) throw new Error('任务超时')
    if (controller.signal.aborted) return
    if (outcome.code !== 0) {
      store.update(item.id, { status: 'failed', stage: '', error: classifyCliFailure(tail) })
      return
    }

    const submitted = parseCliJson(tail)
    const threadId = submitted?.thread_id || submitted?.data?.thread_id
    const runId = submitted?.run_id || submitted?.data?.run_id
    if (!threadId || !runId) {
      store.update(item.id, {
        status: 'failed', stage: '',
        error: `提交成功但未找到 thread_id / run_id：${tail.trim().slice(-400) || 'CLI 无输出'}`,
      })
      return
    }
    store.update(item.id, { threadId, runId, stage: '任务已提交，等待成片…' })

    const pollIntervalMs = 3000
    while (!controller.signal.aborted && Date.now() <= deadline) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
      const pollArgs = [
        'query-result',
        '--thread-id', String(threadId),
        '--run-id', String(runId),
        '--download-dir', item.outDir,
      ]
      const polled = await cliRun(item, command, pollArgs, controller, '查询结果…')
      if (controller.signal.aborted) return
      if (polled.outcome.code !== 0) {
        store.update(item.id, { status: 'failed', stage: '', error: classifyCliFailure(polled.tail) })
        return
      }
      const result = parseCliJson(polled.tail)
      const state = String(result?.status || result?.run_state || result?.data?.status || '').toLowerCase()
      if (/^(succeeded|success|completed)$/iu.test(state)) {
        const produced = await newestVideo(item.outDir) || await newestMediaUrl(result, item.outDir, item.id)
        store.update(item.id, {
          status: produced ? 'succeeded' : 'completed',
          stage: '', resultFile: produced || '',
          resultName: produced ? path.basename(produced) : '',
          error: produced ? '' : '生成成功，但未能定位输出文件（可查看 tail 中的下载地址）',
        })
        return
      }
      if (/^(failed|fail|canceled|cancelled|interrupted)$/iu.test(state)) {
        const reason = result?.fail_reason?.message || result?.fail_reason || result?.data?.fail_reason || '生成失败'
        store.update(item.id, { status: 'failed', stage: '', error: String(reason).slice(-600) })
        return
      }
      if (/^input_required$/iu.test(state)) {
        store.update(item.id, { status: 'failed', stage: '', error: '任务需要人工输入/确认，已停止自动轮询。' })
        return
      }
      store.update(item.id, { stage: `生成中…（${state || 'running'}）` })
    }
    if (controller.signal.aborted) return
    store.update(item.id, { status: 'failed', stage: '', error: '查询超时，任务仍可能在服务端生成中' })
  }

  function startVideoTask(item) {
    const controller = new AbortController()
    live.set(item.id, { controller })

    void (async () => {
      const deadline = Date.now() + TASK_DEADLINE_MS
      try {
        if (item.provider === 'dreamina') await runDreamina(item, controller, deadline)
        else await runXiaoyunque(item, controller, deadline)
      } catch (error) {
        store.update(item.id, {
          status: controller.signal.aborted ? 'cancelled' : 'failed',
          stage: '',
          error: controller.signal.aborted ? '已取消' : messageOf(error),
        })
      } finally {
        live.delete(item.id)
      }
    })()
  }

  async function newestVideo(dir) {
    try {
      const entries = await readdir(dir, { withFileTypes: true })
      const candidates = entries.filter((entry) => entry.isFile() && VIDEO_EXT.has(path.extname(entry.name).toLowerCase()))
      if (candidates.length === 0) return null
      let best = null
      let bestTime = 0
      for (const entry of candidates) {
        const full = path.join(dir, entry.name)
        const info = await stat(full)
        if (info.mtimeMs > bestTime) {
          bestTime = info.mtimeMs
          best = full
        }
      }
      return best
    } catch {
      return null
    }
  }

  /**
   * If no local file appeared but the CLI returned an https media URL, download
   * it into the workspace output dir. Both CLIs can return URLs in their result
   * JSON; downloading here keeps everything inside the current workspace.
   */
  async function newestMediaUrl(result, outDir, taskId) {
    const urls = []
    const collect = (value, depth) => {
      if (depth > 8 || urls.length > 0) return
      if (typeof value === 'string') {
        if (/^https:\/\//iu.test(value) && /\.(mp4|mov|webm|mkv|m4v)(\?|$)/iu.test(value)) urls.push(value)
        return
      }
      if (Array.isArray(value)) {
        for (const item of value) collect(item, depth + 1)
        return
      }
      if (value && typeof value === 'object') {
        for (const item of Object.values(value)) collect(item, depth + 1)
      }
    }
    collect(result, 0)
    if (urls.length === 0) return null
    const url = urls[0]
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(120000) })
      if (!response.ok || !response.body) return null
      const ext = (url.match(/\.(mp4|mov|webm|mkv|m4v)(\?|$)/iu) || [])[1] || 'mp4'
      const target = path.join(outDir, `${taskId}.${ext}`)
      await mkdir(outDir, { recursive: true })
      const chunks = []
      let size = 0
      for await (const chunk of response.body) {
        size += chunk.length
        if (size > MAX_DOWNLOAD_BYTES) throw new Error('下载文件超过 2GB 上限')
        chunks.push(chunk)
      }
      await writeFile(target, Buffer.concat(chunks))
      return target
    } catch {
      return null
    }
  }

  /* ----------------------------------------------------------- tools: core */

  /**
   * Register one tool. Plain object definitions are accepted by the registry;
   * `defineTool` only adds types, which this ESM file cannot use without the
   * package dependency.
   */
  function register(spec) {
    ctx.effect(() => ctx.tools.register(spec), `dsh-short-drama: tool ${spec.name}`)
  }

  const TEXT = (text) => [{ type: 'text', text }]

  /* -- storyboard_write ------------------------------------------------- */

  register({
    name: 'storyboard_write',
    description:
      '把剧本转换成短剧分镜词（分镜表），并按工作区相对路径写入一个 Markdown 文件。'
      + '使用插件配置里可自定义的分镜规则；可传入 preset 覆盖本次规则。'
      + '所有路径相对于当前会话的工作目录。',
    parameters: {
      script: { type: 'string', required: true, description: '完整剧本文本。' },
      output: { type: 'string', description: '分镜词写出的 Markdown 文件名或相对路径，默认 storyboard.md。' },
      preset: { type: 'string', description: '本次使用的分镜规则；省略则用插件配置的 storyboardPreset。' },
      model: { type: 'string', description: '覆盖本次使用的 Gemini 模型名。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'storyboard', 'model'],
        properties: {
          path: { type: 'string' },
          storyboard: { type: 'string' },
          model: { type: 'string' },
        },
      },
      render: (_args, value) => TEXT(`已写入分镜词：${value.path}\n\n${value.storyboard}`),
    },
    async execute(args, exec) {
      const script = String(args.script || '').trim()
      if (!script) throw new ToolError('剧本内容不能为空')
      if (script.length > MAX_SCRIPT) throw new ToolError('剧本过长')
      const credential = await credentialOf(settings.geminiApiKeyEnv)
      if (!credential.key) {
        throw new ToolError(`未找到 Gemini 凭据：请设置 ${settings.geminiApiKeyEnv}，或在「设置 → 模型」中配置 google/Gemini 供应商`)
      }
      const root = await sessionRoot(exec.agent, exec.signal)
      const model = String(args.model || '').trim() || settings.geminiModel
      const storyboard = await generateStoryboard(script, args.preset, model, credential.key)
      const target = insideRoot(root, args.output ? (path.isAbsolute(args.output) ? args.output : path.join(root, args.output)) : path.join(root, 'storyboard.md'))
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, storyboard.endsWith('\n') ? storyboard : `${storyboard}\n`, 'utf8')
      return { path: target, storyboard, model }
    },
  })

  /* -- short_drama_assets ----------------------------------------------- */

  register({
    name: 'short_drama_assets',
    description: '列出当前工作区内可用的短剧资产（人像图、音色、参考视频等），用于给视频生成关联素材。只读。',
    parameters: {
      type: { type: 'string', enum: ['all', 'image', 'audio', 'video'], description: '按类型过滤，默认 all。' },
      limit: { type: 'integer', description: '最多返回多少条，默认 100。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['root', 'assets', 'truncated'],
        properties: {
          root: { type: 'string' },
          assets: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['relative', 'type', 'size'],
              properties: {
                relative: { type: 'string' },
                type: { type: 'string' },
                size: { type: 'integer' },
              },
            },
          },
          truncated: { type: 'boolean' },
        },
      },
      render: (_args, value) => {
        if (value.assets.length === 0) return TEXT(`工作区 ${value.root} 内未发现资产。`)
        const lines = value.assets.map((asset) => `- [${asset.type}] ${asset.relative}`)
        return TEXT(`工作区资产（${value.assets.length}${value.truncated ? '+' : ''}）：\n${lines.join('\n')}`)
      },
    },
    async execute(args, exec) {
      const root = await sessionRoot(exec.agent, exec.signal)
      const scanned = await scanAssets(root, settings.assetExtensions)
      const wanted = args.type && args.type !== 'all' ? args.type : ''
      let assets = wanted ? scanned.assets.filter((asset) => asset.type === wanted) : scanned.assets
      const limit = asInt(args.limit, 100, 1, 500)
      const truncated = scanned.truncated || assets.length > limit
      assets = assets.slice(0, limit)
      return {
        root,
        assets: assets.map((asset) => ({ relative: asset.relative, type: asset.type, size: asset.size })),
        truncated,
      }
    },
  })

  /* -- video_submit ------------------------------------------------------ */

  register({
    name: 'video_submit',
    description:
      '用小云雀（Pippit / pippit-tool-cli）或即梦（dreamina CLI）的官方 CLI 提交视频生成任务，'
      + '返回任务 id 后可用 video_status 轮询。工具会按 CLI 的真实语法提交并自动查询、下载成片。'
      + '任务在宿主后台运行，离开会话不会中断。输出目录与素材路径都相对于当前会话工作区。',
    parameters: {
      prompt: { type: 'string', required: true, description: '提示词或分镜词文本。' },
      provider: { type: 'string', enum: ['xiaoyunque', 'dreamina'], description: '视频供应商，默认 xiaoyunque。' },
      assets: { type: 'array', items: { type: 'string' }, description: '要关联的素材相对路径，来自 short_drama_assets；图片会作为首帧，音频作为配音。' },
      ratio: { type: 'string', description: '画面比例，默认取插件配置 defaultRatio。' },
      seconds: { type: 'integer', description: '时长（秒），默认取插件配置 defaultDuration。' },
      model: { type: 'string', description: '模型：dreamina 传 model_version（如 seedance2.0mini），小云雀传 model list 的 key（如 Seedance_2.0_mini_lite）；可选，默认取面板配置。' },
      outputDir: { type: 'string', description: '输出目录，相对工作区，默认取插件配置 downloadFolder。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'status', 'outDir', 'command'],
        properties: {
          id: { type: 'string' },
          status: { type: 'string' },
          outDir: { type: 'string' },
          command: { type: 'string' },
        },
      },
      render: (_args, value) => TEXT(`已提交视频任务 ${value.id}（${value.status}）。\n输出目录：${value.outDir}\n命令：${value.command}`),
    },
    async execute(args, exec) {
      await store.ready
      const prompt = String(args.prompt || '').trim()
      if (!prompt) throw new ToolError('提示词 / 分镜词不能为空')
      if (prompt.length > MAX_PROMPT) throw new ToolError('提示词过长')
      const root = await sessionRoot(exec.agent, exec.signal)
      const outDir = resolveIn(root, args.outputDir, settings.downloadFolder)
      await mkdir(outDir, { recursive: true })

      const assets = asList(args.assets, []).map((asset) => resolveIn(root, asset, ''))
      const provider = args.provider === 'dreamina' ? 'dreamina' : 'xiaoyunque'
      const command = provider === 'dreamina' ? settings.dreaminaCommand : settings.xiaoyunqueCommand

      const item = {
        id: randomUUID(),
        kind: 'video',
        status: 'queued',
        stage: '排队中…',
        provider,
        prompt,
        model: String(args.model || '').trim(),
        ratio: String(args.ratio || '').trim() || settings.defaultRatio,
        seconds: asInt(args.seconds, settings.defaultDuration, 1, 60),
        assets,
        workspaceId: root,
        cwd: root,
        outDir,
        resultFile: '',
        resultName: '',
        command: '',
        args: [],
        tail: '',
        error: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      store.add(item)
      startVideoTask(item)
      return { id: item.id, status: item.status, outDir, command }
    },
  })

  /* -- video_status ------------------------------------------------------ */

  register({
    name: 'video_status',
    description: '查询一个或全部视频任务的状态；省略 id 时返回最近的任务列表。只读。',
    parameters: {
      id: { type: 'string', description: '任务 id；省略则列出最近任务。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['items'],
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['id', 'status', 'provider', 'stage', 'error', 'resultName', 'outDir', 'prompt'],
              properties: {
                id: { type: 'string' },
                status: { type: 'string' },
                provider: { type: 'string' },
                stage: { type: 'string' },
                error: { type: 'string' },
                resultName: { type: 'string' },
                outDir: { type: 'string' },
                prompt: { type: 'string' },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        if (value.items.length === 0) return TEXT('还没有视频任务。')
        return TEXT(value.items.map((item) => {
          const bits = [`${item.id} · ${item.status} · ${item.provider}`]
          if (item.stage) bits.push(item.stage)
          if (item.resultName) bits.push(item.resultName)
          if (item.error) bits.push(`错误：${item.error}`)
          return `- ${bits.join(' | ')}\n  ${item.prompt.slice(0, 80)}`
        }).join('\n'))
      },
    },
    async execute(args) {
      await store.ready
      const id = String(args.id || '').trim()
      const source = id
        ? [store.find(id)].filter(Boolean)
        : store.list().slice(0, 20)
      if (id && source.length === 0) throw new ToolError(`任务不存在：${id}`)
      return {
        items: source.map((item) => ({
          id: item.id,
          status: item.status,
          provider: item.provider,
          stage: item.stage || '',
          error: item.error || '',
          resultName: item.resultName || '',
          outDir: item.outDir || '',
          prompt: item.prompt || '',
        })),
      }
    },
  })

  /* -- video_download ---------------------------------------------------- */

  register({
    name: 'video_download',
    description: '把一个已完成的视频任务结果复制到当前工作区内的指定目录，返回最终文件路径。',
    parameters: {
      id: { type: 'string', required: true, description: '任务 id。' },
      targetDir: { type: 'string', description: '目标目录，相对工作区；省略则留在任务原本的输出目录。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'name', 'size'],
        properties: {
          path: { type: 'string' },
          name: { type: 'string' },
          size: { type: 'integer' },
        },
      },
      render: (_args, value) => TEXT(`已保存：${value.path}（${value.size} 字节）`),
    },
    async execute(args, exec) {
      await store.ready
      const item = store.find(String(args.id || '').trim())
      if (!item) throw new ToolError('任务不存在')
      if (!item.resultFile) throw new ToolError('该任务还没有可下载的结果文件')
      const root = await sessionRoot(exec.agent, exec.signal)
      const destDir = resolveIn(root, args.targetDir, item.outDir)
      await mkdir(destDir, { recursive: true })
      const dest = path.join(destDir, path.basename(item.resultFile))
      if (path.resolve(dest) !== path.resolve(item.resultFile)) await copyFile(item.resultFile, dest)
      return { path: dest, name: path.basename(dest), size: (await stat(dest)).size }
    },
  })

  /* -- video_cancel ------------------------------------------------------ */

  register({
    name: 'video_cancel',
    description: '取消一个排队中或运行中的视频任务。',
    parameters: {
      id: { type: 'string', required: true, description: '任务 id。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'status'],
        properties: { id: { type: 'string' }, status: { type: 'string' } },
      },
      render: (_args, value) => TEXT(`任务 ${value.id} 现在状态：${value.status}`),
    },
    async execute(args) {
      await store.ready
      const id = String(args.id || '').trim()
      const item = store.find(id)
      if (!item) throw new ToolError('任务不存在')
      const running = live.get(id)
      if (running) running.controller.abort()
      if (item.status === 'queued' || item.status === 'running') {
        store.update(id, { status: 'cancelled', stage: '', error: '已取消' })
      }
      return { id, status: store.find(id)?.status || 'cancelled' }
    },
  })

  /* ---------------------------------------------------- config route only */

  function configView() {
    return {
      version: VERSION,
      geminiProvider: settings.geminiProvider,
      geminiModel: settings.geminiModel,
      geminiApiKeyEnv: settings.geminiApiKeyEnv,
      geminiBaseURL: settings.geminiBaseURL,
      xiaoyunqueCommand: settings.xiaoyunqueCommand,
      dreaminaCommand: settings.dreaminaCommand,
      defaultRatio: settings.defaultRatio,
      defaultDuration: settings.defaultDuration,
      xiaoyunqueModel: settings.xiaoyunqueModel,
      dreaminaModelVersion: settings.dreaminaModelVersion,
      xiaoyunqueResolution: settings.xiaoyunqueResolution,
      dreaminaResolution: settings.dreaminaResolution,
      downloadFolder: settings.downloadFolder,
      storyboardPreset: settings.storyboardPreset,
      assetExtensions: settings.assetExtensions,
      writable: typeof ctx.get('configEditor') === 'object',
    }
  }

  async function handleConfig(req, res) {
    const method = req.method || 'GET'
    if (method === 'GET') {
      const credential = await credentialOf(settings.geminiApiKeyEnv)
      sendJson(res, 200, { ok: true, config: configView(), keyConfigured: Boolean(credential.key), keySource: credential.source })
      return
    }
    if (method !== 'POST') throw new HttpError(405, '只支持 GET / POST')

    const editor = ctx.get('configEditor')
    const entry = ctx.fiber?.entry
    if (!editor || entry === undefined) throw new HttpError(501, '当前 profile 无法写入配置（缺少 configEditor）')

    const body = await readJson(req)
    const patch = body && typeof body.config === 'object' && body.config !== null ? body.config : body
    const next = { ...rawConfig }
    for (const key of CONFIG_KEYS) {
      if (patch && Object.prototype.hasOwnProperty.call(patch, key)) next[key] = patch[key]
    }
    // Assert the round trip before writing: a mangled multi-line preset is
    // worse than a refused save, so compare what we are about to persist.
    if (typeof next.storyboardPreset === 'string' && !next.storyboardPreset.trim()) {
      throw new HttpError(400, '分镜规则不能为空')
    }
    try {
      await editor.edit(entry, () => next)
    } catch (error) {
      throw new HttpError(500, `写入配置失败：${messageOf(error)}`)
    }
    rawConfig = next
    sendJson(res, 200, { ok: true, saved: true, config: configView() })
  }

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: async (req, res) => {
          try {
            const url = new URL(req.url || '/', 'http://127.0.0.1')
            if (!url.pathname.startsWith(ROUTE_PREFIX)) throw new HttpError(404, '未知接口')
            const rest = url.pathname.slice(ROUTE_PREFIX.length) || '/'
            if (rest === '/version' || rest === '/') {
              sendJson(res, 200, { ok: true, version: VERSION })
              return
            }
            if (rest === '/config') {
              await handleConfig(req, res)
              return
            }
            throw new HttpError(404, '未知接口')
          } catch (error) {
            sendJson(res, error instanceof HttpError ? error.status : 500, { ok: false, error: messageOf(error) })
          }
        },
      }),
    'dsh-short-drama: config route',
  )

  ctx.effect(() => () => {
    for (const running of live.values()) {
      try {
        running.controller.abort()
      } catch {
        /* already settled */
      }
    }
    live.clear()
  }, 'dsh-short-drama: abort tasks')

  store.ready.catch(() => {})
}
