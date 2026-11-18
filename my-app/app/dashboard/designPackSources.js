'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Design Pack Generator ⇄ BOQ / Cable Sizing
// The generator (public/design-pack-generator.html) runs in an iframe. The page
// that hosts it (Engineering Tools → Design Pack, or a project's Design Pack view)
// prepares the BOQs and cable schedules here and posts them to the iframe:
//   iframe → host : sos-design-pack:ready            (also asks for the lists)
//   iframe → host : sos-design-pack:requestSources   (Refresh button)
//   host → iframe : sos-design-pack:sources { items } (ready-to-print schedules)
// Cable calculations use the same engine as the Cable Sizing tool (lib/cableSizing).
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { calcAC, calcDC } from '@/lib/cableSizing'
import { BOQ_SECTIONS } from './BoqTool'
import { acOutputs, dcOutputs } from './CableSizingTool'

const BOQ_DRAFT_KEY = 'sosimple.boq.v1'
const CABLE_DRAFT_KEY = 'sosimple.cableSizing.v1'

const blank = v => v == null || String(v).trim() === ''
const numTxt = v => {
  const n = Number(v)
  return blank(v) || !Number.isFinite(n) ? '' : n.toLocaleString('en-US', { maximumFractionDigits: 2 })
}
// The Cable Sizing tool formats numbers for South African screens ("1 249,5"); the pack uses "1,249.5" like the rest of the document
const normNum = v => {
  if (typeof v !== 'string') return v
  const t = v.replace(/[\u00a0\u202f]/g, ' ')
  return t.replace(/\d{1,3}(?: \d{3})*(?:,\d+)?/g, m => (/[ ,]/.test(m) ? m.replace(/ /g, '#').replace(',', '.').replace(/#/g, ',') : m))
}
const normAll = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, normNum(v)]))
const statusKind = s => (!s ? 'none' : s === 'OK' ? 'ok' : s.startsWith('CHECK') ? 'check' : 'fail')

// ── BOQ → quantities-only schedule (no prices) ──
export function boqToSchedule(state, title = 'BOQ') {
  const lines = (state?.lines || []).filter(l => !blank(l.description) || Number(l.qty))
  const order = [...BOQ_SECTIONS, ...(state?.extraSections || [])]
  const sections = []
  order.forEach(name => {
    const ls = lines.filter(l => l.section === name)
    if (ls.length) sections.push({ name, lines: ls })
  })
  const orphan = lines.filter(l => !order.includes(l.section))
  if (orphan.length) sections.push({ name: 'Other', lines: orphan })
  const p = state?.project || {}
  return {
    kind: 'boq',
    title,
    project: { name: p.name || '', client: p.client || '', revision: p.revision || '', docNumber: p.docNumber || '', kwp: p.sizeKwp ?? '', kwh: p.sizeKwh ?? '' },
    sections: sections.map((s, si) => ({
      name: s.name,
      lines: s.lines.map((l, li) => ({ no: `${si + 1}.${li + 1}`, description: l.description || '—', unit: l.unit || '', qty: numTxt(l.qty) })),
    })),
    lineCount: lines.length,
    summary: `${lines.length} line${lines.length === 1 ? '' : 's'} in ${sections.length} section${sections.length === 1 ? '' : 's'}`,
  }
}

// What the pack's project fields can take from a BOQ (only used for empty fields)
export function prefillFromBoq(state) {
  const p = state?.project || {}
  const kwp = Number(p.sizeKwp)
  const kwh = Number(p.sizeKwh)
  const out = {}
  if (kwp > 0) out.sizeDc = `${kwp.toLocaleString('en-US', { maximumFractionDigits: 2 })} kWp`
  // AC size: sum of inverter kW, only when every inverter line states its kW (e.g. "Sungrow SG110CX 110 kW")
  const inv = (state?.lines || []).filter(l => l.section === 'Inverters' && !blank(l.description))
  if (inv.length) {
    let total = 0
    const ok = inv.every(l => {
      const m = String(l.description).match(/(\d+(?:[.,]\d+)?)\s*kW(?![p\w])/i)
      if (!m) return false
      total += Number(m[1].replace(',', '.')) * (Number(l.qty) || 0)
      return true
    })
    if (ok && total > 0) out.sizeAc = `${total.toLocaleString('en-US', { maximumFractionDigits: 2 })} kW`
  }
  if (kwp > 0) out.description = `${out.sizeDc}${kwh > 0 ? ` + ${kwh.toLocaleString('en-US', { maximumFractionDigits: 2 })} kWh BESS` : ''} PV System`
  return out
}

// ── Cable sizing → wire schedule (inputs + calculated results) ──
export function cableToSchedule(state, title = 'Cable schedule') {
  const counts = { ok: 0, check: 0, fail: 0 }
  const tally = s => { const k = statusKind(s); if (counts[k] != null) counts[k]++ ; return k }
  const ac = (state?.ac || []).map(r => ({ r, x: calcAC(r || {}) })).filter(({ x }) => !x.empty).map(({ r, x }, i) => {
    const o = normAll(acOutputs(x))
    const cable = [r.cores && `${r.cores === 'Four' ? '4' : r.cores === 'Three' ? '3' : r.cores === 'Two' ? '2' : ''}${/Single/.test(r.cores) ? '1' : ''}C`, r.conductor === 'Aluminium' ? 'Al' : 'Cu', r.insulation, r.protection === 'Armoured' ? 'SWA' : '']
      .filter(Boolean).join(' ')
    return {
      n: i + 1, from: r.from || '', to: r.to || '', cable, method: r.method || '', length: numTxt(r.distance), voltage: numTxt(r.voltage),
      ib: numTxt(r.ib), size: o.o_size || '', ccc: o.o_ccc || '', vdV: o.o_vdv || '', vdPct: o.o_vdp || '',
      protection: o.o_brk ? `${o.o_brk}${typeof o.o_brk === 'number' ? ' A' : ''}${o.o_brkType ? ` ${o.o_brkType}` : ''}${o.o_ir ? ` (Ir ${o.o_ir} A)` : ''}` : '',
      earth: o.o_earth ? `${o.o_earth}` : '', status: o.o_status || '', statusKind: tally(o.o_status),
    }
  })
  const dc = (state?.dc || []).map(r => ({ r, x: calcDC(r || {}) })).filter(({ x }) => !x.empty).map(({ r, x }, i) => {
    const o = normAll(dcOutputs(x))
    return {
      n: i + 1, from: r.from || '', to: r.to || '', type: r.type || '', method: r.method || '', length: numTxt(r.distance),
      strings: numTxt(r.strings), systemV: o.o_sysV || '', ib: o.o_ib || '', size: o.o_size || '', ccc: o.o_ccc || '',
      vdV: o.o_vdv || '', vdPct: o.o_vdp || '', protection: o.o_prot ? `${o.o_prot} A` : '', status: o.o_status || '', statusKind: tally(o.o_status),
    }
  })
  const p = state?.project || {}
  const parts = [ac.length && `${ac.length} AC`, dc.length && `${dc.length} DC`].filter(Boolean).join(' + ') || 'no'
  const flags = [counts.fail && `${counts.fail} fail`, counts.check && `${counts.check} to check`].filter(Boolean).join(', ')
  return {
    kind: 'cable',
    title,
    project: { name: p.name || '', revision: p.revision || '', docNumber: p.docNumber || '', designed: p.designed || '', checked: p.checked || '' },
    ac, dc, counts,
    summary: `${parts} circuit${ac.length + dc.length === 1 ? '' : 's'}${flags ? ` · ${flags}` : counts.ok ? ' · all OK' : ''}`,
  }
}

const readDraft = key => { try { return JSON.parse(localStorage.getItem(key) || 'null') } catch (e) { return null } }

// Every BOQ / cable schedule the pack can use.
//  • inside a project: that project's saved BOQs and cable schedules
//  • under Engineering Tools: this browser's current drafts + every project's saved ones
export async function loadDesignPackSources(projectId) {
  const items = []
  if (!projectId) {
    const boq = readDraft(BOQ_DRAFT_KEY)
    if (boq?.lines?.length) {
      const s = boqToSchedule(boq, boq.project?.name ? `BOQ draft – ${boq.project.name}` : 'BOQ draft')
      items.push({ id: 'draft-boq', kind: 'boq', group: 'Current draft (this browser)', label: s.title, prefill: prefillFromBoq(boq), schedule: s })
    }
    const cab = readDraft(CABLE_DRAFT_KEY)
    if (cab && (cab.ac?.length || cab.dc?.length)) {
      const s = cableToSchedule(cab, cab.project?.name ? `Cable draft – ${cab.project.name}` : 'Cable draft')
      if (s.ac.length || s.dc.length) items.push({ id: 'draft-cable', kind: 'cable', group: 'Current draft (this browser)', label: s.title, schedule: s })
    }
  }
  let q = supabase.from('project_items').select('id, project_id, kind, title, data, updated_at, projects(name)').in('kind', ['boq', 'cable']).order('updated_at', { ascending: false })
  if (projectId) q = q.eq('project_id', projectId)
  const { data, error } = await q
  if (!error) {
    (data || []).forEach(it => {
      const group = projectId ? 'This project' : (it.projects?.name || 'Project')
      try {
        if (it.kind === 'boq') {
          const s = boqToSchedule(it.data, it.title)
          items.push({ id: it.id, kind: 'boq', group, label: it.title, updatedAt: it.updated_at, prefill: prefillFromBoq(it.data), schedule: s })
        } else {
          const s = cableToSchedule(it.data, it.title)
          items.push({ id: it.id, kind: 'cable', group, label: it.title, updatedAt: it.updated_at, schedule: s })
        }
      } catch (e) { /* skip an item whose data can't be read */ }
    })
  }
  return { items, note: error && !/relation|does not exist|schema cache/i.test(error.message || '') ? `Could not load saved BOQs / cable schedules: ${error.message}` : '' }
}

// Hook for any page hosting the generator iframe: answers its requests with the lists above
export function useDesignPackSources(frameRef, projectId) {
  useEffect(() => {
    let alive = true
    async function send() {
      const win = frameRef.current?.contentWindow
      if (!win) return
      const res = await loadDesignPackSources(projectId)
      if (alive) win.postMessage({ type: 'sos-design-pack:sources', items: res.items, note: res.note, inProject: !!projectId }, window.location.origin)
    }
    function onMsg(e) {
      if (e.origin !== window.location.origin || e.source !== frameRef.current?.contentWindow) return
      const t = e.data?.type
      if (t === 'sos-design-pack:ready' || t === 'sos-design-pack:requestSources') send()
    }
    window.addEventListener('message', onMsg)
    return () => { alive = false; window.removeEventListener('message', onMsg) }
  }, [frameRef, projectId])
}
