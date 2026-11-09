'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// BOQ / Costing Generator
// - Lines come from the Equipment Inventory (price fills in) or are typed manually
// - Grouped in sections with subtotals; markup (global or per line), contingency, VAT
// - Rate per kWp / Wp / kWh
// - Draft kept in this browser; Excel (BOQ, Quote, Internal Costing sheets) and Print / PDF
// - The BOQ document shows quantities only; prices appear only on the Quote (and the internal costing)
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'sosimple.boq.v1'
const LOGO_SRC = '/sosimple-logo.png.png'

// Section order. The first 9 match the Equipment Inventory categories, so picked items land in the right section.
export const BOQ_SECTIONS = [
  'PV Modules', 'Inverters', 'Batteries', 'Meters', 'Electrical BOS', 'Structural BOS', 'Civil BOS', 'Containers', 'Other Accessories',
  'Labour & Installation', 'Preliminaries & General', 'Transport & Logistics', 'Engineering & Compliance',
]
const UNITS = ['No.', 'Set', 'Lot', 'm', 'm²', 'm³', 'kg', 'kWp', 'kWh', 'Hours', 'Days', 'Sum']
const CURRENCY_SYMBOLS = { ZAR: 'R', USD: '$', EUR: '€', GBP: '£' }

let _id = 0
const newId = () => `${Date.now().toString(36)}-${(_id++).toString(36)}`

const blankProject = () => ({
  name: '', client: '', number: '', docNumber: '', site: '',
  date: new Date().toISOString().slice(0, 10), revision: '00', preparedBy: '', checkedBy: '',
  sizeKwp: '', sizeKwh: '', validity: '30 days',
})
const blankSettings = () => ({ markupPct: 25, contingencyPct: 5, vatPct: 15, rates: { USD: '', EUR: '', GBP: '' } })
const blankLine = (section, extra = {}) => ({
  id: newId(), section, source: 'manual', invId: null, description: '', unit: 'No.', qty: 1,
  unitCost: '', currency: 'ZAR', markupPct: '', ...extra,
})

const DEFAULT_STATE = () => ({ project: blankProject(), settings: blankSettings(), lines: [], extraSections: [] })

const num = v => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v))
const money = v => (typeof v === 'number' && Number.isFinite(v) ? `R ${v.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—')
const pctTxt = v => (typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(1)}%` : '—')
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// ── Calculation ──
export function calcBoq(state) {
  const { settings, lines } = state
  const gMarkup = num(settings.markupPct) ?? 0
  const missingRates = new Set()
  const calcLines = lines.map(l => {
    const qty = num(l.qty) ?? 0
    const raw = num(l.unitCost)
    let rate = 1
    if (l.currency && l.currency !== 'ZAR') {
      rate = num(settings.rates?.[l.currency])
      if (rate == null) { missingRates.add(l.currency); rate = null }
    }
    const unitCost = raw == null || rate == null ? null : raw * rate
    const markup = num(l.markupPct) ?? gMarkup
    const costTotal = unitCost == null ? 0 : unitCost * qty
    const sellRate = unitCost == null ? null : unitCost * (1 + markup / 100)
    const sellTotal = sellRate == null ? 0 : sellRate * qty
    return { ...l, qtyN: qty, unitCostZar: unitCost, markup, costTotal, sellRate, sellTotal, priced: unitCost != null }
  })
  const sections = []
  const order = [...BOQ_SECTIONS, ...(state.extraSections || [])]
  order.forEach(name => {
    const ls = calcLines.filter(l => l.section === name)
    if (!ls.length) return
    sections.push({
      name, lines: ls,
      cost: ls.reduce((s, l) => s + l.costTotal, 0),
      sell: ls.reduce((s, l) => s + l.sellTotal, 0),
    })
  })
  // lines whose section no longer exists
  const orphan = calcLines.filter(l => !order.includes(l.section))
  if (orphan.length) sections.push({ name: 'Other', lines: orphan, cost: orphan.reduce((s, l) => s + l.costTotal, 0), sell: orphan.reduce((s, l) => s + l.sellTotal, 0) })

  const costSub = sections.reduce((s, x) => s + x.cost, 0)
  const sellSub = sections.reduce((s, x) => s + x.sell, 0)
  const contingency = sellSub * (num(settings.contingencyPct) ?? 0) / 100
  const exVat = sellSub + contingency
  const vat = exVat * (num(settings.vatPct) ?? 0) / 100
  const incVat = exVat + vat
  const profit = sellSub - costSub
  const margin = sellSub > 0 ? profit / sellSub * 100 : null
  const kwp = num(state.project.sizeKwp)
  const kwh = num(state.project.sizeKwh)
  return {
    sections, costSub, sellSub, contingency, exVat, vat, incVat, profit, margin,
    perKwp: kwp ? exVat / kwp : null, perWp: kwp ? exVat / (kwp * 1000) : null, perKwh: kwh ? exVat / kwh : null,
    costPerWp: kwp ? costSub / (kwp * 1000) : null,
    unpriced: calcLines.filter(l => !l.priced).length,
    missingRates: [...missingRates],
  }
}

// ── Print document (A4 portrait). mode: 'boq' (quantities only, no prices) | 'quote' (selling prices) | 'internal' (cost, markup, profit) ──
export function buildPrintHtml(state, r, mode) {
  const p = state.project
  const s = state.settings
  const internal = mode === 'internal'
  const boq = mode === 'boq'
  const docName = internal ? 'COSTING SHEET' : boq ? 'BILL OF QUANTITIES' : 'QUOTATION'
  const fileTag = internal ? 'Internal Costing' : boq ? 'BOQ' : 'Quote'
  const e = v => escapeHtml(v ?? '')
  const hdr = [
    ['Project', p.name, 'Date', p.date],
    ['Client', p.client, 'Revision', p.revision],
    ['Project Number', p.number, 'Prepared by', p.preparedBy],
    ['Document Number', p.docNumber, 'Checked by', p.checkedBy],
    ['Site / Address', p.site, 'System size', [p.sizeKwp ? `${p.sizeKwp} kWp` : '', p.sizeKwh ? `${p.sizeKwh} kWh` : ''].filter(Boolean).join(' · ')],
  ]
  const cols = internal
    ? ['Item', 'Description', 'Unit', 'Qty', 'Unit Cost', 'Cost Total', 'Markup', 'Sell Rate', 'Sell Total']
    : boq ? ['Item', 'Description', 'Unit', 'Qty', 'Remarks']
      : ['Item', 'Description', 'Unit', 'Qty', 'Rate (excl. VAT)', 'Amount (excl. VAT)']
  const widths = internal ? [5, 33, 6, 6, 10, 10, 7, 11, 12] : boq ? [7, 57, 9, 9, 18] : [6, 50, 8, 8, 13, 15]
  let body = ''
  r.sections.forEach((sec, si) => {
    body += `<tr class="sec"><td>${si + 1}</td><td colspan="${cols.length - 1}">${e(sec.name.toUpperCase())}</td></tr>`
    sec.lines.forEach((l, li) => {
      const base = `<td>${si + 1}.${li + 1}</td><td class="l">${e(l.description)}</td><td>${e(l.unit)}</td><td>${l.qtyN}</td>`
      body += boq ? `<tr>${base}<td></td></tr>` : internal
        ? `<tr>${base}<td class="r">${money(l.unitCostZar)}</td><td class="r">${money(l.costTotal)}</td><td>${l.markup}%</td><td class="r">${money(l.sellRate)}</td><td class="r">${money(l.sellTotal)}</td></tr>`
        : `<tr>${base}<td class="r">${money(l.sellRate)}</td><td class="r">${money(l.sellTotal)}</td></tr>`
    })
    if (boq) return
    body += internal
      ? `<tr class="sub"><td></td><td class="l" colspan="4">Subtotal – ${e(sec.name)}</td><td class="r">${money(sec.cost)}</td><td></td><td></td><td class="r">${money(sec.sell)}</td></tr>`
      : `<tr class="sub"><td></td><td class="l" colspan="4">Subtotal – ${e(sec.name)}</td><td class="r">${money(sec.sell)}</td></tr>`
  })
  const tot = [
    ['Subtotal (excl. VAT)', r.sellSub],
    [`Contingency (${s.contingencyPct || 0}%)`, r.contingency],
    ['Total excl. VAT', r.exVat, 'b'],
    [`VAT (${s.vatPct || 0}%)`, r.vat],
    ['TOTAL incl. VAT', r.incVat, 'grand'],
  ]
  const rates = [
    r.perWp != null ? ['Rate per Wp (excl. VAT)', money(r.perWp)] : null,
    r.perKwp != null ? ['Rate per kWp (excl. VAT)', money(r.perKwp)] : null,
    r.perKwh != null ? ['Rate per kWh storage (excl. VAT)', money(r.perKwh)] : null,
  ].filter(Boolean)
  const internalSum = internal ? [
    ['Total cost', money(r.costSub)], ['Selling (before contingency)', money(r.sellSub)],
    ['Gross profit', money(r.profit)], ['Gross margin', pctTxt(r.margin)],
    r.costPerWp != null ? ['Cost per Wp', money(r.costPerWp)] : null,
  ].filter(Boolean) : []

  // Sosimple Brand Guide v2 – Blue #0B74D7, Green #97CA46, Yellow #FFE82C, Grey #505050; Axiforma / Avenir
  const css = `
@page { size: A4 portrait; margin: 12mm 10mm; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font-family: Axiforma, Avenir, 'Avenir Next', 'Segoe UI', Arial, sans-serif; color: #505050; font-size: 10px; }
table { border-collapse: collapse; width: 100%; table-layout: fixed; }
td, th { border: 1px solid #AFAFAF; padding: 4px 5px; vertical-align: middle; text-align: center; overflow-wrap: break-word; }
.l { text-align: left; } .r { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.hdr td { height: 22px; } .hdr .lab { background: #E1EFF6; font-weight: 700; text-align: left; white-space: nowrap; } .hdr .val { text-align: left; color: #0B74D7; }
.title { font-size: 19px; font-weight: 800; line-height: 1.25; color: #0B74D7; }
.title small { display: block; font-size: 13px; color: #505050; letter-spacing: 1px; margin-top: 3px; }
.banner { background: #0B74D7; color: #fff; font-weight: 800; font-size: 12.5px; letter-spacing: 0.6px; text-align: center; padding: 6px; margin: 6px 0 8px; border-bottom: 4px solid #FFE82C; }
thead th { background: #505050; color: #fff; font-weight: 700; }
thead { display: table-header-group; }
tr { break-inside: avoid; page-break-inside: avoid; }
tr.sec td { background: #D9EBC5; font-weight: 800; color: #505050; }
tr.sec td:first-child { border-left: 4px solid #97CA46; }
tr.sec td:nth-child(2) { text-align: left; }
tr.sub td { font-weight: 700; background: #F4F4F4; }
.tot td { font-size: 10.5px; } .tot .b td { font-weight: 800; } .tot .grand td { font-weight: 800; background: #0B74D7; color: #fff; font-size: 12px; }
.box { break-inside: avoid; page-break-inside: avoid; }
.notes { margin-top: 10px; font-size: 9px; color: #505050; line-height: 1.5; }
.int { color: #F66524; font-weight: 800; font-size: 10px; text-align: right; margin-bottom: 3px; }
.foot { margin-top: 14px; padding-top: 6px; border-top: 3px solid #97CA46; font-size: 8.5px; color: #505050; display: flex; justify-content: space-between; }
`
  return `<!doctype html><html><head><meta charset="utf-8"><title>${e(`${p.docNumber || p.number || p.name || 'Project'} - ${fileTag}`)}</title>
<base href="${window.location.origin}/"><style>${css}</style></head><body>
${internal ? '<div class="int">INTERNAL – CONTAINS COST AND MARGIN – DO NOT SEND TO CLIENT</div>' : ''}
<table class="hdr"><colgroup><col style="width:20%"><col style="width:30%"><col style="width:12%"><col style="width:16%"><col style="width:10%"><col style="width:12%"></colgroup><tbody>
${hdr.map((h, i) => `<tr>${i === 0 ? `<td rowspan="5"><img src="${LOGO_SRC}" style="max-width:100%;max-height:80px"></td><td rowspan="5" class="title">${e((p.name || 'Project Name').toUpperCase())}<small>${docName}</small></td>` : ''}<td class="lab">${h[0]}</td><td class="val">${e(h[1])}</td><td class="lab">${h[2]}</td><td class="val">${e(h[3])}</td></tr>`).join('')}
</tbody></table>
<div class="banner">${internal ? 'COSTING SHEET – COST, MARKUP AND SELLING PRICE' : boq ? 'BILL OF QUANTITIES' : 'QUOTATION – PRICES IN ZAR'}</div>
<table><colgroup>${widths.map(w => `<col style="width:${w}%">`).join('')}</colgroup>
<thead><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${body || `<tr><td colspan="${cols.length}">No items</td></tr>`}</tbody></table>
${boq ? '' : `<div class="box" style="display:flex;gap:14px;margin-top:10px;align-items:flex-start">
  <div style="flex:1">
    ${rates.length ? `<table><tbody>${rates.map(x => `<tr><td class="l" style="background:#E1EFF6;font-weight:700">${x[0]}</td><td class="r">${x[1]}</td></tr>`).join('')}</tbody></table>` : ''}
    ${internalSum.length ? `<table style="margin-top:8px"><tbody>${internalSum.map(x => `<tr><td class="l" style="background:#F6D7C1;font-weight:700">${x[0]}</td><td class="r">${x[1]}</td></tr>`).join('')}</tbody></table>` : ''}
  </div>
  <table class="tot" style="width:46%"><tbody>${tot.map(t => `<tr class="${t[2] || ''}"><td class="l">${t[0]}</td><td class="r">${money(t[1])}</td></tr>`).join('')}</tbody></table>
</div>`}
<div class="notes box"><b>Notes:</b><br>
${boq
    ? `• Quantities are based on the current design and may change after final site verification.<br>
• This Bill of Quantities does not include pricing; pricing is provided in the quotation.`
    : `• All prices in South African Rand (ZAR). Quotation valid for ${e(p.validity || '30 days')} from the date above.<br>
• Quantities are based on the current design and may change after final site verification.<br>
• Contingency covers unforeseen site conditions; unused contingency is not invoiced.`}
</div>
<div class="foot"><span><b>Sosimple Energy</b> · Cheap energy. Clean business.</span><span>${e(p.docNumber || p.number || '')} · Rev ${e(p.revision || '')}</span></div>
</body></html>`
}

// ── Excel (three sheets: BOQ – quantities only, Quote – selling prices, Internal Costing – live formulas) ──
export async function buildExcel(state, r) {
  const ExcelJS = (await import('exceljs/dist/exceljs.min.js')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Sosimple Energy Portal'
  const p = state.project
  const s = state.settings
  let logoId = null
  try {
    const res = await fetch(LOGO_SRC)
    if (res.ok) logoId = wb.addImage({ buffer: await res.arrayBuffer(), extension: 'png' })
  } catch (e) { /* no logo */ }

  // Sosimple Brand Guide v2 colours. NAVY = text/headers (Sosimple Grey), BLUE = Sosimple Blue, SEC = Light Green section rows
  const NAVY = 'FF505050', BLUE = 'FF0B74D7', LIGHT = 'FFE1EFF6', SUBF = 'FFF4F4F4', INK = 'FF0B74D7', SEC = 'FFD9EBC5', GREEN = 'FF97CA46', YELLOW = 'FFFFE82C'
  const thin = { style: 'thin', color: { argb: 'FFAFAFAF' } }
  const border = { top: thin, left: thin, bottom: thin, right: thin }
  const RFMT = '"R" #,##0.00'

  function sheet(mode) {
    const internal = mode === 'internal'
    const boq = mode === 'boq'
    const docName = internal ? 'COSTING SHEET' : boq ? 'BILL OF QUANTITIES' : 'QUOTATION'
    const ws = wb.addWorksheet(internal ? 'Internal Costing' : boq ? 'BOQ' : 'Quote', {
      pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
      headerFooter: { oddFooter: '&L&8Sosimple Energy&C&8Page &P of &N&R&8&D' },
      views: [{ showGridLines: false }],
    })
    const cols = internal
      ? [['Item', 7], ['Description', 48], ['Unit', 8], ['Qty', 8], ['Unit Cost', 14], ['Cost Total', 15], ['Markup %', 10], ['Sell Rate', 14], ['Sell Total', 16]]
      : boq ? [['Item', 7], ['Description', 64], ['Unit', 10], ['Qty', 10], ['Remarks', 13], ['', 13]] // Remarks spans E:F
        : [['Item', 7], ['Description', 58], ['Unit', 9], ['Qty', 9], ['Rate (excl. VAT)', 16], ['Amount (excl. VAT)', 18]]
    ws.columns = cols.map(c => ({ width: c[1] }))
    const last = cols.length
    const L = n => String.fromCharCode(64 + n)
    const lastL = L(last)
    const amtCol = internal ? 'I' : 'F'

    // Header block rows 1–5
    const hdr = [
      ['Project', p.name, 'Date', p.date], ['Client', p.client, 'Revision', p.revision],
      ['Project Number', p.number, 'Prepared by', p.preparedBy], ['Document Number', p.docNumber, 'Checked by', p.checkedBy],
      ['Site / Address', p.site, 'System size', [p.sizeKwp ? `${p.sizeKwp} kWp` : '', p.sizeKwh ? `${p.sizeKwh} kWh` : ''].filter(Boolean).join(' · ')],
    ]
    // layout: A–B logo+title, then label/value pairs over the remaining columns
    const lc = internal ? [3, 5, 6, 8] : [3, 4, 5, 6] // label1, value1 start, label2, value2 start
    const v1End = lc[2] - 1, v2End = last
    for (let i = 0; i < 5; i++) {
      const row = ws.getRow(i + 1); row.height = 20
      const [a, b, c, d] = hdr[i]
      ws.getCell(i + 1, lc[0]).value = a
      if (lc[1] > lc[0] + 1) ws.mergeCells(i + 1, lc[0], i + 1, lc[1] - 1)
      ws.getCell(i + 1, lc[1]).value = b || ''
      if (v1End > lc[1]) ws.mergeCells(i + 1, lc[1], i + 1, v1End)
      ws.getCell(i + 1, lc[2]).value = c
      if (lc[3] > lc[2] + 1) ws.mergeCells(i + 1, lc[2], i + 1, lc[3] - 1)
      ws.getCell(i + 1, lc[3]).value = d || ''
      if (v2End > lc[3]) ws.mergeCells(i + 1, lc[3], i + 1, v2End)
      for (let cI = lc[0]; cI <= last; cI++) {
        const cell = ws.getCell(i + 1, cI)
        cell.border = border
        cell.font = { size: 9, bold: cI === lc[0] || cI === lc[2], color: { argb: (cI >= lc[1] && cI <= v1End) || cI >= lc[3] ? INK : NAVY } }
        cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true }
        if ((cI >= lc[0] && cI < lc[1]) || (cI >= lc[2] && cI < lc[3])) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT } }
      }
    }
    // A1:B5 = logo (left) + title (right)
    ws.mergeCells(1, 1, 5, 2)
    const t = ws.getCell('A1')
    t.value = `${(p.name || 'Project Name').toUpperCase()}\n${docName}`
    t.font = { size: 15, bold: true, color: { argb: BLUE } }
    t.alignment = { horizontal: 'right', vertical: 'middle', wrapText: true, indent: 1 }
    t.border = border
    if (logoId != null) ws.addImage(logoId, { tl: { col: 0.15, row: 0.6 }, ext: { width: 150, height: 58 }, editAs: 'oneCell' })

    // Banner row 7
    ws.getRow(6).height = 6
    ws.mergeCells(7, 1, 7, last)
    const bn = ws.getCell('A7')
    bn.value = internal ? 'INTERNAL COSTING – COST, MARKUP AND SELLING PRICE – DO NOT SEND TO CLIENT' : boq ? 'BILL OF QUANTITIES' : 'QUOTATION – PRICES IN ZAR'
    bn.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } }
    bn.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } }
    bn.border = { bottom: { style: 'thick', color: { argb: YELLOW } } }
    bn.alignment = { horizontal: 'center', vertical: 'middle' }
    ws.getRow(7).height = 22

    // Settings (internal sheet only) – live inputs used by formulas
    let rowN = 9
    let markupRef = null
    if (internal) {
      ws.getCell(rowN, 1).value = 'Default markup %'
      ws.mergeCells(rowN, 1, rowN, 2)
      ws.getCell(rowN, 3).value = (num(s.markupPct) ?? 0) / 100
      ws.getCell(rowN, 3).numFmt = '0.0%'
      ws.getCell(rowN, 3).font = { color: { argb: INK }, bold: true }
      markupRef = `$C$${rowN}`
      ;[1, 2, 3].forEach(c => { ws.getCell(rowN, c).border = border })
      ws.getCell(rowN, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT } }
      ws.getCell(rowN, 1).font = { bold: true, size: 9 }
      rowN += 2
    }

    // Column headers
    const headRow = ws.getRow(rowN)
    cols.forEach((c, i) => {
      const cell = headRow.getCell(i + 1)
      cell.value = c[0]
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
      cell.border = border
    })
    headRow.height = 30
    ws.pageSetup.printTitlesRow = `${rowN}:${rowN}`
    if (boq) ws.mergeCells(rowN, 5, rowN, 6)
    rowN++

    // BOQ sheet: quantities only – no rates, subtotals or totals
    if (boq) {
      r.sections.forEach((sec, si) => {
        const sr = ws.getRow(rowN)
        sr.getCell(1).value = si + 1
        sr.getCell(2).value = sec.name.toUpperCase()
        for (let c = 1; c <= last; c++) {
          const cell = sr.getCell(c)
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SEC } }
          cell.font = { bold: true, color: { argb: NAVY } }
          cell.border = c === 1 ? { ...border, left: { style: 'thick', color: { argb: GREEN } } } : border
          cell.alignment = { horizontal: c === 2 ? 'left' : 'center', vertical: 'middle' }
        }
        ws.mergeCells(rowN, 5, rowN, 6)
        rowN++
        sec.lines.forEach((l, li) => {
          const row = ws.getRow(rowN)
          row.getCell(1).value = `${si + 1}.${li + 1}`
          row.getCell(2).value = l.description
          row.getCell(3).value = l.unit
          row.getCell(4).value = l.qtyN
          for (let c = 1; c <= last; c++) {
            const cell = row.getCell(c)
            cell.border = border
            cell.font = { size: 10, color: { argb: NAVY } }
            cell.alignment = { horizontal: c === 2 || c >= 5 ? 'left' : 'center', vertical: 'middle', wrapText: c === 2 || c >= 5 }
          }
          ws.mergeCells(rowN, 5, rowN, 6)
          rowN++
        })
      })
      rowN++
      ;[
        'Notes:',
        '• Quantities are based on the current design and may change after final site verification.',
        '• This Bill of Quantities does not include pricing; pricing is provided in the quotation.',
      ].forEach((n, i) => {
        ws.mergeCells(rowN, 1, rowN, last)
        const c = ws.getCell(rowN, 1)
        c.value = n
        c.font = { size: 9, bold: i === 0, color: { argb: NAVY } }
        rowN++
      })
      ws.pageSetup.printArea = `A1:${lastL}${rowN}`
      return ws
    }

    const subRefs = [] // [costRef, sellRef]
    r.sections.forEach((sec, si) => {
      const sr = ws.getRow(rowN)
      sr.getCell(1).value = si + 1
      sr.getCell(2).value = sec.name.toUpperCase()
      for (let c = 1; c <= last; c++) {
        const cell = sr.getCell(c)
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SEC } }
        cell.font = { bold: true, color: { argb: NAVY } }
        cell.border = c === 1 ? { ...border, left: { style: 'thick', color: { argb: GREEN } } } : border
        cell.alignment = { horizontal: c === 2 ? 'left' : 'center', vertical: 'middle' }
      }
      rowN++
      const first = rowN
      sec.lines.forEach((l, li) => {
        const row = ws.getRow(rowN)
        row.getCell(1).value = `${si + 1}.${li + 1}`
        row.getCell(2).value = l.description
        row.getCell(3).value = l.unit
        row.getCell(4).value = l.qtyN
        if (internal) {
          row.getCell(5).value = l.unitCostZar ?? null
          row.getCell(6).value = { formula: `D${rowN}*E${rowN}`, result: l.costTotal }
          row.getCell(7).value = num(l.markupPct) != null ? num(l.markupPct) / 100 : { formula: markupRef, result: l.markup / 100 }
          row.getCell(8).value = { formula: `E${rowN}*(1+G${rowN})`, result: l.sellRate ?? 0 }
          row.getCell(9).value = { formula: `D${rowN}*H${rowN}`, result: l.sellTotal }
        } else {
          row.getCell(5).value = l.sellRate ?? null
          row.getCell(6).value = { formula: `D${rowN}*E${rowN}`, result: l.sellTotal }
        }
        for (let c = 1; c <= last; c++) {
          const cell = row.getCell(c)
          cell.border = border
          cell.font = { size: 10, color: { argb: NAVY } }
          cell.alignment = { horizontal: c === 2 ? 'left' : c >= 5 ? 'right' : 'center', vertical: 'middle', wrapText: c === 2 }
        }
        if (internal) { [5, 6, 8, 9].forEach(c => { row.getCell(c).numFmt = RFMT }); row.getCell(7).numFmt = '0.0%' }
        else { [5, 6].forEach(c => { row.getCell(c).numFmt = RFMT }) }
        rowN++
      })
      const lastLine = rowN - 1
      const sub = ws.getRow(rowN)
      sub.getCell(2).value = `Subtotal – ${sec.name}`
      if (internal) {
        sub.getCell(6).value = { formula: `SUM(F${first}:F${lastLine})`, result: sec.cost }
        sub.getCell(9).value = { formula: `SUM(I${first}:I${lastLine})`, result: sec.sell }
        subRefs.push([`F${rowN}`, `I${rowN}`])
      } else {
        sub.getCell(6).value = { formula: `SUM(F${first}:F${lastLine})`, result: sec.sell }
        subRefs.push([null, `F${rowN}`])
      }
      for (let c = 1; c <= last; c++) {
        const cell = sub.getCell(c)
        cell.border = border
        cell.font = { bold: true, color: { argb: NAVY } }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SUBF } }
        cell.alignment = { horizontal: c === 2 ? 'left' : 'right', vertical: 'middle' }
        if (c >= 5) cell.numFmt = RFMT
      }
      rowN++
    })

    // Totals
    rowN++
    const labelCol = last - 1
    const sumOf = refs => (refs.length ? refs.join('+') : '0')
    const addTot = (label, formula, result, style = {}) => {
      const row = ws.getRow(rowN)
      ws.mergeCells(rowN, 2, rowN, labelCol)
      const v = row.getCell(last)
      v.value = { formula, result }
      v.numFmt = style.numFmt || RFMT
      ;[ws.getCell(rowN, 2), v].forEach(c => {
        c.border = border
        c.font = { bold: !!style.bold, color: { argb: style.fg || NAVY }, size: style.size || 10 }
        if (style.fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: style.fill } }
      })
      ws.getCell(rowN, 2).value = label
      ws.getCell(rowN, 2).alignment = { horizontal: 'right' }
      const ref = `${amtCol}${rowN}`
      rowN++
      return ref
    }
    const subRef = addTot('Subtotal (excl. VAT)', sumOf(subRefs.map(x => x[1])), r.sellSub, { bold: true })
    const contPct = (num(s.contingencyPct) ?? 0) / 100
    const vatPct = (num(s.vatPct) ?? 0) / 100
    const contRef = addTot(`Contingency (${s.contingencyPct || 0}%)`, `${subRef}*${contPct}`, r.contingency)
    const exRef = addTot('Total excl. VAT', `${subRef}+${contRef}`, r.exVat, { bold: true })
    const vatRef = addTot(`VAT (${s.vatPct || 0}%)`, `${exRef}*${vatPct}`, r.vat)
    addTot('TOTAL incl. VAT', `${exRef}+${vatRef}`, r.incVat, { bold: true, fill: BLUE, fg: 'FFFFFFFF', size: 12 })
    const kwp = num(p.sizeKwp), kwh = num(p.sizeKwh)
    rowN++
    if (kwp) {
      addTot('Rate per Wp (excl. VAT)', `${exRef}/${kwp * 1000}`, r.perWp)
      addTot('Rate per kWp (excl. VAT)', `${exRef}/${kwp}`, r.perKwp)
    }
    if (kwh) addTot('Rate per kWh storage (excl. VAT)', `${exRef}/${kwh}`, r.perKwh)
    if (internal) {
      rowN++
      const costRef = addTot('Total cost', sumOf(subRefs.map(x => x[0])), r.costSub, { fill: 'FFF6D7C1' })
      const profRef = addTot('Gross profit', `${subRef}-${costRef}`, r.profit, { fill: 'FFF6D7C1', bold: true })
      addTot('Gross margin', `IF(${subRef}=0,0,${profRef}/${subRef})`, (r.margin ?? 0) / 100, { fill: 'FFF6D7C1', bold: true, numFmt: '0.0%' })
      if (kwp) addTot('Cost per Wp', `${costRef}/${kwp * 1000}`, r.costPerWp, { fill: 'FFF6D7C1' })
    }

    // Notes
    rowN++
    ;[
      'Notes:',
      `• All prices in South African Rand (ZAR). Quotation valid for ${p.validity || '30 days'} from the date above.`,
      '• Quantities are based on the current design and may change after final site verification.',
      '• Contingency covers unforeseen site conditions; unused contingency is not invoiced.',
    ].forEach((n, i) => {
      ws.mergeCells(rowN, 1, rowN, last)
      const c = ws.getCell(rowN, 1)
      c.value = n
      c.font = { size: 9, bold: i === 0, color: { argb: NAVY } }
      rowN++
    })
    ws.pageSetup.printArea = `A1:${lastL}${rowN}`
    return ws
  }

  sheet('boq')
  sheet('quote')
  sheet('internal')
  return wb.xlsx.writeBuffer()
}

// ─────────────────────────────────────────────────────────────────────────────
// initialState / onStateChange: used by Projects to load and save a project's BOQ instead of this browser's draft
export default function BoqTool({ T, cardStyle, selectStyle, equipment = [], equipmentLoading = false, onLoadEquipment, initialState, onStateChange }) {
  const [state, setState] = useState(DEFAULT_STATE)
  const [loaded, setLoaded] = useState(false)
  const [picker, setPicker] = useState(null) // { search, category, qty: {id: n} }
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [showCost, setShowCost] = useState(true)
  const [addSectionName, setAddSectionName] = useState('')
  const iframeRef = useRef(null)

  useEffect(() => { if (onLoadEquipment) onLoadEquipment() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    try {
      const raw = initialState ? null : localStorage.getItem(STORAGE_KEY)
      if (initialState || raw) {
        const saved = initialState || JSON.parse(raw)
        if (saved && saved.project && Array.isArray(saved.lines)) {
          setState({
            project: { ...blankProject(), ...saved.project },
            settings: { ...blankSettings(), ...saved.settings, rates: { ...blankSettings().rates, ...(saved.settings?.rates || {}) } },
            lines: saved.lines.map(l => ({ ...blankLine(l.section), ...l })),
            extraSections: saved.extraSections || [],
          })
        }
      }
    } catch (e) { /* ignore */ }
    setLoaded(true)
  }, [])
  useEffect(() => {
    if (!loaded) return
    if (onStateChange) { onStateChange(state); return }
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)) } catch (e) { /* ignore */ }
  }, [state, loaded]) // eslint-disable-line react-hooks/exhaustive-deps

  const r = useMemo(() => calcBoq(state), [state])
  const allSections = [...BOQ_SECTIONS, ...(state.extraSections || [])]

  const setProject = (k, v) => setState(s => ({ ...s, project: { ...s.project, [k]: v } }))
  const setSetting = (k, v) => setState(s => ({ ...s, settings: { ...s.settings, [k]: v } }))
  const setRate = (c, v) => setState(s => ({ ...s, settings: { ...s.settings, rates: { ...s.settings.rates, [c]: v } } }))
  const updateLine = (id, k, v) => setState(s => ({ ...s, lines: s.lines.map(l => (l.id === id ? { ...l, [k]: v } : l)) }))
  const delLine = id => setState(s => ({ ...s, lines: s.lines.filter(l => l.id !== id) }))
  const dupLine = id => setState(s => {
    const i = s.lines.findIndex(l => l.id === id)
    return { ...s, lines: [...s.lines.slice(0, i + 1), { ...s.lines[i], id: newId() }, ...s.lines.slice(i + 1)] }
  })
  const moveLine = (id, dir) => setState(s => {
    const lines = [...s.lines]
    const i = lines.findIndex(l => l.id === id)
    const sec = lines[i].section
    let j = i + dir
    while (j >= 0 && j < lines.length && lines[j].section !== sec) j += dir
    if (j < 0 || j >= lines.length) return s
    ;[lines[i], lines[j]] = [lines[j], lines[i]]
    return { ...s, lines }
  })
  const addManual = section => setState(s => ({ ...s, lines: [...s.lines, blankLine(section)] }))
  const addSection = () => {
    const n = addSectionName.trim()
    if (!n) return
    if (allSections.some(x => x.toLowerCase() === n.toLowerCase())) { setAddSectionName(''); return }
    setState(s => ({ ...s, extraSections: [...(s.extraSections || []), n], lines: [...s.lines, blankLine(n)] }))
    setAddSectionName('')
  }
  const resetAll = () => {
    if (typeof window !== 'undefined' && !window.confirm('Clear the whole BOQ (project details, settings and all lines)?')) return
    setState(DEFAULT_STATE())
  }

  function addFromInventory() {
    const picks = Object.entries(picker.qty).filter(([, q]) => Number(q) > 0)
    if (!picks.length) { setPicker(null); return }
    const newLines = picks.map(([id, q]) => {
      const item = equipment.find(x => String(x.id) === String(id))
      const section = BOQ_SECTIONS.includes(item.category) ? item.category : 'Other Accessories'
      return blankLine(section, {
        source: 'inv', invId: item.id, description: item.name, unit: 'No.', qty: Number(q),
        unitCost: item.cost ?? '', currency: item.currency || 'ZAR',
      })
    })
    setState(s => ({ ...s, lines: [...s.lines, ...newLines] }))
    setPicker(null)
  }

  const fileRef = () => (state.project.docNumber || state.project.number || state.project.name || 'Project').replace(/[^\w\- .]+/g, '').trim() || 'Project'

  async function downloadExcel() {
    setBusy('excel'); setError('')
    try {
      const data = await buildExcel(state, r)
      const blob = new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${fileRef()} - BOQ - ${state.project.date || new Date().toISOString().slice(0, 10)}.xlsx`
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) {
      setError(`Could not create the Excel file: ${e.message || e}`)
    } finally { setBusy('') }
  }

  async function print(mode) {
    setBusy(mode); setError('')
    try {
      const iframe = document.createElement('iframe')
      iframe.setAttribute('aria-hidden', 'true')
      Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' })
      document.body.appendChild(iframe)
      iframeRef.current = iframe
      const doc = iframe.contentDocument
      doc.open(); doc.write(buildPrintHtml(state, r, mode)); doc.close()
      await Promise.all(Array.from(doc.images).map(img => (img.complete ? null : new Promise(res => { img.onload = res; img.onerror = res }))))
      const prev = document.title
      document.title = `${fileRef()} - ${mode === 'internal' ? 'Internal Costing' : mode === 'boq' ? 'BOQ' : 'Quote'}`
      iframe.contentWindow.focus()
      iframe.contentWindow.print()
      setTimeout(() => { document.title = prev; iframe.remove() }, 1500)
    } catch (e) {
      setError(`Could not print: ${e.message || e}`)
    } finally { setBusy('') }
  }

  // ── styles ──
  const btn = (bg, fg = '#fff', border = 'none') => ({ padding: '8px 14px', background: bg, color: fg, border, borderRadius: '7px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px' })
  const ghost = btn('transparent', T.textSecondary, `1px solid ${T.border}`)
  const labelStyle = { fontSize: '10px', fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '4px' }
  const inp = { ...selectStyle, cursor: 'text', width: '100%', boxSizing: 'border-box' }
  const cellInp = { ...selectStyle, cursor: 'text', padding: '5px 7px', fontSize: '12px', width: '100%', boxSizing: 'border-box' }
  const iconBtn = color => ({ background: 'transparent', border: `1px solid ${T.border}`, color, borderRadius: '5px', padding: '3px 6px', cursor: 'pointer', fontSize: '12px', display: 'inline-flex', alignItems: 'center' })
  const th = { padding: '8px 8px', fontSize: '10px', fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'left', borderBottom: `1px solid ${T.border}`, whiteSpace: 'nowrap' }
  const td = { padding: '5px 6px', fontSize: '12px', color: T.textPrimary, borderBottom: `1px solid ${T.border}`, verticalAlign: 'middle' }
  const numCell = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }

  const field = (label, k, type = 'text', placeholder = '') => (
    <label key={k} style={{ display: 'block' }}>
      <div style={labelStyle}>{label}</div>
      <input type={type} value={state.project[k] ?? ''} placeholder={placeholder} onChange={e => setProject(k, e.target.value)} style={inp} />
    </label>
  )

  const usedCurrencies = [...new Set(state.lines.map(l => l.currency).filter(c => c && c !== 'ZAR'))]

  return (
    <div>
      {/* Project details */}
      <div style={{ ...cardStyle, padding: '16px 18px', marginBottom: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <i className="ti ti-clipboard-text" style={{ color: T.blue }} />
          <span style={{ fontSize: '13px', fontWeight: 700, color: T.textPrimary }}>Project details</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px' }}>
          {field('Project Name', 'name')}
          {field('Client', 'client')}
          {field('Project Number', 'number')}
          {field('Document Number', 'docNumber')}
          {field('Site / Address', 'site')}
          {field('Date', 'date', 'date')}
          {field('Revision', 'revision')}
          {field('Prepared by', 'preparedBy')}
          {field('Checked by', 'checkedBy')}
          {field('PV size (kWp)', 'sizeKwp', 'number')}
          {field('Storage (kWh)', 'sizeKwh', 'number')}
          {field('Quote validity', 'validity')}
        </div>
      </div>

      {/* Costing settings */}
      <div style={{ ...cardStyle, padding: '14px 18px', marginBottom: '14px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px', alignItems: 'flex-end' }}>
          {[['Default markup %', 'markupPct'], ['Contingency %', 'contingencyPct'], ['VAT %', 'vatPct']].map(([l, k]) => (
            <label key={k} style={{ width: '140px' }}>
              <div style={labelStyle}>{l}</div>
              <input type="number" step="any" value={state.settings[k]} onChange={e => setSetting(k, e.target.value)} style={inp} />
            </label>
          ))}
          {usedCurrencies.map(c => (
            <label key={c} style={{ width: '150px' }}>
              <div style={{ ...labelStyle, color: num(state.settings.rates[c]) == null ? T.red : T.textMuted }}>{c} → ZAR rate</div>
              <input type="number" step="any" value={state.settings.rates[c] ?? ''} placeholder="Required" onChange={e => setRate(c, e.target.value)} style={inp} />
            </label>
          ))}
          <div style={{ flex: 1 }} />
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: T.textSecondary, cursor: 'pointer' }}>
            <input type="checkbox" checked={showCost} onChange={e => setShowCost(e.target.checked)} /> Show cost & markup columns
          </label>
        </div>
        <div style={{ fontSize: '11px', color: T.textMuted, marginTop: '8px' }}>
          Selling rate = unit cost × (1 + markup). Leave a line’s markup blank to use the default. Contingency is added on the selling subtotal; VAT on the total incl. contingency.
        </div>
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        <button onClick={() => setPicker({ search: '', category: 'All', qty: {} })} style={btn(T.blue)}><i className="ti ti-package" />Add from inventory</button>
        <select value="" onChange={e => { if (e.target.value) addManual(e.target.value) }} style={{ ...selectStyle, fontWeight: 700 }}>
          <option value="">+ Add manual line to…</option>
          {allSections.map(sx => <option key={sx} value={sx}>{sx}</option>)}
        </select>
        <div style={{ display: 'inline-flex', gap: '6px' }}>
          <input value={addSectionName} onChange={e => setAddSectionName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addSection() }} placeholder="New section name" style={{ ...selectStyle, cursor: 'text', width: '160px' }} />
          <button onClick={addSection} style={ghost}><i className="ti ti-folder-plus" />Add section</button>
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={resetAll} style={ghost}><i className="ti ti-refresh" />Reset</button>
        <button onClick={() => print('boq')} disabled={!!busy || !state.lines.length} style={ghost} title="Bill of Quantities – items and quantities only, no prices (A4)"><i className="ti ti-list-numbers" />{busy === 'boq' ? 'Preparing…' : 'Print BOQ'}</button>
        <button onClick={() => print('quote')} disabled={!!busy || !state.lines.length} style={btn('#0B74D7')} title="Client quotation – selling prices and totals (A4)"><i className="ti ti-printer" />{busy === 'quote' ? 'Preparing…' : 'Print quote'}</button>
        <button onClick={() => print('internal')} disabled={!!busy || !state.lines.length} style={ghost} title="Internal costing – cost, markup and profit (A4)"><i className="ti ti-lock" />{busy === 'internal' ? 'Preparing…' : 'Print costing'}</button>
        <button onClick={downloadExcel} disabled={!!busy || !state.lines.length} style={btn(T.green)}><i className="ti ti-file-spreadsheet" />{busy === 'excel' ? 'Exporting…' : 'Download Excel'}</button>
      </div>

      {error && <div style={{ ...cardStyle, padding: '10px 14px', marginBottom: '12px', borderLeft: `3px solid ${T.red}`, color: T.red, fontSize: '12px', fontWeight: 600 }}>{error}</div>}
      {(r.unpriced > 0 || r.missingRates.length > 0) && (
        <div style={{ ...cardStyle, padding: '10px 14px', marginBottom: '12px', borderLeft: `3px solid ${T.orange}`, color: T.textSecondary, fontSize: '12px' }}>
          <i className="ti ti-alert-triangle" style={{ color: T.orange, marginRight: '6px' }} />
          {r.unpriced > 0 && <>{r.unpriced} line{r.unpriced > 1 ? 's have' : ' has'} no unit cost and {r.unpriced > 1 ? 'are' : 'is'} counted as R 0. </>}
          {r.missingRates.length > 0 && <>Enter the exchange rate for {r.missingRates.join(', ')} above.</>}
        </div>
      )}

      <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Sections */}
        <div style={{ flex: '1 1 720px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {r.sections.length === 0 && (
            <div style={{ ...cardStyle, padding: '40px 20px', textAlign: 'center', color: T.textMuted, fontSize: '13px' }}>
              <i className="ti ti-list-details" style={{ fontSize: '30px', display: 'block', marginBottom: '8px', color: T.blue }} />
              No items yet. Use <b>Add from inventory</b> or <b>Add manual line</b> to start the BOQ.
            </div>
          )}
          {r.sections.map((sec, si) => (
            <div key={sec.name} style={{ ...cardStyle, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', background: T.bgMuted, borderBottom: `1px solid ${T.border}` }}>
                <span style={{ fontSize: '12px', fontWeight: 800, color: T.blue }}>{si + 1}.</span>
                <span style={{ fontSize: '13px', fontWeight: 800, color: T.textPrimary }}>{sec.name}</span>
                <div style={{ flex: 1 }} />
                {showCost && <span style={{ fontSize: '11px', color: T.textMuted }}>Cost {money(sec.cost)}</span>}
                <span style={{ fontSize: '12px', fontWeight: 800, color: T.textPrimary }}>{money(sec.sell)}</span>
                <button onClick={() => addManual(sec.name)} style={iconBtn(T.blue)} title="Add manual line to this section"><i className="ti ti-plus" /></button>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: showCost ? '1120px' : '820px' }}>
                  <thead>
                    <tr>
                      <th style={{ ...th, width: '44px' }}>Item</th>
                      <th style={th}>Description</th>
                      <th style={{ ...th, width: '86px' }}>Unit</th>
                      <th style={{ ...th, width: '70px' }}>Qty</th>
                      {showCost && <th style={{ ...th, width: '150px' }}>Unit cost</th>}
                      {showCost && <th style={{ ...th, width: '110px', textAlign: 'right' }}>Cost total</th>}
                      {showCost && <th style={{ ...th, width: '76px' }}>Markup %</th>}
                      <th style={{ ...th, width: '110px', textAlign: 'right' }}>Sell rate</th>
                      <th style={{ ...th, width: '120px', textAlign: 'right' }}>Sell total</th>
                      <th style={{ ...th, width: '108px' }} />
                    </tr>
                  </thead>
                  <tbody>
                    {sec.lines.map((l, li) => (
                      <tr key={l.id}>
                        <td style={{ ...td, color: T.textMuted, fontWeight: 700 }}>{si + 1}.{li + 1}</td>
                        <td style={td}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            {l.source === 'inv' && <i className="ti ti-package" title="From Equipment Inventory" style={{ color: T.orange, fontSize: '13px' }} />}
                            <input value={l.description} placeholder="Description" title={l.description} onChange={e => updateLine(l.id, 'description', e.target.value)} style={{ ...cellInp, minWidth: '240px' }} />
                          </div>
                        </td>
                        <td style={td}>
                          <select value={l.unit} onChange={e => updateLine(l.id, 'unit', e.target.value)} style={{ ...cellInp, cursor: 'pointer', padding: '5px 4px' }}>
                            {(UNITS.includes(l.unit) ? UNITS : [l.unit, ...UNITS]).map(u => <option key={u} value={u}>{u}</option>)}
                          </select>
                        </td>
                        <td style={td}><input type="number" step="any" value={l.qty} onChange={e => updateLine(l.id, 'qty', e.target.value === '' ? '' : Number(e.target.value))} style={{ ...cellInp, textAlign: 'right' }} /></td>
                        {showCost && (
                          <td style={td}>
                            <div style={{ display: 'flex', gap: '4px' }}>
                              <select value={l.currency} onChange={e => updateLine(l.id, 'currency', e.target.value)} style={{ ...cellInp, width: '58px', padding: '5px 2px', cursor: 'pointer' }}>
                                {Object.keys(CURRENCY_SYMBOLS).map(c => <option key={c} value={c}>{c}</option>)}
                              </select>
                              <input type="number" step="any" value={l.unitCost} placeholder="0.00" onChange={e => updateLine(l.id, 'unitCost', e.target.value === '' ? '' : Number(e.target.value))} style={{ ...cellInp, textAlign: 'right' }} />
                            </div>
                          </td>
                        )}
                        {showCost && <td style={numCell}>{l.priced ? money(l.costTotal) : '—'}</td>}
                        {showCost && <td style={td}><input type="number" step="any" value={l.markupPct} placeholder={String(state.settings.markupPct ?? '')} onChange={e => updateLine(l.id, 'markupPct', e.target.value === '' ? '' : Number(e.target.value))} style={{ ...cellInp, textAlign: 'right' }} /></td>}
                        <td style={numCell}>{money(l.sellRate)}</td>
                        <td style={{ ...numCell, fontWeight: 700 }}>{l.priced ? money(l.sellTotal) : '—'}</td>
                        <td style={td}>
                          <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                            <button title="Move up" onClick={() => moveLine(l.id, -1)} style={iconBtn(T.textSecondary)}><i className="ti ti-chevron-up" /></button>
                            <button title="Move down" onClick={() => moveLine(l.id, 1)} style={iconBtn(T.textSecondary)}><i className="ti ti-chevron-down" /></button>
                            <button title="Duplicate" onClick={() => dupLine(l.id)} style={iconBtn(T.textSecondary)}><i className="ti ti-copy" /></button>
                            <button title="Remove" onClick={() => delLine(l.id)} style={iconBtn(T.red)}><i className="ti ti-trash" /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>

        {/* Summary */}
        <div style={{ ...cardStyle, flex: '0 1 320px', minWidth: '280px', padding: '16px 18px', position: 'sticky', top: '80px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <i className="ti ti-receipt" style={{ color: T.blue }} />
            <span style={{ fontSize: '13px', fontWeight: 700, color: T.textPrimary }}>Summary</span>
          </div>
          {[
            ['Subtotal (excl. VAT)', money(r.sellSub)],
            [`Contingency (${state.settings.contingencyPct || 0}%)`, money(r.contingency)],
            ['Total excl. VAT', money(r.exVat), true],
            [`VAT (${state.settings.vatPct || 0}%)`, money(r.vat)],
          ].map(([l, v, b]) => (
            <div key={l} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '4px 0', color: b ? T.textPrimary : T.textSecondary, fontWeight: b ? 800 : 500 }}>
              <span>{l}</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{v}</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '15px', fontWeight: 800, color: '#fff', background: T.blue, borderRadius: '6px', padding: '9px 10px', margin: '8px 0 12px' }}>
            <span>Total incl. VAT</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{money(r.incVat)}</span>
          </div>
          {[
            ['R / Wp (excl. VAT)', r.perWp != null ? money(r.perWp) : 'Enter kWp'],
            ['R / kWp (excl. VAT)', r.perKwp != null ? money(r.perKwp) : 'Enter kWp'],
            ['R / kWh storage', r.perKwh != null ? money(r.perKwh) : 'Enter kWh'],
          ].map(([l, v]) => (
            <div key={l} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '3px 0', color: T.textSecondary }}>
              <span>{l}</span><span style={{ fontWeight: 700, color: T.textPrimary, fontVariantNumeric: 'tabular-nums' }}>{v}</span>
            </div>
          ))}
          {showCost && (
            <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: `1px dashed ${T.border}` }}>
              <div style={{ ...labelStyle, marginBottom: '6px' }}>Internal</div>
              {[
                ['Total cost', money(r.costSub)],
                ['Gross profit', money(r.profit)],
                ['Gross margin', pctTxt(r.margin)],
                ['Cost per Wp', r.costPerWp != null ? money(r.costPerWp) : '—'],
              ].map(([l, v]) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '3px 0', color: T.textSecondary }}>
                  <span>{l}</span><span style={{ fontWeight: 700, color: T.textPrimary, fontVariantNumeric: 'tabular-nums' }}>{v}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ fontSize: '11px', color: T.textMuted, marginTop: '10px', lineHeight: 1.6 }}>
        {onStateChange ? 'This BOQ is saved to the project automatically.' : 'Your BOQ draft is kept in this browser until you reset it.'} Download Excel gives three sheets: “BOQ” (items and quantities only, no prices), “Quote” (selling prices and totals) and “Internal Costing” (cost, markup, profit – live formulas). Print BOQ has no prices; Print quote is for the client; Print costing is internal.
      </div>

      {/* Inventory picker */}
      {picker && (() => {
        const q = picker.search.trim().toLowerCase()
        const cats = ['All', ...[...new Set(equipment.map(x => x.category).filter(Boolean))]]
        const list = equipment.filter(x => (picker.category === 'All' || x.category === picker.category)
          && (!q || `${x.name} ${x.description || ''} ${x.technical_spec || ''}`.toLowerCase().includes(q)))
        const selected = Object.values(picker.qty).filter(v => Number(v) > 0).length
        const setQty = (id, v) => setPicker(p => ({ ...p, qty: { ...p.qty, [id]: v } }))
        return (
          <div onClick={() => setPicker(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(10,20,40,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
            <div onClick={e => e.stopPropagation()} style={{ ...cardStyle, background: T.bgPanel, width: 'min(920px, 100%)', maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 16px', borderBottom: `1px solid ${T.border}` }}>
                <i className="ti ti-package" style={{ color: T.orange }} />
                <span style={{ fontSize: '14px', fontWeight: 800, color: T.textPrimary }}>Add from Equipment Inventory</span>
                <div style={{ flex: 1 }} />
                <button onClick={() => setPicker(null)} style={iconBtn(T.textSecondary)}><i className="ti ti-x" /></button>
              </div>
              <div style={{ display: 'flex', gap: '8px', padding: '12px 16px', flexWrap: 'wrap' }}>
                <input autoFocus value={picker.search} onChange={e => setPicker(p => ({ ...p, search: e.target.value }))} placeholder="Search name, description or spec…" style={{ ...inp, flex: '1 1 260px', width: 'auto' }} />
                <select value={picker.category} onChange={e => setPicker(p => ({ ...p, category: e.target.value }))} style={selectStyle}>
                  {cats.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div style={{ overflowY: 'auto', flex: 1, padding: '0 16px' }}>
                {equipmentLoading ? (
                  <div style={{ padding: '30px', textAlign: 'center', color: T.textMuted, fontSize: '12px' }}>Loading inventory…</div>
                ) : list.length === 0 ? (
                  <div style={{ padding: '30px', textAlign: 'center', color: T.textMuted, fontSize: '12px' }}>No matching equipment. Add items in Equipment Inventory, or use a manual line.</div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr>
                      <th style={th}>Category</th><th style={th}>Equipment</th><th style={{ ...th, textAlign: 'right' }}>Cost</th><th style={{ ...th, width: '90px' }}>Qty</th>
                    </tr></thead>
                    <tbody>
                      {list.map(x => (
                        <tr key={x.id} style={{ background: Number(picker.qty[x.id]) > 0 ? `${T.blue}12` : 'transparent' }}>
                          <td style={{ ...td, color: T.textMuted, whiteSpace: 'nowrap' }}>{x.category}</td>
                          <td style={td}>
                            <div style={{ fontWeight: 700 }}>{x.name}</div>
                            {x.description && <div style={{ fontSize: '11px', color: T.textMuted }}>{x.description}</div>}
                          </td>
                          <td style={numCell}>{x.cost != null ? `${CURRENCY_SYMBOLS[x.currency] || ''}${Number(x.cost).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}</td>
                          <td style={td}>
                            <input type="number" min="0" step="any" value={picker.qty[x.id] ?? ''} placeholder="0" onChange={e => setQty(x.id, e.target.value)} style={{ ...cellInp, textAlign: 'right' }} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px', borderTop: `1px solid ${T.border}` }}>
                <span style={{ fontSize: '12px', color: T.textMuted }}>{selected} item{selected === 1 ? '' : 's'} selected · items go into the section matching their category</span>
                <div style={{ flex: 1 }} />
                <button onClick={() => setPicker(null)} style={ghost}>Cancel</button>
                <button onClick={addFromInventory} disabled={!selected} style={{ ...btn(T.blue), opacity: selected ? 1 : 0.5 }}><i className="ti ti-plus" />Add to BOQ</button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
