'use client'

import { useEffect, useMemo, useState } from 'react'
import ExcelJS from 'exceljs/dist/exceljs.min.js'
import {
  calcAC, calcDC, AC_INSTALL_METHODS, AC_CORES, AC_PROTECTION, AC_INSULATION, AC_CONDUCTOR,
  DC_TYPES, DC_METHODS, AC_NOTES, DC_NOTES, AC_FACTORS,
} from '@/lib/cableSizing'

const STORAGE_KEY = 'sosimple.cableSizing.v1'

let _id = 0
const newId = () => `${Date.now().toString(36)}-${(_id++).toString(36)}`

const blankAC = () => ({
  id: newId(), from: '', to: '', ib: '', method: 'Buried', distance: '', voltage: 400,
  protection: 'Armoured', insulation: 'PVC', conductor: 'Copper', cores: 'Four', derating: '',
})
const blankDC = () => ({
  id: newId(), from: '', to: '', type: 'PV String', current: '', strings: 1, method: 'Free Air (single)',
  distance: '', modules: '', vmp: '', systemV: '', derating: '',
})

const DEFAULT_STATE = () => ({
  project: { name: '', number: '', engineer: '', date: new Date().toISOString().slice(0, 10), address: '', coordinates: '' },
  ac: [{ ...blankAC(), from: 'Inverter', to: 'MSB', ib: 180, distance: 200, protection: 'Unarmoured', insulation: 'Rubber' }],
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
        if (saved && saved.project && Array.isArray(saved.ac) && Array.isArray(saved.dc)) setState(saved)
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
    setState({ project: { ...DEFAULT_STATE().project }, ac: [blankAC()], dc: [blankDC()] })
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
  const Sel = ({ kind, row, k, options }) => (
    <select value={row[k]} onChange={e => updateRow(kind, row.id, k, e.target.value)} style={cellSelect}>
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

  // ── Excel export ──
  async function exportExcel() {
    setExporting(true)
    try {
      const wb = new ExcelJS.Workbook()
      wb.creator = 'Sosimple Energy'
      const p = state.project
      const navy = 'FF1A2A4A', blue = 'FF1E6FC4'
      const statusFill = s => ({ ok: 'FFE3F2D6', check: 'FFFFEFD0', fail: 'FFFBDADA' }[statusKind(s)])
      const addSheet = (title, heading, headers, rows, notes) => {
        const ws = wb.addWorksheet(title)
        ws.addRow([heading]).font = { bold: true, size: 14, color: { argb: navy } }
        ws.addRow([])
        ;[['Project Name', p.name, 'Address', p.address], ['Project Number', p.number, 'Coordinates', p.coordinates], ['Engineer', p.engineer, 'Date', p.date]]
          .forEach(r => { const row = ws.addRow(r); row.getCell(1).font = { bold: true }; row.getCell(3).font = { bold: true } })
        ws.addRow([])
        const hr = ws.addRow(headers.map(h => h.label))
        hr.eachCell((c, i) => {
          c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: headers[i - 1].out ? blue : navy } }
          c.alignment = { wrapText: true, vertical: 'middle' }
        })
        hr.height = 32
        rows.forEach(vals => {
          const r = ws.addRow(vals)
          headers.forEach((h, i) => { if (h.fmt) r.getCell(i + 1).numFmt = h.fmt })
          const sc = r.getCell(headers.length)
          const f = statusFill(sc.value)
          if (f) sc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: f } }
          sc.font = { bold: true }
        })
        headers.forEach((h, i) => { ws.getColumn(i + 1).width = h.w || 12 })
        ws.addRow([])
        ws.addRow(['Notes / Assumptions:']).font = { bold: true }
        notes.forEach(n => ws.addRow([`• ${n}`]))
        return ws
      }
      const nz = v => (v === '' || v === null || v === undefined ? null : v)

      addSheet('AC Cable Sizes', 'AC Cable Sizing (SANS 10142-1)', [
        { label: '#', w: 5 }, { label: 'Design Current Ib (A)' }, { label: 'Termination Point A', w: 16 }, { label: 'Termination Point B', w: 16 },
        { label: 'Installation Method', w: 16 }, { label: 'Cable Distance (m)' }, { label: 'System Voltage (V)' }, { label: 'Cable Protection' },
        { label: 'Conductor Insulation' }, { label: 'Conductor (Cu/Al)' }, { label: 'Cores' }, { label: 'Derating Ca x Cg' },
        { label: 'Cables in Parallel', out: true }, { label: 'Recommended Size (mm²)', out: true }, { label: 'Cable CCC – total (A)', out: true, fmt: '0.0' },
        { label: 'Voltage Drop (V)', out: true, fmt: '0.00' }, { label: 'Voltage Drop (%)', out: true, fmt: '0.00%' }, { label: 'Circuit Breaker (A)', out: true },
        { label: 'Earth Conductor (mm²)', out: true }, { label: 'Status', out: true, w: 26 },
      ], state.ac.map((r, i) => { const x = acResults[i]; return [
        i + 1, nz(r.ib), r.from, r.to, r.method, nz(r.distance), nz(r.voltage), r.protection, r.insulation, r.conductor, r.cores, nz(r.derating) ?? AC_FACTORS.derate,
        x.runs ?? null, x.size ?? (x.empty ? null : x.valid ? 'Exceeds range' : 'Check inputs'), x.cccTotal ?? null, x.vdV ?? null, x.vdPct ?? null,
        x.breaker ?? (x.valid ? 'Exceeds range' : null), x.earth ?? null, x.status ?? '',
      ] }), AC_NOTES)

      addSheet('DC Cable Sizes', 'DC / PV Cable Sizing', [
        { label: '#', w: 5 }, { label: 'Termination Point A', w: 16 }, { label: 'Termination Point B', w: 16 }, { label: 'Circuit Type', w: 13 },
        { label: 'Current Input (A)' }, { label: 'Strings in Parallel' }, { label: 'Installation Method', w: 20 }, { label: 'Distance one-way (m)' },
        { label: 'Modules per String' }, { label: 'Module Vmp (V)' }, { label: 'System Voltage (V DC) – manual' }, { label: 'Derating' },
        { label: 'Total System Voltage (V DC)', out: true, fmt: '0.0' }, { label: 'Design Current Ib (A)', out: true, fmt: '0.00' }, { label: 'Cables in Parallel', out: true },
        { label: 'Recommended Size (mm²)', out: true }, { label: 'Cable CCC – total (A)', out: true, fmt: '0.0' }, { label: 'Voltage Drop (V)', out: true, fmt: '0.00' },
        { label: 'Voltage Drop (%)', out: true, fmt: '0.00%' }, { label: 'DC MCB / Fuse (A)', out: true }, { label: 'Status', out: true, w: 26 },
      ], state.dc.map((r, i) => { const x = dcResults[i]; return [
        i + 1, r.from, r.to, r.type, nz(r.current), nz(r.strings), r.method, nz(r.distance), nz(r.modules), nz(r.vmp), nz(r.systemV), nz(r.derating) ?? 1,
        x.systemV ?? null, x.ib ?? null, x.runs ?? null, x.size ?? (x.empty ? null : x.valid ? 'Exceeds range' : 'Check inputs'),
        x.cccTotal ?? null, x.vdV ?? null, x.vdPct ?? null, x.prot ?? (x.valid ? 'Exceeds range' : null), x.status ?? '',
      ] }), DC_NOTES)

      const buffer = await wb.xlsx.writeBuffer()
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const safe = (p.number || p.name || 'Project').replace(/[^\w\- ]+/g, '').trim() || 'Project'
      a.href = url
      a.download = `Cable Sizing - ${safe} - ${p.date || new Date().toISOString().slice(0, 10)}.xlsx`
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(url)
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
          {[['name', 'Project Name'], ['number', 'Project Number'], ['engineer', 'Engineer'], ['date', 'Date', 'date'], ['address', 'Address'], ['coordinates', 'Coordinates']].map(([k, l, type]) => (
            <label key={k} style={{ display: 'block' }}>
              <div style={labelStyle}>{l}</div>
              <input type={type || 'text'} value={state.project[k]} onChange={e => setProject(k, e.target.value)}
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
          ['System voltage (V)', NumIn({ kind, row, k: 'voltage' }), '230 V for 2-core (1ph), 400 V for 3/4-core (3ph)'],
          ['Cores', Sel({ kind, row, k: 'cores', options: Object.keys(AC_CORES) })],
          ['Insulation', Sel({ kind, row, k: 'insulation', options: AC_INSULATION })],
          ['Conductor', Sel({ kind, row, k: 'conductor', options: AC_CONDUCTOR })],
          ['Cable protection', Sel({ kind, row, k: 'protection', options: AC_PROTECTION })],
          ['Derating Ca × Cg', NumIn({ kind, row, k: 'derating', step: 0.01, placeholder: '1.00 (default)' }), 'Blank = 1.0. Include grouping, ambient, burial and parallel-run derating.'],
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
          ['Cables in parallel', x.runs ?? '—'],
          ['CCC – total', x.cccTotal != null ? `${fmt(x.cccTotal)} A` : '—'],
          ['Voltage drop', x.vdV != null ? `${fmt(x.vdV, 2)} V · ${pct(x.vdPct)}` : '—'],
          ['Circuit breaker', x.breaker ? `${x.breaker} A` : '—'],
          ['Earth conductor', x.earth ? `${x.earth} mm²` : '—'],
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
                        {x.size ? <>{x.runs > 1 ? `${x.runs} × ` : ''}{x.size}<span style={{ fontSize: '14px', fontWeight: 700 }}> mm²</span></> : x.empty ? '—' : x.valid ? 'Exceeds range' : 'Check inputs'}
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
        Results update as you type. Your draft is kept in this browser until you reset it. Reference data follows the Electrical.xlsx “SANS Data” sheet — verify against your official SANS 10142-1 copy and manufacturer data.
      </div>
    </div>
  )
}
