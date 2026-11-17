/**
 * Host half of `dsh-short-drama`（短剧工坊）.
 *
 * The panel only submits tasks and reads history; every task runs in this
 * process, so switching panels or reloading the page never loses a generation.
 *
 * The browser never holds an API key and never talks to Gemini directly: this
 * half owns the model call, the two CLI invocations, the asset scan and the
 * download. The panel reaches it over one prefix route (`/short-drama/api/...`)
 * mounted on `ctx.webServer`, so no Typert Remote or generated descriptor is
 * involved.
 *
 * Wire shape: every route answers `{ ok: true, ... }` or
 * `{ ok: false, error }`, and the client folds a failure into the panel's error
 * banner instead of throwing through React.
 */

import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

const VERSION = '1.0.0'

/** Prefix route owned by this panel; the client prefixes every call with it. */
const ROUTE_PREFIX = '/short-drama/api'

const DEFAULTS = {
  geminiProvider: 'google',
  geminiModel: 'gemini-2.5-pro',
  geminiApiKeyEnv: 'GEMINI_API_KEY',
  geminiBaseURL: 'https://generativelanguage.googleapis.com/v1beta',
  xiaoyunqueCommand: 'xiaoyunque',
  dreaminaCommand: 'dreamina',
  defaultRatio: '9:16',
  defaultDuration: 5,
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

const MAX_PROMPT = 20000
const MAX_SCRIPT = 200000
const HISTORY_LIMIT = 100
const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024
const TASK_DEADLINE_MS = 40 * 60 * 1000
const POLL_INTERVAL_MS = 2500

const VIDEO_EXT = new Set(['.mp4', '.mov', '.webm', '.mkv', '.avi'])
const AUDIO_EXT = new Set(['.mp3', '.wav', '.m4a', '.aac', '.flac'])
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

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

/** Panel-relative route: no leading/trailing slash, kept verbatim otherwise. */
function normalizeRoute(value) {
  return String(value || '')
    .trim()
    .replace(/^\/+|\/+$/g, '')
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

/* -------------------------------------------------------------------- store */

/**
 * Task history kept in memory and mirrored to JSON on disk, so a Host restart
 * keeps finished results and demotes anything still "running" (no process can
 * have survived the restart, and leaving it running would poll forever).
 */
function createStore(file) {
  let items = []
  let writing = Promise.resolve()

  const ready = (async () => {
    try {
      const raw = JSON.parse(await readFile(file, 'utf8'))
      if (!Array.isArray(raw)) return
      items = raw.map((item) => {
        if (item.status === 'queued' || item.status === 'running') {
          return { ...item, status: 'failed', stage: '', error: '宿主重启，任务已中断；请重新提交。' }
        }
        return item
      })
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
    orderingKey() {
      return items.length
    },
  }
}

/* ------------------------------------------------------------------- assets */

/**
 * Scan a workspace for short-drama assets. Bounded in both depth and count so a
 * huge project cannot stall the route; `truncated` tells the panel to say so.
 */
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
 *
 * `spawn` is used directly rather than `ctx.subprocess`: this half is a plain
 * bundle, and the child is ours to own — it is tracked in `live` so a Host
 * unload can kill it.
 */
function runCli({ command, args, cwd, env, onLine, signal }) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(command, args, {
        cwd,
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (error) {
      reject(error)
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
      if (signal.aborted) {
        abort()
      } else {
        signal.addEventListener('abort', abort, { once: true })
      }
    }

    child.on('error', (error) => reject(error))
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk) => onLine(String(chunk), 'stdout'))
    child.stderr?.on('data', (chunk) => onLine(String(chunk), 'stderr'))
    child.on('close', (code) => resolve({ code: code === null ? -1 : code, child }))
  })
}

/* ------------------------------------------------------------------ handler */

function createHandler(ctx, settings, store, live) {
  let workspaces = []

  function workspaceRoots() {
    const roots = []
    try {
      const registry = ctx.get('workspaceRegistry')
      if (registry && typeof registry.list === 'function') {
        for (const workspace of registry.list()) {
          roots.push({
            id: String(workspace.id),
            path: workspace.path,
            title: workspace.title || path.basename(workspace.path),
          })
        }
      }
    } catch {
      /* the registry is optional in a headless profile */
    }
    if (roots.length === 0) {
      try {
        const directory = ctx.get('workingDirectory')
        if (directory && typeof directory.defaultDirectory === 'string') {
          roots.push({ id: 'default', path: directory.defaultDirectory, title: path.basename(directory.defaultDirectory) })
        }
      } catch {
        /* fall through to the process directory */
      }
    }
    if (roots.length === 0) roots.push({ id: 'cwd', path: process.cwd(), title: path.basename(process.cwd()) })
    return roots
  }

  function resolveRoot(workspaceId) {
    workspaces = workspaceRoots()
    if (workspaceId) {
      const match = workspaces.find((workspace) => workspace.id === String(workspaceId))
      if (match) return match.path
      const byPath = workspaces.find((workspace) => workspace.path === String(workspaceId))
      if (byPath) return byPath.path
    }
    return workspaces[0].path
  }

  function resolveDownloadDir(root, target) {
    const value = String(target || '').trim()
    if (!value) return path.join(root, settings.downloadFolder)
    return path.isAbsolute(value) ? value : path.join(root, value)
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

  /** Ask Gemini for the storyboard. Direct HTTP: this half owns the key. */
  async function generateStoryboard(script, preset, model, apiKey) {
    const rule = String(preset || '').trim() || settings.storyboardPreset
    const body = {
      system_instruction: { parts: [{ text: rule }] },
      contents: [{ role: 'user', parts: [{ text: script }] }],
      generationConfig: { temperature: 0.7 },
    }
    const url = `${settings.geminiBaseURL}/models/${encodeURIComponent(model)}:generateContent`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 400)
      throw new HttpError(response.status === 429 ? 429 : 502, `Gemini 请求失败（HTTP ${response.status}）：${detail}`)
    }
    const payload = await response.json()
    const parts = payload?.candidates?.[0]?.content?.parts
    const text = Array.isArray(parts)
      ? parts.filter((part) => typeof part?.text === 'string').map((part) => part.text).join('')
      : ''
    if (!text.trim()) throw new HttpError(502, 'Gemini 没有返回分镜词内容')
    return text
  }

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

  async function statusRoute(res) {
    const credential = await credentialOf(settings.geminiApiKeyEnv)
    sendJson(res, 200, {
      ok: true,
      version: VERSION,
      provider: settings.geminiProvider,
      model: settings.geminiModel,
      apiKeyEnv: settings.geminiApiKeyEnv,
      configured: Boolean(credential.key),
      source: credential.source,
      baseURL: settings.geminiBaseURL,
      xiaoyunqueCommand: settings.xiaoyunqueCommand,
      dreaminaCommand: settings.dreaminaCommand,
      defaultRatio: settings.defaultRatio,
      defaultDuration: settings.defaultDuration,
      downloadFolder: settings.downloadFolder,
      storyboardPreset: settings.storyboardPreset,
      workspaces: workspaceRoots(),
    })
  }

  function startVideoTask(item) {
    const controller = new AbortController()
    live.set(item.id, { controller })
    item.stage = '提交任务…'
    store.update(item.id, { stage: item.stage })

    void (async () => {
      const deadline = Date.now() + TASK_DEADLINE_MS
      try {
        const command = item.provider === 'dreamina' ? settings.dreaminaCommand : settings.xiaoyunqueCommand
        const args = [
          'generate',
          '--prompt',
          item.prompt,
          '--ratio',
          item.ratio,
          '--duration',
          String(item.seconds),
          '--output',
          item.outDir,
        ]
        if (item.model) args.push('--model', item.model)
        for (const asset of item.assets) args.push('--asset', asset)

        store.update(item.id, { status: 'running', stage: '调用 CLI…', command, args })
        let tail = ''
        const outcome = await runCli({
          command,
          args,
          cwd: item.cwd,
          signal: controller.signal,
          onLine: (chunk, stream) => {
            tail = (tail + chunk).slice(-4000)
            store.update(item.id, { stage: stream === 'stderr' ? 'CLI 输出…' : '生成中…', tail })
          },
        })

        if (Date.now() > deadline) throw new Error('任务超时')
        if (controller.signal.aborted) {
          store.update(item.id, { status: 'cancelled', stage: '', error: '已取消' })
          return
        }
        if (outcome.code !== 0) {
          store.update(item.id, {
            status: 'failed',
            stage: '',
            error: (tail.trim().slice(-600) || `CLI 退出码 ${outcome.code}`),
          })
          return
        }
        const produced = await newestVideo(item.outDir)
        store.update(item.id, {
          status: produced ? 'succeeded' : 'completed',
          stage: '',
          resultFile: produced,
          resultName: produced ? path.basename(produced) : '',
          error: produced ? '' : 'CLI 执行成功，但未在输出目录找到视频文件',
        })
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

  return async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1')
      if (!url.pathname.startsWith(ROUTE_PREFIX)) throw new HttpError(404, '未知接口')
      const rest = url.pathname.slice(ROUTE_PREFIX.length) || '/'
      const method = req.method || 'GET'

      if (method === 'GET' && rest === '/version') {
        sendJson(res, 200, { ok: true, version: VERSION })
        return
      }

      if (method === 'GET' && rest === '/status') {
        await store.ready
        await statusRoute(res)
        return
      }

      if (method === 'GET' && rest === '/history') {
        await store.ready
        sendJson(res, 200, { ok: true, items: store.list() })
        return
      }

      if (method === 'POST' && rest === '/history/delete') {
        await store.ready
        const body = await readJson(req)
        const removed = store.remove(String(body.id || ''))
        sendJson(res, 200, { ok: true, removed })
        return
      }

      if (method === 'POST' && rest === '/storyboard') {
        await store.ready
        const body = await readJson(req)
        const script = String(body.script || '').trim()
        if (!script) throw new HttpError(400, '剧本内容不能为空')
        if (script.length > MAX_SCRIPT) throw new HttpError(400, '剧本过长')
        const credential = await credentialOf(settings.geminiApiKeyEnv)
        if (!credential.key) {
          throw new HttpError(412, `未找到 Gemini 凭据：请设置 ${settings.geminiApiKeyEnv}，或在「设置 → 模型」中配置 google/Gemini 供应商`)
        }
        const model = String(body.model || '').trim() || settings.geminiModel
        const storyboard = await generateStoryboard(script, body.preset, model, credential.key)
        sendJson(res, 200, { ok: true, storyboard, model, preset: String(body.preset || '').trim() || settings.storyboardPreset })
        return
      }

      if (method === 'GET' && rest === '/assets') {
        const workspaceId = url.searchParams.get('workspaceId') || ''
        const root = resolveRoot(workspaceId)
        const exts = asList(settings.assetExtensions, ['.png', '.jpg', '.jpeg', '.webp', '.mp4', '.mov', '.mp3', '.wav'])
        const scanned = await scanAssets(root, exts)
        sendJson(res, 200, { ok: true, root, ...scanned })
        return
      }

      if (method === 'POST' && rest === '/video') {
        await store.ready
        const body = await readJson(req)
        const prompt = String(body.prompt || '').trim()
        if (!prompt) throw new HttpError(400, '提示词 / 分镜词不能为空')
        if (prompt.length > MAX_PROMPT) throw new HttpError(400, '提示词过长')
        const provider = body.provider === 'dreamina' ? 'dreamina' : 'xiaoyunque'
        const root = resolveRoot(body.workspaceId)
        const outDir = resolveDownloadDir(root, body.targetDir)
        await mkdir(outDir, { recursive: true })

        const assets = asList(body.assets, [])
        const item = {
          id: randomUUID(),
          kind: 'video',
          status: 'queued',
          stage: '排队中…',
          provider,
          prompt,
          model: String(body.model || '').trim(),
          ratio: String(body.ratio || '').trim() || settings.defaultRatio,
          seconds: asInt(body.seconds, settings.defaultDuration, 1, 60),
          assets,
          workspaceId: body.workspaceId ? String(body.workspaceId) : '',
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
        sendJson(res, 200, { ok: true, item })
        return
      }

      const cancelMatch = /^\/video\/([^/]+)\/cancel$/.exec(rest)
      if (cancelMatch && method === 'POST') {
        await store.ready
        const id = decodeURIComponent(cancelMatch[1])
        const running = live.get(id)
        if (running) running.controller.abort()
        const item = store.find(id)
        if (!item) throw new HttpError(404, '任务不存在')
        if (item.status === 'queued' || item.status === 'running') {
          store.update(id, { status: 'cancelled', stage: '', error: '已取消' })
        }
        sendJson(res, 200, { ok: true, item: store.find(id) })
        return
      }

      const downloadMatch = /^\/video\/([^/]+)\/download$/.exec(rest)
      if (downloadMatch && method === 'POST') {
        await store.ready
        const id = decodeURIComponent(downloadMatch[1])
        const item = store.find(id)
        if (!item) throw new HttpError(404, '任务不存在')
        if (!item.resultFile) throw new HttpError(409, '该任务还没有可下载的结果文件')
        const root = resolveRoot(item.workspaceId)
        const body = await readJson(req).catch(() => ({}))
        const destDir = resolveDownloadDir(root, body.targetDir || item.outDir)
        await mkdir(destDir, { recursive: true })
        const dest = path.join(destDir, path.basename(item.resultFile))
        if (path.resolve(dest) !== path.resolve(item.resultFile)) {
          await copyFile(item.resultFile, dest)
        }
        sendJson(res, 200, {
          ok: true,
          path: dest,
          name: path.basename(dest),
          size: (await stat(dest)).size,
        })
        return
      }

      const urlMatch = /^\/video\/([^/]+)\/download-url$/.exec(rest)
      if (urlMatch && method === 'POST') {
        await store.ready
        const id = decodeURIComponent(urlMatch[1])
        const item = store.find(id)
        if (!item) throw new HttpError(404, '任务不存在')
        const body = await readJson(req)
        const source = String(body.url || '').trim()
        if (!/^https?:\/\//i.test(source)) throw new HttpError(400, '下载地址无效')
        const root = resolveRoot(item.workspaceId)
        const destDir = resolveDownloadDir(root, body.targetDir || item.outDir)
        await mkdir(destDir, { recursive: true })
        const name = String(body.fileName || '').trim()
          || path.basename(new URL(source).pathname)
          || `${id}.mp4`
        const dest = path.join(destDir, path.basename(name))

        const response = await fetch(source, { redirect: 'follow' })
        if (!response.ok || !response.body) throw new HttpError(502, `下载失败：HTTP ${response.status}`)
        const declared = Number(response.headers.get('content-length') || 0)
        if (declared > MAX_DOWNLOAD_BYTES) throw new HttpError(413, '文件超过 2GB 限制')
        await new Promise((resolve, reject) => {
          const out = createWriteStream(dest)
          out.on('error', reject)
          out.on('finish', resolve)
          response.body.pipeTo(
            new WritableStream({
              write(chunk) {
                out.write(Buffer.from(chunk))
              },
              close() {
                out.end()
              },
              abort(error) {
                out.destroy(error)
                reject(error)
              },
            }),
          ).catch(reject)
        })
        store.update(id, { resultFile: dest, resultName: path.basename(dest), status: 'succeeded', error: '' })
        sendJson(res, 200, { ok: true, path: dest, name: path.basename(dest), size: (await stat(dest)).size })
        return
      }

      const itemMatch = /^\/video\/([^/]+)$/.exec(rest)
      if (itemMatch && method === 'GET') {
        await store.ready
        const item = store.find(decodeURIComponent(itemMatch[1]))
        if (!item) throw new HttpError(404, '任务不存在')
        sendJson(res, 200, { ok: true, item })
        return
      }

      throw new HttpError(404, '未知接口')
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500
      if (status === 500) {
        try {
          ctx.logger?.warn?.(`dsh-short-drama route failed: ${messageOf(error)}`)
        } catch {
          /* logging is best effort */
        }
      }
      sendJson(res, status, { ok: false, error: messageOf(error) })
    }
  }
}

/* -------------------------------------------------------------------- apply */

/** The browser carrier must exist before this half can mount its route. */
export const inject = ['webServer']

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
    downloadFolder: String(config.downloadFolder || DEFAULTS.downloadFolder),
    storyboardPreset: String(config.storyboardPreset || DEFAULTS.storyboardPreset),
    assetExtensions: asList(config.assetExtensions, ['.png', '.jpg', '.jpeg', '.webp', '.mp4', '.mov', '.mp3', '.wav']),
  }

  const home = process.env.DSH_HOME || path.join(homedir(), '.dsh')
  const store = createStore(path.join(home, 'short-drama', 'history.json'))
  const live = new Map()

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: createHandler(ctx, settings, store, live),
      }),
    'dsh-short-drama: routes',
  )

  // Declared last so the routes exist before any task can be resumed.
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
