/**
 * Host half of @local/dsh-short-drama.
 *
 * Exposes a Typert Remote namespace `shortDrama` to the Client:
 *  - config() / saveConfig()   preset rules, model, CLI commands, download folder
 *  - listAssets()              scan short-drama assets inside registered workspaces
 *  - generateStoryboard()      call Gemini (via ctx.llm, fallback to direct HTTP) using the preset rule
 *  - submitVideo()             run xiaoyunque / dreamina CLI with asset references
 *  - jobStatus() / listJobs()  poll submitted video jobs
 *  - downloadJob()             download the produced file into the workspace folder
 */

import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { Remote, TypertRemoteService, RemoteError } from '@deepseek-ai/dsh-typert-protocol'

const PKG = '@local/dsh-short-drama'
const NS = 'shortDrama'
const DEFAULT_PRESET = `你是一位资深短剧分镜师。请把剧本转换为分镜词列表。
输出 Markdown 表格，表头：镜头 | 景别 | 画面 | 台词 | 时长 | 资产 | 备注。只输出表格。`

const VIDEO_EXT = new Set(['.mp4', '.mov', '.webm', '.mkv', '.avi'])
const AUDIO_EXT = new Set(['.mp3', '.wav', '.m4a', '.aac', '.flac'])
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])

/** Apply @Remote as a standard method decorator in plain JS (no transpiler). */
function remoteAll(proto, names) {
  for (const name of names) {
    const method = proto[name]
    if (typeof method !== 'function') throw new Error(`dsh-short-drama: method ${name} is not a function`)
    Remote(method, {
      kind: 'method',
      name,
      private: false,
      static: false,
      // A real method decorator's addInitializer callback is invoked with the
      // instance as `this`; the protocol marks Object.getPrototypeOf(this).
      // Mimic an instance so the marker lands on `proto` itself.
      addInitializer(fn) { fn.call(Object.create(proto)) },
      metadata: {},
    })
  }
}

function asArray(value, fallback) {
  if (Array.isArray(value)) return value
  if (typeof value === 'string' && value.trim()) return value.split(/[,\s]+/).filter(Boolean)
  return fallback
}

function safeInt(value, fallback, min, max) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback
}

class ShortDramaService extends TypertRemoteService {
  static inject = ['typert', 'llm', 'subprocess', 'workingDirectory', 'workspaceRegistry', 'configEditor']
  static Config = null // schema-less: accept the free-form config from cordis.patch.yml

  constructor(ctx, config) {
    super(ctx, NS, { namespace: NS })
    this.cfg = { ...config }
    this.jobs = new Map()
    this.ledger = null

    // Run long jobs in the background; results are polled via jobStatus().
    ctx.effect(() => {
      for (const job of this.jobs.values()) {
        if (job.controller) job.controller.abort(new Error('plugin unloaded'))
      }
    }, 'dsh-short-drama: abort jobs on unload')

    // Load the persisted job ledger (best effort).
    let home = path.join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh')
    try {
      const candidate = ctx.get('dshHomePath')
      if (typeof candidate === 'string' && candidate) home = candidate
    } catch { /* optional service */ }
    this.ledgerPath = path.join(home, 'dsh-short-drama-jobs.json')
    void this.restoreLedger()
  }

  // ---- persistence -------------------------------------------------------

  async restoreLedger() {
    try {
      const fs = await import('node:fs/promises')
      const raw = JSON.parse(await fs.readFile(this.ledgerPath, 'utf8'))
      if (Array.isArray(raw)) for (const j of raw) {
        if (!j || !j.id) continue
        // A process restart cannot resume a CLI it did not start: never restore
        // a job as "running" with no controller (it would poll forever).
        if (j.status === 'running' || j.status === 'queued') j.status = 'failed'
        if (j.status === 'failed' && !j.error) j.error = '进程重启，任务中断；请重新提交。'
        this.jobs.set(j.id, { ...j, controller: null })
      }
    } catch { /* ignore a broken ledger */ }
  }

  saveLedger() {
    const plain = [...this.jobs.values()].map(({ controller, ...job }) => job)
    writeFile(this.ledgerPath, JSON.stringify(plain, null, 2), 'utf8').catch(() => {})
  }

  // ---- helpers -----------------------------------------------------------

  configView() {
    const c = this.cfg
    return {
      geminiProvider: c.geminiProvider || 'google',
      geminiModel: c.geminiModel || 'gemini-2.5-pro',
      geminiApiKeyRef: c.geminiApiKeyRef || 'GEMINI_API_KEY',
      geminiTemperature: Number(c.geminiTemperature ?? 0.7),
      storyboardPreset: c.storyboardPreset || DEFAULT_PRESET,
      xiaoyunqueCommand: c.xiaoyunqueCommand || 'xiaoyunque',
      dreaminaCommand: c.dreaminaCommand || 'dreamina',
      assetExtensions: asArray(c.assetExtensions, ['.png', '.jpg', '.jpeg', '.webp', '.mp4', '.mov', '.mp3', '.wav']),
      defaultRatio: c.defaultRatio || '9:16',
      defaultDuration: safeInt(c.defaultDuration, 5, 1, 60),
      downloadFolder: c.downloadFolder || 'generated-videos',
      workspaces: (this.ctx.workspaceRegistry?.list() || []).map(w => ({ id: String(w.id), path: w.path, title: w.title || path.basename(w.path) })),
    }
  }

  async workspaceRoot(workspaceId) {
    if (workspaceId) {
      const ws = this.ctx.workspaceRegistry?.get?.(workspaceId)
      if (ws) return ws.path
      const byPath = await this.ctx.workspaceRegistry?.resolveByPath?.(workspaceId).catch(() => undefined)
      if (byPath) return byPath.path
    }
    const agent = this.ctx.agents?.currentInitiator?.()
    if (agent) return this.ctx.workingDirectory.get(agent.session)
    const list = this.ctx.workspaceRegistry?.list() || []
    if (list.length) return list[0].path
    return this.ctx.workingDirectory.defaultDirectory
  }

  async geminiComplete(system, userText, signal) {
    const provider = this.cfg.geminiProvider || 'google'
    const model = this.cfg.geminiModel || 'gemini-2.5-pro'
    const temperature = Number(this.cfg.geminiTemperature ?? 0.7)

    // Preferred: DSH's LLM service (uses configured google/Gemini provider).
    if (this.ctx.llm && provider) {
      try {
        let text = ''
        for await (const chunk of this.ctx.llm.stream({
          provider, model, system,
          messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
          temperature,
          ...(signal ? { signal } : {}),
        })) {
          if (chunk.type === 'text-delta') text += chunk.text
          else if (chunk.type === 'finish' && chunk.reason && ['error', 'aborted'].includes(chunk.reason.kind)) {
            throw new Error(chunk.reason.failure?.message || `LLM ${chunk.reason.kind}`)
          }
        }
        if (text.trim()) return text
      } catch (err) {
        // Fall through to direct Gemini HTTP only when the LLM route is unavailable.
        if (signal?.aborted) throw err
        this.lastLlmError = err instanceof Error ? err.message : String(err)
      }
    }

    // Fallback: direct Gemini HTTP using a stored credential reference.
    let apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
    const refName = this.cfg.geminiApiKeyRef || 'GEMINI_API_KEY'
    if (!apiKey && this.ctx.credentials) {
      try {
        const { credentialRef } = await import('@deepseek-ai/dsh-credentials')
        const hit = await this.ctx.credentials.resolve(credentialRef(refName))
        apiKey = hit?.value
      } catch { /* optional */ }
    }
    if (!apiKey) {
      throw new RemoteError('shortDrama/no-gemini-key', `未找到 Gemini 凭据：请在设置中配置 google/Gemini 供应商，或设置环境变量/凭据 ${refName}。${this.lastLlmError ? ' LLM 错误：' + this.lastLlmError : ''}`, { ref: refName })
    }
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: userText }] }],
        generationConfig: { temperature },
      }),
      ...(signal ? { signal } : {}),
    })
    if (!res.ok) throw new RemoteError('shortDrama/gemini-http', `Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`, { status: res.status })
    const body = await res.json()
    return (body.candidates?.[0]?.content?.parts || []).filter(p => typeof p.text === 'string').map(p => p.text).join('')
  }

  // ---- Remote methods ----------------------------------------------------

  config() {
    return this.configView()
  }

  async saveConfig(patch) {
    const editor = this.ctx.get('configEditor')
    const entry = this.ctx.fiber?.entry
    if (!editor || entry === undefined) throw new RemoteError('shortDrama/config-unavailable', '当前配置不可写（缺少 configEditor）', {})
    const allowed = ['geminiProvider', 'geminiModel', 'geminiApiKeyRef', 'geminiTemperature', 'storyboardPreset', 'xiaoyunqueCommand', 'dreaminaCommand', 'assetExtensions', 'defaultRatio', 'defaultDuration', 'downloadFolder']
    const change = { ...this.cfg }
    for (const key of allowed) if (patch && Object.prototype.hasOwnProperty.call(patch, key)) change[key] = patch[key]
    try {
      await editor.edit(entry, () => change)
      this.cfg = change
      return { ok: true, config: this.configView() }
    } catch (err) {
      throw new RemoteError('shortDrama/config-write-failed', err instanceof Error ? err.message : String(err), {})
    }
  }

  async listAssets(workspaceId) {
    const root = await this.workspaceRoot(workspaceId)
    const exts = new Set(asArray(this.cfg.assetExtensions, ['.png', '.jpg', '.jpeg', '.webp', '.mp4', '.mov', '.mp3', '.wav']).map(e => String(e).toLowerCase()))
    const assets = []
    const MAX = 500

    async function walk(dir, depth) {
      if (depth > 4 || assets.length >= MAX) return
      let entries
      try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
      for (const ent of entries) {
        if (assets.length >= MAX) break
        if (ent.name === 'node_modules' || ent.name === '.git' || ent.name.startsWith('.')) continue
        const full = path.join(dir, ent.name)
        if (ent.isDirectory()) {
          await walk(full, depth + 1)
        } else if (ent.isFile() && exts.has(path.extname(ent.name).toLowerCase())) {
          let size = 0
          try { size = (await stat(full)).size } catch { /* ignore */ }
          const ext = path.extname(ent.name).toLowerCase()
          assets.push({
            path: full,
            name: ent.name,
            relative: path.relative(root, full),
            type: VIDEO_EXT.has(ext) ? 'video' : AUDIO_EXT.has(ext) ? 'audio' : IMAGE_EXT.has(ext) ? 'image' : 'other',
            size,
          })
        }
      }
    }
    await walk(root, 0)
    return { ok: true, root, assets, truncated: assets.length >= MAX }
  }

  async generateStoryboard(script, preset, signal) {
    const text = String(script || '').trim()
    if (!text) throw new RemoteError('shortDrama/empty-script', '剧本内容为空', {})
    const rule = typeof preset === 'string' && preset.trim() ? preset : (this.cfg.storyboardPreset || DEFAULT_PRESET)
    const storyboard = await this.geminiComplete(rule, text, signal)
    return { ok: true, storyboard, preset: rule, model: this.cfg.geminiModel || 'gemini-2.5-pro' }
  }

  async submitVideo(request, signal) {
    const { provider = 'xiaoyunque', prompt = '', assets = [], ratio, duration, model, extraArgs = [], workspaceId } = request || {}
    if (!['xiaoyunque', 'dreamina'].includes(provider)) throw new RemoteError('shortDrama/bad-provider', '未知的视频供应商', { provider })
    if (!String(prompt).trim()) throw new RemoteError('shortDrama/empty-prompt', '分镜词/提示词为空', {})

    const command = provider === 'xiaoyunque' ? (this.cfg.xiaoyunqueCommand || 'xiaoyunque') : (this.cfg.dreaminaCommand || 'dreamina')
    const root = await this.workspaceRoot(workspaceId)
    const outDir = path.isAbsolute(this.cfg.downloadFolder || '') ? this.cfg.downloadFolder : path.join(root, this.cfg.downloadFolder || 'generated-videos')
    await mkdir(outDir, { recursive: true })

    const args = [
      ...(provider === 'xiaoyunque' ? ['generate'] : ['generate']),
      '--prompt', String(prompt),
      '--ratio', ratio || this.cfg.defaultRatio || '9:16',
      '--duration', String(duration || this.cfg.defaultDuration || 5),
      '--output', outDir,
      ...(model ? ['--model', String(model)] : []),
      ...asArray(extraArgs, []).map(String),
    ]
    for (const asset of asArray(assets, [])) {
      const p = typeof asset === 'string' ? asset : asset?.path
      if (p) args.push('--asset', String(p))
    }

    const id = randomUUID()
    const job = {
      id, provider, status: 'running', prompt: String(prompt).slice(0, 400),
      command, args, cwd: root, outDir, workspaceId: workspaceId || null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      stdout: '', stderr: '', exitCode: null, resultPath: null, error: null,
      controller: new AbortController(),
    }
    this.jobs.set(id, job)
    this.saveLedger()

    // Run asynchronously; poll with jobStatus().
    const runSignal = job.controller.signal
    const linked = signal ? AbortSignal.any([runSignal, signal]) : runSignal
    void this.runCliJob(job, linked)

    return { ok: true, jobId: id, status: 'running', command, args }
  }

  async runCliJob(job, signal) {
    try {
      const program = await this.ctx.subprocess.resolveExecutable(job.command, undefined, signal)
      const handle = this.ctx.subprocess.spawn({
        argv: [program, ...job.args],
        cwd: job.cwd,
        graceMs: 5000,
        ...(signal ? { signal } : {}),
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: 200_000, spill: { maxBytes: 8 * 1024 * 1024 } },
          stderr: { maxBytes: 200_000 },
        },
      })
      const outcome = await handle.done
      const out = handle.collected.stdout?.readFrom(0)
      const err = handle.collected.stderr?.readFrom(0)
      job.stdout = out?.text || ''
      job.stderr = err?.text || ''
      job.exitCode = outcome.exitCode
      if (outcome.exitCode !== 0) {
        job.status = 'failed'
        job.error = (job.stderr || job.stdout).trim().slice(-500) || `CLI 退出码 ${outcome.exitCode}`
      } else {
        // Find the newest video file in outDir as the produced result.
        const produced = await this.newestVideo(job.outDir)
        job.resultPath = produced
        job.status = produced ? 'succeeded' : 'completed'
      }
    } catch (err) {
      job.status = signal?.aborted ? 'cancelled' : 'failed'
      job.error = err instanceof Error ? err.message : String(err)
    } finally {
      job.updatedAt = new Date().toISOString()
      if (job.controller) job.controller = null
      this.saveLedger()
    }
  }

  async newestVideo(dir) {
    try {
      const entries = await readdir(dir, { withFileTypes: true })
      const videos = entries.filter(e => e.isFile() && VIDEO_EXT.has(path.extname(e.name).toLowerCase()))
      if (!videos.length) return null
      let best = null
      let bestTime = 0
      for (const v of videos) {
        const full = path.join(dir, v.name)
        const s = await stat(full)
        if (s.mtimeMs > bestTime) { bestTime = s.mtimeMs; best = full }
      }
      return best
    } catch { return null }
  }

  jobStatus(jobId) {
    const job = this.jobs.get(String(jobId))
    if (!job) throw new RemoteError('shortDrama/unknown-job', '未知的任务', { jobId })
    const { controller, ...view } = job
    return { ok: true, job: view }
  }

  listJobs() {
    const jobs = [...this.jobs.values()].map(({ controller, ...job }) => job)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    return { ok: true, jobs }
  }

  cancelJob(jobId) {
    const job = this.jobs.get(String(jobId))
    if (!job) throw new RemoteError('shortDrama/unknown-job', '未知的任务', { jobId })
    if (job.controller) { job.controller.abort(new Error('cancelled by user')); job.status = 'cancelled' }
    return { ok: true }
  }

  async downloadJob(jobId, targetDir) {
    const job = this.jobs.get(String(jobId))
    if (!job) throw new RemoteError('shortDrama/unknown-job', '未知的任务', { jobId })
    if (!job.resultPath) throw new RemoteError('shortDrama/no-result', '该任务没有可下载的结果文件', { jobId })

    const destDir = targetDir && String(targetDir).trim()
      ? path.isAbsolute(String(targetDir)) ? String(targetDir) : path.join(await this.workspaceRoot(job.workspaceId), String(targetDir))
      : job.outDir
    await mkdir(destDir, { recursive: true })
    const dest = path.join(destDir, path.basename(job.resultPath))
    const { copyFile } = await import('node:fs/promises')
    await copyFile(job.resultPath, dest)
    return { ok: true, path: dest, name: path.basename(dest), size: (await stat(dest)).size }
  }

  /** Download an arbitrary URL (e.g. a CLI-returned remote link) into the workspace. */
  async downloadUrl(url, fileName, workspaceId, targetDir) {
    const u = String(url || '').trim()
    if (!/^https?:\/\//i.test(u)) throw new RemoteError('shortDrama/bad-url', '下载地址无效', { url })
    const root = await this.workspaceRoot(workspaceId)
    const destDir = targetDir && String(targetDir).trim()
      ? path.isAbsolute(String(targetDir)) ? String(targetDir) : path.join(root, String(targetDir))
      : path.join(root, this.cfg.downloadFolder || 'generated-videos')
    await mkdir(destDir, { recursive: true })
    const name = (fileName && String(fileName).trim()) || path.basename(new URL(u).pathname) || `video-${randomUUID()}.mp4`
    const dest = path.join(destDir, path.basename(name))
    const res = await fetch(u, { redirect: 'follow' })
    if (!res.ok || !res.body) throw new RemoteError('shortDrama/download-failed', `下载失败：HTTP ${res.status}`, { status: res.status })
    const declared = Number(res.headers.get('content-length') || 0)
    const MAX = 2 * 1024 * 1024 * 1024
    if (declared > MAX) throw new RemoteError('shortDrama/file-too-large', '文件超过 2GB 限制', {})
    const { pipeline } = await import('node:stream/promises')
    const { Readable } = await import('node:stream')
    await pipeline(Readable.fromWeb(res.body), createWriteStream(dest))
    return { ok: true, path: dest, name: path.basename(dest), size: (await stat(dest)).size }
  }
}

// Mark the Remote methods (plain-JS equivalent of the @Remote decorators).
remoteAll(ShortDramaService.prototype, [
  'config', 'saveConfig', 'listAssets', 'generateStoryboard', 'submitVideo',
  'jobStatus', 'listJobs', 'cancelJob', 'downloadJob', 'downloadUrl',
])

export default ShortDramaService
