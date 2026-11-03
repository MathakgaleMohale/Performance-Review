#!/usr/bin/env node
/*
 * Sosimple Energy – Data.xlsx → Supabase sync
 * ------------------------------------------------------------------------
 * Watches Data.xlsx and, every time it is saved, pushes the sheets into Supabase:
 *
 *   Sheet "site_tech_info" → table sites               (key: name)
 *   Sheet "performance"    → table performance         (key: site_name, month, year)
 *   Sheet "Comments"       → table performance         (comment columns, same key)
 *   Sheet "OG"             → table offtake_guarantees  (key: site_name)
 *
 * The column mapping is the same as the CSV uploads in the dashboard, so the
 * data looks identical on the website. Only rows that changed since the last
 * sync are sent. The website's live refresh then picks the changes up.
 *
 * Usage
 *   node data-sync.js            watch Data.xlsx and sync on every save
 *   node data-sync.js --once     sync once and exit
 *   node data-sync.js --dry-run  read the workbook and show what would be sent (no upload)
 *   node data-sync.js --full     ignore the change cache and resend every row
 *
 * Settings are read from %USERPROFILE%\\.sosimple-sync.env, or sync/.env (see .env.example).
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const XLSX = require('xlsx')

const ARGS = new Set(process.argv.slice(2))
const DRY = ARGS.has('--dry-run')
const ONCE = ARGS.has('--once') || DRY
const FULL = ARGS.has('--full')

// ── settings ─────────────────────────────────────────────────────────────────
function loadEnv(file) {
  const out = {}
  if (!fs.existsSync(file)) return out
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    out[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '').trim()
  }
  return out
}
// Keys are best kept OUTSIDE the shared OneDrive folder: %USERPROFILE%\.sosimple-sync.env
// (falls back to sync/.env). The first file found is used.
const os = require('os')
const ENV_FILE = [process.env.SYNC_ENV_FILE, path.join(os.homedir(), '.sosimple-sync.env'), path.join(__dirname, '.env')]
  .find(f => f && fs.existsSync(f))
const ENV = { ...(ENV_FILE ? loadEnv(ENV_FILE) : {}), ...process.env }
const DATA_FILE = path.resolve(__dirname, ENV.DATA_FILE || '../Data.xlsx')
const STATE_FILE = path.join(__dirname, '.sync-state.json')
const LOG_FILE = path.join(__dirname, 'sync.log')
const DEBOUNCE_MS = Number(ENV.DEBOUNCE_SECONDS || 5) * 1000
const POLL_MS = Number(ENV.POLL_SECONDS || 60) * 1000

function log(msg) {
  const line = `[${new Date().toLocaleString('en-ZA')}] ${msg}`
  console.log(line)
  try {
    fs.appendFileSync(LOG_FILE, line + '\n')
    const st = fs.statSync(LOG_FILE)
    if (st.size > 2 * 1024 * 1024) fs.renameSync(LOG_FILE, LOG_FILE + '.old')
  } catch (e) { /* ignore */ }
}

// ── cell helpers (same rules as the dashboard CSV import) ────────────────────
const MONTH_MAP = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 }
const isBlankStr = s => s === '' || s.toLowerCase() === 'null' || s === 'N/A' || s.toLowerCase() === 'n/a'

function text(c) {
  if (!c || c.v == null) return ''
  if (c.t === 's' || c.t === 'str') return String(c.v)
  if (c.t === 'b') return c.v ? 'TRUE' : 'FALSE'
  if (c.w != null) return String(c.w)
  return String(c.v)
}
function cleanStr(c) { const v = text(c).trim(); return isBlankStr(v) ? null : v }
function rawStr(c) { const v = text(c).replace(/\r\n?/g, '\n').trim(); return v === '' ? null : v }
function num(c) {
  if (!c || c.v == null) return null
  if (c.t === 'n') {
    if (!Number.isFinite(c.v)) return null
    // a cell formatted as % shows 77.0% → store 77.0 (what the CSV export gave)
    return c.z && String(c.z).includes('%') ? c.v * 100 : c.v
  }
  if (c.t === 'e') return null
  const v = String(c.v).trim().replace('%', '').replace(/\s/g, '').replace(',', '.')
  if (!v || isBlankStr(v)) return null
  const n = parseFloat(v)
  return Number.isNaN(n) ? null : n
}
function dateParts(c) {
  if (!c || c.v == null || c.v === '') return null
  if (c.t === 'n') {
    const d = XLSX.SSF.parse_date_code(c.v)
    return d && d.y ? { y: d.y, m: d.m, d: d.d } : null
  }
  if (c.t === 'd' && c.v instanceof Date) return { y: c.v.getFullYear(), m: c.v.getMonth() + 1, d: c.v.getDate() }
  const s = String(c.v).trim()
  // "Jan-24" / "Sept-2024"
  const my = s.split('-')
  if (my.length === 2 && MONTH_MAP[my[0].toLowerCase()]) {
    const y = my[1].length === 2 ? 2000 + parseInt(my[1], 10) : parseInt(my[1], 10)
    return y ? { y, m: MONTH_MAP[my[0].toLowerCase()], d: 1 } : null
  }
  // DD/MM/YYYY or YYYY/MM/DD
  const p = s.split(/[/\-.]/).map(x => x.trim()).filter(Boolean)
  if (p.length !== 3) return null
  let y, m, d
  if (p[0].length === 4) { y = +p[0]; m = +p[1]; d = +p[2] } else { d = +p[0]; m = +p[1]; y = +p[2]; if (p[2].length === 2) y = 2000 + y }
  if (m > 12 && d <= 12) { const t = m; m = d; d = t }
  if (!y || m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null
  return { y, m, d }
}
function isoDate(c) {
  const p = dateParts(c)
  if (!p || p.y < 1990 || p.y > 2100) return null
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`
}

// Reads a sheet into { headers, rows: [[cell,...]] } using the real cell objects
function readSheet(wb, name) {
  const wanted = name.toLowerCase()
  const sheetName = wb.SheetNames.find(n => n.trim().toLowerCase() === wanted)
  if (!sheetName) return null
  const ws = wb.Sheets[sheetName]
  if (!ws['!ref']) return { headers: [], rows: [] }
  const range = XLSX.utils.decode_range(ws['!ref'])
  const at = (r, c) => ws[XLSX.utils.encode_cell({ r, c })]
  const headers = []
  for (let c = range.s.c; c <= range.e.c; c++) headers.push(text(at(range.s.r, c)).trim().toLowerCase())
  const rows = []
  for (let r = range.s.r + 1; r <= range.e.r; r++) {
    const row = []
    let any = false
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = at(r, c)
      row.push(cell)
      if (cell && cell.v != null && String(cell.v).trim() !== '') any = true
    }
    if (any) rows.push(row)
  }
  return { headers, rows }
}
const finder = headers => s => headers.findIndex(h => h.includes(s))
const col = (row, i) => (i >= 0 ? row[i] : undefined)

// ── sheet → record mappers ───────────────────────────────────────────────────
function mapSites(sh) {
  const find = finder(sh.headers)
  const idx = {
    name: find('site name'), capacity: find('pv capacity'), pv_inverter: find('pv inverter'), battery_wh: find('battery size'),
    battery_name: find('battery name'), battery_inv: find('battery inverter'), generator: find('generator'), genset: find('genset'),
    country: find('country'), province: find('province'), location: find('location'), meter: find('meter'),
    contract: find('contract type'), business: find('business type'), operational: find('operational'), sales: find('sales'),
    investor: find('investment party'), project: find('project number'), date: find('commisioned'), installer: find('installer'),
    platform: sh.headers.findIndex(h => h === 'platform'), offtake: find('offtake'), age: find('age'), soiling: find('soiling'),
    shading: find('shading'), power_limit: find('power limit'),
  }
  if (idx.name < 0) throw new Error('Sheet "site_tech_info" has no "Site Name" column')
  const g = (r, i) => cleanStr(col(r, i))
  const out = new Map()
  for (const r of sh.rows) {
    const name = text(col(r, idx.name)).trim()
    if (!name) continue
    const cap = num(col(r, idx.capacity))
    const opRaw = text(col(r, idx.operational)).toLowerCase()
    const commissioned = idx.date >= 0 ? isoDate(col(r, idx.date)) : undefined
    const rec = {
      name,
      capacity_kw: cap != null ? cap / 1000 : null,
      pv_inverter_kw: num(col(r, idx.pv_inverter)),
      battery_size_wh: num(col(r, idx.battery_wh)),
      inverter_brand: g(r, idx.battery_name),
      battery_inverter_size: g(r, idx.battery_inv),
      generator_size: g(r, idx.generator),
      genset_setpoint_kit: g(r, idx.genset),
      country: g(r, idx.country),
      province: g(r, idx.province),
      location: g(r, idx.location),
      meter: g(r, idx.meter),
      system_type: g(r, idx.contract),
      business_type: g(r, idx.business),
      operational_status: g(r, idx.operational),
      sales_type: g(r, idx.sales),
      investment_party: g(r, idx.investor),
      project_number: g(r, idx.project),
      installer_name: g(r, idx.installer),
      platform: g(r, idx.platform),
      offtake_guarantee: g(r, idx.offtake),
      age_years: num(col(r, idx.age)) != null ? Math.round(num(col(r, idx.age)) * 10) / 10 : null, // 1 dp, avoids a daily change
      soiling_intensity: g(r, idx.soiling),
      shading: g(r, idx.shading),
      power_limit: g(r, idx.power_limit),
      status: opRaw.includes('decommission') ? 'inactive' : 'active',
    }
    if (commissioned !== undefined) { rec.commissioned_date = commissioned; rec.install_date = commissioned }
    out.set(name.toLowerCase(), rec)
  }
  return [...out.values()]
}

function mapPerformance(sh) {
  const h = sh.headers
  const idx = {
    name: h.findIndex(x => x.includes('site name')), date: h.findIndex(x => x === 'date'),
    measured: h.findIndex(x => x.includes('measured')), expected: h.findIndex(x => x.includes('expected')),
    perf: h.findIndex(x => x === 'performance'), band: h.findIndex(x => x.includes('pf band')),
    discussion: h.findIndex(x => x.includes('discussion')),
  }
  if (idx.name < 0 || idx.date < 0) throw new Error('Sheet "performance" needs "Site Name" and "Date" columns')
  const out = new Map()
  for (const r of sh.rows) {
    const name = text(col(r, idx.name)).trim()
    const d = dateParts(col(r, idx.date))
    if (!name || !d) continue
    const rec = { site_name: name, month: d.m, year: d.y }
    if (idx.measured >= 0) rec.kwh_produced = num(col(r, idx.measured))
    if (idx.expected >= 0) rec.expected_kwh = num(col(r, idx.expected))
    if (idx.perf >= 0) rec.performance_pct = num(col(r, idx.perf))
    if (idx.band >= 0) rec.pf_band = cleanStr(col(r, idx.band))
    if (idx.discussion >= 0) rec.discussion = text(col(r, idx.discussion)).trim().toUpperCase() === 'YES'
    out.set(`${name.toLowerCase()}|${d.m}|${d.y}`, rec)
  }
  return out
}

function mapComments(sh) {
  const h = sh.headers
  const idx = {
    name: h.findIndex(x => x.includes('site name')), date: h.findIndex(x => x === 'date'),
    availability: h.findIndex(x => x.includes('availability')),
    downtime: h.findIndex(x => x.includes('downtime (days)') || (x.includes('downtime') && x.includes('day'))),
    cause: h.findIndex(x => x.includes('cause')), tech: h.findIndex(x => x.includes('technical')),
    energy: h.findIndex(x => x.includes('energy impact')), other: h.findIndex(x => x.includes('other comment')),
  }
  if (idx.name < 0 || idx.date < 0) throw new Error('Sheet "Comments" needs "Site Name" and "Date" columns')
  const out = new Map()
  for (const r of sh.rows) {
    const name = text(col(r, idx.name)).trim()
    const d = dateParts(col(r, idx.date))
    if (!name || !d) continue
    out.set(`${name.toLowerCase()}|${d.m}|${d.y}`, {
      site_name: name, month: d.m, year: d.y,
      availability: rawStr(col(r, idx.availability)),
      downtime_days: rawStr(col(r, idx.downtime)),
      cause_of_downtime: rawStr(col(r, idx.cause)),
      technical_events: rawStr(col(r, idx.tech)),
      energy_impact: rawStr(col(r, idx.energy)),
      other_comments: rawStr(col(r, idx.other)),
    })
  }
  return out
}

function mapOg(sh) {
  const find = finder(sh.headers)
  const idx = {
    name: find('site name'), og: find('offtake guarantee'), util: find('expected utilisation'), age: find('age'),
    asbuilt: find('as-built'), guaranteed: find('guaranteed generation'), unavail: find('unavailability'), correct: find('correct'),
    actual: find('actual generation'), shortfall: find('shortfall'), perf: find('performance rate'), notes: find('notes'),
  }
  if (idx.name < 0) throw new Error('Sheet "OG" has no "Site Name" column')
  const out = new Map()
  for (const r of sh.rows) {
    const name = text(col(r, idx.name)).trim()
    if (!name) continue
    out.set(name.toLowerCase(), {
      site_name: name,
      has_guarantee: idx.og >= 0 ? text(col(r, idx.og)).trim().toUpperCase() === 'YES' : true,
      expected_utilisation: num(col(r, idx.util)),
      og_age: num(col(r, idx.age)),
      as_built_kwh: num(col(r, idx.asbuilt)),
      guaranteed_kwh: num(col(r, idx.guaranteed)),
      unavailability_kwh: num(col(r, idx.unavail)),
      correct_kwh: num(col(r, idx.correct)),
      actual_kwh: num(col(r, idx.actual)),
      shortfall_kwh: num(col(r, idx.shortfall)),
      performance_rate: num(col(r, idx.perf)),
      notes: rawStr(col(r, idx.notes)),
    })
  }
  return [...out.values()]
}

// performance rows + comment columns for the same site/month (one write per row)
function mergePerformance(perf, comments) {
  const out = new Map()
  const commentFields = ['availability', 'downtime_days', 'cause_of_downtime', 'technical_events', 'energy_impact', 'other_comments']
  for (const [k, rec] of perf) out.set(k, { ...rec })
  for (const [k, c] of comments) {
    const hasText = commentFields.some(f => c[f] != null)
    if (out.has(k)) Object.assign(out.get(k), Object.fromEntries(commentFields.map(f => [f, c[f]])))
    else if (hasText) out.set(k, { ...c })
  }
  return [...out.values()]
}

// ── workbook → tables ────────────────────────────────────────────────────────
function readWorkbook() {
  let buf, lastErr
  for (let i = 0; i < 6; i++) { // Excel / OneDrive may hold the file for a moment while saving
    try { buf = fs.readFileSync(DATA_FILE); break } catch (e) { lastErr = e; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000) }
  }
  if (!buf) throw new Error(`Cannot read ${DATA_FILE}: ${lastErr && lastErr.message}`)
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false, cellNF: true, cellText: true })
  const tables = {}
  const sites = readSheet(wb, 'site_tech_info')
  if (sites) tables.sites = { key: 'name', conflict: 'name', rows: mapSites(sites) }
  const perf = readSheet(wb, 'performance')
  const comments = readSheet(wb, 'Comments')
  if (perf || comments) {
    tables.performance = {
      key: r => `${r.site_name.toLowerCase()}|${r.month}|${r.year}`, conflict: 'site_name,month,year',
      rows: mergePerformance(perf ? mapPerformance(perf) : new Map(), comments ? mapComments(comments) : new Map()),
    }
  }
  const og = readSheet(wb, 'OG')
  if (og) tables.offtake_guarantees = { key: 'site_name', conflict: 'site_name', rows: mapOg(og) }
  return tables
}

// ── Supabase ─────────────────────────────────────────────────────────────────
let _client = null
async function client() {
  if (_client) return _client
  const { createClient } = require('@supabase/supabase-js')
  const url = ENV.SUPABASE_URL
  if (!url) throw new Error(`SUPABASE_URL is missing (settings file: ${ENV_FILE || 'none found'})`)
  if (ENV.SUPABASE_SERVICE_ROLE_KEY) {
    _client = createClient(url, ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  } else {
    if (!ENV.SUPABASE_ANON_KEY || !ENV.SYNC_EMAIL || !ENV.SYNC_PASSWORD) {
      throw new Error('Set SUPABASE_SERVICE_ROLE_KEY, or SUPABASE_ANON_KEY + SYNC_EMAIL + SYNC_PASSWORD, in the settings file (.sosimple-sync.env)')
    }
    _client = createClient(url, ENV.SUPABASE_ANON_KEY, { auth: { persistSession: false } })
    const { error } = await _client.auth.signInWithPassword({ email: ENV.SYNC_EMAIL, password: ENV.SYNC_PASSWORD })
    if (error) { _client = null; throw new Error(`Sign-in failed: ${error.message}`) }
  }
  return _client
}

const hash = o => crypto.createHash('sha1').update(JSON.stringify(o)).digest('hex')
function loadState() { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) } catch (e) { return {} } }
function saveState(s) { fs.writeFileSync(STATE_FILE, JSON.stringify(s)) }

async function upsertChanged(name, table, state) {
  const keyOf = typeof table.key === 'function' ? table.key : r => String(r[table.key]).toLowerCase()
  const prev = FULL ? {} : (state[name] || {})
  const next = {}
  const changed = []
  for (const r of table.rows) {
    const k = keyOf(r)
    const h = hash(r)
    next[k] = h
    if (prev[k] !== h) changed.push(r)
  }
  if (DRY) {
    log(`  ${name}: ${table.rows.length} rows in sheet, ${changed.length} would be sent`)
    if (changed[0]) log(`    e.g. ${JSON.stringify(changed[0]).slice(0, 300)}`)
    return { sent: 0, failed: 0, changed: changed.length }
  }
  if (!changed.length) { state[name] = next; return { sent: 0, failed: 0, changed: 0 } }
  const sb = await client()
  let sent = 0, failed = 0
  const size = 500
  for (let i = 0; i < changed.length; i += size) {
    const batch = changed.slice(i, i + size)
    const { error } = await sb.from(name).upsert(batch, { onConflict: table.conflict })
    if (!error) { sent += batch.length; continue }
    if (/fetch failed|network|ENOTFOUND|ECONN|ETIMEDOUT|timeout|Failed to fetch/i.test(error.message || '')) {
      throw new Error(`Cannot reach Supabase (${error.message}). Check the internet connection; will retry.`)
    }
    log(`  ${name}: batch failed (${error.message}) – retrying row by row`)
    for (const row of batch) {
      const { error: e2 } = await sb.from(name).upsert([row], { onConflict: table.conflict })
      if (e2) { failed++; delete next[keyOf(row)]; log(`  ${name}: row failed ${JSON.stringify(row).slice(0, 160)} → ${e2.message}`) } else sent++
    }
  }
  state[name] = next
  return { sent, failed, changed: changed.length }
}

let running = false, again = false, lastFailed = false
async function syncNow(reason) {
  if (running) { again = true; return }
  running = true
  try {
    log(`Sync started (${reason})${DRY ? ' – DRY RUN, nothing is uploaded' : ''}`)
    const tables = readWorkbook()
    if (!Object.keys(tables).length) throw new Error('None of the sheets site_tech_info / performance / Comments / OG were found')
    const state = loadState()
    const summary = []
    // sites first, so new sites exist before their performance rows
    for (const name of ['sites', 'performance', 'offtake_guarantees']) {
      if (!tables[name]) continue
      const res = await upsertChanged(name, tables[name], state)
      summary.push(`${name}: ${res.changed} changed${DRY ? '' : `, ${res.sent} saved${res.failed ? `, ${res.failed} FAILED` : ''}`}`)
    }
    if (!DRY) saveState(state)
    lastFailed = summary.some(x => x.includes('FAILED'))
    log(`Sync finished – ${summary.join(' · ')}`)
  } catch (e) {
    lastFailed = true
    log(`Sync ERROR: ${e.message || e}`)
  } finally {
    running = false
    if (again) { again = false; setTimeout(() => syncNow('queued change'), 1000) }
  }
}

// ── watch ────────────────────────────────────────────────────────────────────
async function main() {
  if (!fs.existsSync(DATA_FILE)) { log(`Data file not found: ${DATA_FILE}`); process.exit(1) }
  log(`Data file: ${DATA_FILE}`)
  log(`Settings: ${ENV_FILE || 'none found – copy .env.example'}`)
  await syncNow(ONCE ? 'manual' : 'startup')
  if (ONCE) return

  let timer = null
  let lastMtime = fs.statSync(DATA_FILE).mtimeMs
  const schedule = why => { clearTimeout(timer); timer = setTimeout(() => syncNow(why), DEBOUNCE_MS) }
  const base = path.basename(DATA_FILE).toLowerCase()
  // Excel saves via a temp file + rename, so watch the folder, not the file
  fs.watch(path.dirname(DATA_FILE), (evt, fname) => {
    if (!fname || fname.toLowerCase() !== base) return
    try {
      const m = fs.statSync(DATA_FILE).mtimeMs
      if (m === lastMtime) return
      lastMtime = m
      schedule('file saved')
    } catch (e) { /* file is being replaced */ }
  })
  // safety net (OneDrive downloads changes made by colleagues without a watch event sometimes)
  setInterval(() => {
    try {
      const m = fs.statSync(DATA_FILE).mtimeMs
      if (m !== lastMtime) { lastMtime = m; schedule('change detected') }
      else if (lastFailed && !running) schedule('retry after error')
    } catch (e) { /* ignore */ }
  }, POLL_MS)
  log(`Watching for changes… (leave this window open; close it to stop syncing)`)
}

main()
