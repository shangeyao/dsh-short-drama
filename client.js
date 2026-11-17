/**
 * Client half of `dsh-short-drama`（短剧工坊）.
 *
 * Registers one sidebar panel entry (`sidebar.panellist`) plus the page it opens
 * (`main`). The page only submits tasks and reads Host history: every generation
 * runs in the Host process, so switching panels, reloading, or closing the page
 * never loses a queued or finished result.
 */
window.__ModuleLoader__.load({
  id: 'dsh-short-drama',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback } = React

    const PANEL_ID = 'short-drama'
    const NS = 'dsh-short-drama'
    const API = '/short-drama/api'

    const ZH = {
      'panel.title': '短剧工坊',
      'panel.subtitle': '把剧本变成分镜词，再交给小云雀 / Dreamina 出片；任务在宿主后台运行，离开页面也不会中断',
      'tab.storyboard': '分镜词',
      'tab.video': '视频任务',
      'tab.settings': '设置',
      'model.label': 'Gemini 模型',
      'field.script': '剧本',
      'placeholder.script': '粘贴短剧剧本……',
      'field.preset': '分镜词规则（可自定义）',
      'action.generate': '生成分镜词',
      'action.regenerate': '重新生成',
      'action.copy': '复制',
      'action.copied': '已复制',
      'action.refresh': '重新检测',
      'storyboard.title': '分镜词结果',
      'storyboard.empty': '还没有分镜词',
      'storyboard.emptyHint': '左侧粘贴剧本后点「生成分镜词」，结果会自动带入视频任务。',
      'status.key.ok': 'Key 已就绪',
      'status.key.missing': 'Key 未配置',
      'status.hint': '请到「设置 → 模型 → google」填写 Gemini API Key，或在 DSH 凭据中新增 {env}。',
      'field.provider': '供应商',
      'field.prompt': '提示词 / 分镜词',
      'placeholder.prompt': '描述镜头：主体、动作、运镜、光线、氛围……',
      'field.ratio': '比例',
      'field.seconds': '时长（秒）',
      'field.model': '模型（可选）',
      'field.assets': '关联资产',
      'field.target': '下载到',
      'placeholder.target': '默认下载文件夹',
      'action.submit': '提交视频生成',
      'action.submitting': '提交中…',
      'assets.title': '工作区资产',
      'assets.empty': '当前工作区未发现资产。',
      'assets.truncated': '资产过多，仅显示前若干项。',
      'assets.selectWorkspace': '工作区',
      'assets.clear': '清空选择',
      'assets.selected': '已选',
      'history.title': '任务历史',
      'history.empty': '还没有任务',
      'history.emptyHint': '写好分镜词后提交，任务会在后台排队执行。',
      'action.download': '下载',
      'action.cancel': '取消',
      'action.delete': '删除',
      'action.openNew': '新窗口打开',
      'action.refreshList': '刷新',
      'status.queued': '排队中',
      'status.running': '生成中',
      'status.succeeded': '已完成',
      'status.completed': '已完成',
      'status.failed': '失败',
      'status.cancelled': '已取消',
      'error.title': '出错了',
      'error.emptyScript': '请先填写剧本。',
      'error.emptyPrompt': '请先填写提示词 / 分镜词。',
      'settings.model': 'Gemini 模型',
      'settings.apiKeyEnv': 'API Key 环境变量 / 凭据名',
      'settings.preset': '默认分镜词规则',
      'settings.xiaoyunque': '小云雀 CLI 命令',
      'settings.dreamina': 'Dreamina CLI 命令',
      'settings.ratio': '默认比例',
      'settings.seconds': '默认时长（秒）',
      'settings.folder': '默认下载文件夹',
      'settings.note': '以上为插件配置项的只读展示；修改请编辑 profile 的 cordis.patch.yml 中 dsh-short-drama 行。',
      'meta.downloaded': '已下载到',
    }

    const EN = {
      'panel.title': 'Short Drama Studio',
      'panel.subtitle': 'Turn a script into storyboard panels, then render video with the Xiaoyunque or Dreamina CLI. Tasks run in the Host, so leaving the page never interrupts them.',
      'tab.storyboard': 'Storyboard',
      'tab.video': 'Video tasks',
      'tab.settings': 'Settings',
      'model.label': 'Gemini model',
      'field.script': 'Script',
      'placeholder.script': 'Paste your short-drama script…',
      'field.preset': 'Storyboard rules (editable)',
      'action.generate': 'Generate storyboard',
      'action.regenerate': 'Regenerate',
      'action.copy': 'Copy',
      'action.copied': 'Copied',
      'action.refresh': 'Recheck',
      'storyboard.title': 'Storyboard result',
      'storyboard.empty': 'No storyboard yet',
      'storyboard.emptyHint': 'Paste a script on the left and choose Generate storyboard; the result carries into the video task.',
      'status.key.ok': 'Key ready',
      'status.key.missing': 'Key missing',
      'status.hint': 'Add a Gemini API key under Settings → Models → google, or create the {env} credential in DSH.',
      'field.provider': 'Provider',
      'field.prompt': 'Prompt / storyboard',
      'placeholder.prompt': 'Describe the shot: subject, action, camera, light, mood…',
      'field.ratio': 'Ratio',
      'field.seconds': 'Seconds',
      'field.model': 'Model (optional)',
      'field.assets': 'Linked assets',
      'field.target': 'Download to',
      'placeholder.target': 'Default download folder',
      'action.submit': 'Submit video',
      'action.submitting': 'Submitting…',
      'assets.title': 'Workspace assets',
      'assets.empty': 'No assets found in this workspace.',
      'assets.truncated': 'Too many assets; showing the first ones.',
      'assets.selectWorkspace': 'Workspace',
      'assets.clear': 'Clear selection',
      'assets.selected': 'Selected',
      'history.title': 'Task history',
      'history.empty': 'No tasks yet',
      'history.emptyHint': 'Submit a storyboard and the task queues in the background.',
      'action.download': 'Download',
      'action.cancel': 'Cancel',
      'action.delete': 'Delete',
      'action.openNew': 'Open in new tab',
      'action.refreshList': 'Refresh',
      'status.queued': 'Queued',
      'status.running': 'Running',
      'status.succeeded': 'Done',
      'status.completed': 'Done',
      'status.failed': 'Failed',
      'status.cancelled': 'Cancelled',
      'error.title': 'Something went wrong',
      'error.emptyScript': 'Please write the script first.',
      'error.emptyPrompt': 'Please write the prompt first.',
      'settings.model': 'Gemini model',
      'settings.apiKeyEnv': 'API key env / credential name',
      'settings.preset': 'Default storyboard rules',
      'settings.xiaoyunque': 'Xiaoyunque CLI command',
      'settings.dreamina': 'Dreamina CLI command',
      'settings.ratio': 'Default ratio',
      'settings.seconds': 'Default seconds',
      'settings.folder': 'Default download folder',
      'settings.note': 'These values are read-only here; edit the dsh-short-drama row in the profile cordis.patch.yml to change them.',
      'meta.downloaded': 'Downloaded to',
    }

    /* ---------------------------------------------------------------- styles */

    const STYLES = `
      .sd-root{display:flex;flex-direction:column;height:100%;min-height:480px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family,inherit);overflow:hidden;--sd-accent:#2563eb;--sd-accent-strong:#1d4ed8;--sd-accent-soft:rgba(37,99,235,.10);--sd-accent-line:rgba(37,99,235,.45)}
      .sd-scroll{flex:1;min-height:0;overflow:auto;padding:26px 30px 40px}
      .sd-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:18px}
      .sd-title{font-size:20px;font-weight:600;letter-spacing:.01em;line-height:1.25}
      .sd-sub{font-size:12.5px;color:var(--dsw-alias-label-secondary);margin-top:5px;line-height:1.5;max-width:700px}
      .sd-badges{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}
      .sd-chip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:999px;padding:4px 10px;font-size:11.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
      .sd-dot{width:7px;height:7px;border-radius:50%;background:#9ca3af;flex:none}
      .sd-dot[data-ok="true"]{background:#22c55e}
      .sd-dot[data-ok="false"]{background:#ef4444}
      .sd-tabs{display:inline-flex;gap:2px;background:transparent;border:0;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.35));padding:0;margin-bottom:14px}
      .sd-tab{border:0;border-bottom:2px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary,#9ca3af);padding:7px 16px;cursor:pointer;font:inherit;font-size:12.5px;line-height:1.4;margin-bottom:-1px}
      .sd-tab[data-active="true"]{color:var(--dsw-alias-label-primary,inherit);font-weight:600;border-bottom-color:var(--sd-accent)}
      .sd-grid{display:grid;grid-template-columns:minmax(320px,460px) minmax(0,1fr);gap:18px;align-items:start}
      @media (max-width:900px){.sd-grid{grid-template-columns:1fr}}
      .sd-card{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:14px;padding:16px;box-sizing:border-box}
      .sd-card+.sd-card{margin-top:14px}
      .sd-label{display:block;font-size:11.5px;color:var(--dsw-alias-label-secondary);margin:0 0 6px}
      .sd-model{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:12px;color:var(--dsw-alias-label-secondary);padding:7px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-base);margin-bottom:12px}
      .sd-model b{font-weight:600;color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11.5px}
      .sd-textarea{width:100%;box-sizing:border-box;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px 12px;font:inherit;font-size:13px;line-height:1.55;outline:none;resize:vertical}
      .sd-textarea:focus{border-color:var(--sd-accent)}
      .sd-input,.sd-select{width:100%;box-sizing:border-box;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:8px 10px;font:inherit;font-size:12.5px;outline:none}
      .sd-input:focus,.sd-select:focus{border-color:var(--sd-accent)}
      .sd-row{display:flex;gap:10px}
      .sd-row>*{flex:1;min-width:0}
      .sd-field{margin-top:12px}
      .sd-actions{display:flex;gap:8px;margin-top:14px;flex-wrap:wrap}
      .sd-button{display:inline-flex;align-items:center;justify-content:center;gap:6px;border-radius:9px;padding:8px 14px;font:inherit;font-size:12.5px;cursor:pointer;border:1px solid transparent;white-space:nowrap;text-decoration:none}
      .sd-button:disabled{opacity:.55;cursor:default}
      .sd-primary{background:var(--sd-accent);color:#fff;border-color:var(--sd-accent);font-weight:600}
      .sd-primary:hover:not(:disabled){background:var(--sd-accent-strong);border-color:var(--sd-accent-strong)}
      .sd-ghost{border-color:var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-primary)}
      .sd-ghost:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
      .sd-error{display:flex;gap:8px;align-items:flex-start;border:1px solid rgba(239,68,68,.55);background:rgba(239,68,68,.08);color:#ef4444;border-radius:10px;padding:9px 12px;font-size:12.5px;line-height:1.5;margin-top:12px;word-break:break-word}
      .sd-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;min-height:220px;color:var(--dsw-alias-label-secondary);border:1px dashed var(--dsw-alias-border-l1);border-radius:12px;text-align:center;padding:24px;font-size:12.5px}
      .sd-empty b{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600}
      .sd-board{margin:0;white-space:pre-wrap;word-break:break-word;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:12px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;line-height:1.6;max-height:min(56vh,520px);overflow:auto}
      .sd-assets{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;max-height:190px;overflow:auto}
      .sd-pill{font-size:10.5px;padding:3px 9px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-family:inherit;max-width:230px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .sd-pill:hover{color:var(--dsw-alias-label-primary)}
      .sd-pill[data-active="true"]{border-color:var(--sd-accent);color:var(--sd-accent);background:var(--sd-accent-soft)}
      .sd-assets-meta{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
      .sd-history{display:flex;flex-direction:column;gap:8px;margin-top:10px}
      .sd-item{display:flex;gap:10px;align-items:flex-start;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px 12px;background:var(--dsw-alias-bg-base)}
      .sd-item-body{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:5px}
      .sd-item-head{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:11.5px;color:var(--dsw-alias-label-secondary)}
      .sd-item-prompt{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-primary);white-space:pre-wrap;word-break:break-word;max-height:56px;overflow:hidden}
      .sd-item-error{font-size:11.5px;color:#ef4444;line-height:1.5;word-break:break-word}
      .sd-badge{display:inline-flex;align-items:center;gap:5px;padding:1px 8px;border-radius:999px;font-size:10.5px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary)}
      .sd-badge[data-status="succeeded"],.sd-badge[data-status="completed"]{border-color:rgba(34,197,94,.6);color:#22c55e}
      .sd-badge[data-status="failed"]{border-color:rgba(239,68,68,.6);color:#ef4444}
      .sd-badge[data-status="running"]{border-color:var(--sd-accent-line);color:var(--sd-accent)}
      .sd-badge[data-status="cancelled"]{border-color:rgba(148,163,184,.6);color:var(--dsw-alias-label-secondary)}
      .sd-mini{font-size:10.5px;padding:3px 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-family:inherit;white-space:nowrap}
      .sd-mini:hover{color:var(--dsw-alias-label-primary)}
      .sd-progress{height:5px;border-radius:999px;background:rgba(127,127,127,.22);overflow:hidden;margin-top:6px}
      .sd-progress>i{display:block;height:100%;width:40%;background:var(--sd-accent);animation:sd-slide 1.3s ease-in-out infinite}
      @keyframes sd-slide{0%{margin-left:-40%}100%{margin-left:100%}}
      .sd-mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;word-break:break-all}
      .sd-settings-row{display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:12px}
      .sd-settings-row:last-child{border-bottom:0}
      .sd-settings-row>span:first-child{color:var(--dsw-alias-label-secondary);flex:none}
      .sd-settings-row>b{font-weight:500;text-align:right;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11.5px}
    `

    /* --------------------------------------------------------------- helpers */

    async function readJsonResponse(response) {
      let data = null
      try {
        data = await response.json()
      } catch {
        data = null
      }
      if (!response.ok || (data && data.ok === false)) {
        const error = new Error(data && data.error ? String(data.error) : `HTTP ${response.status}`)
        error.status = response.status
        throw error
      }
      return data || {}
    }

    async function getJson(path) {
      const response = await fetch(`${API}${path}`, { cache: 'no-store' })
      return readJsonResponse(response)
    }

    async function postJson(path, body) {
      const response = await fetch(`${API}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
      })
      return readJsonResponse(response)
    }

    function Icon(props) {
      const size = props && props.size ? props.size : 16
      const active = Boolean(props && props.active)
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: active ? 2 : 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          style: { display: 'block', flex: 'none' },
        },
        h('rect', { x: 2.5, y: 4.5, width: 19, height: 15, rx: 3 }),
        h('path', { d: 'M2.5 9h19' }),
        h('path', { d: 'M7 4.5 9.5 9M14.5 4.5 17 9' }),
        h('path', { d: 'M10.2 12.4v4.8l4.4-2.4z', fill: 'currentColor', stroke: 'none' }),
      )
    }

    function statusKey(status) {
      if (status === 'queued') return 'status.queued'
      if (status === 'running') return 'status.running'
      if (status === 'succeeded') return 'status.succeeded'
      if (status === 'completed') return 'status.completed'
      if (status === 'cancelled') return 'status.cancelled'
      return 'status.failed'
    }

    function formatTime(value) {
      if (!value) return ''
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return ''
      return date.toLocaleString()
    }

    function assetGlyph(type) {
      if (type === 'image') return '🖼'
      if (type === 'video') return '🎬'
      if (type === 'audio') return '🔊'
      return '📄'
    }

    /* ------------------------------------------------------------- boundaries */

    /** Keeps one view's render failure from blanking the whole panel. */
    class ViewBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { failed: false }
      }

      static getDerivedStateFromError() {
        return { failed: true }
      }

      render() {
        if (this.state.failed) {
          return h('div', { className: 'sd-empty' }, h('b', null, '视图渲染失败'), '刷新页面后重试。')
        }
        return this.props.children
      }
    }

    /* -------------------------------------------------------------------- page */

    function Page(props) {
      const t = props.t
      const [tab, setTab] = useState('storyboard')
      const [status, setStatus] = useState(null)
      const [statusError, setStatusError] = useState('')

      const [script, setScript] = useState('')
      const [preset, setPreset] = useState('')
      const [storyboard, setStoryboard] = useState('')
      const [generating, setGenerating] = useState(false)

      const [provider, setProvider] = useState('xiaoyunque')
      const [prompt, setPrompt] = useState('')
      const [ratio, setRatio] = useState('9:16')
      const [seconds, setSeconds] = useState(5)
      const [model, setModel] = useState('')
      const [targetDir, setTargetDir] = useState('')
      const [submitting, setSubmitting] = useState(false)

      const [workspaceId, setWorkspaceId] = useState('')
      const [assets, setAssets] = useState([])
      const [assetsTruncated, setAssetsTruncated] = useState(false)
      const [selected, setSelected] = useState([])

      const [items, setItems] = useState([])
      const [error, setError] = useState('')
      const [note, setNote] = useState('')
      const [refreshTick, setRefreshTick] = useState(0)
      const [busyId, setBusyId] = useState('')

      /* ---- status ---- */
      useEffect(() => {
        let alive = true
        void (async () => {
          try {
            const data = await getJson('/status')
            if (!alive) return
            setStatus(data)
            setStatusError('')
            if (!preset && data.storyboardPreset) setPreset(data.storyboardPreset)
            if (data.defaultRatio) setRatio((value) => (value === '9:16' ? data.defaultRatio : value))
            if (data.defaultDuration) setSeconds((value) => (value === 5 ? data.defaultDuration : value))
            if (!workspaceId && Array.isArray(data.workspaces) && data.workspaces.length > 0) {
              setWorkspaceId(data.workspaces[0].id)
            }
          } catch (caught) {
            if (!alive) return
            setStatusError(caught instanceof Error ? caught.message : String(caught))
          }
        })()
        return () => {
          alive = false
        }
      }, [refreshTick])

      /* ---- assets ---- */
      useEffect(() => {
        let alive = true
        void (async () => {
          try {
            const query = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ''
            const data = await getJson(`/assets${query}`)
            if (!alive) return
            setAssets(Array.isArray(data.assets) ? data.assets : [])
            setAssetsTruncated(Boolean(data.truncated))
          } catch (caught) {
            if (!alive) return
            setAssets([])
            setStatusError(caught instanceof Error ? caught.message : String(caught))
          }
        })()
        return () => {
          alive = false
        }
      }, [workspaceId, refreshTick])

      /* ---- history + polling ---- */
      const loadHistory = useCallback(async () => {
        try {
          const data = await getJson('/history')
          setItems(Array.isArray(data.items) ? data.items : [])
        } catch {
          /* the next tick retries */
        }
      }, [])

      useEffect(() => {
        void loadHistory()
      }, [loadHistory, refreshTick])

      const active = items.some((item) => item.status === 'queued' || item.status === 'running')
      useEffect(() => {
        if (!active) return undefined
        const timer = setInterval(() => {
          void loadHistory()
        }, 2500)
        return () => clearInterval(timer)
      }, [active, loadHistory])

      /* ---- actions ---- */
      const onGenerate = useCallback(async () => {
        setError('')
        setNote('')
        if (!script.trim()) {
          setError(t('error.emptyScript'))
          return
        }
        setGenerating(true)
        try {
          const data = await postJson('/storyboard', { script, preset, model: model.trim() || undefined })
          const text = String(data.storyboard || '')
          setStoryboard(text)
          // Carry the result into the video task so the next step is one click.
          setPrompt((current) => (current.trim() ? current : text))
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : String(caught))
        } finally {
          setGenerating(false)
        }
      }, [script, preset, model, t])

      const onSubmit = useCallback(async () => {
        setError('')
        setNote('')
        const body = (prompt.trim() || storyboard.trim())
        if (!body) {
          setError(t('error.emptyPrompt'))
          return
        }
        setSubmitting(true)
        try {
          await postJson('/video', {
            provider,
            prompt: body,
            ratio,
            seconds: Number(seconds) || 5,
            model: model.trim() || undefined,
            assets: selected,
            workspaceId: workspaceId || undefined,
            targetDir: targetDir.trim() || undefined,
          })
          await loadHistory()
          setTab('video')
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : String(caught))
        } finally {
          setSubmitting(false)
        }
      }, [prompt, storyboard, provider, ratio, seconds, model, selected, workspaceId, targetDir, loadHistory, t])

      const onCancel = useCallback(async (id) => {
        setBusyId(id)
        try {
          await postJson(`/video/${encodeURIComponent(id)}/cancel`, {})
          await loadHistory()
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : String(caught))
        } finally {
          setBusyId('')
        }
      }, [loadHistory])

      const onDownload = useCallback(async (item) => {
        setBusyId(item.id)
        try {
          const data = await postJson(`/video/${encodeURIComponent(item.id)}/download`, { targetDir: targetDir.trim() || undefined })
          setNote(`${t('meta.downloaded')} ${data.path}`)
          await loadHistory()
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : String(caught))
        } finally {
          setBusyId('')
        }
      }, [targetDir, loadHistory, t])

      const onDelete = useCallback(async (id) => {
        setBusyId(id)
        try {
          await postJson('/history/delete', { id })
          await loadHistory()
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : String(caught))
        } finally {
          setBusyId('')
        }
      }, [loadHistory])

      const onCopy = useCallback(async () => {
        try {
          await navigator.clipboard.writeText(storyboard)
          setNote(t('action.copied'))
        } catch {
          setNote('')
        }
      }, [storyboard, t])

      const toggleAsset = useCallback((assetPath) => {
        setSelected((current) => (
          current.includes(assetPath)
            ? current.filter((value) => value !== assetPath)
            : [...current, assetPath]
        ))
      }, [])

      /* ---- render ---- */
      const configured = Boolean(status && status.configured)
      const modelLabel = status ? status.model : ''
      const workspaces = status && Array.isArray(status.workspaces) ? status.workspaces : []

      function renderBadges() {
        return h(
          'div',
          { className: 'sd-badges' },
          h(
            'span',
            { className: 'sd-chip' },
            h('i', { className: 'sd-dot', 'data-ok': configured ? 'true' : 'false' }),
            configured ? t('status.key.ok') : t('status.key.missing'),
            status && status.source ? ` · ${status.source}` : '',
          ),
          modelLabel ? h('span', { className: 'sd-chip sd-mono' }, modelLabel) : null,
          h(
            'button',
            { type: 'button', className: 'sd-button sd-ghost', onClick: () => setRefreshTick((value) => value + 1) },
            t('action.refresh'),
          ),
        )
      }

      function renderStoryboardTab() {
        return h(
          'div',
          { className: 'sd-grid' },
          h(
            'div',
            null,
            h(
              'div',
              { className: 'sd-card' },
              h('div', { className: 'sd-model' }, t('model.label'), h('b', null, modelLabel || '—')),
              h('label', { className: 'sd-label', htmlFor: 'sd-script' }, t('field.script')),
              h('textarea', {
                id: 'sd-script',
                className: 'sd-textarea',
                style: { minHeight: '150px' },
                value: script,
                placeholder: t('placeholder.script'),
                onChange: (event) => setScript(event.target.value),
              }),
              h('div', { className: 'sd-field' },
                h('label', { className: 'sd-label', htmlFor: 'sd-preset' }, t('field.preset')),
                h('textarea', {
                  id: 'sd-preset',
                  className: 'sd-textarea',
                  style: { minHeight: '170px' },
                  value: preset,
                  onChange: (event) => setPreset(event.target.value),
                }),
              ),
              h('div', { className: 'sd-actions' },
                h(
                  'button',
                  { type: 'button', className: 'sd-button sd-primary', disabled: generating, onClick: onGenerate },
                  generating ? '…' : (storyboard ? t('action.regenerate') : t('action.generate')),
                ),
                storyboard
                  ? h('button', { type: 'button', className: 'sd-button sd-ghost', onClick: onCopy }, t('action.copy'))
                  : null,
              ),
            ),
          ),
          h(
            'div',
            null,
            h(
              'div',
              { className: 'sd-card' },
              h('div', { className: 'sd-label', style: { fontSize: '12.5px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)' } }, t('storyboard.title')),
              storyboard
                ? h('pre', { className: 'sd-board' }, storyboard)
                : h(
                    'div',
                    { className: 'sd-empty' },
                    h('b', null, t('storyboard.empty')),
                    t('storyboard.emptyHint'),
                  ),
            ),
            renderAssetsCard(),
          ),
        )
      }

      function renderAssetsCard() {
        return h(
          'div',
          { className: 'sd-card' },
          h('div', { className: 'sd-label', style: { fontSize: '12.5px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)' } },
            `${t('assets.title')} (${assets.length})`),
          workspaces.length > 1
            ? h('select', {
                className: 'sd-select',
                value: workspaceId,
                onChange: (event) => setWorkspaceId(event.target.value),
              }, workspaces.map((workspace) => h('option', { key: workspace.id, value: workspace.id }, workspace.title)))
            : null,
          assets.length === 0
            ? h('div', { className: 'sd-assets-meta' }, t('assets.empty'))
            : h(
                'div',
                { className: 'sd-assets' },
                assets.map((asset) => h(
                  'button',
                  {
                    key: asset.path,
                    type: 'button',
                    className: 'sd-pill',
                    'data-active': selected.includes(asset.path) ? 'true' : 'false',
                    title: asset.path,
                    onClick: () => toggleAsset(asset.path),
                  },
                  `${assetGlyph(asset.type)} ${asset.relative}`,
                )),
              ),
          h(
            'div',
            { className: 'sd-assets-meta' },
            assetsTruncated ? t('assets.truncated') : null,
            selected.length > 0
              ? h(
                  'button',
                  { type: 'button', className: 'sd-mini', onClick: () => setSelected([]) },
                  `${t('assets.selected')} ${selected.length} · ${t('assets.clear')}`,
                )
              : null,
          ),
        )
      }

      function renderVideoTab() {
        return h(
          'div',
          { className: 'sd-grid' },
          h(
            'div',
            { className: 'sd-card' },
            h('div', { className: 'sd-model' }, t('model.label'), h('b', null, modelLabel || '—')),
            h('div', { className: 'sd-row' },
              h('div', null,
                h('label', { className: 'sd-label', htmlFor: 'sd-provider' }, t('field.provider')),
                h('select', {
                  id: 'sd-provider',
                  className: 'sd-select',
                  value: provider,
                  onChange: (event) => setProvider(event.target.value),
                },
                  h('option', { value: 'xiaoyunque' }, '小云雀 (xiaoyunque)'),
                  h('option', { value: 'dreamina' }, 'Dreamina'),
                ),
              ),
              h('div', null,
                h('label', { className: 'sd-label', htmlFor: 'sd-ratio' }, t('field.ratio')),
                h('input', {
                  id: 'sd-ratio',
                  className: 'sd-input',
                  value: ratio,
                  onChange: (event) => setRatio(event.target.value),
                }),
              ),
              h('div', null,
                h('label', { className: 'sd-label', htmlFor: 'sd-seconds' }, t('field.seconds')),
                h('input', {
                  id: 'sd-seconds',
                  className: 'sd-input',
                  type: 'number',
                  min: 1,
                  max: 60,
                  value: seconds,
                  onChange: (event) => setSeconds(event.target.value),
                }),
              ),
            ),
            h('div', { className: 'sd-field' },
              h('label', { className: 'sd-label', htmlFor: 'sd-model' }, t('field.model')),
              h('input', {
                id: 'sd-model',
                className: 'sd-input',
                value: model,
                onChange: (event) => setModel(event.target.value),
              }),
            ),
            h('div', { className: 'sd-field' },
              h('label', { className: 'sd-label', htmlFor: 'sd-prompt' }, t('field.prompt')),
              h('textarea', {
                id: 'sd-prompt',
                className: 'sd-textarea',
                style: { minHeight: '130px' },
                value: prompt || storyboard,
                placeholder: t('placeholder.prompt'),
                onChange: (event) => setPrompt(event.target.value),
              }),
            ),
            h('div', { className: 'sd-field' },
              h('label', { className: 'sd-label', htmlFor: 'sd-target' }, t('field.target')),
              h('input', {
                id: 'sd-target',
                className: 'sd-input',
                value: targetDir,
                placeholder: t('placeholder.target'),
                onChange: (event) => setTargetDir(event.target.value),
              }),
            ),
            h('div', { className: 'sd-field' },
              h('div', { className: 'sd-label' }, `${t('field.assets')} (${selected.length})`),
              selected.length === 0
                ? h('div', { className: 'sd-assets-meta' }, t('assets.empty'))
                : h('div', { className: 'sd-assets' }, selected.map((assetPath) => h(
                    'button',
                    {
                      key: assetPath,
                      type: 'button',
                      className: 'sd-pill',
                      'data-active': 'true',
                      title: assetPath,
                      onClick: () => toggleAsset(assetPath),
                    },
                    `× ${assetPath.split(/[\\/]/).pop()}`,
                  ))),
            ),
            h('div', { className: 'sd-actions' },
              h(
                'button',
                { type: 'button', className: 'sd-button sd-primary', disabled: submitting, onClick: onSubmit },
                submitting ? t('action.submitting') : t('action.submit'),
              ),
            ),
          ),
          h('div', null, renderHistoryCard()),
        )
      }

      function renderHistoryCard() {
        return h(
          'div',
          { className: 'sd-card' },
          h('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '10px' } },
            h('div', { className: 'sd-label', style: { fontSize: '12.5px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)' } }, t('history.title')),
            h('button', { type: 'button', className: 'sd-mini', onClick: () => setRefreshTick((value) => value + 1) }, t('action.refreshList')),
          ),
          items.length === 0
            ? h('div', { className: 'sd-empty' }, h('b', null, t('history.empty')), t('history.emptyHint'))
            : h(
                'div',
                { className: 'sd-history' },
                items.map((item) => h(
                  'div',
                  { key: item.id, className: 'sd-item' },
                  h(
                    'div',
                    { className: 'sd-item-body' },
                    h(
                      'div',
                      { className: 'sd-item-head' },
                      h('span', { className: 'sd-badge', 'data-status': item.status }, t(statusKey(item.status))),
                      h('span', null, item.provider === 'dreamina' ? 'Dreamina' : '小云雀'),
                      h('span', null, `${item.ratio} · ${item.seconds}s`),
                      h('span', null, formatTime(item.createdAt)),
                    ),
                    h('div', { className: 'sd-item-prompt' }, item.prompt || ''),
                    item.status === 'running' || item.status === 'queued'
                      ? h('div', null,
                          h('div', { className: 'sd-assets-meta' }, item.stage || ''),
                          h('div', { className: 'sd-progress' }, h('i')),
                        )
                      : null,
                    item.error ? h('div', { className: 'sd-item-error' }, item.error) : null,
                    item.resultName ? h('div', { className: 'sd-assets-meta sd-mono' }, item.resultName) : null,
                  ),
                  h(
                    'div',
                    { style: { display: 'flex', flexDirection: 'column', gap: '6px', flex: 'none' } },
                    item.status === 'succeeded' || item.status === 'completed'
                      ? h('button', {
                          type: 'button',
                          className: 'sd-mini',
                          disabled: busyId === item.id,
                          onClick: () => onDownload(item),
                        }, t('action.download'))
                      : null,
                    item.status === 'running' || item.status === 'queued'
                      ? h('button', {
                          type: 'button',
                          className: 'sd-mini',
                          disabled: busyId === item.id,
                          onClick: () => onCancel(item.id),
                        }, t('action.cancel'))
                      : null,
                    h('button', {
                      type: 'button',
                      className: 'sd-mini',
                      disabled: busyId === item.id,
                      onClick: () => onDelete(item.id),
                    }, t('action.delete')),
                  ),
                )),
              ),
        )
      }

      function renderSettingsTab() {
        if (!status) {
          return h('div', { className: 'sd-empty' }, h('b', null, t('error.title')), statusError || '—')
        }
        const rows = [
          [t('settings.model'), status.model],
          [t('settings.apiKeyEnv'), status.apiKeyEnv],
          [t('settings.xiaoyunque'), status.xiaoyunqueCommand],
          [t('settings.dreamina'), status.dreaminaCommand],
          [t('settings.ratio'), status.defaultRatio],
          [t('settings.seconds'), String(status.defaultDuration)],
          [t('settings.folder'), status.downloadFolder],
        ]
        return h(
          'div',
          { className: 'sd-card' },
          rows.map(([label, value]) => h(
            'div',
            { key: label, className: 'sd-settings-row' },
            h('span', null, label),
            h('b', { title: String(value || '') }, String(value || '—')),
          )),
          h('div', { className: 'sd-field' },
            h('div', { className: 'sd-label' }, t('settings.preset')),
            h('pre', { className: 'sd-board', style: { maxHeight: '240px' } }, status.storyboardPreset || ''),
          ),
          h('div', { className: 'sd-assets-meta' }, t('settings.note')),
        )
      }

      return h(
        'div',
        { className: 'sd-root' },
        h('style', null, STYLES),
        h(
          'div',
          { className: 'sd-scroll' },
          h(
            'div',
            { className: 'sd-head' },
            h(
              'div',
              null,
              h('div', { className: 'sd-title' }, t('panel.title')),
              h('div', { className: 'sd-sub' }, t('panel.subtitle')),
            ),
            renderBadges(),
          ),
          statusError
            ? h('div', { className: 'sd-error' }, statusError)
            : null,
          !configured && status
            ? h('div', { className: 'sd-error' }, (t('status.hint') || '').replace('{env}', status.apiKeyEnv || 'GEMINI_API_KEY'))
            : null,
          h(
            'div',
            { className: 'sd-tabs' },
            h('button', {
              type: 'button',
              className: 'sd-tab',
              'data-active': tab === 'storyboard' ? 'true' : 'false',
              onClick: () => setTab('storyboard'),
            }, t('tab.storyboard')),
            h('button', {
              type: 'button',
              className: 'sd-tab',
              'data-active': tab === 'video' ? 'true' : 'false',
              onClick: () => setTab('video'),
            }, t('tab.video')),
            h('button', {
              type: 'button',
              className: 'sd-tab',
              'data-active': tab === 'settings' ? 'true' : 'false',
              onClick: () => setTab('settings'),
            }, t('tab.settings')),
          ),
          error
            ? h('div', { className: 'sd-error' }, `${t('error.title')}: ${error}`)
            : null,
          note
            ? h('div', { className: 'sd-assets-meta' }, note)
            : null,
          tab === 'storyboard'
            ? h(ViewBoundary, { key: 'storyboard' }, renderStoryboardTab())
            : tab === 'video'
              ? h(ViewBoundary, { key: 'video' }, renderVideoTab())
              : h(ViewBoundary, { key: 'settings' }, renderSettingsTab()),
        ),
      )
    }

    /* ------------------------------------------------------------------- apply */

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, 'zh', ZH), 'dsh-short-drama: zh dictionary')
        ctx.effect(() => ctx.locale.register(NS, 'en', EN), 'dsh-short-drama: en dictionary')
        const t = ctx.locale.bind(NS)

        ctx.slots.inject('sidebar.panellist', () => {
          const offRow = ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 4,
              label: () => t('panel.title'),
              locale: NS,
              inject: () => ({ t }),
            },
            (owner) => h(Icon, { size: owner && owner.size ? owner.size : 16, active: Boolean(owner && owner.active) }),
          )
          const offPanel = ctx.slots.register(
            {
              name: 'main',
              key: PANEL_ID,
              locale: NS,
              inject: () => ({ t }),
            },
            (owner) => h(
              ViewBoundary,
              { key: PANEL_ID },
              h(Page, { t: owner && owner.t ? owner.t : t }),
            ),
          )
          return () => {
            if (typeof offRow === 'function') offRow()
            if (typeof offPanel === 'function') offPanel()
          }
        })
      },
    }
  },
})
