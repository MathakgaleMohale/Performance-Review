'use client'

import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { supabase } from '@/lib/supabase'
import { fmtShort } from './projectConfig'
import DesignPackHost from './DesignPackHost'

// ─────────────────────────────────────────────────────────────────────────────
// Engineering work saved inside a project (table project_items):
//   BOQ / Costing and Cable Sizing, several named versions per project.
// The tools are the same components as under Engineering Tools, opened in
// "project mode" (initialState / onStateChange) so they save to the project.
// SQL: supabase/project_items.sql
// ─────────────────────────────────────────────────────────────────────────────

const loadingBox = <div style={{ padding: 40, textAlign: 'center', fontSize: 13, color: '#8698ad' }}>Loading tool…</div>
const BoqTool = dynamic(() => import('./BoqTool'), { ssr: false, loading: () => loadingBox })
const CableSizingTool = dynamic(() => import('./CableSizingTool'), { ssr: false, loading: () => loadingBox })

export const WORK_KINDS = {
  boq:   { label: 'BOQ / Costing',  short: 'BOQ',            icon: 'ti-file-invoice',   color: '#5b3fa8', stage: 'BOQ' },
  cable: { label: 'Cable schedule', short: 'Cable schedule', icon: 'ti-plug-connected', color: '#B88A00', stage: 'Design' },
}

export const workSetupMessage = 'BOQs and cable schedules need one more setup step: run supabase/project_items.sql in the Supabase SQL Editor.'

// Starting data for a new item, pre-filled from the project
export function newItemData(kind, p, userName) {
  if (kind === 'boq') {
    return {
      project: {
        name: p.name || '', client: p.client || '', site: p.site_name || p.location || '',
        sizeKwp: p.capacity_kwp ?? '', sizeKwh: p.battery_kwh ?? '', preparedBy: userName || '', revision: '00',
      },
      settings: {}, lines: [], extraSections: [],
    }
  }
  return {
    project: { name: p.name || '', client: p.client || '', address: p.location || p.site_name || '', designed: userName || '', revision: '00' },
    ac: [{}], dc: [{}],
  }
}

export const nextTitle = (kind, items) => {
  const n = items.filter(i => i.kind === kind).length
  return `${WORK_KINDS[kind].short} Rev ${String(n).padStart(2, '0')}`
}
export const bumpTitle = (title, items) => {
  const m = title.match(/^(.*?Rev\s*)(\d+)(.*)$/i)
  let t = m ? `${m[1]}${String(Number(m[2]) + 1).padStart(m[2].length, '0')}${m[3]}` : `${title} Rev 01`
  while (items.some(i => i.title === t)) t += ' (copy)'
  return t
}

// ── List card shown on each stage ──
export function WorkItemsCard({ items, stage, ready, T, cardStyle, S, onOpen, onCreate, onDuplicate, onDelete, designPacks = [], onOpenFile, onDeleteFile, packDrafts = null, onNewPack, onOpenPack, onAllPacks }) {
  const list = items.filter(i => i.stage === stage)
  const others = items.filter(i => i.stage !== stage)
  const row = i => {
    const k = WORK_KINDS[i.kind] || WORK_KINDS.boq
    return (
      <div key={i.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 0', borderBottom: `1px solid ${T.border}` }}>
        <i className={`ti ${k.icon}`} style={{ color: k.color, fontSize: '18px' }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div onClick={() => onOpen(i)} style={{ fontSize: '12px', fontWeight: 700, color: T.textPrimary, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.title}</div>
          <div style={{ fontSize: '10px', color: T.textMuted }}>{[k.label, i.stage !== stage ? i.stage : null, `updated ${fmtShort(i.updated_at)}`, i.updated_by].filter(Boolean).join(' · ')}</div>
        </div>
        <button onClick={() => onOpen(i)} style={S.iconBtn(T.blue)} title="Open, edit & download"><i className="ti ti-external-link" /></button>
        <button onClick={() => onDuplicate(i)} style={S.iconBtn(T.textSecondary)} title="Duplicate as next revision"><i className="ti ti-copy" /></button>
        <button onClick={() => onDelete(i)} style={S.iconBtn(T.red)} title="Delete"><i className="ti ti-trash" /></button>
      </div>
    )
  }
  return (
    <div style={{ ...cardStyle, padding: '16px', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '12px', flexWrap: 'wrap' }}>
        <i className="ti ti-tools" style={{ color: T.blue, fontSize: '15px' }} />
        <span style={{ fontSize: '13px', fontWeight: 800, color: T.textPrimary }}>Engineering work</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '5px' }}>
          <button disabled={!ready} onClick={() => onCreate('boq')} style={{ ...S.iconBtn(T.blue), opacity: ready ? 1 : 0.5 }} title="New BOQ / costing"><i className="ti ti-plus" />BOQ</button>
          <button disabled={!ready} onClick={() => onCreate('cable')} style={{ ...S.iconBtn(T.blue), opacity: ready ? 1 : 0.5 }} title="New cable schedule"><i className="ti ti-plus" />Cable schedule</button>
          {onNewPack && <button onClick={onNewPack} style={S.iconBtn(T.blue)} title="Start a new design pack for this project"><i className="ti ti-plus" />Design pack</button>}
        </div>
      </div>
      {!ready ? (
        <div style={{ fontSize: '12px', color: T.textSecondary, borderLeft: `3px solid ${T.orange}`, paddingLeft: '10px' }}>{workSetupMessage}</div>
      ) : (
        <>
          {list.length === 0 && <div style={{ fontSize: '12px', color: T.textMuted, marginBottom: '6px' }}>No BOQs or cable schedules on this stage yet. They open in the same tools as Engineering Tools and save to this project, and you can download Excel / PDF from inside them.</div>}
          {list.map(row)}
          {others.length > 0 && (
            <>
              <div style={{ ...S.labelStyle, marginTop: '12px' }}>Other stages</div>
              {others.map(row)}
            </>
          )}
          {/* Saved design pack drafts (design_packs) */}
          <div style={{ display: 'flex', alignItems: 'center', marginTop: '12px' }}>
            <div style={{ ...S.labelStyle, marginBottom: 0 }}>Design packs</div>
            {onAllPacks && packDrafts && packDrafts.length > 0 && <button onClick={onAllPacks} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: T.blue, fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}>All design packs</button>}
          </div>
          {packDrafts === null ? (
            <div style={{ fontSize: '11px', color: T.textMuted, padding: '6px 0' }}>Saving design packs needs supabase/design_packs.sql to be run once. You can still use <b>+ Design pack</b> and download the PDF.</div>
          ) : packDrafts.length === 0 ? (
            <div style={{ fontSize: '11px', color: T.textMuted, padding: '6px 0' }}>No design packs yet. Use <b>+ Design pack</b> to start one; Save draft keeps it here.</div>
          ) : packDrafts.map(d => {
            const issued = d.design_pack_issues?.[0]?.count || 0
            return (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 0', borderBottom: `1px solid ${T.border}` }}>
                <i className="ti ti-layout-grid" style={{ color: T.green, fontSize: '18px' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div onClick={() => onOpenPack(d.id)} style={{ fontSize: '12px', fontWeight: 700, color: T.textPrimary, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title}</div>
                  <div style={{ fontSize: '10px', color: T.textMuted }}>{['Design pack draft', d.revision && `Rev ${d.revision}`, `${issued} issued`, `updated ${fmtShort(d.updated_at)}`, d.updated_by].filter(Boolean).join(' · ')}</div>
                </div>
                <button onClick={() => onOpenPack(d.id)} style={S.iconBtn(T.blue)} title="Continue this design pack"><i className="ti ti-pencil" /></button>
              </div>
            )
          })}
          {designPacks.length > 0 && (
            <>
              <div style={{ ...S.labelStyle, marginTop: '12px' }}>Issued design pack PDFs</div>
              {designPacks.map(f => (
                <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 0', borderBottom: `1px solid ${T.border}` }}>
                  <i className="ti ti-file-type-pdf" style={{ color: '#D93A3A', fontSize: '18px' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div onClick={() => onOpenFile(f)} style={{ fontSize: '12px', fontWeight: 700, color: T.textPrimary, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.file_name}</div>
                    <div style={{ fontSize: '10px', color: T.textMuted }}>{['Design pack', f.stage, fmtShort(f.created_at), f.uploaded_by].filter(Boolean).join(' · ')}</div>
                  </div>
                  <button onClick={() => onOpenFile(f)} style={S.iconBtn(T.blue)} title="Open"><i className="ti ti-eye" /></button>
                  <button onClick={() => onOpenFile(f, true)} style={S.iconBtn(T.green)} title="Download"><i className="ti ti-download" /></button>
                  {onDeleteFile && <button onClick={() => onDeleteFile(f)} style={S.iconBtn(T.red)} title="Delete this PDF from the project"><i className="ti ti-trash" /></button>}
                </div>
              ))}
            </>
          )}
        </>
      )}
    </div>
  )
}

// ── Full-width view of one item, using the real tool ──
export function ToolView({ item, project, T, cardStyle, selectStyle, S, userName, onClose, onRenamed }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [title, setTitle] = useState(item.title)
  const [save, setSave] = useState('')
  const [equipment, setEquipment] = useState([])
  const [eqLoading, setEqLoading] = useState(false)
  const pending = useRef(null)
  const lastSaved = useRef('')
  const timer = useRef(null)
  const k = WORK_KINDS[item.kind] || WORK_KINDS.boq

  useEffect(() => {
    let alive = true
    supabase.from('project_items').select('data').eq('id', item.id).single().then(({ data: d, error: e }) => {
      if (!alive) return
      if (e) { setError(e.message); return }
      lastSaved.current = JSON.stringify(d.data || {})
      setData(d.data || {})
    })
    return () => { alive = false }
  }, [item.id])

  async function loadEquipment() {
    if (eqLoading || equipment.length) return
    setEqLoading(true)
    const { data: eq } = await supabase.from('equipment_inventory').select('*').order('category').order('name')
    setEquipment(eq || []); setEqLoading(false)
  }

  async function flush() {
    clearTimeout(timer.current)
    const st = pending.current
    if (!st) return
    pending.current = null
    const json = JSON.stringify(st)
    if (json === lastSaved.current) { setSave('saved'); return }
    setSave('saving')
    const { error: e } = await supabase.from('project_items').update({ data: st, updated_by: userName || null }).eq('id', item.id)
    if (e) { setSave('error'); setError(`Not saved: ${e.message}`); pending.current = st; return }
    lastSaved.current = json
    setSave('saved')
  }
  function onStateChange(st) {
    pending.current = st
    if (JSON.stringify(st) === lastSaved.current) return
    setSave('saving')
    clearTimeout(timer.current)
    timer.current = setTimeout(flush, 1500)
  }
  useEffect(() => () => { flush() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function saveTitle() {
    const t = title.trim()
    if (!t || t === item.title) { setTitle(item.title); return }
    const { error: e } = await supabase.from('project_items').update({ title: t, updated_by: userName || null }).eq('id', item.id)
    if (e) { setError(e.message); setTitle(item.title) } else onRenamed && onRenamed(t)
  }

  return (
    <div>
      <div className="no-print" style={{ ...cardStyle, padding: '10px 14px', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <button onClick={async () => { await flush(); onClose() }} style={{ ...selectStyle, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}><i className="ti ti-arrow-left" />Back to project</button>
        <span style={{ fontSize: '12px', color: T.textMuted, whiteSpace: 'nowrap' }}>{project.name} /</span>
        <i className={`ti ${k.icon}`} style={{ color: k.color, fontSize: '18px' }} />
        <input value={title} onChange={e => setTitle(e.target.value)} onBlur={saveTitle} onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
          title="Rename" style={{ ...S.inp, width: 'auto', minWidth: '220px', flex: '0 1 340px', fontWeight: 700 }} />
        <span style={{ marginLeft: 'auto', fontSize: '11px', color: save === 'error' ? T.red : T.textMuted }}>
          {save === 'saving' ? 'Saving…' : save === 'saved' ? <><i className="ti ti-cloud-check" /> Saved to project</> : save === 'error' ? 'Not saved — check your connection' : 'Changes save to this project automatically'}
        </span>
      </div>
      {error && <div style={{ ...cardStyle, padding: '10px 14px', marginBottom: '12px', color: T.red, fontSize: '12px' }}>{error}</div>}
      {!data ? (!error && <div style={{ ...cardStyle, padding: '40px', textAlign: 'center', color: T.textSecondary, fontSize: '13px' }}>Loading…</div>)
        : item.kind === 'boq'
          ? <BoqTool T={T} cardStyle={cardStyle} selectStyle={selectStyle} equipment={equipment} equipmentLoading={eqLoading} onLoadEquipment={loadEquipment} initialState={data} onStateChange={onStateChange} />
          : <CableSizingTool T={T} cardStyle={cardStyle} selectStyle={selectStyle} initialState={data} onStateChange={onStateChange} />}
    </div>
  )
}

// ── Bar shown above a tool opened from the project ──
export function EmbedBar({ project, icon, color, title, note, T, cardStyle, selectStyle, onBack }) {
  return (
    <div className="no-print" style={{ ...cardStyle, padding: '10px 14px', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
      <button onClick={onBack} style={{ ...selectStyle, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}><i className="ti ti-arrow-left" />Back to project</button>
      <span style={{ fontSize: '12px', color: T.textMuted, whiteSpace: 'nowrap' }}>{project.name} /</span>
      <i className={`ti ${icon}`} style={{ color, fontSize: '18px' }} />
      <span style={{ fontSize: '14px', fontWeight: 800, color: T.textPrimary }}>{title}</span>
      {note && <span style={{ marginLeft: 'auto', fontSize: '11px', color: T.textMuted }}>{note}</span>}
    </div>
  )
}

// ── Design Pack Generator opened from a project ──
// Pre-fills the project information and saves the compiled PDF into the project (stage Design).
export function DesignPackView({ project, T, cardStyle, selectStyle, userName, onBack, onCompiled, packId = null, startNew = false }) {
  const kwp = project.capacity_kwp ? `${Number(project.capacity_kwp).toLocaleString('en-US')} kWp` : ''
  const prefill = {
    name: project.name, location: project.location || project.site_name || '', sizeDc: kwp,
    description: [kwp, project.battery_kwh ? `${Number(project.battery_kwh).toLocaleString('en-US')} kWh BESS` : '', project.system_type].filter(Boolean).join(' · '),
  }
  return (
    <div>
      <EmbedBar project={project} icon="ti-layout-grid" color={T.green} title="Design Pack Generator"
        note="Save draft keeps the pack in this project. Each compiled PDF is kept as an issued revision and saved to the Design stage files."
        T={T} cardStyle={cardStyle} selectStyle={selectStyle} onBack={onBack} />
      <DesignPackHost project={project} prefill={prefill} T={T} cardStyle={cardStyle} selectStyle={selectStyle} userName={userName}
        onCompiled={onCompiled} height="calc(100vh - 250px)" initialPackId={packId} startNew={startNew} />
    </div>
  )
}
