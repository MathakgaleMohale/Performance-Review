'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  calcAC, calcDC, AC_INSTALL_METHODS, AC_CORES, AC_PROTECTION, AC_INSULATION, AC_CONDUCTOR, AC_SPACING,
  DC_TYPES, DC_METHODS, AC_NOTES, DC_NOTES,
} from '@/lib/cableSizing'
import { buildCableScheduleWorkbook, CABLE_TEMPLATE_URL } from '@/lib/cableScheduleExport'

const STORAGE_KEY = 'sosimple.cableSizing.v1'
const LOGO_SRC = '/sosimple-logo.png.png'

let _id = 0
const newId = () => `${Date.now().toString(36)}-${(_id++).toString(36)}`

const blankAC = () => ({
  id: newId(), from: '', to: '', ib: '', method: 'Buried', distance: '', voltage: 400,
  protection: 'Armoured', insulation: 'PVC', conductor: 'Copper', cores: 'Four', derating: '',
  spacing: '', faultKA: '', faultT: '',
})
const blankDC = () => ({
  id: newId(), from: '', to: '', type: 'PV String', current: '', strings: 1, method: 'Free Air (single)',
  distance: '', modules: '', vmp: '', systemV: '', derating: '',
})

const blankProject = () => ({
  name: '', number: '', docNumber: '', client: '', address: '', coordinates: '',
  date: new Date().toISOString().slice(0, 10), revision: '00', designed: '', checked: '', approved: '', revDescription: '',
})

// Header block – same order as the Electrical.xlsx sheets (left pair / right pair)
const HEADER_ROWS = [
  [['name', 'Project Name'], ['date', 'Date', 'date']],
  [['number', 'Project Number'], ['revision', 'Revision']],
  [['docNumber', 'Document Number'], ['designed', 'Designed']],
  [['address', 'Address'], ['checked', 'Checked']],
  [['coordinates', 'Coordinates'], ['approved', 'Approved']],
  [['client', 'Client'], ['revDescription', 'Rev. Description']],
]

const DEFAULT_STATE = () => ({
  project: blankProject(),
  ac: [{ ...blankAC(), from: 'Inverter', to: 'MSB', ib: 180, distance: 200, protection: 'Unarmoured' }],
  dc: [{ ...blankDC(), from: 'String 1', to: 'Inverter', type: 'PV String', current: 16, distance: 100, modules: 18, vmp: 50 }],
})

const fmt = (v, dp = 1) => (typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('en-ZA', { minimumFractionDigits: dp, maximumFractionDigits: dp }) : '')
const pct = v => (typeof v === 'number' && Number.isFinite(v) ? `${(v * 100).toFixed(2)}%` : '')

function statusKind(s) {
  if (!s) return 'none'
  if (s === 'OK') return 'ok'
  if (s.startsWith('CHECK')) return 'check'
  return 'fail'
}

// ── Sheet ("paper") colours – fixed so the schedule looks the same in light/dark mode and on paper ──
const P = {
  font: "Calibri, Carlito, 'Segoe UI', Arial, sans-serif",
  ink: '#1a2a4a',          // Sosimple navy
  line: '#8796ab',
  lineDark: '#1a2a4a',
  banner: '#1E6FC4',       // Sosimple blue
  subHead: '#1E6FC4',
  headFill: '#eaf1fa',
  inputFill: '#f7faff',
  inputInk: '#0b3fd6',     // Excel convention: blue = input
  status: {
    ok: { fg: '#006100', bg: '#C6EFCE' },
    check: { fg: '#9C5700', bg: '#FFEB9C' },
    fail: { fg: '#9C0006', bg: '#FFC7CE' },
    none: { fg: '#1a2a4a', bg: 'transparent' },
  },
}

// Column definitions: [key, header, width(px), kind]  kind: in = input, out = calculated
const AC_COLS = [
  ['n', '#', 30],
  ['ib', 'Design Current Ib (A)', 66, 'in'],
  ['from', 'Termination Point A', 96, 'in'],
  ['to', 'Termination Point B', 96, 'in'],
  ['method', 'Installation Method', 104, 'in'],
  ['distance', 'Cable Distance (m)', 62, 'in'],
  ['voltage', 'System Voltage (V)', 60, 'in'],
  ['protection', 'Cable Protection', 86, 'in'],
  ['insulation', 'Conductor Insulation', 70, 'in'],
  ['conductor', 'Conductor (Cu/Al)', 78, 'in'],
  ['cores', 'Cores', 136, 'in'],
  ['o_runs', 'Cables in Parallel', 58, 'out'],
  ['o_size', 'Recommended Size (mm²)', 78, 'out'],
  ['o_cg', 'Grouping Factor Cg (runs)', 62, 'out'],
  ['o_ccc', 'Cable CCC – total (A)', 64, 'out'],
  ['o_vdv', 'Voltage Drop (V)', 60, 'out'],
  ['o_vdp', 'Voltage Drop (%)', 60, 'out'],
  ['o_brk', 'Circuit Breaker Size (A)', 66, 'out'],
  ['o_brkType', 'Breaker Type', 58, 'out'],
  ['o_ir', 'Trip Setting Ir (A)', 60, 'out'],
  ['o_earth', 'Earth Conductor (mm²)', 64, 'out'],
  ['o_sc', 'Cable SC Withstand per run (kA)', 74, 'out'],
  ['o_status', 'Status', 150, 'out'],
]
const DC_COLS = [
  ['n', '#', 30],
  ['from', 'Termination Point A', 100, 'in'],
  ['to', 'Termination Point B', 100, 'in'],
  ['type', 'Circuit Type', 110, 'in'],
  ['current', 'Current Input (A) – Isc per string for PV', 80, 'in'],
  ['strings', 'Strings in Parallel (PV Array)', 72, 'in'],
  ['method', 'Installation Method', 130, 'in'],
  ['distance', 'Cable Distance one-way (m)', 74, 'in'],
  ['modules', 'Modules per String (PV)', 72, 'in'],
  ['vmp', 'Module Voltage Vmp (V)', 72, 'in'],
  ['systemV', 'System Voltage (V DC) – if no modules entered', 86, 'in'],
  ['derating', 'Derating (blank = default)', 72, 'in'],
  ['o_sysV', 'Total System Voltage (V DC)', 76, 'out'],
  ['o_ib', 'Design Current Ib (A)', 70, 'out'],
  ['o_runs', 'Cables in Parallel', 64, 'out'],
  ['o_size', 'Recommended Size (mm²)', 84, 'out'],
  ['o_ccc', 'Cable CCC – total (A)', 70, 'out'],
  ['o_vdv', 'Voltage Drop (V)', 66, 'out'],
  ['o_vdp', 'Voltage Drop (%)', 66, 'out'],
  ['o_prot', 'DC MCB / Fuse Size (A)', 70, 'out'],
  ['o_status', 'Status', 160, 'out'],
]

const SHEETS = {
  ac: {
    cols: AC_COLS, notes: AC_NOTES,
    title: 'AC POWER CABLE SCHEDULE',
    banner: 'AC CABLES – SIZING TO SANS 10142-1 / IEC 60364-5-52',
    inLabel: 'AC Cable Inputs', outLabel: 'Calculated Outputs (SANS 10142-1)',
  },
  dc: {
    cols: DC_COLS, notes: DC_NOTES,
    title: 'DC POWER CABLE SCHEDULE',
    banner: 'DC / PV CABLES – SIZING',
    inLabel: 'DC Cable Inputs', outLabel: 'Calculated Outputs (DC / PV)',
  },
}

// Input field config per column key: [type, options?, blankLabel?, placeholder?, step?]
const AC_INPUTS = {
  ib: ['num'], from: ['txt'], to: ['txt'],
  method: ['sel', Object.keys(AC_INSTALL_METHODS)],
  distance: ['num'], voltage: ['num'],
  protection: ['sel', AC_PROTECTION], insulation: ['sel', AC_INSULATION], conductor: ['sel', AC_CONDUCTOR],
  cores: ['sel', Object.keys(AC_CORES)],
  derating: ['num', null, null, '1.00', 0.01],
  spacing: ['sel', AC_SPACING.filter(o => o !== 'Touching'), 'Touching'],
  faultKA: ['num', null, null, '—'], faultT: ['num', null, null, 'default', 0.01],
}
const DC_INPUTS = {
  from: ['txt'], to: ['txt'],
  type: ['sel', Object.keys(DC_TYPES)],
  current: ['num'], strings: ['num', null, null, '1', 1],
  method: ['sel', DC_METHODS],
  distance: ['num'], modules: ['num', null, null, '', 1], vmp: ['num'],
  systemV: ['num'], derating: ['num', null, null, '1.00', 0.01],
}

function acOutputs(x) {
  if (!x || x.empty) return {}
  const sizeText = x.size ? (x.runs > 1 ? `${x.runs} × ${x.size}` : `${x.size}`) : x.valid ? (x.sizeLabel || 'Exceeds range') : 'Check inputs'
  return {
    o_runs: x.size ? x.runs : '',
    o_size: sizeText,
    o_cg: x.size ? fmt(x.Cg, 2) : '',
    o_ccc: x.cccTotal != null ? fmt(x.cccTotal, 1) : '',
    o_vdv: x.vdV != null ? fmt(x.vdV, 2) : '',
    o_vdp: x.vdPct != null ? pct(x.vdPct) : '',
    o_brk: x.breaker ? x.breaker : x.valid ? 'Exceeds range' : '',
    o_brkType: x.breakerType || '',
    o_ir: x.ir ? fmt(x.ir, 0) : '',
    o_earth: x.earth || '',
    o_sc: x.size ? (x.scChecked ? fmt(x.scWithstand, 1) : 'Not checked') : '',
    o_status: x.status || '',
    _sizeIsText: !x.size,
  }
}
function dcOutputs(x) {
  if (!x || x.empty) return {}
  return {
    o_sysV: x.systemV != null ? fmt(x.systemV, 0) : '',
    o_ib: x.ib != null ? fmt(x.ib, 2) : '',
    o_runs: x.size ? x.runs : '',
    o_size: x.size ? (x.runs > 1 ? `${x.runs} × ${x.size}` : `${x.size}`) : x.valid ? 'Exceeds range' : 'Check inputs',
    o_ccc: x.cccTotal != null ? fmt(x.cccTotal, 1) : '',
    o_vdv: x.vdV != null ? fmt(x.vdV, 2) : '',
    o_vdp: x.vdPct != null ? pct(x.vdPct) : '',
    o_prot: x.prot || '',
    o_status: x.status || '',
    _sizeIsText: !x.size,
  }
}

// CSS used both on screen (scoped to .cs-sheet) and inside the print frame
const SHEET_CSS = `
.cs-sheet { font-family: ${P.font}; color: ${P.ink}; background: #fff; }
.cs-sheet table { border-collapse: collapse; table-layout: fixed; }
.cs-sheet td, .cs-sheet th { border: 1px solid ${P.line}; padding: 3px 4px; text-align: center; vertical-align: middle; overflow-wrap: break-word; hyphens: auto; }
.cs-sheet input, .cs-sheet select { width: 100%; box-sizing: border-box; border: none; background: transparent; font: inherit; color: ${P.inputInk}; text-align: center; text-align-last: center; padding: 3px 2px; outline: none; border-radius: 2px; }
.cs-sheet select { cursor: pointer; }
.cs-sheet input:focus, .cs-sheet select:focus { outline: 2px solid ${P.banner}; outline-offset: -1px; background: #fff; }
.cs-sheet input::placeholder { color: #9aa8bb; }
.cs-sheet input[type=number]::-webkit-inner-spin-button, .cs-sheet input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
.cs-sheet input[type=number] { -moz-appearance: textfield; }
.cs-sheet .cs-act { border: none !important; background: transparent; padding: 0 0 0 6px; }
.cs-sheet .cs-act button { background: #fff; border: 1px solid ${P.line}; color: #5b6b80; border-radius: 4px; padding: 2px 5px; cursor: pointer; font-size: 12px; line-height: 1; }
.cs-sheet .cs-act button:hover { color: ${P.banner}; border-color: ${P.banner}; }
.cs-sheet .cs-act button.del:hover { color: #c62828; border-color: #c62828; }
.cs-sheet tbody tr:hover td.cs-in { background: #eef4fd; }
`

const PRINT_CSS = `
@page { size: A3 landscape; margin: 8mm; }
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
.cs-page { page-break-after: always; break-after: page; }
.cs-page:last-child { page-break-after: auto; break-after: auto; }
.cs-sheet { font-size: 11px; }
.cs-sheet thead { display: table-header-group; }
.cs-sheet tr { page-break-inside: avoid; break-inside: avoid; }
.cs-notes { page-break-inside: avoid; break-inside: avoid; }
${SHEET_CSS}
`

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

export default function CableSizingTool({ T, cardStyle, selectStyle }) {
  const [state, setState] = useState(DEFAULT_STATE)
  const [tab, setTab] = useState('ac')
  const [loaded, setLoaded] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [printing, setPrinting] = useState(false)
  const printRef = useRef(null)

  // Restore / autosave the working draft in this browser
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const saved = JSON.parse(raw)
        if (saved && saved.project && Array.isArray(saved.ac) && Array.isArray(saved.dc)) {
          const legacyEngineer = saved.project.engineer
          setState({
            project: { ...blankProject(), ...(legacyEngineer && !saved.project.designed ? { designed: legacyEngineer } : {}), ...saved.project },
            ac: saved.ac.map(r => ({ ...blankAC(), ...r })),
            dc: saved.dc.map(r => ({ ...blankDC(), ...r })),
          })
        }
      }
    } catch (e) { /* ignore */ }
    setLoaded(true)
  }, [])
  useEffect(() => {
    if (!loaded) return
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)) } catch (e) { /* ignore */ }
  }, [state, loaded])

  // Other derating, spacing and fault-level inputs were removed from the AC sheet: always use the defaults
  // (Ca = 1.00, touching, short-circuit not checked), even if an older saved draft still holds values.
  const acRows = useMemo(() => state.ac.map(r => ({ ...r, derating: '', spacing: '', faultKA: '', faultT: '' })), [state.ac])
  const acResults = useMemo(() => acRows.map(r => calcAC(r)), [acRows])
  const dcResults = useMemo(() => state.dc.map(r => calcDC(r)), [state.dc])

  const setProject = (k, v) => setState(s => ({ ...s, project: { ...s.project, [k]: v } }))
  const updateRow = (kind, id, k, v) => setState(s => ({ ...s, [kind]: s[kind].map(r => (r.id === id ? { ...r, [k]: v } : r)) }))
  const addRow = kind => setState(s => ({ ...s, [kind]: [...s[kind], kind === 'ac' ? blankAC() : blankDC()] }))
  const dupRow = (kind, id) => setState(s => {
    const i = s[kind].findIndex(r => r.id === id)
    const copy = { ...s[kind][i], id: newId() }
    return { ...s, [kind]: [...s[kind].slice(0, i + 1), copy, ...s[kind].slice(i + 1)] }
  })
  const delRow = (kind, id) => setState(s => ({ ...s, [kind]: s[kind].filter(r => r.id !== id) }))
  const resetAll = () => {
    if (typeof window !== 'undefined' && !window.confirm('Clear all project details and circuits?')) return
    setState({ project: blankProject(), ac: [blankAC()], dc: [blankDC()] })
  }

  // ── toolbar styles (app theme) ──
  const toolbarStatus = {
    ok: { fg: T.green, bg: `${T.green}1f` },
    check: { fg: T.orange, bg: `${T.orange}1f` },
    fail: { fg: T.red, bg: `${T.red}1a` },
  }
  const btn = (bg, fg = '#fff', border = 'none') => ({ padding: '8px 14px', background: bg, color: fg, border, borderRadius: '7px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px' })
  const tabBtn = active => ({
    padding: '8px 16px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', borderRadius: '7px',
    border: `1px solid ${active ? T.blue : T.border}`, background: active ? T.blue : T.bgPanel, color: active ? '#fff' : T.textSecondary,
    display: 'inline-flex', alignItems: 'center', gap: '6px',
  })

  const results = tab === 'ac' ? acResults : dcResults
  const counts = results.reduce((a, r) => { const k = statusKind(r.status); if (!r.empty) a[k] = (a[k] || 0) + 1; return a }, {})

  // ── Excel export: fills the company calculator workbook ──
  const [exportError, setExportError] = useState('')
  const fileRef = () => {
    const p = state.project
    return (p.docNumber || p.number || p.name || 'Project').replace(/[^\w\- .]+/g, '').trim() || 'Project'
  }
  async function exportExcel() {
    setExporting(true)
    setExportError('')
    try {
      const res = await fetch(CABLE_TEMPLATE_URL)
      if (!res.ok) throw new Error(`Template not found (${res.status})`)
      const template = await res.arrayBuffer()
      const data = await buildCableScheduleWorkbook(template, { project: state.project, ac: acRows, dc: state.dc, acResults, dcResults })
      const blob = new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${fileRef()} - Cable Schedule - ${state.project.date || new Date().toISOString().slice(0, 10)}.xlsx`
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) {
      setExportError(`Could not create the Excel file: ${e.message || e}`)
    } finally {
      setExporting(false)
    }
  }

  // ── Print / Save as PDF: A3 landscape, AC and DC schedules each on their own page ──
  async function printSchedule() {
    if (!printRef.current) return
    setPrinting(true)
    try {
      const iframe = document.createElement('iframe')
      iframe.setAttribute('aria-hidden', 'true')
      Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' })
      document.body.appendChild(iframe)
      const doc = iframe.contentDocument
      const title = `${fileRef()} - Cable Schedule`
      doc.open()
      doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><base href="${window.location.origin}/"><style>${PRINT_CSS}</style></head><body>${printRef.current.innerHTML}</body></html>`)
      doc.close()
      await Promise.all(Array.from(doc.images).map(img => (img.complete ? null : new Promise(r => { img.onload = r; img.onerror = r }))))
      const prevTitle = document.title
      document.title = title // some browsers use the top page title as the PDF file name
      iframe.contentWindow.focus()
      iframe.contentWindow.print()
      setTimeout(() => { document.title = prevTitle; iframe.remove() }, 1500)
    } finally {
      setPrinting(false)
    }
  }

  // ── Sheet renderer (editable on screen, static for print) ──
  function renderSheet(kind, editable) {
    const cfg = SHEETS[kind]
    const rows = state[kind]
    const res = kind === 'ac' ? acResults : dcResults
    const inputs = kind === 'ac' ? AC_INPUTS : DC_INPUTS
    const outFn = kind === 'ac' ? acOutputs : dcOutputs
    const p = state.project
    const total = cfg.cols.reduce((s, c) => s + c[2], 0)
    const nIn = cfg.cols.filter(c => c[3] === 'in').length
    const nOut = cfg.cols.filter(c => c[3] === 'out').length
    const colW = w => (editable ? `${w}px` : `${(w / total * 100).toFixed(3)}%`)

    const headerCell = { fontWeight: 700, background: P.headFill, fontSize: '0.92em', lineHeight: 1.2 }
    const projLabel = { ...headerCell, textAlign: 'left', paddingLeft: '8px', whiteSpace: 'nowrap' }
    const projValue = { color: P.inputInk, padding: editable ? 0 : '3px 6px' }

    const projInput = (k, type) => (editable
      ? <input type={type || 'text'} value={p[k] ?? ''} onChange={e => setProject(k, e.target.value)} />
      : (p[k] || ''))

    const inCell = (row, k) => {
      const [type, options, blankLabel, placeholder, step] = inputs[k]
      if (!editable) {
        const v = row[k]
        return v === '' || v == null ? '' : String(v)
      }
      if (type === 'sel') {
        return (
          <select value={row[k]} onChange={e => updateRow(kind, row.id, k, e.target.value)}>
            {blankLabel ? <option value="">{blankLabel}</option> : null}
            {options.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        )
      }
      if (type === 'num') {
        return (
          <input type="number" inputMode="decimal" step={step || 'any'} value={row[k]} placeholder={placeholder || ''}
            onChange={e => updateRow(kind, row.id, k, e.target.value === '' ? '' : Number(e.target.value))} />
        )
      }
      return <input type="text" value={row[k]} placeholder={placeholder || ''} onChange={e => updateRow(kind, row.id, k, e.target.value)} />
    }

    const titleName = (p.name || 'Project Name').toUpperCase()

    return (
      <div className="cs-sheet" style={{ width: editable ? `${total}px` : '100%', padding: editable ? '0' : '0' }}>
        {/* Header block */}
        <table style={{ width: '100%' }}>
          <colgroup>
            <col style={{ width: '15%' }} /><col style={{ width: '37%' }} />
            <col style={{ width: '10%' }} /><col style={{ width: '17%' }} />
            <col style={{ width: '9%' }} /><col style={{ width: '12%' }} />
          </colgroup>
          <tbody>
            {HEADER_ROWS.map(([[k1, l1, t1], [k2, l2, t2]], i) => (
              <tr key={k1} style={{ height: '26px' }}>
                {i === 0 && (
                  <td rowSpan={6} style={{ padding: '8px' }}>
                    <img src={LOGO_SRC} alt="Sosimple Energy" style={{ maxWidth: '100%', maxHeight: '120px', display: 'block', margin: '0 auto' }} />
                  </td>
                )}
                {i === 0 && (
                  <td rowSpan={6} style={{ fontSize: '1.9em', fontWeight: 800, lineHeight: 1.25, letterSpacing: '0.5px', color: P.ink }}>
                    {titleName}<br />{cfg.title}
                  </td>
                )}
                <td style={projLabel}>{l1}</td>
                <td style={projValue}>{projInput(k1, t1)}</td>
                <td style={projLabel}>{l2}</td>
                <td style={projValue}>{projInput(k2, t2)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ height: '6px' }} />
        <div style={{ background: P.banner, color: '#fff', fontWeight: 800, fontSize: '1.25em', textAlign: 'center', padding: '7px 8px', letterSpacing: '0.4px', border: `1px solid ${P.lineDark}` }}>
          {cfg.banner}
        </div>
        <div style={{ height: '6px' }} />

        {/* Circuit table */}
        <table style={{ width: editable ? `${total + 64}px` : '100%' }}>
          <colgroup>
            {cfg.cols.map(([k, , w]) => <col key={k} style={{ width: colW(w) }} />)}
            {editable && <col style={{ width: '64px' }} />}
          </colgroup>
          <thead>
            <tr>
              <th style={{ border: 'none' }} />
              <th colSpan={nIn} style={{ color: P.subHead, fontSize: '1.15em', fontWeight: 800, padding: '5px' }}>{cfg.inLabel}</th>
              <th colSpan={nOut} style={{ color: P.subHead, fontSize: '1.15em', fontWeight: 800, padding: '5px' }}>{cfg.outLabel}</th>
              {editable && <th className="cs-act" />}
            </tr>
            <tr>
              {cfg.cols.map(([k, label]) => (
                <th key={k} style={{ ...headerCell, height: '58px' }}>{label}</th>
              ))}
              {editable && <th className="cs-act" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const x = res[i]
              const o = outFn(x)
              const sk = statusKind(x.empty ? '' : x.status)
              return (
                <tr key={row.id} style={{ height: '24px' }}>
                  {cfg.cols.map(([k, , , type]) => {
                    if (k === 'n') return <td key={k} style={{ fontWeight: 700 }}>{i + 1}</td>
                    if (type === 'in') {
                      return <td key={k} className="cs-in" style={{ padding: editable ? 0 : '3px 4px', color: P.inputInk, background: editable ? P.inputFill : 'transparent' }}>{inCell(row, k)}</td>
                    }
                    if (k === 'o_status') {
                      const c = P.status[sk]
                      return <td key={k} style={{ fontWeight: 700, color: c.fg, background: c.bg, fontSize: '0.92em' }}>{o.o_status || ''}</td>
                    }
                    const isWarn = k === 'o_size' && o._sizeIsText
                    return (
                      <td key={k} style={{ fontVariantNumeric: 'tabular-nums', fontWeight: k === 'o_size' ? 700 : 400, color: isWarn ? P.status.fail.fg : P.ink, background: isWarn ? P.status.fail.bg : 'transparent' }}>
                        {o[k] ?? ''}
                      </td>
                    )
                  })}
                  {editable && (
                    <td className="cs-act">
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button title="Duplicate row" onClick={() => dupRow(kind, row.id)}><i className="ti ti-copy" /></button>
                        <button title="Remove row" className="del" onClick={() => delRow(kind, row.id)}><i className="ti ti-trash" /></button>
                      </div>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>

        {/* Notes */}
        <div className="cs-notes" style={{ marginTop: '10px', fontSize: '0.88em', lineHeight: 1.5, maxWidth: editable ? `${total}px` : 'none' }}>
          <div style={{ fontWeight: 800, color: P.subHead, marginBottom: '3px' }}>Notes / Assumptions:</div>
          {cfg.notes.map((n, i) => <div key={i}>• {n}</div>)}
          {!editable && (
            <div style={{ marginTop: '8px', color: '#5b6b80' }}>
              Reference data per Electrical.xlsx “SANS Data” and “Cable Data” sheets – verify against the official SANS 10142-1 and manufacturer data. Printed {new Date().toLocaleDateString('en-ZA')} from the Sosimple Energy Portal.
            </div>
          )}
        </div>
      </div>
    )
  }

  const hasCircuits = kind => (kind === 'ac' ? acResults : dcResults).some(r => !r.empty)
  const printKinds = ['ac', 'dc'].filter(hasCircuits)

  return (
    <div>
      <style>{SHEET_CSS}</style>

      {/* Toolbar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        <button onClick={() => setTab('ac')} style={tabBtn(tab === 'ac')}><i className="ti ti-bolt" />AC Cables</button>
        <button onClick={() => setTab('dc')} style={tabBtn(tab === 'dc')}><i className="ti ti-solar-panel" />DC / PV Cables</button>
        <div style={{ display: 'flex', gap: '6px', marginLeft: '8px', flexWrap: 'wrap' }}>
          {[['ok', 'OK'], ['check', 'Check'], ['fail', 'Fail']].map(([k, l]) => (
            <span key={k} style={{ fontSize: '11px', fontWeight: 700, padding: '4px 10px', borderRadius: '999px', color: toolbarStatus[k].fg, background: toolbarStatus[k].bg }}>
              {counts[k] || 0} {l}
            </span>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={() => addRow(tab)} style={btn(T.blue)}><i className="ti ti-plus" />Add {tab === 'ac' ? 'AC' : 'DC'} circuit</button>
        <button onClick={resetAll} style={btn('transparent', T.textSecondary, `1px solid ${T.border}`)}><i className="ti ti-refresh" />Reset</button>
        <button onClick={printSchedule} disabled={printing || printKinds.length === 0} style={btn(T.navy || '#1a2a4a')} title="A3 landscape – AC and DC schedules on separate pages">
          <i className="ti ti-printer" />{printing ? 'Preparing…' : 'Print / PDF'}
        </button>
        <button onClick={exportExcel} disabled={exporting} style={btn(T.green)}>
          <i className="ti ti-file-spreadsheet" />{exporting ? 'Exporting…' : 'Download Excel'}
        </button>
      </div>

      {exportError && (
        <div style={{ ...cardStyle, padding: '10px 14px', marginBottom: '12px', borderLeft: `3px solid ${T.red}`, color: T.red, fontSize: '12px', fontWeight: 600 }}>{exportError}</div>
      )}

      {/* The schedule sheet ("paper") */}
      <div style={{ ...cardStyle, background: '#fff', padding: '18px', overflowX: 'auto' }}>
        <div style={{ fontSize: '12px', minWidth: 'max-content' }}>
          {renderSheet(tab, true)}
        </div>
      </div>

      <div style={{ fontSize: '11px', color: T.textMuted, marginTop: '10px', lineHeight: 1.6 }}>
        Blue cells are inputs; results update as you type. Your draft is kept in this browser until you reset it. Print / PDF prints the AC and DC schedules on A3 landscape (choose “Save as PDF” in the print dialog for a PDF).
      </div>

      {/* Hidden static copy used for printing */}
      <div ref={printRef} style={{ display: 'none' }} aria-hidden="true">
        {printKinds.map(k => <div key={k} className="cs-page">{renderSheet(k, false)}</div>)}
      </div>
    </div>
  )
}
