'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import ProjectPage from './ProjectPage'
import {
  STAGES, STAGE_META, PROJECT_STATUSES, STARTER_TASKS, fmtDate, fmtShort, todayISO,
  setupMessage, uiStyles, checkPassword, projectHealth, HEALTH_META, initials,
} from './projectConfig'

// ─────────────────────────────────────────────────────────────────────────────
// Projects workspace (Engineering Tools)
//  • Board (drag cards between stages) and Timeline views of all projects
//  • Each project opens a Notion-style page per stage: notes, checklist,
//    files & photos and links to Templates reports / Document Library
// SQL: supabase/projects.sql (run once)
// ─────────────────────────────────────────────────────────────────────────────

const VIEW_KEY = 'sos-projects-view'

const blankForm = () => ({
  name: '', client: '', site_name: '', location: '', capacity_kwp: '', battery_kwh: '', system_type: '',
  owner: '', stage: 'Site Visit', status: 'Active', start_date: todayISO(), target_date: '', description: '',
})

export default function ProjectsTool({ T, cardStyle, selectStyle, userName, sites = [] }) {
  const S = uiStyles(T, selectStyle)
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [view, setView] = useState('board')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('open') // open | all | <status>
  const [ownerFilter, setOwnerFilter] = useState('')
  const [openId, setOpenId] = useState(null)
  const [form, setForm] = useState(null) // { mode: 'add'|'edit', id, data, starter, saving, error }
  const [delProject, setDelProject] = useState(null)
  const [delPw, setDelPw] = useState('')
  const [delErr, setDelErr] = useState('')
  const [delBusy, setDelBusy] = useState(false)
  const [dragId, setDragId] = useState(null)
  const [dropStage, setDropStage] = useState(null)
  const [toast, setToast] = useState('')

  useEffect(() => { try { const v = localStorage.getItem(VIEW_KEY); if (v === 'board' || v === 'timeline') setView(v) } catch (e) { /* ignore */ } }, [])
  useEffect(() => { try { localStorage.setItem(VIEW_KEY, view) } catch (e) { /* ignore */ } }, [view])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 3500); return () => clearTimeout(t) }, [toast])

  async function load() {
    setLoadError('')
    const { data, error } = await supabase.from('projects').select('*, project_tasks(done, due_date)').order('target_date', { ascending: true, nullsFirst: false })
    if (error) { setLoadError(setupMessage(error)); setProjects([]) } else setProjects(data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const siteNames = useMemo(() => [...new Set((sites || []).map(s => s?.name?.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [sites])
  const owners = useMemo(() => [...new Set(projects.map(p => (p.owner || '').trim()).filter(Boolean))].sort(), [projects])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return projects.filter(p => (statusFilter === 'all' || (statusFilter === 'open' ? ['Active', 'On hold'].includes(p.status) : p.status === statusFilter))
      && (!ownerFilter || (p.owner || '').trim() === ownerFilter)
      && (!q || `${p.name} ${p.client || ''} ${p.site_name || ''} ${p.location || ''} ${p.owner || ''}`.toLowerCase().includes(q)))
  }, [projects, search, statusFilter, ownerFilter])

  const progress = p => {
    const t = p.project_tasks || []
    return { done: t.filter(x => x.done).length, total: t.length }
  }

  // ── create / edit ──
  const openAdd = (stage = 'Site Visit') => setForm({ mode: 'add', data: { ...blankForm(), stage }, starter: true, saving: false, error: '' })
  const openEdit = p => setForm({
    mode: 'edit', id: p.id, starter: false, saving: false, error: '',
    data: Object.fromEntries(Object.keys(blankForm()).map(k => [k, p[k] == null ? '' : String(p[k])])),
  })
  const setF = (k, v) => setForm(f => ({ ...f, data: { ...f.data, [k]: v } }))

  async function saveForm() {
    const f = form
    const d = f.data
    if (!d.name.trim()) { setForm(x => ({ ...x, error: 'Please give the project a name.' })); return }
    if (d.start_date && d.target_date && d.target_date < d.start_date) { setForm(x => ({ ...x, error: 'The target handover date is before the start date.' })); return }
    setForm(x => ({ ...x, saving: true, error: '' }))
    const num = v => (v === '' || v == null ? null : Number(v))
    const row = {
      name: d.name.trim(), client: d.client.trim() || null, site_name: d.site_name.trim() || null, location: d.location.trim() || null,
      capacity_kwp: num(d.capacity_kwp), battery_kwh: num(d.battery_kwh), system_type: d.system_type || null, owner: d.owner.trim() || null,
      stage: d.stage, status: d.status, start_date: d.start_date || null, target_date: d.target_date || null,
      description: d.description.trim() || null, updated_by: userName || null,
    }
    try {
      if (f.mode === 'add') {
        const { data, error } = await supabase.from('projects').insert([{ ...row, created_by: userName || null }]).select().single()
        if (error) throw error
        const idx = STAGES.indexOf(row.stage)
        const stageRows = STAGES.map((s, i) => ({ project_id: data.id, stage: s, status: i < idx ? 'Done' : i === idx ? 'In progress' : 'Not started', updated_by: userName || null }))
        const { error: sErr } = await supabase.from('project_stages').insert(stageRows)
        if (sErr) throw sErr
        if (f.starter) {
          const tasks = STAGES.flatMap(s => (STARTER_TASKS[s] || []).map((title, i) => ({ project_id: data.id, stage: s, title, sort: i, created_by: userName || null })))
          const { error: tErr } = await supabase.from('project_tasks').insert(tasks)
          if (tErr) throw tErr
        }
        setForm(null)
        setToast('Project created')
        await load()
        setOpenId(data.id)
      } else {
        const { error } = await supabase.from('projects').update(row).eq('id', f.id)
        if (error) throw error
        setForm(null)
        setToast('Project details saved')
        load()
      }
    } catch (e) {
      setForm(x => ({ ...x, saving: false, error: e.message || String(e) }))
    }
  }

  // ── move stage (board drag & drop, or from the project page) ──
  async function moveStage(p, stage) {
    if (!p || p.stage === stage) return
    setProjects(list => list.map(x => (x.id === p.id ? { ...x, stage } : x)))
    const { error } = await supabase.from('projects').update({ stage, updated_by: userName || null }).eq('id', p.id)
    if (error) { setToast(`Could not move: ${error.message}`); load(); return }
    const idx = STAGES.indexOf(stage)
    await supabase.from('project_stages').update({ status: 'In progress' }).eq('project_id', p.id).eq('stage', stage).eq('status', 'Not started')
    if (idx > STAGES.indexOf(p.stage)) setToast(`${p.name} moved to ${stage}`)
  }

  // ── delete (password confirm) ──
  async function confirmDelete() {
    if (!delPw) { setDelErr('Enter your password to delete.'); return }
    setDelBusy(true); setDelErr('')
    try {
      if (!(await checkPassword(supabase, delPw))) { setDelErr('Incorrect password. Nothing was deleted.'); return }
      const p = delProject
      const { data: files } = await supabase.from('project_files').select('file_path').eq('project_id', p.id)
      const { error } = await supabase.from('projects').delete().eq('id', p.id)
      if (error) throw error
      const paths = (files || []).map(f => f.file_path).filter(Boolean)
      if (paths.length) await supabase.storage.from('project-files').remove(paths)
      setDelProject(null); setOpenId(null); setToast('Project deleted'); load()
    } catch (e) { setDelErr(e.message || String(e)) } finally { setDelBusy(false) }
  }

  const openProject = projects.find(p => p.id === openId)

  // ── modals (shared by list and project page) ──
  const modals = (
    <>
      {form && (
        <div style={S.overlay} onClick={e => { if (e.target === e.currentTarget && !form.saving) setForm(null) }}>
          <div style={{ ...cardStyle, width: '100%', maxWidth: '640px', maxHeight: '90vh', overflowY: 'auto', padding: '22px' }}>
            <div style={{ fontSize: '16px', fontWeight: 800, color: T.textPrimary, marginBottom: '16px' }}>{form.mode === 'add' ? 'New project' : 'Edit project details'}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <div style={S.labelStyle}>Project name</div>
                <input autoFocus value={form.data.name} onChange={e => setF('name', e.target.value)} placeholder="e.g. Checkers Silverlakes 150 kWp" style={S.inp} />
              </div>
              <div><div style={S.labelStyle}>Client</div><input value={form.data.client} onChange={e => setF('client', e.target.value)} style={S.inp} /></div>
              <div>
                <div style={S.labelStyle}>Site (portfolio name)</div>
                <input list="proj-sites" value={form.data.site_name} onChange={e => setF('site_name', e.target.value)} placeholder="Pick or type" style={S.inp} />
                <datalist id="proj-sites">{siteNames.map(n => <option key={n} value={n} />)}</datalist>
              </div>
              <div><div style={S.labelStyle}>Location</div><input value={form.data.location} onChange={e => setF('location', e.target.value)} style={S.inp} /></div>
              <div><div style={S.labelStyle}>PV size (kWp)</div><input type="number" min="0" step="any" value={form.data.capacity_kwp} onChange={e => setF('capacity_kwp', e.target.value)} style={S.inp} /></div>
              <div><div style={S.labelStyle}>Battery (kWh)</div><input type="number" min="0" step="any" value={form.data.battery_kwh} onChange={e => setF('battery_kwh', e.target.value)} style={S.inp} /></div>
              <div>
                <div style={S.labelStyle}>Contract</div>
                <select value={form.data.system_type} onChange={e => setF('system_type', e.target.value)} style={{ ...selectStyle, width: '100%' }}>
                  <option value="">—</option><option>PPA</option><option>RTO</option><option>Cash</option><option>Other</option>
                </select>
              </div>
              <div>
                <div style={S.labelStyle}>Project owner</div>
                <input list="proj-owners" value={form.data.owner} onChange={e => setF('owner', e.target.value)} placeholder={userName || ''} style={S.inp} />
                <datalist id="proj-owners">{owners.map(n => <option key={n} value={n} />)}</datalist>
              </div>
              <div>
                <div style={S.labelStyle}>Current stage</div>
                <select value={form.data.stage} onChange={e => setF('stage', e.target.value)} style={{ ...selectStyle, width: '100%' }}>
                  {STAGES.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <div style={S.labelStyle}>Status</div>
                <select value={form.data.status} onChange={e => setF('status', e.target.value)} style={{ ...selectStyle, width: '100%' }}>
                  {PROJECT_STATUSES.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div><div style={S.labelStyle}>Start date</div><input type="date" value={form.data.start_date} onChange={e => setF('start_date', e.target.value)} style={S.inp} /></div>
              <div><div style={S.labelStyle}>Target handover</div><input type="date" value={form.data.target_date} onChange={e => setF('target_date', e.target.value)} style={S.inp} /></div>
              <div style={{ gridColumn: '1 / -1' }}>
                <div style={S.labelStyle}>Short description</div>
                <textarea rows={2} value={form.data.description} onChange={e => setF('description', e.target.value)} style={{ ...S.inp, resize: 'vertical', fontFamily: 'inherit' }} />
              </div>
              {form.mode === 'add' && (
                <label style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: T.textSecondary, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.starter} onChange={e => setForm(x => ({ ...x, starter: e.target.checked }))} />
                  Add the starter checklist for every stage (site visit, design, BOQ … handover). You can edit it afterwards.
                </label>
              )}
            </div>
            {form.error && <div style={{ marginTop: '12px', fontSize: '12px', color: T.red }}>{form.error}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '18px' }}>
              <button onClick={() => setForm(null)} disabled={form.saving} style={S.ghost}>Cancel</button>
              <button onClick={saveForm} disabled={form.saving} style={{ ...S.btn(T.blue), opacity: form.saving ? 0.6 : 1 }}>
                <i className="ti ti-check" />{form.saving ? 'Saving…' : form.mode === 'add' ? 'Create project' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {delProject && (
        <div style={S.overlay} onClick={e => { if (e.target === e.currentTarget && !delBusy) setDelProject(null) }}>
          <div style={{ ...cardStyle, width: '100%', maxWidth: '420px', padding: '22px' }}>
            <div style={{ fontSize: '16px', fontWeight: 800, color: T.textPrimary, marginBottom: '8px' }}>Delete project?</div>
            <div style={{ fontSize: '12px', color: T.textSecondary, marginBottom: '14px' }}>
              <b>{delProject.name}</b> and all its notes, checklists, files and links will be deleted. This can't be undone. Enter your portal password to confirm.
            </div>
            <input type="password" autoFocus value={delPw} onChange={e => setDelPw(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') confirmDelete() }} placeholder="Your password" style={S.inp} />
            {delErr && <div style={{ marginTop: '8px', fontSize: '12px', color: T.red }}>{delErr}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
              <button onClick={() => setDelProject(null)} disabled={delBusy} style={S.ghost}>Cancel</button>
              <button onClick={confirmDelete} disabled={delBusy} style={{ ...S.btn(T.red), opacity: delBusy ? 0.6 : 1 }}><i className="ti ti-trash" />{delBusy ? 'Checking…' : 'Delete project'}</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div style={{ position: 'fixed', bottom: '24px', right: '24px', background: T.isDark ? '#1f2d42' : '#1a2a4a', color: '#fff', padding: '10px 16px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, zIndex: 1100, boxShadow: '0 6px 20px rgba(0,0,0,0.25)' }}>{toast}</div>}
    </>
  )

  if (openProject) {
    return (
      <>
        <ProjectPage key={openProject.id} project={openProject} T={T} cardStyle={cardStyle} selectStyle={selectStyle} userName={userName} sites={sites}
          onBack={() => { setOpenId(null); load() }} onEdit={() => openEdit(openProject)} onDelete={() => { setDelPw(''); setDelErr(''); setDelProject(openProject) }}
          onMoveStage={s => moveStage(openProject, s)} onChanged={load} />
        {modals}
      </>
    )
  }

  // ── list views ──
  return (
    <div>
      {/* Toolbar */}
      <div style={{ ...cardStyle, padding: '12px 16px', marginBottom: '16px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' }}>
        <div style={{ display: 'inline-flex', border: `1px solid ${T.border}`, borderRadius: '8px', overflow: 'hidden' }}>
          {[['board', 'ti-layout-kanban', 'Board'], ['timeline', 'ti-timeline', 'Timeline']].map(([v, icon, label]) => (
            <button key={v} onClick={() => setView(v)} style={{ padding: '7px 13px', border: 'none', background: view === v ? T.blue : 'transparent', color: view === v ? '#fff' : T.textSecondary, fontSize: '12px', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <i className={`ti ${icon}`} />{label}
            </button>
          ))}
        </div>
        <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: '280px' }}>
          <i className="ti ti-search" style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: T.textMuted, fontSize: '14px' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search project, client, site…" style={{ ...S.inp, paddingLeft: '30px' }} />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={selectStyle}>
          <option value="open">Open (Active + On hold)</option>
          <option value="all">All projects</option>
          {PROJECT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={ownerFilter} onChange={e => setOwnerFilter(e.target.value)} style={selectStyle}>
          <option value="">All owners</option>
          {owners.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <span style={{ fontSize: '11px', color: T.textMuted, marginLeft: 'auto' }}>{filtered.length} of {projects.length} projects</span>
        <button onClick={() => openAdd()} disabled={!!loadError} style={{ ...S.btn(T.blue), opacity: loadError ? 0.5 : 1 }}><i className="ti ti-plus" />New project</button>
      </div>

      {!loading && !loadError && projects.length > 0 && (
        <PortfolioOverview projects={ownerFilter ? projects.filter(p => (p.owner || '').trim() === ownerFilter) : projects}
          owner={ownerFilter} T={T} cardStyle={cardStyle} />
      )}

      {loading ? (
        <div style={{ ...cardStyle, padding: '50px', textAlign: 'center', color: T.textSecondary, fontSize: '13px' }}>Loading projects…</div>
      ) : loadError ? (
        <div style={{ ...cardStyle, padding: '28px', textAlign: 'center', color: T.textSecondary, fontSize: '13px', borderLeft: `3px solid ${T.orange}` }}>
          <i className="ti ti-database-off" style={{ fontSize: '28px', color: T.orange, display: 'block', marginBottom: '8px' }} />{loadError}
        </div>
      ) : view === 'board' ? (
        <div style={{ display: 'flex', gap: '12px', overflowX: 'auto', paddingBottom: '10px', alignItems: 'flex-start' }}>
          {STAGES.map(stage => {
            const list = filtered.filter(p => p.stage === stage)
            const meta = STAGE_META[stage]
            const over = dropStage === stage && dragId
            return (
              <div key={stage}
                onDragOver={e => { e.preventDefault(); setDropStage(stage) }}
                onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDropStage(null) }}
                onDrop={e => { e.preventDefault(); setDropStage(null); const p = projects.find(x => x.id === dragId); setDragId(null); moveStage(p, stage) }}
                style={{ flex: '0 0 268px', background: over ? `${meta.color}14` : T.bgMuted, border: `1px ${over ? 'dashed' : 'solid'} ${over ? meta.color : T.border}`, borderRadius: '10px', padding: '10px', minHeight: '160px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '10px', padding: '2px 4px' }}>
                  <i className={`ti ${meta.icon}`} style={{ color: meta.color, fontSize: '15px' }} />
                  <span style={{ fontSize: '12px', fontWeight: 800, color: T.textPrimary }}>{stage}</span>
                  <span style={{ fontSize: '11px', color: T.textMuted }}>{list.length}</span>
                  <button onClick={() => openAdd(stage)} title={`New project in ${stage}`} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: T.textMuted, cursor: 'pointer', fontSize: '15px', padding: 0 }}><i className="ti ti-plus" /></button>
                </div>
                {list.map(p => (
                  <ProjectCard key={p.id} p={p} T={T} cardStyle={cardStyle} S={S} dimmed={dragId === p.id}
                    onDragStart={e => { setDragId(p.id); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', p.id) } catch (err) { /* ignore */ } }}
                    onDragEnd={() => { setDragId(null); setDropStage(null) }}
                    onOpen={() => setOpenId(p.id)} />
                ))}
                {list.length === 0 && <div style={{ fontSize: '11px', color: T.textMuted, textAlign: 'center', padding: '18px 6px' }}>{dragId ? 'Drop here' : 'No projects'}</div>}
              </div>
            )
          })}
        </div>
      ) : (
        <Timeline projects={filtered} T={T} cardStyle={cardStyle} onOpen={id => setOpenId(id)} />
      )}

      {!loading && !loadError && projects.length === 0 && (
        <div style={{ ...cardStyle, padding: '24px', textAlign: 'center', color: T.textSecondary, fontSize: '13px', marginTop: '12px' }}>
          No projects yet. Click <b>New project</b> to start one; it will move through Site Visit → Design → BOQ → Procurement → Installation → Quality Control → As-Built → Handover.
        </div>
      )}
      {modals}
    </div>
  )
}

// ── Timeline (Gantt-style) ─────────────────────────────────────────────────
function Timeline({ projects, T, cardStyle, onOpen }) {
  const DAY = 86400000
  const parse = d => new Date(d + 'T00:00:00').getTime()
  const rows = projects.map(p => {
    const start = p.start_date ? parse(p.start_date) : new Date(p.created_at).setHours(0, 0, 0, 0)
    const end = p.target_date ? parse(p.target_date) : start + 60 * DAY
    return { p, start, end: Math.max(end, start + DAY), estimated: !p.target_date }
  }).sort((a, b) => a.start - b.start)

  if (!rows.length) return <div style={{ ...cardStyle, padding: '40px', textAlign: 'center', color: T.textMuted, fontSize: '13px' }}>No projects to show.</div>

  const today = new Date().setHours(0, 0, 0, 0)
  const min0 = Math.min(today, ...rows.map(r => r.start))
  const max0 = Math.max(today, ...rows.map(r => r.end))
  const first = new Date(min0); first.setDate(1)
  const last = new Date(max0); last.setMonth(last.getMonth() + 1, 1)
  const months = []
  for (const d = new Date(first); d < last; d.setMonth(d.getMonth() + 1)) months.push(new Date(d))
  const span = last.getTime() - first.getTime()
  const pct = t => `${((t - first.getTime()) / span) * 100}%`
  const LABEL_W = 230
  const MONTH_W = 90

  return (
    <div style={{ ...cardStyle, overflowX: 'auto' }}>
      <div style={{ minWidth: LABEL_W + months.length * MONTH_W }}>
        <div style={{ display: 'flex', borderBottom: `1px solid ${T.border}`, background: T.bgMuted, position: 'sticky', top: 0 }}>
          <div style={{ width: LABEL_W, flexShrink: 0, padding: '9px 14px', fontSize: '10px', fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.6px' }}>Project</div>
          <div style={{ flex: 1, display: 'flex' }}>
            {months.map(m => (
              <div key={m.toISOString()} style={{ flex: 1, padding: '9px 6px', fontSize: '10px', fontWeight: 700, color: T.textMuted, borderLeft: `1px solid ${T.border}`, whiteSpace: 'nowrap' }}>
                {m.toLocaleDateString('en-ZA', { month: 'short', year: '2-digit' })}
              </div>
            ))}
          </div>
        </div>
        {rows.map(({ p, start, end, estimated }) => {
          const meta = STAGE_META[p.stage] || STAGE_META['Site Visit']
          const stagePct = ((STAGES.indexOf(p.stage) + (p.status === 'Complete' ? 1 : 0.5)) / STAGES.length) * 100
          const late = p.target_date && end < today && p.status !== 'Complete'
          const h = projectHealth(p)
          const hm = HEALTH_META[h.key]
          return (
            <div key={p.id} className="tbl-row" onClick={() => onOpen(p.id)} style={{ display: 'flex', borderBottom: `1px solid ${T.border}`, cursor: 'pointer' }}>
              <div style={{ width: LABEL_W, flexShrink: 0, padding: '9px 14px', minWidth: 0 }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: T.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span title={[hm.label, ...h.reasons].join(' · ')} style={{ width: 8, height: 8, borderRadius: '50%', background: hm.color(T), flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
                </div>
                <div style={{ fontSize: '10px', color: T.textMuted, display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <i className={`ti ${meta.icon}`} style={{ color: meta.color }} />{p.stage}{p.owner ? ` · ${p.owner}` : ''}
                </div>
              </div>
              <div style={{ flex: 1, position: 'relative', minHeight: '44px', backgroundImage: `repeating-linear-gradient(to right, transparent, transparent calc(${100 / months.length}% - 1px), ${T.border} calc(${100 / months.length}% - 1px), ${T.border} ${100 / months.length}%)` }}>
                {today >= first.getTime() && today <= last.getTime() && <div title="Today" style={{ position: 'absolute', top: 0, bottom: 0, left: pct(today), width: '2px', background: T.red, opacity: 0.55, pointerEvents: 'none' }} />}
                <div title={`${fmtDate(p.start_date)} → ${p.target_date ? fmtDate(p.target_date) : 'no target date'}`}
                  style={{ position: 'absolute', top: '11px', height: '22px', left: pct(start), width: `calc(${pct(end)} - ${pct(start)})`, minWidth: '6px', borderRadius: '6px', background: `${meta.color}33`, border: `1px ${estimated ? 'dashed' : 'solid'} ${late ? T.red : meta.color}`, overflow: 'hidden' }}>
                  <div style={{ width: `${stagePct}%`, height: '100%', background: meta.color, opacity: 0.85 }} />
                </div>
              </div>
            </div>
          )
        })}
      </div>
      <div style={{ padding: '8px 14px', fontSize: '10px', color: T.textMuted, display: 'flex', gap: '14px', flexWrap: 'wrap', borderTop: `1px solid ${T.border}` }}>
        <span><span style={{ display: 'inline-block', width: 10, height: 2, background: T.red, verticalAlign: 'middle', marginRight: 4 }} />Today</span>
        <span>Filled part of a bar = how far through the 8 stages</span>
        <span>Dashed bar = no target date yet (60 days shown)</span>
        {['ok', 'risk', 'late'].map(k => <span key={k}><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: HEALTH_META[k].color(T), marginRight: 4, verticalAlign: 'middle' }} />{HEALTH_META[k].label}</span>)}
      </div>
    </div>
  )
}

// ── Board card ───────────────────────────────────────────────────────────────
function ProgressRing({ pct, color, track, size = 34, label }) {
  const r = (size - 5) / 2
  const c = 2 * Math.PI * r
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }} role="img" aria-label={label}>
      <title>{label}</title>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth="4" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round"
        strokeDasharray={`${(c * pct) / 100} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" style={{ fontSize: '9px', fontWeight: 800, fill: color }}>{pct}%</text>
    </svg>
  )
}

function ProjectCard({ p, T, cardStyle, S, dimmed, onDragStart, onDragEnd, onOpen }) {
  const meta = STAGE_META[p.stage] || STAGE_META['Site Visit']
  const h = projectHealth(p)
  const hm = HEALTH_META[h.key]
  const hColor = hm.color(T)
  const taskPct = h.tasksTotal ? Math.round((h.tasksDone / h.tasksTotal) * 100) : 0
  const complete = p.status === 'Complete'

  let dueText = 'No target date'
  let dueColor = T.textMuted
  if (complete) { dueText = p.target_date ? `Target ${fmtShort(p.target_date)}` : 'Handed over'; dueColor = T.green }
  else if (h.daysLeft != null) {
    dueText = h.daysLeft < 0 ? `${-h.daysLeft}d late` : h.daysLeft === 0 ? 'Due today' : `${h.daysLeft}d left`
    dueColor = h.daysLeft < 0 ? T.red : h.daysLeft <= 14 ? T.orange : T.textSecondary
  }
  const tip = [hm.label, ...h.reasons].join('\n')

  return (
    <div draggable onDragStart={onDragStart} onDragEnd={onDragEnd} onClick={onOpen}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
      role="button" tabIndex={0}
      style={{ ...cardStyle, padding: '11px 12px', marginBottom: '8px', cursor: 'pointer', borderLeft: `3px solid ${hColor}`, opacity: dimmed ? 0.5 : 1 }}>

      {/* Title + ring */}
      <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: T.textPrimary, lineHeight: 1.3, wordBreak: 'break-word' }}>{p.name}</div>
          <div style={{ fontSize: '11px', color: T.textMuted, marginTop: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {[p.client, p.site_name && p.site_name !== p.client ? p.site_name : null].filter(Boolean).join(' · ') || '—'}
          </div>
        </div>
        {h.tasksTotal > 0 && <ProgressRing pct={taskPct} color={taskPct === 100 ? T.green : T.blue} track={T.bgMuted} label={`${h.tasksDone} of ${h.tasksTotal} tasks done`} />}
      </div>

      {/* Size chips */}
      {(p.capacity_kwp || p.battery_kwh || p.system_type) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginTop: '8px' }}>
          {p.capacity_kwp ? <span style={S.badge(T.blue)}><i className="ti ti-solar-panel" />{Number(p.capacity_kwp).toLocaleString()} kWp</span> : null}
          {p.battery_kwh ? <span style={S.badge(T.green)}><i className="ti ti-battery-charging" />{Number(p.battery_kwh).toLocaleString()} kWh</span> : null}
          {p.system_type ? <span style={S.badge(T.textSecondary)}>{p.system_type}</span> : null}
        </div>
      )}

      {/* Stage strip */}
      <div title={`Stage ${h.stageIdx + 1} of ${STAGES.length}: ${p.stage}`} style={{ display: 'flex', gap: '2px', marginTop: '10px' }}>
        {STAGES.map((s, i) => {
          const filled = complete || i < h.stageIdx
          const current = !complete && i === h.stageIdx
          return <div key={s} style={{ flex: 1, height: '4px', borderRadius: '2px', background: filled ? STAGE_META[s].color : current ? `${meta.color}88` : T.bgMuted }} />
        })}
      </div>

      {/* Health, due, owner */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginTop: '9px', alignItems: 'center' }}>
        <span title={tip} style={S.badge(hColor)}><i className={`ti ${hm.icon}`} />{hm.label}</span>
        <span style={{ fontSize: '10px', fontWeight: 700, color: dueColor, display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
          <i className="ti ti-calendar" />{dueText}
        </span>
        {p.owner && (
          <span title={p.owner} style={{ marginLeft: 'auto', width: '22px', height: '22px', borderRadius: '50%', background: `${T.blue}22`, color: T.blue, fontSize: '9px', fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {initials(p.owner)}
          </span>
        )}
      </div>

      {/* Tasks line */}
      {h.tasksTotal > 0 && (
        <div style={{ fontSize: '10px', color: T.textMuted, marginTop: '7px', display: 'flex', alignItems: 'center', gap: '4px' }}>
          <i className="ti ti-checkbox" />{h.tasksDone}/{h.tasksTotal} tasks
          {h.overdue > 0 && <span style={{ color: T.red, fontWeight: 700 }}>· {h.overdue} overdue</span>}
        </div>
      )}
    </div>
  )
}

// ── Portfolio overview (KPI tiles + stage distribution) ─────────────────────
const OVERVIEW_KEY = 'sos-projects-overview-open'
const MODE_KEY = 'sos-projects-overview-mode'
const fmtNum = n => Number(n || 0).toLocaleString('en-ZA', { maximumFractionDigits: 1 })
const fmtKw = kw => (kw >= 1000 ? `${fmtNum(kw / 1000)} MWp` : `${fmtNum(kw)} kWp`)

function PortfolioOverview({ projects, owner, T, cardStyle }) {
  const [open, setOpen] = useState(true)
  const [mode, setMode] = useState('count') // count | kwp
  const [hoverStage, setHoverStage] = useState(null)
  useEffect(() => { try { if (localStorage.getItem(OVERVIEW_KEY) === '0') setOpen(false); if (localStorage.getItem(MODE_KEY) === 'kwp') setMode('kwp') } catch (e) { /* ignore */ } }, [])
  const toggle = () => setOpen(o => { try { localStorage.setItem(OVERVIEW_KEY, o ? '0' : '1') } catch (e) { /* ignore */ } return !o })
  const pickMode = m => { setMode(m); try { localStorage.setItem(MODE_KEY, m) } catch (e) { /* ignore */ } }

  const k = useMemo(() => {
    const now = new Date()
    const ym = now.toISOString().slice(0, 7)
    const live = projects.filter(p => p.status === 'Active' || p.status === 'On hold')
    const active = projects.filter(p => p.status === 'Active')
    const withH = live.map(p => ({ p, h: projectHealth(p, now) }))
    const health = { ok: 0, risk: 0, late: 0 }
    withH.forEach(({ h }) => { if (health[h.key] != null) health[h.key]++ })
    const overdueProjects = withH.filter(x => x.h.overdue > 0)
    const dueMonth = live.filter(p => (p.target_date || '').slice(0, 7) === ym).sort((a, b) => a.target_date.localeCompare(b.target_date))
    const nextDue = dueMonth.find(p => p.target_date >= now.toISOString().slice(0, 10))
    const byStage = STAGES.map(stage => {
      const list = live.filter(p => p.stage === stage)
      return { stage, count: list.length, kwp: list.reduce((a, p) => a + (Number(p.capacity_kwp) || 0), 0) }
    })
    return {
      active: active.length, hold: live.length - active.length, complete: projects.filter(p => p.status === 'Complete').length,
      kwp: live.reduce((a, p) => a + (Number(p.capacity_kwp) || 0), 0),
      kwh: live.reduce((a, p) => a + (Number(p.battery_kwh) || 0), 0),
      health, overdueTasks: overdueProjects.reduce((a, x) => a + x.h.overdue, 0), overdueProjects: overdueProjects.length,
      dueMonth, nextDue, byStage, liveCount: live.length,
      monthName: now.toLocaleDateString('en-ZA', { month: 'long' }),
    }
  }, [projects])

  const label = { fontSize: '10px', fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.6px' }
  const Tile = ({ icon, color, title, value, sub, children }) => (
    <div style={{ ...cardStyle, padding: '12px 14px', minWidth: 0, borderTop: `3px solid ${color}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', ...label }}><i className={`ti ${icon}`} style={{ color, fontSize: '14px' }} />{title}</div>
      <div style={{ fontSize: '24px', fontWeight: 800, color: T.textPrimary, marginTop: '6px', lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: '11px', color: T.textSecondary, marginTop: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</div>}
      {children}
    </div>
  )

  const atRisk = k.health.risk + k.health.late
  const totalH = k.health.ok + k.health.risk + k.health.late
  const metric = s => (mode === 'kwp' ? s.kwp : s.count)
  const total = k.byStage.reduce((a, s) => a + metric(s), 0)

  return (
    <div style={{ marginBottom: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: open ? '10px' : 0 }}>
        <button onClick={toggle} aria-expanded={open} style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px', ...label, fontSize: '11px', color: T.textSecondary }}>
          <i className={`ti ${open ? 'ti-chevron-down' : 'ti-chevron-right'}`} />Portfolio overview{owner ? ` · ${owner}` : ''}
        </button>
        {!open && (
          <span style={{ fontSize: '11px', color: T.textMuted }}>
            {k.active} active · {fmtKw(k.kwp)} · <span style={{ color: atRisk ? T.orange : T.textMuted }}>{atRisk} at risk or late</span>
          </span>
        )}
      </div>

      {open && (
        <>
          <style>{`@media (max-width: 640px) { .proj-kpis { grid-template-columns: 1fr 1fr !important; } .proj-kpis > :last-child:nth-child(odd) { grid-column: 1 / -1; } }`}</style>
          <div className="proj-kpis" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '10px' }}>
            <Tile icon="ti-briefcase" color={T.blue} title="Active projects" value={k.active}
              sub={[k.hold ? `${k.hold} on hold` : null, `${k.complete} complete`].filter(Boolean).join(' · ')} />
            <Tile icon="ti-solar-panel" color={T.orange} title="Pipeline" value={fmtKw(k.kwp)}
              sub={k.kwh ? `+ ${fmtNum(k.kwh)} kWh storage` : 'Active + on hold'} />
            <Tile icon="ti-heartbeat" color={atRisk ? T.red : T.green} title="At risk / late" value={atRisk}
              sub={totalH ? `${k.health.ok} on track · ${k.health.risk} at risk · ${k.health.late} late` : 'No active projects'}>
              {totalH > 0 && (
                <div style={{ display: 'flex', height: '5px', borderRadius: '3px', overflow: 'hidden', marginTop: '8px', background: T.bgMuted }}>
                  {[['ok', T.green], ['risk', T.orange], ['late', T.red]].map(([key, c]) => k.health[key] ? <div key={key} style={{ width: `${(k.health[key] / totalH) * 100}%`, background: c }} /> : null)}
                </div>
              )}
            </Tile>
            <Tile icon="ti-alarm" color={k.overdueTasks ? T.red : T.green} title="Overdue tasks" value={k.overdueTasks}
              sub={k.overdueTasks ? `Across ${k.overdueProjects} project${k.overdueProjects === 1 ? '' : 's'}` : 'Nothing overdue'} />
            <Tile icon="ti-flag-check" color={T.green} title={`Handovers in ${k.monthName}`} value={k.dueMonth.length}
              sub={k.nextDue ? `Next: ${k.nextDue.name} · ${fmtShort(k.nextDue.target_date)}` : k.dueMonth.length ? `${k.dueMonth.length === 1 ? 'Already' : 'All'} past target date` : 'None due this month'} />
          </div>

          <div style={{ ...cardStyle, padding: '12px 14px', marginTop: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '9px' }}>
              <span style={label}>Projects by stage</span>
              <span style={{ fontSize: '11px', color: T.textMuted }}>{k.liveCount} active + on hold</span>
              <div style={{ marginLeft: 'auto', display: 'inline-flex', border: `1px solid ${T.border}`, borderRadius: '6px', overflow: 'hidden' }}>
                {[['count', 'Count'], ['kwp', 'kWp']].map(([m, l]) => (
                  <button key={m} onClick={() => pickMode(m)} style={{ padding: '4px 10px', border: 'none', fontSize: '11px', fontWeight: 700, cursor: 'pointer', background: mode === m ? T.blue : 'transparent', color: mode === m ? '#fff' : T.textSecondary }}>{l}</button>
                ))}
              </div>
            </div>
            {total > 0 ? (
              <div style={{ display: 'flex', height: '14px', borderRadius: '7px', overflow: 'hidden', background: T.bgMuted, gap: '2px' }}>
                {k.byStage.filter(s => metric(s) > 0).map(s => (
                  <div key={s.stage} title={`${s.stage}: ${s.count} project${s.count === 1 ? '' : 's'} · ${fmtKw(s.kwp)}`}
                    onMouseEnter={() => setHoverStage(s.stage)} onMouseLeave={() => setHoverStage(null)}
                    style={{ width: `${(metric(s) / total) * 100}%`, background: STAGE_META[s.stage].color, opacity: hoverStage && hoverStage !== s.stage ? 0.35 : 1, transition: 'opacity .15s' }} />
                ))}
              </div>
            ) : <div style={{ fontSize: '11px', color: T.textMuted }}>{mode === 'kwp' ? 'No kWp entered on active projects.' : 'No active projects.'}</div>}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginTop: '9px' }}>
              {k.byStage.map(s => (
                <span key={s.stage} onMouseEnter={() => setHoverStage(s.stage)} onMouseLeave={() => setHoverStage(null)}
                  style={{ fontSize: '11px', color: metric(s) ? T.textSecondary : T.textMuted, display: 'inline-flex', alignItems: 'center', gap: '5px', opacity: hoverStage && hoverStage !== s.stage ? 0.5 : 1 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: STAGE_META[s.stage].color }} />
                  {s.stage} <b style={{ color: T.textPrimary }}>{mode === 'kwp' ? fmtKw(s.kwp) : s.count}</b>
                </span>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
