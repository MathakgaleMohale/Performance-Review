'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Project archive (Projects → Download archive)
//   • ZIP: 00 Project summary.pdf + 00 Checklist.xlsx, and one folder per stage with
//     notes (Word), BOQs & cable schedules (Excel), design packs, checklists/reports (Word),
//     library documents and uploaded files in their original formats.
//   • Merged PDF: cover, contents, stage summary, then per stage: checklist, notes,
//     reports, BOQ quotes, cable schedules, design packs, PDFs and photos.
// Uses JSZip and pdf-lib from cdnjs (loaded only when an archive is built), plus the
// existing exporters (BOQ Excel, cable schedule Excel, Word export).
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '@/lib/supabase'
import { STAGES } from './projectConfig'

const CDN_JSZIP = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
const CDN_PDFLIB = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js'
const LOGO_SRC = '/sosimple-logo.png.png'
const BLUE = [11 / 255, 116 / 255, 215 / 255]

function loadScript(src, globalName) {
  if (typeof window !== 'undefined' && window[globalName]) return Promise.resolve(window[globalName])
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = src
    s.onload = () => (window[globalName] ? resolve(window[globalName]) : reject(new Error(`${globalName} did not load`)))
    s.onerror = () => reject(new Error(`Could not load ${src} — check the internet connection`))
    document.head.appendChild(s)
  })
}

const pad2 = n => String(n).padStart(2, '0')
const safe = s => (s || 'Untitled').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 100) || 'Untitled'
const fmtD = d => (d ? new Date(d.length === 10 ? d + 'T00:00:00' : d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }) : '')
const ext = n => ((n || '').match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase()
const stageFolder = s => `${pad2(STAGES.indexOf(s) + 1)} ${s}`
const stageLabel = s => `${pad2(STAGES.indexOf(s) + 1)} ${s}`
export const DEFAULT_TITLE = 'Project archive'

// ── Sectioned stage layouts (agreed stage by stage with Mathakgale) ──
// A stage listed here is written as numbered sections, in this order:
//   report → photos → notes → other documents → stage checklist
// Stages not listed keep the original layout (checklist, notes, then attachments).
export const STAGE_SECTIONS = {
  'Site Visit': { report: 'Site inspection report', reports: 'Site inspection reports', photos: 'Inspection photos', notes: 'Site visit notes', other: 'Other documents', checklist: 'Stage checklist' },
}
const SYSTEM_CAPTIONS = ['Design pack', 'Project archive']
const isPhoto = f => ['jpg', 'jpeg', 'png'].includes(ext(f.file_name))
export const photoCaption = f => (f.caption && !SYSTEM_CAPTIONS.includes(f.caption) ? f.caption : (f.file_name || 'Photo').replace(/\.[^.]+$/, ''))
const hasText = html => !!(html || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()

// Sections for a sectioned stage: [{ key, label, count }] numbered "1. …"
function stageSections(s, data) {
  const cfg = STAGE_SECTIONS[s]
  if (!cfg) return null
  const reps = data.reportLinks.filter(x => x.stage === s)
  const files = data.files.filter(x => x.stage === s)
  const photos = files.filter(isPhoto)
  const other = data.items.filter(x => x.stage === s).length + files.length - photos.length + data.docLinks.filter(x => x.stage === s).length
  const list = [
    reps.length && { key: 'report', label: reps.length > 1 ? cfg.reports : cfg.report, count: reps.length },
    photos.length && { key: 'photos', label: `${cfg.photos} (${photos.length})`, count: photos.length },
    hasText(data.stages[s]?.notes_html) && { key: 'notes', label: cfg.notes },
    other && { key: 'other', label: `${cfg.other} (${other})`, count: other },
    data.tasks.some(t => t.stage === s) && { key: 'checklist', label: cfg.checklist },
  ].filter(Boolean)
  return list.map((x, i) => ({ ...x, n: i + 1, title: `${i + 1}. ${x.label.replace(/ \(\d+\)$/, '')}`, label: `${i + 1}. ${x.label}` }))
}

// Fill blank "Label:" paragraphs and blank 2-column table rows of a report from the project
// (archive copy only; anything already typed is kept)
const normLabel = t => (t || '').toLowerCase().replace(/^\s*\d+\s*[.)]\s*/, '').replace(/[:*]/g, '').replace(/\s+/g, ' ').trim()
export function prefillReport(html, p, rec = {}) {
  if (!html || typeof DOMParser === 'undefined') return html
  const size = [p.capacity_kwp ? `${Number(p.capacity_kwp).toLocaleString('en-US')} kWp` : '', p.battery_kwh ? `${Number(p.battery_kwh).toLocaleString('en-US')} kWh BESS` : ''].filter(Boolean).join(' + ')
  const date = rec.report_date ? fmtD(rec.report_date) : ''
  const map = {
    'project name': p.name, 'client / project name': [p.client, p.name].filter(Boolean).join(' / '), 'client': p.client, 'customer': p.client,
    'site address': p.location || p.site_name, 'address': p.location || p.site_name, 'location': p.location, 'site': p.site_name || p.location, 'site name': p.site_name,
    'project size': size, 'system size': size, 'plant size': size,
    'date of inspection': date, 'inspection date': date, 'date': date,
    'inspected by': rec.created_by, 'prepared by': rec.created_by,
    'sse representative': p.owner, 'project manager': p.owner, 'project owner': p.owner,
  }
  const val = label => { const v = map[normLabel(label)]; return v ? String(v) : '' }
  const dom = new DOMParser().parseFromString(html, 'text/html')
  let n = 0
  dom.querySelectorAll('p').forEach(el => {
    const strong = el.querySelector(':scope > strong, :scope > b')
    if (!strong || !/:\s*$/.test(strong.textContent)) return
    if (el.textContent.replace(strong.textContent, '').trim()) return
    const v = val(strong.textContent)
    if (v) { strong.after(` ${v}`); n++ }
  })
  dom.querySelectorAll('tr').forEach(tr => {
    const cells = Array.from(tr.children)
    if (cells.length !== 2 || cells.some(c => c.tagName === 'TH') || cells[1].textContent.trim()) return
    const v = val(cells[0].textContent)
    if (v) { (cells[1].querySelector('p') || cells[1]).textContent = v; n++ }
  })
  return n ? dom.body.innerHTML : html
}

// ── Gather everything that belongs to the project ──
async function gather(p) {
  const q = t => supabase.from(t).select('*').eq('project_id', p.id)
  const [st, tk, fl, lk, it] = await Promise.all([
    q('project_stages'), q('project_tasks').order('sort'), q('project_files').order('created_at'), q('project_links'), q('project_items').order('created_at'),
  ])
  const err = st.error || tk.error || fl.error || lk.error
  if (err) throw new Error(err.message)
  const links = lk.data || []
  const repIds = links.filter(l => l.link_type === 'template_report').map(l => l.ref_id)
  const docIds = links.filter(l => l.link_type === 'library_doc').map(l => l.ref_id)
  const [rp, dc] = await Promise.all([
    repIds.length ? supabase.from('template_reports').select('*').in('id', repIds) : { data: [] },
    docIds.length ? supabase.from('engineering_documents').select('*').in('id', docIds) : { data: [] },
  ])
  const reports = Object.fromEntries((rp.data || []).map(r => [r.id, r]))
  const docs = Object.fromEntries((dc.data || []).map(d => [d.id, d]))
  return {
    stages: Object.fromEntries((st.data || []).map(r => [r.stage, r])),
    tasks: tk.data || [],
    files: fl.data || [],
    items: it.error ? [] : it.data || [],
    reportLinks: links.filter(l => l.link_type === 'template_report' && reports[l.ref_id]).map(l => ({ stage: l.stage, rec: reports[l.ref_id] })),
    docLinks: links.filter(l => l.link_type === 'library_doc' && docs[l.ref_id]).map(l => ({ stage: l.stage, rec: docs[l.ref_id] })),
  }
}

async function fileBlob(bucket, path) {
  const { data, error } = await supabase.storage.from(bucket).download(path)
  if (error) throw new Error(error.message)
  return data
}
async function libraryBlob(d) {
  if (d.file_path) return fileBlob('engineering-documents', d.file_path)
  const res = await fetch(d.file_url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.blob()
}

// ── Builders that reuse the existing tool exports ──
async function boqExcel(state) {
  const { buildExcel, calcBoq } = await import('./BoqTool')
  return new Blob([await buildExcel(state, calcBoq(state))])
}
async function boqHtml(state) {
  const { buildPrintHtml, calcBoq } = await import('./BoqTool')
  return buildPrintHtml(state, calcBoq(state), 'quote')
}
let cableTemplate = null
function cableRows(state) {
  const ac = (state.ac || []).map(r => ({ ...r, derating: '', spacing: '', faultKA: '', faultT: '' }))
  return { ac, dc: state.dc || [] }
}
async function cableExcel(state) {
  const [{ calcAC, calcDC }, { buildCableScheduleWorkbook, CABLE_TEMPLATE_URL }] = await Promise.all([import('@/lib/cableSizing'), import('@/lib/cableScheduleExport')])
  if (!cableTemplate) {
    const res = await fetch(CABLE_TEMPLATE_URL)
    if (!res.ok) throw new Error(`cable template not found (${res.status})`)
    cableTemplate = await res.arrayBuffer()
  }
  const { ac, dc } = cableRows(state)
  const data = await buildCableScheduleWorkbook(cableTemplate.slice(0), { project: state.project || {}, ac, dc, acResults: ac.map(calcAC), dcResults: dc.map(calcDC) })
  return new Blob([data])
}
async function cableTables(state) {
  const [{ calcAC, calcDC }, { acOutputs, dcOutputs }] = await Promise.all([import('@/lib/cableSizing'), import('./CableSizingTool')])
  const { ac, dc } = cableRows(state)
  const acT = [['From', 'To', 'Ib (A)', 'Length (m)', 'Cable size', 'VD %', 'Breaker', 'Earth', 'Status']]
  ac.forEach(r => { const o = acOutputs(calcAC(r)); if (o.o_status || r.from || r.to) acT.push([r.from, r.to, r.ib, r.distance, o.o_size, o.o_vdp, o.o_brk, o.o_earth, o.o_status].map(v => (v == null ? '' : String(v)))) })
  const dcT = [['From', 'To', 'Type', 'Current (A)', 'Length (m)', 'Cable size', 'VD %', 'Protection', 'Status']]
  dc.forEach(r => { const o = dcOutputs(calcDC(r)); if (o.o_status || r.from || r.to) dcT.push([r.from, r.to, r.type, r.current, r.distance, o.o_size, o.o_vdp, o.o_prot, o.o_status].map(v => (v == null ? '' : String(v)))) })
  return { acT, dcT }
}
async function htmlToDocx(html, meta) {
  const [{ generateJSON }, { EDITOR_EXTENSIONS }, ex] = await Promise.all([import('@tiptap/core'), import('./DocEditor'), import('@/lib/templateExport')])
  const json = generateJSON(html || '<p></p>', EDITOR_EXTENSIONS)
  return ex.exportDocx(json, { ...meta, returnBlob: true })
}
async function checklistExcel(p, data, stages = STAGES) {
  const ExcelJS = (await import('exceljs/dist/exceljs.min.js')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Sosimple Energy Portal'
  const ws = wb.addWorksheet('Checklist', { views: [{ state: 'frozen', ySplit: 3 }] })
  ws.columns = [{ width: 18 }, { width: 8 }, { width: 60 }, { width: 22 }, { width: 14 }, { width: 14 }]
  ws.getCell('A1').value = `${p.name} — project checklist`
  ws.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF0B74D7' } }
  ws.getCell('A2').value = `Exported ${fmtD(new Date().toISOString())}`
  const head = ws.getRow(3)
  head.values = ['Stage', 'Done', 'Task', 'Assignee', 'Due', 'Completed']
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  head.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B74D7' } } })
  stages.forEach(s => data.tasks.filter(t => t.stage === s).sort((a, b) => a.sort - b.sort).forEach(t => {
    ws.addRow([s, t.done ? 'Yes' : 'No', t.title, t.assignee || '', t.due_date ? fmtD(t.due_date) : '', t.done_at ? fmtD(t.done_at) : ''])
  }))
  ws.autoFilter = { from: 'A3', to: 'F3' }
  return new Blob([await wb.xlsx.writeBuffer()])
}

// ── Simple PDF writer on top of pdf-lib (text, headings, tables, images) ──
// ── PDF writing (Sosimple document style: blue titles with a yellow bar, light tables, green footer rule) ──
const GREEN = [151 / 255, 202 / 255, 70 / 255]
const YELLOW = [1, 232 / 255, 44 / 255]
const TEXT = [35 / 255, 38 / 255, 43 / 255]       // body text
const MUTED = [80 / 255, 80 / 255, 80 / 255]      // Sosimple Grey
const GRID = [175 / 255, 175 / 255, 175 / 255]    // Sosimple Light Grey
const LABEL = [225 / 255, 239 / 255, 246 / 255]   // label cells #E1EFF6
const ZEBRA = [0.969, 0.976, 0.984]
// Engineering Templates "form" look (same as Templates → Print / PDF, lib/templateExport.js DOC_CONTENT_CSS)
const FORM_TEXT = [80 / 255, 80 / 255, 80 / 255]   // #505050
const FORM_H3 = [63 / 255, 107 / 255, 18 / 255]    // #3F6B12
const STATUS_STYLE = {
  Done: { fg: [0.247, 0.42, 0.071], bg: [0.851, 0.922, 0.773] },
  'In progress': { fg: [0.035, 0.37, 0.69], bg: [0.882, 0.937, 0.965] },
  'Not started': { fg: [0.4, 0.4, 0.4], bg: [0.94, 0.94, 0.94] },
}

class PdfWriter {
  constructor(PDFLib, doc, fonts, headerText) {
    Object.assign(this, { PDFLib, doc, fonts, headerText, W: 595.28, H: 841.89, M: 50, page: null, y: 0, charOk: new Map(), logo: null, generated: new Set() })
  }
  rgb(c) { return this.PDFLib.rgb(c[0], c[1], c[2]) }
  clean(text, font) {
    const MAP = { '→': '->', '←': '<-', '✓': 'v', '✔': 'v', '☑': '[x]', '☐': '[ ]', '≤': '<=', '≥': '>=', ' ': ' ', '\t': '    ', '−': '-', 'Ω': 'Ohm', '²': '2', '³': '3' }
    let out = ''
    for (const ch of String(text ?? '')) {
      if (ch === '\n') { out += ch; continue }
      const key = font.name + ch
      if (!this.charOk.has(key)) { let ok = true; try { font.widthOfTextAtSize(ch, 10) } catch (e) { ok = false } this.charOk.set(key, ok) }
      out += this.charOk.get(key) ? ch : (MAP[ch] ?? (ch.charCodeAt(0) < 32 ? '' : '?'))
    }
    return out
  }
  wrap(text, font, size, width) {
    const lines = []
    this.clean(text, font).split('\n').forEach(para => {
      const words = para.split(/ +/)
      let line = ''
      words.forEach(w => {
        const t = line ? `${line} ${w}` : w
        if (font.widthOfTextAtSize(t, size) <= width) { line = t; return }
        if (line) lines.push(line)
        let rest = w
        while (font.widthOfTextAtSize(rest, size) > width && rest.length > 1) {
          let i = rest.length
          while (i > 1 && font.widthOfTextAtSize(rest.slice(0, i), size) > width) i--
          lines.push(rest.slice(0, i)); rest = rest.slice(i)
        }
        line = rest
      })
      lines.push(line)
    })
    return lines
  }
  fit(text, font, size, width) {
    let t = this.clean(text, font)
    if (font.widthOfTextAtSize(t, size) <= width) return t
    while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > width) t = t.slice(0, -1)
    return `${t}…`
  }
  // Inner page: small logo top left, document name top right, thin rule
  newPage() {
    this.page = this.doc.addPage([this.W, this.H])
    this.generated.add(this.page)
    if (this.logo) {
      const s = 84 / this.logo.width
      this.page.drawImage(this.logo, { x: this.M, y: this.H - 30 - this.logo.height * s, width: 84, height: this.logo.height * s })
    }
    if (this.headerText) {
      const t = this.fit(this.headerText, this.fonts.reg, 8, this.W - 2 * this.M - 120)
      this.page.drawText(t, { x: this.W - this.M - this.fonts.reg.widthOfTextAtSize(t, 8), y: this.H - 46, size: 8, font: this.fonts.reg, color: this.rgb(MUTED) })
    }
    this.page.drawLine({ start: { x: this.M, y: this.H - 58 }, end: { x: this.W - this.M, y: this.H - 58 }, thickness: 0.5, color: this.rgb(GRID) })
    this.y = this.H - 78
  }
  ensure(h) { if (!this.page || this.y - h < this.M + 10) this.newPage() }
  text(t, { size = 10, font = this.fonts.reg, color = TEXT, indent = 0, gap = 4 } = {}) {
    const width = this.W - 2 * this.M - indent
    this.wrap(t, font, size, width).forEach(line => {
      this.ensure(size * 1.4)
      this.page.drawText(line, { x: this.M + indent, y: this.y - size, size, font, color: this.rgb(color) })
      this.y -= size * 1.4
    })
    this.y -= gap
  }
  // level 1: page title (blue, yellow bar) · level 2: sub-heading (blue, green underline) · level 3: small bold
  heading(t, level = 1) {
    if (level === 1) {
      this.ensure(70)
      this.y -= 4
      const lines = this.wrap(t, this.fonts.bold, 20, this.W - 2 * this.M)
      lines.forEach(line => { this.page.drawText(line, { x: this.M, y: this.y - 20, size: 20, font: this.fonts.bold, color: this.rgb(BLUE) }); this.y -= 25 })
      this.page.drawRectangle({ x: this.M, y: this.y - 4, width: 56, height: 3, color: this.rgb(YELLOW) })
      this.y -= 18
      return
    }
    if (level === 2) {
      this.ensure(44)
      this.y -= 8
      this.text(t, { size: 12, font: this.fonts.bold, color: BLUE, gap: 0 })
      this.page.drawRectangle({ x: this.M, y: this.y - 2, width: 32, height: 2.2, color: this.rgb(GREEN) })
      this.y -= 12
      return
    }
    this.ensure(30)
    this.y -= 4
    this.text(t, { size: 10.5, font: this.fonts.bold, color: TEXT, gap: 3 })
  }
  // small coloured status label
  pill(label, x, y) {
    const st = STATUS_STYLE[label] || STATUS_STYLE['Not started']
    const t = this.clean(label, this.fonts.bold)
    const w = this.fonts.bold.widthOfTextAtSize(t, 8.5) + 14
    this.page.drawRectangle({ x, y: y - 4, width: w, height: 15, color: this.rgb(st.bg) })
    this.page.drawText(t, { x: x + 7, y, size: 8.5, font: this.fonts.bold, color: this.rgb(st.fg) })
    return w
  }
  rule() { this.ensure(10); this.page.drawLine({ start: { x: this.M, y: this.y - 4 }, end: { x: this.W - this.M, y: this.y - 4 }, thickness: 0.5, color: this.rgb(GRID) }); this.y -= 10 }
  // A cell is a string, or { t, color, bold }. '[x]' / '[ ]' cells are drawn as a tick / empty box.
  // label: true → first column shaded as a label column (key/value tables)
  table(rows, { header = true, size = 8, widths, label = false } = {}) {
    if (!rows.length) return
    const n = Math.max(...rows.map(r => r.length))
    const total = this.W - 2 * this.M
    const w = widths ? widths.map(f => f * total) : Array(n).fill(total / n)
    const pad = 4
    const cellOf = c => (c && typeof c === 'object' ? c : { t: c == null ? '' : String(c) })
    const measure = (r, isHead) => {
      const cells = Array.from({ length: n }, (_, i) => {
        const c = cellOf(r[i])
        const font = isHead || c.bold || (label && i === 0) ? this.fonts.bold : this.fonts.reg
        const box = c.t === '[x]' || c.t === '[ ]'
        return { ...c, font, box, lines: box ? [''] : this.wrap(c.t, font, size, w[i] - 2 * pad) }
      })
      const h = Math.max(...cells.map(c => c.lines.length)) * size * 1.3 + 2 * pad + 1
      return { cells, h }
    }
    const head = header ? measure(rows[0], true) : null
    let zebra = 0
    const paint = ({ cells, h }, isHead) => {
      if (!isHead && zebra++ % 2 === 1 && !label) this.page.drawRectangle({ x: this.M, y: this.y - h + 0.5, width: total, height: h - 1, color: this.rgb(ZEBRA) })
      if (label) this.page.drawRectangle({ x: this.M, y: this.y - h + 0.5, width: w[0], height: h - 1, color: this.rgb(LABEL) })
      let x = this.M
      cells.forEach((c, i) => {
        if (c.box) {
          const bx = x + pad + 1, by = this.y - pad - 10
          if (c.t === '[x]') {
            this.page.drawRectangle({ x: bx, y: by, width: 9, height: 9, color: this.rgb(GREEN) })
            this.page.drawLine({ start: { x: bx + 2, y: by + 4.6 }, end: { x: bx + 3.8, y: by + 2.4 }, thickness: 1.3, color: this.rgb([1, 1, 1]) })
            this.page.drawLine({ start: { x: bx + 3.8, y: by + 2.4 }, end: { x: bx + 7.2, y: by + 7 }, thickness: 1.3, color: this.rgb([1, 1, 1]) })
          } else this.page.drawRectangle({ x: bx, y: by, width: 9, height: 9, borderColor: this.rgb(GRID), borderWidth: 0.9 })
        } else {
          c.lines.forEach((ln, j) => this.page.drawText(ln, { x: x + pad, y: this.y - pad - size - j * size * 1.3 + 1, size, font: c.font, color: this.rgb(c.color || TEXT) }))
        }
        x += w[i]
      })
      this.page.drawLine({ start: { x: this.M, y: this.y - h }, end: { x: this.M + total, y: this.y - h }, thickness: isHead ? 1.2 : 0.4, color: this.rgb(isHead ? BLUE : GRID) })
      this.y -= h
    }
    if (head) { this.ensure(head.h + 20); paint(head, true) } else this.ensure(20)
    if (!head) this.page.drawLine({ start: { x: this.M, y: this.y }, end: { x: this.M + total, y: this.y }, thickness: 0.4, color: this.rgb(GRID) })
    rows.slice(header ? 1 : 0).forEach(r => {
      const row = measure(r, false)
      if (!this.page || this.y - row.h < this.M + 10) { this.newPage(); zebra = 0; if (head) paint(head, true) }
      paint(row, false)
    })
    this.y -= 10
  }
  async image(bytes, kind, maxH = 420) {
    const img = kind === 'png' ? await this.doc.embedPng(bytes) : await this.doc.embedJpg(bytes)
    const maxW = this.W - 2 * this.M
    const s = Math.min(maxW / img.width, maxH / img.height, 1)
    const w = img.width * s, h = img.height * s
    this.ensure(h + 10)
    const x = this.M + (maxW - w) / 2
    this.page.drawRectangle({ x: x - 4, y: this.y - h - 4, width: w + 8, height: h + 8, borderColor: this.rgb(GRID), borderWidth: 0.6 })
    this.page.drawImage(img, { x, y: this.y - h, width: w, height: h })
    this.y -= h + 14
  }
  // One photo in a half-page slot: "Photo n – caption", a small meta line, then the image in a thin frame
  get photoSlotH() { return Math.floor((this.H - 78 - (this.M + 10)) / 2) - 6 }
  async photo(bytes, kind, caption, meta) {
    const slotH = this.photoSlotH
    if (!this.page || this.y - slotH < this.M + 10) this.newPage()
    const top = this.y
    this.text(caption, { size: 10.5, font: this.fonts.bold, color: TEXT, gap: 0 })
    if (meta) this.text(meta, { size: 8, color: MUTED, gap: 0 })
    this.y -= 6
    const img = kind === 'png' ? await this.doc.embedPng(bytes) : await this.doc.embedJpg(bytes)
    const maxW = this.W - 2 * this.M - 8, maxH = slotH - (top - this.y) - 14
    const sc = Math.min(maxW / img.width, maxH / img.height, 1)
    const w = img.width * sc, h = img.height * sc
    const x = this.M + (this.W - 2 * this.M - w) / 2
    this.page.drawRectangle({ x: x - 4, y: this.y - h - 4, width: w + 8, height: h + 8, borderColor: this.rgb(GRID), borderWidth: 0.6 })
    this.page.drawImage(img, { x, y: this.y - h, width: w, height: h })
    this.y = top - slotH - 6
  }
  // Renders editor / report HTML: headings, paragraphs, lists, task lists, tables, images
  // ── Engineering Templates form style ──
  // h1 / h2: upper case, blue · h3: green · grey body text
  formHeading(t, level) {
    const size = level === 1 ? 17 : level === 2 ? 11.5 : 10
    this.ensure(level === 1 ? 50 : 40)
    this.y -= level === 1 ? 6 : level === 2 ? 8 : 4
    const color = level === 3 ? FORM_H3 : BLUE
    this.text(level === 3 ? t : t.toUpperCase(), { size, font: this.fonts.bold, color, gap: level === 1 ? 6 : 3 })
  }
  // "Label:" in bold followed by the answer in regular text
  labelLine(label, rest, { size = 9.5 } = {}) {
    const lw = this.fonts.bold.widthOfTextAtSize(this.clean(label, this.fonts.bold), size)
    const avail = this.W - 2 * this.M
    this.ensure(size * 1.5)
    this.page.drawText(this.clean(label, this.fonts.bold), { x: this.M, y: this.y - size, size, font: this.fonts.bold, color: this.rgb(FORM_TEXT) })
    if (rest && lw + 4 + this.fonts.reg.widthOfTextAtSize(this.clean(rest, this.fonts.reg), size) <= avail) {
      this.page.drawText(this.clean(rest, this.fonts.reg), { x: this.M + lw + 4, y: this.y - size, size, font: this.fonts.reg, color: this.rgb(FORM_TEXT) })
      this.y -= size * 1.5 + 2
    } else {
      this.y -= size * 1.5
      if (rest) this.text(rest, { size, color: FORM_TEXT, gap: 2 })
      else this.y -= 2
    }
  }
  // Grid table: every cell boxed, light-blue header cells, the template's own column widths
  // (colwidth="514" / colwidth="514,316" on merged cells) and merged cells (colspan)
  formTable(el, cellText, strongOnly) {
    const rows = Array.from(el.querySelectorAll('tr')).filter(tr => tr.closest('table') === el)
    if (!rows.length) return
    const span = c => Math.max(1, Number(c.getAttribute('colspan')) || 1)
    const n = Math.max(...rows.map(tr => Array.from(tr.children).reduce((a, c) => a + span(c), 0)))
    let cols = null
    for (const tr of rows) {
      const ws = []
      let okRow = true
      for (const c of tr.children) {
        const cw = (c.getAttribute('colwidth') || '').split(',').map(Number).filter(x => x > 0)
        if (cw.length !== span(c)) { okRow = false; break }
        ws.push(...cw)
      }
      if (okRow && ws.length === n) { cols = ws; break }
    }
    if (!cols) cols = Array(n).fill(1)
    const total = this.W - 2 * this.M
    const sum = cols.reduce((a, b) => a + b, 0)
    const colW = cols.map(c => (c / sum) * total)
    const size = 8.5, pad = 4.5
    const measure = tr => {
      let ci = 0
      const cells = Array.from(tr.children).map(c => {
        const sp = Math.min(span(c), n - ci)
        const x = this.M + colW.slice(0, ci).reduce((a, b) => a + b, 0)
        const w = colW.slice(ci, ci + sp).reduce((a, b) => a + b, 0)
        ci += sp
        const t = cellText(c)
        const isTh = c.tagName === 'TH'
        const font = isTh || (t && strongOnly(c)) ? this.fonts.bold : this.fonts.reg
        const box = t === '[x]' || t === '[ ]'
        return { x, w, t, isTh, font, box, lines: box || !t ? [''] : this.wrap(t, font, size, w - 2 * pad) }
      })
      // cells missing at the end of a short row still get a box
      if (ci < n) cells.push({ x: this.M + colW.slice(0, ci).reduce((a, b) => a + b, 0), w: colW.slice(ci).reduce((a, b) => a + b, 0), t: '', lines: [''], font: this.fonts.reg })
      const h = Math.max(...cells.map(c => c.lines.length)) * size * 1.3 + 2 * pad + 1
      return { cells, h }
    }
    const paint = ({ cells, h }) => {
      cells.forEach(c => {
        this.page.drawRectangle({ x: c.x, y: this.y - h, width: c.w, height: h, color: c.isTh ? this.rgb(LABEL) : undefined, borderColor: this.rgb(GRID), borderWidth: 0.6 })
        if (c.box) {
          const bx = c.x + pad + 1, by = this.y - pad - 10
          if (c.t === '[x]') {
            this.page.drawRectangle({ x: bx, y: by, width: 9, height: 9, color: this.rgb(BLUE) })
            this.page.drawLine({ start: { x: bx + 2, y: by + 4.6 }, end: { x: bx + 3.8, y: by + 2.4 }, thickness: 1.3, color: this.rgb([1, 1, 1]) })
            this.page.drawLine({ start: { x: bx + 3.8, y: by + 2.4 }, end: { x: bx + 7.2, y: by + 7 }, thickness: 1.3, color: this.rgb([1, 1, 1]) })
          } else this.page.drawRectangle({ x: bx, y: by, width: 9, height: 9, borderColor: this.rgb(GRID), borderWidth: 0.9 })
        } else c.lines.forEach((ln, j) => this.page.drawText(ln, { x: c.x + pad, y: this.y - pad - size - j * size * 1.3 + 1, size, font: c.font, color: this.rgb(FORM_TEXT) }))
      })
      this.y -= h
    }
    const measured = rows.map(measure)
    // repeat a header row (all header cells) when the table continues on the next page
    const head = rows.length > 1 && Array.from(rows[0].children).every(c => c.tagName === 'TH') ? measured[0] : null
    this.ensure(measured[0].h + (measured[1]?.h || 0) + 6)
    measured.forEach((row, i) => {
      if (this.y - row.h < this.M + 10) { this.newPage(); if (head && i > 0) paint(head) }
      paint(row)
    })
    this.y -= 10
  }

  async html(html, { form = false } = {}) {
    const dom = new DOMParser().parseFromString(html || '', 'text/html')
    dom.querySelectorAll('br').forEach(b => b.replaceWith('\n'))
    dom.querySelectorAll('style,script,title,head').forEach(n => n.remove())
    // separate text from neighbouring blocks/cells with a space so words don't run together
    dom.querySelectorAll('div,p,h1,h2,h3,h4,h5,h6,li,td,th,span').forEach(el => { if (el.nextSibling && el.nextSibling.nodeType === 1) el.after(' ') })
    dom.querySelectorAll('small').forEach(el => el.before('\n'))
    const txt = n => (n.textContent || '').replace(/[ \t\r]+/g, ' ').replace(/ *\n */g, '\n').trim()
    const BLOCK = /^(P|DIV|H[1-6]|UL|OL|TABLE|BLOCKQUOTE|HR|IMG|PRE|SECTION|ARTICLE|HEADER|FOOTER|MAIN|FIGURE)$/
    const walk = async (node, indent) => {
      for (const el of Array.from(node.childNodes)) {
        if (el.nodeType === 3) { const t = el.textContent.replace(/\s+/g, ' ').trim(); if (t) this.text(t, { indent }); continue }
        if (el.nodeType !== 1) continue
        const tag = el.tagName
        if (/^H[1-6]$/.test(tag)) { const t = txt(el); if (t) { if (form) this.formHeading(t, Math.min(3, Number(tag[1]))); else this.heading(t, Math.min(3, Number(tag[1]) + 1)) } continue }
        if (tag === 'UL' || tag === 'OL') {
          let i = 0
          for (const li of Array.from(el.children).filter(c => c.tagName === 'LI')) {
            i++
            const nested = Array.from(li.querySelectorAll(':scope > ul, :scope > ol'))
            const clone = li.cloneNode(true)
            clone.querySelectorAll(':scope > ul, :scope > ol').forEach(x => x.remove())
            clone.querySelectorAll('input').forEach(x => x.remove())
            const isTask = li.getAttribute('data-type') === 'taskItem' || el.getAttribute('data-type') === 'taskList'
            const mark = isTask ? (li.getAttribute('data-checked') === 'true' ? '[x] ' : '[ ] ') : tag === 'OL' ? `${i}. ` : '•  '
            const t = txt(clone)
            if (t) this.text(mark + t, { indent: indent + 10, gap: 1 })
            for (const sub of nested) await walk({ childNodes: [sub] }, indent + 16)
          }
          this.y -= 3
          continue
        }
        if (tag === 'TABLE') {
          // a cell that only holds a tick box (task list) is drawn as a ticked / empty box
          const cellText = c => {
            const items = c.querySelectorAll('li[data-type="taskItem"]')
            const t = txt(c)
            if (items.length === 1 && !t) return items[0].getAttribute('data-checked') === 'true' ? '[x]' : '[ ]'
            return t
          }
          if (form) {
            const strongOnly = c => { const st = Array.from(c.querySelectorAll('strong, b')).map(x => x.textContent).join('').replace(/\s+/g, ''); return !!st && st === c.textContent.replace(/\s+/g, '') }
            this.formTable(el, cellText, strongOnly)
            continue
          }
          const rows = Array.from(el.querySelectorAll('tr')).map(tr => Array.from(tr.children).map(cellText))
          if (rows.length) this.table(rows, { header: !!el.querySelector('tr th') })
          continue
        }
        if (tag === 'HR') { this.rule(); continue }
        if (tag === 'IMG') {
          try {
            const res = await fetch(el.getAttribute('src'))
            const type = (res.headers.get('content-type') || '').toLowerCase()
            const kind = type.includes('png') ? 'png' : type.includes('jpeg') || type.includes('jpg') ? 'jpg' : null
            if (res.ok && kind) await this.image(await res.arrayBuffer(), kind, 300)
          } catch (e) { /* skip images that cannot be fetched */ }
          continue
        }
        if (tag === 'BLOCKQUOTE') { const t = txt(el); if (t) this.text(t, { indent: indent + 14, font: this.fonts.ital, color: MUTED }); continue }
        if (tag === 'PRE') { const t = el.textContent; if (t) this.text(t, { indent, font: this.fonts.mono, size: 8 }); continue }
        const hasBlock = Array.from(el.children).some(c => BLOCK.test(c.tagName))
        if (hasBlock) { await walk(el, indent); continue }
        const t = txt(el)
        if (form && tag === 'P') {
          const first = el.firstElementChild
          const lead = el.firstChild && el.firstChild.nodeType === 3 && el.firstChild.textContent.trim()
          if (first && /^(STRONG|B)$/.test(first.tagName) && !lead) {
            const label = txt(first)
            const rest = t.slice(t.indexOf(label) + label.length).trim()
            if (label) { this.labelLine(label, rest); continue }
          }
          if (t) this.text(t, { indent, size: 9.5, color: FORM_TEXT, gap: 3 })
          continue
        }
        if (t) this.text(t, { indent, font: /^(STRONG|B)$/.test(tag) ? this.fonts.bold : this.fonts.reg, ...(form ? { color: FORM_TEXT, size: 9.5 } : {}) })
      }
    }
    await walk(dom.body, 0)
  }
}

async function newPdf(PDFLib) {
  const doc = await PDFLib.PDFDocument.create()
  const S = PDFLib.StandardFonts
  const fonts = {
    reg: await doc.embedFont(S.Helvetica), bold: await doc.embedFont(S.HelveticaBold),
    ital: await doc.embedFont(S.HelveticaOblique), mono: await doc.embedFont(S.Courier),
  }
  return { doc, fonts }
}

// Footer on every page this writer drew (attached PDFs such as design packs keep their own footers):
// green rule · "Sosimple Energy · Cheap energy. Clean business." · project · "Page n of N"
function drawFooters(w, middle) {
  const { doc, fonts } = w
  const pages = doc.getPages()
  pages.forEach((pg, i) => {
    if (!w.generated.has(pg)) return
    const { width } = pg.getSize()
    const y = 26, M = 50
    pg.drawLine({ start: { x: M, y: y + 11 }, end: { x: width - M, y: y + 11 }, thickness: 0.8, color: w.rgb(GREEN) })
    const left = 'Sosimple Energy · Cheap energy. Clean business.'
    pg.drawText(left, { x: M, y, size: 7.5, font: fonts.reg, color: w.rgb(MUTED) })
    const r = `Page ${i + 1} of ${pages.length}`
    const rW = fonts.bold.widthOfTextAtSize(r, 7.5)
    pg.drawText(r, { x: width - M - rW, y, size: 7.5, font: fonts.bold, color: w.rgb(MUTED) })
    // middle text sits between the slogan and the page number (centred when there is room)
    const lo = M + fonts.reg.widthOfTextAtSize(left, 7.5) + 14, hi = width - M - rW - 14
    const mid = w.fit(middle, fonts.reg, 7.5, hi - lo)
    const mW = fonts.reg.widthOfTextAtSize(mid, 7.5)
    pg.drawText(mid, { x: Math.min(hi - mW, Math.max(lo, width / 2 - mW / 2)), y, size: 7.5, font: fonts.reg, color: w.rgb(MUTED) })
  })
}

// Cover, contents, stage summary and (per stage) checklist + notes. When `attach` is
// given, each stage is followed by its attachments (merged PDF).
async function writeProjectPdf(PDFLib, p, data, { userName, contents, attach, stages = STAGES, title = DEFAULT_TITLE }) {
  const { doc, fonts } = await newPdf(PDFLib)
  const w = new PdfWriter(PDFLib, doc, fonts, `${title} · ${p.name}`)
  const partial = stages.length < STAGES.length
  try {
    const res = await fetch(LOGO_SRC)
    if (res.ok) { const b = new Uint8Array(await res.arrayBuffer()); w.logo = b[0] === 0xff && b[1] === 0xd8 ? await doc.embedJpg(b) : await doc.embedPng(b) }
  } catch (e) { /* no logo */ }
  const today = fmtD(new Date().toISOString())

  // ── Cover ──
  const cover = doc.addPage([w.W, w.H]); w.generated.add(cover); w.page = cover
  {
    const H = w.H, BAND = 26, hB = H * 0.40, hG = H * 0.32, D = 22
    cover.drawSvgPath(`M0 0 L${BAND} 0 L${BAND} ${hB - D} L0 ${hB} Z`, { x: 0, y: H, color: w.rgb(BLUE) })
    cover.drawSvgPath(`M0 ${hB} L${BAND} ${hB - D} L${BAND} ${hB + hG - D} L0 ${hB + hG} Z`, { x: 0, y: H, color: w.rgb(GREEN) })
    cover.drawSvgPath(`M0 ${hB + hG} L${BAND} ${hB + hG - D} L${BAND} ${H} L0 ${H} Z`, { x: 0, y: H, color: w.rgb(YELLOW) })
    if (w.logo) { const s = 190 / w.logo.width; cover.drawImage(w.logo, { x: w.W - w.M - 190, y: H - w.M - w.logo.height * s + 4, width: 190, height: w.logo.height * s }) }
    const X = w.M + 18, CW = w.W - X - w.M
    let y = H * 0.64
    cover.drawRectangle({ x: X, y: y + 30, width: 64, height: 4, color: w.rgb(YELLOW) })
    cover.drawText(w.fit(title.toUpperCase(), fonts.bold, 11, CW), { x: X, y: y + 12, size: 11, font: fonts.bold, color: w.rgb(MUTED) })
    w.wrap(p.name || 'Untitled project', fonts.bold, 30, CW).forEach(line => { cover.drawText(line, { x: X, y: y - 18, size: 30, font: fonts.bold, color: w.rgb(BLUE) }); y -= 35 })
    y -= 12
    const sub = [p.client, p.site_name || p.location].filter(Boolean).join(' · ')
    if (sub) { cover.drawText(w.fit(sub, fonts.bold, 15, CW), { x: X, y, size: 15, font: fonts.bold, color: w.rgb(TEXT) }); y -= 22 }
    if (p.description) w.wrap(p.description, fonts.reg, 11, CW).slice(0, 3).forEach(line => { cover.drawText(line, { x: X, y, size: 11, font: fonts.reg, color: w.rgb(MUTED) }); y -= 15 })
    // which stages this archive covers (only when it is not all 8)
    if (partial) {
      y -= 6
      cover.drawText(stages.length === 1 ? 'STAGE' : 'STAGES INCLUDED', { x: X, y, size: 8, font: fonts.bold, color: w.rgb(BLUE) }); y -= 14
      w.wrap(stages.map(stageLabel).join('  ·  '), fonts.bold, 10, CW).forEach(line => { cover.drawText(w.clean(line, fonts.bold), { x: X, y, size: 10, font: fonts.bold, color: w.rgb(TEXT) }); y -= 14 })
    }
    // project details panel
    const sys = [p.capacity_kwp ? `${Number(p.capacity_kwp).toLocaleString('en-US')} kWp` : '', p.battery_kwh ? `${Number(p.battery_kwh).toLocaleString('en-US')} kWh BESS` : ''].filter(Boolean).join(' + ')
    const rows = [
      ['Client', p.client || '—', 'Contract', p.system_type || '—'],
      ['Site', p.site_name || '—', 'System', sys || '—'],
      ['Location', p.location || '—', 'Project owner', p.owner || '—'],
      ['Status', `${p.status || '—'} · ${p.stage || ''}`, 'Start', fmtD(p.start_date) || '—'],
      ['Compiled', `${today}${userName ? ` by ${userName}` : ''}`, 'Target handover', fmtD(p.target_date) || '—'],
    ]
    const rowH = 26, top = w.M + 40 + rowH * rows.length, colW = CW / 2, labW = colW * 0.38
    cover.drawText('PROJECT DETAILS', { x: X, y: top + 10, size: 8, font: fonts.bold, color: w.rgb(BLUE) })
    rows.forEach((r, i) => {
      const ry = top - (i + 1) * rowH
      ;[0, 1].forEach(c => {
        const x = X + c * colW
        cover.drawRectangle({ x, y: ry, width: labW, height: rowH, color: w.rgb(LABEL), borderColor: w.rgb(GRID), borderWidth: 0.5 })
        cover.drawRectangle({ x: x + labW, y: ry, width: colW - labW, height: rowH, borderColor: w.rgb(GRID), borderWidth: 0.5 })
        cover.drawText(r[c * 2], { x: x + 6, y: ry + 9.5, size: 8, font: fonts.bold, color: w.rgb(TEXT) })
        cover.drawText(w.fit(r[c * 2 + 1], fonts.reg, 8.5, colW - labW - 12), { x: x + labW + 6, y: ry + 9.5, size: 8.5, font: fonts.reg, color: w.rgb(TEXT) })
      })
    })
  }

  // ── Contents (page numbers are filled in once the stages are written) ──
  w.newPage()
  w.heading('Contents', 1)
  const contentsPage = w.page
  const tocSlots = [] // { page, y, key, label, size, indent, font, color }
  const pageOf = {} // stage, or "stage#section" → page number
  const markPage = key => { pageOf[key] = doc.getPages().indexOf(w.page) + 1 }
  stages.forEach(s => {
    const list = contents[s] || []
    w.ensure(30)
    tocSlots.push({ page: w.page, y: w.y, key: s, label: `${pad2(STAGES.indexOf(s) + 1)}  ${s}`, size: 11, indent: 0, font: fonts.bold, color: BLUE })
    w.page.drawText(w.clean(`${pad2(STAGES.indexOf(s) + 1)}  ${s}`, fonts.bold), { x: w.M, y: w.y - 11, size: 11, font: fonts.bold, color: w.rgb(BLUE) })
    w.y -= 18
    if (!list.length) w.text('Checklist and notes only', { indent: 22, color: MUTED, size: 8.5, gap: 2 })
    list.forEach(c => {
      if (typeof c === 'string') { w.text(c, { indent: 22, size: 8.5, color: MUTED, gap: 0 }); return }
      // a numbered section of a sectioned stage: own line with a page number
      w.ensure(16)
      tocSlots.push({ page: w.page, y: w.y + 1.5, key: `${s}#${c.key}`, label: c.label, size: 9.5, indent: 22, font: fonts.reg, color: TEXT })
      w.page.drawText(w.fit(c.label, fonts.reg, 9.5, w.W - 2 * w.M - 80), { x: w.M + 22, y: w.y - 9.5, size: 9.5, font: fonts.reg, color: w.rgb(TEXT) })
      w.y -= 15
    })
    w.y -= 8
  })

  // ── Stage summary (only useful when more than one stage is included) ──
  if (stages.length > 1) {
  w.y -= 6
  w.heading('Stage summary', 2)
  w.table([['Stage', 'Status', 'Completed', 'Tasks done']].concat(stages.map(s => {
    const t = data.tasks.filter(x => x.stage === s)
    const status = data.stages[s]?.status || 'Not started'
    return [{ t: `${pad2(STAGES.indexOf(s) + 1)}  ${s}`, bold: true }, { t: status, bold: true, color: (STATUS_STYLE[status] || STATUS_STYLE['Not started']).fg }, data.stages[s]?.completed_at ? fmtD(data.stages[s].completed_at) : '—', t.length ? `${t.filter(x => x.done).length} / ${t.length}` : '—']
  })), { widths: [0.38, 0.22, 0.2, 0.2], size: 9 })
  }

  // ── Stages ──
  const stagePage = pageOf
  const skipped = []
  const checklistTable = tasks => w.table([['', 'Task', 'Assignee', 'Due', 'Done on']].concat(tasks.map(t => [t.done ? '[x]' : '[ ]', t.title, t.assignee || '—', t.due_date ? fmtD(t.due_date) : '—', t.done_at ? fmtD(t.done_at) : '—'])), { widths: [0.06, 0.5, 0.17, 0.13, 0.14], size: 8.5 })
  for (const s of stages) {
    const st = data.stages[s]
    const sections = (contents[s] || []).filter(c => typeof c === 'object')
    if (sections.length || STAGE_SECTIONS[s]) {
      // ── sectioned stage: stage title, then numbered sections ──
      w.newPage()
      markPage(s)
      w.heading(`${pad2(STAGES.indexOf(s) + 1)}  ${s}`, 1)
      const tasks = data.tasks.filter(t => t.stage === s).sort((a, b) => a.sort - b.sort)
      const status = st?.status || 'Not started'
      const pw = w.pill(status, w.M, w.y - 4)
      const facts = [tasks.length ? `${tasks.filter(t => t.done).length} of ${tasks.length} tasks done` : 'No checklist', st?.completed_at ? `completed ${fmtD(st.completed_at)}` : ''].filter(Boolean).join(' · ')
      w.page.drawText(w.clean(facts, fonts.reg), { x: w.M + pw + 10, y: w.y - 4, size: 9, font: fonts.reg, color: w.rgb(MUTED) })
      w.y -= 22
      for (const sec of sections) {
        const printable = sec.key === 'notes' || sec.key === 'checklist' || attach
        if (!printable) continue
        // photos and other documents start a fresh page unless there is room for a good part of a page
        if ((sec.key === 'photos' && w.y - (w.M + 10) < w.photoSlotH + 50) || (sec.key === 'other' && w.y < w.H / 2)) w.newPage()
        w.ensure(90)
        markPage(`${s}#${sec.key}`)
        w.heading(sec.title, 2)
        if (sec.key === 'report') await attach.reports(s, w, sec.count > 1)
        else if (sec.key === 'photos') await attach.photos(s, w, skipped)
        else if (sec.key === 'notes') await w.html(st.notes_html)
        else if (sec.key === 'other') await attach.other(s, w, doc, skipped)
        else if (sec.key === 'checklist') checklistTable(tasks)
        w.y -= 6
      }
      continue
    }
    const hasContent = data.tasks.some(t => t.stage === s) || (st?.notes_html || '').replace(/<[^>]+>/g, '').trim() || (attach && (contents[s] || []).length)
    // empty stages share a page instead of using one each
    if (hasContent || !w.page || w.page === contentsPage || w.y < w.H / 3) w.newPage(); else w.y -= 18
    stagePage[s] = doc.getPages().indexOf(w.page) + 1
    w.heading(`${pad2(STAGES.indexOf(s) + 1)}  ${s}`, 1)
    const tasks = data.tasks.filter(t => t.stage === s).sort((a, b) => a.sort - b.sort)
    const status = st?.status || 'Not started'
    const pw = w.pill(status, w.M, w.y - 4)
    const facts = [tasks.length ? `${tasks.filter(t => t.done).length} of ${tasks.length} tasks done` : 'No checklist', st?.completed_at ? `completed ${fmtD(st.completed_at)}` : ''].filter(Boolean).join(' · ')
    w.page.drawText(w.clean(facts, fonts.reg), { x: w.M + pw + 10, y: w.y - 4, size: 9, font: fonts.reg, color: w.rgb(MUTED) })
    w.y -= 22
    if (tasks.length) {
      w.heading('Checklist', 2)
      w.table([['', 'Task', 'Assignee', 'Due', 'Done on']].concat(tasks.map(t => [t.done ? '[x]' : '[ ]', t.title, t.assignee || '—', t.due_date ? fmtD(t.due_date) : '—', t.done_at ? fmtD(t.done_at) : '—'])), { widths: [0.06, 0.5, 0.17, 0.13, 0.14], size: 8.5 })
    }
    const notes = st?.notes_html
    if (notes && notes.replace(/<[^>]+>/g, '').trim()) { w.heading('Notes', 2); await w.html(notes) }
    if (attach) await attach(s, w, doc, skipped)
  }
  if (attach && skipped.length) {
    w.newPage()
    w.heading('Not included in this PDF', 1)
    w.text('These files cannot be shown inside a PDF. They are in the ZIP archive in their original format.', { color: MUTED })
    w.table([['Stage', 'File', 'Reason']].concat(skipped), { widths: [0.2, 0.5, 0.3], size: 8.5 })
  }

  // contents page numbers with dotted leaders
  tocSlots.forEach(sl => {
    const n = String(pageOf[sl.key] || '')
    if (!n) return
    const nw = fonts.bold.widthOfTextAtSize(n, sl.size)
    const lw = sl.font.widthOfTextAtSize(w.fit(sl.label, sl.font, sl.size, w.W - 2 * w.M - 80), sl.size)
    const x1 = w.M + sl.indent + lw + 8, x2 = w.W - w.M - nw - 8
    if (x2 > x1) sl.page.drawLine({ start: { x: x1, y: sl.y - sl.size - 1 }, end: { x: x2, y: sl.y - sl.size - 1 }, thickness: 0.6, color: w.rgb(GRID), dashArray: [1, 2] })
    sl.page.drawText(n, { x: w.W - w.M - nw, y: sl.y - sl.size, size: sl.size, font: fonts.bold, color: w.rgb(sl.color) })
  })
  drawFooters(w, `${p.name} · ${title} · ${today}`)
  return doc.save()
}

// ── Public entry point ──
export async function buildProjectArchive(p, { zip: wantZip = true, pdf: wantPdf = true, userName = '', onProgress = () => {}, plan = {} } = {}) {
  // plan.stages: which stages to include (default all 8, always kept in stage order)
  // plan.title : cover / header / file-name title (default "Project archive")
  const stages = STAGES.filter(s => !plan.stages || plan.stages.includes(s))
  if (!stages.length) throw new Error('Choose at least one stage to include.')
  const title = (plan.title || '').trim() || DEFAULT_TITLE
  const problems = []
  const note = (where, e) => problems.push(`${where}: ${e?.message || e}`)
  onProgress('Loading libraries…')
  const [JSZip, PDFLib] = await Promise.all([wantZip ? loadScript(CDN_JSZIP, 'JSZip') : null, loadScript(CDN_PDFLIB, 'PDFLib')])
  onProgress('Collecting project data…')
  const data = await gather(p)
  // Archive copy of each report: blank project fields filled from the project
  data.reportLinks = data.reportLinks.map(l => ({ ...l, rec: { ...l.rec, content_html: prefillReport(l.rec.content_html, p, l.rec) } }))

  // Plan the contents (used for the contents page and the ZIP)
  // Sectioned stages list their numbered sections; other stages list their items
  const contents = Object.fromEntries(STAGES.map(s => [s, []]))
  const sectionsOf = Object.fromEntries(STAGES.map(s => [s, stageSections(s, data)]))
  const listed = s => !sectionsOf[s]
  data.items.forEach(i => listed(i.stage) && contents[i.stage]?.push(`${i.title} (${i.kind === 'boq' ? 'BOQ / costing' : 'cable schedule'})`))
  data.reportLinks.forEach(({ stage, rec }) => listed(stage) && contents[stage]?.push(`${rec.title} (checklist / report)`))
  data.files.forEach(f => listed(f.stage) && contents[f.stage]?.push(`${f.file_name}${f.caption === 'Design pack' ? ' (design pack)' : ''}`))
  data.docLinks.forEach(({ stage, rec }) => listed(stage) && contents[stage]?.push(`${rec.title} (${rec.doc_type || 'library document'})`))
  STAGES.forEach(s => { if (sectionsOf[s]) contents[s] = sectionsOf[s] })

  // Downloads are reused by the ZIP and the merged PDF
  const cache = new Map()
  const get = (key, fn) => { if (!cache.has(key)) cache.set(key, fn().catch(e => { cache.delete(key); throw e })); return cache.get(key) }
  const fileOf = f => get(`f:${f.id}`, () => fileBlob('project-files', f.file_path))
  const docOf = d => get(`d:${d.id}`, () => libraryBlob(d))
  const itemData = async i => (i.data && Object.keys(i.data).length ? i.data : (await supabase.from('project_items').select('data').eq('id', i.id).single()).data?.data || {})

  let zipBlob = null
  if (wantZip) {
    const z = new JSZip()
    const used = new Set()
    const put = (path, blob) => {
      let pth = path, n = 1
      while (used.has(pth.toLowerCase())) { const m = path.match(/^(.*?)(\.[^./]+)?$/); pth = `${m[1]} (${++n})${m[2] || ''}` }
      used.add(pth.toLowerCase()); z.file(pth, blob)
    }
    onProgress('Building the project summary PDF…')
    try { put('00 Project summary.pdf', new Blob([await writeProjectPdf(PDFLib, p, data, { userName, contents, stages, title })])) } catch (e) { note('Project summary PDF', e) }
    if (data.tasks.some(t => stages.includes(t.stage))) { try { put('00 Checklist.xlsx', await checklistExcel(p, data, stages)) } catch (e) { note('Checklist Excel', e) } }
    for (const s of stages) {
      const dir = stageFolder(s)
      const secs = sectionsOf[s]
      if (secs) {
        // Sectioned stage: numbered folders/files that match the PDF sections
        for (const sec of secs) {
          const base = `${dir}/${sec.n} ${sec.title.replace(/^\d+\.\s*/, '')}`
          if (sec.key === 'report') {
            for (const { rec } of data.reportLinks.filter(x => x.stage === s)) {
              onProgress(`${s}: ${rec.title}…`)
              try { put(`${base}/${safe(rec.title)}.docx`, await htmlToDocx(rec.content_html, { title: rec.title, subtitle: [rec.site_name, rec.report_date ? fmtD(rec.report_date) : '', rec.status].filter(Boolean).join(' · ') })) } catch (e) { put(`${base}/${safe(rec.title)}.html`, new Blob([rec.content_html || ''], { type: 'text/html' })); note(`${rec.title} (saved as HTML)`, e) }
            }
          } else if (sec.key === 'photos') {
            let n = 0
            for (const f of data.files.filter(x => x.stage === s && isPhoto(x))) {
              n++
              onProgress(`${s}: photo ${n}…`)
              try { put(`${base}/Photo ${pad2(n)} - ${safe(photoCaption(f))}.${ext(f.file_name)}`, await fileOf(f)) } catch (e) { note(f.file_name, e) }
            }
          } else if (sec.key === 'notes') {
            const notes = data.stages[s].notes_html
            try { put(`${base}.docx`, await htmlToDocx(notes, { title: `${p.name} — ${s} notes`, subtitle: p.client || '' })) } catch (e) { put(`${base}.html`, new Blob([notes], { type: 'text/html' })); note(`${s} notes (saved as HTML)`, e) }
          } else if (sec.key === 'other') {
            for (const i of data.items.filter(x => x.stage === s)) {
              try { put(`${base}/${safe(i.title)}.xlsx`, i.kind === 'boq' ? await boqExcel(await itemData(i)) : await cableExcel(await itemData(i))) } catch (e) { note(i.title, e) }
            }
            for (const f of data.files.filter(x => x.stage === s && !isPhoto(x))) {
              try { put(`${base}/${safe(f.file_name)}`, await fileOf(f)) } catch (e) { note(f.file_name, e) }
            }
            for (const { rec } of data.docLinks.filter(x => x.stage === s)) {
              try { put(`${base}/${safe(rec.file_name || `${rec.title}.pdf`)}`, await docOf(rec)) } catch (e) { note(rec.title, e) }
            }
          }
          // the stage checklist is in 00 Checklist.xlsx
        }
        continue
      }
      const notes = data.stages[s]?.notes_html
      if (notes && notes.replace(/<[^>]+>/g, '').trim()) {
        onProgress(`${s}: notes…`)
        try { put(`${dir}/Notes.docx`, await htmlToDocx(notes, { title: `${p.name} — ${s} notes`, subtitle: p.client || '' })) } catch (e) { put(`${dir}/Notes.html`, new Blob([notes], { type: 'text/html' })); note(`${s} notes (saved as HTML)`, e) }
      }
      for (const i of data.items.filter(x => x.stage === s)) {
        onProgress(`${s}: ${i.title}…`)
        try { put(`${dir}/Engineering/${safe(i.title)}.xlsx`, i.kind === 'boq' ? await boqExcel(await itemData(i)) : await cableExcel(await itemData(i))) } catch (e) { note(i.title, e) }
      }
      for (const { rec } of data.reportLinks.filter(x => x.stage === s)) {
        onProgress(`${s}: ${rec.title}…`)
        try { put(`${dir}/Checklists & reports/${safe(rec.title)}.docx`, await htmlToDocx(rec.content_html, { title: rec.title, subtitle: [rec.site_name, rec.report_date ? fmtD(rec.report_date) : '', rec.status].filter(Boolean).join(' · ') })) } catch (e) { note(rec.title, e) }
      }
      for (const f of data.files.filter(x => x.stage === s)) {
        onProgress(`${s}: ${f.file_name}…`)
        try { put(`${dir}/${f.caption === 'Design pack' ? 'Design packs' : 'Files'}/${safe(f.file_name)}`, await fileOf(f)) } catch (e) { note(f.file_name, e) }
      }
      for (const { rec } of data.docLinks.filter(x => x.stage === s)) {
        onProgress(`${s}: ${rec.title}…`)
        try { put(`${dir}/Documents/${safe(rec.file_name || `${rec.title}.pdf`)}`, await docOf(rec)) } catch (e) { note(rec.title, e) }
      }
    }
    if (problems.length) put('00 Problems while compiling.txt', new Blob([problems.join('\r\n')], { type: 'text/plain' }))
    onProgress('Compressing the ZIP…')
    zipBlob = await z.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } }, m => onProgress(`Compressing the ZIP… ${Math.round(m.percent)}%`))
  }

  let pdfBlob = null
  if (wantPdf) {
    onProgress('Building the merged PDF…')
    const appendPdf = async (doc, blob, label, s, skipped) => {
      try {
        const src = await PDFLib.PDFDocument.load(await blob.arrayBuffer(), { ignoreEncryption: true })
        const pages = await doc.copyPages(src, src.getPageIndices())
        pages.forEach(pg => doc.addPage(pg))
      } catch (e) { skipped.push([s, label, 'PDF could not be read (encrypted or damaged)']) }
    }
    const attach = async (s, w, doc, skipped) => {
      for (const { rec } of data.reportLinks.filter(x => x.stage === s)) {
        onProgress(`PDF — ${s}: ${rec.title}…`)
        w.newPage(); w.heading(rec.title, 1)
        w.text([rec.template_name, rec.site_name, rec.report_date ? fmtD(rec.report_date) : '', rec.status].filter(Boolean).join(' · '), { color: MUTED, size: 9, gap: 10 })
        try { await w.html(rec.content_html, { form: true }) } catch (e) { w.text(`Could not render this report: ${e.message}`, { color: [0.8, 0.2, 0.2] }) }
      }
      for (const i of data.items.filter(x => x.stage === s)) {
        onProgress(`PDF — ${s}: ${i.title}…`)
        w.newPage(); w.heading(i.title, 1)
        try {
          const st = await itemData(i)
          if (i.kind === 'boq') await w.html(await boqHtml(st))
          else {
            const { acT, dcT } = await cableTables(st)
            w.heading('AC cable schedule', 2); acT.length > 1 ? w.table(acT, { size: 7.5 }) : w.text('No AC circuits.', { color: MUTED })
            w.heading('DC cable schedule', 2); dcT.length > 1 ? w.table(dcT, { size: 7.5 }) : w.text('No DC circuits.', { color: MUTED })
          }
        } catch (e) { w.text(`Could not render: ${e.message}`, { color: [0.8, 0.2, 0.2] }) }
      }
      const pdfFiles = data.files.filter(x => x.stage === s)
      for (const f of pdfFiles) {
        const e = ext(f.file_name)
        if (e === 'pdf') {
          onProgress(`PDF — ${s}: ${f.file_name}…`)
          try { await appendPdf(doc, await fileOf(f), f.file_name, s, skipped) } catch (err) { skipped.push([s, f.file_name, `download failed: ${err.message}`]) }
          w.page = null
        } else if (['jpg', 'jpeg', 'png'].includes(e)) {
          onProgress(`PDF — ${s}: ${f.file_name}…`)
          try {
            const bytes = await (await fileOf(f)).arrayBuffer()
            w.newPage(); w.heading(f.caption && f.caption !== 'Design pack' ? f.caption : 'Photo', 2)
            w.text([`${pad2(STAGES.indexOf(s) + 1)} ${s}`, f.file_name, fmtD(f.created_at), f.uploaded_by].filter(Boolean).join(' · '), { color: MUTED, size: 8.5, gap: 8 })
            await w.image(bytes, e === 'png' ? 'png' : 'jpg', 600)
          } catch (err) { skipped.push([s, f.file_name, 'image could not be added']) }
        } else skipped.push([s, f.file_name, `.${e || 'file'} cannot be shown in a PDF`])
      }
      for (const { rec } of data.docLinks.filter(x => x.stage === s)) {
        const name = rec.file_name || rec.file_url || ''
        if (ext(name) !== 'pdf') { skipped.push([s, rec.title, `.${ext(name) || 'file'} cannot be shown in a PDF`]); continue }
        onProgress(`PDF — ${s}: ${rec.title}…`)
        try { await appendPdf(doc, await docOf(rec), rec.title, s, skipped) } catch (err) { skipped.push([s, rec.title, `download failed: ${err.message}`]) }
        w.page = null
      }
    }
    // ── parts used by sectioned stages ──
    attach.reports = async (s, w, many) => {
      for (const { rec } of data.reportLinks.filter(x => x.stage === s)) {
        onProgress(`PDF — ${s}: ${rec.title}…`)
        if (many) w.heading(rec.title, 3)
        w.text([many ? '' : rec.title, rec.status ? `Status: ${rec.status}` : ''].filter(Boolean).join(' · '), { color: MUTED, size: 8.5, gap: 8 })
        try { await w.html(rec.content_html, { form: true }) } catch (e) { w.text(`Could not render this report: ${e.message}`, { color: [0.8, 0.2, 0.2] }) }
      }
    }
    attach.photos = async (s, w, skipped) => {
      let n = 0
      for (const f of data.files.filter(x => x.stage === s && isPhoto(x))) {
        n++
        onProgress(`PDF — ${s}: photo ${n}…`)
        try {
          const bytes = await (await fileOf(f)).arrayBuffer()
          await w.photo(bytes, ext(f.file_name) === 'png' ? 'png' : 'jpg', `Photo ${n} – ${photoCaption(f)}`, [fmtD(f.created_at), f.uploaded_by, photoCaption(f) !== f.file_name.replace(/\.[^.]+$/, '') ? f.file_name : ''].filter(Boolean).join(' · '))
        } catch (err) { skipped.push([s, f.file_name, 'image could not be added']) }
      }
    }
    attach.other = async (s, w, doc, skipped) => {
      for (const i of data.items.filter(x => x.stage === s)) {
        w.heading(i.title, 3)
        try {
          const st = await itemData(i)
          if (i.kind === 'boq') await w.html(await boqHtml(st))
          else { const { acT, dcT } = await cableTables(st); w.heading('AC cable schedule', 3); acT.length > 1 ? w.table(acT, { size: 7.5 }) : w.text('No AC circuits.', { color: MUTED }); w.heading('DC cable schedule', 3); dcT.length > 1 ? w.table(dcT, { size: 7.5 }) : w.text('No DC circuits.', { color: MUTED }) }
        } catch (e) { w.text(`Could not render: ${e.message}`, { color: [0.8, 0.2, 0.2] }) }
      }
      const list = [
        ...data.files.filter(x => x.stage === s && !isPhoto(x)).map(f => ({ name: f.file_name, label: f.caption && !SYSTEM_CAPTIONS.includes(f.caption) ? f.caption : f.file_name, get: () => fileOf(f) })),
        ...data.docLinks.filter(x => x.stage === s).map(({ rec }) => ({ name: rec.file_name || rec.file_url || '', label: rec.title, get: () => docOf(rec) })),
      ]
      if (list.length) w.table([['Document', 'Type', 'In this PDF']].concat(list.map(d => [d.label, (ext(d.name) || 'file').toUpperCase(), ext(d.name) === 'pdf' ? 'Follows this page' : 'ZIP only'])), { widths: [0.6, 0.15, 0.25], size: 8.5 })
      for (const d of list) {
        if (ext(d.name) !== 'pdf') { skipped.push([s, d.label, `.${ext(d.name) || 'file'} cannot be shown in a PDF`]); continue }
        onProgress(`PDF — ${s}: ${d.label}…`)
        try { await appendPdf(doc, await d.get(), d.label, s, skipped) } catch (err) { skipped.push([s, d.label, `download failed: ${err.message}`]) }
        w.page = null
      }
    }
    try {
      pdfBlob = new Blob([await writeProjectPdf(PDFLib, p, data, { userName, contents, attach, stages, title })], { type: 'application/pdf' })
    } catch (e) { note('Merged PDF', e) }
  }
  onProgress('Done')
  const base = `${safe(p.name)} - ${safe(title)} - ${new Date().toISOString().slice(0, 10)}`
  return { zipBlob, pdfBlob, zipName: `${base}.zip`, pdfName: `${base}.pdf`, problems }
}
