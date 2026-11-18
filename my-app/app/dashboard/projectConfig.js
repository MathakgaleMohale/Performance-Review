// Shared settings for the Projects workspace (ProjectsTool.js + ProjectPage.js)

export const STAGES = ['Site Visit', 'Design', 'BOQ', 'Procurement', 'Installation', 'Quality Control', 'As-Built', 'Handover']

export const STAGE_META = {
  'Site Visit':      { icon: 'ti-map-pin',          color: '#579FE4' },
  Design:            { icon: 'ti-layout-grid',      color: '#0B74D7' },
  BOQ:               { icon: 'ti-file-invoice',     color: '#5b3fa8' },
  Procurement:       { icon: 'ti-truck-delivery',   color: '#8a6f00' },
  Installation:      { icon: 'ti-tools',            color: '#F66524' },
  'Quality Control': { icon: 'ti-clipboard-check', color: '#D93A3A' },
  'As-Built':        { icon: 'ti-ruler-2',          color: '#505050' },
  Handover:          { icon: 'ti-flag-check',       color: '#3F8F2A' },
}

export const PROJECT_STATUSES = ['Active', 'On hold', 'Complete', 'Cancelled']
export const STAGE_STATUSES = ['Not started', 'In progress', 'Done']

// Starter checklist added to new projects (optional, can be edited afterwards)
export const STARTER_TASKS = {
  'Site Visit': ['Meet client & confirm scope', 'Roof / ground structure assessment', 'Shading assessment', 'Locate main DB, meter & inverter position', 'Take site photos', 'Obtain 12 months electricity bills / load profile'],
  Design: ['PV layout', 'Single line diagram (SLD)', 'Cable sizing', 'Energy yield simulation', 'Design pack issued for approval', 'Client design sign-off'],
  BOQ: ['Draft BOQ', 'Supplier quotes received', 'BOQ / costing approved'],
  Procurement: ['Purchase orders issued', 'Delivery dates confirmed', 'Equipment delivered & checked on site'],
  Installation: ['Site handover from client & safety file', 'Mounting structure installed', 'PV modules installed', 'Inverters, DBs & batteries installed', 'DC & AC cabling complete', 'Earthing & lightning protection'],
  'Quality Control': ['QC checklist completed', 'Insulation resistance & polarity tests', 'Commissioning test sheets', 'Snag list closed out'],
  'As-Built': ['As-built SLD', 'As-built PV layout', 'Equipment serial numbers recorded', 'Monitoring set up & verified'],
  Handover: ['Certificate of Compliance (CoC) issued', 'O&M manual & warranties handed over', 'Client training', 'Handover certificate signed', 'Site added to performance portfolio'],
}

// ── Project templates (Phase 4 step 1, agreed with Mathakgale 2026-11-17) ──
// A template = project type + starter checklist per stage. All 8 stages always apply.
// Templates are stored in the project_templates table (editable from "Manage templates").
// The list below seeds that table (supabase/project_templates.sql) and is the fallback
// if the table has not been created yet.
const BOQ_TASKS = ['Draft BOQ', 'Supplier quotes received', 'BOQ / costing approved']
export const DEFAULT_TEMPLATES = [
  {
    name: 'C&I rooftop', sort: 1,
    description: 'Commercial and industrial rooftop PV, grid-tied.',
    tasks: {
      'Site Visit': ['Meet client & confirm scope and energy goals', 'Roof structural assessment (engineer report)', 'Roof type, age & waterproofing condition', 'Shading assessment', 'Locate main LV board, metering & inverter position', 'Obtain 12 months electricity bills / load profile', 'Confirm supply size & notified maximum demand (NMD)', 'Take site photos / drone survey'],
      Design: ['PV layout incl. roof walkways & access', 'Structural sign-off of roof loading', 'Single line diagram (SLD)', 'Cable sizing', 'Energy yield simulation', 'Protection, earthing & lightning protection design', 'SSEG / grid connection application submitted', 'Design pack issued for approval', 'Client design sign-off'],
      BOQ: BOQ_TASKS,
      Procurement: ['Purchase orders issued', 'Delivery dates confirmed', 'Crane / lifting plan & equipment booked', 'Equipment delivered & checked on site'],
      Installation: ['Site handover from client, safety file & permits', 'Working-at-height plan & fall protection in place', 'Mounting structure / rails installed', 'PV modules installed', 'Inverters, combiners & DBs installed', 'DC & AC cabling and cable trays complete', 'Earthing & lightning protection', 'Roof penetrations sealed & waterproofing checked'],
      'Quality Control': ['QC checklist completed', 'Insulation resistance & polarity tests (string Voc / Isc)', 'Protection & anti-islanding settings verified', 'Commissioning test sheets', 'Snag list closed out'],
      'As-Built': ['As-built SLD', 'As-built PV layout', 'Equipment serial numbers recorded', 'Monitoring set up & verified'],
      Handover: ['Certificate of Compliance (CoC) issued', 'SSEG approval / utility sign-off received', 'O&M manual & warranties handed over', 'Client training', 'Handover certificate signed', 'Site added to performance portfolio'],
    },
  },
  {
    name: 'Ground-mount', sort: 2,
    description: 'Ground-mounted arrays and carports.',
    tasks: {
      'Site Visit': ['Meet client & confirm scope', 'Confirm land, servitudes & site access', 'Topographic survey', 'Geotechnical investigation / pile pull-out tests', 'Flood, drainage & vegetation assessment', 'Point of connection & cable route', 'Obtain 12 months electricity bills / load profile', 'Take site photos / drone survey'],
      Design: ['Array layout, row spacing & tilt', 'Foundation / piling design', 'Single line diagram (SLD)', 'Cable sizing & trench routing', 'Energy yield simulation', 'Earthing & lightning protection design', 'Fencing, security & access road design', 'Environmental / land-use authorisation checked', 'SSEG / grid connection application submitted', 'Design pack issued for approval', 'Client design sign-off'],
      BOQ: BOQ_TASKS,
      Procurement: ['Purchase orders issued', 'Delivery dates confirmed', 'Piling rig & plant hire booked', 'Secure laydown area arranged', 'Equipment delivered & checked on site'],
      Installation: ['Site handover from client, safety file & permits', 'Site clearing & levelling', 'Fencing & site security', 'Piling / foundations', 'Mounting structure installed', 'PV modules installed', 'Inverters / skids / transformer installed', 'Trenching, DC & AC cabling', 'Earthing & lightning protection', 'Backfill & reinstatement'],
      'Quality Control': ['QC checklist completed', 'Pile pull-out / torque test results recorded', 'Insulation resistance & polarity tests', 'Protection settings verified', 'Commissioning test sheets', 'Snag list closed out'],
      'As-Built': ['As-built SLD', 'As-built array layout & cable routes', 'Equipment serial numbers recorded', 'Monitoring & security systems set up & verified'],
      Handover: ['Certificate of Compliance (CoC) issued', 'SSEG approval / utility sign-off received', 'O&M manual & warranties handed over', 'Vegetation control & module cleaning plan agreed', 'Client training', 'Handover certificate signed', 'Site added to performance portfolio'],
    },
  },
  {
    name: 'Hybrid / BESS', sort: 3,
    description: 'PV with batteries, or battery-only projects.',
    tasks: {
      'Site Visit': ['Meet client & confirm backup / self-consumption goals', 'List essential loads & required backup time', 'Obtain 12 months electricity bills / load profile', 'Roof / ground structure assessment', 'Shading assessment', 'Battery & inverter room location (ventilation, fire, clearances)', 'Locate main DB & meter', 'Take site photos'],
      Design: ['PV layout', 'Battery sizing & autonomy calculation', 'SLD incl. essential / non-essential split & changeover', 'Cable sizing incl. battery DC cables', 'Energy yield & battery simulation', 'Battery room fire safety & ventilation design', 'Protection, earthing & lightning protection design', 'SSEG / grid connection application submitted', 'Design pack issued for approval', 'Client design sign-off'],
      BOQ: BOQ_TASKS,
      Procurement: ['Purchase orders issued', 'Delivery dates confirmed', 'Battery transport (dangerous goods) arranged', 'Equipment delivered & checked (battery damage / SoC)'],
      Installation: ['Site handover from client & safety file', 'Mounting structure installed', 'PV modules installed', 'Inverters & batteries installed', 'Essential loads DB split / changeover', 'DC, battery & AC cabling complete', 'Earthing & lightning protection', 'Fire detection, signage & emergency shutdown at battery room'],
      'Quality Control': ['QC checklist completed', 'Insulation resistance & polarity tests', 'Battery BMS communication & firmware checked', 'Backup test with grid off (islanding)', 'Charge / discharge settings verified (SoC limits, TOU)', 'Commissioning test sheets', 'Snag list closed out'],
      'As-Built': ['As-built SLD', 'As-built layout', 'Equipment serial numbers recorded', 'Monitoring set up & verified (incl. battery)'],
      Handover: ['Certificate of Compliance (CoC) issued', 'SSEG approval / utility sign-off received', 'O&M manual & warranties handed over (battery warranty registered)', 'Client training incl. backup operation & emergency shutdown', 'Handover certificate signed', 'Site added to performance portfolio'],
    },
  },
  { name: 'General', sort: 9, description: 'The standard checklist, for projects that fit no other type.', tasks: STARTER_TASKS },
]

export const templateTaskCount = t => STAGES.reduce((n, s) => n + ((t?.tasks || {})[s] || []).length, 0)
// Rows for project_tasks from a template (stages in order, blank titles skipped)
export const templateTaskRows = (t, projectId, createdBy) => STAGES.flatMap(s =>
  ((t?.tasks || {})[s] || []).map(x => String(x || '').trim()).filter(Boolean)
    .map((title, i) => ({ project_id: projectId, stage: s, title, sort: i, created_by: createdBy || null })))
export const templatesMissing = err => /project_templates|relation|does not exist|schema cache/i.test(err?.message || '')

export const fmtDate = d => (d ? new Date(d.length === 10 ? d + 'T00:00:00' : d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }) : '')
export const fmtShort = d => (d ? new Date(d.length === 10 ? d + 'T00:00:00' : d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' }) : '')
export const fmtSize = b => (b == null ? '' : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`)
export const safeName = n => n.replace(/[^a-zA-Z0-9.\-_]/g, '_')
export const todayISO = () => new Date().toISOString().slice(0, 10)
export const isOverdue = (d, done) => !done && d && new Date(d + 'T23:59:59') < new Date()

export const setupMessage = err => (/relation|does not exist|schema cache/i.test(err?.message || '')
  ? 'The Projects workspace is not set up yet. Run supabase/projects.sql once in the Supabase SQL Editor.'
  : `Could not load projects: ${err?.message || err}`)

export function uiStyles(T, selectStyle) {
  const btn = (bg, fg = '#fff', border = 'none') => ({ padding: '8px 14px', background: bg, color: fg, border, borderRadius: '7px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px' })
  return {
    btn,
    ghost: btn('transparent', T.textSecondary, `1px solid ${T.border}`),
    iconBtn: color => ({ background: 'transparent', border: `1px solid ${T.border}`, color, borderRadius: '6px', padding: '5px 8px', cursor: 'pointer', fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: '4px' }),
    labelStyle: { fontSize: '10px', fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '4px' },
    inp: { ...selectStyle, cursor: 'text', width: '100%', boxSizing: 'border-box' },
    chip: (active, color = T.blue) => ({
      padding: '7px 13px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', borderRadius: '999px',
      border: `1px solid ${active ? color : T.border}`, background: active ? color : T.bgPanel, color: active ? '#fff' : T.textSecondary,
      display: 'inline-flex', alignItems: 'center', gap: '6px',
    }),
    badge: color => ({ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 700, color, border: `1px solid ${color}55`, whiteSpace: 'nowrap' }),
    overlay: { position: 'fixed', inset: 0, background: 'rgba(10,20,35,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' },
  }
}

export const statusColor = (T, s) => (s === 'Complete' ? T.green : s === 'On hold' ? T.orange : s === 'Cancelled' ? T.textMuted : T.blue)

// ── Project health (agreed with Mathakgale 2026-11-11) ──
//  Late     : target handover date has passed
//  At risk  : any overdue checklist task, OR time used is more than gapPts ahead
//             of stage progress, OR handover within soonDays and not yet at lateStage
//  On track : otherwise.  On hold / Complete / Cancelled show their status instead.
export const HEALTH_RULES = { gapPts: 20, soonDays: 14, lateStage: 'Quality Control' }

export function projectHealth(p, now = new Date()) {
  const tasks = p.project_tasks || []
  const tasksDone = tasks.filter(t => t.done).length
  const overdue = tasks.filter(t => isOverdue(t.due_date, t.done)).length
  const idx = Math.max(0, STAGES.indexOf(p.stage))
  const complete = p.status === 'Complete'
  const stagePct = Math.round(((complete ? STAGES.length : idx + 1) / STAGES.length) * 100)
  const end = p.target_date ? new Date(p.target_date + 'T23:59:59') : null
  const start = p.start_date ? new Date(p.start_date + 'T00:00:00') : null
  const daysLeft = end ? Math.ceil((end - now) / 86400000) : null
  const timePct = start && end && end > start ? Math.max(0, Math.min(100, Math.round(((now - start) / (end - start)) * 100))) : null

  const reasons = []
  let key
  if (p.status === 'Complete') key = 'complete'
  else if (p.status === 'On hold') key = 'hold'
  else if (p.status === 'Cancelled') key = 'cancelled'
  else if (daysLeft != null && daysLeft < 0) { key = 'late'; reasons.push(`${-daysLeft} day${daysLeft === -1 ? '' : 's'} past target handover`) }
  else {
    if (overdue) reasons.push(`${overdue} overdue task${overdue === 1 ? '' : 's'}`)
    if (timePct != null && timePct - stagePct > HEALTH_RULES.gapPts) reasons.push(`${timePct}% of time used, ${stagePct}% through stages`)
    if (daysLeft != null && daysLeft <= HEALTH_RULES.soonDays && idx < STAGES.indexOf(HEALTH_RULES.lateStage)) reasons.push(`Handover in ${daysLeft} day${daysLeft === 1 ? '' : 's'}, still at ${p.stage}`)
    key = reasons.length ? 'risk' : 'ok'
  }
  if (key === 'late' && overdue) reasons.push(`${overdue} overdue task${overdue === 1 ? '' : 's'}`)
  return { key, reasons, tasksDone, tasksTotal: tasks.length, overdue, stageIdx: idx, stagePct, timePct, daysLeft }
}

export const HEALTH_META = {
  ok:        { label: 'On track',  icon: 'ti-circle-check',    color: T => T.green },
  risk:      { label: 'At risk',   icon: 'ti-alert-triangle',  color: T => T.orange },
  late:      { label: 'Late',      icon: 'ti-alarm',           color: T => T.red },
  hold:      { label: 'On hold',   icon: 'ti-player-pause',    color: T => T.orange },
  complete:  { label: 'Complete',  icon: 'ti-flag-check',      color: T => T.green },
  cancelled: { label: 'Cancelled', icon: 'ti-circle-x',        color: T => T.textMuted },
}

export const initials = name => (name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?'

// Re-checks the signed-in user's portal password before something is deleted
export async function checkPassword(supabase, pw) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) throw new Error('You are not signed in. Please sign in again.')
  const { error } = await supabase.auth.signInWithPassword({ email: user.email, password: pw })
  return !error
}
