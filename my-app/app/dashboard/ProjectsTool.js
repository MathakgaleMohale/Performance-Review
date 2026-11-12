'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
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
const ZOOM_KEY = 'sos-projects-timeline-zoom'
const VIEWS = [['board', 'ti-layout-kanban', 'Board'], ['list', 'ti-list-details', 'List'], ['timeline', 'ti-timeline', 'Timeline']]

// true when the screen is at most `max` px wide (phone layout = 640, same as page.js)
function useNarrow(max = 640) {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia(`(max-width: ${max}px)`)
    const on = () => setNarrow(mq.matches)
    on()
    mq.addEventListener ? mq.addEventListener('change', on) : mq.addListener(on)
    return () => { mq.removeEventListener ? mq.removeEventListener('change', on) : mq.removeListener(on) }
  }, [max])
  return narrow
}

// Responsive rules for the Projects tab (phone ≤ 640 px, tablet ≤ 1024 px)
const RESPONSIVE_CSS = `
.proj-filter-toggle { display: none !important; }
@media (max-width: 1024px) {
  .proj-toolbar .proj-search { max-width: none !important; }
}
@media (max-width: 640px) {
  .proj-toolbar { padding: 10px 12px !important; gap: 8px !important; }
  .proj-toolbar .proj-views { flex: 1 1 100%; }
  .proj-toolbar .proj-views button { flex: 1; justify-content: center; }
  .proj-toolbar .proj-search { flex: 1 1 100% !important; }
  .proj-toolbar .proj-sort { flex: 1 1 auto; min-width: 0; }
  .proj-toolbar .proj-sort select { width: 100%; min-width: 0; }
  .proj-toolbar .proj-count { display: none; }
  .proj-filter-toggle { display: inline-flex !important; }
  .proj-filter-row { display: none !important; }
  .proj-filter-row.open { display: grid !important; grid-template-columns: 1fr 1fr; }
  .proj-filter-row.open > select, .proj-filter-row.open > button { width: 100%; min-width: 0; justify-content: center; }
  .proj-filter-row .proj-filter-label { display: none !important; }
  .proj-board { scroll-snap-type: x mandatory; scroll-padding-left: 2px; }
  .proj-board > .proj-col { flex: 0 0 86% !important; scroll-snap-align: start; }
  .proj-toast { left: 16px !important; right: 16px !important; bottom: calc(76px + env(safe-area-inset-bottom)) !important; text-align: center; }
}
`
const FILTER_KEY = 'sos-projects-filters'

const DEFAULT_FILTERS = { status: 'open', owner: '', stage: '', health: '', due: '', overdue: false, sort: 'target' }

const HEALTH_FILTERS = [['', 'Any health'], ['riskOrLate', 'At risk or late'], ['ok', 'On track'], ['risk', 'At risk'], ['late', 'Late']]
const DUE_FILTERS = [['', 'Any handover date'], ['month', 'Handover this month'], ['30', 'Handover in next 30 days'], ['past', 'Past target date'], ['none', 'No target date']]
const SORTS = [
  ['target', 'Target handover (soonest)'], ['start', 'Start date'], ['updated', 'Recently updated'], ['health', 'Health (worst first)'],
  ['progress', 'Task progress (lowest first)'], ['size', 'Size (largest kWp)'], ['name', 'Name (A–Z)'],
]
const HEALTH_RANK = { late: 0, risk: 1, ok: 2, hold: 3, complete: 4, cancelled: 5 }

function sortProjects(list, sort) {
  const withH = list.map(p => ({ p, h: projectHealth(p) }))
  const nullLast = (a, b) => (a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : 0)
  const cmp = {
    target: (a, b) => nullLast(a.p.target_date, b.p.target_date) || (a.p.target_date || '').localeCompare(b.p.target_date || ''),
    start: (a, b) => nullLast(a.p.start_date, b.p.start_date) || (a.p.start_date || '').localeCompare(b.p.start_date || ''),
    updated: (a, b) => String(b.p.updated_at || b.p.created_at || '').localeCompare(String(a.p.updated_at || a.p.created_at || '')),
    health: (a, b) => (HEALTH_RANK[a.h.key] - HEALTH_RANK[b.h.key]) || (b.h.overdue - a.h.overdue) || ((a.h.daysLeft ?? 1e9) - (b.h.daysLeft ?? 1e9)),
    progress: (a, b) => (a.h.tasksTotal ? a.h.tasksDone / a.h.tasksTotal : 1) - (b.h.tasksTotal ? b.h.tasksDone / b.h.tasksTotal : 1),
    size: (a, b) => (Number(b.p.capacity_kwp) || 0) - (Number(a.p.capacity_kwp) || 0),
    name: (a, b) => (a.p.name || '').localeCompare(b.p.name || ''),
  }[sort] || (() => 0)
  return withH.sort((a, b) => cmp(a, b) || (a.p.name || '').localeCompare(b.p.name || '')).map(x => x.p)
}

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
  const [filters, setFilters] = useState(DEFAULT_FILTERS) // status: open | all | <status>
  const setFilter = (k, v) => setFilters(f => ({ ...f, [k]: v }))
  const ownerFilter = filters.owner
  const [openId, setOpenId] = useState(null)
  const [form, setForm] = useState(null) // { mode: 'add'|'edit', id, data, starter, saving, error }
  const [delProject, setDelProject] = useState(null)
  const [delPw, setDelPw] = useState('')
  const [delErr, setDelErr] = useState('')
  const [delBusy, setDelBusy] = useState(false)
  const [dragId, setDragId] = useState(null)
  const [dropStage, setDropStage] = useState(null)
  const [toast, setToast] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false) // phones only; always shown on larger screens
  const narrow = useNarrow()
  const boardRef = useRef(null)
  const [boardIdx, setBoardIdx] = useState(0)

  useEffect(() => { try { const v = localStorage.getItem(VIEW_KEY); if (VIEWS.some(x => x[0] === v)) setView(v) } catch (e) { /* ignore */ } }, [])
  useEffect(() => { try { localStorage.setItem(VIEW_KEY, view) } catch (e) { /* ignore */ } }, [view])
  useEffect(() => { try { const f = JSON.parse(localStorage.getItem(FILTER_KEY) || 'null'); if (f && typeof f === 'object') setFilters({ ...DEFAULT_FILTERS, ...f }) } catch (e) { /* ignore */ } }, [])
  useEffect(() => { try { localStorage.setItem(FILTER_KEY, JSON.stringify(filters)) } catch (e) { /* ignore */ } }, [filters])
  // Press "/" anywhere on the list to jump to the search box
  useEffect(() => {
    const onKey = e => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      const el = document.getElementById('proj-search')
      if (el) { e.preventDefault(); el.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
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
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const { status, owner, stage, health, due, overdue, sort } = filters
    const now = new Date()
    const today = now.toISOString().slice(0, 10)
    const ym = today.slice(0, 7)
    const in30 = new Date(now.getTime() + 30 * 86400000).toISOString().slice(0, 10)
    const list = projects.filter(p => {
      if (!(status === 'all' || (status === 'open' ? ['Active', 'On hold'].includes(p.status) : p.status === status))) return false
      if (owner && (p.owner || '').trim() !== owner) return false
      if (stage && p.stage !== stage) return false
      if (words.length) {
        const hay = [p.name, p.client, p.site_name, p.location, p.owner, p.system_type, p.description, p.stage].filter(Boolean).join(' ').toLowerCase()
        if (!words.every(w => hay.includes(w))) return false
      }
      if (health || overdue) {
        const h = projectHealth(p, now)
        if (health === 'riskOrLate' ? !['risk', 'late'].includes(h.key) : health && h.key !== health) return false
        if (overdue && !h.overdue) return false
      }
      const t = p.target_date || ''
      const open = p.status !== 'Complete' && p.status !== 'Cancelled'
      if (due === 'month' && t.slice(0, 7) !== ym) return false
      if (due === '30' && !(t && t >= today && t <= in30)) return false
      if (due === 'past' && !(t && t < today && open)) return false
      if (due === 'none' && t) return false
      return true
    })
    return sortProjects(list, sort)
  }, [projects, search, filters])

  const activeChips = [
    filters.status !== DEFAULT_FILTERS.status && { k: 'status', label: filters.status === 'all' ? 'All statuses' : filters.status },
    filters.owner && { k: 'owner', label: `Owner: ${filters.owner}` },
    filters.stage && { k: 'stage', label: `Stage: ${filters.stage}` },
    filters.health && { k: 'health', label: HEALTH_FILTERS.find(x => x[0] === filters.health)?.[1] },
    filters.due && { k: 'due', label: DUE_FILTERS.find(x => x[0] === filters.due)?.[1] },
    filters.overdue && { k: 'overdue', label: 'Has overdue tasks' },
    search.trim() && { k: 'search', label: `“${search.trim()}”` },
  ].filter(Boolean)
  const clearChip = k => (k === 'search' ? setSearch('') : setFilter(k, DEFAULT_FILTERS[k]))
  const clearAll = () => { setSearch(''); setFilters(f => ({ ...DEFAULT_FILTERS, sort: f.sort })) }
  // From the overview tiles / stage bar: show open projects matching one thing
  const quickFilter = patch => { setSearch(''); setFilters(f => ({ ...DEFAULT_FILTERS, owner: f.owner, sort: f.sort, ...patch })) }

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

      {toast && <div className="proj-toast" role="status" style={{ position: 'fixed', bottom: '24px', right: '24px', background: T.isDark ? '#1f2d42' : '#1a2a4a', color: '#fff', padding: '10px 16px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, zIndex: 1100, boxShadow: '0 6px 20px rgba(0,0,0,0.25)' }}>{toast}</div>}
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
      <style>{RESPONSIVE_CSS}</style>
      {/* Toolbar */}
      <div className="proj-toolbar" style={{ ...cardStyle, padding: '12px 16px', marginBottom: '16px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' }}>
        <div className="proj-views" role="tablist" aria-label="View" style={{ display: 'inline-flex', border: `1px solid ${T.border}`, borderRadius: '8px', overflow: 'hidden' }}>
          {VIEWS.map(([v, icon, label]) => (
            <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)} style={{ padding: '7px 13px', border: 'none', background: view === v ? T.blue : 'transparent', color: view === v ? '#fff' : T.textSecondary, fontSize: '12px', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <i className={`ti ${icon}`} />{label}
            </button>
          ))}
        </div>
        <div className="proj-search" style={{ position: 'relative', flex: '1 1 220px', maxWidth: '340px' }}>
          <i className="ti ti-search" style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: T.textMuted, fontSize: '14px' }} />
          <input id="proj-search" type="search" value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') { setSearch(''); e.currentTarget.blur() } }}
            placeholder={narrow ? 'Search projects…' : 'Search name, client, site, owner…  ( / )'} aria-label="Search projects" style={{ ...S.inp, paddingLeft: '30px' }} />
        </div>
        <label className="proj-sort" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: T.textMuted }}>
          <i className="ti ti-arrows-sort" />
          <select value={filters.sort} onChange={e => setFilter('sort', e.target.value)} aria-label="Sort projects" style={selectStyle}>
            {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <span className="proj-count" style={{ fontSize: '11px', color: T.textMuted, marginLeft: 'auto' }}>{filtered.length} of {projects.length} projects</span>
        <button className="proj-filter-toggle" onClick={() => setFiltersOpen(o => !o)} aria-expanded={filtersOpen} style={S.chip(filtersOpen || activeChips.some(c => c.k !== 'search'))}>
          <i className="ti ti-filter" />Filters{activeChips.filter(c => c.k !== 'search').length ? ` (${activeChips.filter(c => c.k !== 'search').length})` : ''}
        </button>
        <button onClick={() => openAdd()} aria-label="New project" disabled={!!loadError} style={{ ...S.btn(T.blue), opacity: loadError ? 0.5 : 1 }}><i className="ti ti-plus" />New project</button>

        {/* Filter row */}
        <div className={`proj-filter-row${filtersOpen ? ' open' : ''}`} style={{ flexBasis: '100%', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', paddingTop: '10px', borderTop: `1px solid ${T.border}` }}>
          <span className="proj-filter-label" style={{ ...S.labelStyle, marginBottom: 0, display: 'inline-flex', alignItems: 'center', gap: '4px' }}><i className="ti ti-filter" />Filter</span>
          <select value={filters.status} onChange={e => setFilter('status', e.target.value)} aria-label="Status" style={selectStyle}>
            <option value="open">Open (Active + On hold)</option>
            <option value="all">All projects</option>
            {PROJECT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={filters.owner} onChange={e => setFilter('owner', e.target.value)} aria-label="Owner" style={selectStyle}>
            <option value="">All owners</option>
            {owners.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
          <select value={filters.stage} onChange={e => setFilter('stage', e.target.value)} aria-label="Stage" style={selectStyle}>
            <option value="">All stages</option>
            {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={filters.health} onChange={e => setFilter('health', e.target.value)} aria-label="Health" style={selectStyle}>
            {HEALTH_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select value={filters.due} onChange={e => setFilter('due', e.target.value)} aria-label="Handover date" style={selectStyle}>
            {DUE_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <button onClick={() => setFilter('overdue', !filters.overdue)} aria-pressed={filters.overdue} style={S.chip(filters.overdue, T.red)}>
            <i className="ti ti-alarm" />Overdue tasks
          </button>
        </div>

        {activeChips.length > 0 && (
          <div style={{ flexBasis: '100%', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' }}>
            {narrow && <span style={{ fontSize: '11px', color: T.textMuted }}>{filtered.length} of {projects.length}</span>}
            {activeChips.map(c => (
              <span key={c.k} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '3px 4px 3px 10px', borderRadius: '999px', background: `${T.blue}14`, border: `1px solid ${T.blue}44`, color: T.blue, fontSize: '11px', fontWeight: 700 }}>
                {c.label}
                <button onClick={() => clearChip(c.k)} aria-label={`Remove filter ${c.label}`} style={{ background: 'transparent', border: 'none', color: T.blue, cursor: 'pointer', padding: '0 4px', fontSize: '13px', lineHeight: 1, display: 'inline-flex' }}><i className="ti ti-x" /></button>
              </span>
            ))}
            <button onClick={clearAll} style={{ background: 'transparent', border: 'none', color: T.textSecondary, cursor: 'pointer', fontSize: '11px', fontWeight: 700, textDecoration: 'underline' }}>Clear all</button>
          </div>
        )}
      </div>

      {!loading && !loadError && projects.length > 0 && (
        <PortfolioOverview projects={ownerFilter ? projects.filter(p => (p.owner || '').trim() === ownerFilter) : projects}
          owner={ownerFilter} T={T} cardStyle={cardStyle} filters={filters} onQuickFilter={quickFilter} />
      )}

      {loading ? (
        <div style={{ ...cardStyle, padding: '50px', textAlign: 'center', color: T.textSecondary, fontSize: '13px' }}>Loading projects…</div>
      ) : loadError ? (
        <div style={{ ...cardStyle, padding: '28px', textAlign: 'center', color: T.textSecondary, fontSize: '13px', borderLeft: `3px solid ${T.orange}` }}>
          <i className="ti ti-database-off" style={{ fontSize: '28px', color: T.orange, display: 'block', marginBottom: '8px' }} />{loadError}
        </div>
      ) : view === 'board' ? (
        <>
        {narrow && !filters.stage && (
          <div ref={el => { const b = el?.children[boardIdx]; if (b && el) el.scrollTo({ left: b.offsetLeft - el.offsetLeft - 16, behavior: 'smooth' }) }} role="tablist" aria-label="Stages" style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '8px', marginBottom: '4px', scrollbarWidth: 'none' }}>
            {STAGES.map((stage, i) => {
              const n = filtered.filter(p => p.stage === stage).length
              const on = boardIdx === i
              return (
                <button key={stage} role="tab" aria-selected={on}
                  onClick={() => { const col = boardRef.current?.children[i]; if (col) boardRef.current.scrollTo({ left: col.offsetLeft - boardRef.current.offsetLeft, behavior: 'smooth' }) }}
                  style={{ ...S.chip(on, STAGE_META[stage].color), flexShrink: 0, padding: '6px 11px', fontSize: '11px' }}>
                  {stage}<span style={{ opacity: 0.8 }}>{n}</span>
                </button>
              )
            })}
          </div>
        )}
        <div ref={boardRef} className="proj-board"
          onScroll={e => { if (!narrow) return; const el = e.currentTarget; const w = el.children[0]?.offsetWidth || 1; setBoardIdx(Math.max(0, Math.min(STAGES.length - 1, Math.round(el.scrollLeft / (w + 12))))) }}
          style={{ display: 'flex', gap: '12px', overflowX: 'auto', paddingBottom: '10px', alignItems: 'flex-start' }}>
          {(filters.stage ? [filters.stage] : STAGES).map(stage => {
            const list = filtered.filter(p => p.stage === stage)
            const meta = STAGE_META[stage]
            const over = dropStage === stage && dragId
            return (
              <div key={stage} className="proj-col"
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
                  <ProjectCard key={p.id} p={p} T={T} cardStyle={cardStyle} S={S} dimmed={dragId === p.id} draggable={!narrow}
                    onDragStart={e => { setDragId(p.id); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', p.id) } catch (err) { /* ignore */ } }}
                    onDragEnd={() => { setDragId(null); setDropStage(null) }}
                    onOpen={() => setOpenId(p.id)} />
                ))}
                {list.length === 0 && <div style={{ fontSize: '11px', color: T.textMuted, textAlign: 'center', padding: '18px 6px' }}>{dragId ? 'Drop here' : 'No projects'}</div>}
              </div>
            )
          })}
        </div>
        </>
      ) : view === 'list' ? (
        <ProjectList projects={filtered} T={T} cardStyle={cardStyle} S={S} narrow={narrow} sort={filters.sort} onSort={v => setFilter('sort', v)} onOpen={id => setOpenId(id)} />
      ) : (
        <Timeline projects={filtered} T={T} cardStyle={cardStyle} narrow={narrow} onOpen={id => setOpenId(id)} />
      )}

      {!loading && !loadError && projects.length > 0 && filtered.length === 0 && (
        <div style={{ ...cardStyle, padding: '20px', textAlign: 'center', color: T.textSecondary, fontSize: '13px', marginTop: '12px' }}>
          No projects match these filters. <button onClick={clearAll} style={{ background: 'transparent', border: 'none', color: T.blue, cursor: 'pointer', fontWeight: 700, fontSize: '13px', textDecoration: 'underline' }}>Clear all filters</button>
        </div>
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

// ── Timeline (Gantt-style) with week / month / quarter zoom ────────────────
const ZOOMS = {
  week:    { label: 'Weeks',    unitW: 46,  icon: 'ti-calendar-week' },
  month:   { label: 'Months',   unitW: 90,  icon: 'ti-calendar-month' },
  quarter: { label: 'Quarters', unitW: 130, icon: 'ti-calendar' },
}

function timelineTicks(min, max, zoom) {
  const start = new Date(min)
  if (zoom === 'week') { start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - ((start.getDay() + 6) % 7)) } // Monday
  else if (zoom === 'month') { start.setHours(0, 0, 0, 0); start.setDate(1) }
  else { start.setHours(0, 0, 0, 0); start.setMonth(Math.floor(start.getMonth() / 3) * 3, 1) }
  const step = d => { if (zoom === 'week') d.setDate(d.getDate() + 7); else d.setMonth(d.getMonth() + (zoom === 'month' ? 1 : 3)) }
  const ticks = []
  const d = new Date(start)
  while (d.getTime() <= max) { ticks.push(new Date(d)); step(d) }
  const end = new Date(d)
  return { ticks, first: start.getTime(), last: end.getTime() }
}

function tickLabel(d, zoom, prev) {
  if (zoom === 'quarter') return `Q${Math.floor(d.getMonth() / 3) + 1} ’${String(d.getFullYear()).slice(2)}`
  if (zoom === 'month') return d.toLocaleDateString('en-ZA', { month: 'short', year: '2-digit' })
  const newMonth = !prev || prev.getMonth() !== d.getMonth()
  return newMonth ? d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' }) : String(d.getDate())
}

function Timeline({ projects, T, cardStyle, narrow, onOpen }) {
  const [zoom, setZoom] = useState('month')
  const scrollRef = useRef(null)
  useEffect(() => { try { const z = localStorage.getItem(ZOOM_KEY); if (ZOOMS[z]) setZoom(z) } catch (e) { /* ignore */ } }, [])
  const pickZoom = z => { setZoom(z); try { localStorage.setItem(ZOOM_KEY, z) } catch (e) { /* ignore */ } }

  const DAY = 86400000
  const parse = d => new Date(d + 'T00:00:00').getTime()
  const rows = projects.map(p => {
    const start = p.start_date ? parse(p.start_date) : new Date(p.created_at || Date.now()).setHours(0, 0, 0, 0)
    const end = p.target_date ? parse(p.target_date) : start + 60 * DAY
    return { p, start, end: Math.max(end, start + DAY), estimated: !p.target_date }
  }) // order comes from the toolbar sort

  const today = new Date().setHours(0, 0, 0, 0)
  const { ticks, first, last } = useMemo(() => {
    if (!rows.length) return { ticks: [], first: today, last: today + DAY }
    return timelineTicks(Math.min(today, ...rows.map(r => r.start)), Math.max(today, ...rows.map(r => r.end)), zoom)
  }, [projects, zoom]) // eslint-disable-line react-hooks/exhaustive-deps
  const span = last - first
  const LABEL_W = narrow ? 140 : 230
  const unitW = ZOOMS[zoom].unitW
  const bodyW = Math.max(ticks.length * unitW, 300)
  const x = t => ((t - first) / span) * bodyW

  // Scroll so "today" sits about a third of the way across
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !rows.length) return
    el.scrollLeft = Math.max(0, x(today) - (el.clientWidth - LABEL_W) / 3)
  }, [zoom, narrow, rows.length]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!rows.length) return null

  const sticky = bg => ({ position: 'sticky', left: 0, zIndex: 2, background: bg, width: LABEL_W, flexShrink: 0, borderRight: `1px solid ${T.border}`, boxSizing: 'border-box' })
  const gridLines = ticks.map(t => <div key={t.getTime()} style={{ position: 'absolute', top: 0, bottom: 0, left: x(t.getTime()), width: '1px', background: T.border, pointerEvents: 'none' }} />)

  return (
    <div style={{ ...cardStyle, overflow: 'hidden' }}>
      {/* Zoom */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', borderBottom: `1px solid ${T.border}`, flexWrap: 'wrap' }}>
        <span style={{ fontSize: '10px', fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.6px' }}>Zoom</span>
        <div role="tablist" aria-label="Timeline zoom" style={{ display: 'inline-flex', border: `1px solid ${T.border}`, borderRadius: '6px', overflow: 'hidden' }}>
          {Object.entries(ZOOMS).map(([k, z]) => (
            <button key={k} role="tab" aria-selected={zoom === k} onClick={() => pickZoom(k)} style={{ padding: '5px 11px', border: 'none', fontSize: '11px', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '5px', background: zoom === k ? T.blue : 'transparent', color: zoom === k ? '#fff' : T.textSecondary }}>
              <i className={`ti ${z.icon}`} />{z.label}
            </button>
          ))}
        </div>
        <button onClick={() => { const el = scrollRef.current; if (el) el.scrollTo({ left: Math.max(0, x(today) - (el.clientWidth - LABEL_W) / 3), behavior: 'smooth' }) }}
          style={{ marginLeft: 'auto', background: 'transparent', border: `1px solid ${T.border}`, borderRadius: '6px', padding: '5px 10px', fontSize: '11px', fontWeight: 700, color: T.textSecondary, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
          <i className="ti ti-focus-2" />Today
        </button>
      </div>

      <div ref={scrollRef} style={{ overflowX: 'auto' }}>
        <div style={{ width: LABEL_W + bodyW }}>
          {/* Header */}
          <div style={{ display: 'flex', borderBottom: `1px solid ${T.border}`, background: T.bgMuted }}>
            <div style={{ ...sticky(T.bgMuted), padding: '9px 12px', fontSize: '10px', fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.6px' }}>Project</div>
            <div style={{ position: 'relative', width: bodyW, height: '32px' }}>
              {ticks.map((t, i) => (
                <div key={t.getTime()} style={{ position: 'absolute', top: 0, bottom: 0, left: x(t.getTime()), width: unitW, padding: '9px 6px', boxSizing: 'border-box', fontSize: '10px', fontWeight: 700, color: T.textMuted, borderLeft: `1px solid ${T.border}`, whiteSpace: 'nowrap', overflow: 'hidden' }}>
                  {tickLabel(t, zoom, ticks[i - 1])}
                </div>
              ))}
            </div>
          </div>

          {/* Rows */}
          <div style={{ position: 'relative' }}>
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: LABEL_W, width: bodyW, pointerEvents: 'none' }}>
              {gridLines}
              {today >= first && today <= last && <div title="Today" style={{ position: 'absolute', top: 0, bottom: 0, left: x(today), width: '2px', background: T.red, opacity: 0.55 }} />}
            </div>
            {rows.map(({ p, start, end, estimated }) => {
              const meta = STAGE_META[p.stage] || STAGE_META['Site Visit']
              const stagePct = ((STAGES.indexOf(p.stage) + (p.status === 'Complete' ? 1 : 0.5)) / STAGES.length) * 100
              const late = p.target_date && end < today && p.status !== 'Complete'
              const h = projectHealth(p)
              const hm = HEALTH_META[h.key]
              return (
                <div key={p.id} className="tbl-row" role="button" tabIndex={0} onClick={() => onOpen(p.id)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(p.id) } }}
                  style={{ display: 'flex', borderBottom: `1px solid ${T.border}`, cursor: 'pointer' }}>
                  <div style={{ ...sticky(T.bgPanel), padding: '9px 12px', minWidth: 0 }}>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: T.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span title={[hm.label, ...h.reasons].join(' · ')} style={{ width: 8, height: 8, borderRadius: '50%', background: hm.color(T), flexShrink: 0 }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
                    </div>
                    <div style={{ fontSize: '10px', color: T.textMuted, display: 'flex', alignItems: 'center', gap: '4px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                      <i className={`ti ${meta.icon}`} style={{ color: meta.color }} />{p.stage}{p.owner && !narrow ? ` · ${p.owner}` : ''}
                    </div>
                  </div>
                  <div style={{ position: 'relative', width: bodyW, minHeight: '44px' }}>
                    <div title={`${fmtDate(p.start_date)} → ${p.target_date ? fmtDate(p.target_date) : 'no target date'}`}
                      style={{ position: 'absolute', top: '11px', height: '22px', left: x(start), width: Math.max(6, x(end) - x(start)), borderRadius: '6px', background: `${meta.color}33`, border: `1px ${estimated ? 'dashed' : 'solid'} ${late ? T.red : meta.color}`, overflow: 'hidden', boxSizing: 'border-box' }}>
                      <div style={{ width: `${stagePct}%`, height: '100%', background: meta.color, opacity: 0.85 }} />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
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

// ── Compact list view ───────────────────────────────────────────────────────
function ProjectList({ projects, T, cardStyle, S, narrow, sort, onSort, onOpen }) {
  if (!projects.length) return null
  const rowKey = (p, fn) => ({ role: 'button', tabIndex: 0, onClick: () => fn(p.id), onKeyDown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(p.id) } } })
  const dueInfo = (p, h) => {
    if (p.status === 'Complete') return { text: p.target_date ? fmtShort(p.target_date) : 'Done', color: T.green }
    if (h.daysLeft == null) return { text: 'No target', color: T.textMuted }
    return { text: h.daysLeft < 0 ? `${-h.daysLeft}d late` : h.daysLeft === 0 ? 'Today' : `${h.daysLeft}d left`, color: h.daysLeft < 0 ? T.red : h.daysLeft <= 14 ? T.orange : T.textSecondary, sub: fmtShort(p.target_date) }
  }
  const bar = (pct, color) => (
    <div style={{ flex: 1, height: '5px', background: T.bgMuted, borderRadius: '3px', overflow: 'hidden', minWidth: '40px' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color }} />
    </div>
  )

  if (narrow) {
    return (
      <div style={{ ...cardStyle, overflow: 'hidden' }}>
        {projects.map(p => {
          const h = projectHealth(p)
          const hm = HEALTH_META[h.key]
          const meta = STAGE_META[p.stage] || STAGE_META['Site Visit']
          const d = dueInfo(p, h)
          const pct = h.tasksTotal ? Math.round((h.tasksDone / h.tasksTotal) * 100) : 0
          return (
            <div key={p.id} className="tbl-row" {...rowKey(p, onOpen)} style={{ padding: '11px 14px', borderBottom: `1px solid ${T.border}`, borderLeft: `3px solid ${hm.color(T)}`, cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                <div style={{ flex: 1, minWidth: 0, fontSize: '13px', fontWeight: 700, color: T.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                <span style={{ fontSize: '11px', fontWeight: 700, color: d.color, whiteSpace: 'nowrap' }}>{d.text}</span>
              </div>
              <div style={{ fontSize: '11px', color: T.textMuted, marginTop: '3px', display: 'flex', alignItems: 'center', gap: '5px', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                <i className={`ti ${meta.icon}`} style={{ color: meta.color }} />{p.stage}
                {p.capacity_kwp ? <span>· {Number(p.capacity_kwp).toLocaleString()} kWp</span> : null}
                {p.client ? <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>· {p.client}</span> : null}
              </div>
              {h.tasksTotal > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '7px' }}>
                  {bar(pct, pct === 100 ? T.green : T.blue)}
                  <span style={{ fontSize: '10px', color: T.textMuted, whiteSpace: 'nowrap' }}>{h.tasksDone}/{h.tasksTotal}{h.overdue ? <b style={{ color: T.red }}> · {h.overdue} overdue</b> : null}</span>
                </div>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  const COLS = '28px minmax(200px, 2.4fr) 140px minmax(110px, 1fr) 90px 120px minmax(150px, 1.2fr)'
  const head = [['health', ''], ['name', 'Project'], [null, 'Stage'], [null, 'Owner'], ['size', 'kWp'], ['target', 'Handover'], ['progress', 'Tasks']]
  return (
    <div style={{ ...cardStyle, overflowX: 'auto' }}>
      <div style={{ minWidth: '880px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: '10px', padding: '8px 14px', background: T.bgMuted, borderBottom: `1px solid ${T.border}`, alignItems: 'center' }}>
          {head.map(([k, l], i) => (
            k ? (
              <button key={i} onClick={() => onSort(k)} title={k === 'health' ? 'Sort by health' : `Sort by ${l}`}
                style={{ ...S.labelStyle, marginBottom: 0, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', textAlign: i === 4 ? 'right' : 'left', color: sort === k ? T.blue : T.textMuted, display: 'inline-flex', alignItems: 'center', gap: '3px', justifyContent: i === 4 ? 'flex-end' : 'flex-start' }}>
                {k === 'health' ? <i className="ti ti-heartbeat" /> : l}{sort === k && <i className="ti ti-arrow-narrow-down" />}
              </button>
            ) : <span key={i} style={{ ...S.labelStyle, marginBottom: 0 }}>{l}</span>
          ))}
        </div>
        {projects.map(p => {
          const h = projectHealth(p)
          const hm = HEALTH_META[h.key]
          const meta = STAGE_META[p.stage] || STAGE_META['Site Visit']
          const d = dueInfo(p, h)
          const pct = h.tasksTotal ? Math.round((h.tasksDone / h.tasksTotal) * 100) : 0
          return (
            <div key={p.id} className="tbl-row" {...rowKey(p, onOpen)} style={{ display: 'grid', gridTemplateColumns: COLS, gap: '10px', padding: '9px 14px', borderBottom: `1px solid ${T.border}`, alignItems: 'center', cursor: 'pointer' }}>
              <span title={[hm.label, ...h.reasons].join(' · ')} style={{ width: 10, height: 10, borderRadius: '50%', background: hm.color(T), justifySelf: 'center' }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: T.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                <div style={{ fontSize: '11px', color: T.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{[p.client, p.site_name, p.system_type].filter(Boolean).join(' · ') || '—'}</div>
              </div>
              <span style={{ fontSize: '12px', color: T.textSecondary, display: 'inline-flex', alignItems: 'center', gap: '5px', whiteSpace: 'nowrap' }}><i className={`ti ${meta.icon}`} style={{ color: meta.color }} />{p.stage}</span>
              <span style={{ fontSize: '12px', color: T.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.owner || '—'}</span>
              <span style={{ fontSize: '12px', color: T.textPrimary, fontWeight: 700, textAlign: 'right' }}>{p.capacity_kwp ? Number(p.capacity_kwp).toLocaleString() : '—'}</span>
              <div>
                <div style={{ fontSize: '12px', fontWeight: 700, color: d.color }}>{d.text}</div>
                {d.sub && <div style={{ fontSize: '10px', color: T.textMuted }}>{d.sub}</div>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {h.tasksTotal ? <>{bar(pct, pct === 100 ? T.green : T.blue)}<span style={{ fontSize: '10px', color: h.overdue ? T.red : T.textMuted, whiteSpace: 'nowrap', fontWeight: h.overdue ? 700 : 400 }}>{h.tasksDone}/{h.tasksTotal}{h.overdue ? ` · ${h.overdue} overdue` : ''}</span></> : <span style={{ fontSize: '11px', color: T.textMuted }}>No tasks</span>}
              </div>
            </div>
          )
        })}
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

function ProjectCard({ p, T, cardStyle, S, dimmed, draggable = true, onDragStart, onDragEnd, onOpen }) {
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
    <div draggable={draggable} onDragStart={onDragStart} onDragEnd={onDragEnd} onClick={onOpen}
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

function PortfolioOverview({ projects, owner, T, cardStyle, filters, onQuickFilter }) {
  const [open, setOpen] = useState(true)
  const [mode, setMode] = useState('count') // count | kwp
  const [hoverStage, setHoverStage] = useState(null)
  useEffect(() => { try { const saved = localStorage.getItem(OVERVIEW_KEY); if (saved === '0' || (saved == null && window.matchMedia?.('(max-width: 640px)').matches)) setOpen(false); if (localStorage.getItem(MODE_KEY) === 'kwp') setMode('kwp') } catch (e) { /* ignore */ } }, [])
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
  const Tile = ({ icon, color, title, value, sub, children, onClick, active, hint }) => (
    <div role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined} title={hint}
      onClick={onClick} onKeyDown={onClick ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } } : undefined}
      style={{ ...cardStyle, padding: '12px 14px', minWidth: 0, borderTop: `3px solid ${color}`, cursor: onClick ? 'pointer' : 'default', boxShadow: active ? `0 0 0 2px ${color}` : cardStyle.boxShadow }}>
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
          <style>{`@media (min-width: 641px) and (max-width: 1024px) { .proj-kpis { grid-template-columns: repeat(6, 1fr) !important; } .proj-kpis > * { grid-column: span 2; } .proj-kpis > :nth-child(n+4) { grid-column: span 3; } }
@media (max-width: 640px) { .proj-kpis { grid-template-columns: 1fr 1fr !important; } .proj-kpis > :last-child:nth-child(odd) { grid-column: 1 / -1; } }`}</style>
          <div className="proj-kpis" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px' }}>
            <Tile icon="ti-briefcase" color={T.blue} title="Active projects" value={k.active}
              onClick={() => onQuickFilter({ status: 'Active' })} active={filters.status === 'Active'} hint="Show active projects"
              sub={[k.hold ? `${k.hold} on hold` : null, `${k.complete} complete`].filter(Boolean).join(' · ')} />
            <Tile icon="ti-solar-panel" color={T.orange} title="Pipeline" value={fmtKw(k.kwp)}
              sub={k.kwh ? `+ ${fmtNum(k.kwh)} kWh storage` : 'Active + on hold'} />
            <Tile icon="ti-heartbeat" color={atRisk ? T.red : T.green} title="At risk / late" value={atRisk}
              onClick={() => onQuickFilter({ health: 'riskOrLate' })} active={filters.health === 'riskOrLate'} hint="Show projects at risk or late"
              sub={totalH ? `${k.health.ok} on track · ${k.health.risk} at risk · ${k.health.late} late` : 'No active projects'}>
              {totalH > 0 && (
                <div style={{ display: 'flex', height: '5px', borderRadius: '3px', overflow: 'hidden', marginTop: '8px', background: T.bgMuted }}>
                  {[['ok', T.green], ['risk', T.orange], ['late', T.red]].map(([key, c]) => k.health[key] ? <div key={key} style={{ width: `${(k.health[key] / totalH) * 100}%`, background: c }} /> : null)}
                </div>
              )}
            </Tile>
            <Tile icon="ti-alarm" color={k.overdueTasks ? T.red : T.green} title="Overdue tasks" value={k.overdueTasks}
              onClick={() => onQuickFilter({ overdue: true })} active={filters.overdue} hint="Show projects with overdue tasks"
              sub={k.overdueTasks ? `Across ${k.overdueProjects} project${k.overdueProjects === 1 ? '' : 's'}` : 'Nothing overdue'} />
            <Tile icon="ti-flag-check" color={T.green} title={`Handovers in ${k.monthName}`} value={k.dueMonth.length}
              onClick={() => onQuickFilter({ due: 'month' })} active={filters.due === 'month'} hint="Show handovers due this month"
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
                  <div key={s.stage} title={`${s.stage}: ${s.count} project${s.count === 1 ? '' : 's'} · ${fmtKw(s.kwp)} (click to filter)`}
                    onClick={() => onQuickFilter({ stage: filters.stage === s.stage ? '' : s.stage })}
                    onMouseEnter={() => setHoverStage(s.stage)} onMouseLeave={() => setHoverStage(null)}
                    style={{ width: `${(metric(s) / total) * 100}%`, background: STAGE_META[s.stage].color, cursor: 'pointer', opacity: (hoverStage && hoverStage !== s.stage) || (filters.stage && filters.stage !== s.stage) ? 0.35 : 1, transition: 'opacity .15s' }} />
                ))}
              </div>
            ) : <div style={{ fontSize: '11px', color: T.textMuted }}>{mode === 'kwp' ? 'No kWp entered on active projects.' : 'No active projects.'}</div>}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginTop: '9px' }}>
              {k.byStage.map(s => (
                <span key={s.stage} role="button" tabIndex={0} onMouseEnter={() => setHoverStage(s.stage)} onMouseLeave={() => setHoverStage(null)}
                  onClick={() => onQuickFilter({ stage: filters.stage === s.stage ? '' : s.stage })}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onQuickFilter({ stage: filters.stage === s.stage ? '' : s.stage }) } }}
                  style={{ cursor: 'pointer', fontWeight: filters.stage === s.stage ? 800 : 400, fontSize: '11px', color: metric(s) ? T.textSecondary : T.textMuted, display: 'inline-flex', alignItems: 'center', gap: '5px', opacity: hoverStage && hoverStage !== s.stage ? 0.5 : 1 }}>
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
