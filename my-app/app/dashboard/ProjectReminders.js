'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { STAGE_META, fmtDate } from './projectConfig'

// ─────────────────────────────────────────────────────────────────────────────
// Reminders bell (Projects workspace, Phase 4 step 3) — Projects toolbar only
//  • My overdue tasks · my tasks due in the next 3 days · handovers on my projects
//    within 14 days or past target
//  • "Mine" = I'm the assignee, or I own the project and the task has no assignee
//    (same rule as the Workload view). The person can be switched (e.g. a manager).
//  • Read state is kept per browser (localStorage). No database change.
// ─────────────────────────────────────────────────────────────────────────────

export const REMIND_RULES = { dueSoonDays: 3, handoverDays: 14 }
const READ_KEY = 'sos-projects-reminders-read'
const WHO_KEY = 'sos-projects-reminders-who'
const DAY = 86400000

const norm = s => (s || '').trim().toLowerCase().replace(/\s+/g, ' ')
// Does a free-text name (assignee / owner) refer to this person? Exact, or first name only.
export const isMe = (name, me) => {
  const a = norm(name), m = norm(me)
  if (!a || !m) return false
  if (a === m) return true
  const first = m.split(/[ @.]/)[0]
  return a === first || m.startsWith(a + ' ') || (m.includes('@') && a === m.split('@')[0])
}

const daysUntil = (d, now) => { const t = new Date(now); t.setHours(0, 0, 0, 0); return Math.round((new Date(d + 'T00:00:00') - t) / DAY) }

export function buildReminders(projects, me, now = new Date()) {
  const overdue = [], soon = [], handovers = []
  if (!me) return { overdue, soon, handovers }
  for (const p of projects) {
    if (p.status === 'Complete' || p.status === 'Cancelled') continue
    const own = isMe(p.owner, me)
    for (const t of p.project_tasks || []) {
      if (t.done || !t.due_date) continue
      const assignee = (t.assignee || '').trim()
      if (!(assignee ? isMe(assignee, me) : own)) continue
      const n = daysUntil(t.due_date, now)
      const item = { task: t, project: p, days: n, viaOwner: !assignee }
      if (n < 0) overdue.push({ ...item, key: `od:${t.id}` })
      else if (n <= REMIND_RULES.dueSoonDays) soon.push({ ...item, key: `ds:${t.id}:${t.due_date}` })
    }
    if (own && p.target_date) {
      const n = daysUntil(p.target_date, now)
      if (n <= REMIND_RULES.handoverDays) handovers.push({ project: p, days: n, key: `ho:${p.id}:${p.target_date}` })
    }
  }
  overdue.sort((a, b) => a.days - b.days)
  soon.sort((a, b) => a.days - b.days)
  handovers.sort((a, b) => a.days - b.days)
  return { overdue, soon, handovers }
}

const dueText = n => (n < 0 ? `${-n} day${n === -1 ? '' : 's'} overdue` : n === 0 ? 'Due today' : n === 1 ? 'Due tomorrow' : `Due in ${n} days`)
const handoverText = n => (n < 0 ? `Handover ${-n} day${n === -1 ? '' : 's'} late` : n === 0 ? 'Handover today' : `Handover in ${n} day${n === 1 ? '' : 's'}`)

export default function ProjectReminders({ projects, userName, people, T, cardStyle, S, narrow, onOpen, onToggleTask }) {
  const [open, setOpen] = useState(false)
  const [read, setRead] = useState(() => new Set())
  const [who, setWho] = useState('') // '' = me (userName)
  const wrap = useRef(null)

  useEffect(() => {
    try { setRead(new Set(JSON.parse(localStorage.getItem(READ_KEY) || '[]'))) } catch (e) { /* ignore */ }
    try { setWho(localStorage.getItem(WHO_KEY) || '') } catch (e) { /* ignore */ }
  }, [])
  // Close on outside click / Esc
  useEffect(() => {
    if (!open) return
    const onDown = e => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false) }
    const onKey = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown); document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const me = who || userName
  const r = useMemo(() => buildReminders(projects, me), [projects, me])
  const all = [...r.overdue, ...r.soon, ...r.handovers]
  const unread = all.filter(x => !read.has(x.key)).length
  const urgent = r.overdue.some(x => !read.has(x.key)) || r.handovers.some(x => x.days < 0 && !read.has(x.key))

  const saveRead = s => {
    // keep the most recent 500 keys, so the stored list doesn't grow forever
    const kept = [...s].slice(-500)
    setRead(new Set(kept))
    try { localStorage.setItem(READ_KEY, JSON.stringify(kept)) } catch (e) { /* ignore */ }
  }
  const markRead = key => { if (!read.has(key)) saveRead(new Set([...read, key])) }
  const markAll = () => saveRead(new Set([...read, ...all.map(x => x.key)]))
  const pickWho = v => { setWho(v); try { localStorage.setItem(WHO_KEY, v) } catch (e) { /* ignore */ } }
  const go = (x) => { markRead(x.key); setOpen(false); onOpen(x.project.id) }

  const Item = ({ x }) => {
    const isRead = read.has(x.key)
    const isTask = !!x.task
    const meta = isTask ? (STAGE_META[x.task.stage] || STAGE_META['Site Visit']) : null
    const color = x.days < 0 ? T.red : x.days === 0 ? T.orange : T.textSecondary
    return (
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '8px 14px', borderBottom: `1px solid ${T.border}`, background: isRead ? 'transparent' : `${T.blue}0a` }}>
        {isTask
          ? <input type="checkbox" checked={false} onChange={() => { markRead(x.key); onToggleTask(x.task, true, x.project) }} aria-label={`Mark "${x.task.title}" done`} title="Mark done" style={{ marginTop: '3px' }} />
          : <i className="ti ti-flag-check" style={{ color, fontSize: '15px', marginTop: '1px' }} />}
        <button onClick={() => go(x)} style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', color: T.textPrimary }}>
          <div style={{ fontSize: '12px', fontWeight: isRead ? 500 : 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {isTask ? x.task.title : x.project.name}
          </div>
          <div style={{ fontSize: '10px', color: T.textMuted, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 8px', marginTop: '2px' }}>
            <span style={{ color, fontWeight: 700 }}>{isTask ? dueText(x.days) : handoverText(x.days)}</span>
            {isTask && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{x.project.name}</span>}
            {isTask && <span style={{ color: meta.color }}><i className={`ti ${meta.icon}`} /> {x.task.stage}</span>}
            {!isTask && <span>{fmtDate(x.project.target_date)} · at {x.project.stage}</span>}
            {x.viaOwner && <span title="No assignee: you own this project">(owner)</span>}
          </div>
        </button>
        {!isRead && <span title="New" style={{ width: 7, height: 7, borderRadius: '50%', background: T.blue, marginTop: '6px', flexShrink: 0 }} />}
      </div>
    )
  }
  const Group = ({ title, icon, color, items }) => items.length ? (
    <div>
      <div style={{ padding: '8px 14px 4px', fontSize: '10px', fontWeight: 800, color, textTransform: 'uppercase', letterSpacing: '0.6px', display: 'flex', alignItems: 'center', gap: '5px' }}>
        <i className={`ti ${icon}`} />{title} · {items.length}
      </div>
      {items.map(x => <Item key={x.key} x={x} />)}
    </div>
  ) : null

  const panelPos = narrow
    ? { position: 'fixed', left: '10px', right: '10px', top: '70px', maxHeight: 'calc(100vh - 160px)' }
    : { position: 'absolute', right: 0, top: 'calc(100% + 8px)', width: '380px', maxHeight: '70vh' }

  return (
    <div ref={wrap} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} aria-label={`Reminders${unread ? `, ${unread} new` : ''}`} aria-expanded={open} title="My reminders"
        style={{ ...S.ghost, position: 'relative', padding: '8px 11px' }}>
        <i className={`ti ${unread ? 'ti-bell-ringing' : 'ti-bell'}`} style={{ fontSize: '15px', color: unread ? (urgent ? T.red : T.blue) : T.textSecondary }} />
        {unread > 0 && (
          <span style={{ position: 'absolute', top: '-6px', right: '-6px', minWidth: '18px', height: '18px', padding: '0 5px', boxSizing: 'border-box', borderRadius: '9px', background: urgent ? T.red : T.blue, color: '#fff', fontSize: '10px', fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div role="dialog" aria-label="Reminders" style={{ ...cardStyle, ...panelPos, zIndex: 900, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 12px 32px rgba(10,20,35,0.22)' }}>
          <div style={{ padding: '12px 14px', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '14px', fontWeight: 800, color: T.textPrimary }}>Reminders</div>
              <select value={who} onChange={e => pickWho(e.target.value)} aria-label="Show reminders for"
                style={{ marginTop: '2px', border: 'none', background: 'transparent', color: T.textMuted, fontSize: '11px', padding: 0, cursor: 'pointer', maxWidth: '100%' }}>
                <option value="">For me{userName ? ` (${userName})` : ''}</option>
                {people.filter(n => !isMe(n, userName)).map(n => <option key={n} value={n}>For {n}</option>)}
              </select>
            </div>
            {unread > 0 && <button onClick={markAll} style={{ background: 'transparent', border: 'none', color: T.blue, cursor: 'pointer', fontSize: '11px', fontWeight: 700 }}>Mark all read</button>}
            <button onClick={() => setOpen(false)} aria-label="Close reminders" style={S.iconBtn(T.textSecondary)}><i className="ti ti-x" /></button>
          </div>
          <div style={{ overflowY: 'auto' }}>
            {all.length === 0 ? (
              <div style={{ padding: '26px 16px', textAlign: 'center', color: T.textSecondary, fontSize: '12px' }}>
                <i className="ti ti-mood-smile" style={{ fontSize: '24px', color: T.green, display: 'block', marginBottom: '6px' }} />
                Nothing overdue, nothing due in the next {REMIND_RULES.dueSoonDays} days, and no handovers in the next {REMIND_RULES.handoverDays} days.
                {!me && <div style={{ marginTop: '6px', color: T.textMuted }}>Your portal name isn't known; pick a person above.</div>}
              </div>
            ) : (
              <>
                <Group title="Overdue" icon="ti-alarm" color={T.red} items={r.overdue} />
                <Group title={`Due in the next ${REMIND_RULES.dueSoonDays} days`} icon="ti-calendar-due" color={T.orange} items={r.soon} />
                <Group title={`Handovers (next ${REMIND_RULES.handoverDays} days)`} icon="ti-flag-check" color={T.blue} items={r.handovers} />
              </>
            )}
          </div>
          <div style={{ padding: '8px 14px', borderTop: `1px solid ${T.border}`, fontSize: '10px', color: T.textMuted }}>
            Tasks assigned to you, plus unassigned tasks on projects you own. Read state is saved in this browser.
          </div>
        </div>
      )}
    </div>
  )
}
