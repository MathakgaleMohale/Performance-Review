'use client'

import { useEffect, useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'

// Parses semicolon-delimited CSV with quoted multiline fields
function parseCSV(text) {
  const rows = []
  let row = [], field = '', inQuotes = false
  text = text.replace(/^\uFEFF/, '')
  // Auto-detect delimiter from the first line: semicolon, comma or tab
  const firstLine = text.slice(0, text.indexOf('\n') >= 0 ? text.indexOf('\n') : text.length)
  const counts = { ';': (firstLine.match(/;/g) || []).length, ',': (firstLine.match(/,/g) || []).length, '\t': (firstLine.match(/\t/g) || []).length }
  const delim = counts[';'] >= counts[','] && counts[';'] >= counts['\t'] ? ';' : (counts['\t'] > counts[','] ? '\t' : ',')
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else field += ch
    } else {
      if (ch === '"') inQuotes = true
      else if (ch === delim) { row.push(field); field = '' }
      else if (ch === '\n') { row.push(field); field = ''; if (row.some(f => f.trim())) rows.push(row); row = [] }
      else if (ch !== '\r') field += ch
    }
  }
  if (field || row.length) { row.push(field); if (row.some(f => f.trim())) rows.push(row) }
  return rows
}

const MONTH_MAP = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 }

function parseMonthYear(raw) {
  const parts = (raw || '').trim().split('-')
  if (parts.length !== 2) return [null, null]
  const m = MONTH_MAP[parts[0].toLowerCase()]
  const y = parts[1].length === 2 ? parseInt('20' + parts[1]) : parseInt(parts[1])
  return m && y ? [m, y] : [null, null]
}

function parseNum(val) {
  const v = (val || '').trim().replace('%', '').replace(',', '.')
  if (!v || v.toLowerCase() === 'null' || v === 'N/A') return null
  const n = parseFloat(v)
  return isNaN(n) ? null : n
}

function cleanStr(val) {
  const v = (val || '').trim()
  return !v || v.toLowerCase() === 'null' || v === 'N/A' ? null : v
}

// Verbatim passthrough — keeps text exactly as in the CSV (incl. "N/A", "None", "28 days"),
// only trimming outer whitespace; truly empty cells become null.
function rawStr(val) {
  const v = (val ?? '').trim()
  return v === '' ? null : v
}

// ── Design tokens (dark theme matching login page) ──────────────────────────
const T = {
  // Backgrounds — greyish blue, softer than pure dark navy
  bgBase:    '#222e40',   // main background
  bgPanel:   '#2a3950',   // card / panel
  bgPanelAlt:'#253348',   // topbar / sidebar
  bgRow:     '#2e3e57',   // table row hover
  bgInput:   '#1f2c3e',   // input fields
  bgMuted:   '#263448',   // subtle section bg

  // Borders
  border:    '#3c4f6a',   // standard border
  borderBright: '#2B7FD4', // accent border

  // Brand colours
  blue:      '#2B7FD4',
  blueBright:'#3d8fe0',
  yellow:    '#F5D000',
  green:     '#7DC242',
  orange:    '#f0a500',
  red:       '#ef4444',

  // Text
  textPrimary: '#e8f0fb',
  textSecondary:'#9ab4cf',
  textMuted:  '#6b87a5',
  textWhite:  '#ffffff',

  // Glow effects
  glowBlue:  'rgba(43,127,212,0.15)',
  glowGreen: 'rgba(125,194,66,0.08)',
  glowYellow:'rgba(245,208,0,0.08)',
}

export default function DashboardPage() {
  const [sites, setSites] = useState([])
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activePage, setActivePage] = useState('overview')
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterContract, setFilterContract] = useState('')
  const [activeInvTab, setActiveInvTab] = useState('all')
  const [chartReady, setChartReady] = useState(false)
  const [geoReady, setGeoReady] = useState(false)
  const [filterInvestor, setFilterInvestor] = useState('')
  const [filterInstaller, setFilterInstaller] = useState('')
  const [filterOverviewContract, setFilterOverviewContract] = useState('')
  const [perfData, setPerfData] = useState([])
  const [perfLoading, setPerfLoading] = useState(false)
  const [pfFilterInvestor, setPfFilterInvestor] = useState('')
  const [pfFilterDate, setPfFilterDate] = useState('')
  const [pfFilterBand, setPfFilterBand] = useState('')
  const [pfSort, setPfSort] = useState({ key: 'date', dir: 'desc' })
  const [spSite, setSpSite] = useState('')
  const [spSearch, setSpSearch] = useState('')
  const [spYear, setSpYear] = useState('')
  const [spYearA, setSpYearA] = useState('')
  const [spYearB, setSpYearB] = useState('')
  const [spCommentDate, setSpCommentDate] = useState('')
  const [upPerf, setUpPerf] = useState(null)
  const [upSites, setUpSites] = useState(null)
  const [upComments, setUpComments] = useState(null)
  const [upOg, setUpOg] = useState(null)
  const [repType, setRepType] = useState('install')
  const [repInvestor, setRepInvestor] = useState('')
  const [repDate, setRepDate] = useState('')
  const [upMsg, setUpMsg] = useState('')
  const [upBusy, setUpBusy] = useState(false)
  const [ogData, setOgData] = useState([])
  const [ogLoading, setOgLoading] = useState(false)
  const [ogSearch, setOgSearch] = useState('')
  const [ogFilterStatus, setOgFilterStatus] = useState('')
  const [ogSort, setOgSort] = useState({ key: 'shortfall', dir: 'asc' })
  const [ogSelected, setOgSelected] = useState(null)
  const [ogOverview, setOgOverview] = useState(false)
  const chartsRef = useRef({})

  useEffect(() => {
    function loadGeo() {
      if (window.ChartGeo && window._zaFeatures) { setGeoReady(true); return }
      const geoScript = document.createElement('script')
      geoScript.src = 'https://cdn.jsdelivr.net/npm/chartjs-chart-geo@4.3.4/build/index.umd.min.js'
      geoScript.onload = async () => {
        try {
          const urls = [
            'https://cdn.jsdelivr.net/gh/deldersveld/topojson@master/countries/south-africa/south-africa-provinces.json',
            'https://cdn.jsdelivr.net/gh/deldersveld/topojson@master/countries/zambia/zambia-provinces.json',
          ]
          const results = await Promise.allSettled(urls.map(u => fetch(u).then(r => r.json())))
          let features = []
          results.forEach(r => {
            if (r.status === 'fulfilled') {
              const topo = r.value
              const key = Object.keys(topo.objects)[0]
              features = features.concat(window.ChartGeo.topojson.feature(topo, topo.objects[key]).features)
            }
          })
          if (features.length === 0) throw new Error('No geo data loaded')
          window._zaFeatures = features
          setGeoReady(true)
        } catch (e) { console.error('Geo map data failed to load, falling back to bar chart', e) }
      }
      document.head.appendChild(geoScript)
    }
    if (window.Chart) { setChartReady(true); loadGeo(); return }
    const script = document.createElement('script')
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js'
    script.onload = () => { setChartReady(true); loadGeo() }
    document.head.appendChild(script)
  }, [])

  useEffect(() => {
    async function loadData() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { window.location.href = '/login'; return }
      const { data: profile } = await supabase.from('users').select('*').eq('id', user.id).single()
      if (profile?.role !== 'employee') { window.location.href = '/login'; return }
      setUser({ ...user, ...profile })
      const { data: sitesData } = await supabase.from('sites').select('*').order('name')
      setSites(sitesData || [])
      setLoading(false)
    }
    loadData()
  }, [])

  useEffect(() => {
    if ((activePage === 'performance' || activePage === 'siteperf' || activePage === 'report' || activePage === 'offtake') && perfData.length === 0) {
      loadPerformance()
    }
  }, [activePage])

  useEffect(() => {
    if (activePage === 'offtake' && ogData.length === 0) {
      loadOfftake()
    }
  }, [activePage])

  async function loadOfftake() {
    setOgLoading(true)
    const { data, error } = await supabase
      .from('offtake_guarantees')
      .select('*')
      .order('site_name')
    if (error) console.error('Failed to load offtake guarantees', error)
    setOgData(data || [])
    setOgLoading(false)
  }

  async function loadPerformance() {
    setPerfLoading(true)
    let allData = []
    let from = 0
    const batchSize = 1000
    while (true) {
      const { data, error } = await supabase
        .from('performance')
        .select('*')
        .order('year', { ascending: false })
        .order('month', { ascending: false })
        .range(from, from + batchSize - 1)
      if (error || !data || data.length === 0) break
      allData = [...allData, ...data]
      if (data.length < batchSize) break
      from += batchSize
    }
    setPerfData(allData)
    setPerfLoading(false)
  }

  useEffect(() => {
    if (!loading && sites.length > 0 && chartReady && activePage === 'overview') {
      setTimeout(() => buildCharts(filteredOverview), 100)
    }
  }, [loading, sites, activePage, chartReady, geoReady, filterInvestor, filterInstaller, filterOverviewContract])

  useEffect(() => {
    if (activePage === 'investor' && chartReady) setTimeout(() => buildCharts(invSites), 100)
  }, [activePage, activeInvTab, chartReady])

  useEffect(() => {
    if (activePage === 'performance' && chartReady && perfData.length > 0) {
      setTimeout(() => buildPerfCharts(filteredPerf), 100)
    }
  }, [activePage, chartReady, perfData, pfFilterInvestor, pfFilterDate, pfFilterBand])

  function signOut() { supabase.auth.signOut().then(() => { window.location.href = '/login' }) }

  const investors = [...new Set(sites.map(s => s.investment_party).filter(Boolean))].sort()
  const installers = [...new Set(sites.map(s => s.installer_name).filter(Boolean))].sort()

  // Site age in years: computed live from commissioned date, falling back to stored age_years
  function siteAge(site) {
    if (site?.commissioned_date) {
      const c = new Date(site.commissioned_date)
      if (!isNaN(c)) {
        const yrs = (Date.now() - c.getTime()) / (1000 * 60 * 60 * 24 * 365.25)
        if (yrs >= 0) return yrs
      }
    }
    if (site?.age_years != null && !isNaN(parseFloat(site.age_years))) return parseFloat(site.age_years)
    return null
  }
  function fmtAge(site) {
    const a = siteAge(site)
    if (a == null) return '—'
    if (a < 1) {
      const months = Math.max(0, Math.round(a * 12))
      return months <= 0 ? '<1 mo' : `${months} mo`
    }
    return `${a.toFixed(1)} yr`
  }
  const activeSites = sites.filter(s => s.status === 'active')
  const totalCap = activeSites.reduce((sum, s) => sum + (s.capacity_kw || 0), 0)
  const ppaCount = sites.filter(s => s.system_type === 'PPA').length
  const rtoCount = sites.filter(s => s.system_type === 'RTO').length
  const totalBessWh = sites.reduce((sum, s) => sum + (s.battery_size_wh || 0), 0)
  const totalBessMwh = (totalBessWh / 1000000).toFixed(2)

  const filteredOverview = sites.filter(s => {
    const mI = !filterInvestor || s.investment_party === filterInvestor
    const mIn = !filterInstaller || s.installer_name === filterInstaller
    const mC = !filterOverviewContract || s.system_type === filterOverviewContract
    return mI && mIn && mC
  })

  const filteredSites = sites.filter(s => {
    const q = searchQuery.toLowerCase()
    const matchQ = !q || s.name?.toLowerCase().includes(q) || s.location?.toLowerCase().includes(q)
    const matchType = !filterType || s.business_type === filterType
    const matchContract = !filterContract || s.system_type === filterContract
    return matchQ && matchType && matchContract
  })

  const invSites = activeInvTab === 'all' ? sites : sites.filter(s => s.investment_party === activeInvTab)

  const dateKey = (p) => `${parseInt(p.year)}-${String(parseInt(p.month)).padStart(2, '0')}`
  const perfDates = [...new Set(perfData.map(p => dateKey(p)))].sort().reverse()

  function getInvestor(p) {
    const site = sites.find(s => (p.site_id && s.id === p.site_id) || s.name?.trim().toLowerCase() === p.site_name?.trim().toLowerCase())
    return site?.investment_party || ''
  }

  const filteredPerf = perfData.filter(p => {
    const mI = !pfFilterInvestor || getInvestor(p) === pfFilterInvestor
    const mD = !pfFilterDate || dateKey(p) === pfFilterDate
    const mB = !pfFilterBand || (p.pf_band || '').trim() === pfFilterBand
    return mI && mD && mB
  })

  const sortedPerf = [...filteredPerf].sort((a, b) => {
    const dir = pfSort.dir === 'asc' ? 1 : -1
    const val = (p) => {
      switch (pfSort.key) {
        case 'site': return (p.site_name || '').toLowerCase()
        case 'investor': return (getInvestor(p) || '').toLowerCase()
        case 'date': return parseInt(p.year) * 100 + parseInt(p.month)
        case 'measured': return p.kwh_produced != null ? parseFloat(p.kwh_produced) : null
        case 'expected': return p.expected_kwh != null ? parseFloat(p.expected_kwh) : null
        case 'perf': return p.performance_pct != null ? parseFloat(p.performance_pct) : null
        case 'band': return (p.pf_band || '').toLowerCase()
        default: return 0
      }
    }
    const va = val(a), vb = val(b)
    if (va == null && vb == null) return 0
    if (va == null) return 1
    if (vb == null) return -1
    if (va < vb) return -1 * dir
    if (va > vb) return 1 * dir
    return 0
  })

  function togglePfSort(key) {
    setPfSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'site' || key === 'investor' || key === 'band' ? 'asc' : 'desc' })
  }

  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  function fmtDate(month, year) { return `${monthNames[parseInt(month)-1]}-${String(parseInt(year)).slice(2)}` }

  // ── Offtake Guarantees derived values ──────────────────────────────────────
  const filteredOG = ogData.filter(g => {
    const q = ogSearch.toLowerCase()
    const mQ = !q || g.site_name?.toLowerCase().includes(q)
    const meeting = (g.shortfall_kwh ?? 0) >= 0
    const mS = !ogFilterStatus || (ogFilterStatus === 'meeting' ? meeting : !meeting)
    return mQ && mS
  })

  const sortedOG = [...filteredOG].sort((a, b) => {
    const dir = ogSort.dir === 'asc' ? 1 : -1
    const val = (g) => {
      switch (ogSort.key) {
        case 'site': return (g.site_name || '').toLowerCase()
        case 'util': return g.expected_utilisation != null ? parseFloat(g.expected_utilisation) : null
        case 'degradation': return g.og_age != null ? parseFloat(g.og_age) : (g.degradation != null ? parseFloat(g.degradation) : null)
        case 'asbuilt': return g.as_built_kwh != null ? parseFloat(g.as_built_kwh) : null
        case 'guaranteed': return g.correct_kwh != null ? parseFloat(g.correct_kwh) : null
        case 'unavail': return g.unavailability_kwh != null ? parseFloat(g.unavailability_kwh) : null
        case 'actual': return g.actual_kwh != null ? parseFloat(g.actual_kwh) : null
        case 'achievement': return g.correct_kwh > 0 && g.actual_kwh != null ? g.actual_kwh / g.correct_kwh : null
        case 'shortfall': return g.shortfall_kwh != null ? parseFloat(g.shortfall_kwh) : null
        default: return 0
      }
    }
    const va = val(a), vb = val(b)
    if (va == null && vb == null) return 0
    if (va == null) return 1
    if (vb == null) return -1
    if (va < vb) return -1 * dir
    if (va > vb) return 1 * dir
    return 0
  })

  function toggleOgSort(key) {
    setOgSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'site' ? 'asc' : key === 'shortfall' ? 'asc' : 'desc' })
  }

  const ogTotGuaranteed = filteredOG.reduce((s, g) => s + (g.correct_kwh || 0), 0)
  const ogTotActual = filteredOG.reduce((s, g) => s + (g.actual_kwh || 0), 0)
  const ogTotShortfall = filteredOG.reduce((s, g) => s + (g.shortfall_kwh || 0), 0)
  const ogMeetingCount = filteredOG.filter(g => (g.shortfall_kwh ?? 0) >= 0).length
  const ogAchievement = ogTotGuaranteed > 0 ? ((ogTotActual / ogTotGuaranteed) * 100).toFixed(1) : '—'

  // Guarantee period: July 2025 – June 2026
  const OG_PERIOD = Array.from({ length: 12 }, (_, i) => {
    const m = ((6 + i) % 12) + 1
    return { m, y: m >= 7 ? 2025 : 2026 }
  })

  function ogMonthlyRows(siteName) {
    const key = (siteName || '').trim().toLowerCase()
    return OG_PERIOD.map(({ m, y }) => {
      const rec = perfData.find(p => p.site_name?.trim().toLowerCase() === key && parseInt(p.month) === m && parseInt(p.year) === y)
      return { m, y, measured: rec?.kwh_produced ?? null, expected: rec?.expected_kwh ?? null,
        availability: rec?.availability ?? null, downtime_days: rec?.downtime_days ?? null,
        cause: rec?.cause_of_downtime ?? null, technical: rec?.technical_events ?? null,
        energy_impact: rec?.energy_impact ?? null, other: rec?.other_comments ?? null,
        comment: rec?.comment ?? null }
    })
  }

  const fmtMWh = (kwh) => kwh != null ? `${(kwh / 1000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MWh` : '—'
  const fmtKWh = (kwh) => kwh != null ? `${Math.round(kwh).toLocaleString()} kWh` : '—'

  // Does a performance record carry any structured comment data?
  const hasCommentData = (p) => !!(p && (p.availability || p.downtime_days != null || p.cause_of_downtime || p.technical_events || p.energy_impact || p.other_comments || p.comment))
  const COMMENT_FIELDS = [
    { key: 'availability', label: 'Availability' },
    { key: 'downtime_days', label: 'Downtime (days)' },
    { key: 'cause_of_downtime', label: 'Cause of Downtime' },
    { key: 'technical_events', label: 'Technical Events' },
    { key: 'energy_impact', label: 'Energy Impact' },
    { key: 'other_comments', label: 'Other Comments' },
  ]

  function ogStatusBadge(g) {
    const meeting = (g.shortfall_kwh ?? 0) >= 0
    return (
      <span style={{
        display: 'inline-block', padding: '2px 9px', borderRadius: '20px', fontSize: '10px', fontWeight: 700,
        background: meeting ? 'rgba(125,194,66,0.15)' : 'rgba(239,68,68,0.12)',
        color: meeting ? T.green : T.red,
        border: `1px solid ${meeting ? 'rgba(125,194,66,0.35)' : 'rgba(239,68,68,0.3)'}`,
      }}>
        {meeting ? 'Meeting' : 'Shortfall'}
      </span>
    )
  }

  function buildCharts(sitesData) {
    if (typeof window === 'undefined') return
    const Chart = window.Chart
    if (!Chart) return
    const destroy = (id) => { if (chartsRef.current[id]) { chartsRef.current[id].destroy(); delete chartsRef.current[id] } }
    const C = { blue: T.blue, yellow: T.yellow, green: T.green, orange: T.orange, gray: '#2a4a6a', purple: '#8b5cf6', red: T.red }
    const gridColor = '#3c4f6a'
    const tickColor = '#9ab4cf'
    const commonOpts = {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: T.textSecondary, font: { size: 11 }, boxWidth: 12 } } }
    }
    const darkScales = {
      x: { ticks: { color: tickColor, font: { size: 10 } }, grid: { color: gridColor } },
      y: { ticks: { color: tickColor }, grid: { color: gridColor } }
    }

    const types = ['Retail', 'Manufacture', 'Residential', 'Commercial', 'Agricultural']
    const tColors = [C.blue, C.yellow, C.green, C.orange, C.gray]
    const tCounts = types.map(t => sitesData.filter(s => s.business_type === t).length)
    destroy('bizChart')
    const bizEl = document.getElementById('bizChart')
    if (bizEl) chartsRef.current['bizChart'] = new Chart(bizEl, { type: 'doughnut', data: { labels: types, datasets: [{ data: tCounts, backgroundColor: tColors, borderWidth: 2, borderColor: T.bgPanel }] }, options: { ...commonOpts, cutout: '55%', plugins: { legend: { display: true, position: 'right', labels: { color: T.textSecondary, font: { size: 11 }, boxWidth: 12 } } } } })

    const alias = { 'kzn': 'KwaZulu-Natal', 'kwazulu-natal': 'KwaZulu-Natal', 'kwazulu natal': 'KwaZulu-Natal', 'free state': 'Free State', 'freestate': 'Free State', 'gauteng': 'Gauteng', 'limpopo': 'Limpopo', 'north west': 'North West', 'northwest': 'North West', 'western cape': 'Western Cape', 'mpumalanga': 'Mpumalanga', 'northern cape': 'Northern Cape', 'eastern cape': 'Eastern Cape', 'lusaka': 'Lusaka', 'zambia': 'Lusaka', 'copperbelt': 'Copperbelt', 'southern': 'Southern', 'central': 'Central', 'eastern': 'Eastern', 'northern': 'Northern', 'western': 'Western', 'north-western': 'North-Western', 'luapula': 'Luapula', 'muchinga': 'Muchinga' }
    const featName = f => f.properties.NAME_1 || f.properties.name || ''
    const lerp = (a, b, t) => Math.round(a + (b - a) * t)
    const blueRamp = (t) => {
      if (t <= 0) return '#2a3950'
      const from = [42, 57, 80], to = [43, 127, 212]
      return `rgb(${lerp(from[0], to[0], t)},${lerp(from[1], to[1], t)},${lerp(from[2], to[2], t)})`
    }

    function buildGeoMap(canvasId, rawMap, { decimals = 1, unit = 'MWp' } = {}) {
      destroy(canvasId)
      const el = document.getElementById(canvasId)
      if (!el) return
      const features = window._zaFeatures
      const normMap = {}
      Object.entries(rawMap).forEach(([p, v]) => {
        const norm = alias[p.trim().toLowerCase()]
        if (norm) normMap[norm] = (normMap[norm] || 0) + v
      })
      if (features && features.length) {
        const labelPlugin = {
          id: canvasId + 'Labels',
          afterDatasetsDraw(chart) {
            const meta = chart.getDatasetMeta(0)
            const ds = chart.data.datasets[0]
            const { ctx } = chart
            const maxVal = Math.max(...ds.data.map(d => d.value), 0.001)
            ctx.save()
            ctx.font = 'bold 11px Segoe UI'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            meta.data.forEach((elm, i) => {
              const v = ds.data[i].value
              if (!v || v <= 0) return
              const cp = elm.getCenterPoint ? elm.getCenterPoint() : null
              if (!cp) return
              const t = v / maxVal
              ctx.fillStyle = t > 0.4 ? '#ffffff' : T.textSecondary
              ctx.fillText(decimals === 0 ? String(Math.round(v)) : v.toFixed(decimals), cp.x, cp.y)
            })
            ctx.restore()
          }
        }
        chartsRef.current[canvasId] = new Chart(el, {
          type: 'choropleth',
          data: {
            labels: features.map(featName),
            datasets: [{
              outline: features,
              data: features.map(f => ({ feature: f, value: +((normMap[featName(f)] || 0)).toFixed(decimals) })),
              borderColor: T.border,
              borderWidth: 1.5,
            }]
          },
          plugins: [labelPlugin],
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: { callbacks: { label: ctx => `${featName(ctx.raw.feature)}: ${ctx.raw.value} ${unit}` } }
            },
            scales: {
              projection: { axis: 'x', projection: 'mercator' },
              color: { axis: 'x', interpolate: blueRamp, legend: { display: false } }
            }
          }
        })
      } else {
        const keys = Object.keys(rawMap).sort((a, b) => rawMap[b] - rawMap[a]).slice(0, 9)
        chartsRef.current[canvasId] = new Chart(el, { type: 'bar', data: { labels: keys, datasets: [{ data: keys.map(p => rawMap[p].toFixed(decimals)), backgroundColor: T.blue, borderRadius: 4 }] }, options: { ...commonOpts, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: tickColor, maxRotation: 40, font: { size: 9 } } }, y: { grid: { color: gridColor }, ticks: { color: tickColor, callback: v => v + ' ' + unit } } } } })
      }
    }

    const provCapMap = {}
    sitesData.forEach(s => { const p = s.province || 'Unknown'; provCapMap[p] = (provCapMap[p] || 0) + (s.capacity_kw || 0) / 1000 })
    buildGeoMap('provMwpChart', provCapMap, { decimals: 1, unit: 'MWp' })

    const provCountMap = {}
    sitesData.forEach(s => { const p = s.province || 'Unknown'; provCountMap[p] = (provCountMap[p] || 0) + 1 })
    buildGeoMap('provSitesChart', provCountMap, { decimals: 0, unit: 'sites' })

    const provBessMap = {}
    sitesData.forEach(s => { const p = s.province || 'Unknown'; if (s.battery_size_wh > 0) provBessMap[p] = (provBessMap[p] || 0) + (s.battery_size_wh || 0) })
    const bessKeys = Object.keys(provBessMap).sort((a, b) => provBessMap[b] - provBessMap[a])
    destroy('provBessChart')
    const provBessEl = document.getElementById('provBessChart')
    if (provBessEl) chartsRef.current['provBessChart'] = new Chart(provBessEl, { type: 'bar', data: { labels: bessKeys.length ? bessKeys : ['No BESS data'], datasets: [{ data: bessKeys.length ? bessKeys.map(p => (provBessMap[p]/1000000).toFixed(2)) : [0], backgroundColor: T.yellow, borderRadius: 4 }] }, options: { ...commonOpts, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: tickColor, maxRotation: 40, font: { size: 9 } } }, y: { grid: { color: gridColor }, ticks: { color: tickColor, callback: v => v+' MWh' } } } } })

    const otherC = sitesData.filter(s => s.system_type !== 'PPA' && s.system_type !== 'RTO').length
    const ppa = sitesData.filter(s => s.system_type === 'PPA').length
    const rto = sitesData.filter(s => s.system_type === 'RTO').length
    destroy('contractChart')
    const conEl = document.getElementById('contractChart')
    if (conEl) chartsRef.current['contractChart'] = new Chart(conEl, { type: 'doughnut', data: { labels: ['PPA','RTO','Other'], datasets: [{ data: [ppa,rto,otherC], backgroundColor: [T.blue, T.green, C.gray], borderWidth: 2, borderColor: T.bgPanel }] }, options: { ...commonOpts, cutout: '60%', plugins: { legend: { display: true, position: 'right', labels: { color: T.textSecondary, font: { size: 11 }, boxWidth: 12 } } } } })

    const invList = ['SSI','Anuva','12B Fund']
    const invCounts = invList.map(inv => sitesData.filter(s => s.investment_party === inv).length)
    destroy('investorChart')
    const invEl = document.getElementById('investorChart')
    if (invEl) chartsRef.current['investorChart'] = new Chart(invEl, { type: 'doughnut', data: { labels: invList, datasets: [{ data: invCounts, backgroundColor: [T.blue, T.yellow, T.green], borderWidth: 2, borderColor: T.bgPanel }] }, options: { ...commonOpts, cutout: '60%', plugins: { legend: { display: true, position: 'right', labels: { color: T.textSecondary, font: { size: 11 }, boxWidth: 12 } } } } })

    const invCaps = invList.map(inv => (sitesData.filter(s => s.investment_party === inv).reduce((s,x) => s+(x.capacity_kw||0), 0)/1000).toFixed(2))
    destroy('invCapChart')
    const invCapEl = document.getElementById('invCapChart')
    if (invCapEl) chartsRef.current['invCapChart'] = new Chart(invCapEl, { type: 'bar', data: { labels: invList, datasets: [{ data: invCaps, backgroundColor: [T.blue, T.yellow, T.green], borderRadius: 8 }] }, options: { ...commonOpts, plugins: { legend: { display: false } }, scales: { y: { grid: { color: gridColor }, ticks: { color: tickColor, callback: v => v+' MWp' } } } } })
  }

  function handlePerfFile(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const rows = parseCSV(reader.result)
      const headers = rows[0].map(h => h.trim().toLowerCase())
      const idx = {
        name: headers.findIndex(h => h.includes('site name')),
        date: headers.findIndex(h => h === 'date'),
        measured: headers.findIndex(h => h.includes('measured')),
        expected: headers.findIndex(h => h.includes('expected')),
        perf: headers.findIndex(h => h === 'performance'),
        band: headers.findIndex(h => h.includes('pf band')),
      }
      if (idx.name < 0 || idx.date < 0) { setUpMsg('❌ Performance CSV must have "Site Name" and "Date" columns'); return }
      const parsed = [], errors = []
      rows.slice(1).forEach((r, i) => {
        const name = (r[idx.name] || '').trim()
        const [month, year] = parseMonthYear(r[idx.date])
        if (!name || !month) { errors.push(i + 2); return }
        const rec = { site_name: name, month, year }
        if (idx.measured >= 0) rec.kwh_produced = parseNum(r[idx.measured])
        if (idx.expected >= 0) rec.expected_kwh = parseNum(r[idx.expected])
        if (idx.perf >= 0) rec.performance_pct = parseNum(r[idx.perf])
        if (idx.band >= 0) rec.pf_band = cleanStr(r[idx.band])
        parsed.push(rec)
      })
      // De-duplicate by site+month+year (last occurrence wins) so upsert batches don't
      // hit "ON CONFLICT cannot affect row a second time"
      const seen = new Map()
      parsed.forEach(rec => seen.set(`${rec.site_name.toLowerCase()}|${rec.month}|${rec.year}`, rec))
      const deduped = [...seen.values()]
      const dupCount = parsed.length - deduped.length
      setUpPerf({ rows: deduped, errors, fileName: file.name, dupCount })
      setUpMsg('')
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  function handleSitesFile(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const rows = parseCSV(reader.result)
      const headers = rows[0].map(h => h.trim().toLowerCase())
      const find = (s) => headers.findIndex(h => h.includes(s))
      const idx = {
        name: find('site name'), location: find('location'), province: find('province'),
        country: find('country'), capacity: find('pv capacity'), date: find('commisioned date'),
        status: find('operational'), battery_name: find('battery name'), contract: find('contract type'),
        business: find('business type'), investor: find('investment party'), battery_wh: find('battery size (wh)'),
        installer: find('installer name'), project: find('project number'), platform: headers.findIndex(h => h === 'platform'),
        age: find('age'),
      }
      if (idx.name < 0) { setUpMsg('❌ Sites CSV must have a "Site Name" column'); return }
      const parsed = [], errors = []
      rows.slice(1).forEach((r, i) => {
        const name = (r[idx.name] || '').trim()
        if (!name) { errors.push(i + 2); return }
        const province = idx.province >= 0 ? cleanStr(r[idx.province]) : null
        const location = idx.location >= 0 ? cleanStr(r[idx.location]) : null
        const country = idx.country >= 0 ? cleanStr(r[idx.country]) : null
        const rec = {
          name,
          location: [location || province, country].filter(Boolean).join(', ') || null,
          province,
          capacity_kw: idx.capacity >= 0 && parseNum(r[idx.capacity]) != null ? parseNum(r[idx.capacity]) / 1000 : null,
          battery_size_wh: idx.battery_wh >= 0 ? parseNum(r[idx.battery_wh]) : null,
          system_type: idx.contract >= 0 ? cleanStr(r[idx.contract]) : null,
          business_type: idx.business >= 0 ? cleanStr(r[idx.business]) : null,
          investment_party: idx.investor >= 0 ? cleanStr(r[idx.investor]) : null,
          installer_name: idx.installer >= 0 ? cleanStr(r[idx.installer]) : null,
          project_number: idx.project >= 0 ? cleanStr(r[idx.project]) : null,
          platform: idx.platform >= 0 ? cleanStr(r[idx.platform]) : null,
          inverter_brand: idx.battery_name >= 0 ? cleanStr(r[idx.battery_name]) : null,
          age_years: idx.age >= 0 && parseNum(r[idx.age]) != null ? parseNum(r[idx.age]) : null,
        }
        if (idx.date >= 0) {
          const d = (r[idx.date] || '').trim()
          const p = d.split('/')
          // CSV is dd/mm/yyyy → store as yyyy-mm-dd
          rec.commissioned_date = p.length === 3 ? `${p[2]}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}` : null
          rec.install_date = rec.commissioned_date
        }
        if (idx.status >= 0) {
          const s = (r[idx.status] || '').trim().toLowerCase()
          rec.status = s.includes('decommission') ? 'inactive' : 'active'
        }
        parsed.push(rec)
      })
      setUpSites({ rows: parsed, errors, fileName: file.name })
      setUpMsg('')
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  async function uploadPerf() {
    if (!upPerf?.rows?.length) return
    setUpBusy(true)
    setUpMsg('Uploading performance data...')
    let done = 0, failed = 0, lastErr = ''
    for (let i = 0; i < upPerf.rows.length; i += 500) {
      const batch = upPerf.rows.slice(i, i + 500)
      const { error } = await supabase.from('performance').upsert(batch, { onConflict: 'site_name,month,year' })
      if (error) {
        console.error('Batch failed, retrying row-by-row:', error)
        lastErr = error.message || String(error)
        // Retry individually so one bad row doesn't fail the whole batch
        for (const row of batch) {
          const { error: rowErr } = await supabase.from('performance').upsert([row], { onConflict: 'site_name,month,year' })
          if (rowErr) { failed++; lastErr = rowErr.message || String(rowErr); console.error('Row failed:', row, rowErr) }
          else done++
          setUpMsg(`Uploading... ${done + failed}/${upPerf.rows.length}`)
        }
      } else {
        done += batch.length
        setUpMsg(`Uploading... ${done + failed}/${upPerf.rows.length}`)
      }
    }
    setUpMsg(failed === 0 ? `✅ ${done} performance records uploaded successfully` : `⚠️ ${done} uploaded, ${failed} failed. Reason: ${lastErr || 'see console (F12)'}`)
    setUpPerf(null)
    setPerfData([])
    setUpBusy(false)
  }

  async function uploadSites() {
    if (!upSites?.rows?.length) return
    setUpBusy(true)
    setUpMsg('Uploading site data...')
    let done = 0, failed = 0
    for (let i = 0; i < upSites.rows.length; i += 200) {
      const batch = upSites.rows.slice(i, i + 200)
      const { error } = await supabase.from('sites').upsert(batch, { onConflict: 'name' })
      if (error) { failed += batch.length; console.error(error) }
      else done += batch.length
      setUpMsg(`Uploading... ${done + failed}/${upSites.rows.length}`)
    }
    setUpMsg(failed === 0 ? `✅ ${done} sites uploaded successfully` : `⚠️ ${done} uploaded, ${failed} failed — check console (F12)`)
    setUpSites(null)
    const { data: sitesData } = await supabase.from('sites').select('*').order('name')
    setSites(sitesData || [])
    setUpBusy(false)
  }

  function handleCommentsFile(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const rows = parseCSV(reader.result)
      const headers = rows[0].map(h => h.trim().toLowerCase())
      const idx = {
        name: headers.findIndex(h => h.includes('site name')),
        date: headers.findIndex(h => h === 'date'),
        availability: headers.findIndex(h => h.includes('availability')),
        downtime: headers.findIndex(h => h.includes('downtime (days)') || (h.includes('downtime') && h.includes('day'))),
        cause: headers.findIndex(h => h.includes('cause')),
        tech: headers.findIndex(h => h.includes('technical')),
        energy: headers.findIndex(h => h.includes('energy impact')),
        other: headers.findIndex(h => h.includes('other comment')),
      }
      if (idx.name < 0 || idx.date < 0) { setUpMsg(`❌ Comments CSV must have "Site Name" and "Date" columns. Detected headers: ${headers.join(' | ') || '(none — check the file is semicolon or comma separated)'}`); return }
      const parsed = [], errors = []
      let emptySkipped = 0
      rows.slice(1).forEach((r, i) => {
        const name = (r[idx.name] || '').trim()
        const [month, year] = parseMonthYear(r[idx.date])
        if (!name || !month) { errors.push(i + 2); return }
        const availability = idx.availability >= 0 ? rawStr(r[idx.availability]) : null
        const downtime_days = idx.downtime >= 0 ? rawStr(r[idx.downtime]) : null
        const cause_of_downtime = idx.cause >= 0 ? rawStr(r[idx.cause]) : null
        const technical_events = idx.tech >= 0 ? rawStr(r[idx.tech]) : null
        const energy_impact = idx.energy >= 0 ? rawStr(r[idx.energy]) : null
        const other_comments = idx.other >= 0 ? rawStr(r[idx.other]) : null
        if (!availability && !downtime_days && !cause_of_downtime && !technical_events && !energy_impact && !other_comments) { emptySkipped++; return }
        parsed.push({ site_name: name, month, year, availability, downtime_days, cause_of_downtime, technical_events, energy_impact, other_comments, comment: null })
      })
      setUpComments({ rows: parsed, errors, emptySkipped, fileName: file.name })
      setUpMsg('')
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  async function uploadComments() {
    if (!upComments?.rows?.length) return
    setUpBusy(true)
    setUpMsg('Uploading comments...')
    let done = 0, failed = 0
    for (let i = 0; i < upComments.rows.length; i += 500) {
      const batch = upComments.rows.slice(i, i + 500)
      const { error } = await supabase.from('performance').upsert(batch, { onConflict: 'site_name,month,year' })
      if (error) { failed += batch.length; console.error(error) }
      else done += batch.length
      setUpMsg(`Uploading... ${done + failed}/${upComments.rows.length}`)
    }
    setUpMsg(failed === 0 ? `✅ ${done} comments uploaded successfully` : `⚠️ ${done} uploaded, ${failed} failed — check console (F12)`)
    setUpComments(null)
    setPerfData([])
    setUpBusy(false)
  }

  function handleOgFile(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const rows = parseCSV(reader.result)
      const headers = rows[0].map(h => h.trim().toLowerCase())
      const find = (s) => headers.findIndex(h => h.includes(s))
      const idx = {
        name: find('site name'), og: find('offtake guarantee'), util: find('expected utilisation'),
        age: find('age'), asbuilt: find('as-built'), guaranteed: find('guaranteed generation'),
        unavail: find('unavailability'), correct: find('correct'), actual: find('actual generation'),
        shortfall: find('shortfall'), perf: find('performance rate'), notes: find('notes'),
      }
      if (idx.name < 0) { setUpMsg(`❌ Offtake CSV must have a "Site Name" column. Detected headers: ${headers.join(' | ')}`); return }
      const parsed = [], errors = []
      rows.slice(1).forEach((r, i) => {
        const name = (r[idx.name] || '').trim()
        if (!name) { errors.push(i + 2); return }
        parsed.push({
          site_name: name,
          has_guarantee: idx.og >= 0 ? (r[idx.og] || '').trim().toUpperCase() === 'YES' : true,
          expected_utilisation: idx.util >= 0 ? parseNum(r[idx.util]) : null,
          og_age: idx.age >= 0 ? parseNum(r[idx.age]) : null,
          as_built_kwh: idx.asbuilt >= 0 ? parseNum(r[idx.asbuilt]) : null,
          guaranteed_kwh: idx.guaranteed >= 0 ? parseNum(r[idx.guaranteed]) : null,
          unavailability_kwh: idx.unavail >= 0 ? parseNum(r[idx.unavail]) : null,
          correct_kwh: idx.correct >= 0 ? parseNum(r[idx.correct]) : null,
          actual_kwh: idx.actual >= 0 ? parseNum(r[idx.actual]) : null,
          shortfall_kwh: idx.shortfall >= 0 ? parseNum(r[idx.shortfall]) : null,
          performance_rate: idx.perf >= 0 ? parseNum(r[idx.perf]) : null,
          notes: idx.notes >= 0 ? rawStr(r[idx.notes]) : null,
        })
      })
      setUpOg({ rows: parsed, errors, fileName: file.name })
      setUpMsg('')
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  async function uploadOg() {
    if (!upOg?.rows?.length) return
    setUpBusy(true)
    setUpMsg('Uploading offtake guarantees...')
    let done = 0, failed = 0
    for (let i = 0; i < upOg.rows.length; i += 200) {
      const batch = upOg.rows.slice(i, i + 200)
      const { error } = await supabase.from('offtake_guarantees').upsert(batch, { onConflict: 'site_name' })
      if (error) { failed += batch.length; console.error(error) }
      else done += batch.length
      setUpMsg(`Uploading... ${done + failed}/${upOg.rows.length}`)
    }
    setUpMsg(failed === 0 ? `✅ ${done} offtake guarantees uploaded successfully` : `⚠️ ${done} uploaded, ${failed} failed — check console (F12)`)
    setUpOg(null)
    setOgData([])
    setUpBusy(false)
  }

  useEffect(() => {
    if (activePage === 'siteperf' && chartReady && perfData.length > 0 && spSite) {
      setTimeout(() => buildSitePerfCharts(), 100)
    }
  }, [activePage, chartReady, perfData, spSite, spYear, spYearA, spYearB])

  function buildSitePerfCharts() {
    if (typeof window === 'undefined') return
    const Chart = window.Chart
    if (!Chart || !spSite) return
    const destroy = (id) => { if (chartsRef.current[id]) { chartsRef.current[id].destroy(); delete chartsRef.current[id] } }
    const gridColor = '#3c4f6a'
    const tickColor = '#9ab4cf'
    const C = { blue: T.blue, yellow: T.yellow, green: T.green, red: T.red, gray: '#2a4a6a', dark: T.textSecondary }
    const recs = perfData.filter(p => p.site_name?.trim().toLowerCase() === spSite.trim().toLowerCase())
    const years = [...new Set(recs.map(p => p.year))].sort()
    const monthLabels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

    const yr = parseInt(spYear) || years[years.length - 1]
    const measured = [], expected = [], delta = []
    for (let m = 1; m <= 12; m++) {
      const r = recs.find(p => p.year === yr && p.month === m)
      const me = r?.kwh_produced ?? null
      const ex = r?.expected_kwh ?? null
      measured.push(me); expected.push(ex)
      delta.push(me != null && ex ? +(((me - ex) / ex) * 100).toFixed(1) : null)
    }
    const deltaLabelPlugin = {
      id: 'deltaLabels',
      afterDatasetsDraw(chart) {
        const ds = chart.data.datasets[0]
        if (!ds || ds.yAxisID !== 'y1') return
        const meta = chart.getDatasetMeta(0)
        const { ctx } = chart
        ctx.save()
        ctx.font = 'bold 10px Segoe UI'
        ctx.textAlign = 'center'
        meta.data.forEach((bar, i) => {
          const v = ds.data[i]
          if (v == null) return
          ctx.fillStyle = v >= 0 ? T.green : T.red
          const y = v >= 0 ? bar.y - 5 : bar.y + 13
          ctx.fillText((v > 0 ? '+' : '') + v + '%', bar.x, y)
        })
        ctx.restore()
      }
    }

    destroy('spExpMeasChart')
    const el1 = document.getElementById('spExpMeasChart')
    if (el1) chartsRef.current['spExpMeasChart'] = new Chart(el1, {
      data: {
        labels: monthLabels,
        datasets: [
          { type: 'bar', label: 'Δ % vs expected', data: delta, backgroundColor: delta.map(v => v == null ? C.gray : v >= 0 ? C.green : C.red), yAxisID: 'y1', barPercentage: 0.18, categoryPercentage: 0.9, borderRadius: 2 },
          { type: 'bar', label: 'Expected (kWh)', data: expected, backgroundColor: C.gray, borderRadius: 4 },
          { type: 'bar', label: 'Measured (kWh)', data: measured, backgroundColor: C.blue, borderRadius: 4 },
        ]
      },
      plugins: [deltaLabelPlugin],
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { top: 16 } },
        plugins: { legend: { position: 'top', labels: { color: T.textSecondary, font: { size: 11 }, boxWidth: 12 } }, tooltip: { callbacks: { label: ctx => ctx.dataset.yAxisID === 'y1' ? `Δ ${ctx.parsed.y > 0 ? '+' : ''}${ctx.parsed.y}%` : `${ctx.dataset.label}: ${ctx.parsed.y?.toLocaleString()} kWh` } } },
        scales: {
          x: { ticks: { color: tickColor }, grid: { color: gridColor } },
          y: { grid: { color: gridColor }, ticks: { color: tickColor, callback: v => (v/1000).toFixed(0)+'k' } },
          y1: { position: 'right', grid: { drawOnChartArea: false }, ticks: { color: tickColor, callback: v => v + '%' } }
        }
      }
    })

    const yA = parseInt(spYearA) || years[years.length - 1]
    const yB = parseInt(spYearB) || years[years.length - 2] || yA
    const mA = [], mB = [], dY = []
    for (let m = 1; m <= 12; m++) {
      const ra = recs.find(p => p.year === yA && p.month === m)
      const rb = recs.find(p => p.year === yB && p.month === m)
      const a = ra?.kwh_produced ?? null
      const b = rb?.kwh_produced ?? null
      mA.push(a); mB.push(b)
      dY.push(a != null && b ? +(((a - b) / b) * 100).toFixed(1) : null)
    }
    destroy('spYoYChart')
    const el2 = document.getElementById('spYoYChart')
    if (el2) chartsRef.current['spYoYChart'] = new Chart(el2, {
      data: {
        labels: monthLabels,
        datasets: [
          { type: 'bar', label: 'Δ % vs ' + yB, data: dY, backgroundColor: dY.map(v => v == null ? C.gray : v >= 0 ? C.green : C.red), yAxisID: 'y1', barPercentage: 0.18, categoryPercentage: 0.9, borderRadius: 2 },
          { type: 'bar', label: yB + ' Measured (kWh)', data: mB, backgroundColor: C.gray, borderRadius: 4 },
          { type: 'bar', label: yA + ' Measured (kWh)', data: mA, backgroundColor: C.blue, borderRadius: 4 },
        ]
      },
      plugins: [deltaLabelPlugin],
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { top: 16 } },
        plugins: { legend: { position: 'top', labels: { color: T.textSecondary, font: { size: 11 }, boxWidth: 12 } }, tooltip: { callbacks: { label: ctx => ctx.dataset.yAxisID === 'y1' ? `Δ ${ctx.parsed.y > 0 ? '+' : ''}${ctx.parsed.y}%` : `${ctx.dataset.label}: ${ctx.parsed.y?.toLocaleString()} kWh` } } },
        scales: {
          x: { ticks: { color: tickColor }, grid: { color: gridColor } },
          y: { grid: { color: gridColor }, ticks: { color: tickColor, callback: v => (v/1000).toFixed(0)+'k' } },
          y1: { position: 'right', grid: { drawOnChartArea: false }, ticks: { color: tickColor, callback: v => v + '%' } }
        }
      }
    })
  }

  function buildPerfCharts(data) {
    if (typeof window === 'undefined') return
    const Chart = window.Chart
    if (!Chart) return
    const destroy = (id) => { if (chartsRef.current[id]) { chartsRef.current[id].destroy(); delete chartsRef.current[id] } }
    const gridColor = '#3c4f6a'
    const tickColor = '#9ab4cf'
    const C = { blue: T.blue, yellow: T.yellow, green: T.green, red: T.red, gray: '#2a4a6a' }

    const exp = data.filter(p => p.pf_band === 'Expected').length
    const mod = data.filter(p => p.pf_band === 'Moderate').length
    const poor = data.filter(p => p.pf_band === 'Poor').length
    destroy('pfBandChart')
    const pfEl = document.getElementById('pfBandChart')
    if (pfEl) chartsRef.current['pfBandChart'] = new Chart(pfEl, { type: 'pie', data: { labels: ['Expected','Moderate','Poor'], datasets: [{ data: [exp,mod,poor], backgroundColor: [C.blue, C.yellow, C.red], borderWidth: 2, borderColor: T.bgPanel }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true, position: 'right', labels: { color: T.textSecondary, font: { size: 11 }, boxWidth: 12 } } } } })

    const siteMap = {}
    data.filter(p => p.kwh_produced != null).forEach(p => {
      if (!siteMap[p.site_name]) siteMap[p.site_name] = { measured: 0, expected: 0 }
      siteMap[p.site_name].measured += p.kwh_produced || 0
      siteMap[p.site_name].expected += p.expected_kwh || 0
    })
    const topSites = Object.entries(siteMap).sort((a,b) => b[1].measured - a[1].measured).slice(0,10)
    destroy('measVsExpChart')
    const mvEl = document.getElementById('measVsExpChart')
    if (mvEl) chartsRef.current['measVsExpChart'] = new Chart(mvEl, {
      type: 'bar',
      data: {
        labels: topSites.map(([name]) => name.length > 15 ? name.slice(0,15)+'…' : name),
        datasets: [
          { label: 'Measured (kWh)', data: topSites.map(([,v]) => Math.round(v.measured)), backgroundColor: C.blue, borderRadius: 4 },
          { label: 'Expected (kWh)', data: topSites.map(([,v]) => Math.round(v.expected)), backgroundColor: C.gray, borderRadius: 4 }
        ]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true, position: 'top', labels: { color: T.textSecondary, font: { size: 11 }, boxWidth: 12 } } }, scales: { x: { ticks: { color: tickColor, maxRotation: 40, font: { size: 9 } } }, y: { grid: { color: gridColor }, ticks: { color: tickColor, callback: v => (v/1000).toFixed(0)+'k' } } } }
    })
  }

  // ── Badge helpers (dark theme) ──────────────────────────────────────────────
  function statusBadge(status) {
    const map = {
      active:   { bg: 'rgba(125,194,66,0.12)',  color: '#7DC242', border: 'rgba(125,194,66,0.3)' },
      inactive: { bg: 'rgba(239,68,68,0.12)',   color: '#ef4444', border: 'rgba(239,68,68,0.3)' },
    }
    const s = map[status] || { bg: 'rgba(74,122,170,0.12)', color: T.textSecondary, border: T.border }
    return <span style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}`, borderRadius: '20px', padding: '2px 9px', fontSize: '10px', fontWeight: 600, letterSpacing: '0.5px' }}>{status || 'active'}</span>
  }

  function typeBadge(type) {
    const map = {
      Retail:       `rgba(245,208,0,0.12)|#F5D000|rgba(245,208,0,0.3)`,
      Manufacture:  `rgba(139,92,246,0.12)|#a78bfa|rgba(139,92,246,0.3)`,
      Residential:  `rgba(125,194,66,0.12)|#7DC242|rgba(125,194,66,0.3)`,
      Commercial:   `rgba(43,127,212,0.12)|#2B7FD4|rgba(43,127,212,0.3)`,
      Agricultural: `rgba(240,165,0,0.12)|#f0a500|rgba(240,165,0,0.3)`,
    }
    const parts = (map[type] || `rgba(74,122,170,0.12)|${T.textSecondary}|${T.border}`).split('|')
    return <span style={{ background: parts[0], color: parts[1], border: `1px solid ${parts[2]}`, borderRadius: '20px', padding: '2px 9px', fontSize: '10px', fontWeight: 600 }}>{type || '--'}</span>
  }

  function pfBadge(band) {
    const map = {
      Expected: `rgba(43,127,212,0.15)|#3d8fe0|rgba(43,127,212,0.35)`,
      Moderate: `rgba(245,208,0,0.12)|#F5D000|rgba(245,208,0,0.3)`,
      Poor:     `rgba(239,68,68,0.12)|#ef4444|rgba(239,68,68,0.3)`,
    }
    const parts = (map[band] || `rgba(74,122,170,0.12)|${T.textSecondary}|${T.border}`).split('|')
    return <span style={{ background: parts[0], color: parts[1], border: `1px solid ${parts[2]}`, borderRadius: '20px', padding: '2px 9px', fontSize: '10px', fontWeight: 600 }}>{band || '--'}</span>
  }

  // ── Shared style helpers ────────────────────────────────────────────────────
  const selectStyle = {
    padding: '7px 12px',
    border: `1px solid ${T.border}`,
    borderRadius: '8px',
    fontSize: '12px',
    color: T.textPrimary,
    background: T.bgInput,
    outline: 'none',
    cursor: 'pointer',
  }

  const cardStyle = {
    background: T.bgPanel,
    border: `1px solid ${T.border}`,
    borderRadius: '12px',
  }

  const cardTitleStyle = {
    fontSize: '13px',
    fontWeight: 600,
    color: T.textPrimary,
    marginBottom: '12px',
    display: 'flex',
    alignItems: 'center',
    gap: '7px',
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontSize: '14px', color: T.textSecondary, background: T.bgBase, fontFamily: "'Segoe UI', sans-serif" }}>
      <div style={{ textAlign: 'center' }}>
        <svg width="48" height="54" viewBox="0 0 46 52" fill="none" style={{ marginBottom: '16px', opacity: 0.8 }}>
          <ellipse cx="23" cy="16" rx="18" ry="16" fill="#F5D000"/>
          <ellipse cx="23" cy="36" rx="18" ry="16" fill="#2B7FD4"/>
          <rect x="14" y="20" width="14" height="12" rx="2" fill="#7DC242" transform="rotate(-8 14 20)"/>
        </svg>
        <div style={{ color: T.textSecondary }}>Loading Sosimple Portal...</div>
      </div>
    </div>
  )

  const fCap = filteredOverview.reduce((sum, s) => sum + (s.capacity_kw || 0), 0)
  const fBess = filteredOverview.reduce((sum, s) => sum + (s.battery_size_wh || 0), 0)
  const fPpa = filteredOverview.filter(s => s.system_type === 'PPA').length
  const fRto = filteredOverview.filter(s => s.system_type === 'RTO').length

  const pfExp = filteredPerf.filter(p => p.pf_band === 'Expected').length
  const pfMod = filteredPerf.filter(p => p.pf_band === 'Moderate').length
  const pfPoor = filteredPerf.filter(p => p.pf_band === 'Poor').length
  const pfTotalMeasured = filteredPerf.reduce((sum, p) => sum + (p.kwh_produced || 0), 0)
  const pfTotalExpected = filteredPerf.reduce((sum, p) => sum + (p.expected_kwh || 0), 0)
  const pfAvgPerf = filteredPerf.filter(p => p.performance_pct != null).length > 0
    ? (filteredPerf.filter(p => p.performance_pct != null).reduce((sum, p) => sum + p.performance_pct, 0) / filteredPerf.filter(p => p.performance_pct != null).length).toFixed(1)
    : '--'

  return (
    <>
      <style>{`
        @import url('https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@2.44.0/tabler-icons.min.css');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Segoe UI', sans-serif; background: ${T.bgBase}; color: ${T.textPrimary}; }

        /* Scrollbars */
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: ${T.bgBase}; }
        ::-webkit-scrollbar-thumb { background: ${T.border}; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: ${T.blue}; }

        /* Nav hover */
        .nav-item { transition: all 0.15s ease; }
        .nav-item:hover { background: rgba(43,127,212,0.12) !important; color: ${T.blue} !important; }

        /* Table row hover */
        .tbl-row:hover td { background: rgba(43,127,212,0.06) !important; }

        /* Tab hover */
        .tab:hover { background: rgba(43,127,212,0.12) !important; }

        /* Input focus */
        input:focus { border-color: ${T.blue} !important; box-shadow: 0 0 0 3px rgba(43,127,212,0.15) !important; outline: none; }
        select:focus { border-color: ${T.blue} !important; outline: none; }
        select option { background: ${T.bgPanel}; color: ${T.textPrimary}; }

        /* Glow on active nav */
        .nav-active { box-shadow: inset 3px 0 0 ${T.blue}; }

        @media print {
          .no-print { display: none !important; }
          body { background: #fff !important; color: #000 !important; }
          .layout-flex { height: auto !important; display: block !important; }
          .main-area { overflow: visible !important; padding: 0 !important; }
          .print-area { border: none !important; box-shadow: none !important; background: #fff !important; color: #000 !important; }
        }
      `}</style>

      {/* ── TOPBAR ─────────────────────────────────────────────────────────── */}
      <div className="no-print" style={{
        background: T.bgPanelAlt,
        borderBottom: `2px solid ${T.blue}`,
        padding: '0 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: '64px',
        position: 'sticky',
        top: 0,
        zIndex: 100,
        boxShadow: `0 2px 20px rgba(43,127,212,0.2)`,
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <svg width="40" height="46" viewBox="0 0 46 52" fill="none">
            <ellipse cx="23" cy="16" rx="18" ry="16" fill="#F5D000"/>
            <ellipse cx="23" cy="36" rx="18" ry="16" fill="#2B7FD4"/>
            <rect x="14" y="20" width="14" height="12" rx="2" fill="#7DC242" transform="rotate(-8 14 20)"/>
          </svg>
          <div>
            <div style={{ fontSize: '20px', fontWeight: 800, color: T.textWhite, letterSpacing: '-0.5px' }}>Sosimple</div>
            <div style={{ fontSize: '10px', color: T.green, fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase' }}>Cheap energy. Clean business.</div>
          </div>
        </div>

        {/* Topbar pills */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {[
            { val: sites.length, label: 'Sites', color: T.blue, bg: 'rgba(43,127,212,0.12)', border: 'rgba(43,127,212,0.3)' },
            { val: `${(totalCap/1000).toFixed(2)} MWp`, label: null, color: T.yellow, bg: 'rgba(245,208,0,0.1)', border: 'rgba(245,208,0,0.25)' },
            { val: `${totalBessMwh} MWh`, label: 'BESS', color: T.green, bg: 'rgba(125,194,66,0.1)', border: 'rgba(125,194,66,0.25)' },
          ].map((p, i) => (
            <span key={i} style={{ background: p.bg, border: `1px solid ${p.border}`, borderRadius: '20px', padding: '4px 13px', fontSize: '11px', color: p.color, fontWeight: 600 }}>
              {p.val}{p.label ? ` ${p.label}` : ''}
            </span>
          ))}
          <span style={{ fontSize: '12px', color: T.textSecondary, marginLeft: '4px' }}>
            {user?.full_name || 'Employee'}
          </span>
          <button onClick={signOut} style={{ background: 'rgba(43,127,212,0.12)', border: `1px solid rgba(43,127,212,0.3)`, borderRadius: '8px', padding: '6px 14px', color: T.blue, fontSize: '12px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s' }}
            onMouseEnter={e => { e.target.style.background = T.blue; e.target.style.color = '#fff' }}
            onMouseLeave={e => { e.target.style.background = 'rgba(43,127,212,0.12)'; e.target.style.color = T.blue }}>
            Sign Out
          </button>
        </div>
      </div>

      <div className="layout-flex" style={{ display: 'flex', height: 'calc(100vh - 64px)' }}>

        {/* ── SIDEBAR ──────────────────────────────────────────────────────── */}
        <nav className="no-print" style={{
          width: '220px',
          background: T.bgPanelAlt,
          borderRight: `1px solid ${T.border}`,
          padding: '16px 0',
          flexShrink: 0,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
        }}>
          {/* Subtle glow */}
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '1px', background: `linear-gradient(90deg, transparent, ${T.blue}, transparent)`, opacity: 0.5 }} />

          <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '1.5px', color: T.textMuted, padding: '8px 18px 6px', fontWeight: 700 }}>Portfolio</div>

          {[
            { id: 'overview',    icon: 'ti-dashboard',      label: 'Installation Overview' },
            { id: 'sites',       icon: 'ti-map-pin',        label: 'All Sites' },
            { id: 'performance', icon: 'ti-activity',       label: 'Performance' },
            { id: 'siteperf',    icon: 'ti-chart-line',     label: 'Site Performance' },
            { id: 'offtake',     icon: 'ti-shield-check',   label: 'Offtake Guarantees' },
            { id: 'report',      icon: 'ti-file-analytics', label: 'Reports' },
            { id: 'upload',      icon: 'ti-upload',         label: 'Data Upload' },
          ].map(item => (
            <div
              key={item.id}
              className={`nav-item${activePage === item.id ? ' nav-active' : ''}`}
              onClick={() => setActivePage(item.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '9px 18px',
                cursor: 'pointer',
                fontSize: '13px',
                color: activePage === item.id ? T.textWhite : T.textSecondary,
                borderLeft: `3px solid ${activePage === item.id ? T.blue : 'transparent'}`,
                background: activePage === item.id ? 'rgba(43,127,212,0.15)' : 'transparent',
                fontWeight: activePage === item.id ? 600 : 400,
                transition: 'all 0.15s',
              }}>
              <i className={`ti ${item.icon}`} style={{ fontSize: '16px', color: activePage === item.id ? T.blue : T.textMuted }} />
              <span>{item.label}</span>
            </div>
          ))}

          <div style={{ marginTop: 'auto', padding: '16px 18px', borderTop: `1px solid ${T.border}`, fontSize: '10px', color: T.textMuted, lineHeight: 1.7 }}>
            © 2026 Sosimple Energy<br />
            <span style={{ color: T.green }}>Cheap energy. Clean business.</span>
          </div>
        </nav>

        {/* ── MAIN CONTENT ─────────────────────────────────────────────────── */}
        <main className="main-area" style={{ flex: 1, overflowY: 'auto', padding: '22px', background: T.bgBase }}>

          {/* ── OVERVIEW ── */}
          {activePage === 'overview' && (
            <div>
              {/* Hero banner */}
              <div style={{
                background: `linear-gradient(135deg, #0d1f35 0%, #112840 60%, #0a1828 100%)`,
                border: `1px solid ${T.border}`,
                borderTop: `3px solid ${T.blue}`,
                borderRadius: '14px',
                padding: '22px 26px',
                marginBottom: '18px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '16px',
                position: 'relative',
                overflow: 'hidden',
              }}>
                {/* Decorative glow */}
                <div style={{ position: 'absolute', top: '-60px', right: '-60px', width: '200px', height: '200px', background: 'rgba(43,127,212,0.08)', borderRadius: '50%', pointerEvents: 'none' }} />
                <div>
                  <h2 style={{ fontSize: '20px', fontWeight: 800, color: T.textWhite, marginBottom: '4px', letterSpacing: '-0.3px' }}>Portfolio Dashboard</h2>
                  <p style={{ fontSize: '12px', color: T.textSecondary }}>{sites.length} solar installations across South Africa &amp; beyond</p>
                </div>
                <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
                  {[
                    { val: sites.length, label: 'Total Sites' },
                    { val: (totalCap/1000).toFixed(2), label: 'MWp Installed' },
                    { val: totalBessMwh, label: 'MWh BESS' },
                    { val: ppaCount, label: 'PPA Sites' },
                    { val: rtoCount, label: 'RTO Sites' },
                  ].map(s => (
                    <div key={s.label} style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '26px', fontWeight: 800, color: T.yellow, lineHeight: 1 }}>{s.val}</div>
                      <div style={{ fontSize: '10px', color: T.textSecondary, marginTop: '3px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{s.label}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Filter bar */}
              <div style={{ ...cardStyle, padding: '12px 16px', marginBottom: '16px', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: '11px', fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.8px' }}>
                  <i className="ti ti-filter" style={{ marginRight: '5px', color: T.blue }} />Filter
                </span>
                <select style={selectStyle} value={filterInvestor} onChange={e => setFilterInvestor(e.target.value)}>
                  <option value="">All Investors</option>
                  {investors.map(i => <option key={i}>{i}</option>)}
                </select>
                <select style={selectStyle} value={filterInstaller} onChange={e => setFilterInstaller(e.target.value)}>
                  <option value="">All Installers</option>
                  {installers.map(i => <option key={i}>{i}</option>)}
                </select>
                <select style={selectStyle} value={filterOverviewContract} onChange={e => setFilterOverviewContract(e.target.value)}>
                  <option value="">All Contracts</option>
                  <option>PPA</option><option>RTO</option>
                </select>
                {(filterInvestor || filterInstaller || filterOverviewContract) && (
                  <button onClick={() => { setFilterInvestor(''); setFilterInstaller(''); setFilterOverviewContract('') }}
                    style={{ ...selectStyle, background: 'rgba(239,68,68,0.1)', border: `1px solid rgba(239,68,68,0.3)`, color: T.red, cursor: 'pointer' }}>
                    Clear ×
                  </button>
                )}
                <span style={{ fontSize: '11px', color: T.textMuted, marginLeft: 'auto' }}>Showing {filteredOverview.length} of {sites.length} sites</span>
              </div>

              {/* KPI cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: '10px', marginBottom: '18px' }}>
                {[
                  { label: 'Total Sites', val: filteredOverview.length, sub: `${filteredOverview.filter(s=>s.status==='active').length} active`, accent: T.yellow },
                  { label: 'Capacity (MWp)', val: (fCap/1000).toFixed(2), accent: T.blue },
                  { label: 'BESS (MWh)', val: (fBess/1000000).toFixed(2), accent: T.green },
                  { label: 'PPA Sites', val: fPpa, accent: T.blue },
                  { label: 'RTO Sites', val: fRto, accent: T.green },
                  { label: 'Inactive Sites', val: filteredOverview.filter(s=>s.status==='inactive').length, accent: T.red },
                ].map(k => (
                  <div key={k.label} style={{ ...cardStyle, padding: '14px 16px', borderTop: `3px solid ${k.accent}` }}>
                    <div style={{ fontSize: '10px', color: T.textMuted, marginBottom: '6px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{k.label}</div>
                    <div style={{ fontSize: '28px', fontWeight: 800, color: k.accent }}>{k.val}</div>
                    {k.sub && <div style={{ fontSize: '10px', color: T.textMuted, marginTop: '2px' }}>{k.sub}</div>}
                  </div>
                ))}
              </div>

              {/* Charts row 1 */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
                <div style={{ ...cardStyle, padding: '18px' }}>
                  <div style={cardTitleStyle}><i className="ti ti-chart-donut" style={{ color: T.blue }} />By business type</div>
                  <div style={{ position: 'relative', height: '190px' }}><canvas id="bizChart" /></div>
                </div>
                <div style={{ ...cardStyle, padding: '18px' }}>
                  <div style={cardTitleStyle}><i className="ti ti-map" style={{ color: T.blue }} />MWp by province — South Africa &amp; Zambia</div>
                  <div style={{ position: 'relative', height: '300px' }}><canvas id="provMwpChart" /></div>
                </div>
              </div>

              {/* Charts row 2 */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
                <div style={{ ...cardStyle, padding: '18px' }}>
                  <div style={cardTitleStyle}><i className="ti ti-battery" style={{ color: T.green }} />MWh BESS by province</div>
                  <div style={{ position: 'relative', height: '190px' }}><canvas id="provBessChart" /></div>
                </div>
                <div style={{ ...cardStyle, padding: '18px' }}>
                  <div style={cardTitleStyle}><i className="ti ti-file-invoice" style={{ color: T.yellow }} />Contract split</div>
                  <div style={{ position: 'relative', height: '190px' }}><canvas id="contractChart" /></div>
                </div>
              </div>

              {/* Charts row 3 */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div style={{ ...cardStyle, padding: '18px' }}>
                  <div style={cardTitleStyle}><i className="ti ti-map-pin" style={{ color: T.blue }} />Sites by province — South Africa &amp; Zambia</div>
                  <div style={{ position: 'relative', height: '300px' }}><canvas id="provSitesChart" /></div>
                </div>
                <div style={{ ...cardStyle, padding: '18px' }}>
                  <div style={cardTitleStyle}><i className="ti ti-users" style={{ color: T.green }} />By investor</div>
                  <div style={{ position: 'relative', height: '300px' }}><canvas id="investorChart" /></div>
                </div>
              </div>
            </div>
          )}

          {/* ── ALL SITES ── */}
          {activePage === 'sites' && (
            <div>
              <div style={{ fontSize: '20px', fontWeight: 800, color: T.textWhite, marginBottom: '2px' }}>All Sites</div>
              <div style={{ fontSize: '12px', color: T.textSecondary, marginBottom: '18px' }}>Complete portfolio — {sites.length} solar installations</div>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
                <input type="text" placeholder="Search site name or location..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                  style={{ padding: '7px 12px', border: `1px solid ${T.border}`, borderRadius: '8px', fontSize: '12px', color: T.textPrimary, background: T.bgInput, flex: 1, minWidth: '160px', outline: 'none' }} />
                <select value={filterType} onChange={e => setFilterType(e.target.value)} style={selectStyle}>
                  <option value="">All Types</option>
                  {['Retail','Manufacture','Residential','Commercial','Agricultural'].map(t => <option key={t}>{t}</option>)}
                </select>
                <select value={filterContract} onChange={e => setFilterContract(e.target.value)} style={selectStyle}>
                  <option value="">All Contracts</option>
                  <option>PPA</option><option>RTO</option>
                </select>
              </div>
              <div style={{ fontSize: '11px', color: T.textMuted, marginBottom: '8px' }}>Showing {filteredSites.length} of {sites.length} sites</div>
              <div style={{ ...cardStyle, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ background: T.bgMuted, borderBottom: `2px solid ${T.border}` }}>
                      {['Site Name','Province','Capacity','BESS (kWh)','Type','Contract','Investor','Age','Status'].map(h => (
                        <th key={h} style={{ textAlign: 'left', padding: '9px 10px', fontSize: '10px', color: T.textMuted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.7px' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSites.map(site => (
                      <tr key={site.id} className="tbl-row" style={{ cursor: 'pointer', borderBottom: `1px solid ${T.border}` }} onClick={() => window.location.href = `/sites/${site.id}`}>
                        <td style={{ padding: '8px 10px', fontWeight: 600, color: T.blue }}>{site.name}</td>
                        <td style={{ padding: '8px 10px', color: T.textSecondary }}>{site.province || '—'}</td>
                        <td style={{ padding: '8px 10px', color: T.textPrimary }}>{site.capacity_kw} kWp</td>
                        <td style={{ padding: '8px 10px', color: T.textSecondary }}>{site.battery_size_wh > 0 ? (site.battery_size_wh/1000).toFixed(1) : '—'}</td>
                        <td style={{ padding: '8px 10px' }}>{typeBadge(site.business_type)}</td>
                        <td style={{ padding: '8px 10px', color: T.textSecondary }}>{site.system_type || '--'}</td>
                        <td style={{ padding: '8px 10px', color: T.textSecondary }}>{site.investment_party || '--'}</td>
                        <td style={{ padding: '8px 10px', color: T.textSecondary, whiteSpace: 'nowrap' }} title={site.commissioned_date ? `Commissioned ${site.commissioned_date}` : ''}>{fmtAge(site)}</td>
                        <td style={{ padding: '8px 10px' }}>{statusBadge(site.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── PERFORMANCE ── */}
          {activePage === 'performance' && (
            <div>
              <div style={{ fontSize: '20px', fontWeight: 800, color: T.textWhite, marginBottom: '2px' }}>Performance Overview</div>
              <div style={{ fontSize: '12px', color: T.textSecondary, marginBottom: '18px' }}>Monthly production data — measured vs expected across all sites</div>

              <div style={{ ...cardStyle, padding: '12px 16px', marginBottom: '16px', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: '11px', fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.8px' }}>
                  <i className="ti ti-filter" style={{ marginRight: '5px', color: T.blue }} />Filter
                </span>
                <select style={selectStyle} value={pfFilterInvestor} onChange={e => setPfFilterInvestor(e.target.value)}>
                  <option value="">All Investors</option>
                  {investors.map(i => <option key={i}>{i}</option>)}
                </select>
                <select style={selectStyle} value={pfFilterDate} onChange={e => setPfFilterDate(e.target.value)}>
                  <option value="">All Dates</option>
                  {perfDates.map(d => {
                    const [y, m] = d.split('-')
                    return <option key={d} value={d}>{monthNames[parseInt(m)-1]}-{y.slice(2)}</option>
                  })}
                </select>
                <select style={selectStyle} value={pfFilterBand} onChange={e => setPfFilterBand(e.target.value)}>
                  <option value="">All PF Bands</option>
                  <option>Expected</option><option>Moderate</option><option>Poor</option>
                </select>
                {(pfFilterInvestor || pfFilterDate || pfFilterBand) && (
                  <button onClick={() => { setPfFilterInvestor(''); setPfFilterDate(''); setPfFilterBand('') }}
                    style={{ ...selectStyle, background: 'rgba(239,68,68,0.1)', border: `1px solid rgba(239,68,68,0.3)`, color: T.red, cursor: 'pointer' }}>
                    Clear ×
                  </button>
                )}
                <span style={{ fontSize: '11px', color: T.textMuted, marginLeft: 'auto' }}>{filteredPerf.length} records</span>
              </div>

              {perfLoading ? (
                <div style={{ textAlign: 'center', padding: '60px', color: T.textSecondary }}>Loading performance data...</div>
              ) : (
                <>
                  {/* KPI cards */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: '10px', marginBottom: '18px' }}>
                    {[
                      { label: 'Total Records', val: filteredPerf.length, accent: T.blue },
                      { label: 'Expected', val: pfExp, accent: T.blue },
                      { label: 'Moderate', val: pfMod, accent: T.yellow },
                      { label: 'Poor', val: pfPoor, accent: T.red },
                      { label: 'Avg Performance', val: `${pfAvgPerf}%`, accent: T.green },
                      { label: 'Total Measured', val: pfTotalMeasured > 0 ? `${(pfTotalMeasured/1000).toFixed(0)}k kWh` : '—', accent: T.green },
                    ].map(k => (
                      <div key={k.label} style={{ ...cardStyle, padding: '14px 16px', borderTop: `3px solid ${k.accent}` }}>
                        <div style={{ fontSize: '10px', color: T.textMuted, marginBottom: '6px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{k.label}</div>
                        <div style={{ fontSize: '26px', fontWeight: 800, color: k.accent }}>{k.val}</div>
                      </div>
                    ))}
                  </div>

                  {/* Charts */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
                    <div style={{ ...cardStyle, padding: '18px' }}>
                      <div style={cardTitleStyle}><i className="ti ti-chart-donut" style={{ color: T.blue }} />PF Band breakdown</div>
                      <div style={{ position: 'relative', height: '200px' }}><canvas id="pfBandChart" /></div>
                    </div>
                    <div style={{ ...cardStyle, padding: '18px' }}>
                      <div style={cardTitleStyle}><i className="ti ti-chart-bar" style={{ color: T.blue }} />Measured vs Expected — top 10 sites</div>
                      <div style={{ position: 'relative', height: '200px' }}><canvas id="measVsExpChart" /></div>
                    </div>
                  </div>

                  {/* Performance table */}
                  <div style={{ ...cardStyle, overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                      <thead>
                        <tr style={{ background: T.bgMuted, borderBottom: `2px solid ${T.border}` }}>
                          {[
                            { label: 'Site Name', key: 'site' },
                            { label: 'Investor', key: 'investor' },
                            { label: 'Date', key: 'date' },
                            { label: 'Measured (kWh)', key: 'measured' },
                            { label: 'Expected (kWh)', key: 'expected' },
                            { label: 'Performance %', key: 'perf' },
                            { label: 'PF Band', key: 'band' },
                          ].map(h => (
                            <th key={h.key} onClick={() => togglePfSort(h.key)} style={{ textAlign: 'left', padding: '9px 10px', fontSize: '10px', color: pfSort.key === h.key ? T.blue : T.textMuted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.7px', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
                              {h.label} {pfSort.key === h.key ? (pfSort.dir === 'asc' ? '▲' : '▼') : <span style={{ opacity: 0.3 }}>⇅</span>}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredPerf.length === 0 ? (
                          <tr><td colSpan={7} style={{ padding: '32px', textAlign: 'center', color: T.textMuted }}>No records match the selected filters</td></tr>
                        ) : sortedPerf.map((p) => (
                          <tr key={p.id} className="tbl-row" style={{ borderBottom: `1px solid ${T.border}` }}>
                            <td style={{ padding: '8px 10px', fontWeight: 600, color: T.blue }}>{p.site_name}</td>
                            <td style={{ padding: '8px 10px', color: T.textSecondary }}>{getInvestor(p) || '—'}</td>
                            <td style={{ padding: '8px 10px', color: T.textSecondary }}>{fmtDate(p.month, p.year)}</td>
                            <td style={{ padding: '8px 10px', fontWeight: 700, color: T.textPrimary }}>{p.kwh_produced != null ? p.kwh_produced.toLocaleString() : '—'}</td>
                            <td style={{ padding: '8px 10px', color: T.textSecondary }}>{p.expected_kwh != null ? p.expected_kwh.toLocaleString() : '—'}</td>
                            <td style={{ padding: '8px 10px', fontWeight: 700, color: p.performance_pct >= 90 ? T.green : p.performance_pct >= 70 ? T.yellow : T.red }}>
                              {p.performance_pct != null ? `${p.performance_pct.toFixed(1)}%` : '—'}
                            </td>
                            <td style={{ padding: '8px 10px' }}>{pfBadge(p.pf_band)}</td>
                          </tr>
                        ))}
                      </tbody>
                      {filteredPerf.length > 0 && (
                        <tfoot>
                          <tr style={{ background: T.bgMuted, borderTop: `2px solid ${T.border}` }}>
                            <td colSpan={3} style={{ padding: '9px 10px', fontSize: '11px', color: T.textSecondary, fontWeight: 700 }}>Total / Average</td>
                            <td style={{ padding: '9px 10px', fontSize: '11px', color: T.blue, fontWeight: 700 }}>{pfTotalMeasured.toLocaleString()} kWh</td>
                            <td style={{ padding: '9px 10px', fontSize: '11px', color: T.textSecondary }}>{pfTotalExpected.toLocaleString()} kWh</td>
                            <td style={{ padding: '9px 10px', fontSize: '11px', color: T.blue, fontWeight: 700 }}>{pfAvgPerf}%</td>
                            <td></td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── SITE PERFORMANCE ── */}
          {activePage === 'siteperf' && (() => {
            const spSiteNames = [...new Set(perfData.map(p => p.site_name?.trim()).filter(Boolean))].sort()
            const spRecs = perfData.filter(p => p.site_name?.trim() === spSite)
            const spYears = [...new Set(spRecs.map(p => p.year))].sort()
            const yrSel = parseInt(spYear) || spYears[spYears.length - 1]
            const yrA = parseInt(spYearA) || spYears[spYears.length - 1]
            const yrB = parseInt(spYearB) || spYears[spYears.length - 2] || yrA
            const yrRecs = spRecs.filter(p => p.year === yrSel && p.kwh_produced != null)
            const spTotMeas = yrRecs.reduce((s, p) => s + (p.kwh_produced || 0), 0)
            const spTotExp = yrRecs.reduce((s, p) => s + (p.expected_kwh || 0), 0)
            const spDelta = spTotExp > 0 ? (((spTotMeas - spTotExp) / spTotExp) * 100).toFixed(1) : null
            const yoA = spRecs.filter(p => p.year === yrA && p.kwh_produced != null)
            const yoB = spRecs.filter(p => p.year === yrB && p.kwh_produced != null)
            const commonM = yoA.map(p => p.month).filter(m => yoB.some(q => q.month === m))
            const totA = yoA.filter(p => commonM.includes(p.month)).reduce((s, p) => s + p.kwh_produced, 0)
            const totB = yoB.filter(p => commonM.includes(p.month)).reduce((s, p) => s + p.kwh_produced, 0)
            const yoyDelta = totB > 0 ? (((totA - totB) / totB) * 100).toFixed(1) : null

            const miniStatStyle = { background: T.bgMuted, border: `1px solid ${T.border}`, borderRadius: '8px', padding: '10px 14px' }

            return (
              <div>
                <div style={{ fontSize: '20px', fontWeight: 800, color: T.textWhite, marginBottom: '2px' }}>Site Performance</div>
                <div style={{ fontSize: '12px', color: T.textSecondary, marginBottom: '18px' }}>Per-site production analysis — expected vs measured and year-on-year comparison</div>

                {perfLoading ? (
                  <div style={{ textAlign: 'center', padding: '60px', color: T.textSecondary }}>Loading performance data...</div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: '14px', alignItems: 'start' }}>

                    {/* Site selector */}
                    <div style={{ ...cardStyle, padding: '14px' }}>
                      <div style={{ fontSize: '11px', fontWeight: 700, color: T.blue, marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Select Site</div>
                      <input type="text" placeholder="Search sites..." value={spSearch} onChange={e => setSpSearch(e.target.value)}
                        style={{ width: '100%', padding: '7px 10px', border: `1px solid ${T.border}`, borderRadius: '8px', fontSize: '12px', color: T.textPrimary, background: T.bgInput, outline: 'none', marginBottom: '10px' }} />
                      <div style={{ maxHeight: '500px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {spSiteNames.filter(n => n.toLowerCase().includes(spSearch.toLowerCase())).map(n => (
                          <div key={n} onClick={() => { setSpSite(n); setSpYear(''); setSpYearA(''); setSpYearB(''); setSpCommentDate('') }}
                            style={{ padding: '8px 10px', border: `1px solid ${spSite === n ? T.blue : T.border}`, borderRadius: '6px', fontSize: '12px', cursor: 'pointer', background: spSite === n ? 'rgba(43,127,212,0.15)' : T.bgInput, color: spSite === n ? T.textWhite : T.textSecondary, fontWeight: spSite === n ? 600 : 400, transition: 'all 0.1s', textAlign: 'center' }}>
                            {n}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Charts panel */}
                    <div>
                      {!spSite ? (
                        <div style={{ ...cardStyle, padding: '60px', textAlign: 'center', color: T.textMuted }}>
                          <i className="ti ti-chart-line" style={{ fontSize: '40px', display: 'block', marginBottom: '12px', color: T.border }} />
                          Select a site from the list to view its performance
                        </div>
                      ) : (
                        <>
                          {/* Expected vs Measured */}
                          <div style={{ ...cardStyle, padding: '18px', marginBottom: '14px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '14px' }}>
                              <div style={{ ...cardTitleStyle, marginBottom: 0 }}>
                                <i className="ti ti-chart-bar" style={{ color: T.blue }} />Expected vs Measured — {spSite}
                              </div>
                              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <span style={{ fontSize: '11px', color: T.textMuted, fontWeight: 600 }}>Year</span>
                                <select style={selectStyle} value={spYear || yrSel || ''} onChange={e => setSpYear(e.target.value)}>
                                  {spYears.map(y => <option key={y} value={y}>{y}</option>)}
                                </select>
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: '10px', marginBottom: '14px', flexWrap: 'wrap' }}>
                              <div style={miniStatStyle}>
                                <div style={{ fontSize: '10px', color: T.textMuted, marginBottom: '2px' }}>Total Measured</div>
                                <div style={{ fontSize: '18px', fontWeight: 700, color: T.textPrimary }}>{spTotMeas.toLocaleString()} kWh</div>
                              </div>
                              <div style={miniStatStyle}>
                                <div style={{ fontSize: '10px', color: T.textMuted, marginBottom: '2px' }}>Total Expected</div>
                                <div style={{ fontSize: '18px', fontWeight: 700, color: T.textPrimary }}>{spTotExp.toLocaleString()} kWh</div>
                              </div>
                              <div style={{ ...miniStatStyle, background: spDelta >= 0 ? 'rgba(125,194,66,0.08)' : 'rgba(239,68,68,0.08)', borderColor: spDelta >= 0 ? 'rgba(125,194,66,0.25)' : 'rgba(239,68,68,0.25)' }}>
                                <div style={{ fontSize: '10px', color: T.textMuted, marginBottom: '2px' }}>Δ vs Expected</div>
                                <div style={{ fontSize: '18px', fontWeight: 700, color: spDelta >= 0 ? T.green : T.red }}>
                                  {spDelta != null ? `${spDelta > 0 ? '+' : ''}${spDelta}%` : '—'}
                                </div>
                              </div>
                            </div>
                            <div style={{ position: 'relative', height: '260px' }}><canvas id="spExpMeasChart" /></div>
                          </div>

                          {/* Year to Year */}
                          <div style={{ ...cardStyle, padding: '18px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '14px' }}>
                              <div style={{ ...cardTitleStyle, marginBottom: 0 }}>
                                <i className="ti ti-arrows-diff" style={{ color: T.blue }} />Year to Year Comparison
                              </div>
                              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <span style={{ fontSize: '11px', color: T.textMuted, fontWeight: 600 }}>Compare</span>
                                <select style={selectStyle} value={spYearA || yrA || ''} onChange={e => setSpYearA(e.target.value)}>
                                  {spYears.map(y => <option key={y} value={y}>{y}</option>)}
                                </select>
                                <span style={{ fontSize: '11px', color: T.textMuted }}>vs</span>
                                <select style={selectStyle} value={spYearB || yrB || ''} onChange={e => setSpYearB(e.target.value)}>
                                  {spYears.map(y => <option key={y} value={y}>{y}</option>)}
                                </select>
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: '10px', marginBottom: '14px', flexWrap: 'wrap' }}>
                              <div style={miniStatStyle}>
                                <div style={{ fontSize: '10px', color: T.textMuted, marginBottom: '2px' }}>{yrA} Total (common months)</div>
                                <div style={{ fontSize: '18px', fontWeight: 700, color: T.textPrimary }}>{totA.toLocaleString()} kWh</div>
                              </div>
                              <div style={miniStatStyle}>
                                <div style={{ fontSize: '10px', color: T.textMuted, marginBottom: '2px' }}>{yrB} Total (common months)</div>
                                <div style={{ fontSize: '18px', fontWeight: 700, color: T.textPrimary }}>{totB.toLocaleString()} kWh</div>
                              </div>
                              <div style={{ ...miniStatStyle, background: yoyDelta >= 0 ? 'rgba(125,194,66,0.08)' : 'rgba(239,68,68,0.08)', borderColor: yoyDelta >= 0 ? 'rgba(125,194,66,0.25)' : 'rgba(239,68,68,0.25)' }}>
                                <div style={{ fontSize: '10px', color: T.textMuted, marginBottom: '2px' }}>Δ {yrA} vs {yrB}</div>
                                <div style={{ fontSize: '18px', fontWeight: 700, color: yoyDelta >= 0 ? T.green : T.red }}>
                                  {yoyDelta != null ? `${yoyDelta > 0 ? '+' : ''}${yoyDelta}%` : '—'}
                                </div>
                              </div>
                            </div>
                            <div style={{ position: 'relative', height: '260px' }}><canvas id="spYoYChart" /></div>
                          </div>

                          {/* Technical Comments */}
                          {(() => {
                            const commentRecs = spRecs.filter(hasCommentData).sort((a, b) => (b.year - a.year) || (b.month - a.month))
                            const cDates = commentRecs.map(p => `${p.year}-${String(p.month).padStart(2, '0')}`)
                            const selDate = spCommentDate || cDates[0] || ''
                            const selRec = commentRecs.find(p => `${p.year}-${String(p.month).padStart(2, '0')}` === selDate)
                            return (
                              <div style={{ ...cardStyle, padding: '18px', marginTop: '14px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '14px' }}>
                                  <div style={{ ...cardTitleStyle, marginBottom: 0 }}>
                                    <i className="ti ti-message-2" style={{ color: T.blue }} />Technical Comments
                                  </div>
                                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                    <span style={{ fontSize: '11px', color: T.textMuted, fontWeight: 600 }}>Date</span>
                                    <select style={selectStyle} value={selDate} onChange={e => setSpCommentDate(e.target.value)}>
                                      {cDates.length === 0 && <option value="">No comments</option>}
                                      {cDates.map(d => {
                                        const [y, m] = d.split('-')
                                        return <option key={d} value={d}>{monthNames[parseInt(m)-1]}-{y.slice(2)}</option>
                                      })}
                                    </select>
                                  </div>
                                </div>
                                {selRec ? (
                                  <div style={{ background: T.bgMuted, border: `1px solid ${T.border}`, borderRadius: '8px', padding: '14px 16px' }}>
                                    {selRec.comment ? (
                                      <div style={{ fontSize: '13px', color: T.textPrimary, lineHeight: 1.7, whiteSpace: 'pre-line' }}>{selRec.comment}</div>
                                    ) : (
                                      <div style={{ display: 'grid', gap: '12px' }}>
                                        {COMMENT_FIELDS.filter(f => selRec[f.key] != null && selRec[f.key] !== '').map(f => (
                                          <div key={f.key}>
                                            <div style={{ fontSize: '10px', fontWeight: 700, color: f.key === 'downtime_days' && selRec.downtime_days && selRec.downtime_days !== '0' && !/^(none|n\/a|-+)$/i.test(String(selRec.downtime_days)) ? T.red : T.textMuted, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '3px' }}>{f.label}</div>
                                            <div style={{ fontSize: '13px', color: T.textPrimary, lineHeight: 1.6, whiteSpace: 'pre-line' }}>{String(selRec[f.key])}</div>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <div style={{ padding: '24px', textAlign: 'center', color: T.textMuted, fontSize: '12px' }}>
                                    No technical comments recorded for this site yet
                                  </div>
                                )}
                              </div>
                            )
                          })()}
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })()}

          {/* ── DATA UPLOAD ── */}
          {/* ── OFFTAKE GUARANTEES ── */}
          {activePage === 'offtake' && ogOverview && (() => {
            const all = [...ogData].sort((a, b) => (a.shortfall_kwh ?? 0) - (b.shortfall_kwh ?? 0))
            const tG = ogData.reduce((s, g) => s + (g.correct_kwh || 0), 0)
            const tA = ogData.reduce((s, g) => s + (g.actual_kwh || 0), 0)
            const tS = ogData.reduce((s, g) => s + (g.shortfall_kwh || 0), 0)
            const tU = ogData.reduce((s, g) => s + (g.unavailability_kwh || 0), 0)
            const meeting = ogData.filter(g => (g.shortfall_kwh ?? 0) >= 0).length
            const ach = tG > 0 ? ((tA / tG) * 100).toFixed(1) : '—'
            const genDate = new Date().toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })
            const navy = '#1a2a4a', grey = '#8a9aae'
            const kpi = (label, value, color) => (
              <div style={{ padding: '12px 16px', borderLeft: '1px solid #dde5ee' }}>
                <div style={{ fontSize: '8px', fontWeight: 700, color: grey, textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: '5px' }}>{label}</div>
                <div style={{ fontSize: '17px', fontWeight: 800, color }}>{value}</div>
              </div>
            )
            return (
              <div>
                <div className="no-print" style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                  <button onClick={() => setOgOverview(false)} style={{ ...selectStyle, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <i className="ti ti-arrow-left" />Back to Offtake Guarantees
                  </button>
                  <span style={{ fontSize: '14px', fontWeight: 700, color: T.textWhite }}>Portfolio Overview</span>
                  <button onClick={() => window.print()} style={{ marginLeft: 'auto', padding: '8px 18px', background: T.blue, color: '#fff', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
                    <i className="ti ti-printer" style={{ marginRight: '6px' }} />Print / Save PDF
                  </button>
                </div>

                <div className="print-area" style={{ background: '#fff', color: navy, border: `1px solid ${T.border}`, borderRadius: '12px', padding: '32px', maxWidth: '1000px' }}>
                  {/* Header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '3px solid #2B7FD4', paddingBottom: '18px', marginBottom: '22px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <svg width="44" height="50" viewBox="0 0 46 52" fill="none">
                        <ellipse cx="23" cy="16" rx="18" ry="16" fill="#F5D000"/>
                        <ellipse cx="23" cy="36" rx="18" ry="16" fill="#2B7FD4"/>
                        <rect x="14" y="20" width="14" height="12" rx="2" fill="#7DC242" transform="rotate(-8 14 20)"/>
                      </svg>
                      <div>
                        <div style={{ fontSize: '18px', fontWeight: 800, color: '#2B7FD4' }}>Sosimple Energy</div>
                        <div style={{ fontSize: '8px', color: '#7DC242', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase' }}>Cheap energy. Clean business.</div>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', fontSize: '9px', color: '#7a9aba', lineHeight: 1.7 }}>
                      Generated: {genDate}<br />
                      Guarantee Period: <b style={{ color: navy }}>July 2025 – June 2026</b>
                    </div>
                  </div>

                  <div style={{ fontSize: '16px', fontWeight: 700, color: navy, marginBottom: '18px' }}>Offtake Guarantee — Portfolio Overview</div>

                  {/* Portfolio summary */}
                  <div style={{ fontSize: '10px', fontWeight: 800, color: navy, textTransform: 'uppercase', letterSpacing: '0.8px', borderTop: '2px solid #2B7FD4', paddingTop: '10px', marginBottom: '10px' }}>Portfolio Summary</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', marginBottom: '24px', border: '1px solid #dde5ee', borderRadius: '6px', overflow: 'hidden' }}>
                    {kpi('Sites', ogData.length, navy)}
                    {kpi('Meeting Guarantee', `${meeting} / ${ogData.length}`, meeting === ogData.length ? '#3a9b3a' : '#f0820a')}
                    {kpi('Guaranteed', fmtKWh(tG), navy)}
                    {kpi('Actual', fmtKWh(tA), '#2B7FD4')}
                    {kpi('Net Shortfall', fmtKWh(tS != null ? Math.abs(tS) : null), tS >= 0 ? '#3a9b3a' : '#d23b3b')}
                    {kpi('Achievement', `${ach} %`, parseFloat(ach) >= 100 ? '#3a9b3a' : parseFloat(ach) >= 90 ? '#f0820a' : '#d23b3b')}
                  </div>

                  {/* Per-site table */}
                  <div style={{ fontSize: '10px', fontWeight: 800, color: navy, textTransform: 'uppercase', letterSpacing: '0.8px', borderTop: '2px solid #2B7FD4', paddingTop: '10px', marginBottom: '10px' }}>Site Breakdown</div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                    <thead>
                      <tr style={{ background: '#f4f8fc', borderBottom: '2px solid #2B7FD4' }}>
                        {['Site', 'Guaranteed kWh', 'Unavailability kWh', 'Corrected kWh', 'Actual kWh', 'Shortfall kWh', 'Perf %', 'Status'].map((h, i) => (
                          <th key={h} style={{ textAlign: i === 0 ? 'left' : 'right', padding: '7px 9px', fontSize: '9px', color: '#5a7aaa', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {all.map(g => {
                        const meet = (g.shortfall_kwh ?? 0) >= 0
                        const pr = g.performance_rate != null ? parseFloat(g.performance_rate)
                          : (g.correct_kwh > 0 && g.actual_kwh != null ? (g.actual_kwh / g.correct_kwh) * 100 : null)
                        const rc = (v, opts = {}) => <td style={{ padding: '6px 9px', textAlign: 'right', color: opts.color || '#33475f', fontWeight: opts.weight || 400, whiteSpace: 'nowrap' }}>{v}</td>
                        return (
                          <tr key={g.id} style={{ borderBottom: '1px solid #e8eef6' }}>
                            <td style={{ padding: '6px 9px', fontWeight: 600, color: navy, whiteSpace: 'nowrap' }}>{g.site_name}</td>
                            {rc(g.guaranteed_kwh != null ? Math.round(g.guaranteed_kwh).toLocaleString() : '—')}
                            {rc(g.unavailability_kwh ? Math.round(g.unavailability_kwh).toLocaleString() : '—', { color: g.unavailability_kwh ? '#f0820a' : '#9ab0c8' })}
                            {rc(g.correct_kwh != null ? Math.round(g.correct_kwh).toLocaleString() : '—', { weight: 700, color: navy })}
                            {rc(g.actual_kwh != null ? Math.round(g.actual_kwh).toLocaleString() : '—', { weight: 700, color: '#2B7FD4' })}
                            {rc(g.shortfall_kwh != null ? Math.round(g.shortfall_kwh).toLocaleString() : '—', { weight: 700, color: meet ? '#3a9b3a' : '#d23b3b' })}
                            {rc(pr != null ? pr.toFixed(0) : '—', { color: pr == null ? '#9ab0c8' : pr >= 100 ? '#3a9b3a' : pr >= 90 ? '#f0820a' : '#d23b3b', weight: 700 })}
                            <td style={{ padding: '6px 9px', textAlign: 'right' }}>
                              <span style={{ fontSize: '9px', fontWeight: 700, color: meet ? '#3a9b3a' : '#d23b3b' }}>{meet ? 'Meeting' : 'Shortfall'}</span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: '#f4f8fc', borderTop: '2px solid #2B7FD4' }}>
                        <td style={{ padding: '8px 9px', fontWeight: 800, color: navy }}>Total ({ogData.length})</td>
                        <td style={{ padding: '8px 9px', textAlign: 'right', fontWeight: 700, color: navy }}>{Math.round(ogData.reduce((s,g)=>s+(g.guaranteed_kwh||0),0)).toLocaleString()}</td>
                        <td style={{ padding: '8px 9px', textAlign: 'right', fontWeight: 700, color: '#f0820a' }}>{Math.round(tU).toLocaleString()}</td>
                        <td style={{ padding: '8px 9px', textAlign: 'right', fontWeight: 800, color: navy }}>{Math.round(tG).toLocaleString()}</td>
                        <td style={{ padding: '8px 9px', textAlign: 'right', fontWeight: 800, color: '#2B7FD4' }}>{Math.round(tA).toLocaleString()}</td>
                        <td style={{ padding: '8px 9px', textAlign: 'right', fontWeight: 800, color: tS >= 0 ? '#3a9b3a' : '#d23b3b' }}>{Math.round(tS).toLocaleString()}</td>
                        <td style={{ padding: '8px 9px', textAlign: 'right', fontWeight: 800, color: parseFloat(ach) >= 100 ? '#3a9b3a' : parseFloat(ach) >= 90 ? '#f0820a' : '#d23b3b' }}>{ach}</td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>

                  <div style={{ fontSize: '9px', color: '#9ab0c8', borderTop: '1px solid #dde5ee', paddingTop: '12px', marginTop: '16px', lineHeight: 1.7 }}>
                    Sites are listed worst-shortfall first. The corrected guarantee is the contractual guarantee less grid/inverter unavailability outside Sosimple's control; shortfall is measured against the corrected guarantee. Portfolio achievement is total actual generation as a percentage of total corrected guarantee.<br />
                    © {new Date().getFullYear()} Sosimple Energy — Cheap energy. Clean business.
                  </div>
                </div>
              </div>
            )
          })()}

          {/* ── OFFTAKE GUARANTEES ── */}
          {activePage === 'offtake' && ogSelected && (() => {
            const g = ogSelected
            const site = sites.find(s => s.name?.trim().toLowerCase() === (g.site_name || '').trim().toLowerCase())
            const months = ogMonthlyRows(g.site_name)
            const totMeasured = months.reduce((s, r) => s + (r.measured || 0), 0)
            const totExpected = months.reduce((s, r) => s + (r.expected || 0), 0)
            const perfRate = g.performance_rate != null ? parseFloat(g.performance_rate)
              : (g.correct_kwh > 0 && g.actual_kwh != null ? (g.actual_kwh / g.correct_kwh) * 100 : null)
            const genDate = new Date().toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })
            const navy = '#1a2a4a', grey = '#8a9aae'
            const sumBlock = (label, value, color) => (
              <div key={label} style={{ padding: '12px 18px', borderLeft: `1px solid #dde5ee` }}>
                <div style={{ fontSize: '8px', fontWeight: 700, color: grey, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '6px' }}>{label}</div>
                <div style={{ fontSize: '17px', fontWeight: 800, color }}>{value}</div>
              </div>
            )
            return (
              <div>
                {/* Controls */}
                <div className="no-print" style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                  <button onClick={() => setOgSelected(null)} style={{ ...selectStyle, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <i className="ti ti-arrow-left" />Back to Offtake Guarantees
                  </button>
                  <span style={{ fontSize: '14px', fontWeight: 700, color: T.textWhite }}>{g.site_name}</span>
                  <button onClick={() => window.print()} style={{ marginLeft: 'auto', padding: '8px 18px', background: T.blue, color: '#fff', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
                    <i className="ti ti-printer" style={{ marginRight: '6px' }} />Print / Save PDF
                  </button>
                </div>

                {/* Report document — stays white for print */}
                <div className="print-area" style={{ background: '#fff', color: navy, border: `1px solid ${T.border}`, borderRadius: '12px', padding: '32px', maxWidth: '900px' }}>
                  {/* Header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '3px solid #2B7FD4', paddingBottom: '18px', marginBottom: '22px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <svg width="44" height="50" viewBox="0 0 46 52" fill="none">
                        <ellipse cx="23" cy="16" rx="18" ry="16" fill="#F5D000"/>
                        <ellipse cx="23" cy="36" rx="18" ry="16" fill="#2B7FD4"/>
                        <rect x="14" y="20" width="14" height="12" rx="2" fill="#7DC242" transform="rotate(-8 14 20)"/>
                      </svg>
                      <div>
                        <div style={{ fontSize: '18px', fontWeight: 800, color: '#2B7FD4' }}>Sosimple Energy</div>
                        <div style={{ fontSize: '8px', color: '#7DC242', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase' }}>Cheap energy. Clean business.</div>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', fontSize: '9px', color: '#7a9aba', lineHeight: 1.7 }}>
                      Generated: {genDate}<br />
                      Guarantee Period: <b style={{ color: navy }}>July 2025 – June 2026</b>
                    </div>
                  </div>

                  <div style={{ fontSize: '16px', fontWeight: 700, color: navy, marginBottom: '18px' }}>Offtake Guarantee Report</div>

                  {/* Site information */}
                  <div style={{ fontSize: '10px', fontWeight: 800, color: navy, textTransform: 'uppercase', letterSpacing: '0.8px', borderTop: '2px solid #2B7FD4', paddingTop: '10px', marginBottom: '10px' }}>Site Information</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', marginBottom: '24px', border: '1px solid #dde5ee', borderRadius: '6px', overflow: 'hidden' }}>
                    {sumBlock('Site Name', g.site_name, navy)}
                    {sumBlock('Address', site?.location || '—', navy)}
                    {sumBlock('System Size', site?.capacity_kw != null ? `${site.capacity_kw} kWp` : '—', navy)}
                  </div>

                  {/* Energy delivery summary */}
                  <div style={{ fontSize: '10px', fontWeight: 800, color: navy, textTransform: 'uppercase', letterSpacing: '0.8px', borderTop: '2px solid #2B7FD4', paddingTop: '10px', marginBottom: '10px' }}>Energy Delivery Summary</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', marginBottom: '24px', border: '1px solid #dde5ee', borderRadius: '6px', overflow: 'hidden' }}>
                    {sumBlock('Guaranteed Output', fmtKWh(g.correct_kwh), navy)}
                    {sumBlock('Actual Generation', fmtKWh(g.actual_kwh), '#2B7FD4')}
                    {sumBlock('Shortfall Volume', fmtKWh(g.shortfall_kwh != null ? Math.abs(g.shortfall_kwh) * ((g.shortfall_kwh ?? 0) < 0 ? 1 : 0) : null), '#d23b3b')}
                    {sumBlock('Performance Rate', perfRate != null ? `${perfRate.toFixed(1)} %` : '—', '#f0820a')}
                  </div>

                  {/* Guarantee adjustment breakdown */}
                  <div style={{ fontSize: '10px', fontWeight: 800, color: navy, textTransform: 'uppercase', letterSpacing: '0.8px', borderTop: '2px solid #2B7FD4', paddingTop: '10px', marginBottom: '10px' }}>Guarantee Adjustment</div>
                  {(() => {
                    const asBuilt = g.as_built_kwh
                    const guar = g.guaranteed_kwh
                    const unavail = g.unavailability_kwh || 0
                    const corrected = g.correct_kwh
                    const actual = g.actual_kwh
                    const shortfall = g.shortfall_kwh
                    const step = (label, value, color, sign) => (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, minWidth: 0 }}>
                        {sign && <div style={{ fontSize: '15px', fontWeight: 700, color: '#9ab0c8', marginBottom: '2px' }}>{sign}</div>}
                        <div style={{ fontSize: '8px', fontWeight: 700, color: grey, textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'center', marginBottom: '4px', lineHeight: 1.3 }}>{label}</div>
                        <div style={{ fontSize: '14px', fontWeight: 800, color, textAlign: 'center' }}>{fmtKWh(value)}</div>
                      </div>
                    )
                    return (
                      <div style={{ border: '1px solid #dde5ee', borderRadius: '6px', padding: '16px 14px', marginBottom: '10px' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '4px', flexWrap: 'nowrap' }}>
                          {step('Contractual Guarantee', guar != null ? guar : asBuilt, navy)}
                          {step('Grid / Inverter Unavailability', unavail, '#f0820a', '−')}
                          {step('Corrected Guarantee', corrected, '#2B7FD4', '=')}
                          {step('Actual Generation', actual, '#2B7FD4', 'vs')}
                          {step('Shortfall', shortfall != null ? Math.abs(shortfall) : null, (shortfall ?? 0) >= 0 ? '#3a9b3a' : '#d23b3b', (shortfall ?? 0) >= 0 ? '↑' : '↓')}
                        </div>
                      </div>
                    )
                  })()}
                  <div style={{ fontSize: '9px', color: '#9ab0c8', lineHeight: 1.6, marginBottom: '24px' }}>
                    The contractual guarantee is reduced by periods of grid or inverter unavailability (outside Sosimple's control) to give the corrected guarantee against which actual generation is measured. The shortfall is the difference between corrected guarantee and actual generation.
                    {(g.shortfall_kwh ?? 0) >= 0 ? ' This site met or exceeded its corrected guarantee for the period.' : ''}
                  </div>

                  {/* Monthly generation table */}
                  <div style={{ fontSize: '10px', fontWeight: 800, color: navy, textTransform: 'uppercase', letterSpacing: '0.8px', borderTop: '2px solid #2B7FD4', paddingTop: '10px', marginBottom: '10px' }}>Itemised Analysis — Monthly Generation</div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', marginBottom: '20px', tableLayout: 'fixed' }}>
                    <thead>
                      <tr style={{ background: '#f4f8fc', borderBottom: '2px solid #2B7FD4' }}>
                        {[
                          { label: 'Month', w: '8%' },
                          { label: 'Measured kWh', w: '9%' },
                          { label: 'Expected kWh', w: '9%' },
                          { label: 'Availability', w: '22%' },
                          { label: 'Downtime (days)', w: '7%' },
                          { label: 'Cause of Downtime', w: '13%' },
                          { label: 'Technical Events', w: '13%' },
                          { label: 'Energy Impact', w: '9%' },
                          { label: 'Other Comments', w: '10%' },
                        ].map(h => (
                          <th key={h.label} style={{ width: h.w, textAlign: 'left', padding: '7px 8px', fontSize: '9px', color: '#5a7aaa', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {months.map(r => {
                        const cell = (v, opts = {}) => (
                          <td style={{ padding: '7px 8px', color: opts.color || '#5a7aaa', fontWeight: opts.weight || 400, fontSize: '10px', whiteSpace: 'pre-line', verticalAlign: 'top', wordBreak: 'break-word', ...opts.style }}>{v != null && v !== '' ? v : '—'}</td>
                        )
                        return (
                          <tr key={`${r.y}-${r.m}`} style={{ borderBottom: '1px solid #e8eef6' }}>
                            <td style={{ padding: '7px 8px', fontWeight: 600, color: navy, whiteSpace: 'nowrap', verticalAlign: 'top', fontSize: '10px' }}>{monthNames[r.m - 1]} {r.y}</td>
                            {cell(r.measured != null ? Math.round(r.measured).toLocaleString() : null, { color: navy, weight: 700 })}
                            {cell(r.expected != null ? Math.round(r.expected).toLocaleString() : null)}
                            {cell(r.availability)}
                            {cell(r.downtime_days, { color: r.downtime_days && r.downtime_days !== '0' && !/^(none|n\/a|-+)$/i.test(r.downtime_days) ? '#d23b3b' : '#5a7aaa', weight: r.downtime_days && r.downtime_days !== '0' && !/^(none|n\/a|-+)$/i.test(r.downtime_days) ? 700 : 400 })}
                            {cell(r.cause)}
                            {cell(r.technical)}
                            {cell(r.energy_impact)}
                            {cell(r.other)}
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: '#f4f8fc', borderTop: '2px solid #2B7FD4' }}>
                        <td style={{ padding: '8px 8px', fontSize: '10px', fontWeight: 800, color: navy }}>Total</td>
                        <td style={{ padding: '8px 8px', fontSize: '10px', fontWeight: 800, color: navy }}>{Math.round(totMeasured).toLocaleString()}</td>
                        <td style={{ padding: '8px 8px', fontSize: '10px', fontWeight: 700, color: '#5a7aaa' }}>{Math.round(totExpected).toLocaleString()}</td>
                        <td colSpan={6}></td>
                      </tr>
                    </tfoot>
                  </table>

                  <div style={{ fontSize: '10px', color: '#9ab0c8', borderTop: '1px solid #dde5ee', paddingTop: '12px', lineHeight: 1.7 }}>
                    This report reflects the offtake guarantee position for {g.site_name} over the guarantee period July 2025 – June 2026.
                    Guaranteed output is corrected for expected utilisation ({g.expected_utilisation != null ? `${parseFloat(g.expected_utilisation).toFixed(1)}%` : '—'}) and system age ({g.og_age != null ? `${parseFloat(g.og_age).toFixed(1)} yrs` : '—'}).
                    {g.notes ? ` Notes: ${g.notes}` : ''}<br />
                    © {new Date().getFullYear()} Sosimple Energy — Cheap energy. Clean business.
                  </div>
                </div>
              </div>
            )
          })()}

          {activePage === 'offtake' && !ogSelected && !ogOverview && (
            <div>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '18px', gap: '12px' }}>
                <div>
                  <div style={{ fontSize: '20px', fontWeight: 800, color: T.textWhite, marginBottom: '2px' }}>Offtake Guarantees</div>
                  <div style={{ fontSize: '12px', color: T.textSecondary }}>Guaranteed vs actual generation per site — shortfalls highlighted</div>
                </div>
                {ogData.length > 0 && (
                  <button onClick={() => setOgOverview(true)}
                    style={{ padding: '8px 16px', background: T.blue, color: '#fff', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <i className="ti ti-file-text" />Portfolio Overview
                  </button>
                )}
              </div>

              {/* Filter bar */}
              <div style={{ ...cardStyle, padding: '12px 16px', marginBottom: '16px', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: '11px', fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.8px' }}>
                  <i className="ti ti-filter" style={{ marginRight: '5px', color: T.blue }} />Filter
                </span>
                <input
                  type="text" placeholder="Search site name..."
                  value={ogSearch} onChange={e => setOgSearch(e.target.value)}
                  style={{ ...selectStyle, minWidth: '200px' }}
                />
                <select style={selectStyle} value={ogFilterStatus} onChange={e => setOgFilterStatus(e.target.value)}>
                  <option value="">All Statuses</option>
                  <option value="meeting">Meeting Guarantee</option>
                  <option value="shortfall">In Shortfall</option>
                </select>
                {(ogSearch || ogFilterStatus) && (
                  <button onClick={() => { setOgSearch(''); setOgFilterStatus('') }}
                    style={{ ...selectStyle, background: 'rgba(239,68,68,0.1)', border: `1px solid rgba(239,68,68,0.3)`, color: T.red, cursor: 'pointer' }}>
                    Clear ×
                  </button>
                )}
                <span style={{ fontSize: '11px', color: T.textMuted, marginLeft: 'auto' }}>{filteredOG.length} sites</span>
              </div>

              {ogLoading ? (
                <div style={{ textAlign: 'center', padding: '60px', color: T.textSecondary }}>Loading offtake guarantee data...</div>
              ) : ogData.length === 0 ? (
                <div style={{ ...cardStyle, padding: '40px', textAlign: 'center', color: T.textMuted, fontSize: '13px' }}>
                  No offtake guarantee data found. Run the <b style={{ color: T.textSecondary }}>offtake_guarantees</b> import in Supabase to load sites.
                </div>
              ) : (
                <>
                  {/* KPI cards */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: '10px', marginBottom: '18px' }}>
                    {[
                      { label: 'Sites with OG', val: filteredOG.length, accent: T.blue },
                      { label: 'Meeting Guarantee', val: `${ogMeetingCount} / ${filteredOG.length}`, accent: ogMeetingCount === filteredOG.length ? T.green : T.yellow },
                      { label: 'Guaranteed Gen', val: `${(ogTotGuaranteed / 1000).toFixed(0)}k kWh`, accent: T.blue },
                      { label: 'Actual Gen', val: `${(ogTotActual / 1000).toFixed(0)}k kWh`, accent: T.green },
                      { label: 'Net Shortfall', val: `${(ogTotShortfall / 1000).toFixed(0)}k kWh`, accent: ogTotShortfall >= 0 ? T.green : T.red },
                      { label: 'Achievement', val: `${ogAchievement}%`, accent: parseFloat(ogAchievement) >= 100 ? T.green : parseFloat(ogAchievement) >= 90 ? T.yellow : T.red },
                    ].map(k => (
                      <div key={k.label} style={{ ...cardStyle, padding: '14px 16px', borderTop: `3px solid ${k.accent}` }}>
                        <div style={{ fontSize: '10px', color: T.textMuted, marginBottom: '6px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{k.label}</div>
                        <div style={{ fontSize: '24px', fontWeight: 800, color: k.accent }}>{k.val}</div>
                      </div>
                    ))}
                  </div>

                  {/* Table */}
                  <div style={{ ...cardStyle, overflow: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                      <thead>
                        <tr style={{ background: T.bgMuted, borderBottom: `2px solid ${T.border}` }}>
                          {[
                            { label: 'Site Name', key: 'site' },
                            { label: 'Utilisation %', key: 'util' },
                            { label: 'Age (yrs)', key: 'degradation' },
                            { label: 'As-Built (kWh)', key: 'asbuilt' },
                            { label: 'Unavailability (kWh)', key: 'unavail' },
                            { label: 'Guaranteed (kWh)', key: 'guaranteed' },
                            { label: 'Actual (kWh)', key: 'actual' },
                            { label: 'Achievement %', key: 'achievement' },
                            { label: 'Shortfall (kWh)', key: 'shortfall' },
                            { label: 'Status', key: null },
                            { label: 'Notes', key: null },
                            { label: 'Report', key: null },
                          ].map((h, i) => (
                            <th key={h.label}
                              onClick={h.key ? () => toggleOgSort(h.key) : undefined}
                              style={{ textAlign: 'left', padding: '9px 10px', fontSize: '10px', color: h.key && ogSort.key === h.key ? T.blue : T.textMuted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.7px', cursor: h.key ? 'pointer' : 'default', userSelect: 'none', whiteSpace: 'nowrap' }}>
                              {h.label} {h.key ? (ogSort.key === h.key ? (ogSort.dir === 'asc' ? '▲' : '▼') : <span style={{ opacity: 0.3 }}>⇅</span>) : ''}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredOG.length === 0 ? (
                          <tr><td colSpan={12} style={{ padding: '32px', textAlign: 'center', color: T.textMuted }}>No sites match the selected filters</td></tr>
                        ) : sortedOG.map((g) => {
                          const ach = g.performance_rate != null ? parseFloat(g.performance_rate)
                            : (g.correct_kwh > 0 && g.actual_kwh != null ? (g.actual_kwh / g.correct_kwh) * 100 : null)
                          return (
                            <tr key={g.id} className="tbl-row" style={{ borderBottom: `1px solid ${T.border}` }}>
                              <td style={{ padding: '8px 10px', fontWeight: 600, color: T.blue, whiteSpace: 'nowrap', cursor: 'pointer', textDecoration: 'underline dotted' }}
                                onClick={() => setOgSelected(g)}>
                                {g.site_name}
                              </td>
                              <td style={{ padding: '8px 10px', color: T.textSecondary }}>{g.expected_utilisation != null ? `${parseFloat(g.expected_utilisation).toFixed(1)}%` : '—'}</td>
                              <td style={{ padding: '8px 10px', color: T.textSecondary }}>{g.og_age != null ? parseFloat(g.og_age).toFixed(1) : (g.degradation != null ? parseFloat(g.degradation).toFixed(1) : '—')}</td>
                              <td style={{ padding: '8px 10px', color: T.textSecondary }}>{g.as_built_kwh != null ? Math.round(g.as_built_kwh).toLocaleString() : '—'}</td>
                              <td style={{ padding: '8px 10px', color: T.textSecondary }}>{g.unavailability_kwh != null ? Math.round(g.unavailability_kwh).toLocaleString() : '—'}</td>
                              <td style={{ padding: '8px 10px', fontWeight: 700, color: T.textPrimary }}>{g.correct_kwh != null ? Math.round(g.correct_kwh).toLocaleString() : '—'}</td>
                              <td style={{ padding: '8px 10px', fontWeight: 700, color: T.textPrimary }}>{g.actual_kwh != null ? Math.round(g.actual_kwh).toLocaleString() : '—'}</td>
                              <td style={{ padding: '8px 10px', fontWeight: 700, color: ach == null ? T.textMuted : ach >= 100 ? T.green : ach >= 90 ? T.yellow : T.red }}>
                                {ach != null ? `${ach.toFixed(1)}%` : '—'}
                              </td>
                              <td style={{ padding: '8px 10px', fontWeight: 700, color: (g.shortfall_kwh ?? 0) >= 0 ? T.green : T.red }}>
                                {g.shortfall_kwh != null ? Math.round(g.shortfall_kwh).toLocaleString() : '—'}
                              </td>
                              <td style={{ padding: '8px 10px' }}>{ogStatusBadge(g)}</td>
                              <td style={{ padding: '8px 10px', color: T.textMuted, maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={g.notes || ''}>{g.notes || '—'}</td>
                              <td style={{ padding: '8px 10px' }}>
                                <button onClick={() => setOgSelected(g)} title="Open printable report"
                                  style={{ background: 'rgba(43,127,212,0.12)', border: `1px solid rgba(43,127,212,0.35)`, color: T.blue, borderRadius: '6px', padding: '4px 10px', fontSize: '11px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                  <i className="ti ti-file-text" style={{ marginRight: '4px' }} />PDF
                                </button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                      {filteredOG.length > 0 && (
                        <tfoot>
                          <tr style={{ background: T.bgMuted, borderTop: `2px solid ${T.border}` }}>
                            <td colSpan={5} style={{ padding: '9px 10px', fontSize: '11px', color: T.textSecondary, fontWeight: 700 }}>Total</td>
                            <td style={{ padding: '9px 10px', fontSize: '11px', color: T.blue, fontWeight: 700 }}>{Math.round(ogTotGuaranteed).toLocaleString()} kWh</td>
                            <td style={{ padding: '9px 10px', fontSize: '11px', color: T.blue, fontWeight: 700 }}>{Math.round(ogTotActual).toLocaleString()} kWh</td>
                            <td style={{ padding: '9px 10px', fontSize: '11px', fontWeight: 700, color: parseFloat(ogAchievement) >= 100 ? T.green : T.yellow }}>{ogAchievement}%</td>
                            <td style={{ padding: '9px 10px', fontSize: '11px', fontWeight: 700, color: ogTotShortfall >= 0 ? T.green : T.red }}>{Math.round(ogTotShortfall).toLocaleString()} kWh</td>
                            <td colSpan={3}></td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                </>
              )}
            </div>
          )}

          {activePage === 'upload' && (
            <div>
              <div style={{ fontSize: '20px', fontWeight: 800, color: T.textWhite, marginBottom: '2px' }}>Data Upload</div>
              <div style={{ fontSize: '12px', color: T.textSecondary, marginBottom: '18px' }}>Upload monthly performance data and site information — existing records are updated, new ones are added</div>

              {upMsg && (
                <div style={{
                  background: upMsg.startsWith('✅') ? 'rgba(125,194,66,0.1)' : upMsg.startsWith('❌') || upMsg.startsWith('⚠️') ? 'rgba(239,68,68,0.1)' : 'rgba(43,127,212,0.1)',
                  border: `1px solid ${upMsg.startsWith('✅') ? 'rgba(125,194,66,0.3)' : upMsg.startsWith('❌') || upMsg.startsWith('⚠️') ? 'rgba(239,68,68,0.3)' : 'rgba(43,127,212,0.3)'}`,
                  borderRadius: '8px', padding: '12px 16px', fontSize: '13px', color: T.textPrimary, marginBottom: '16px'
                }}>
                  {upMsg}
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '14px' }}>

                {/* Performance upload */}
                <div style={{ ...cardStyle, padding: '20px' }}>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: T.blue, marginBottom: '6px' }}>
                    <i className="ti ti-activity" style={{ marginRight: '7px' }} />Performance Data
                  </div>
                  <div style={{ fontSize: '11px', color: T.textMuted, marginBottom: '14px', lineHeight: 1.7 }}>
                    CSV with columns: <b style={{ color: T.textSecondary }}>Site Name; Date; Measured (kWh); Expected (kWh); Performance; PF Band</b><br />
                    Date format: Jan-25, Feb-25... Semicolon separated.
                  </div>
                  <label style={{ display: 'block', border: `2px dashed ${T.border}`, borderRadius: '10px', padding: '24px', textAlign: 'center', cursor: 'pointer', background: T.bgMuted, transition: 'border-color 0.2s' }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = T.blue}
                    onMouseLeave={e => e.currentTarget.style.borderColor = T.border}>
                    <i className="ti ti-file-upload" style={{ fontSize: '28px', color: T.blue, display: 'block', marginBottom: '8px' }} />
                    <span style={{ fontSize: '12px', color: T.textSecondary }}>Click to select performance CSV</span>
                    <input type="file" accept=".csv" onChange={handlePerfFile} style={{ display: 'none' }} disabled={upBusy} />
                  </label>
                  {upPerf && (
                    <div style={{ marginTop: '14px' }}>
                      <div style={{ fontSize: '12px', color: T.textPrimary, marginBottom: '8px' }}>
                        📄 <b>{upPerf.fileName}</b> — {upPerf.rows.length} valid records
                        {upPerf.dupCount > 0 && <span style={{ color: T.textMuted }}> · {upPerf.dupCount} duplicates merged</span>}
                        {upPerf.errors.length > 0 && <span style={{ color: T.red }}> · {upPerf.errors.length} rows skipped</span>}
                      </div>
                      <div style={{ maxHeight: '160px', overflowY: 'auto', border: `1px solid ${T.border}`, borderRadius: '8px', marginBottom: '10px' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                          <thead><tr style={{ background: T.bgMuted }}>
                            {['Site','Month','Year','Measured','Expected','Band'].map(h => <th key={h} style={{ padding: '5px 8px', textAlign: 'left', color: T.textMuted, fontSize: '9px', textTransform: 'uppercase' }}>{h}</th>)}
                          </tr></thead>
                          <tbody>
                            {upPerf.rows.slice(0,8).map((r,i) => (
                              <tr key={i} style={{ borderTop: `1px solid ${T.border}` }}>
                                <td style={{ padding: '4px 8px', color: T.textPrimary }}>{r.site_name}</td>
                                <td style={{ padding: '4px 8px', color: T.textSecondary }}>{r.month}</td>
                                <td style={{ padding: '4px 8px', color: T.textSecondary }}>{r.year}</td>
                                <td style={{ padding: '4px 8px', color: T.textSecondary }}>{r.kwh_produced ?? '—'}</td>
                                <td style={{ padding: '4px 8px', color: T.textSecondary }}>{r.expected_kwh ?? '—'}</td>
                                <td style={{ padding: '4px 8px', color: T.textSecondary }}>{r.pf_band ?? '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={uploadPerf} disabled={upBusy} style={{ flex: 1, padding: '10px', background: T.blue, color: '#fff', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: upBusy ? 'not-allowed' : 'pointer', opacity: upBusy ? 0.6 : 1 }}>
                          {upBusy ? 'Uploading...' : `Upload ${upPerf.rows.length} records`}
                        </button>
                        <button onClick={() => setUpPerf(null)} disabled={upBusy} style={{ padding: '10px 16px', background: 'rgba(239,68,68,0.1)', color: T.red, border: `1px solid rgba(239,68,68,0.3)`, borderRadius: '8px', fontSize: '13px', cursor: 'pointer' }}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Sites upload */}
                <div style={{ ...cardStyle, padding: '20px' }}>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: T.green, marginBottom: '6px' }}>
                    <i className="ti ti-map-pin" style={{ marginRight: '7px' }} />Site / Installation Info
                  </div>
                  <div style={{ fontSize: '11px', color: T.textMuted, marginBottom: '14px', lineHeight: 1.7 }}>
                    CSV with columns: <b style={{ color: T.textSecondary }}>Site Name; Location; Province; Country; PV Capacity (W); Commisioned Date; Operational Satus; Contract Type; Business Type; Investment Party; Battery Size (Wh); Installer Name...</b><br />
                    Same format as your site_tech_info file. Matched by Site Name.
                  </div>
                  <label style={{ display: 'block', border: `2px dashed rgba(125,194,66,0.3)`, borderRadius: '10px', padding: '24px', textAlign: 'center', cursor: 'pointer', background: T.bgMuted, transition: 'border-color 0.2s' }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = T.green}
                    onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(125,194,66,0.3)'}>
                    <i className="ti ti-file-upload" style={{ fontSize: '28px', color: T.green, display: 'block', marginBottom: '8px' }} />
                    <span style={{ fontSize: '12px', color: T.textSecondary }}>Click to select sites CSV</span>
                    <input type="file" accept=".csv" onChange={handleSitesFile} style={{ display: 'none' }} disabled={upBusy} />
                  </label>
                  {upSites && (
                    <div style={{ marginTop: '14px' }}>
                      <div style={{ fontSize: '12px', color: T.textPrimary, marginBottom: '8px' }}>
                        📄 <b>{upSites.fileName}</b> — {upSites.rows.length} valid sites
                        {upSites.errors.length > 0 && <span style={{ color: T.red }}> · {upSites.errors.length} rows skipped</span>}
                      </div>
                      <div style={{ maxHeight: '160px', overflowY: 'auto', border: `1px solid ${T.border}`, borderRadius: '8px', marginBottom: '10px' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                          <thead><tr style={{ background: T.bgMuted }}>
                            {['Site','Province','kWp','Contract','Investor','Status'].map(h => <th key={h} style={{ padding: '5px 8px', textAlign: 'left', color: T.textMuted, fontSize: '9px', textTransform: 'uppercase' }}>{h}</th>)}
                          </tr></thead>
                          <tbody>
                            {upSites.rows.slice(0,8).map((r,i) => (
                              <tr key={i} style={{ borderTop: `1px solid ${T.border}` }}>
                                <td style={{ padding: '4px 8px', color: T.textPrimary }}>{r.name}</td>
                                <td style={{ padding: '4px 8px', color: T.textSecondary }}>{r.province ?? '—'}</td>
                                <td style={{ padding: '4px 8px', color: T.textSecondary }}>{r.capacity_kw ?? '—'}</td>
                                <td style={{ padding: '4px 8px', color: T.textSecondary }}>{r.system_type ?? '—'}</td>
                                <td style={{ padding: '4px 8px', color: T.textSecondary }}>{r.investment_party ?? '—'}</td>
                                <td style={{ padding: '4px 8px', color: T.textSecondary }}>{r.status ?? '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={uploadSites} disabled={upBusy} style={{ flex: 1, padding: '10px', background: T.green, color: '#fff', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: upBusy ? 'not-allowed' : 'pointer', opacity: upBusy ? 0.6 : 1 }}>
                          {upBusy ? 'Uploading...' : `Upload ${upSites.rows.length} sites`}
                        </button>
                        <button onClick={() => setUpSites(null)} disabled={upBusy} style={{ padding: '10px 16px', background: 'rgba(239,68,68,0.1)', color: T.red, border: `1px solid rgba(239,68,68,0.3)`, borderRadius: '8px', fontSize: '13px', cursor: 'pointer' }}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Comments upload */}
                <div style={{ ...cardStyle, padding: '20px' }}>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: T.orange, marginBottom: '6px' }}>
                    <i className="ti ti-message-2" style={{ marginRight: '7px' }} />Technical Comments
                  </div>
                  <div style={{ fontSize: '11px', color: T.textMuted, marginBottom: '14px', lineHeight: 1.7 }}>
                    CSV with columns: <b style={{ color: T.textSecondary }}>Site Name; Date; Availability; Downtime (days); Cause of downtime; Technical Events; Energy Impact; Other Comments</b><br />
                    Date format: Jan-25, Feb-25... Semicolon separated. Rows with no data in any field are skipped.
                  </div>
                  <label style={{ display: 'block', border: `2px dashed rgba(240,165,0,0.3)`, borderRadius: '10px', padding: '24px', textAlign: 'center', cursor: 'pointer', background: T.bgMuted, transition: 'border-color 0.2s' }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = T.orange}
                    onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(240,165,0,0.3)'}>
                    <i className="ti ti-file-upload" style={{ fontSize: '28px', color: T.orange, display: 'block', marginBottom: '8px' }} />
                    <span style={{ fontSize: '12px', color: T.textSecondary }}>Click to select comments CSV</span>
                    <input type="file" accept=".csv" onChange={handleCommentsFile} style={{ display: 'none' }} disabled={upBusy} />
                  </label>
                  {upComments && (
                    <div style={{ marginTop: '14px' }}>
                      <div style={{ fontSize: '12px', color: T.textPrimary, marginBottom: '8px' }}>
                        📄 <b>{upComments.fileName}</b> — {upComments.rows.length} comments
                        {upComments.emptySkipped > 0 && <span style={{ color: T.textMuted }}> · {upComments.emptySkipped} empty skipped</span>}
                        {upComments.errors.length > 0 && <span style={{ color: T.red }}> · {upComments.errors.length} invalid rows</span>}
                      </div>
                      <div style={{ maxHeight: '160px', overflowY: 'auto', border: `1px solid ${T.border}`, borderRadius: '8px', marginBottom: '10px' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                          <thead><tr style={{ background: T.bgMuted }}>
                            {['Site','Month','Year','Availability','Downtime','Events'].map(h => <th key={h} style={{ padding: '5px 8px', textAlign: 'left', color: T.textMuted, fontSize: '9px', textTransform: 'uppercase' }}>{h}</th>)}
                          </tr></thead>
                          <tbody>
                            {upComments.rows.slice(0,8).map((r,i) => (
                              <tr key={i} style={{ borderTop: `1px solid ${T.border}` }}>
                                <td style={{ padding: '4px 8px', color: T.textPrimary, whiteSpace: 'nowrap' }}>{r.site_name}</td>
                                <td style={{ padding: '4px 8px', color: T.textSecondary }}>{r.month}</td>
                                <td style={{ padding: '4px 8px', color: T.textSecondary }}>{r.year}</td>
                                <td style={{ padding: '4px 8px', color: T.textSecondary, maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.availability || '—'}</td>
                                <td style={{ padding: '4px 8px', color: T.textSecondary }}>{r.downtime_days != null ? r.downtime_days : '—'}</td>
                                <td style={{ padding: '4px 8px', color: T.textSecondary, maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{[r.cause_of_downtime, r.technical_events].filter(Boolean).join('; ') || '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={uploadComments} disabled={upBusy} style={{ flex: 1, padding: '10px', background: T.orange, color: '#fff', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: upBusy ? 'not-allowed' : 'pointer', opacity: upBusy ? 0.6 : 1 }}>
                          {upBusy ? 'Uploading...' : `Upload ${upComments.rows.length} comments`}
                        </button>
                        <button onClick={() => setUpComments(null)} disabled={upBusy} style={{ padding: '10px 16px', background: 'rgba(239,68,68,0.1)', color: T.red, border: `1px solid rgba(239,68,68,0.3)`, borderRadius: '8px', fontSize: '13px', cursor: 'pointer' }}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Offtake Guarantees upload */}
                <div style={{ ...cardStyle, padding: '20px' }}>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: T.blue, marginBottom: '6px' }}>
                    <i className="ti ti-shield-check" style={{ marginRight: '7px' }} />Offtake Guarantees
                  </div>
                  <div style={{ fontSize: '11px', color: T.textMuted, marginBottom: '14px', lineHeight: 1.7 }}>
                    CSV with columns: <b style={{ color: T.textSecondary }}>Site Name; Offtake Guarantee; Expected Utilisation%; Age; As-Built kWh; Guaranteed Generation (kWh); Unavailability kWh; Correct kWh; Actual Generation (kWh); Shortfall (kWh); Performance Rate; Notes</b><br />
                    Matched by Site Name. Semicolon or comma separated.
                  </div>
                  <label style={{ display: 'block', border: `2px dashed rgba(11,116,215,0.3)`, borderRadius: '10px', padding: '24px', textAlign: 'center', cursor: 'pointer', background: T.bgMuted, transition: 'border-color 0.2s' }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = T.blue}
                    onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(11,116,215,0.3)'}>
                    <i className="ti ti-file-upload" style={{ fontSize: '28px', color: T.blue, display: 'block', marginBottom: '8px' }} />
                    <span style={{ fontSize: '12px', color: T.textSecondary }}>Click to select offtake CSV</span>
                    <input type="file" accept=".csv" onChange={handleOgFile} style={{ display: 'none' }} disabled={upBusy} />
                  </label>
                  {upOg && (
                    <div style={{ marginTop: '14px' }}>
                      <div style={{ fontSize: '12px', color: T.textPrimary, marginBottom: '8px' }}>
                        📄 <b>{upOg.fileName}</b> — {upOg.rows.length} sites
                        {upOg.errors.length > 0 && <span style={{ color: T.red }}> · {upOg.errors.length} invalid rows</span>}
                      </div>
                      <div style={{ maxHeight: '160px', overflowY: 'auto', border: `1px solid ${T.border}`, borderRadius: '8px', marginBottom: '10px' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                          <thead><tr style={{ background: T.bgMuted }}>
                            {['Site','Util%','Guaranteed','Actual','Shortfall','Perf%'].map(h => <th key={h} style={{ padding: '5px 8px', textAlign: 'left', color: T.textMuted, fontSize: '9px', textTransform: 'uppercase' }}>{h}</th>)}
                          </tr></thead>
                          <tbody>
                            {upOg.rows.slice(0,8).map((r,i) => (
                              <tr key={i} style={{ borderTop: `1px solid ${T.border}` }}>
                                <td style={{ padding: '4px 8px', color: T.textPrimary, whiteSpace: 'nowrap' }}>{r.site_name}</td>
                                <td style={{ padding: '4px 8px', color: T.textSecondary }}>{r.expected_utilisation ?? '—'}</td>
                                <td style={{ padding: '4px 8px', color: T.textSecondary }}>{r.correct_kwh != null ? Math.round(r.correct_kwh).toLocaleString() : '—'}</td>
                                <td style={{ padding: '4px 8px', color: T.textSecondary }}>{r.actual_kwh != null ? Math.round(r.actual_kwh).toLocaleString() : '—'}</td>
                                <td style={{ padding: '4px 8px', color: (r.shortfall_kwh ?? 0) >= 0 ? T.green : T.red }}>{r.shortfall_kwh != null ? Math.round(r.shortfall_kwh).toLocaleString() : '—'}</td>
                                <td style={{ padding: '4px 8px', color: T.textSecondary }}>{r.performance_rate ?? '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={uploadOg} disabled={upBusy} style={{ flex: 1, padding: '10px', background: T.blue, color: '#fff', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: upBusy ? 'not-allowed' : 'pointer', opacity: upBusy ? 0.6 : 1 }}>
                          {upBusy ? 'Uploading...' : `Upload ${upOg.rows.length} guarantees`}
                        </button>
                        <button onClick={() => setUpOg(null)} disabled={upBusy} style={{ padding: '10px 16px', background: 'rgba(239,68,68,0.1)', color: T.red, border: `1px solid rgba(239,68,68,0.3)`, borderRadius: '8px', fontSize: '13px', cursor: 'pointer' }}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div style={{ background: 'rgba(245,208,0,0.06)', border: `1px solid rgba(245,208,0,0.2)`, borderRadius: '10px', padding: '14px 18px', marginTop: '16px', fontSize: '12px', color: T.yellow, lineHeight: 1.7, opacity: 0.9 }}>
                <b>💡 How it works:</b> <span style={{ color: T.textSecondary }}>Records are matched by Site Name + Month + Year (performance &amp; comments) or Site Name (sites). If a match exists it gets <b style={{ color: T.textPrimary }}>updated</b>, otherwise a <b style={{ color: T.textPrimary }}>new record is added</b>. You can safely re-upload the same file — no duplicates will be created. Export your Excel sheet as CSV (semicolon separated) before uploading.</span>
              </div>
            </div>
          )}

          {/* ── REPORTS ── */}
          {activePage === 'report' && (() => {
            const monthNamesR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
            const repSites = (repInvestor ? sites.filter(s => s.investment_party === repInvestor) : sites)
            const [ry, rm] = repDate ? repDate.split('-').map(Number) : [null, null]
            const repPerf = perfData.filter(p => {
              const site = sites.find(s => s.name?.trim().toLowerCase() === p.site_name?.trim().toLowerCase())
              const mI = !repInvestor || site?.investment_party === repInvestor
              const mD = !repDate || (p.year === ry && p.month === rm)
              return mI && mD
            }).filter(p => p.kwh_produced != null || p.expected_kwh != null)

            const rCap = repSites.reduce((s, x) => s + (x.capacity_kw || 0), 0)
            const rBess = repSites.reduce((s, x) => s + (x.battery_size_wh || 0), 0)
            const rMeas = repPerf.reduce((s, p) => s + (p.kwh_produced || 0), 0)
            const rExp = repPerf.reduce((s, p) => s + (p.expected_kwh || 0), 0)
            const rDelta = rExp > 0 ? (((rMeas - rExp) / rExp) * 100).toFixed(1) : null
            const rExpC = repPerf.filter(p => p.pf_band === 'Expected').length
            const rModC = repPerf.filter(p => p.pf_band === 'Moderate').length
            const rPoorC = repPerf.filter(p => p.pf_band === 'Poor').length
            const genDate = new Date().toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })
            const periodLabel = repDate ? `${monthNamesR[rm - 1]} ${ry}` : 'All periods'
            const invLabel = repInvestor || 'All investment parties'

            return (
              <div>
                {/* Controls */}
                <div className="no-print">
                  <div style={{ fontSize: '20px', fontWeight: 800, color: T.textWhite, marginBottom: '2px' }}>Reports</div>
                  <div style={{ fontSize: '12px', color: T.textSecondary, marginBottom: '18px' }}>Generate filtered reports — use Print / Save as PDF to export</div>

                  <div style={{ ...cardStyle, padding: '12px 16px', marginBottom: '16px', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                    <div style={{ display: 'flex', gap: '5px' }}>
                      {[{ id: 'install', label: 'Installation Overview' }, { id: 'perf', label: 'Site Performance' }].map(t => (
                        <div key={t.id} className="tab" onClick={() => setRepType(t.id)} style={{ padding: '7px 15px', borderRadius: '20px', fontSize: '12px', border: `1px solid ${repType === t.id ? T.blue : T.border}`, cursor: 'pointer', background: repType === t.id ? T.blue : 'transparent', color: repType === t.id ? '#fff' : T.textSecondary, fontWeight: repType === t.id ? 700 : 400, transition: 'all 0.15s' }}>
                          {t.label}
                        </div>
                      ))}
                    </div>
                    <select style={selectStyle} value={repInvestor} onChange={e => setRepInvestor(e.target.value)}>
                      <option value="">All Investment Parties</option>
                      {investors.map(i => <option key={i}>{i}</option>)}
                    </select>
                    {repType === 'perf' && (
                      <select style={selectStyle} value={repDate} onChange={e => setRepDate(e.target.value)}>
                        <option value="">All Periods</option>
                        {perfDates.map(d => {
                          const [y, m] = d.split('-')
                          return <option key={d} value={d}>{monthNamesR[parseInt(m)-1]}-{y.slice(2)}</option>
                        })}
                      </select>
                    )}
                    <button onClick={() => window.print()} style={{ marginLeft: 'auto', padding: '8px 18px', background: T.blue, color: '#fff', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
                      <i className="ti ti-printer" style={{ marginRight: '6px' }} />Print / Save PDF
                    </button>
                  </div>
                </div>

                {/* Report document — stays white for print */}
                <div className="print-area" style={{ background: '#fff', color: '#1a2a4a', border: `1px solid ${T.border}`, borderRadius: '12px', padding: '32px', maxWidth: '900px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '3px solid #2B7FD4', paddingBottom: '18px', marginBottom: '22px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <svg width="44" height="50" viewBox="0 0 46 52" fill="none">
                        <ellipse cx="23" cy="16" rx="18" ry="16" fill="#F5D000"/>
                        <ellipse cx="23" cy="36" rx="18" ry="16" fill="#2B7FD4"/>
                        <rect x="14" y="20" width="14" height="12" rx="2" fill="#7DC242" transform="rotate(-8 14 20)"/>
                      </svg>
                      <div>
                        <div style={{ fontSize: '22px', fontWeight: 800, color: '#2B7FD4' }}>Sosimple Energy</div>
                        <div style={{ fontSize: '10px', color: '#7DC242', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase' }}>Cheap energy. Clean business.</div>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', fontSize: '11px', color: '#7a9aba', lineHeight: 1.7 }}>
                      Generated: {genDate}<br />
                      Investment Party: <b style={{ color: '#1a2a4a' }}>{invLabel}</b>
                      {repType === 'perf' && <><br />Period: <b style={{ color: '#1a2a4a' }}>{periodLabel}</b></>}
                    </div>
                  </div>

                  <div style={{ fontSize: '20px', fontWeight: 700, color: '#1a2a4a', marginBottom: '18px' }}>
                    {repType === 'install' ? 'Installation Overview Report' : 'Site Performance Report'}
                  </div>

                  {repType === 'install' ? (
                    <>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px', marginBottom: '24px' }}>
                        {[
                          { label: 'Total Sites', val: repSites.length },
                          { label: 'Capacity (MWp)', val: (rCap/1000).toFixed(2) },
                          { label: 'BESS (MWh)', val: (rBess/1000000).toFixed(2) },
                          { label: 'PPA Sites', val: repSites.filter(s=>s.system_type==='PPA').length },
                          { label: 'RTO Sites', val: repSites.filter(s=>s.system_type==='RTO').length },
                        ].map(k => (
                          <div key={k.label} style={{ background: '#f8fbff', border: '1px solid #dce8f8', borderRadius: '8px', padding: '12px', textAlign: 'center' }}>
                            <div style={{ fontSize: '22px', fontWeight: 700, color: '#2B7FD4' }}>{k.val}</div>
                            <div style={{ fontSize: '10px', color: '#7a9aba', marginTop: '2px' }}>{k.label}</div>
                          </div>
                        ))}
                      </div>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                        <thead><tr style={{ background: '#2B7FD4' }}>
                          {['Site Name','Province','Capacity (kWp)','BESS (kWh)','Contract','Type','Investor','Status'].map(h => (
                            <th key={h} style={{ padding: '8px 9px', textAlign: 'left', color: '#fff', fontSize: '10px', fontWeight: 600 }}>{h}</th>
                          ))}
                        </tr></thead>
                        <tbody>
                          {repSites.map((s, i) => (
                            <tr key={s.id} style={{ background: i%2===0 ? '#fff' : '#f8fbff' }}>
                              <td style={{ padding: '6px 9px', borderBottom: '1px solid #f0f6ff', fontWeight: 500 }}>{s.name}</td>
                              <td style={{ padding: '6px 9px', borderBottom: '1px solid #f0f6ff' }}>{s.province||'—'}</td>
                              <td style={{ padding: '6px 9px', borderBottom: '1px solid #f0f6ff' }}>{s.capacity_kw??'—'}</td>
                              <td style={{ padding: '6px 9px', borderBottom: '1px solid #f0f6ff' }}>{s.battery_size_wh>0?(s.battery_size_wh/1000).toFixed(1):'—'}</td>
                              <td style={{ padding: '6px 9px', borderBottom: '1px solid #f0f6ff' }}>{s.system_type||'—'}</td>
                              <td style={{ padding: '6px 9px', borderBottom: '1px solid #f0f6ff' }}>{s.business_type||'—'}</td>
                              <td style={{ padding: '6px 9px', borderBottom: '1px solid #f0f6ff' }}>{s.investment_party||'—'}</td>
                              <td style={{ padding: '6px 9px', borderBottom: '1px solid #f0f6ff' }}>{s.status||'active'}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr style={{ background: '#f0f6ff', fontWeight: 700 }}>
                            <td colSpan={2} style={{ padding: '8px 9px', fontSize: '10px' }}>TOTAL — {repSites.length} sites</td>
                            <td style={{ padding: '8px 9px', fontSize: '10px' }}>{rCap.toFixed(1)} kWp</td>
                            <td style={{ padding: '8px 9px', fontSize: '10px' }}>{(rBess/1000).toFixed(1)} kWh</td>
                            <td colSpan={4}></td>
                          </tr>
                        </tfoot>
                      </table>
                    </>
                  ) : (
                    <>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: '10px', marginBottom: '24px' }}>
                        {[
                          { label: 'Records', val: repPerf.length },
                          { label: 'Measured (kWh)', val: rMeas.toLocaleString() },
                          { label: 'Expected (kWh)', val: rExp.toLocaleString() },
                          { label: 'Δ vs Expected', val: rDelta!=null?`${rDelta>0?'+':''}${rDelta}%`:'—', color: rDelta>=0?'#3a7a00':'#9a1a1a' },
                          { label: 'Expected Band', val: rExpC },
                          { label: 'Moderate / Poor', val: `${rModC} / ${rPoorC}` },
                        ].map(k => (
                          <div key={k.label} style={{ background: '#f8fbff', border: '1px solid #dce8f8', borderRadius: '8px', padding: '12px', textAlign: 'center' }}>
                            <div style={{ fontSize: '16px', fontWeight: 700, color: k.color||'#2B7FD4' }}>{k.val}</div>
                            <div style={{ fontSize: '9px', color: '#7a9aba', marginTop: '2px' }}>{k.label}</div>
                          </div>
                        ))}
                      </div>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                        <thead><tr style={{ background: '#2B7FD4' }}>
                          {['Site Name','Period','Measured (kWh)','Expected (kWh)','Δ %','PF Band','Comment'].map(h => (
                            <th key={h} style={{ padding: '8px 9px', textAlign: 'left', color: '#fff', fontSize: '10px', fontWeight: 600 }}>{h}</th>
                          ))}
                        </tr></thead>
                        <tbody>
                          {repPerf.length===0 ? (
                            <tr><td colSpan={7} style={{ padding: '20px', textAlign: 'center', color: '#9ab8d8' }}>No performance records for the selected filters</td></tr>
                          ) : repPerf.map((p,i) => {
                            const d = p.kwh_produced!=null&&p.expected_kwh>0?(((p.kwh_produced-p.expected_kwh)/p.expected_kwh)*100).toFixed(1):null
                            return (
                              <tr key={p.id} style={{ background: i%2===0?'#fff':'#f8fbff' }}>
                                <td style={{ padding: '6px 9px', borderBottom: '1px solid #f0f6ff', fontWeight: 500 }}>{p.site_name}</td>
                                <td style={{ padding: '6px 9px', borderBottom: '1px solid #f0f6ff', whiteSpace: 'nowrap' }}>{monthNamesR[p.month-1]}-{String(p.year).slice(2)}</td>
                                <td style={{ padding: '6px 9px', borderBottom: '1px solid #f0f6ff' }}>{p.kwh_produced!=null?p.kwh_produced.toLocaleString():'—'}</td>
                                <td style={{ padding: '6px 9px', borderBottom: '1px solid #f0f6ff' }}>{p.expected_kwh!=null?p.expected_kwh.toLocaleString():'—'}</td>
                                <td style={{ padding: '6px 9px', borderBottom: '1px solid #f0f6ff', fontWeight: 600, color: d==null?'#9ab8d8':d>=0?'#3a7a00':'#9a1a1a' }}>{d!=null?`${d>0?'+':''}${d}%`:'—'}</td>
                                <td style={{ padding: '6px 9px', borderBottom: '1px solid #f0f6ff' }}>{p.pf_band||'—'}</td>
                                <td style={{ padding: '6px 9px', borderBottom: '1px solid #f0f6ff', fontSize: '10px', color: '#5a7aaa', whiteSpace: 'pre-line', maxWidth: '220px' }}>{p.comment || [p.availability, p.cause_of_downtime, p.technical_events, p.energy_impact, p.other_comments].filter(Boolean).join('\n') || '—'}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                        {repPerf.length>0&&(
                          <tfoot>
                            <tr style={{ background: '#f0f6ff', fontWeight: 700 }}>
                              <td colSpan={2} style={{ padding: '8px 9px', fontSize: '10px' }}>TOTAL — {repPerf.length} records</td>
                              <td style={{ padding: '8px 9px', fontSize: '10px' }}>{rMeas.toLocaleString()}</td>
                              <td style={{ padding: '8px 9px', fontSize: '10px' }}>{rExp.toLocaleString()}</td>
                              <td style={{ padding: '8px 9px', fontSize: '10px', color: rDelta>=0?'#3a7a00':'#9a1a1a' }}>{rDelta!=null?`${rDelta>0?'+':''}${rDelta}%`:'—'}</td>
                              <td colSpan={2}></td>
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </>
                  )}

                  <div style={{ marginTop: '24px', paddingTop: '14px', borderTop: '1px solid #dce8f8', fontSize: '10px', color: '#9ab8d8', textAlign: 'center' }}>
                    © {new Date().getFullYear()} Sosimple Energy — Confidential. Generated from the Sosimple Performance Portal.
                  </div>
                </div>
              </div>
            )
          })()}

        </main>
      </div>
    </>
  )
}