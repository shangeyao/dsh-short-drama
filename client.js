/**
 * Browser half of @local/dsh-short-drama.
 *
 * Registers a left-sidebar entry + main panel ("短剧工坊"), and calls the Host's
 * `shortDrama` Typert Remote for every operation. All UI text is inline and
 * follows the active DSH locale (zh/en) through ctx.locale registration.
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-short-drama',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    // ---- Self-contained Typert Remote descriptor (matches index.js methods) --
    // Inlined from @deepseek-ai/dsh-typert-protocol/remote-info so this client
    // half needs no extra module-table entries beyond React.
    class RemoteInfo {
      constructor(spec) { this.spec = spec; this.index = undefined }
      get package() { return this.spec.package }
      get descriptors() { return this.resolve().descriptors }
      get methods() { return this.resolve().methods }
      resolve() {
        if (this.index !== undefined) return this.index
        const descriptors = [], methods = Object.create(null)
        for (const [endpoint, definition] of Object.entries(this.spec.methods)) {
          const sep = endpoint.indexOf('/')
          const namespace = endpoint.slice(0, sep), method = endpoint.slice(sep + 1)
          const parameters = definition.parameters.map(p => ({ ...p, wire: p.wire ?? p.name }))
          const descriptor = { ...definition, id: `${this.spec.package}#${endpoint}`, namespace, method, parameters }
          if (definition.invocation.kind === 'direct') {
            methods[endpoint] = Object.assign(descriptor, {
              input() { return { create: () => ({ parse: v => v }), jsonSchema: {} } },
              invoke(remote, input, signal) {
                const values = parameters.map(p => input[p.wire])
                if (definition.cancellation !== undefined) values.push(signal)
                const receiver = Reflect.get(remote, namespace)
                const fn = Reflect.get(receiver, method)
                return fn.apply(receiver, values)
              },
            })
          }
          descriptors.push(descriptor)
        }
        return (this.index = { descriptors, methods })
      }
    }
    const strictCodec = () => ({
      mode: 'strict', typeSymbol: 'unknown',
      create: () => ({ parse: v => v }),
      jsonSchema: {},
    })
    const str = (desc) => ({ mode: 'strict', typeSymbol: 'object', create: () => ({ parse: v => v }), description: desc, jsonSchema: { type: 'object' } })
    const PARAMS = (names) => names.map(name => ({
      name, wire: name, source: 'json', description: name,
      codec: strictCodec(), strictCodec: strictCodec(),
      acceptsUndefined: false,
    }))
    const method = (desc, params) => ({
      service: 'shortDrama', description: desc, invocation: { kind: 'direct' },
      parameters: PARAMS(params.filter(p => p !== 'signal')),
      ...(params.includes('signal') ? { cancellation: { parameter: 'signal' } } : {}),
      result: str(desc),
      sourceLocation: { file: 'dsh-short-drama/index.js', line: 1, column: 1 },
    })
    const TYPERT = new RemoteInfo({
      package: '@local/dsh-short-drama',
      methods: {
        'shortDrama/config': method('Read config', []),
        'shortDrama/saveConfig': method('Save config', ['patch']),
        'shortDrama/listAssets': method('List assets', ['workspaceId']),
        'shortDrama/generateStoryboard': method('Generate storyboard', ['script', 'preset', 'signal']),
        'shortDrama/submitVideo': method('Submit video', ['request', 'signal']),
        'shortDrama/jobStatus': method('Job status', ['jobId']),
        'shortDrama/listJobs': method('List jobs', []),
        'shortDrama/cancelJob': method('Cancel job', ['jobId']),
        'shortDrama/downloadJob': method('Download job', ['jobId', 'targetDir']),
        'shortDrama/downloadUrl': method('Download URL', ['url', 'fileName', 'workspaceId', 'targetDir']),
      },
    })

    // ---- i18n -------------------------------------------------------------
    const dict = {
      en: {
        panel: 'Short Drama Studio',
        subtitle: 'Gemini storyboards & AI video generation',
        tabStoryboard: 'Storyboard', tabVideo: 'Video jobs', tabSettings: 'Settings',
        scriptLabel: 'Script', scriptPlaceholder: 'Paste your short-drama script here…',
        presetLabel: 'Storyboard rules (editable)', generate: 'Generate storyboard',
        generating: 'Generating…', storyboardResult: 'Storyboard result', copy: 'Copy',
        assets: 'Workspace assets', refreshAssets: 'Refresh', noAssets: 'No assets found in this workspace.',
        provider: 'Provider', prompt: 'Prompt / storyboard text', ratio: 'Ratio', duration: 'Duration (s)',
        model: 'Model (optional)', extraAssets: 'Linked assets', submit: 'Submit video',
        jobs: 'Jobs', status: 'Status', actions: 'Actions', download: 'Download',
        cancel: 'Cancel', none: 'No jobs yet.', geminiModel: 'Gemini model',
        geminiProvider: 'LLM provider', apiKeyRef: 'API key credential ref',
        presetRules: 'Default storyboard rules', xiaoyunque: 'Xiaoyunque CLI command',
        dreamina: 'Dreamina CLI command', downloadFolder: 'Default download folder',
        downloadTarget: 'Download to folder', defaultDownload: 'Project default folder',
        prerequisites: 'Requires a configured Gemini provider (or GEMINI_API_KEY) and both CLIs on PATH.',
        save: 'Save settings', saved: 'Settings saved', error: 'Error',
        selectAssets: 'Select assets to link', workspace: 'Workspace',
      },
      zh: {
        panel: '短剧工坊', subtitle: 'Gemini 分镜词与 AI 视频生成',
        tabStoryboard: '分镜词', tabVideo: '视频任务', tabSettings: '设置',
        scriptLabel: '剧本', scriptPlaceholder: '在此粘贴短剧剧本…',
        presetLabel: '分镜词规则（可自定义）', generate: '生成分镜词',
        generating: '生成中…', storyboardResult: '分镜词结果', copy: '复制',
        assets: '工作区资产', refreshAssets: '刷新', noAssets: '当前工作区未发现资产。',
        provider: '供应商', prompt: '提示词 / 分镜词', ratio: '比例', duration: '时长（秒）',
        model: '模型（可选）', extraAssets: '关联资产', submit: '提交视频生成',
        jobs: '任务列表', status: '状态', actions: '操作', download: '下载',
        cancel: '取消', none: '暂无任务。', geminiModel: 'Gemini 模型',
        geminiProvider: 'LLM 供应商', apiKeyRef: 'API Key 凭据名',
        presetRules: '默认分镜词规则', xiaoyunque: '小云雀 CLI 命令',
        dreamina: 'Dreamina CLI 命令', downloadFolder: '默认下载文件夹',
        downloadTarget: '下载到文件夹', defaultDownload: '使用项目默认文件夹',
        prerequisites: '需先配置 Gemini 供应商（或 GEMINI_API_KEY），并确保两个 CLI 已在 PATH 中。',
        save: '保存设置', saved: '设置已保存', error: '错误',
        selectAssets: '选择要关联的资产', workspace: '工作区',
      },
    }
    const localeNs = 'dshShortDrama'

    // ---- tiny UI primitives ----------------------------------------------
    function cssVars() {
      return {
        bg: 'var(--dsw-alias-bg-base)', layer: 'var(--dsw-alias-bg-layer-1)', layer2: 'var(--dsw-alias-bg-layer-2)',
        border: 'var(--dsw-alias-border-l1)', brand: 'var(--dsw-alias-brand-primary)',
        text: 'var(--dsw-alias-label-primary)', sub: 'var(--dsw-alias-label-secondary)',
        err: 'var(--dsw-alias-state-error-primary)', ok: 'var(--dsw-alias-state-success-primary)',
      }
    }
    const S = {
      wrap: { display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box', background: cssVars().bg, color: cssVars().text, fontSize: 13 },
      head: { padding: '18px 20px 10px', borderBottom: `1px solid ${cssVars().border}` },
      title: { margin: 0, fontSize: 16, fontWeight: 650 },
      sub: { margin: '4px 0 0', fontSize: 12, color: cssVars().sub },
      tabs: { display: 'flex', gap: 4, padding: '10px 16px 0', borderBottom: `1px solid ${cssVars().border}` },
      tab: (active) => ({ padding: '8px 12px', cursor: 'pointer', border: 'none', background: 'transparent', color: active ? cssVars().brand : cssVars().sub, borderBottom: active ? `2px solid ${cssVars().brand}` : '2px solid transparent', fontSize: 13 }),
      body: { flex: 1, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 },
      label: { display: 'block', fontSize: 12, color: cssVars().sub, marginBottom: 6 },
      input: { width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 6, border: `1px solid ${cssVars().border}`, background: cssVars().layer, color: cssVars().text, fontSize: 13, fontFamily: 'inherit' },
      textarea: { width: '100%', boxSizing: 'border-box', padding: 10, borderRadius: 6, border: `1px solid ${cssVars().border}`, background: cssVars().layer, color: cssVars().text, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.5 },
      row: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' },
      btn: (primary) => ({ padding: '8px 14px', borderRadius: 6, border: primary ? `1px solid ${cssVars().brand}` : `1px solid ${cssVars().border}`, background: primary ? cssVars().brand : cssVars().layer, color: primary ? '#fff' : cssVars().text, cursor: 'pointer', fontSize: 13, fontWeight: 550 }),
      card: { padding: 12, borderRadius: 8, border: `1px solid ${cssVars().border}`, background: cssVars().layer2 },
      errBox: { padding: 10, borderRadius: 6, background: cssVars().layer2, border: `1px solid ${cssVars().err}`, color: cssVars().err, fontSize: 12, whiteSpace: 'pre-wrap' },
      chip: (on) => ({ padding: '4px 9px', borderRadius: 14, border: `1px solid ${on ? cssVars().brand : cssVars().border}`, background: on ? cssVars().brand : cssVars().layer, color: on ? '#fff' : cssVars().sub, cursor: 'pointer', fontSize: 12 }),
      badge: (s) => {
        const solid = s === 'succeeded' || s === 'failed'
        return {
          padding: '2px 8px', borderRadius: 10, fontSize: 11,
          background: s === 'succeeded' ? cssVars().ok : s === 'failed' ? cssVars().err : cssVars().layer2,
          color: solid ? '#fff' : cssVars().text,
          border: solid ? 'none' : `1px solid ${cssVars().border}`,
        }
      },
      pre: { margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: cssVars().layer2, padding: 12, borderRadius: 6, fontFamily: 'ui-monospace, monospace', fontSize: 12, maxHeight: 420, overflow: 'auto' },
    }

    return {
      inject: ['slots', 'layout', 'locale', 'remote'],
      async apply(ctx) {
        ctx.locale.register(localeNs, {
          en: dict.en, zh: dict.zh,
          'zh-cn': dict.zh, 'en-us': dict.en,
        }, 'dshShortDrama')
        const t = ctx.locale.bind ? ctx.locale.bind(localeNs) : (k) => (dict.zh[k] || dict.en[k] || k)

        const unmount = await ctx.remote.$mount(TYPERT)

        const call = (method, ...args) => {
          const ns = ctx.remote.shortDrama
          if (!ns) throw new Error('shortDrama Remote 未就绪，请刷新页面后重试。')
          return ns[method](...args)
        }

        function Panel() {
          const [tab, setTab] = React.useState('storyboard')
          const [cfg, setCfg] = React.useState(null)
          const [script, setScript] = React.useState('')
          const [preset, setPreset] = React.useState('')
          const [board, setBoard] = React.useState('')
          const [assets, setAssets] = React.useState([])
          const [workspaceId, setWorkspaceId] = React.useState('')
          const [busy, setBusy] = React.useState(false)
          const [error, setError] = React.useState('')
          const [notice, setNotice] = React.useState('')
          const [jobs, setJobs] = React.useState([])
          const [form, setForm] = React.useState({ provider: 'xiaoyunque', ratio: '9:16', duration: 5, model: '', targetDir: '' })
          const [selected, setSelected] = React.useState([])

          const loadConfig = React.useCallback(async () => {
            try {
              const r = await call('config')
              const c = r.config || r
              setCfg(c)
              setPreset(c.storyboardPreset || '')
              setForm(f => ({
                ...f,
                ratio: c.defaultRatio || f.ratio,
                duration: c.defaultDuration || f.duration,
                targetDir: f.targetDir || c.downloadFolder || '',
              }))
              if (!workspaceId && c.workspaces?.length) setWorkspaceId(String(c.workspaces[0].id))
            } catch (e) { setError(String(e?.message || e)) }
          }, [workspaceId])

          const refreshAssets = React.useCallback(async () => {
            try {
              const r = await call('listAssets', workspaceId || undefined)
              setAssets(r.assets || [])
            } catch (e) { setError(String(e?.message || e)) }
          }, [workspaceId])

          const refreshJobs = React.useCallback(async () => {
            try {
              const r = await call('listJobs')
              setJobs(r.jobs || [])
            } catch (e) { setError(String(e?.message || e)) }
          }, [])

          React.useEffect(() => { void loadConfig(); void refreshAssets(); void refreshJobs() }, [])
          React.useEffect(() => { void refreshAssets() }, [workspaceId])

          // Poll running jobs. Depend on a boolean so the timer is not recreated
          // on every fresh jobs array from each tick.
          const anyRunning = jobs.some(j => j.status === 'running' || j.status === 'queued')
          React.useEffect(() => {
            if (!anyRunning) return
            const timer = setInterval(async () => {
              try {
                const r = await call('listJobs')
                setJobs(r.jobs || [])
              } catch (e) { setError(String(e?.message || e)) }
            }, 2500)
            return () => clearInterval(timer)
          }, [anyRunning])

          const doGenerate = async () => {
            setBusy(true); setError(''); setNotice('')
            try {
              const ctrl = new AbortController()
              const r = await call('generateStoryboard', script, preset, ctrl.signal)
              const s = r.storyboard || ''
              setBoard(s)
              setForm(f => ({ ...f, prompt: s }))
            } catch (e) { setError(String(e?.message || e)) }
            finally { setBusy(false) }
          }

          const doSubmit = async () => {
            setBusy(true); setError(''); setNotice('')
            try {
              const r = await call('submitVideo', {
                provider: form.provider,
                prompt: form.prompt || board,
                assets: selected,
                ratio: form.ratio,
                duration: Number(form.duration),
                model: form.model || undefined,
                workspaceId: workspaceId || undefined,
              })
              setNotice(`${r.command} ${(r.args || []).join(' ')}`)
              await refreshJobs()
              setTab('video')
            } catch (e) { setError(String(e?.message || e)) }
            finally { setBusy(false) }
          }

          const doDownload = async (job) => {
            try {
              const r = await call('downloadJob', job.id, form.targetDir || undefined)
              setNotice(`${t('download')}: ${r.path}`)
            } catch (e) { setError(String(e?.message || e)) }
          }

          const doSave = async () => {
            try {
              await call('saveConfig', cfg)
              setNotice(t('saved'))
            } catch (e) { setError(String(e?.message || e)) }
          }

          const copyBoard = async () => {
            try { await navigator.clipboard.writeText(board); setNotice('Copied') } catch { /* ignore */ }
          }

          const toggleAsset = (p) => setSelected(s => s.includes(p) ? s.filter(x => x !== p) : [...s, p])

          return h('div', { style: S.wrap },
            h('div', { style: S.head },
              h('h2', { style: S.title }, t('panel')),
              h('p', { style: S.sub }, t('subtitle')),
              h('p', { style: { ...S.sub, fontSize: 11, marginTop: 6 } }, t('prerequisites')),
            ),
            h('div', { style: S.tabs },
              ['storyboard', 'video', 'settings'].map(k => h('button', {
                key: k, style: S.tab(tab === k), onClick: () => setTab(k),
              }, t(k === 'storyboard' ? 'tabStoryboard' : k === 'video' ? 'tabVideo' : 'tabSettings'))),
            ),
            h('div', { style: S.body },
              error ? h('div', { style: S.errBox }, `${t('error')}: ${error}`) : null,
              notice ? h('div', { style: { ...S.card, color: cssVars().ok, fontSize: 12 } }, notice) : null,

              tab === 'storyboard' ? h(React.Fragment, null,
                h('div', null,
                  h('label', { style: S.label }, t('scriptLabel')),
                  h('textarea', { style: { ...S.textarea, height: 130 }, value: script, placeholder: t('scriptPlaceholder'), onChange: e => setScript(e.target.value) }),
                ),
                h('div', null,
                  h('label', { style: S.label }, t('presetLabel')),
                  h('textarea', { style: { ...S.textarea, height: 170 }, value: preset, onChange: e => setPreset(e.target.value) }),
                ),
                h('div', { style: S.row },
                  h('button', { style: S.btn(true), disabled: busy, onClick: doGenerate }, busy ? t('generating') : t('generate')),
                  board ? h('button', { style: S.btn(false), onClick: copyBoard }, t('copy')) : null,
                ),
                board ? h('div', null,
                  h('label', { style: S.label }, t('storyboardResult')),
                  h('pre', { style: S.pre }, board),
                ) : null,
                h('div', { style: S.card },
                  h('div', { style: { ...S.label, fontWeight: 600, color: cssVars().text } }, `${t('assets')} (${assets.length})`),
                  h('div', { style: S.row },
                    h('select', { style: { ...S.input, width: 'auto', flex: 1 }, value: workspaceId, onChange: e => setWorkspaceId(e.target.value) },
                      (cfg?.workspaces || []).map(w => h('option', { key: w.id, value: w.id }, `${w.title} — ${w.path}`))),
                    h('button', { style: S.btn(false), onClick: refreshAssets }, t('refreshAssets')),
                  ),
                  assets.length === 0 ? h('div', { style: S.sub }, t('noAssets')) :
                    h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 } },
                      assets.map(a => h('button', {
                        key: a.path, style: S.chip(selected.includes(a.path)), onClick: () => toggleAsset(a.path),
                        title: a.path,
                      }, `${a.type === 'image' ? '🖼' : a.type === 'video' ? '🎬' : a.type === 'audio' ? '🔊' : '📄'} ${a.relative}`))),
                ),
              ) : null,

              tab === 'video' ? h(React.Fragment, null,
                h('div', { style: S.card },
                  h('div', { style: { ...S.label, fontWeight: 600, color: cssVars().text } }, t('submit')),
                  h('div', { style: { ...S.row, marginBottom: 8 } },
                    h('select', { style: { ...S.input, width: 'auto' }, value: form.provider, onChange: e => setForm(f => ({ ...f, provider: e.target.value })) },
                      h('option', { value: 'xiaoyunque' }, '小云雀 (xiaoyunque)'),
                      h('option', { value: 'dreamina' }, 'Dreamina'),
                    ),
                    h('input', { style: { ...S.input, width: 80 }, value: form.ratio, onChange: e => setForm(f => ({ ...f, ratio: e.target.value })), 'aria-label': t('ratio') }),
                    h('input', { style: { ...S.input, width: 90 }, type: 'number', min: 1, value: form.duration, onChange: e => setForm(f => ({ ...f, duration: e.target.value })), 'aria-label': t('duration') }),
                  ),
                  h('div', { style: { marginBottom: 8 } },
                    h('label', { style: S.label }, t('model')),
                    h('input', { style: S.input, value: form.model, onChange: e => setForm(f => ({ ...f, model: e.target.value })) }),
                  ),
                  h('div', { style: { marginBottom: 8 } },
                    h('label', { style: S.label }, t('prompt')),
                    h('textarea', { style: { ...S.textarea, height: 90 }, value: form.prompt || board, onChange: e => setForm(f => ({ ...f, prompt: e.target.value })) }),
                  ),
                  h('div', { style: { marginBottom: 8 } },
                    h('label', { style: S.label }, t('downloadTarget')),
                    h('input', { style: S.input, placeholder: t('defaultDownload'), value: form.targetDir, onChange: e => setForm(f => ({ ...f, targetDir: e.target.value })) }),
                  ),
                  h('div', { style: S.row },
                    h('button', { style: S.btn(true), disabled: busy, onClick: doSubmit }, t('submit')),
                  ),
                  h('div', { style: { marginTop: 8 } },
                    h('div', { style: { ...S.label, fontWeight: 600, color: cssVars().text } }, `${t('extraAssets')} (${selected.length})`),
                    selected.length === 0
                      ? h('div', { style: S.sub }, t('selectAssets') + ' — ' + t('tabStoryboard'))
                      : h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } }, selected.map(p =>
                          h('button', {
                            key: p,
                            style: { ...S.chip(true), fontSize: 11 },
                            title: '移除: ' + p,
                            onClick: () => toggleAsset(p),
                          }, '× ' + p.split(/[\\/]/).pop()),
                        )),
                  ),
                ),
                h('div', null,
                  h('div', { style: { ...S.label, fontWeight: 600, color: cssVars().text, marginBottom: 8 } }, t('jobs')),
                  jobs.length === 0 ? h('div', { style: S.sub }, t('none')) : jobs.map(j => h('div', { key: j.id, style: { ...S.card, marginBottom: 8 } },
                    h('div', { style: S.row },
                      h('span', { style: S.badge(j.status) }, j.status),
                      h('span', { style: { fontSize: 11, color: cssVars().sub } }, `${j.provider} · ${new Date(j.createdAt).toLocaleString()}`),
                    ),
                    h('div', { style: { fontSize: 12, margin: '6px 0', color: cssVars().sub } }, String(j.prompt || '').slice(0, 120)),
                    h('div', { style: S.row },
                      (j.status === 'succeeded' || j.status === 'completed') ? h('button', { style: S.btn(false), onClick: () => doDownload(j) }, t('download')) : null,
                      (j.status === 'running') ? h('button', { style: S.btn(false), onClick: async () => { await call('cancelJob', j.id); await refreshJobs() } }, t('cancel')) : null,
                      j.error ? h('span', { style: { color: cssVars().err, fontSize: 11 } }, j.error.slice(0, 160)) : null,
                    ),
                  )),
                ),
              ) : null,

              tab === 'settings' && cfg ? h(React.Fragment, null,
                [['geminiProvider', t('geminiProvider')], ['geminiModel', t('geminiModel')], ['geminiApiKeyRef', t('apiKeyRef')], ['xiaoyunqueCommand', t('xiaoyunque')], ['dreaminaCommand', t('dreamina')], ['downloadFolder', t('downloadFolder')]].map(([k, label]) =>
                  h('div', { key: k }, h('label', { style: S.label }, label), h('input', { style: S.input, value: cfg[k] ?? '', onChange: e => setCfg(c => ({ ...c, [k]: e.target.value })) })),
                ),
                h('div', null, h('label', { style: S.label }, t('presetRules')), h('textarea', { style: { ...S.textarea, height: 220 }, value: cfg.storyboardPreset || '', onChange: e => setCfg(c => ({ ...c, storyboardPreset: e.target.value })) })),
                h('div', { style: S.row }, h('button', { style: S.btn(true), onClick: doSave }, t('save'))),
              ) : null,
            ),
          )
        }

        const icon = ({ size }) => h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: cssVars().brand, strokeWidth: 1.8, 'aria-hidden': true },
          h('rect', { x: 3, y: 4, width: 18, height: 13, rx: 2 }),
          h('path', { d: 'M3 9h18M8 21h8M12 17v4' }),
          h('path', { d: 'M10 6.5l4 2.5-4 2.5z', fill: cssVars().brand, stroke: 'none' }),
        )

        const PANEL = 'dsh-short-drama'
        return ctx.effect(() => {
          ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL }, Panel))
          ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
            name: 'sidebar.panellist', id: PANEL, order: 40, label: () => t('panel'),
          }, icon))
          return async () => { await unmount() }
        }, 'dsh-short-drama: ui')
      },
    }
  },
})
