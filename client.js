/**
 * Client half of `dsh-short-drama`（短剧工坊）.
 *
 * This half is **configuration only**. It registers one sidebar panel entry
 * (`sidebar.panellist`) plus the page it opens (`main`), reads the plugin config
 * from the Host and saves edits back to the profile.
 *
 * It deliberately starts no generation: storyboards, asset scans, video
 * submission and downloads are agent tools that run inside the calling Session's
 * working directory, so all real work happens in the workspace the user is
 * already in.
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
      'panel.title': '短剧工坊·配置',
      'panel.subtitle': '这里只做配置。分镜词生成、素材扫描、视频提交与下载都由会话里的 Agent 工具完成，全部落在当前工作区内。',
      'status.key.ok': 'Key 已就绪',
      'status.key.missing': 'Key 未配置',
      'status.hint': '请到「设置 → 模型 → google」填写 Gemini API Key，或在 DSH 凭据中新增 {env}。',
      'action.reload': '重新读取',
      'action.save': '保存配置',
      'action.saving': '保存中…',
      'action.saved': '已保存，重启插件后生效',
      'action.reset': '放弃修改',
      'status.readonly': '当前 profile 的配置为只读，请手动编辑 cordis.patch.yml。',
      'section.model': 'Gemini',
      'section.cli': '出片 CLI',
      'section.defaults': '提交默认值',
      'section.preset': '分镜词规则',
      'section.tools': '可用工具',
      'field.geminiProvider': '供应商',
      'field.geminiModel': '模型',
      'field.geminiApiKeyEnv': 'API Key 环境变量 / 凭据名',
      'field.geminiBaseURL': 'API 基址',
      'field.xiaoyunqueModel': '小云雀模型（自动获取）',
      'field.dreaminaModelVersion': '即梦模型（自动获取）',
      'field.xiaoyunqueResolution': '小云雀分辨率',
      'field.dreaminaResolution': '即梦分辨率',
      'field.defaultRatio': '默认比例',
      'field.defaultSeconds': '默认时长（秒）',
      'field.downloadFolder': '默认输出目录',
      'discover.title': 'CLI 自动识别',
      'discover.refresh': '重新检测',
      'discover.checking': '检测中…',
      'discover.installed': '已安装',
      'discover.missing': '未安装',
      'discover.path': '路径',
      'discover.models': '可用模型',
      'discover.builtin': '未检测到 CLI，显示的是内置模型列表。装好 CLI 后点「重新检测」即可自动读取。',
      'discover.selectModel': '选择一个模型…',
      'discover.login': '登录状态',
      'discover.loggedIn': '已登录',
      'discover.notLogged': '未登录',
      'discover.expired': '凭据已过期',
      'discover.advanced': '高级权限',
      'discover.basic': '非高级',
      'discover.loginHint': '用 pippit-tool-cli login / dreamina login --headless 登录；即梦出片需高级会员。',
      'discover.update': '更新 CLI',
      'discover.updating': '更新中…',
      'discover.updateOk': 'CLI 已更新到最新版，模型列表已刷新。',
      'discover.notInstalled': '尚未安装此 CLI，无法更新。请先按说明安装。',
      'field.preset': '分镜规则（即提示词）',
      'hint.preset': '写成分镜师的规范即可；Agent 生成分镜词时会把它作为系统提示词。',
      'hint.commands': '路径由插件自动探测（PATH、~/.local/bin、npm 全局目录），不用手填。小云雀 = Pippit CLI（npm i -g @pippit-dev/cli 后 pippit-tool-cli login）；即梦 = 官方 dreamina CLI（curl https://jimeng.jianying.com/cli | bash 后 dreamina login --headless，出片需高级会员）。',
      'hint.models': '模型列表由插件直接问 CLI（pippit-tool-cli model list / dreamina text2video -h）得到；未装 CLI 时显示内置清单。点「重新检测」刷新。',
      'hint.paths': '相对路径按当前会话的工作区解析。',
      'tools.intro': '在会话里直接让我调用这些工具，全部以当前工作区为根：',
      'tools.storyboard': '把剧本转成分镜词，并写入工作区里的 Markdown 文件',
      'tools.assets': '列出工作区里可用的人像、音色、视频素材',
      'tools.submit': '用指定 CLI 提交视频任务，返回任务 id',
      'tools.status': '查询任务状态或列出最近任务',
      'tools.download': '把完成的视频复制到工作区指定目录',
      'tools.cancel': '取消运行中的任务',
      'error.title': '出错了',
      'error.load': '读取配置失败',
    }

    const EN = {
      'panel.title': 'Short Drama Studio · Config',
      'panel.subtitle': 'Configuration only. Storyboards, asset scans, video submission and downloads are agent tools that run inside the current session workspace.',
      'status.key.ok': 'Key ready',
      'status.key.missing': 'Key missing',
      'status.hint': 'Add a Gemini API key under Settings → Models → google, or create the {env} credential in DSH.',
      'action.reload': 'Reload',
      'action.save': 'Save config',
      'action.saving': 'Saving…',
      'action.saved': 'Saved; restart the plugin to apply',
      'action.reset': 'Discard changes',
      'status.readonly': 'This profile keeps the config read-only; edit cordis.patch.yml instead.',
      'section.model': 'Gemini',
      'section.cli': 'Render CLIs',
      'section.defaults': 'Submit defaults',
      'section.preset': 'Storyboard rules',
      'section.tools': 'Available tools',
      'field.geminiProvider': 'Provider',
      'field.geminiModel': 'Model',
      'field.geminiApiKeyEnv': 'API key env / credential name',
      'field.geminiBaseURL': 'API base URL',
      'field.xiaoyunqueModel': 'Xiaoyunque model (auto-detected)',
      'field.dreaminaModelVersion': 'Jimeng model (auto-detected)',
      'field.xiaoyunqueResolution': 'Xiaoyunque resolution',
      'field.dreaminaResolution': 'Jimeng resolution',
      'field.defaultRatio': 'Default ratio',
      'field.defaultSeconds': 'Default seconds',
      'field.downloadFolder': 'Default output folder',
      'discover.title': 'CLI auto-detection',
      'discover.refresh': 'Re-detect',
      'discover.checking': 'Detecting…',
      'discover.installed': 'Installed',
      'discover.missing': 'Not installed',
      'discover.path': 'Path',
      'discover.models': 'Available models',
      'discover.builtin': 'No CLI detected; showing the builtin model list. Install the CLI and press Re-detect to read models automatically.',
      'discover.selectModel': 'Pick a model…',
      'discover.login': 'Login status',
      'discover.loggedIn': 'Logged in',
      'discover.notLogged': 'Not logged in',
      'discover.expired': 'Credential expired',
      'discover.advanced': 'Advanced plan',
      'discover.basic': 'Not advanced',
      'discover.loginHint': 'Log in with pippit-tool-cli login / dreamina login --headless; Jimeng generation requires an Advanced plan.',
      'discover.update': 'Update CLI',
      'discover.updating': 'Updating…',
      'discover.updateOk': 'CLI updated to the latest version; model list refreshed.',
      'discover.notInstalled': 'This CLI is not installed yet. Install it first before updating.',
      'field.preset': 'Storyboard rules (prompt)',
      'hint.preset': 'Write it as a storyboard artist brief; the Agent sends it as the system prompt.',
      'hint.commands': 'Paths are auto-detected (PATH, ~/.local/bin, npm global); no need to type them. Xiaoyunque = Pippit CLI (npm i -g @pippit-dev/cli, then pippit-tool-cli login); Jimeng = official dreamina CLI (curl https://jimeng.jianying.com/cli | bash, then dreamina login --headless; generation requires an Advanced plan).',
      'hint.models': 'Models are read straight from the CLI (pippit-tool-cli model list / dreamina text2video -h); a builtin list is shown until the CLI is installed. Press Re-detect to refresh.',
      'hint.paths': 'Relative paths resolve against the current session workspace.',
      'tools.intro': 'Ask me to call these tools in the session; each is rooted at the current workspace:',
      'tools.storyboard': 'Turn a script into a storyboard and write it into the workspace',
      'tools.assets': 'List portraits, voices and clips available in the workspace',
      'tools.submit': 'Submit a video task through the chosen CLI and return its id',
      'tools.status': 'Check one task or list recent tasks',
      'tools.download': 'Copy a finished video into a workspace folder',
      'tools.cancel': 'Cancel a running task',
      'error.title': 'Something went wrong',
      'error.load': 'Failed to load config',
    }

    /* ---------------------------------------------------------------- styles */

    const STYLES = `
      .sd-root{display:flex;flex-direction:column;height:100%;min-height:480px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family,inherit);overflow:hidden;--sd-accent:#2563eb;--sd-accent-strong:#1d4ed8;--sd-accent-soft:rgba(37,99,235,.10)}
      .sd-scroll{flex:1;min-height:0;overflow:auto;padding:26px 30px 40px}
      .sd-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:18px}
      .sd-title{font-size:20px;font-weight:600;letter-spacing:.01em;line-height:1.25}
      .sd-sub{font-size:12.5px;color:var(--dsw-alias-label-secondary);margin-top:5px;line-height:1.55;max-width:720px}
      .sd-badges{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}
      .sd-chip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:999px;padding:4px 10px;font-size:11.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
      .sd-dot{width:7px;height:7px;border-radius:50%;background:#9ca3af;flex:none}
      .sd-dot[data-ok="true"]{background:#22c55e}
      .sd-dot[data-ok="false"]{background:#ef4444}
      .sd-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:16px;align-items:start}
      .sd-card{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:14px;padding:16px;box-sizing:border-box}
      .sd-card-title{font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-primary);margin-bottom:12px}
      .sd-label{display:block;font-size:11.5px;color:var(--dsw-alias-label-secondary);margin:0 0 6px}
      .sd-input,.sd-select{width:100%;box-sizing:border-box;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:8px 10px;font:inherit;font-size:12.5px;outline:none}
      .sd-input:focus,.sd-select:focus,.sd-textarea:focus{border-color:var(--sd-accent)}
      .sd-input:disabled,.sd-select:disabled,.sd-textarea:disabled{opacity:.6;cursor:default}
      .sd-textarea{width:100%;box-sizing:border-box;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px 12px;font:inherit;font-size:12.5px;line-height:1.6;outline:none;resize:vertical;min-height:180px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
      .sd-field{margin-top:12px}
      .sd-field:first-child{margin-top:0}
      .sd-row{display:flex;gap:10px}
      .sd-row>*{flex:1;min-width:0}
      .sd-hint{font-size:11px;color:var(--dsw-alias-label-secondary);line-height:1.55;margin-top:6px}
      .sd-actions{display:flex;gap:8px;margin-top:18px;flex-wrap:wrap;align-items:center}
      .sd-button{display:inline-flex;align-items:center;justify-content:center;gap:6px;border-radius:9px;padding:8px 14px;font:inherit;font-size:12.5px;cursor:pointer;border:1px solid transparent;white-space:nowrap}
      .sd-button:disabled{opacity:.55;cursor:default}
      .sd-primary{background:var(--sd-accent);color:#fff;border-color:var(--sd-accent);font-weight:600}
      .sd-primary:hover:not(:disabled){background:var(--sd-accent-strong);border-color:var(--sd-accent-strong)}
      .sd-ghost{border-color:var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-primary)}
      .sd-ghost:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
      .sd-error{display:flex;gap:8px;align-items:flex-start;border:1px solid rgba(239,68,68,.55);background:rgba(239,68,68,.08);color:#ef4444;border-radius:10px;padding:9px 12px;font-size:12.5px;line-height:1.5;margin-bottom:14px;word-break:break-word}
      .sd-note{border:1px solid rgba(34,197,94,.5);background:rgba(34,197,94,.08);color:#16a34a;border-radius:10px;padding:9px 12px;font-size:12.5px;margin-bottom:14px}
      .sd-tools{margin:0;padding-left:18px;font-size:12.5px;line-height:1.9;color:var(--dsw-alias-label-secondary)}
      .sd-tools code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11.5px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:5px;padding:1px 5px;margin-right:6px}
      .sd-loading{display:flex;align-items:center;justify-content:center;min-height:220px;color:var(--dsw-alias-label-secondary);font-size:12.5px}
      .sd-discover-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}
      .sd-status-chip{display:inline-flex;align-items:center;gap:5px;font-size:11px;border-radius:999px;padding:2px 8px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary)}
      .sd-status-chip[data-ok="true"]{color:#16a34a;border-color:rgba(34,197,94,.5);background:rgba(34,197,94,.08)}
      .sd-status-chip[data-ok="false"]{color:#ef4444;border-color:rgba(239,68,68,.5);background:rgba(239,68,68,.08)}
      .sd-cli-block{border-top:1px solid var(--dsw-alias-border-l1);margin-top:14px;padding-top:12px}
      .sd-cli-block:first-of-type{border-top:none;margin-top:0;padding-top:0}
      .sd-cli-name{font-size:12.5px;font-weight:600;margin-bottom:8px;display:flex;align-items:center;gap:8px}
      .sd-path{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;color:var(--dsw-alias-label-secondary);word-break:break-all;margin:4px 0 8px}
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
        h('circle', { cx: 12, cy: 12, r: 3.2 }),
        h('path', { d: 'M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6h.09A1.7 1.7 0 0 0 10 3.04V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.09a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1.03z' }),
      )
    }

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
          return h('div', { className: 'sd-error' }, '视图渲染失败，请刷新页面重试。')
        }
        return this.props.children
      }
    }

    /* -------------------------------------------------------------------- page */

    function Page(props) {
      const t = props.t
      const [loading, setLoading] = useState(true)
      const [saving, setSaving] = useState(false)
      const [config, setConfig] = useState(null)
      const [draft, setDraft] = useState(null)
      const [keyConfigured, setKeyConfigured] = useState(false)
      const [keySource, setKeySource] = useState('')
      const [error, setError] = useState('')
      const [note, setNote] = useState('')
      const [discover, setDiscover] = useState(null)
      const [discovering, setDiscovering] = useState(false)
      const [updating, setUpdating] = useState('')

      const onUpdateCli = useCallback(async (provider) => {
        setUpdating(provider)
        setError('')
        setNote('')
        try {
          const data = await postJson('/update', { provider })
          // Merge the freshly discovered info back into the panel.
          setDiscover((current) => {
            const next = current ? { ...current } : {}
            next[provider] = data.info
            return next
          })
          setNote(`${provider}: ${t('discover.updateOk')}`)
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : String(caught))
        } finally {
          setUpdating('')
        }
      }, [t])

      const loadDiscover = useCallback(async (force) => {
        setDiscovering(true)
        try {
          const data = await getJson(`/discover${force ? '?force=1' : ''}`)
          setDiscover(data)
          // Auto-select the first discovered model when the configured one is
          // empty. Update both draft and config baseline so the panel does not
          // show a false "unsaved changes" for a pure auto-selection.
          setDraft((current) => {
            if (!current) return current
            let next = current
            const xyqModels = (data.xiaoyunque && data.xiaoyunque.models) || []
            const dmModels = (data.dreamina && data.dreamina.models) || []
            if (xyqModels.length && !xyqModels.some((m) => m.value === current.xiaoyunqueModel)) {
              next = { ...next, xiaoyunqueModel: xyqModels[0].value }
            }
            if (dmModels.length && !dmModels.some((m) => m.value === current.dreaminaModelVersion)) {
              next = { ...next, dreaminaModelVersion: dmModels[0].value }
            }
            setConfig((baseline) => (baseline ? { ...baseline, xiaoyunqueModel: next.xiaoyunqueModel, dreaminaModelVersion: next.dreaminaModelVersion } : baseline))
            return next
          })
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : String(caught))
        } finally {
          setDiscovering(false)
        }
      }, [])

      const load = useCallback(async () => {
        setLoading(true)
        setError('')
        try {
          const data = await getJson('/config')
          setConfig(data.config || null)
          setDraft(data.config || null)
          setKeyConfigured(Boolean(data.keyConfigured))
          setKeySource(String(data.keySource || ''))
          // Discover only after config is in place, so auto-selection is not
          // overwritten by a late config response.
          void loadDiscover(false)
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : String(caught))
        } finally {
          setLoading(false)
        }
      }, [loadDiscover])

      useEffect(() => {
        void load()
      }, [load])

      const patch = useCallback((field, value) => {
        setDraft((current) => (current === null ? current : { ...current, [field]: value }))
      }, [])

      const dirty = Boolean(config && draft) && JSON.stringify(config) !== JSON.stringify(draft)

      const onSave = useCallback(async () => {
        if (!draft) return
        setSaving(true)
        setError('')
        setNote('')
        try {
          const payload = {}
          for (const key of [
            'geminiProvider', 'geminiModel', 'geminiApiKeyEnv', 'geminiBaseURL',
            'xiaoyunqueCommand', 'dreaminaCommand', 'defaultRatio', 'defaultDuration',
            'xiaoyunqueModel', 'dreaminaModelVersion', 'xiaoyunqueResolution', 'dreaminaResolution',
            'downloadFolder', 'storyboardPreset', 'assetExtensions',
          ]) {
            if (Object.prototype.hasOwnProperty.call(draft, key)) payload[key] = draft[key]
          }
          const data = await postJson('/config', { config: payload })
          setConfig(data.config || payload)
          setDraft(data.config || payload)
          setNote(t('action.saved'))
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : String(caught))
        } finally {
          setSaving(false)
        }
      }, [draft, t])

      const readOnly = Boolean(config && config.writable === false)

      function field(key, label, options) {
        const value = draft ? draft[key] : ''
        return h(
          'div',
          { key, className: 'sd-field' },
          h('label', { className: 'sd-label', htmlFor: `sd-${key}` }, label),
          h('input', {
            id: `sd-${key}`,
            className: 'sd-input',
            value: value === undefined || value === null ? '' : String(value),
            disabled: readOnly,
            placeholder: options && options.placeholder ? options.placeholder : '',
            onChange: (event) => patch(key, options && options.number ? Number(event.target.value) : event.target.value),
          }),
          options && options.hint ? h('div', { className: 'sd-hint' }, options.hint) : null,
        )
      }

      function selectField(key, label, models) {
        const value = draft ? draft[key] : ''
        return h(
          'div',
          { key, className: 'sd-field' },
          h('label', { className: 'sd-label', htmlFor: `sd-${key}` }, label),
          h(
            'select',
            {
              id: `sd-${key}`,
              className: 'sd-select',
              value: value === undefined || value === null ? '' : String(value),
              disabled: readOnly || !models || models.length === 0,
              onChange: (event) => patch(key, event.target.value),
            },
            h('option', { value: '' }, t('discover.selectModel')),
            ...(models || []).map((m) => h('option', { key: m.value, value: m.value }, m.label || m.value)),
          ),
        )
      }

      function cliBlock(name, info, modelKey, resKey, resLabel, provider) {
        const installed = Boolean(info && info.path)
        const models = (info && info.models) || []
        const login = info && info.login
        const loggedIn = Boolean(login && login.loggedIn)
        let loginLabel = t('discover.notLogged')
        if (login && login.expired) loginLabel = t('discover.expired')
        else if (loggedIn) loginLabel = t('discover.loggedIn')
        const advancedChip = login && login.advanced === true
          ? h('span', { className: 'sd-status-chip', 'data-ok': 'true' }, t('discover.advanced'))
          : (login && login.advanced === false
            ? h('span', { className: 'sd-status-chip', 'data-ok': 'false' }, t('discover.basic'))
            : null)
        const loginDetail = login && login.detail
          ? h('div', { className: 'sd-hint', style: { marginTop: 0 } }, login.detail)
          : null
        return h(
          'div',
          { key: name, className: 'sd-cli-block' },
          h(
            'div',
            { className: 'sd-cli-name' },
            name,
            h('span', { className: 'sd-status-chip', 'data-ok': installed ? 'true' : 'false' },
              installed ? t('discover.installed') : t('discover.missing')),
            installed ? h('span', { className: 'sd-status-chip', 'data-ok': loggedIn ? 'true' : 'false' }, loginLabel) : null,
            advancedChip,
            info && info.version ? h('span', { className: 'sd-hint', style: { marginTop: 0 } }, `v${info.version}`) : null,
          ),
          h('div', { className: 'sd-path' },
            `${t('discover.path')}: ${installed ? info.path : '—'}`),
          loginDetail,
          selectField(modelKey, t('discover.models'), models),
          field(resKey, resLabel),
          h(
            'button',
            {
              type: 'button',
              className: 'sd-button sd-ghost',
              style: { marginTop: '10px' },
              disabled: !installed || updating !== '',
              title: installed ? '' : t('discover.notInstalled'),
              onClick: () => { void onUpdateCli(provider) },
            },
            updating === provider ? t('discover.updating') : t('discover.update'),
          ),
        )
      }

      const usingBuiltin = Boolean(
        discover && ((discover.xiaoyunque && discover.xiaoyunque.source === 'builtin')
          || (discover.dreamina && discover.dreamina.source === 'builtin')),
      )

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
            h(
              'div',
              { className: 'sd-badges' },
              h(
                'span',
                { className: 'sd-chip' },
                h('i', { className: 'sd-dot', 'data-ok': keyConfigured ? 'true' : 'false' }),
                keyConfigured ? t('status.key.ok') : t('status.key.missing'),
                keySource ? ` · ${keySource}` : '',
              ),
              h('button', { type: 'button', className: 'sd-button sd-ghost', onClick: () => { void load() } }, t('action.reload')),
            ),
          ),

          error ? h('div', { className: 'sd-error' }, `${t('error.title')}: ${error}`) : null,
          note ? h('div', { className: 'sd-note' }, note) : null,
          !keyConfigured && config
            ? h('div', { className: 'sd-error' }, (t('status.hint') || '').replace('{env}', config.geminiApiKeyEnv || 'GEMINI_API_KEY'))
            : null,
          readOnly ? h('div', { className: 'sd-error' }, t('status.readonly')) : null,

          loading
            ? h('div', { className: 'sd-loading' }, '…')
            : config
              ? h(
                  React.Fragment,
                  null,
                  h(
                    'div',
                    { className: 'sd-grid' },
                    h(
                      'div',
                      { className: 'sd-card' },
                      h('div', { className: 'sd-card-title' }, t('section.model')),
                      field('geminiProvider', t('field.geminiProvider')),
                      field('geminiModel', t('field.geminiModel')),
                      field('geminiApiKeyEnv', t('field.geminiApiKeyEnv')),
                      field('geminiBaseURL', t('field.geminiBaseURL')),
                    ),
                    h(
                      'div',
                      { className: 'sd-card' },
                      h(
                        'div',
                        { className: 'sd-discover-head' },
                        h('div', { className: 'sd-card-title', style: { marginBottom: 0 } }, t('discover.title')),
                        h('button', {
                          type: 'button', className: 'sd-button sd-ghost',
                          disabled: discovering,
                          onClick: () => { void loadDiscover(true) },
                        }, discovering ? t('discover.checking') : t('discover.refresh')),
                      ),
                      h('div', { className: 'sd-hint', style: { marginTop: 0, marginBottom: '10px' } }, t('hint.commands')),
                      usingBuiltin ? h('div', { className: 'sd-error', style: { marginBottom: '12px' } }, t('discover.builtin')) : null,
                      cliBlock('小云雀 / Pippit', discover && discover.xiaoyunque, 'xiaoyunqueModel', 'xiaoyunqueResolution', t('field.xiaoyunqueResolution'), 'xiaoyunque'),
                      cliBlock('即梦 / Dreamina', discover && discover.dreamina, 'dreaminaModelVersion', 'dreaminaResolution', t('field.dreaminaResolution'), 'dreamina'),
                      h('div', { className: 'sd-hint' }, t('discover.loginHint')),
                      h('div', { className: 'sd-hint' }, t('hint.models')),
                    ),
                    h(
                      'div',
                      { className: 'sd-card' },
                      h('div', { className: 'sd-card-title' }, t('section.defaults')),
                      h('div', { className: 'sd-row' },
                        field('defaultRatio', t('field.defaultRatio')),
                        field('defaultDuration', t('field.defaultSeconds'), { number: true }),
                      ),
                      field('downloadFolder', t('field.downloadFolder'), { hint: t('hint.paths') }),
                    ),
                    h(
                      'div',
                      { className: 'sd-card' },
                      h('div', { className: 'sd-card-title' }, t('section.tools')),
                      h('div', { className: 'sd-hint', style: { marginTop: 0, marginBottom: '8px' } }, t('tools.intro')),
                      h(
                        'ul',
                        { className: 'sd-tools' },
                        h('li', null, h('code', null, 'storyboard_write'), t('tools.storyboard')),
                        h('li', null, h('code', null, 'short_drama_assets'), t('tools.assets')),
                        h('li', null, h('code', null, 'video_submit'), t('tools.submit')),
                        h('li', null, h('code', null, 'video_status'), t('tools.status')),
                        h('li', null, h('code', null, 'video_download'), t('tools.download')),
                        h('li', null, h('code', null, 'video_cancel'), t('tools.cancel')),
                      ),
                    ),
                  ),
                  h(
                    'div',
                    { className: 'sd-card', style: { marginTop: '16px' } },
                    h('div', { className: 'sd-card-title' }, t('section.preset')),
                    h('textarea', {
                      className: 'sd-textarea',
                      value: draft && draft.storyboardPreset ? draft.storyboardPreset : '',
                      disabled: readOnly,
                      onChange: (event) => patch('storyboardPreset', event.target.value),
                    }),
                    h('div', { className: 'sd-hint' }, t('hint.preset')),
                  ),
                  h(
                    'div',
                    { className: 'sd-actions' },
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'sd-button sd-primary',
                        disabled: readOnly || saving || !dirty,
                        onClick: onSave,
                      },
                      saving ? t('action.saving') : t('action.save'),
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'sd-button sd-ghost',
                        disabled: !dirty || saving,
                        onClick: () => { setDraft(config); setNote('') },
                      },
                      t('action.reset'),
                    ),
                  ),
                )
              : null,
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
