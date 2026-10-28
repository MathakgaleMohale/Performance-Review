'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  calcAC, calcDC, AC_INSTALL_METHODS, AC_CORES, AC_PROTECTION, AC_INSULATION, AC_CONDUCTOR, AC_SPACING,
  DC_TYPES, DC_METHODS, AC_NOTES, DC_NOTES,
} from '@/lib/cableSizing'
import { buildCableScheduleWorkbook, CABLE_TEMPLATE_URL } from '@/lib/cableScheduleExport'

const STORAGE_KEY = 'sosimple.cableSizing.v1'

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

const PROJECT_FIELDS = [
  ['name', 'Project Name'], ['number', 'Project Number'], ['docNumber', 'Document Number'], ['client', 'Client'],
  ['address', 'Address'], ['coordinates', 'Coordinates'], ['date', 'Date', 'date'], ['revision', 'Revision'],
  ['designed', 'Designed'], ['checked', 'Checked'], ['approved', 'Approved'], ['revDescription', 'Rev. Description'],
]

const DEFAULT_STATE = () => ({
  project: blankProject(),
  ac: [{ ...blankAC(), from: 'Inverter', to: 'MSB', ib: 180, distance: 200, protection: 'Unarmoured' }],
  dc: [{ ...blankDC(), from: 'String 1', to: 'Inverter', type: 'PV String', current: 16, distance: 100, modules: 18, vmp: 50 }],
})

const fmt = (v, dp = 1) => (typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('en-ZA', { minimumFractionDigits: dp, maximumFractionDigits: dp }) : '—')
const pct = v => (typeof v === 'number' && Number.isFinite(v) ? `${(v * 100).toFixed(2)}%` : '—')

function statusKind(s) {
  if (!s) return 'none'
  if (s === 'OK') return 'ok'
  if (s.startsWith('CHECK')) return 'check'
  return 'fail'
}

export default function CableSizingTool({ T, cardStyle, selectStyle }) {
  const [state, setState] = useState(DEFAULT_STATE)
  const [tab, setTab] = useState('ac')
  const [showNotes, setShowNotes] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [exporting, setExporting] = useState(false)

  // Restore / autosave the working draft in this browser
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const saved = JSON.parse(raw)
        if (saved && saved.project && Array.isArray(saved.ac) && Array.isArray(saved.dc)) {
          // older drafts: fill in fields added since (project header, spacing, fault level)
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

  const acResults = useMemo(() => state.ac.map(r => calcAC(r)), [state.ac])
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

  // ── styles ──
  const statusColors = {
    ok: { fg: T.green, bg: `${T.green}1f` },
    check: { fg: T.orange, bg: `${T.orange}1f` },
    fail: { fg: T.red, bg: `${T.red}1a` },
    none: { fg: T.textMuted, bg: 'transparent' },
  }
  const cellInput = { ...selectStyle, cursor: 'text', padding: '6px 8px', fontSize: '12px', width: '100%', boxSizing: 'border-box' }
  const cellSelect = { ...selectStyle, padding: '6px 6px', fontSize: '12px', width: '100%', boxSizing: 'border-box' }
  const btn = (bg, fg = '#fff', border = 'none') => ({ padding: '8px 14px', background: bg, color: fg, border, borderRadius: '7px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px' })
  const iconBtn = color => ({ background: 'transparent', border: `1px solid ${T.border}`, color, borderRadius: '5px', padding: '4px 7px', cursor: 'pointer', fontSize: '12px', display: 'inline-flex', alignItems: 'center' })

  const NumIn = ({ kind, row, k, step = 'any', placeholder, width }) => (
    <input type="number" inputMode="decimal" step={step} value={row[k]} placeholder={placeholder}
      onChange={e => updateRow(kind, row.id, k, e.target.value === '' ? '' : Number(e.target.value))}
      style={{ ...cellInput, ...(width ? { minWidth: width } : {}) }} />
  )
  const TxtIn = ({ kind, row, k, placeholder }) => (
    <input type="text" value={row[k]} placeholder={placeholder} onChange={e => updateRow(kind, row.id, k, e.target.value)} style={cellInput} />
  )
  const Sel = ({ kind, row, k, options, blankLabel }) => (
    <select value={row[k]} onChange={e => updateRow(kind, row.id, k, e.target.value)} style={cellSelect}>
      {blankLabel ? <option value="">{blankLabel}</option> : null}
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )
  const StatusPill = ({ status }) => {
    const c = statusColors[statusKind(status)]
    if (!status) return <span style={{ color: T.textMuted }}>—</span>
    return <span style={{ display: 'inline-block', padding: '3px 9px', borderRadius: '999px', fontSize: '11px', fontWeight: 700, color: c.fg, background: c.bg, whiteSpace: 'nowrap' }}>{status}</span>
  }
  const RowActions = ({ kind, row }) => (
    <div style={{ display: 'flex', gap: '5px', justifyContent: 'flex-end' }}>
      <button title="Duplicate" onClick={() => dupRow(kind, row.id)} style={iconBtn(T.textSecondary)}><i className="ti ti-copy" /></button>
      <button title="Remove" onClick={() => delRow(kind, row.id)} style={iconBtn(T.red)}><i className="ti ti-trash" /></button>
    </div>
  )

  // ── summary ──
  const results = tab === 'ac' ? acResults : dcResults
  const counts = results.reduce((a, r) => { const k = statusKind(r.status); if (!r.empty) a[k] = (a[k] || 0) + 1; return a }, {})

  // ── Excel export: fills the company calculator workbook (same layout, formulas and reference sheets) ──
  const [exportError, setExportError] = useState('')
  async function exportExcel() {
    setExporting(true)
    setExportError('')
    try {
      const res = await fetch(CABLE_TEMPLATE_URL)
      if (!res.ok) throw new Error(`Template not found (${res.status})`)
      const template = await res.arrayBuffer()
      const data = await buildCableScheduleWorkbook(template, { project: state.project, ac: state.ac, dc: state.dc, acResults, dcResults })
      const p = state.project
      const blob = new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const ref = (p.docNumber || p.number || p.name || 'Project').replace(/[^\w\- .]+/g, '').trim() || 'Project'
      a.href = url
      a.download = `${ref} - Cable Schedule - ${p.date || new Date().toISOString().slice(0, 10)}.xlsx`
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) {
      setExportError(`Could not create the Excel file: ${e.message || e}`)
    } finally {
      setExporting(false)
    }
  }

  const labelStyle = { fontSize: '10px', fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '4px' }
  const tabBtn = active => ({
    padding: '8px 16px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', borderRadius: '7px',
    border: `1px solid ${active ? T.blue : T.border}`, background: active ? T.blue : T.bgPanel, color: active ? '#fff' : T.textSecondary,
    display: 'inline-flex', alignItems: 'center', gap: '6px',
  })

  return (
    <div>
      {/* Project details */}
      <div style={{ ...cardStyle, padding: '16px 18px', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <i className="ti ti-clipboard-text" style={{ color: T.blue }} />
          <span style={{ fontSize: '13px', fontWeight: 700, color: T.textPrimary }}>Project details</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px' }}>
          {PROJECT_FIELDS.map(([k, l, type]) => (
            <label key={k} style={{ display: 'block' }}>
              <div style={labelStyle}>{l}</div>
              <input type={type || 'text'} value={state.project[k] ?? ''} onChange={e => setProject(k, e.target.value)}
                style={{ ...selectStyle, cursor: 'text', width: '100%', boxSizing: 'border-box' }} />
            </label>
          ))}
        </div>
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        <button onClick={() => setTab('ac')} style={tabBtn(tab === 'ac')}><i className="ti ti-bolt" />AC Cables</button>
        <button onClick={() => setTab('dc')} style={tabBtn(tab === 'dc')}><i className="ti ti-solar-panel" />DC / PV Cables</button>
        <div style={{ display: 'flex', gap: '6px', marginLeft: '8px', flexWrap: 'wrap' }}>
          {[['ok', 'OK'], ['check', 'Check'], ['fail', 'Fail']].map(([k, l]) => (
            <span key={k} style={{ fontSize: '11px', fontWeight: 700, padding: '4px 10px', borderRadius: '999px', color: statusColors[k].fg, background: statusColors[k].bg }}>
              {counts[k] || 0} {l}
            </span>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={() => setShowNotes(v => !v)} style={btn('transparent', T.textSecondary, `1px solid ${T.border}`)}>
          <i className="ti ti-info-circle" />{showNotes ? 'Hide' : 'Show'} assumptions
        </button>
        <button onClick={resetAll} style={btn('transparent', T.textSecondary, `1px solid ${T.border}`)}><i className="ti ti-refresh" />Reset</button>
        <button onClick={exportExcel} disabled={exporting} style={btn(T.green)}>
          <i className="ti ti-file-spreadsheet" />{exporting ? 'Exporting…' : 'Download Excel'}
        </button>
      </div>

      {exportError && (
        <div style={{ ...cardStyle, padding: '10px 14px', marginBottom: '12px', borderLeft: `3px solid ${T.red}`, color: T.red, fontSize: '12px', fontWeight: 600 }}>{exportError}</div>
      )}

      {showNotes && (
        <div style={{ ...cardStyle, padding: '14px 18px', marginBottom: '12px', borderLeft: `3px solid ${T.yellow}` }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: T.textPrimary, marginBottom: '6px' }}>
            {tab === 'ac' ? 'AC – SANS 10142-1 assumptions' : 'DC / PV assumptions'}
          </div>
          <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12px', color: T.textSecondary, lineHeight: 1.7 }}>
            {(tab === 'ac' ? AC_NOTES : DC_NOTES).map((n, i) => <li key={i}>{n}</li>)}
          </ul>
        </div>
      )}

      {/* Circuits */}
      {(() => {
        const kind = tab
        const rows = state[kind]
        const res = kind === 'ac' ? acResults : dcResults
        const fieldLabel = (l, hint) => (
          <div style={{ ...labelStyle, display: 'flex', gap: '4px', alignItems: 'center' }} title={hint || ''}>
            {l}{hint ? <i className="ti ti-help-circle" style={{ fontSize: '11px' }} /> : null}
          </div>
        )
        const acFields = row => [
          ['Design current Ib (A)', NumIn({ kind, row, k: 'ib' })],
          ['Installation method', Sel({ kind, row, k: 'method', options: Object.keys(AC_INSTALL_METHODS) })],
          ['Cable length (m)', NumIn({ kind, row, k: 'distance' })],
          ['System voltage (V)', NumIn({ kind, row, k: 'voltage' }), '230 V for 2-core / single-core 1ph, 400 V for 3/4-core / trefoil (3ph)'],
          ['Cores', Sel({ kind, row, k: 'cores', options: Object.keys(AC_CORES) }), 'Single-core (3ph trefoil) for large currents – free air, tray/ladder, clipped or surface only'],
          ['Insulation', Sel({ kind, row, k: 'insulation', options: AC_INSULATION }), 'Rubber = H07RN-F flex: copper only, not in conduit or buried'],
          ['Conductor', Sel({ kind, row, k: 'conductor', options: AC_CONDUCTOR })],
          ['Cable protection', Sel({ kind, row, k: 'protection', options: AC_PROTECTION })],
          ['Spacing between runs', Sel({ kind, row, k: 'spacing', options: AC_SPACING.filter(o => o !== 'Touching'), blankLabel: 'Touching (default)' }), 'Air: Touching / 2 cable dia · Buried: Touching / 1 cable dia / 0.125 / 0.25 / 0.5 m · Ducts: Touching / 0.25 / 0.5 / 1.0 m'],
          ['Other derating Ca', NumIn({ kind, row, k: 'derating', step: 0.01, placeholder: '1.00 (default)' }), 'Ambient / soil temperature and grouping with OTHER circuits. Grouping of this circuit\'s parallel runs (Cg) is applied automatically.'],
          ['Fault level Ik (kA)', NumIn({ kind, row, k: 'faultKA', placeholder: 'Not checked' }), 'Prospective fault current for the short-circuit (adiabatic) check. Blank = not checked.'],
          ['Fault clearing time t (s)', NumIn({ kind, row, k: 'faultT', step: 0.01, placeholder: 'Device default' }), 'Blank = device default (MCB/MCCB 0.1 s, ACB 0.4 s). Max 5 s.'],
        ]
        const dcFields = row => {
          const hasModules = row.modules !== '' && row.vmp !== ''
          return [
            ['Circuit type', Sel({ kind, row, k: 'type', options: Object.keys(DC_TYPES) }), DC_TYPES[row.type]?.basis],
            [row.type.startsWith('PV') ? 'Isc per string (A)' : 'Current (A)', NumIn({ kind, row, k: 'current' })],
            ['Strings in parallel', NumIn({ kind, row, k: 'strings', step: 1, placeholder: '1' })],
            ['Installation method', Sel({ kind, row, k: 'method', options: DC_METHODS })],
            ['Length one-way (m)', NumIn({ kind, row, k: 'distance' })],
            ['Modules per string', NumIn({ kind, row, k: 'modules', step: 1 })],
            ['Module Vmp (V)', NumIn({ kind, row, k: 'vmp' })],
            ['System voltage (V DC)', <div style={{ opacity: hasModules ? 0.45 : 1 }}>{NumIn({ kind, row, k: 'systemV', placeholder: hasModules ? 'Using modules × Vmp' : '' })}</div>, 'Only used when modules per string and Vmp are blank'],
            ['Derating', NumIn({ kind, row, k: 'derating', step: 0.01, placeholder: '1.00 (default)' })],
          ]
        }
        const acOut = x => [
          ['Cables in parallel', x.size ? x.runs : '—'],
          ['Grouping factor Cg', x.size ? fmt(x.Cg, 2) : '—'],
          ['CCC – total', x.cccTotal != null ? `${fmt(x.cccTotal)} A` : '—'],
          ['Voltage drop', x.vdV != null ? `${fmt(x.vdV, 2)} V · ${pct(x.vdPct)}` : '—'],
          ['Circuit breaker', x.breaker ? `${x.breaker} A ${x.breakerType}` : x.valid ? 'Exceeds range' : '—'],
          ['Trip setting Ir', x.ir ? `${fmt(x.ir, 0)} A` : '—'],
          ['Earth conductor', x.earth ? `${x.earth} mm²` : '—'],
          ['SC withstand / run', x.size ? (x.scChecked ? `${fmt(x.scWithstand)} kA` : 'Not checked') : '—'],
          ['Ref. method', x.refMethod ? `${x.refMethod} · ${x.loaded === 2 ? '1ph' : '3ph'}` : '—'],
        ]
        const dcOut = x => [
          ['Total system voltage', x.systemV != null ? `${fmt(x.systemV, 0)} V DC` : '—'],
          ['Design current Ib', x.ib != null ? `${fmt(x.ib, 2)} A` : '—'],
          ['Cables in parallel', x.runs ?? '—'],
          ['CCC – total', x.cccTotal != null ? `${fmt(x.cccTotal)} A` : '—'],
          ['Voltage drop', x.vdV != null ? `${fmt(x.vdV, 2)} V · ${pct(x.vdPct)} (limit ${(x.vdLimit * 100).toFixed(0)}%)` : '—'],
          ['DC MCB / fuse', x.prot ? `${x.prot} A` : '—'],
        ]
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {rows.map((row, i) => {
              const x = res[i]
              const sk = statusKind(x.status)
              const accent = x.empty ? T.border : statusColors[sk].fg
              return (
                <div key={row.id} style={{ ...cardStyle, borderLeft: `3px solid ${accent}`, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px', padding: '10px 14px', borderBottom: `1px solid ${T.border}`, background: T.bgMuted }}>
                    <span style={{ fontSize: '12px', fontWeight: 800, color: T.textMuted, minWidth: '22px' }}>#{i + 1}</span>
                    <div style={{ width: '170px' }}>{TxtIn({ kind, row, k: 'from', placeholder: 'Termination point A' })}</div>
                    <i className="ti ti-arrow-right" style={{ color: T.textMuted }} />
                    <div style={{ width: '170px' }}>{TxtIn({ kind, row, k: 'to', placeholder: 'Termination point B' })}</div>
                    <div style={{ flex: 1 }} />
                    <StatusPill status={x.empty ? '' : x.status} />
                    <RowActions kind={kind} row={row} />
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 480px', padding: '14px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '12px' }}>
                      {(kind === 'ac' ? acFields(row) : dcFields(row)).map(([l, el, hint]) => (
                        <div key={l}>{fieldLabel(l, hint)}{el}</div>
                      ))}
                    </div>
                    <div style={{ flex: '0 1 340px', minWidth: '260px', padding: '14px 16px', background: `${T.blue}0d`, borderLeft: `1px solid ${T.border}` }}>
                      <div style={labelStyle}>Recommended size</div>
                      <div style={{ fontSize: '28px', fontWeight: 800, color: x.size ? T.blue : T.textMuted, lineHeight: 1.1, marginBottom: '10px' }}>
                        {x.size ? <>{x.runs > 1 ? `${x.runs} × ` : ''}{x.size}<span style={{ fontSize: '14px', fontWeight: 700 }}> mm²</span></> : x.empty ? '—' : x.valid ? (x.sizeLabel || 'Exceeds range') : 'Check inputs'}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', rowGap: '5px', columnGap: '12px', fontSize: '12px' }}>
                        {(kind === 'ac' ? acOut(x) : dcOut(x)).map(([l, v]) => (
                          <div key={l} style={{ display: 'contents' }}>
                            <span style={{ color: T.textSecondary }}>{l}</span>
                            <span style={{ color: T.textPrimary, fontWeight: 700, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{v}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
            <div>
              <button onClick={() => addRow(kind)} style={btn(T.blue)}><i className="ti ti-plus" />Add {kind === 'ac' ? 'AC' : 'DC'} circuit</button>
            </div>
          </div>
        )
      })()}

      <div style={{ fontSize: '11px', color: T.textMuted, marginTop: '10px', lineHeight: 1.6 }}>
        Results update as you type. Your draft is kept in this browser until you reset it. Reference data follows the Electrical.xlsx “SANS Data” and “Cable Data” sheets — verify against your official SANS 10142-1 copy and manufacturer data.
      </div>
    </div>
  )
}
