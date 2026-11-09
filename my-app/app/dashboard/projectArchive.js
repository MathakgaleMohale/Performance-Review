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
const INK = [26 / 255, 42 / 255, 74 / 255]
const GREY = [0.42, 0.47, 0.55]
const LINE = [0.85, 0.88, 0.92]
const FILL = [0.88, 0.94, 0.97]

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
async function checklistExcel(p, data) {
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
  STAGES.forEach(s => data.tasks.filter(t => t.stage === s).sort((a, b) => a.sort - b.sort).forEach(t => {
    ws.addRow([s, t.done ? 'Yes' : 'No', t.title, t.assignee || '', t.due_date ? fmtD(t.due_date) : '', t.done_at ? fmtD(t.done_at) : ''])
  }))
  ws.autoFilter = { from: 'A3', to: 'F3' }
  return new Blob([await wb.xlsx.writeBuffer()])
}

// ── Simple PDF writer on top of pdf-lib (text, headings, tables, images) ──
class PdfWriter {
  constructor(PDFLib, doc, fonts, headerText) {
    Object.assign(this, { PDFLib, doc, fonts, headerText, W: 595.28, H: 841.89, M: 50, page: null, y: 0, charOk: new Map() })
  }
  rgb(c) { return this.PDFLib.rgb(c[0], c[1], c[2]) }
  clean(text, font) {
    const MAP = { '→': '->', '←': '<-', '✓': 'v', '✔': 'v', '☑': '[x]', '☐': '[ ]', '≤': '<=', '≥': '>=', ' ': ' ', '\t': '    ', '−': '-', 'Ω': 'Ohm', '²': '2', '³': '3' }
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
        // very long word: hard-break
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
  newPage() {
    this.page = this.doc.addPage([this.W, this.H])
    this.y = this.H - this.M
    if (this.headerText) {
      this.page.drawText(this.clean(this.headerText, this.fonts.reg), { x: this.M, y: this.H - 30, size: 8, font: this.fonts.reg, color: this.rgb(GREY) })
      this.page.drawLine({ start: { x: this.M, y: this.H - 36 }, end: { x: this.W - this.M, y: this.H - 36 }, thickness: 0.5, color: this.rgb(LINE) })
    }
  }
  ensure(h) { if (!this.page || this.y - h < this.M + 10) this.newPage() }
  text(t, { size = 10, font = this.fonts.reg, color = INK, indent = 0, gap = 4 } = {}) {
    const width = this.W - 2 * this.M - indent
    this.wrap(t, font, size, width).forEach(line => {
      this.ensure(size * 1.4)
      this.page.drawText(line, { x: this.M + indent, y: this.y - size, size, font, color: this.rgb(color) })
      this.y -= size * 1.4
    })
    this.y -= gap
  }
  heading(t, level = 1) {
    const size = level === 1 ? 17 : level === 2 ? 13 : 11
    this.ensure(size * 3)
    this.y -= level === 1 ? 4 : 6
    this.text(t, { size, font: this.fonts.bold, color: level <= 2 ? BLUE : INK, gap: level === 1 ? 6 : 3 })
    if (level === 1) { this.page.drawLine({ start: { x: this.M, y: this.y + 3 }, end: { x: this.W - this.M, y: this.y + 3 }, thickness: 1, color: this.rgb(BLUE) }); this.y -= 6 }
  }
  rule() { this.ensure(10); this.page.drawLine({ start: { x: this.M, y: this.y - 4 }, end: { x: this.W - this.M, y: this.y - 4 }, thickness: 0.5, color: this.rgb(LINE) }); this.y -= 10 }
  table(rows, { header = true, size = 8, widths } = {}) {
    if (!rows.length) return
    const n = Math.max(...rows.map(r => r.length))
    const total = this.W - 2 * this.M
    const w = widths ? widths.map(f => f * total) : Array(n).fill(total / n)
    const pad = 3
    const drawRow = (r, isHead) => {
      const cells = Array.from({ length: n }, (_, i) => this.wrap(r[i] ?? '', isHead ? this.fonts.bold : this.fonts.reg, size, w[i] - 2 * pad))
      const h = Math.max(...cells.map(c => c.length)) * size * 1.3 + 2 * pad
      return { cells, h }
    }
    const head = header ? drawRow(rows[0], true) : null
    const paint = ({ cells, h }, isHead) => {
      let x = this.M
      if (isHead) this.page.drawRectangle({ x: this.M, y: this.y - h, width: total, height: h, color: this.rgb(FILL) })
      cells.forEach((lines, i) => {
        lines.forEach((ln, j) => this.page.drawText(ln, { x: x + pad, y: this.y - pad - size - j * size * 1.3 + 1, size, font: isHead ? this.fonts.bold : this.fonts.reg, color: this.rgb(INK) }))
        x += w[i]
      })
      this.page.drawLine({ start: { x: this.M, y: this.y - h }, end: { x: this.M + total, y: this.y - h }, thickness: 0.4, color: this.rgb(LINE) })
      this.y -= h
    }
    if (head) { this.ensure(head.h + 20); paint(head, true) }
    rows.slice(header ? 1 : 0).forEach(r => {
      const row = drawRow(r, false)
      if (!this.page || this.y - row.h < this.M + 10) { this.newPage(); if (head) paint(head, true) }
      paint(row, false)
    })
    this.y -= 8
  }
  async image(bytes, kind, maxH = 420) {
    const img = kind === 'png' ? await this.doc.embedPng(bytes) : await this.doc.embedJpg(bytes)
    const maxW = this.W - 2 * this.M
    const s = Math.min(maxW / img.width, maxH / img.height, 1)
    const w = img.width * s, h = img.height * s
    this.ensure(h + 8)
    this.page.drawImage(img, { x: this.M, y: this.y - h, width: w, height: h })
    this.y -= h + 8
  }
  // Renders editor / report HTML: headings, paragraphs, lists, task lists, tables, images
  async html(html) {
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
        if (/^H[1-6]$/.test(tag)) { const t = txt(el); if (t) this.heading(t, Math.min(3, Number(tag[1]) + 1)); continue }
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
          const rows = Array.from(el.querySelectorAll('tr')).map(tr => Array.from(tr.children).map(c => txt(c)))
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
        if (tag === 'BLOCKQUOTE') { const t = txt(el); if (t) this.text(t, { indent: indent + 14, font: this.fonts.ital, color: GREY }); continue }
        if (tag === 'PRE') { const t = el.textContent; if (t) this.text(t, { indent, font: this.fonts.mono, size: 8 }); continue }
        const hasBlock = Array.from(el.children).some(c => BLOCK.test(c.tagName))
        if (hasBlock) { await walk(el, indent); continue }
        const t = txt(el)
        if (t) this.text(t, { indent, font: /^(STRONG|B)$/.test(tag) ? this.fonts.bold : this.fonts.reg })
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

function numberPages(PDFLib, doc, font, from = 1) {
  const pages = doc.getPages()
  pages.forEach((pg, i) => {
    if (i < from) return
    const { width } = pg.getSize()
    const t = `Page ${i + 1} of ${pages.length}`
    pg.drawText(t, { x: width - 50 - font.widthOfTextAtSize(t, 8), y: 22, size: 8, font, color: PDFLib.rgb(GREY[0], GREY[1], GREY[2]) })
  })
}

// Cover, contents, stage summary and (per stage) checklist + notes. When `attach` is
// given, each stage is followed by its attachments (merged PDF).
async function writeProjectPdf(PDFLib, p, data, { userName, contents, attach }) {
  const { doc, fonts } = await newPdf(PDFLib)
  const w = new PdfWriter(PDFLib, doc, fonts, `${p.name} — project archive`)
  // Cover
  w.page = doc.addPage([w.W, w.H]); w.y = w.H - 70
  try {
    const res = await fetch(LOGO_SRC)
    if (res.ok) { const img = await doc.embedPng(await res.arrayBuffer()); const s = 150 / img.width; w.page.drawImage(img, { x: w.M, y: w.y - img.height * s, width: 150, height: img.height * s }); w.y -= img.height * s + 60 }
  } catch (e) { w.y -= 40 }
  w.text('PROJECT ARCHIVE', { size: 11, font: fonts.bold, color: BLUE, gap: 8 })
  w.text(p.name, { size: 26, font: fonts.bold, gap: 14 })
  const facts = [
    ['Client', p.client], ['Site', p.site_name], ['Location', p.location],
    ['System', [p.capacity_kwp ? `${Number(p.capacity_kwp).toLocaleString()} kWp` : '', p.battery_kwh ? `${Number(p.battery_kwh).toLocaleString()} kWh BESS` : ''].filter(Boolean).join(' + ')],
    ['Contract', p.system_type], ['Project owner', p.owner], ['Status', `${p.status} — current stage: ${p.stage}`],
    ['Start → target handover', `${fmtD(p.start_date) || '—'} -> ${fmtD(p.target_date) || '—'}`],
    ['Compiled', `${fmtD(new Date().toISOString())}${userName ? ` by ${userName}` : ''}`],
  ].filter(r => r[1])
  w.table(facts, { header: false, size: 10, widths: [0.3, 0.7] })
  if (p.description) w.text(p.description, { color: GREY })
  // Stage summary + contents
  w.newPage()
  w.heading('Stage summary', 1)
  w.table([['Stage', 'Status', 'Completed', 'Tasks done']].concat(STAGES.map(s => {
    const t = data.tasks.filter(x => x.stage === s)
    return [`${pad2(STAGES.indexOf(s) + 1)} ${s}`, data.stages[s]?.status || 'Not started', data.stages[s]?.completed_at ? fmtD(data.stages[s].completed_at) : '', t.length ? `${t.filter(x => x.done).length} / ${t.length}` : '—']
  })), { widths: [0.38, 0.22, 0.2, 0.2], size: 9 })
  w.heading('Contents', 2)
  STAGES.forEach(s => {
    const list = contents[s] || []
    w.text(`${pad2(STAGES.indexOf(s) + 1)} ${s}`, { font: fonts.bold, gap: 1 })
    if (!list.length) w.text('Checklist and notes only', { indent: 12, color: GREY, size: 9 })
    list.forEach(c => w.text(`•  ${c}`, { indent: 12, size: 9, gap: 0 }))
    w.y -= 4
  })
  // Stages
  const skipped = []
  for (const s of STAGES) {
    const st = data.stages[s]
    const hasContent = data.tasks.some(t => t.stage === s) || (st?.notes_html || '').replace(/<[^>]+>/g, '').trim() || (attach && (contents[s] || []).length)
    // empty stages share a page instead of using one each
    if (hasContent || !w.page || w.y < w.H / 3) w.newPage(); else w.y -= 14
    w.heading(`${pad2(STAGES.indexOf(s) + 1)}  ${s}`, 1)
    w.text(`Status: ${st?.status || 'Not started'}${st?.completed_at ? ` (completed ${fmtD(st.completed_at)})` : ''}`, { color: GREY, size: 9 })
    const tasks = data.tasks.filter(t => t.stage === s).sort((a, b) => a.sort - b.sort)
    if (tasks.length) {
      w.heading('Checklist', 2)
      w.table([['', 'Task', 'Assignee', 'Due', 'Done on']].concat(tasks.map(t => [t.done ? '[x]' : '[ ]', t.title, t.assignee || '', t.due_date ? fmtD(t.due_date) : '', t.done_at ? fmtD(t.done_at) : ''])), { widths: [0.06, 0.5, 0.17, 0.13, 0.14], size: 8.5 })
    }
    const notes = st?.notes_html
    if (notes && notes.replace(/<[^>]+>/g, '').trim()) { w.heading('Notes', 2); await w.html(notes) }
    if (attach) await attach(s, w, doc, skipped)
  }
  if (attach && skipped.length) {
    w.newPage()
    w.heading('Not included in this PDF', 1)
    w.text('These files cannot be shown inside a PDF. They are in the ZIP archive in their original format.', { color: GREY })
    w.table([['Stage', 'File', 'Reason']].concat(skipped), { widths: [0.2, 0.5, 0.3], size: 8.5 })
  }
  numberPages(PDFLib, doc, fonts.reg, 1)
  return doc.save()
}

// ── Public entry point ──
export async function buildProjectArchive(p, { zip: wantZip = true, pdf: wantPdf = true, userName = '', onProgress = () => {} } = {}) {
  const problems = []
  const note = (where, e) => problems.push(`${where}: ${e?.message || e}`)
  onProgress('Loading libraries…')
  const [JSZip, PDFLib] = await Promise.all([wantZip ? loadScript(CDN_JSZIP, 'JSZip') : null, loadScript(CDN_PDFLIB, 'PDFLib')])
  onProgress('Collecting project data…')
  const data = await gather(p)

  // Plan the contents (used for the contents page and the ZIP)
  const contents = Object.fromEntries(STAGES.map(s => [s, []]))
  data.items.forEach(i => contents[i.stage]?.push(`${i.title} (${i.kind === 'boq' ? 'BOQ / costing' : 'cable schedule'})`))
  data.reportLinks.forEach(({ stage, rec }) => contents[stage]?.push(`${rec.title} (checklist / report)`))
  data.files.forEach(f => contents[f.stage]?.push(`${f.file_name}${f.caption === 'Design pack' ? ' (design pack)' : ''}`))
  data.docLinks.forEach(({ stage, rec }) => contents[stage]?.push(`${rec.title} (${rec.doc_type || 'library document'})`))

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
    try { put('00 Project summary.pdf', new Blob([await writeProjectPdf(PDFLib, p, data, { userName, contents })])) } catch (e) { note('Project summary PDF', e) }
    try { put('00 Checklist.xlsx', await checklistExcel(p, data)) } catch (e) { note('Checklist Excel', e) }
    for (const s of STAGES) {
      const dir = stageFolder(s)
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
        w.text([rec.template_name, rec.site_name, rec.report_date ? fmtD(rec.report_date) : '', rec.status].filter(Boolean).join(' · '), { color: GREY, size: 9 })
        try { await w.html(rec.content_html) } catch (e) { w.text(`Could not render this report: ${e.message}`, { color: [0.8, 0.2, 0.2] }) }
      }
      for (const i of data.items.filter(x => x.stage === s)) {
        onProgress(`PDF — ${s}: ${i.title}…`)
        w.newPage(); w.heading(i.title, 1)
        try {
          const st = await itemData(i)
          if (i.kind === 'boq') await w.html(await boqHtml(st))
          else {
            const { acT, dcT } = await cableTables(st)
            w.heading('AC cable schedule', 2); acT.length > 1 ? w.table(acT, { size: 7.5 }) : w.text('No AC circuits.', { color: GREY })
            w.heading('DC cable schedule', 2); dcT.length > 1 ? w.table(dcT, { size: 7.5 }) : w.text('No DC circuits.', { color: GREY })
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
            w.newPage(); w.heading(f.file_name, 3)
            await w.image(bytes, e === 'png' ? 'png' : 'jpg', 640)
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
    try {
      pdfBlob = new Blob([await writeProjectPdf(PDFLib, p, data, { userName, contents, attach })], { type: 'application/pdf' })
    } catch (e) { note('Merged PDF', e) }
  }
  onProgress('Done')
  const base = `${safe(p.name)} - Project archive - ${new Date().toISOString().slice(0, 10)}`
  return { zipBlob, pdfBlob, zipName: `${base}.zip`, pdfName: `${base}.pdf`, problems }
}
