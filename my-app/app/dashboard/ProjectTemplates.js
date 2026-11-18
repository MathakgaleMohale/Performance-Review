'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { STAGES, STAGE_META, templateTaskCount, templatesMissing } from './projectConfig'

// ─────────────────────────────────────────────────────────────────────────────
// Manage project templates (Projects workspace, Phase 4 step 1)
//  A template = a project type with a starter checklist for each of the 8 stages.
//  Used by the New project form. Editing a template never changes existing projects.
// SQL: supabase/project_templates.sql (run once, after projects.sql)
// ─────────────────────────────────────────────────────────────────────────────

const clone = t => ({
  id: t.id || null, name: t.name || '', description: t.description || '', sort: t.sort ?? 0, active: t.active !== false,
  tasks: Object.fromEntries(STAGES.map(s => [s, [...((t.tasks || {})[s] || [])]])),
})
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

export default function ProjectTemplates({ T, cardStyle, selectStyle, S, userName, templates, tableReady, narrow, onClose, onSaved }) {
  const [selId, setSelId] = useState(templates[0]?.id || templates[0]?.name || null)
  const sel = templates.find(t => (t.id || t.name) === selId)
  const [draft, setDraft] = useState(sel ? clone(sel) : null)
  const [base, setBase] = useState(sel ? clone(sel) : null)
  const [open, setOpen] = useState(STAGES[0])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmDel, setConfirmDel] = useState(false)
  const dirty = draft && base && !same(draft, base)

  const guard = () => !dirty || window.confirm('You have unsaved changes to this template. Discard them?')
  const pick = t => {
    if (!guard()) return
    setSelId(t.id || t.name); setDraft(clone(t)); setBase(clone(t)); setError(''); setConfirmDel(false)
  }
  const startNew = (from) => {
    if (!guard()) return
    const names = new Set(templates.map(t => t.name.toLowerCase()))
    let name = from ? `${from.name} (copy)` : 'New template'
    for (let i = 2; names.has(name.toLowerCase()); i++) name = from ? `${from.name} (copy ${i})` : `New template ${i}`
    const d = clone({ ...(from || {}), id: null, name, sort: (Math.max(0, ...templates.map(t => t.sort || 0)) + 1), active: true })
    setSelId('__new'); setDraft(d); setBase(clone({ id: null, name: '', tasks: {} })); setError(''); setConfirmDel(false); setOpen(STAGES[0])
  }
  const close = () => { if (guard()) onClose() }

  const setD = (k, v) => setDraft(d => ({ ...d, [k]: v }))
  const setTasks = (stage, fn) => setDraft(d => ({ ...d, tasks: { ...d.tasks, [stage]: fn([...d.tasks[stage]]) } }))
  const moveTask = (stage, i, dir) => setTasks(stage, l => { const j = i + dir; if (j < 0 || j >= l.length) return l; [l[i], l[j]] = [l[j], l[i]]; return l })

  async function save() {
    const name = draft.name.trim()
    if (!name) { setError('Give the template a name.'); return }
    if (templates.some(t => t.name.toLowerCase() === name.toLowerCase() && (t.id || t.name) !== (draft.id || '__new'))) { setError(`There is already a template called "${name}".`); return }
    const tasks = Object.fromEntries(STAGES.map(s => [s, draft.tasks[s].map(x => x.trim()).filter(Boolean)]))
    const row = { name, description: draft.description.trim() || null, tasks, sort: Number(draft.sort) || 0, active: draft.active, updated_by: userName || null }
    setBusy(true); setError('')
    try {
      const res = draft.id
        ? await supabase.from('project_templates').update(row).eq('id', draft.id).select().single()
        : await supabase.from('project_templates').insert([{ ...row, created_by: userName || null }]).select().single()
      if (res.error) throw res.error
      const saved = clone(res.data)
      setSelId(res.data.id); setDraft(saved); setBase(saved)
      onSaved(`Template "${name}" saved`)
    } catch (e) {
      setError(templatesMissing(e) ? 'The templates table is not set up yet. Run supabase/project_templates.sql once in the Supabase SQL Editor.' : (e.message || String(e)))
    } finally { setBusy(false) }
  }

  async function remove() {
    setBusy(true); setError('')
    const { error: e } = await supabase.from('project_templates').delete().eq('id', draft.id)
    setBusy(false)
    if (e) { setError(e.message); return }
    setSelId(null); setDraft(null); setBase(null); setConfirmDel(false)
    onSaved(`Template "${draft.name}" deleted`)
  }

  const total = draft ? templateTaskCount(draft) : 0
  const list = draft && selId === '__new' ? [...templates, { ...draft, name: draft.name || 'New template', __new: true }] : templates

  return (
    <div style={S.overlay} onClick={e => { if (e.target === e.currentTarget && !busy) close() }}>
      <div role="dialog" aria-label="Project templates" style={{ ...cardStyle, width: '100%', maxWidth: '980px', height: narrow ? '92vh' : '84vh', padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '16px 20px', borderBottom: `1px solid ${T.border}` }}>
          <i className="ti ti-template" style={{ fontSize: '20px', color: T.blue }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '16px', fontWeight: 800, color: T.textPrimary }}>Project templates</div>
            <div style={{ fontSize: '11px', color: T.textMuted }}>Each project type starts with its own checklist. Changes apply to new projects only.</div>
          </div>
          <button onClick={close} disabled={busy} aria-label="Close" style={S.iconBtn(T.textSecondary)}><i className="ti ti-x" /></button>
        </div>

        {!tableReady && (
          <div style={{ margin: '12px 20px 0', padding: '10px 12px', borderRadius: '8px', border: `1px solid ${T.orange}66`, background: `${T.orange}12`, fontSize: '12px', color: T.textSecondary }}>
            <i className="ti ti-database-off" style={{ color: T.orange }} /> Templates can't be saved yet. Run <b>supabase/project_templates.sql</b> once in the Supabase SQL Editor. Until then, the built-in templates below are used.
          </div>
        )}

        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: narrow ? 'column' : 'row' }}>
          {/* Template list */}
          <div style={{ flex: narrow ? '0 0 auto' : '0 0 240px', borderRight: narrow ? 'none' : `1px solid ${T.border}`, borderBottom: narrow ? `1px solid ${T.border}` : 'none', padding: '12px', overflowY: 'auto', display: 'flex', flexDirection: narrow ? 'row' : 'column', gap: '6px', flexWrap: narrow ? 'nowrap' : 'nowrap', overflowX: narrow ? 'auto' : 'hidden' }}>
            {list.map(t => {
              const id = t.__new ? '__new' : (t.id || t.name)
              const on = id === selId
              return (
                <button key={id} onClick={() => !t.__new && pick(t)} aria-pressed={on}
                  style={{ textAlign: 'left', padding: '9px 11px', borderRadius: '8px', cursor: 'pointer', flexShrink: 0, border: `1px solid ${on ? T.blue : T.border}`, background: on ? `${T.blue}12` : T.bgPanel, color: T.textPrimary, opacity: t.active === false ? 0.6 : 1 }}>
                  <div style={{ fontSize: '12px', fontWeight: 800, whiteSpace: 'nowrap' }}>{t.name}{t.__new ? ' *' : ''}</div>
                  <div style={{ fontSize: '10px', color: T.textMuted, marginTop: '2px', whiteSpace: 'nowrap' }}>{templateTaskCount(t)} tasks{t.active === false ? ' · hidden' : ''}</div>
                </button>
              )
            })}
            <button onClick={() => startNew(null)} disabled={!tableReady || busy} style={{ ...S.ghost, justifyContent: 'center', flexShrink: 0, marginTop: narrow ? 0 : '4px', opacity: tableReady ? 1 : 0.5 }}><i className="ti ti-plus" />New template</button>
          </div>

          {/* Editor */}
          <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '16px 20px' }}>
            {!draft ? (
              <div style={{ color: T.textMuted, fontSize: '13px', textAlign: 'center', padding: '40px 10px' }}>Pick a template on the left, or create a new one.</div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr' : '1fr 2fr', gap: '12px' }}>
                  <div><div style={S.labelStyle}>Name (project type)</div><input value={draft.name} onChange={e => setD('name', e.target.value)} disabled={!tableReady} style={S.inp} /></div>
                  <div><div style={S.labelStyle}>Description</div><input value={draft.description} onChange={e => setD('description', e.target.value)} disabled={!tableReady} placeholder="When to use this template" style={S.inp} /></div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '14px', marginTop: '10px', fontSize: '12px', color: T.textSecondary }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                    <input type="checkbox" checked={draft.active} onChange={e => setD('active', e.target.checked)} disabled={!tableReady} />Show on the New project form
                  </label>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    Order <input type="number" value={draft.sort} onChange={e => setD('sort', e.target.value)} disabled={!tableReady} style={{ ...S.inp, width: '64px', padding: '5px 8px' }} />
                  </label>
                  <span style={{ marginLeft: 'auto', color: T.textMuted }}>{total} tasks across {STAGES.length} stages</span>
                </div>

                {/* Stages */}
                <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {STAGES.map((stage, si) => {
                    const meta = STAGE_META[stage]
                    const tasks = draft.tasks[stage]
                    const isOpen = open === stage
                    return (
                      <div key={stage} style={{ border: `1px solid ${isOpen ? meta.color + '66' : T.border}`, borderRadius: '9px', overflow: 'hidden' }}>
                        <button onClick={() => setOpen(isOpen ? null : stage)} aria-expanded={isOpen}
                          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 12px', border: 'none', background: isOpen ? `${meta.color}10` : T.bgMuted, cursor: 'pointer', color: T.textPrimary }}>
                          <span style={{ fontSize: '10px', fontWeight: 800, color: T.textMuted, width: '18px' }}>{String(si + 1).padStart(2, '0')}</span>
                          <i className={`ti ${meta.icon}`} style={{ color: meta.color, fontSize: '15px' }} />
                          <span style={{ fontSize: '12px', fontWeight: 800 }}>{stage}</span>
                          <span style={{ fontSize: '11px', color: T.textMuted }}>{tasks.filter(x => x.trim()).length} tasks</span>
                          <i className={`ti ti-chevron-${isOpen ? 'up' : 'down'}`} style={{ marginLeft: 'auto', color: T.textMuted }} />
                        </button>
                        {isOpen && (
                          <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {tasks.length === 0 && <div style={{ fontSize: '11px', color: T.textMuted }}>No starter tasks for this stage.</div>}
                            {tasks.map((task, i) => (
                              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <i className="ti ti-square" style={{ color: T.textMuted, fontSize: '14px' }} />
                                <input value={task} disabled={!tableReady} aria-label={`${stage} task ${i + 1}`}
                                  onChange={e => setTasks(stage, l => { l[i] = e.target.value; return l })}
                                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); setTasks(stage, l => { l.splice(i + 1, 0, ''); return l }); setTimeout(() => document.querySelector(`[aria-label="${stage} task ${i + 2}"]`)?.focus(), 0) } }}
                                  style={{ ...S.inp, padding: '6px 9px', fontSize: '12px' }} />
                                {tableReady && <>
                                  <button onClick={() => moveTask(stage, i, -1)} disabled={i === 0} title="Move up" style={{ ...S.iconBtn(T.textSecondary), opacity: i === 0 ? 0.35 : 1 }}><i className="ti ti-arrow-up" /></button>
                                  <button onClick={() => moveTask(stage, i, 1)} disabled={i === tasks.length - 1} title="Move down" style={{ ...S.iconBtn(T.textSecondary), opacity: i === tasks.length - 1 ? 0.35 : 1 }}><i className="ti ti-arrow-down" /></button>
                                  <button onClick={() => setTasks(stage, l => { l.splice(i, 1); return l })} title="Remove task" style={S.iconBtn(T.red)}><i className="ti ti-trash" /></button>
                                </>}
                              </div>
                            ))}
                            {tableReady && (
                              <button onClick={() => { setTasks(stage, l => [...l, '']); setTimeout(() => document.querySelector(`[aria-label="${stage} task ${tasks.length + 1}"]`)?.focus(), 0) }}
                                style={{ alignSelf: 'flex-start', background: 'transparent', border: 'none', color: T.blue, cursor: 'pointer', fontSize: '12px', fontWeight: 700, padding: '4px 0', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                <i className="ti ti-plus" />Add task
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        {draft && (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', padding: '12px 20px', borderTop: `1px solid ${T.border}` }}>
            {error && <div style={{ flexBasis: '100%', fontSize: '12px', color: T.red }}>{error}</div>}
            {tableReady && draft.id && !confirmDel && <button onClick={() => setConfirmDel(true)} disabled={busy} style={{ ...S.ghost, color: T.red }}><i className="ti ti-trash" />Delete</button>}
            {confirmDel && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: T.textSecondary }}>
                Delete "{draft.name}"? Projects already created keep their tasks.
                <button onClick={remove} disabled={busy} style={S.btn(T.red)}>Delete</button>
                <button onClick={() => setConfirmDel(false)} disabled={busy} style={S.ghost}>Keep</button>
              </span>
            )}
            {tableReady && draft.id && !confirmDel && <button onClick={() => startNew(draft)} disabled={busy} style={S.ghost}><i className="ti ti-copy" />Duplicate</button>}
            <span style={{ marginLeft: 'auto', fontSize: '11px', color: dirty ? T.orange : T.textMuted }}>{dirty ? 'Unsaved changes' : draft.id ? 'Saved' : ''}</span>
            {dirty && <button onClick={() => { if (selId === '__new') { setSelId(null); setDraft(null); setBase(null) } else setDraft(clone(base)) }} disabled={busy} style={S.ghost}>Discard</button>}
            <button onClick={save} disabled={!tableReady || busy || !dirty} style={{ ...S.btn(T.blue), opacity: !tableReady || busy || !dirty ? 0.5 : 1 }}><i className="ti ti-check" />{busy ? 'Saving…' : 'Save template'}</button>
          </div>
        )}
      </div>
    </div>
  )
}
