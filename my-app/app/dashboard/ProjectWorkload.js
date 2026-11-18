'use client'

import { useEffect, useMemo, useState } from 'react'
import { STAGE_META, fmtDate, initials } from './projectConfig'

// ─────────────────────────────────────────────────────────────────────────────
// Team workload view (Projects workspace, Phase 4 step 2)
//  One row per person, columns: Overdue · this week … +5 weeks · Later · No date.
//  Counts open checklist tasks on open projects (the toolbar filters apply).
//  A task with no assignee counts for the project owner (switchable).
//  Click a cell or a name to see the tasks; tick them off from there.
// No database change: uses project_tasks loaded with the projects.
// ─────────────────────────────────────────────────────────────────────────────

const OWNER_KEY = 'sos-projects-workload-owner'
const WEEKS = 6
export const LOAD_HEAVY = 8 // open tasks due in one week that counts as a heavy week
const DAY = 86400000

const monday = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x }
const UNASSIGNED = '__unassigned'

export function workloadBuckets(now = new Date()) {
  const m0 = monday(now)
  const weeks = Array.from({ length: WEEKS }, (_, i) => new Date(m0.getTime() + i * 7 * DAY))
  return [
    { key: 'overdue', label: 'Overdue', sub: 'past due date' },
    ...weeks.map((w, i) => ({
      key: `w${i}`, start: w,
      label: i === 0 ? 'This week' : i === 1 ? 'Next week' : `Wk of ${String(w.getDate()).padStart(2, '0')} ${w.toLocaleDateString('en-ZA', { month: 'short' })}`,
      sub: `${w.getDate()} ${w.toLocaleDateString('en-ZA', { month: 'short' })} – ${new Date(w.getTime() + 6 * DAY).getDate()} ${new Date(w.getTime() + 6 * DAY).toLocaleDateString('en-ZA', { month: 'short' })}`,
    })),
    { key: 'later', label: 'Later', sub: `after ${WEEKS} weeks` },
    { key: 'none', label: 'No date', sub: 'no due date' },
  ]
}

export function bucketOf(due, now = new Date()) {
  if (!due) return 'none'
  const today = new Date(now); today.setHours(0, 0, 0, 0)
  const d = new Date(due + 'T00:00:00')
  if (d < today) return 'overdue'
  const i = Math.round((monday(d) - monday(today)) / (7 * DAY))
  return i < WEEKS ? `w${i}` : 'later'
}

// people → { key, name, buckets: {bucketKey: [task…]}, open, projects:Set }
export function buildWorkload(projects, { ownerFallback = true, now = new Date(), keepIds = new Set() } = {}) {
  const people = new Map()
  const person = name => {
    const key = name ? name.trim().toLowerCase() : UNASSIGNED
    if (!people.has(key)) people.set(key, { key, name: name ? name.trim() : 'Unassigned', buckets: {}, open: 0, overdue: 0, projects: new Set() })
    return people.get(key)
  }
  for (const p of projects) {
    if (p.status === 'Complete' || p.status === 'Cancelled') continue
    for (const t of p.project_tasks || []) {
      if (t.done && !keepIds.has(t.id)) continue
      const assignee = (t.assignee || '').trim()
      const viaOwner = !assignee && ownerFallback && (p.owner || '').trim()
      const who = person(assignee || viaOwner || '')
      const b = bucketOf(t.due_date, now)
      ;(who.buckets[b] = who.buckets[b] || []).push({ ...t, project: p, viaOwner: !!viaOwner })
      if (!t.done) { who.open++; if (b === 'overdue') who.overdue++; who.projects.add(p.id) }
    }
  }
  return [...people.values()].sort((a, b) =>
    (a.key === UNASSIGNED) - (b.key === UNASSIGNED) || b.overdue - a.overdue || b.open - a.open || a.name.localeCompare(b.name))
}

export default function ProjectWorkload({ projects, T, cardStyle, S, narrow, onOpen, onToggleTask }) {
  const [ownerFallback, setOwnerFallback] = useState(true)
  const [sel, setSel] = useState(null) // { person, bucket|null }
  const [recent, setRecent] = useState(() => new Set()) // ticked off while the panel is open (kept visible, can be undone)
  useEffect(() => { try { const v = localStorage.getItem(OWNER_KEY); if (v != null) setOwnerFallback(v === '1') } catch (e) { /* ignore */ } }, [])
  const pickOwner = v => { setOwnerFallback(v); try { localStorage.setItem(OWNER_KEY, v ? '1' : '0') } catch (e) { /* ignore */ } }

  const buckets = useMemo(() => workloadBuckets(), [])
  const rows = useMemo(() => buildWorkload(projects, { ownerFallback, keepIds: recent }), [projects, ownerFallback, recent])
  const openSel = (person, bucket) => { setRecent(new Set()); setSel(s => (s && s.person === person && s.bucket === bucket ? null : { person, bucket })) }
  const selRow = sel && rows.find(r => r.key === sel.person)

  // Summary
  const named = rows.filter(r => r.key !== UNASSIGNED)
  const totalOpen = rows.reduce((n, r) => n + r.open, 0)
  const withOverdue = named.filter(r => r.overdue).length
  const unassigned = rows.find(r => r.key === UNASSIGNED)?.open || 0
  let heaviest = null
  for (const r of named) for (const b of buckets.filter(x => /^w/.test(x.key))) {
    const n = (r.buckets[b.key] || []).filter(t => !t.done).length
    if (n && (!heaviest || n > heaviest.n)) heaviest = { n, name: r.name, label: b.label }
  }

  const cellStyle = (n, b) => {
    if (!n) return { color: T.textMuted }
    if (b === 'overdue') return { background: `${T.red}${n >= 4 ? '38' : '1f'}`, color: T.red, fontWeight: 800 }
    if (b === 'none' || b === 'later') return { background: T.bgMuted, color: T.textSecondary, fontWeight: 700 }
    if (n >= LOAD_HEAVY) return { background: `${T.orange}33`, color: T.orange, fontWeight: 800 }
    return { background: `${T.blue}${n >= 4 ? '2e' : '17'}`, color: T.blue, fontWeight: 800 }
  }

  const NAME_W = narrow ? 128 : 210
  const COL_W = narrow ? 64 : 92
  const sticky = bg => ({ position: 'sticky', left: 0, zIndex: 1, background: bg, width: NAME_W, minWidth: NAME_W, boxSizing: 'border-box', borderRight: `1px solid ${T.border}` })

  // Tasks for the detail panel, grouped by project
  const selTasks = selRow ? (sel.bucket ? (selRow.buckets[sel.bucket] || []) : buckets.flatMap(b => selRow.buckets[b.key] || [])) : []
  const byProject = []
  for (const t of selTasks) {
    let g = byProject.find(x => x.p.id === t.project.id)
    if (!g) byProject.push(g = { p: t.project, tasks: [] })
    g.tasks.push(t)
  }
  const selBucket = sel?.bucket && buckets.find(b => b.key === sel.bucket)

  const toggle = async t => {
    const done = !t.done
    setRecent(s => { const n = new Set(s); n.add(t.id); return n })
    await onToggleTask(t, done)
  }

  if (!rows.length) {
    return (
      <div style={{ ...cardStyle, padding: '28px', textAlign: 'center', color: T.textSecondary, fontSize: '13px' }}>
        <i className="ti ti-users" style={{ fontSize: '26px', color: T.textMuted, display: 'block', marginBottom: '6px' }} />
        No open tasks on the projects shown. Tasks appear here once projects have checklist items that are not done.
      </div>
    )
  }

  return (
    <div>
      {/* Summary + settings */}
      <div style={{ ...cardStyle, padding: '10px 14px', marginBottom: '12px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 18px', fontSize: '12px', color: T.textSecondary }}>
        <span><b style={{ color: T.textPrimary }}>{totalOpen}</b> open tasks · <b style={{ color: T.textPrimary }}>{named.length}</b> {named.length === 1 ? 'person' : 'people'}</span>
        <span style={{ color: withOverdue ? T.red : T.textSecondary }}><i className="ti ti-alarm" /> {withOverdue ? `${withOverdue} with overdue tasks` : 'Nobody has overdue tasks'}</span>
        {heaviest && <span style={{ color: heaviest.n >= LOAD_HEAVY ? T.orange : T.textSecondary }}><i className="ti ti-flame" /> Busiest: {heaviest.name}, {heaviest.n} due {heaviest.label.toLowerCase().startsWith('wk') ? heaviest.label.replace('Wk', 'week') : heaviest.label.toLowerCase()}</span>}
        {unassigned > 0 && <span style={{ color: T.orange }}><i className="ti ti-user-question" /> {unassigned} unassigned</span>}
        <label style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '11px' }} title="Checklist tasks with no assignee are counted for the project owner">
          <input type="checkbox" checked={ownerFallback} onChange={e => pickOwner(e.target.checked)} />
          Unassigned tasks count for the project owner
        </label>
      </div>

      {/* Grid */}
      <div style={{ ...cardStyle, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table role="grid" aria-label="Team workload" style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', minWidth: NAME_W + COL_W * buckets.length + 60 }}>
            <thead>
              <tr style={{ background: T.bgMuted }}>
                <th style={{ ...sticky(T.bgMuted), textAlign: 'left', padding: '9px 12px', fontSize: '10px', fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.6px', borderBottom: `1px solid ${T.border}` }}>Person</th>
                {buckets.map(b => (
                  <th key={b.key} style={{ width: COL_W, padding: '7px 4px', textAlign: 'center', borderBottom: `1px solid ${T.border}`, borderLeft: `1px solid ${T.border}`, ...(b.key === 'w0' ? { background: `${T.blue}12` } : {}) }}>
                    <div style={{ fontSize: '11px', fontWeight: 800, color: b.key === 'overdue' ? T.red : T.textPrimary, whiteSpace: 'nowrap' }}>{narrow ? b.label.replace('Wk of ', '') : b.label}</div>
                    {!narrow && <div style={{ fontSize: '9px', color: T.textMuted, fontWeight: 600, whiteSpace: 'nowrap' }}>{b.sub}</div>}
                  </th>
                ))}
                <th style={{ width: 60, padding: '7px 6px', fontSize: '10px', fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', borderBottom: `1px solid ${T.border}`, borderLeft: `1px solid ${T.border}` }}>Open</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const un = r.key === UNASSIGNED
                const rowSel = sel?.person === r.key
                return (
                  <tr key={r.key}>
                    <td style={{ ...sticky(rowSel && !sel.bucket ? (T.isDark ? '#1f2d42' : '#eaf2fc') : T.bgPanel), padding: 0, borderBottom: `1px solid ${T.border}` }}>
                      <button onClick={() => openSel(r.key, null)} title={`Show all of ${r.name}'s open tasks`}
                        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', color: T.textPrimary, minWidth: 0 }}>
                        <span style={{ width: 26, height: 26, borderRadius: '50%', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 800, background: un ? T.bgMuted : `${T.blue}1f`, color: un ? T.textMuted : T.blue }}>
                          {un ? <i className="ti ti-user-question" /> : initials(r.name)}
                        </span>
                        <span style={{ minWidth: 0 }}>
                          <span style={{ display: 'block', fontSize: '12px', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontStyle: un ? 'italic' : 'normal' }}>{r.name}</span>
                          <span style={{ display: 'block', fontSize: '10px', color: T.textMuted, whiteSpace: 'nowrap' }}>{r.projects.size} project{r.projects.size === 1 ? '' : 's'}</span>
                        </span>
                      </button>
                    </td>
                    {buckets.map(b => {
                      const n = (r.buckets[b.key] || []).filter(t => !t.done).length
                      const on = rowSel && sel.bucket === b.key
                      return (
                        <td key={b.key} style={{ padding: '4px', borderBottom: `1px solid ${T.border}`, borderLeft: `1px solid ${T.border}`, textAlign: 'center', ...(b.key === 'w0' ? { background: `${T.blue}08` } : {}) }}>
                          <button onClick={() => n && openSel(r.key, b.key)} disabled={!n} aria-label={`${r.name}, ${b.label}: ${n} task${n === 1 ? '' : 's'}`}
                            title={n >= LOAD_HEAVY && /^w/.test(b.key) ? `Heavy week: ${n} tasks due` : undefined}
                            style={{ width: '100%', minHeight: '32px', border: on ? `2px solid ${T.blue}` : '2px solid transparent', borderRadius: '6px', fontSize: '13px', cursor: n ? 'pointer' : 'default', background: 'transparent', ...cellStyle(n, b.key) }}>
                            {n || '·'}
                          </button>
                        </td>
                      )
                    })}
                    <td style={{ textAlign: 'center', fontSize: '12px', fontWeight: 800, color: r.overdue ? T.red : T.textPrimary, borderBottom: `1px solid ${T.border}`, borderLeft: `1px solid ${T.border}` }}>{r.open}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '8px 14px', fontSize: '10px', color: T.textMuted, display: 'flex', gap: '14px', flexWrap: 'wrap', borderTop: `1px solid ${T.border}` }}>
          <span>Open checklist tasks on open projects, by due date. Weeks start on Monday.</span>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: `${T.red}2a`, marginRight: 4, verticalAlign: 'middle' }} />Overdue</span>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: `${T.blue}2e`, marginRight: 4, verticalAlign: 'middle' }} />Due that week</span>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: `${T.orange}33`, marginRight: 4, verticalAlign: 'middle' }} />Heavy week ({LOAD_HEAVY}+ tasks)</span>
        </div>
      </div>

      {/* Detail panel */}
      {selRow && (
        <div role="region" aria-label="Tasks" style={{ ...cardStyle, marginTop: '12px', padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '14px', fontWeight: 800, color: T.textPrimary }}>{selRow.name} · {selBucket ? selBucket.label : 'All open tasks'}</div>
              <div style={{ fontSize: '11px', color: T.textMuted }}>{selTasks.filter(t => !t.done).length} open · {byProject.length} project{byProject.length === 1 ? '' : 's'}{selBucket?.sub ? ` · ${selBucket.sub}` : ''}</div>
            </div>
            <button onClick={() => { setSel(null); setRecent(new Set()) }} aria-label="Close task list" style={S.iconBtn(T.textSecondary)}><i className="ti ti-x" /></button>
          </div>
          {byProject.map(({ p, tasks }) => (
            <div key={p.id} style={{ marginTop: '10px' }}>
              <button onClick={() => onOpen(p.id)} style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', fontSize: '12px', fontWeight: 800, color: T.blue, display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                <i className="ti ti-folder" />{p.name}<i className="ti ti-arrow-up-right" style={{ fontSize: '11px' }} />
              </button>
              <div style={{ marginTop: '4px', display: 'flex', flexDirection: 'column' }}>
                {tasks.slice().sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999')).map(t => {
                  const meta = STAGE_META[t.stage] || STAGE_META['Site Visit']
                  const late = !t.done && bucketOf(t.due_date) === 'overdue'
                  return (
                    <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 4px', borderBottom: `1px solid ${T.border}`, fontSize: '12px', cursor: 'pointer', flexWrap: narrow ? 'wrap' : 'nowrap' }}>
                      <input type="checkbox" checked={!!t.done} onChange={() => toggle(t)} aria-label={`Mark "${t.title}" ${t.done ? 'not done' : 'done'}`} />
                      <span style={{ flex: 1, minWidth: narrow ? '70%' : 0, color: t.done ? T.textMuted : T.textPrimary, textDecoration: t.done ? 'line-through' : 'none' }}>
                        {t.title}{t.viaOwner && <span title="No assignee: counted for the project owner" style={{ marginLeft: 6, fontSize: '10px', color: T.textMuted }}>(owner)</span>}
                      </span>
                      <span style={S.badge(meta.color)}><i className={`ti ${meta.icon}`} />{t.stage}</span>
                      <span style={{ width: narrow ? 'auto' : '92px', textAlign: 'right', fontSize: '11px', fontWeight: late ? 800 : 600, color: late ? T.red : T.textSecondary, whiteSpace: 'nowrap' }}>{t.due_date ? fmtDate(t.due_date) : 'No date'}</span>
                    </label>
                  )
                })}
              </div>
            </div>
          ))}
          <div style={{ fontSize: '10px', color: T.textMuted, marginTop: '10px' }}>Ticked tasks stay listed until you close this panel, so you can undo. Assign tasks and set due dates on the project page.</div>
        </div>
      )}
    </div>
  )
}
