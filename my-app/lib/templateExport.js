// ─────────────────────────────────────────────────────────────────────────────
// Engineering template documents → Word (.docx), Excel (.xlsx) and PDF (print)
// Input is the editor's JSON (TipTap / ProseMirror document).
// Styling follows the Sosimple Brand Guide v2 (see project doc sosimple-document-styling.md).
// ─────────────────────────────────────────────────────────────────────────────

export const BRAND = {
  blue: '0B74D7', green: '97CA46', yellow: 'FFE82C', grey: '505050', lightGrey: 'AFAFAF',
  labelFill: 'E1EFF6', lightGreen: 'D9EBC5', font: 'Arial',
}
const LOGO_SRC = '/sosimple-logo.png.png'

const textOf = node => (node.text || '') + (node.content || []).map(textOf).join('')
const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
export const safeFileName = s => (s || 'Document').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Document'

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}

async function fetchImage(src) {
  try {
    const res = await fetch(src)
    if (!res.ok) return null
    const blob = await res.blob()
    const buf = await blob.arrayBuffer()
    const dims = await new Promise(resolve => {
      const img = new Image()
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
      img.onerror = () => resolve({ w: 600, h: 400 })
      img.src = URL.createObjectURL(blob)
    })
    const type = /png/i.test(blob.type) ? 'png' : /gif/i.test(blob.type) ? 'gif' : /bmp/i.test(blob.type) ? 'bmp' : 'jpg'
    return { data: buf, type, ...dims }
  } catch (e) { return null }
}

// ── WORD ─────────────────────────────────────────────────────────────────────
export async function exportDocx(docJson, meta = {}) {
  const d = await import('docx')
  const {
    Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell,
    WidthType, ShadingType, BorderStyle, ImageRun, Header, Footer, PageNumber, LevelFormat,
  } = d

  const imgCache = new Map()
  const getImg = async src => { if (!imgCache.has(src)) imgCache.set(src, await fetchImage(src)); return imgCache.get(src) }
  const align = a => ({ center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED }[a] || undefined)
  let olInstance = 0

  function runs(nodes = [], base = {}) {
    const out = []
    for (const n of nodes) {
      if (n.type === 'hardBreak') { out.push(new TextRun({ text: '', break: 1 })); continue }
      if (n.type !== 'text') continue
      const m = Object.fromEntries((n.marks || []).map(x => [x.type, x.attrs || true]))
      out.push(new TextRun({
        text: n.text, bold: !!m.bold || base.bold, italics: !!m.italic, underline: m.underline ? {} : undefined,
        strike: !!m.strike, highlight: m.highlight ? 'yellow' : undefined, color: base.color, size: base.size, font: BRAND.font,
      }))
    }
    return out
  }

  async function blocks(nodes = [], ctx = {}) {
    const out = []
    for (const n of nodes) out.push(...await block(n, ctx))
    return out
  }

  async function block(n, ctx) {
    switch (n.type) {
      case 'paragraph': {
        const children = runs(n.content, ctx.header ? { bold: true, color: BRAND.grey } : {})
        if (ctx.prefix) children.unshift(new TextRun({ text: ctx.prefix, font: BRAND.font }))
        return [new Paragraph({
          children, alignment: align(n.attrs?.textAlign), spacing: { after: ctx.inTable ? 0 : 120 },
          bullet: ctx.bullet != null ? { level: ctx.bullet } : undefined,
          numbering: ctx.ol ? { reference: 'sos-ol', level: ctx.ol.level, instance: ctx.ol.instance } : undefined,
        })]
      }
      case 'heading': {
        const lvl = n.attrs?.level || 1
        return [new Paragraph({
          heading: [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][Math.min(lvl, 3) - 1],
          alignment: align(n.attrs?.textAlign), children: runs(n.content),
        })]
      }
      case 'bulletList': {
        const out = []
        for (const li of n.content || []) out.push(...await blocks(li.content, { ...ctx, bullet: (ctx.listLevel || 0), listLevel: (ctx.listLevel || 0) + 1, ol: null }))
        return out
      }
      case 'orderedList': {
        const inst = ++olInstance
        const out = []
        for (const li of n.content || []) out.push(...await blocks(li.content, { ...ctx, bullet: null, ol: { level: ctx.listLevel || 0, instance: inst }, listLevel: (ctx.listLevel || 0) + 1 }))
        return out
      }
      case 'taskList': {
        const out = []
        for (const ti of n.content || []) {
          const [first, ...rest] = ti.content || []
          out.push(...await block(first || { type: 'paragraph' }, { ...ctx, prefix: ti.attrs?.checked ? '☑ ' : '☐ ' }))
          out.push(...await blocks(rest, ctx))
        }
        return out
      }
      case 'blockquote': return blocks(n.content, ctx)
      case 'horizontalRule':
        return [new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: BRAND.lightGrey, space: 1 } } })]
      case 'image': {
        const img = await getImg(n.attrs?.src)
        if (!img) return [new Paragraph({ children: [new TextRun({ text: '[image]', italics: true })] })]
        const maxW = ctx.inTable ? 280 : 600
        const scale = Math.min(1, maxW / img.w)
        return [new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ type: img.type, data: img.data, transformation: { width: Math.round(img.w * scale), height: Math.round(img.h * scale) } })] })]
      }
      case 'table': {
        const rows = n.content || []
        const ncol = Math.max(1, ...rows.map(r => (r.content || []).reduce((s, c) => s + (c.attrs?.colspan || 1), 0)))
        const widths = (rows[0]?.content || []).flatMap(c => c.attrs?.colwidth || Array(c.attrs?.colspan || 1).fill(null))
        const known = widths.filter(Boolean)
        const total = 9600 // twips ≈ A4 text width
        const colW = Array.from({ length: ncol }, (_, i) => {
          if (!known.length) return Math.floor(total / ncol)
          const sum = widths.reduce((s, w) => s + (w || 120), 0)
          return Math.floor(total * ((widths[i] || 120) / sum))
        })
        const tRows = []
        for (const r of rows) {
          const cells = []
          let ci = 0
          for (const c of r.content || []) {
            const span = c.attrs?.colspan || 1
            const isHead = c.type === 'tableHeader'
            const kids = await blocks(c.content, { inTable: true, header: isHead })
            cells.push(new TableCell({
              children: kids.length ? kids : [new Paragraph('')], columnSpan: span > 1 ? span : undefined,
              rowSpan: (c.attrs?.rowspan || 1) > 1 ? c.attrs.rowspan : undefined,
              width: { size: colW.slice(ci, ci + span).reduce((a, b) => a + b, 0), type: WidthType.DXA },
              shading: isHead ? { type: ShadingType.CLEAR, color: 'auto', fill: BRAND.labelFill } : undefined,
              margins: { top: 60, bottom: 60, left: 100, right: 100 },
            }))
            ci += span
          }
          tRows.push(new TableRow({ children: cells, tableHeader: (r.content || []).every(c => c.type === 'tableHeader') }))
        }
        const b = { style: BorderStyle.SINGLE, size: 4, color: BRAND.lightGrey }
        return [new Table({
          rows: tRows, width: { size: total, type: WidthType.DXA }, columnWidths: colW,
          borders: { top: b, bottom: b, left: b, right: b, insideHorizontal: b, insideVertical: b },
        }), new Paragraph({ spacing: { after: 120 } })]
      }
      default:
        return n.content ? blocks(n.content, ctx) : []
    }
  }

  const body = await blocks(docJson?.content || [])
  const logo = await getImg(LOGO_SRC)
  const headerKids = []
  if (logo) headerKids.push(new ImageRun({ type: logo.type, data: logo.data, transformation: { width: 110, height: Math.round(110 * logo.h / logo.w) } }))
  headerKids.push(new TextRun({ text: `\t${meta.title || ''}`, color: BRAND.grey, size: 16, font: BRAND.font }))

  const doc = new Document({
    creator: 'Sosimple Energy Portal', title: meta.title || 'Document',
    styles: {
      default: { document: { run: { font: BRAND.font, size: 20, color: BRAND.grey } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 36, bold: true, color: BRAND.blue, font: BRAND.font }, paragraph: { spacing: { before: 240, after: 160 } } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 26, bold: true, color: BRAND.blue, font: BRAND.font }, paragraph: { spacing: { before: 280, after: 120 } } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 22, bold: true, color: '3F6B12', font: BRAND.font }, paragraph: { spacing: { before: 200, after: 80 } } },
      ],
    },
    numbering: {
      config: [{
        reference: 'sos-ol',
        levels: [0, 1, 2].map(level => ({ level, format: LevelFormat.DECIMAL, text: `%${level + 1}.`, alignment: AlignmentType.START, style: { paragraph: { indent: { left: 400 + level * 360, hanging: 300 } } } })),
      }],
    },
    sections: [{
      properties: { page: { margin: { top: 1200, bottom: 1000, left: 1100, right: 1100 } } },
      headers: { default: new Header({ children: [new Paragraph({ children: headerKids, tabStops: [{ type: 'right', position: 9600 }], border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: BRAND.green, space: 4 } } })] }) },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            tabStops: [{ type: 'right', position: 9600 }],
            children: [
              new TextRun({ text: 'Sosimple Energy · Cheap energy. Clean business.', size: 14, color: BRAND.grey, font: BRAND.font }),
              new TextRun({ children: ['\tPage ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], size: 14, color: BRAND.grey, font: BRAND.font }),
            ],
          })],
        }),
      },
      children: body,
    }],
  })
  const blob = await Packer.toBlob(doc)
  saveBlob(blob, `${safeFileName(meta.fileName || meta.title)}.docx`)
}

// ── EXCEL ────────────────────────────────────────────────────────────────────
export async function exportXlsx(docJson, meta = {}) {
  const ExcelJS = (await import('exceljs/dist/exceljs.min.js')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Sosimple Energy Portal'
  const ws = wb.addWorksheet('Document', {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 } },
    headerFooter: { oddFooter: '&L&8Sosimple Energy&C&8Page &P of &N&R&8' + (meta.title || '').replace(/&/g, '&&') },
    views: [{ showGridLines: false }],
  })
  // number of columns = widest table (min 4)
  const tables = []
  const walk = n => { if (n.type === 'table') tables.push(n); (n.content || []).forEach(walk) }
  walk(docJson || {})
  const ncol = Math.max(4, ...tables.map(t => Math.max(...(t.content || []).map(r => (r.content || []).reduce((s, c) => s + (c.attrs?.colspan || 1), 0)))))
  ws.columns = Array.from({ length: ncol }, (_, i) => ({ width: i === 0 ? 46 : Math.max(14, Math.round(70 / (ncol - 1))) }))
  const thin = { style: 'thin', color: { argb: 'FF' + BRAND.lightGrey } }
  const border = { top: thin, left: thin, bottom: thin, right: thin }
  let r = 1

  // title band
  try {
    const res = await fetch(LOGO_SRC)
    if (res.ok) {
      const id = wb.addImage({ buffer: await res.arrayBuffer(), extension: 'png' })
      ws.addImage(id, { tl: { col: 0.1, row: 0.2 }, ext: { width: 140, height: 55 }, editAs: 'oneCell' })
    }
  } catch (e) { /* no logo */ }
  ws.getRow(1).height = 24; ws.getRow(2).height = 24
  ws.mergeCells(1, 2, 2, ncol)
  const t = ws.getCell(1, 2)
  t.value = meta.title || ''
  t.font = { bold: true, size: 14, color: { argb: 'FF' + BRAND.blue } }
  t.alignment = { horizontal: 'right', vertical: 'middle', wrapText: true }
  ws.mergeCells(3, 1, 3, ncol)
  ws.getCell(3, 1).border = { bottom: { style: 'thick', color: { argb: 'FF' + BRAND.green } } }
  ws.getRow(3).height = 6
  r = 5

  const inline = n => textOf(n)
  const cellText = c => (c.content || []).map(b => {
    if (b.type === 'taskList') return (b.content || []).map(ti => `${ti.attrs?.checked ? '☑' : '☐'} ${textOf(ti)}`).join('\n')
    if (b.type === 'bulletList' || b.type === 'orderedList') return (b.content || []).map((li, i) => `${b.type === 'orderedList' ? `${i + 1}.` : '•'} ${textOf(li)}`).join('\n')
    return inline(b)
  }).join('\n').trim()
  const textRow = (text, style = {}) => {
    ws.mergeCells(r, 1, r, ncol)
    const c = ws.getCell(r, 1)
    c.value = text
    c.font = { size: style.size || 10, bold: !!style.bold, color: { argb: 'FF' + (style.color || BRAND.grey) } }
    c.alignment = { wrapText: true, vertical: 'top' }
    const lines = Math.max(1, Math.ceil(String(text).length / 120) + (String(text).match(/\n/g) || []).length)
    ws.getRow(r).height = Math.max(15, lines * 14)
    r++
  }

  function walkBlocks(nodes, depth = 0) {
    for (const n of nodes || []) {
      if (n.type === 'heading') { if (r > 5) r++; textRow(inline(n), { bold: true, size: n.attrs?.level === 1 ? 14 : 12, color: BRAND.blue }) }
      else if (n.type === 'paragraph') { const tx = inline(n); if (tx.trim()) textRow(tx) }
      else if (n.type === 'bulletList' || n.type === 'orderedList') (n.content || []).forEach((li, i) => textRow(`${'   '.repeat(depth)}${n.type === 'orderedList' ? `${i + 1}.` : '•'} ${textOf(li)}`))
      else if (n.type === 'taskList') (n.content || []).forEach(ti => textRow(`${ti.attrs?.checked ? '☑' : '☐'} ${textOf(ti)}`))
      else if (n.type === 'table') {
        for (const row of n.content || []) {
          let ci = 1
          let maxLines = 1
          for (const c of row.content || []) {
            const span = c.attrs?.colspan || 1
            if (span > 1) ws.mergeCells(r, ci, r, Math.min(ncol, ci + span - 1))
            const cell = ws.getCell(r, ci)
            const tx = cellText(c)
            cell.value = tx
            const head = c.type === 'tableHeader'
            cell.font = { size: 10, bold: head, color: { argb: 'FF' + BRAND.grey } }
            if (head) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + BRAND.labelFill } }
            cell.alignment = { wrapText: true, vertical: 'top' }
            for (let k = ci; k < ci + span && k <= ncol; k++) ws.getCell(r, k).border = border
            const width = ws.getColumn(ci).width * span
            maxLines = Math.max(maxLines, Math.ceil(tx.length / Math.max(8, width * 1.1)) + (tx.match(/\n/g) || []).length)
            ci += span
          }
          ws.getRow(r).height = Math.max(16, maxLines * 14)
          r++
        }
        r++
      } else if (n.type === 'image') { textRow('[image – see Word/PDF version]', { color: BRAND.lightGrey }) }
      else if (n.content) walkBlocks(n.content, depth + 1)
    }
  }
  walkBlocks(docJson?.content || [])
  ws.pageSetup.printArea = `A1:${String.fromCharCode(64 + ncol)}${r}`
  const buf = await wb.xlsx.writeBuffer()
  saveBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${safeFileName(meta.fileName || meta.title)}.xlsx`)
}

// ── PDF (browser print → Save as PDF) ────────────────────────────────────────
export const DOC_CONTENT_CSS = `
.sos-doc { font-family: Axiforma, Avenir, 'Avenir Next', 'Segoe UI', Arial, sans-serif; color: #505050; font-size: 13px; line-height: 1.5; }
.sos-doc h1 { color: #0B74D7; font-size: 26px; font-weight: 800; margin: 18px 0 10px; text-transform: uppercase; letter-spacing: 0.3px; }
.sos-doc h2 { color: #0B74D7; font-size: 17px; font-weight: 800; margin: 22px 0 8px; text-transform: uppercase; }
.sos-doc h3 { color: #3F6B12; font-size: 14px; font-weight: 800; margin: 16px 0 6px; }
.sos-doc p { margin: 0 0 8px; }
.sos-doc table { border-collapse: collapse; width: 100%; margin: 6px 0 14px; table-layout: fixed; }
.sos-doc td, .sos-doc th { border: 1px solid #AFAFAF; padding: 5px 7px; vertical-align: top; min-width: 40px; position: relative; }
.sos-doc th { background: #E1EFF6; font-weight: 700; text-align: left; color: #505050; }
.sos-doc td p, .sos-doc th p { margin: 0; }
.sos-doc img { max-width: 100%; height: auto; }
.sos-doc ul[data-type="taskList"] { list-style: none; padding-left: 2px; margin: 0; }
.sos-doc ul[data-type="taskList"] li { display: flex; gap: 6px; align-items: flex-start; }
.sos-doc ul[data-type="taskList"] li > label { flex: 0 0 auto; margin-top: 2px; }
.sos-doc ul[data-type="taskList"] li > div { flex: 1 1 auto; }
.sos-doc ul[data-type="taskList"] input[type=checkbox] { accent-color: #0B74D7; width: 15px; height: 15px; }
.sos-doc hr { border: none; border-top: 1px solid #AFAFAF; margin: 14px 0; }
.sos-doc mark { background: #FAF5AF; }
.sos-doc blockquote { border-left: 4px solid #97CA46; margin: 8px 0; padding: 2px 12px; color: #505050; }
`

export function printPdf(html, meta = {}) {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' })
  document.body.appendChild(iframe)
  const d = iframe.contentDocument
  const printable = html || ''
  d.open()
  d.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(safeFileName(meta.fileName || meta.title))}</title>
<base href="${window.location.origin}/"><style>
@page { size: A4 portrait; margin: 14mm 14mm 16mm 10mm; }
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
body { margin: 0; }
${DOC_CONTENT_CSS}
.sos-doc { font-size: 11px; }
.sos-doc h1 { font-size: 22px; } .sos-doc h2 { font-size: 14px; } .sos-doc h3 { font-size: 12px; }
.sos-doc tr, .sos-doc img { break-inside: avoid; page-break-inside: avoid; }
.sos-doc h1, .sos-doc h2, .sos-doc h3 { break-after: avoid; page-break-after: avoid; }
.stripe { position: fixed; left: 0; top: 0; bottom: 0; width: 3.5mm; background: linear-gradient(#0B74D7 0 34%, #97CA46 34% 67%, #FFE82C 67% 100%); }
.head, .sos-doc { margin-left: 9mm; }
.head { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #97CA46; padding-bottom: 6px; margin-bottom: 10px; }
.head img { height: 34px; }
.head .t { text-align: right; font-family: Axiforma, Avenir, Arial, sans-serif; color: #505050; font-size: 10px; line-height: 1.4; }
.head .t b { color: #0B74D7; font-size: 12px; }
input[type=checkbox] { pointer-events: none; }
</style></head><body>
<div class="stripe"></div>
<div class="head"><img src="${LOGO_SRC}"><div class="t"><b>${escapeHtml(meta.title || '')}</b>${meta.subtitle ? `<br>${escapeHtml(meta.subtitle)}` : ''}</div></div>
<div class="sos-doc">${printable}</div>
</body></html>`)
  d.close()
  const go = () => {
    const prev = document.title
    document.title = safeFileName(meta.fileName || meta.title)
    iframe.contentWindow.focus()
    iframe.contentWindow.print()
    setTimeout(() => { document.title = prev; iframe.remove() }, 1500)
  }
  const imgs = Array.from(d.images)
  Promise.all(imgs.map(img => (img.complete ? null : new Promise(r => { img.onload = r; img.onerror = r })))).then(go)
}
