// Excel export for the Cable Sizing Calculator.
// Fills the company calculator workbook (public/templates/cable-sizing-template.xlsx — a copy of
// Electrical.xlsx with formulas un-shared) so the download has the same layout, formatting, logo,
// reference sheets and live formulas as the spreadsheet. Excel recalculates on open
// (fullCalcOnLoad); the web results are also written as cached values so previews show them.
import JSZip from 'jszip'

export const CABLE_TEMPLATE_URL = '/templates/cable-sizing-template.xlsx'

const FIRST_ROW = 12
const TEMPLATE_ROWS = 10 // rows 12–21 in the template

const AC_SHEET = 'xl/worksheets/sheet1.xml' // "Cables Sizes"
const DC_SHEET = 'xl/worksheets/sheet2.xml' // "DC Cable Sizes"
const AC_HELPER_COLS = colRange('AC', 'BC')
const DC_HELPER_COLS = colRange('U', 'AN')

// ── small helpers ──
function colToNum(c) { let n = 0; for (const ch of c) n = n * 26 + ch.charCodeAt(0) - 64; return n }
function numToCol(n) { let s = ''; while (n) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26) } return s }
function colRange(a, b) { const out = []; for (let i = colToNum(a); i <= colToNum(b); i++) out.push(numToCol(i)); return out }
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const isBlank = v => v === '' || v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v))
const numOrText = v => (isBlank(v) ? '' : typeof v === 'number' ? v : (v !== '' && !Number.isNaN(Number(v)) ? Number(v) : String(v)))

function dateSerial(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '')
  if (!m) return ''
  return (Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 86400000
}

const CELL_RE = ref => new RegExp(`<c r="${ref}"((?:\\s[^>/]*)?)(?:/>|>([\\s\\S]*?)</c>)`)

// Write a value into a cell, keeping its style. Formula cells keep the formula and only get a
// cached value, unless dropFormula is set.
function setCell(rowXml, ref, value, { dropFormula = false } = {}) {
  const re = CELL_RE(ref)
  const m = re.exec(rowXml)
  const attrs = m ? m[1] : ''
  const style = (/\ss="(\d+)"/.exec(attrs) || [])[0] || ''
  const cm = (/\scm="(\d+)"/.exec(attrs) || [])[0] || ''
  const inner = m ? (m[2] || '') : ''
  const f = !dropFormula && (/<f[\s>][\s\S]*?<\/f>|<f[^>]*\/>/.exec(inner) || [])[0]
  let xml
  if (f) {
    if (isBlank(value)) xml = `<c r="${ref}"${style} t="str"${cm}>${f}<v></v></c>`
    else if (typeof value === 'number') xml = `<c r="${ref}"${style}${cm}>${f}<v>${value}</v></c>`
    else if (typeof value === 'boolean') xml = `<c r="${ref}"${style} t="b"${cm}>${f}<v>${value ? 1 : 0}</v></c>`
    else xml = `<c r="${ref}"${style} t="str"${cm}>${f}<v>${esc(value)}</v></c>`
  } else if (isBlank(value)) xml = `<c r="${ref}"${style}/>`
  else if (typeof value === 'number') xml = `<c r="${ref}"${style}><v>${value}</v></c>`
  else xml = `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`

  if (m) return rowXml.replace(re, () => xml)
  // cell missing: insert in column order
  const col = colToNum(ref.replace(/\d+/g, ''))
  const cells = [...rowXml.matchAll(/<c r="([A-Z]+)\d+"/g)]
  const after = cells.find(c => colToNum(c[1]) > col)
  if (after) return rowXml.slice(0, after.index) + xml + rowXml.slice(after.index)
  return rowXml.replace(/<\/row>$/, `${xml}</row>`)
}

// Remove cached results from helper formula cells so nothing stale is shown before Excel recalculates
function stripCached(rowXml, cols, r) {
  for (const col of cols) {
    const re = CELL_RE(`${col}${r}`)
    rowXml = rowXml.replace(re, (all, attrs, inner) => {
      if (!inner || !/<f[\s>/]/.test(inner)) return all
      const a = attrs.replace(/\st="[^"]*"/, '')
      return `<c r="${col}${r}"${a}>${inner.replace(/<v>[\s\S]*?<\/v>|<v\/>/g, '')}</c>`
    })
  }
  return rowXml
}

function splitRows(sheetXml) {
  const start = sheetXml.indexOf('<sheetData>')
  const end = sheetXml.indexOf('</sheetData>')
  const body = sheetXml.slice(start + '<sheetData>'.length, end)
  const rows = []
  const re = /<row r="(\d+)"([^>]*?)(\/>|>([\s\S]*?)<\/row>)/g
  let m
  while ((m = re.exec(body))) rows.push({ r: +m[1], xml: m[0] })
  return { head: sheetXml.slice(0, start + '<sheetData>'.length), rows, tail: sheetXml.slice(end) }
}

// Re-number a template row (formulas, cell refs, array refs) to a new row number
function cloneRow(rowXml, from, to) {
  const re = new RegExp(`(?<![A-Za-z0-9_])(\\$?[A-Z]{1,3})${from}(?!\\d)`, 'g')
  return rowXml.replace(`<row r="${from}"`, `<row r="${to}"`).replace(re, `$1${to}`)
}
function shiftRow(rowXml, from, to) {
  return rowXml.replace(`<row r="${from}"`, `<row r="${to}"`).replace(new RegExp(`(r="[A-Z]{1,3})${from}"`, 'g'), `$1${to}"`)
}

// Make room for n circuit rows (template has 10) and return { xml, rows: Map(rowNo -> xml) }
function prepareRows(sheetXml, n) {
  const { head, rows, tail } = splitRows(sheetXml)
  const lastTpl = FIRST_ROW + TEMPLATE_ROWS - 1
  const extra = Math.max(0, n - TEMPLATE_ROWS)
  const proto = rows.find(x => x.r === lastTpl).xml
  const out = []
  for (const row of rows) {
    if (row.r <= lastTpl) out.push({ r: row.r, xml: row.xml })
    else out.push({ r: row.r + extra, xml: shiftRow(row.xml, row.r, row.r + extra) })
    if (row.r === lastTpl) for (let k = 1; k <= extra; k++) out.push({ r: lastTpl + k, xml: cloneRow(proto, lastTpl, lastTpl + k) })
  }
  out.sort((a, b) => a.r - b.r)
  let h = head, t = tail
  if (extra) {
    const last = lastTpl + extra
    // extend conditional formatting / data validation ranges and the used range
    const fixSqref = s => s.replace(new RegExp(`([A-Z]{1,3})${lastTpl}(?!\\d)`, 'g'), `$1${last}`)
    h = h.replace(/<dimension ref="([A-Z]+\d+):([A-Z]+)(\d+)"\/>/, (a, s, c, r) => `<dimension ref="${s}:${c}${+r + extra}"/>`)
    t = t.replace(/sqref="([^"]*)"/g, (a, s) => `sqref="${fixSqref(s)}"`)
  }
  return { head: h, tail: t, rows: out }
}

function joinRows({ head, tail, rows }) {
  return head + rows.map(r => r.xml).join('') + tail
}

function updateRows(prepared, fn) {
  for (const row of prepared.rows) {
    const next = fn(row.r, row.xml)
    if (next !== undefined) row.xml = next
  }
}

// ── public ──
export async function buildCableScheduleWorkbook(templateData, { project, ac, dc, acResults, dcResults }) {
  const zip = await JSZip.loadAsync(templateData)
  const p = project || {}
  const nameUpper = (p.name || 'Project Name').toUpperCase()

  // ── AC sheet ──
  let acXml = await zip.file(AC_SHEET).async('string')
  const nAc = Math.max(TEMPLATE_ROWS, ac.length)
  const acP = prepareRows(acXml, nAc)
  const hdr = [
    ['R1', p.name], ['X1', dateSerial(p.date)], ['R2', p.number], ['X2', p.revision], ['R3', p.docNumber], ['X3', p.designed],
    ['R4', p.address], ['X4', p.checked], ['R5', p.coordinates], ['X5', p.approved], ['R6', p.client], ['X6', p.revDescription],
  ]
  updateRows(acP, (r, xml) => {
    if (r === 1) xml = setCell(xml, 'D1', `${nameUpper}\nAC POWER CABLE SCHEDULE`)
    for (const [ref, v] of hdr) if (+ref.slice(1) === r) xml = setCell(xml, ref, typeof v === 'number' ? v : (v || ''))
    if (r < FIRST_ROW || r >= FIRST_ROW + nAc) return xml
    const i = r - FIRST_ROW
    const row = ac[i]
    const x = acResults[i] || { empty: true }
    xml = setCell(xml, `A${r}`, i + 1)
    const inp = row ? [
      ['B', numOrText(row.ib)], ['C', row.from || ''], ['D', row.to || ''], ['E', row.method || ''], ['F', numOrText(row.distance)],
      ['G', numOrText(row.voltage)], ['H', row.protection || ''], ['I', row.insulation || ''], ['J', row.conductor || ''], ['K', row.cores || ''],
      ['L', numOrText(row.derating)], ['M', row.spacing || ''], ['N', numOrText(row.faultKA)], ['O', numOrText(row.faultT)],
    ] : 'BCDEFGHIJKLMNO'.split('').map(c => [c, ''])
    for (const [c, v] of inp) xml = setCell(xml, `${c}${r}`, v)
    const sized = !x.empty && x.valid && x.size
    const out = x.empty ? {} : {
      P: sized ? x.runs : '',
      Q: !x.valid ? 'Check inputs' : (x.size ?? 'Single-core / busbar'),
      R: sized ? x.Cg : '',
      S: sized ? x.cccTotal : '',
      T: sized ? x.vdV : '',
      U: sized ? x.vdPct : '',
      V: !x.valid ? '' : (x.breaker ?? 'Exceeds range'),
      W: x.valid && x.breaker ? x.breakerType : '',
      X: x.valid && x.breaker ? x.ir : '',
      Y: sized ? x.earth : '',
      Z: sized ? (x.scChecked ? x.scWithstand : 'Not checked') : '',
      AA: x.status || '',
    }
    for (const c of ['P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'AA']) xml = setCell(xml, `${c}${r}`, out[c] ?? '')
    return stripCached(xml, AC_HELPER_COLS, r)
  })
  zip.file(AC_SHEET, joinRows(acP))

  // ── DC sheet ──
  let dcXml = await zip.file(DC_SHEET).async('string')
  const nDc = Math.max(TEMPLATE_ROWS, dc.length)
  const dcP = prepareRows(dcXml, nDc)
  updateRows(dcP, (r, xml) => {
    if (r === 1) xml = setCell(xml, 'D1', `${nameUpper}\nDC POWER CABLE SCHEDULE`)
    if (r >= 1 && r <= 6) {
      const left = [p.name, p.number, p.docNumber, p.address, p.coordinates, p.client][r - 1]
      const right = [dateSerial(p.date), p.revision, p.designed, p.checked, p.approved, p.revDescription][r - 1]
      xml = setCell(xml, `M${r}`, left || '')
      xml = setCell(xml, `R${r}`, typeof right === 'number' ? right : (right || ''))
    }
    if (r < FIRST_ROW || r >= FIRST_ROW + nDc) return xml
    const i = r - FIRST_ROW
    const row = dc[i]
    const x = dcResults[i] || { empty: true }
    xml = setCell(xml, `A${r}`, i + 1)
    const inp = row ? [
      ['B', row.type || ''], ['C', numOrText(row.current)], ['D', numOrText(row.strings)], ['E', row.method || ''], ['F', numOrText(row.distance)],
      ['G', numOrText(row.modules)], ['H', numOrText(row.vmp)], ['J', numOrText(row.derating)],
    ] : 'BCDEFGHJ'.split('').map(c => [c, ''])
    for (const [c, v] of inp) xml = setCell(xml, `${c}${r}`, v)
    xml = setCell(xml, `I${r}`, row ? numOrText(row.systemV) : '', { dropFormula: true })
    const sized = !x.empty && x.valid && x.size
    const G = row ? Number(row.modules) : NaN, H = row ? Number(row.vmp) : NaN
    const K = x.empty ? '' : (row.modules !== '' && row.vmp !== '' && Number.isFinite(G) && Number.isFinite(H) ? G * H : (Number.isFinite(Number(row.systemV)) && row.systemV !== '' ? Number(row.systemV) : 0))
    const out = x.empty ? {} : {
      K,
      L: x.valid ? x.ib : '',
      M: sized ? x.runs : '',
      N: !x.valid ? 'Check inputs' : (x.size ?? 'Exceeds range'),
      O: sized ? x.cccTotal : '',
      P: sized ? x.vdV : '',
      Q: sized ? x.vdPct : '',
      R: !x.valid ? '' : (x.prot ?? 'Exceeds range'),
      S: x.status || '',
    }
    for (const c of ['K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S']) xml = setCell(xml, `${c}${r}`, out[c] ?? '')
    return stripCached(xml, DC_HELPER_COLS, r)
  })
  zip.file(DC_SHEET, joinRows(dcP))

  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}
