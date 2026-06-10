'use client'

import { useEffect, useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'

// Parses semicolon-delimited CSV with quoted multiline fields
function parseCSV(text) {
  const rows = []
  let row = [], field = '', inQuotes = false
  text = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else field += ch
    } else {
      if (ch === '"') inQuotes = true
      else if (ch === ';') { row.push(field); field = '' }
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
  // Performance state
  const [perfData, setPerfData] = useState([])
  const [perfLoading, setPerfLoading] = useState(false)
  const [pfFilterInvestor, setPfFilterInvestor] = useState('')
  const [pfFilterDate, setPfFilterDate] = useState('')
  const [pfFilterBand, setPfFilterBand] = useState('')
  // Site Performance state
  const [spSite, setSpSite] = useState('')
  const [spSearch, setSpSearch] = useState('')
  const [spYear, setSpYear] = useState('')
  const [spYearA, setSpYearA] = useState('')
  const [spYearB, setSpYearB] = useState('')
  const [spCommentDate, setSpCommentDate] = useState('')
  // Data Upload state
  const [upPerf, setUpPerf] = useState(null)
  const [upSites, setUpSites] = useState(null)
  const [upComments, setUpComments] = useState(null)
  // Report state
  const [repType, setRepType] = useState('install')
  const [repInvestor, setRepInvestor] = useState('')
  const [repDate, setRepDate] = useState('')
  const [upMsg, setUpMsg] = useState('')
  const [upBusy, setUpBusy] = useState(false)
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

  // Load performance data when page is opened
  useEffect(() => {
    if ((activePage === 'performance' || activePage === 'siteperf' || activePage === 'report') && perfData.length === 0) {
      loadPerformance()
    }
  }, [activePage])


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

  // Derived site values
  const investors = [...new Set(sites.map(s => s.investment_party).filter(Boolean))].sort()
  const installers = [...new Set(sites.map(s => s.installer_name).filter(Boolean))].sort()
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

  // Performance derived values
  const perfDates = [...new Set(perfData.map(p => `${p.year}-${String(p.month).padStart(2,'0')}`))].sort().reverse()

  // Get investor for a perf record — from joined sites table or direct
  function getInvestor(p) {
    // Look up investor from sites array by site_id or site_name
    const site = sites.find(s => (p.site_id && s.id === p.site_id) || s.name?.trim().toLowerCase() === p.site_name?.trim().toLowerCase())
    return site?.investment_party || ''
  }

  const filteredPerf = perfData.filter(p => {
    const mI = !pfFilterInvestor || getInvestor(p) === pfFilterInvestor
    const mD = !pfFilterDate || `${p.year}-${String(p.month).padStart(2,'0')}` === pfFilterDate
    const mB = !pfFilterBand || p.pf_band === pfFilterBand
    return mI && mD && mB
  })

  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  function fmtDate(month, year) { return `${monthNames[month-1]}-${String(year).slice(2)}` }

  function buildCharts(sitesData) {
    if (typeof window === 'undefined') return
    const Chart = window.Chart
    if (!Chart) return
    const destroy = (id) => { if (chartsRef.current[id]) { chartsRef.current[id].destroy(); delete chartsRef.current[id] } }
    const C = { blue: '#2B7FD4', yellow: '#F5D000', green: '#7DC242', orange: '#f0a500', gray: '#9ab8d8', purple: '#8b5cf6', red: '#ef4444' }
    const commonOpts = { responsive: true, maintainAspectRatio: false }

    const types = ['Retail', 'Manufacture', 'Residential', 'Commercial', 'Agricultural']
    const tColors = [C.blue, C.yellow, C.green, C.orange, C.gray]
    const tCounts = types.map(t => sitesData.filter(s => s.business_type === t).length)
    destroy('bizChart')
    const bizEl = document.getElementById('bizChart')
    if (bizEl) chartsRef.current['bizChart'] = new Chart(bizEl, { type: 'doughnut', data: { labels: types, datasets: [{ data: tCounts, backgroundColor: tColors, borderWidth: 2, borderColor: '#fff' }] }, options: { ...commonOpts, cutout: '55%', plugins: { legend: { display: true, position: 'right', labels: { font: { size: 11 }, boxWidth: 12 } } } } })

    // ── Geo maps: MWp + site count per province (SA & Zambia) ──
    const alias = { 'kzn': 'KwaZulu-Natal', 'kwazulu-natal': 'KwaZulu-Natal', 'kwazulu natal': 'KwaZulu-Natal', 'free state': 'Free State', 'freestate': 'Free State', 'gauteng': 'Gauteng', 'limpopo': 'Limpopo', 'north west': 'North West', 'northwest': 'North West', 'western cape': 'Western Cape', 'mpumalanga': 'Mpumalanga', 'northern cape': 'Northern Cape', 'eastern cape': 'Eastern Cape', 'lusaka': 'Lusaka', 'zambia': 'Lusaka', 'copperbelt': 'Copperbelt', 'southern': 'Southern', 'central': 'Central', 'eastern': 'Eastern', 'northern': 'Northern', 'western': 'Western', 'north-western': 'North-Western', 'luapula': 'Luapula', 'muchinga': 'Muchinga' }
    const featName = f => f.properties.NAME_1 || f.properties.name || ''
    const lerp = (a, b, t) => Math.round(a + (b - a) * t)
    const orangeRamp = (t) => {
      if (t <= 0) return '#e6e6e6'
      const from = [252, 228, 214], to = [178, 49, 22]
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
              ctx.fillStyle = t > 0.55 ? '#ffffff' : '#7a3010'
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
              borderColor: '#ffffff',
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
              color: { axis: 'x', interpolate: orangeRamp, legend: { display: false } }
            }
          }
        })
      } else {
        // Fallback bar chart
        const keys = Object.keys(rawMap).sort((a, b) => rawMap[b] - rawMap[a]).slice(0, 9)
        chartsRef.current[canvasId] = new Chart(el, { type: 'bar', data: { labels: keys, datasets: [{ data: keys.map(p => rawMap[p].toFixed(decimals)), backgroundColor: C.blue, borderRadius: 4 }] }, options: { ...commonOpts, plugins: { legend: { display: false } }, scales: { x: { ticks: { maxRotation: 40, font: { size: 9 } } }, y: { grid: { color: '#dce8f8' }, ticks: { callback: v => v + ' ' + unit } } } } })
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
    if (provBessEl) chartsRef.current['provBessChart'] = new Chart(provBessEl, { type: 'bar', data: { labels: bessKeys.length ? bessKeys : ['No BESS data'], datasets: [{ data: bessKeys.length ? bessKeys.map(p => (provBessMap[p]/1000000).toFixed(2)) : [0], backgroundColor: C.yellow, borderRadius: 4 }] }, options: { ...commonOpts, plugins: { legend: { display: false } }, scales: { x: { ticks: { maxRotation: 40, font: { size: 9 } } }, y: { grid: { color: '#dce8f8' }, ticks: { callback: v => v+' MWh' } } } } })

    const otherC = sitesData.filter(s => s.system_type !== 'PPA' && s.system_type !== 'RTO').length
    const ppa = sitesData.filter(s => s.system_type === 'PPA').length
    const rto = sitesData.filter(s => s.system_type === 'RTO').length
    destroy('contractChart')
    const conEl = document.getElementById('contractChart')
    if (conEl) chartsRef.current['contractChart'] = new Chart(conEl, { type: 'doughnut', data: { labels: ['PPA','RTO','Other'], datasets: [{ data: [ppa,rto,otherC], backgroundColor: [C.blue,C.green,C.gray], borderWidth: 2, borderColor: '#fff' }] }, options: { ...commonOpts, cutout: '60%', plugins: { legend: { display: true, position: 'right', labels: { font: { size: 11 }, boxWidth: 12 } } } } })

    const invList = ['SSI','Anuva','12B Fund']
    const invCounts = invList.map(inv => sitesData.filter(s => s.investment_party === inv).length)
    destroy('investorChart')
    const invEl = document.getElementById('investorChart')
    if (invEl) chartsRef.current['investorChart'] = new Chart(invEl, { type: 'doughnut', data: { labels: invList, datasets: [{ data: invCounts, backgroundColor: [C.blue,C.yellow,C.green], borderWidth: 2, borderColor: '#fff' }] }, options: { ...commonOpts, cutout: '60%', plugins: { legend: { display: true, position: 'right', labels: { font: { size: 11 }, boxWidth: 12 } } } } })

    const invCaps = invList.map(inv => (sitesData.filter(s => s.investment_party === inv).reduce((s,x) => s+(x.capacity_kw||0), 0)/1000).toFixed(2))
    destroy('invCapChart')
    const invCapEl = document.getElementById('invCapChart')
    if (invCapEl) chartsRef.current['invCapChart'] = new Chart(invCapEl, { type: 'bar', data: { labels: invList, datasets: [{ data: invCaps, backgroundColor: [C.blue,C.yellow,C.green], borderRadius: 8 }] }, options: { ...commonOpts, plugins: { legend: { display: false } }, scales: { y: { grid: { color: '#dce8f8' }, ticks: { callback: v => v+' MWp' } } } } })
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
      setUpPerf({ rows: parsed, errors, fileName: file.name })
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
        }
        if (idx.date >= 0) {
          const d = (r[idx.date] || '').trim()
          const p = d.split('/')
          rec.install_date = p.length === 3 ? `${p[0]}-${p[1]}-${p[2]}` : null
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
    let done = 0, failed = 0
    for (let i = 0; i < upPerf.rows.length; i += 500) {
      const batch = upPerf.rows.slice(i, i + 500)
      const { error } = await supabase.from('performance').upsert(batch, { onConflict: 'site_name,month,year' })
      if (error) { failed += batch.length; console.error(error) }
      else done += batch.length
      setUpMsg(`Uploading... ${done + failed}/${upPerf.rows.length}`)
    }
    setUpMsg(failed === 0 ? `✅ ${done} performance records uploaded successfully` : `⚠️ ${done} uploaded, ${failed} failed — check console (F12)`)
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
        comment: headers.findIndex(h => h.includes('comment')),
      }
      if (idx.name < 0 || idx.date < 0 || idx.comment < 0) { setUpMsg('❌ Comments CSV must have "Site Name", "Date" and "Comment" columns'); return }
      const parsed = [], errors = []
      let emptySkipped = 0
      rows.slice(1).forEach((r, i) => {
        const name = (r[idx.name] || '').trim()
        const [month, year] = parseMonthYear(r[idx.date])
        const comment = cleanStr(r[idx.comment])
        if (!name || !month) { errors.push(i + 2); return }
        if (!comment) { emptySkipped++; return }
        parsed.push({ site_name: name, month, year, comment })
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
    const C = { blue: '#2B7FD4', yellow: '#F5D000', green: '#7DC242', red: '#ef4444', gray: '#c5d5e8', dark: '#3a3a3a' }
    const recs = perfData.filter(p => p.site_name?.trim().toLowerCase() === spSite.trim().toLowerCase())
    const years = [...new Set(recs.map(p => p.year))].sort()
    const monthLabels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

    // Chart 1: Expected vs Measured + delta %
    const yr = parseInt(spYear) || years[years.length - 1]
    const measured = [], expected = [], delta = []
    for (let m = 1; m <= 12; m++) {
      const r = recs.find(p => p.year === yr && p.month === m)
      const me = r?.kwh_produced ?? null
      const ex = r?.expected_kwh ?? null
      measured.push(me); expected.push(ex)
      delta.push(me != null && ex ? +(((me - ex) / ex) * 100).toFixed(1) : null)
    }
    // Plugin that writes the Δ% value above/below each delta bar
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
          ctx.fillStyle = v >= 0 ? '#3a7a00' : '#9a1a1a'
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
          { type: 'bar', label: 'Measured (kWh)', data: measured, backgroundColor: C.dark, borderRadius: 4 },
        ]
      },
      plugins: [deltaLabelPlugin],
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { top: 16 } },
        plugins: {
          legend: { position: 'top', labels: { font: { size: 11 }, boxWidth: 12 } },
          tooltip: { callbacks: { label: ctx => ctx.dataset.yAxisID === 'y1' ? `Δ ${ctx.parsed.y > 0 ? '+' : ''}${ctx.parsed.y}%` : `${ctx.dataset.label}: ${ctx.parsed.y?.toLocaleString()} kWh` } }
        },
        scales: {
          y: { grid: { color: '#dce8f8' }, ticks: { callback: v => (v/1000).toFixed(0)+'k' } },
          y1: { position: 'right', grid: { drawOnChartArea: false }, ticks: { callback: v => v + '%' } }
        }
      }
    })

    // Chart 2: Year to Year comparison + delta %
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
          { type: 'bar', label: yA + ' Measured (kWh)', data: mA, backgroundColor: C.dark, borderRadius: 4 },
        ]
      },
      plugins: [deltaLabelPlugin],
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { top: 16 } },
        plugins: {
          legend: { position: 'top', labels: { font: { size: 11 }, boxWidth: 12 } },
          tooltip: { callbacks: { label: ctx => ctx.dataset.yAxisID === 'y1' ? `Δ ${ctx.parsed.y > 0 ? '+' : ''}${ctx.parsed.y}%` : `${ctx.dataset.label}: ${ctx.parsed.y?.toLocaleString()} kWh` } }
        },
        scales: {
          y: { grid: { color: '#dce8f8' }, ticks: { callback: v => (v/1000).toFixed(0)+'k' } },
          y1: { position: 'right', grid: { drawOnChartArea: false }, ticks: { callback: v => v + '%' } }
        }
      }
    })
  }

  function buildPerfCharts(data) {
    if (typeof window === 'undefined') return
    const Chart = window.Chart
    if (!Chart) return
    const destroy = (id) => { if (chartsRef.current[id]) { chartsRef.current[id].destroy(); delete chartsRef.current[id] } }
    const C = { blue: '#2B7FD4', yellow: '#F5D000', green: '#7DC242', red: '#ef4444', gray: '#9ab8d8' }

    // PF Band pie chart
    const exp = data.filter(p => p.pf_band === 'Expected').length
    const mod = data.filter(p => p.pf_band === 'Moderate').length
    const poor = data.filter(p => p.pf_band === 'Poor').length
    destroy('pfBandChart')
    const pfEl = document.getElementById('pfBandChart')
    if (pfEl) chartsRef.current['pfBandChart'] = new Chart(pfEl, { type: 'pie', data: { labels: ['Expected','Moderate','Poor'], datasets: [{ data: [exp,mod,poor], backgroundColor: [C.blue, C.yellow, C.red], borderWidth: 2, borderColor: '#fff' }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true, position: 'right', labels: { font: { size: 11 }, boxWidth: 12 } } } } })

    // Measured vs Expected bar (top 10 sites by measured kWh for selected period)
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
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true, position: 'top', labels: { font: { size: 11 }, boxWidth: 12 } } }, scales: { x: { ticks: { maxRotation: 40, font: { size: 9 } } }, y: { grid: { color: '#dce8f8' }, ticks: { callback: v => (v/1000).toFixed(0)+'k' } } } }
    })
  }

  function statusBadge(status) {
    const map = { active: { bg: '#edfae0', color: '#3a7a00', border: '#b8e890' }, inactive: { bg: '#fce8e8', color: '#9a1a1a', border: '#f5b8b8' } }
    const s = map[status] || { bg: '#f0f0f0', color: '#4a4a4a', border: '#d0d0d0' }
    return <span style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}`, borderRadius: '20px', padding: '2px 8px', fontSize: '10px', fontWeight: 500 }}>{status || 'active'}</span>
  }

  function typeBadge(type) {
    const map = { Retail: '#fffbe0|#8a6a00|#f0d840', Manufacture: '#f3e8fb|#5a1a8a|#d4b8ee', Residential: '#edfae0|#3a7a00|#b8e890', Commercial: '#e8f0fb|#1a4a9a|#b8ccee', Agricultural: '#f0f0f0|#4a4a4a|#d0d0d0' }
    const parts = (map[type] || '#f0f0f0|#4a4a4a|#d0d0d0').split('|')
    return <span style={{ background: parts[0], color: parts[1], border: `1px solid ${parts[2]}`, borderRadius: '20px', padding: '2px 8px', fontSize: '10px', fontWeight: 500 }}>{type || '--'}</span>
  }

  function pfBadge(band) {
    const map = { Expected: '#e8f0fb|#1a4a9a|#b8ccee', Moderate: '#fffbe0|#8a6a00|#f0d840', Poor: '#fce8e8|#9a1a1a|#f5b8b8' }
    const parts = (map[band] || '#f0f0f0|#4a4a4a|#d0d0d0').split('|')
    return <span style={{ background: parts[0], color: parts[1], border: `1px solid ${parts[2]}`, borderRadius: '20px', padding: '2px 8px', fontSize: '10px', fontWeight: 500 }}>{band || '--'}</span>
  }

  const selectStyle = { padding: '6px 11px', border: '1px solid #c0d8f8', borderRadius: '8px', fontSize: '12px', color: '#1a2a4a', background: '#fff', outline: 'none', cursor: 'pointer' }

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontSize: '14px', color: '#7a9aba' }}>Loading Sosimple Portal...</div>

  const fCap = filteredOverview.reduce((sum, s) => sum + (s.capacity_kw || 0), 0)
  const fBess = filteredOverview.reduce((sum, s) => sum + (s.battery_size_wh || 0), 0)
  const fPpa = filteredOverview.filter(s => s.system_type === 'PPA').length
  const fRto = filteredOverview.filter(s => s.system_type === 'RTO').length

  // Performance summary stats
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
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Segoe UI', sans-serif; background: #f4f7fb; }
        .nav-item:hover { background: #f0f6ff; color: #2B7FD4; }
        @media print {
          .no-print { display: none !important; }
          body { background: #fff !important; }
          .layout-flex { height: auto !important; display: block !important; }
          .main-area { overflow: visible !important; padding: 0 !important; }
          .print-area { border: none !important; box-shadow: none !important; }
        }
        .tbl-row:hover td { background: #f8fbff; }
        .tab:hover { background: #f0f6ff; }
      `}</style>

      {/* Topbar */}
      <div className="no-print" style={{ background: '#fff', borderBottom: '3px solid #2B7FD4', padding: '0 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '64px', position: 'sticky', top: 0, zIndex: 100, boxShadow: '0 2px 12px rgba(43,127,212,0.1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <svg width="40" height="46" viewBox="0 0 46 52" fill="none">
            <ellipse cx="23" cy="16" rx="18" ry="16" fill="#F5D000"/>
            <ellipse cx="23" cy="36" rx="18" ry="16" fill="#2B7FD4"/>
            <rect x="14" y="20" width="14" height="12" rx="2" fill="#7DC242" transform="rotate(-8 14 20)"/>
          </svg>
          <div>
            <div style={{ fontSize: '20px', fontWeight: 800, color: '#2B7FD4' }}>Sosimple</div>
            <div style={{ fontSize: '10px', color: '#7DC242', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase' }}>Cheap energy. Clean business.</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ background: '#f0f6ff', border: '1px solid #c0d8f8', borderRadius: '20px', padding: '4px 12px', fontSize: '11px', color: '#2B7FD4', fontWeight: 500 }}>{sites.length} Sites</span>
          <span style={{ background: '#fffbe0', border: '1px solid #f0d840', borderRadius: '20px', padding: '4px 12px', fontSize: '11px', color: '#8a6a00', fontWeight: 500 }}>{(totalCap / 1000).toFixed(2)} MWp</span>
          <span style={{ background: '#edfae0', border: '1px solid #b8e890', borderRadius: '20px', padding: '4px 12px', fontSize: '11px', color: '#3a7a00', fontWeight: 500 }}>{totalBessMwh} MWh BESS</span>
          <span style={{ fontSize: '12px', color: '#7a9aba' }}>Welcome, {user?.full_name || 'Employee'}</span>
          <button onClick={signOut} style={{ background: '#f0f6ff', border: '1px solid #c0d8f8', borderRadius: '8px', padding: '6px 14px', color: '#2B7FD4', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>Sign Out</button>
        </div>
      </div>

      <div className="layout-flex" style={{ display: 'flex', height: 'calc(100vh - 64px)' }}>
        {/* Sidebar */}
        <nav className="no-print" style={{ width: '220px', background: '#fff', borderRight: '1px solid #dce8f8', padding: '14px 0', flexShrink: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '1px', color: '#9ab8d8', padding: '8px 18px 4px', fontWeight: 600 }}>Portfolio</div>
          {[
            { id: 'overview', icon: 'ti-dashboard', label: 'Installation Overview' },
            { id: 'sites', icon: 'ti-map-pin', label: 'All Sites' },
            { id: 'performance', icon: 'ti-activity', label: 'Performance' },
            { id: 'siteperf', icon: 'ti-chart-line', label: 'Site Performance' },
            { id: 'report', icon: 'ti-file-analytics', label: 'Reports' },
            { id: 'upload', icon: 'ti-upload', label: 'Data Upload' },
          ].map(item => (
            <div key={item.id} className="nav-item" onClick={() => setActivePage(item.id)} style={{ display: 'flex', alignItems: 'center', gap: '9px', padding: '8px 18px', cursor: 'pointer', fontSize: '13px', color: activePage === item.id ? '#2B7FD4' : '#5a7aaa', borderLeft: `3px solid ${activePage === item.id ? '#2B7FD4' : 'transparent'}`, background: activePage === item.id ? '#f0f6ff' : 'transparent', fontWeight: activePage === item.id ? 600 : 400 }}>
              <i className={`ti ${item.icon}`} style={{ fontSize: '16px' }} />
              <span>{item.label}</span>
            </div>
          ))}
          <div style={{ marginTop: 'auto', padding: '14px 18px', borderTop: '1px solid #dce8f8', fontSize: '10px', color: '#9ab8d8', lineHeight: 1.6 }}>2026 Sosimple Energy<br />Cheap energy. Clean business.</div>
        </nav>

        <main className="main-area" style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>

          {/* ── OVERVIEW ── */}
          {activePage === 'overview' && (
            <div>
              <div style={{ background: 'linear-gradient(135deg,#2B7FD4,#1a5fa0)', borderRadius: '14px', padding: '20px 24px', marginBottom: '18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '14px' }}>
                <div>
                  <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#fff', marginBottom: '3px' }}>Portfolio Dashboard</h2>
                  <p style={{ fontSize: '12px', color: '#c0d8f8' }}>{sites.length} solar installations across South Africa &amp; beyond</p>
                </div>
                <div style={{ display: 'flex', gap: '18px', flexWrap: 'wrap' }}>
                  {[{ val: sites.length, label: 'Total Sites' }, { val: (totalCap/1000).toFixed(2), label: 'MWp Installed' }, { val: totalBessMwh, label: 'MWh BESS' }, { val: ppaCount, label: 'PPA Sites' }, { val: rtoCount, label: 'RTO Sites' }].map(s => (
                    <div key={s.label}>
                      <div style={{ fontSize: '22px', fontWeight: 700, color: '#F5D000' }}>{s.val}</div>
                      <div style={{ fontSize: '10px', color: '#c0d8f8' }}>{s.label}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ background: '#fff', border: '1px solid #dce8f8', borderRadius: '10px', padding: '14px 16px', marginBottom: '16px', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: '11px', fontWeight: 600, color: '#7a9aba', textTransform: 'uppercase', letterSpacing: '0.5px' }}><i className="ti ti-filter" style={{ marginRight: '4px' }} />Filter</span>
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
                  <button onClick={() => { setFilterInvestor(''); setFilterInstaller(''); setFilterOverviewContract('') }} style={{ ...selectStyle, background: '#fce8e8', border: '1px solid #f5b8b8', color: '#9a1a1a', cursor: 'pointer' }}>Clear ×</button>
                )}
                <span style={{ fontSize: '11px', color: '#9ab8d8', marginLeft: 'auto' }}>Showing {filteredOverview.length} of {sites.length} sites</span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: '10px', marginBottom: '18px' }}>
                {[
                  { label: 'Total Sites', val: filteredOverview.length, sub: `${filteredOverview.filter(s=>s.status==='active').length} active`, accent: '#F5D000' },
                  { label: 'Capacity (MWp)', val: (fCap/1000).toFixed(2), accent: '#2B7FD4' },
                  { label: 'BESS (MWh)', val: (fBess/1000000).toFixed(2), accent: '#7DC242' },
                  { label: 'PPA Sites', val: fPpa, accent: '#2B7FD4' },
                  { label: 'RTO Sites', val: fRto, accent: '#7DC242' },
                  { label: 'Inactive Sites', val: filteredOverview.filter(s=>s.status==='inactive').length, accent: '#ef4444' },
                ].map(k => (
                  <div key={k.label} style={{ background: '#fff', border: '1px solid #dce8f8', borderRadius: '10px', padding: '12px 14px', borderTop: `3px solid ${k.accent}` }}>
                    <div style={{ fontSize: '10px', color: '#7a9aba', marginBottom: '5px', fontWeight: 500 }}>{k.label}</div>
                    <div style={{ fontSize: '24px', fontWeight: 700, color: '#1a2a4a' }}>{k.val}</div>
                    {k.sub && <div style={{ fontSize: '10px', color: '#9ab8d8' }}>{k.sub}</div>}
                  </div>
                ))}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
                <div style={{ background: '#fff', border: '1px solid #dce8f8', borderRadius: '10px', padding: '16px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a2a4a', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '7px' }}><i className="ti ti-chart-donut" style={{ color: '#2B7FD4' }} />By business type</div>
                  <div style={{ position: 'relative', height: '190px' }}><canvas id="bizChart" /></div>
                </div>
                <div style={{ background: '#fff', border: '1px solid #dce8f8', borderRadius: '10px', padding: '16px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a2a4a', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '7px' }}><i className="ti ti-map" style={{ color: '#2B7FD4' }} />MWp by province — South Africa &amp; Zambia</div>
                  <div style={{ position: 'relative', height: '300px' }}><canvas id="provMwpChart" /></div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
                <div style={{ background: '#fff', border: '1px solid #dce8f8', borderRadius: '10px', padding: '16px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a2a4a', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '7px' }}><i className="ti ti-battery" style={{ color: '#7DC242' }} />MWh BESS by province</div>
                  <div style={{ position: 'relative', height: '190px' }}><canvas id="provBessChart" /></div>
                </div>
                <div style={{ background: '#fff', border: '1px solid #dce8f8', borderRadius: '10px', padding: '16px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a2a4a', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '7px' }}><i className="ti ti-file-invoice" style={{ color: '#F5D000' }} />Contract split</div>
                  <div style={{ position: 'relative', height: '190px' }}><canvas id="contractChart" /></div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div style={{ background: '#fff', border: '1px solid #dce8f8', borderRadius: '10px', padding: '16px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a2a4a', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '7px' }}><i className="ti ti-map-pin" style={{ color: '#2B7FD4' }} />Sites by province — South Africa &amp; Zambia</div>
                  <div style={{ position: 'relative', height: '300px' }}><canvas id="provSitesChart" /></div>
                </div>
                <div style={{ background: '#fff', border: '1px solid #dce8f8', borderRadius: '10px', padding: '16px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a2a4a', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '7px' }}><i className="ti ti-users" style={{ color: '#7DC242' }} />By investor</div>
                  <div style={{ position: 'relative', height: '300px' }}><canvas id="investorChart" /></div>
                </div>
              </div>
            </div>
          )}

          {/* ── ALL SITES ── */}
          {activePage === 'sites' && (
            <div>
              <div style={{ fontSize: '19px', fontWeight: 700, color: '#1a2a4a', marginBottom: '2px' }}>All Sites</div>
              <div style={{ fontSize: '12px', color: '#7a9aba', marginBottom: '18px' }}>Complete portfolio — {sites.length} solar installations</div>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
                <input type="text" placeholder="Search site name or location..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} style={{ padding: '6px 11px', border: '1px solid #c0d8f8', borderRadius: '8px', fontSize: '12px', color: '#1a2a4a', flex: 1, minWidth: '160px', outline: 'none' }} />
                <select value={filterType} onChange={e => setFilterType(e.target.value)} style={selectStyle}>
                  <option value="">All Types</option>
                  {['Retail','Manufacture','Residential','Commercial','Agricultural'].map(t => <option key={t}>{t}</option>)}
                </select>
                <select value={filterContract} onChange={e => setFilterContract(e.target.value)} style={selectStyle}>
                  <option value="">All Contracts</option>
                  <option>PPA</option><option>RTO</option>
                </select>
              </div>
              <div style={{ fontSize: '11px', color: '#7a9aba', marginBottom: '8px' }}>Showing {filteredSites.length} of {sites.length} sites</div>
              <div style={{ background: '#fff', border: '1px solid #dce8f8', borderRadius: '10px', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead><tr style={{ background: '#f8fbff' }}>
                    {['Site Name','Province','Capacity','BESS (kWh)','Type','Contract','Investor','Status'].map(h => (
                      <th key={h} style={{ textAlign: 'left', padding: '7px 9px', fontSize: '10px', color: '#9ab8d8', fontWeight: 600, borderBottom: '2px solid #dce8f8', textTransform: 'uppercase' }}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {filteredSites.map(site => (
                      <tr key={site.id} className="tbl-row" style={{ cursor: 'pointer' }} onClick={() => window.location.href = `/sites/${site.id}`}>
                        <td style={{ padding: '7px 9px', borderBottom: '1px solid #f0f6ff', fontWeight: 500, color: '#2B7FD4' }}>{site.name}</td>
                        <td style={{ padding: '7px 9px', borderBottom: '1px solid #f0f6ff' }}>{site.province || '—'}</td>
                        <td style={{ padding: '7px 9px', borderBottom: '1px solid #f0f6ff' }}>{site.capacity_kw} kWp</td>
                        <td style={{ padding: '7px 9px', borderBottom: '1px solid #f0f6ff' }}>{site.battery_size_wh > 0 ? (site.battery_size_wh/1000).toFixed(1) : '—'}</td>
                        <td style={{ padding: '7px 9px', borderBottom: '1px solid #f0f6ff' }}>{typeBadge(site.business_type)}</td>
                        <td style={{ padding: '7px 9px', borderBottom: '1px solid #f0f6ff' }}>{site.system_type || '--'}</td>
                        <td style={{ padding: '7px 9px', borderBottom: '1px solid #f0f6ff' }}>{site.investment_party || '--'}</td>
                        <td style={{ padding: '7px 9px', borderBottom: '1px solid #f0f6ff' }}>{statusBadge(site.status)}</td>
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
              <div style={{ fontSize: '19px', fontWeight: 700, color: '#1a2a4a', marginBottom: '2px' }}>Performance Overview</div>
              <div style={{ fontSize: '12px', color: '#7a9aba', marginBottom: '18px' }}>Monthly production data — measured vs expected across all sites</div>

              {/* Filters */}
              <div style={{ background: '#fff', border: '1px solid #dce8f8', borderRadius: '10px', padding: '14px 16px', marginBottom: '16px', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: '11px', fontWeight: 600, color: '#7a9aba', textTransform: 'uppercase', letterSpacing: '0.5px' }}><i className="ti ti-filter" style={{ marginRight: '4px' }} />Filter</span>
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
                  <button onClick={() => { setPfFilterInvestor(''); setPfFilterDate(''); setPfFilterBand('') }} style={{ ...selectStyle, background: '#fce8e8', border: '1px solid #f5b8b8', color: '#9a1a1a', cursor: 'pointer' }}>Clear ×</button>
                )}
                <span style={{ fontSize: '11px', color: '#9ab8d8', marginLeft: 'auto' }}>{filteredPerf.length} records</span>
              </div>

              {perfLoading ? (
                <div style={{ textAlign: 'center', padding: '40px', color: '#9ab8d8' }}>Loading performance data...</div>
              ) : (
                <>
                  {/* KPI Summary */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: '10px', marginBottom: '18px' }}>
                    {[
                      { label: 'Total Records', val: filteredPerf.length, accent: '#2B7FD4' },
                      { label: 'Expected', val: pfExp, accent: '#2B7FD4' },
                      { label: 'Moderate', val: pfMod, accent: '#F5D000' },
                      { label: 'Poor', val: pfPoor, accent: '#ef4444' },
                      { label: 'Avg Performance', val: `${pfAvgPerf}%`, accent: '#7DC242' },
                      { label: 'Total Measured', val: pfTotalMeasured > 0 ? `${(pfTotalMeasured/1000).toFixed(0)}k kWh` : '—', accent: '#7DC242' },
                    ].map(k => (
                      <div key={k.label} style={{ background: '#fff', border: '1px solid #dce8f8', borderRadius: '10px', padding: '12px 14px', borderTop: `3px solid ${k.accent}` }}>
                        <div style={{ fontSize: '10px', color: '#7a9aba', marginBottom: '5px', fontWeight: 500 }}>{k.label}</div>
                        <div style={{ fontSize: '22px', fontWeight: 700, color: '#1a2a4a' }}>{k.val}</div>
                      </div>
                    ))}
                  </div>

                  {/* Charts */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
                    <div style={{ background: '#fff', border: '1px solid #dce8f8', borderRadius: '10px', padding: '16px' }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a2a4a', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '7px' }}><i className="ti ti-chart-donut" style={{ color: '#2B7FD4' }} />PF Band breakdown</div>
                      <div style={{ position: 'relative', height: '200px' }}><canvas id="pfBandChart" /></div>
                    </div>
                    <div style={{ background: '#fff', border: '1px solid #dce8f8', borderRadius: '10px', padding: '16px' }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a2a4a', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '7px' }}><i className="ti ti-chart-bar" style={{ color: '#2B7FD4' }} />Measured vs Expected — top 10 sites</div>
                      <div style={{ position: 'relative', height: '200px' }}><canvas id="measVsExpChart" /></div>
                    </div>
                  </div>

                  {/* Performance Table */}
                  <div style={{ background: '#fff', border: '1px solid #dce8f8', borderRadius: '10px', overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                      <thead><tr style={{ background: '#f8fbff' }}>
                        {['Site Name','Investor','Date','Measured (kWh)','Expected (kWh)','Performance %','PF Band'].map(h => (
                          <th key={h} style={{ textAlign: 'left', padding: '7px 9px', fontSize: '10px', color: '#9ab8d8', fontWeight: 600, borderBottom: '2px solid #dce8f8', textTransform: 'uppercase' }}>{h}</th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {filteredPerf.length === 0 ? (
                          <tr><td colSpan={7} style={{ padding: '24px', textAlign: 'center', color: '#9ab8d8' }}>No records match the selected filters</td></tr>
                        ) : filteredPerf.map((p, i) => (
                          <tr key={p.id} className="tbl-row">
                            <td style={{ padding: '7px 9px', borderBottom: '1px solid #f0f6ff', fontWeight: 500, color: '#2B7FD4' }}>{p.site_name}</td>
                            <td style={{ padding: '7px 9px', borderBottom: '1px solid #f0f6ff' }}>{getInvestor(p) || '—'}</td>
                            <td style={{ padding: '7px 9px', borderBottom: '1px solid #f0f6ff' }}>{fmtDate(p.month, p.year)}</td>
                            <td style={{ padding: '7px 9px', borderBottom: '1px solid #f0f6ff', fontWeight: 600, color: '#1a2a4a' }}>{p.kwh_produced != null ? p.kwh_produced.toLocaleString() : '—'}</td>
                            <td style={{ padding: '7px 9px', borderBottom: '1px solid #f0f6ff' }}>{p.expected_kwh != null ? p.expected_kwh.toLocaleString() : '—'}</td>
                            <td style={{ padding: '7px 9px', borderBottom: '1px solid #f0f6ff', fontWeight: 600, color: p.performance_pct >= 90 ? '#3a7a00' : p.performance_pct >= 70 ? '#8a6a00' : '#9a1a1a' }}>
                              {p.performance_pct != null ? `${p.performance_pct.toFixed(1)}%` : '—'}
                            </td>
                            <td style={{ padding: '7px 9px', borderBottom: '1px solid #f0f6ff' }}>{pfBadge(p.pf_band)}</td>
                          </tr>
                        ))}
                      </tbody>
                      {filteredPerf.length > 0 && (
                        <tfoot>
                          <tr style={{ background: '#f8fbff', fontWeight: 700 }}>
                            <td colSpan={3} style={{ padding: '8px 9px', fontSize: '11px', color: '#1a2a4a' }}>Total / Average</td>
                            <td style={{ padding: '8px 9px', fontSize: '11px', color: '#2B7FD4' }}>{pfTotalMeasured.toLocaleString()} kWh</td>
                            <td style={{ padding: '8px 9px', fontSize: '11px', color: '#7a9aba' }}>{pfTotalExpected.toLocaleString()} kWh</td>
                            <td style={{ padding: '8px 9px', fontSize: '11px', color: '#2B7FD4' }}>{pfAvgPerf}%</td>
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

            return (
              <div>
                <div style={{ fontSize: '19px', fontWeight: 700, color: '#1a2a4a', marginBottom: '2px' }}>Site Performance</div>
                <div style={{ fontSize: '12px', color: '#7a9aba', marginBottom: '18px' }}>Per-site production analysis — expected vs measured and year-on-year comparison</div>

                {perfLoading ? (
                  <div style={{ textAlign: 'center', padding: '40px', color: '#9ab8d8' }}>Loading performance data...</div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: '250px 1fr', gap: '14px', alignItems: 'start' }}>

                    {/* Left: site selector */}
                    <div style={{ background: '#fff', border: '1px solid #dce8f8', borderRadius: '10px', padding: '14px' }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: '#2B7FD4', marginBottom: '10px' }}>Site Name</div>
                      <input type="text" placeholder="Search sites..." value={spSearch} onChange={e => setSpSearch(e.target.value)} style={{ width: '100%', padding: '6px 10px', border: '1px solid #c0d8f8', borderRadius: '8px', fontSize: '12px', outline: 'none', marginBottom: '10px' }} />
                      <div style={{ maxHeight: '500px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {spSiteNames.filter(n => n.toLowerCase().includes(spSearch.toLowerCase())).map(n => (
                          <div key={n} onClick={() => { setSpSite(n); setSpYear(''); setSpYearA(''); setSpYearB(''); setSpCommentDate('') }} style={{ padding: '8px 10px', border: '1px solid #c0d8f8', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', background: spSite === n ? '#1a2a4a' : '#fff', color: spSite === n ? '#fff' : '#1a2a4a', fontWeight: spSite === n ? 600 : 400, textAlign: 'center' }}>
                            {n}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Right: charts */}
                    <div>
                      {!spSite ? (
                        <div style={{ background: '#fff', border: '1px solid #dce8f8', borderRadius: '10px', padding: '60px', textAlign: 'center', color: '#9ab8d8' }}>
                          <i className="ti ti-chart-line" style={{ fontSize: '40px', display: 'block', marginBottom: '12px' }} />
                          Select a site from the list to view its performance
                        </div>
                      ) : (
                        <>
                          {/* Chart 1: Expected vs Measured */}
                          <div style={{ background: '#fff', border: '1px solid #dce8f8', borderRadius: '10px', padding: '16px', marginBottom: '14px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
                              <div style={{ fontSize: '14px', fontWeight: 600, color: '#2B7FD4' }}>
                                <i className="ti ti-chart-bar" style={{ marginRight: '6px' }} />Expected vs Measured — {spSite}
                              </div>
                              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <span style={{ fontSize: '11px', color: '#7a9aba', fontWeight: 600 }}>Year</span>
                                <select style={selectStyle} value={spYear || yrSel || ''} onChange={e => setSpYear(e.target.value)}>
                                  {spYears.map(y => <option key={y} value={y}>{y}</option>)}
                                </select>
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: '14px', marginBottom: '12px', flexWrap: 'wrap' }}>
                              <div style={{ background: '#f8fbff', borderRadius: '8px', padding: '8px 14px' }}>
                                <div style={{ fontSize: '10px', color: '#7a9aba' }}>Total Measured</div>
                                <div style={{ fontSize: '18px', fontWeight: 700, color: '#1a2a4a' }}>{spTotMeas.toLocaleString()} kWh</div>
                              </div>
                              <div style={{ background: '#f8fbff', borderRadius: '8px', padding: '8px 14px' }}>
                                <div style={{ fontSize: '10px', color: '#7a9aba' }}>Total Expected</div>
                                <div style={{ fontSize: '18px', fontWeight: 700, color: '#1a2a4a' }}>{spTotExp.toLocaleString()} kWh</div>
                              </div>
                              <div style={{ background: spDelta >= 0 ? '#edfae0' : '#fce8e8', borderRadius: '8px', padding: '8px 14px' }}>
                                <div style={{ fontSize: '10px', color: '#7a9aba' }}>Δ vs Expected</div>
                                <div style={{ fontSize: '18px', fontWeight: 700, color: spDelta >= 0 ? '#3a7a00' : '#9a1a1a' }}>
                                  {spDelta != null ? `${spDelta > 0 ? '+' : ''}${spDelta}%` : '—'}
                                </div>
                              </div>
                            </div>
                            <div style={{ position: 'relative', height: '260px' }}><canvas id="spExpMeasChart" /></div>
                          </div>

                          {/* Chart 2: Year to Year */}
                          <div style={{ background: '#fff', border: '1px solid #dce8f8', borderRadius: '10px', padding: '16px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
                              <div style={{ fontSize: '14px', fontWeight: 600, color: '#2B7FD4' }}>
                                <i className="ti ti-arrows-diff" style={{ marginRight: '6px' }} />Year to Year Comparison
                              </div>
                              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <span style={{ fontSize: '11px', color: '#7a9aba', fontWeight: 600 }}>Compare</span>
                                <select style={selectStyle} value={spYearA || yrA || ''} onChange={e => setSpYearA(e.target.value)}>
                                  {spYears.map(y => <option key={y} value={y}>{y}</option>)}
                                </select>
                                <span style={{ fontSize: '11px', color: '#7a9aba' }}>vs</span>
                                <select style={selectStyle} value={spYearB || yrB || ''} onChange={e => setSpYearB(e.target.value)}>
                                  {spYears.map(y => <option key={y} value={y}>{y}</option>)}
                                </select>
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: '14px', marginBottom: '12px', flexWrap: 'wrap' }}>
                              <div style={{ background: '#f8fbff', borderRadius: '8px', padding: '8px 14px' }}>
                                <div style={{ fontSize: '10px', color: '#7a9aba' }}>{yrA} Total (common months)</div>
                                <div style={{ fontSize: '18px', fontWeight: 700, color: '#1a2a4a' }}>{totA.toLocaleString()} kWh</div>
                              </div>
                              <div style={{ background: '#f8fbff', borderRadius: '8px', padding: '8px 14px' }}>
                                <div style={{ fontSize: '10px', color: '#7a9aba' }}>{yrB} Total (common months)</div>
                                <div style={{ fontSize: '18px', fontWeight: 700, color: '#1a2a4a' }}>{totB.toLocaleString()} kWh</div>
                              </div>
                              <div style={{ background: yoyDelta >= 0 ? '#edfae0' : '#fce8e8', borderRadius: '8px', padding: '8px 14px' }}>
                                <div style={{ fontSize: '10px', color: '#7a9aba' }}>Δ {yrA} vs {yrB}</div>
                                <div style={{ fontSize: '18px', fontWeight: 700, color: yoyDelta >= 0 ? '#3a7a00' : '#9a1a1a' }}>
                                  {yoyDelta != null ? `${yoyDelta > 0 ? '+' : ''}${yoyDelta}%` : '—'}
                                </div>
                              </div>
                            </div>
                            <div style={{ position: 'relative', height: '260px' }}><canvas id="spYoYChart" /></div>
                          </div>

                          {/* Technical Comments */}
                          {(() => {
                            const commentRecs = spRecs
                              .filter(p => p.comment)
                              .sort((a, b) => (b.year - a.year) || (b.month - a.month))
                            const cDates = commentRecs.map(p => `${p.year}-${String(p.month).padStart(2, '0')}`)
                            const selDate = spCommentDate || cDates[0] || ''
                            const selRec = commentRecs.find(p => `${p.year}-${String(p.month).padStart(2, '0')}` === selDate)
                            const monthNamesC = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
                            return (
                              <div style={{ background: '#fff', border: '1px solid #dce8f8', borderRadius: '10px', padding: '16px', marginTop: '14px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
                                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#2B7FD4' }}>
                                    <i className="ti ti-message-2" style={{ marginRight: '6px' }} />Technical Comments
                                  </div>
                                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                    <span style={{ fontSize: '11px', color: '#7a9aba', fontWeight: 600 }}>Date</span>
                                    <select style={selectStyle} value={selDate} onChange={e => setSpCommentDate(e.target.value)}>
                                      {cDates.length === 0 && <option value="">No comments</option>}
                                      {cDates.map(d => {
                                        const [y, m] = d.split('-')
                                        return <option key={d} value={d}>{monthNamesC[parseInt(m) - 1]}-{y.slice(2)}</option>
                                      })}
                                    </select>
                                  </div>
                                </div>
                                {selRec ? (
                                  <div style={{ background: '#f8fbff', border: '1px solid #dce8f8', borderRadius: '8px', padding: '14px 16px', fontSize: '13px', color: '#2a3a5a', lineHeight: 1.7, whiteSpace: 'pre-line' }}>
                                    {selRec.comment}
                                  </div>
                                ) : (
                                  <div style={{ padding: '20px', textAlign: 'center', color: '#9ab8d8', fontSize: '12px' }}>
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
          {activePage === 'upload' && (
            <div>
              <div style={{ fontSize: '19px', fontWeight: 700, color: '#1a2a4a', marginBottom: '2px' }}>Data Upload</div>
              <div style={{ fontSize: '12px', color: '#7a9aba', marginBottom: '18px' }}>Upload monthly performance data and site information — existing records are updated, new ones are added</div>

              {upMsg && (
                <div style={{ background: upMsg.startsWith('✅') ? '#edfae0' : upMsg.startsWith('❌') || upMsg.startsWith('⚠️') ? '#fce8e8' : '#f0f6ff', border: '1px solid #c0d8f8', borderRadius: '8px', padding: '12px 16px', fontSize: '13px', color: '#1a2a4a', marginBottom: '16px' }}>
                  {upMsg}
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '14px' }}>

                {/* Performance upload card */}
                <div style={{ background: '#fff', border: '1px solid #dce8f8', borderRadius: '10px', padding: '20px' }}>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#2B7FD4', marginBottom: '6px' }}>
                    <i className="ti ti-activity" style={{ marginRight: '6px' }} />Performance Data
                  </div>
                  <div style={{ fontSize: '11px', color: '#7a9aba', marginBottom: '14px', lineHeight: 1.6 }}>
                    CSV with columns: <b>Site Name; Date; Measured (kWh); Expected (kWh); Performance; PF Band</b><br />
                    Date format: Jan-25, Feb-25... Semicolon separated.
                  </div>

                  <label style={{ display: 'block', border: '2px dashed #c0d8f8', borderRadius: '10px', padding: '24px', textAlign: 'center', cursor: 'pointer', background: '#f8fbff' }}>
                    <i className="ti ti-file-upload" style={{ fontSize: '28px', color: '#2B7FD4', display: 'block', marginBottom: '8px' }} />
                    <span style={{ fontSize: '12px', color: '#5a7aaa' }}>Click to select performance CSV</span>
                    <input type="file" accept=".csv" onChange={handlePerfFile} style={{ display: 'none' }} disabled={upBusy} />
                  </label>

                  {upPerf && (
                    <div style={{ marginTop: '14px' }}>
                      <div style={{ fontSize: '12px', color: '#1a2a4a', marginBottom: '8px' }}>
                        📄 <b>{upPerf.fileName}</b> — {upPerf.rows.length} valid records
                        {upPerf.errors.length > 0 && <span style={{ color: '#9a1a1a' }}> · {upPerf.errors.length} rows skipped</span>}
                      </div>
                      <div style={{ maxHeight: '160px', overflowY: 'auto', border: '1px solid #dce8f8', borderRadius: '8px', marginBottom: '10px' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                          <thead><tr style={{ background: '#f8fbff' }}>
                            {['Site', 'Month', 'Year', 'Measured', 'Expected', 'Band'].map(h => <th key={h} style={{ padding: '5px 8px', textAlign: 'left', color: '#9ab8d8', fontSize: '9px', textTransform: 'uppercase' }}>{h}</th>)}
                          </tr></thead>
                          <tbody>
                            {upPerf.rows.slice(0, 8).map((r, i) => (
                              <tr key={i}>
                                <td style={{ padding: '4px 8px', borderTop: '1px solid #f0f6ff' }}>{r.site_name}</td>
                                <td style={{ padding: '4px 8px', borderTop: '1px solid #f0f6ff' }}>{r.month}</td>
                                <td style={{ padding: '4px 8px', borderTop: '1px solid #f0f6ff' }}>{r.year}</td>
                                <td style={{ padding: '4px 8px', borderTop: '1px solid #f0f6ff' }}>{r.kwh_produced ?? '—'}</td>
                                <td style={{ padding: '4px 8px', borderTop: '1px solid #f0f6ff' }}>{r.expected_kwh ?? '—'}</td>
                                <td style={{ padding: '4px 8px', borderTop: '1px solid #f0f6ff' }}>{r.pf_band ?? '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={uploadPerf} disabled={upBusy} style={{ flex: 1, padding: '10px', background: '#2B7FD4', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: upBusy ? 'not-allowed' : 'pointer', opacity: upBusy ? 0.6 : 1 }}>
                          {upBusy ? 'Uploading...' : `Upload ${upPerf.rows.length} records`}
                        </button>
                        <button onClick={() => setUpPerf(null)} disabled={upBusy} style={{ padding: '10px 16px', background: '#fff', color: '#9a1a1a', border: '1px solid #f5b8b8', borderRadius: '8px', fontSize: '13px', cursor: 'pointer' }}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Sites upload card */}
                <div style={{ background: '#fff', border: '1px solid #dce8f8', borderRadius: '10px', padding: '20px' }}>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#7DC242', marginBottom: '6px' }}>
                    <i className="ti ti-map-pin" style={{ marginRight: '6px' }} />Site / Installation Info
                  </div>
                  <div style={{ fontSize: '11px', color: '#7a9aba', marginBottom: '14px', lineHeight: 1.6 }}>
                    CSV with columns: <b>Site Name; Location; Province; Country; PV Capacity (W); Commisioned Date; Operational Satus; Contract Type; Business Type; Investment Party; Battery Size (Wh); Installer Name...</b><br />
                    Same format as your site_tech_info file. Matched by Site Name.
                  </div>

                  <label style={{ display: 'block', border: '2px dashed #b8e890', borderRadius: '10px', padding: '24px', textAlign: 'center', cursor: 'pointer', background: '#f8fdf4' }}>
                    <i className="ti ti-file-upload" style={{ fontSize: '28px', color: '#7DC242', display: 'block', marginBottom: '8px' }} />
                    <span style={{ fontSize: '12px', color: '#5a7aaa' }}>Click to select sites CSV</span>
                    <input type="file" accept=".csv" onChange={handleSitesFile} style={{ display: 'none' }} disabled={upBusy} />
                  </label>

                  {upSites && (
                    <div style={{ marginTop: '14px' }}>
                      <div style={{ fontSize: '12px', color: '#1a2a4a', marginBottom: '8px' }}>
                        📄 <b>{upSites.fileName}</b> — {upSites.rows.length} valid sites
                        {upSites.errors.length > 0 && <span style={{ color: '#9a1a1a' }}> · {upSites.errors.length} rows skipped</span>}
                      </div>
                      <div style={{ maxHeight: '160px', overflowY: 'auto', border: '1px solid #dce8f8', borderRadius: '8px', marginBottom: '10px' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                          <thead><tr style={{ background: '#f8fbff' }}>
                            {['Site', 'Province', 'kWp', 'Contract', 'Investor', 'Status'].map(h => <th key={h} style={{ padding: '5px 8px', textAlign: 'left', color: '#9ab8d8', fontSize: '9px', textTransform: 'uppercase' }}>{h}</th>)}
                          </tr></thead>
                          <tbody>
                            {upSites.rows.slice(0, 8).map((r, i) => (
                              <tr key={i}>
                                <td style={{ padding: '4px 8px', borderTop: '1px solid #f0f6ff' }}>{r.name}</td>
                                <td style={{ padding: '4px 8px', borderTop: '1px solid #f0f6ff' }}>{r.province ?? '—'}</td>
                                <td style={{ padding: '4px 8px', borderTop: '1px solid #f0f6ff' }}>{r.capacity_kw ?? '—'}</td>
                                <td style={{ padding: '4px 8px', borderTop: '1px solid #f0f6ff' }}>{r.system_type ?? '—'}</td>
                                <td style={{ padding: '4px 8px', borderTop: '1px solid #f0f6ff' }}>{r.investment_party ?? '—'}</td>
                                <td style={{ padding: '4px 8px', borderTop: '1px solid #f0f6ff' }}>{r.status ?? '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={uploadSites} disabled={upBusy} style={{ flex: 1, padding: '10px', background: '#7DC242', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: upBusy ? 'not-allowed' : 'pointer', opacity: upBusy ? 0.6 : 1 }}>
                          {upBusy ? 'Uploading...' : `Upload ${upSites.rows.length} sites`}
                        </button>
                        <button onClick={() => setUpSites(null)} disabled={upBusy} style={{ padding: '10px 16px', background: '#fff', color: '#9a1a1a', border: '1px solid #f5b8b8', borderRadius: '8px', fontSize: '13px', cursor: 'pointer' }}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
                {/* Comments upload card */}
                <div style={{ background: '#fff', border: '1px solid #dce8f8', borderRadius: '10px', padding: '20px' }}>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#f0a500', marginBottom: '6px' }}>
                    <i className="ti ti-message-2" style={{ marginRight: '6px' }} />Technical Comments
                  </div>
                  <div style={{ fontSize: '11px', color: '#7a9aba', marginBottom: '14px', lineHeight: 1.6 }}>
                    CSV with columns: <b>Site Name; Date; Comment</b><br />
                    Date format: Jan-25, Feb-25... Semicolon separated. Rows with empty comments are skipped.
                  </div>

                  <label style={{ display: 'block', border: '2px dashed #f0d840', borderRadius: '10px', padding: '24px', textAlign: 'center', cursor: 'pointer', background: '#fffdf4' }}>
                    <i className="ti ti-file-upload" style={{ fontSize: '28px', color: '#f0a500', display: 'block', marginBottom: '8px' }} />
                    <span style={{ fontSize: '12px', color: '#5a7aaa' }}>Click to select comments CSV</span>
                    <input type="file" accept=".csv" onChange={handleCommentsFile} style={{ display: 'none' }} disabled={upBusy} />
                  </label>

                  {upComments && (
                    <div style={{ marginTop: '14px' }}>
                      <div style={{ fontSize: '12px', color: '#1a2a4a', marginBottom: '8px' }}>
                        📄 <b>{upComments.fileName}</b> — {upComments.rows.length} comments
                        {upComments.emptySkipped > 0 && <span style={{ color: '#9ab8d8' }}> · {upComments.emptySkipped} empty skipped</span>}
                        {upComments.errors.length > 0 && <span style={{ color: '#9a1a1a' }}> · {upComments.errors.length} invalid rows</span>}
                      </div>
                      <div style={{ maxHeight: '160px', overflowY: 'auto', border: '1px solid #dce8f8', borderRadius: '8px', marginBottom: '10px' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                          <thead><tr style={{ background: '#f8fbff' }}>
                            {['Site', 'Month', 'Year', 'Comment'].map(h => <th key={h} style={{ padding: '5px 8px', textAlign: 'left', color: '#9ab8d8', fontSize: '9px', textTransform: 'uppercase' }}>{h}</th>)}
                          </tr></thead>
                          <tbody>
                            {upComments.rows.slice(0, 8).map((r, i) => (
                              <tr key={i}>
                                <td style={{ padding: '4px 8px', borderTop: '1px solid #f0f6ff', whiteSpace: 'nowrap' }}>{r.site_name}</td>
                                <td style={{ padding: '4px 8px', borderTop: '1px solid #f0f6ff' }}>{r.month}</td>
                                <td style={{ padding: '4px 8px', borderTop: '1px solid #f0f6ff' }}>{r.year}</td>
                                <td style={{ padding: '4px 8px', borderTop: '1px solid #f0f6ff', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.comment}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={uploadComments} disabled={upBusy} style={{ flex: 1, padding: '10px', background: '#f0a500', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: upBusy ? 'not-allowed' : 'pointer', opacity: upBusy ? 0.6 : 1 }}>
                          {upBusy ? 'Uploading...' : `Upload ${upComments.rows.length} comments`}
                        </button>
                        <button onClick={() => setUpComments(null)} disabled={upBusy} style={{ padding: '10px 16px', background: '#fff', color: '#9a1a1a', border: '1px solid #f5b8b8', borderRadius: '8px', fontSize: '13px', cursor: 'pointer' }}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div style={{ background: '#fffbe0', border: '1px solid #f0d840', borderRadius: '10px', padding: '14px 18px', marginTop: '16px', fontSize: '12px', color: '#8a6a00', lineHeight: 1.7 }}>
                <b>💡 How it works:</b> Records are matched by Site Name + Month + Year (performance &amp; comments) or Site Name (sites).
                If a match exists it gets <b>updated</b>, otherwise a <b>new record is added</b>. You can safely re-upload the same file —
                no duplicates will be created. Export your Excel sheet as CSV (semicolon separated) before uploading.
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
                  <div style={{ fontSize: '19px', fontWeight: 700, color: '#1a2a4a', marginBottom: '2px' }}>Reports</div>
                  <div style={{ fontSize: '12px', color: '#7a9aba', marginBottom: '18px' }}>Generate filtered reports — use Print / Save as PDF to export</div>

                  <div style={{ background: '#fff', border: '1px solid #dce8f8', borderRadius: '10px', padding: '14px 16px', marginBottom: '16px', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                    <div style={{ display: 'flex', gap: '5px' }}>
                      {[{ id: 'install', label: 'Installation Overview' }, { id: 'perf', label: 'Site Performance' }].map(t => (
                        <div key={t.id} className="tab" onClick={() => setRepType(t.id)} style={{ padding: '6px 14px', borderRadius: '20px', fontSize: '12px', border: '1px solid #c0d8f8', cursor: 'pointer', background: repType === t.id ? '#2B7FD4' : '#fff', color: repType === t.id ? '#fff' : '#5a7aaa', fontWeight: repType === t.id ? 600 : 400 }}>
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
                          return <option key={d} value={d}>{monthNamesR[parseInt(m) - 1]}-{y.slice(2)}</option>
                        })}
                      </select>
                    )}
                    <button onClick={() => window.print()} style={{ marginLeft: 'auto', padding: '8px 18px', background: '#2B7FD4', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
                      <i className="ti ti-printer" style={{ marginRight: '6px' }} />Print / Save PDF
                    </button>
                  </div>
                </div>

                {/* Report document */}
                <div className="print-area" style={{ background: '#fff', border: '1px solid #dce8f8', borderRadius: '10px', padding: '32px', maxWidth: '900px' }}>

                  {/* Report header */}
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
                      {/* KPI summary */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px', marginBottom: '24px' }}>
                        {[
                          { label: 'Total Sites', val: repSites.length },
                          { label: 'Capacity (MWp)', val: (rCap / 1000).toFixed(2) },
                          { label: 'BESS (MWh)', val: (rBess / 1000000).toFixed(2) },
                          { label: 'PPA Sites', val: repSites.filter(s => s.system_type === 'PPA').length },
                          { label: 'RTO Sites', val: repSites.filter(s => s.system_type === 'RTO').length },
                        ].map(k => (
                          <div key={k.label} style={{ background: '#f8fbff', border: '1px solid #dce8f8', borderRadius: '8px', padding: '12px', textAlign: 'center' }}>
                            <div style={{ fontSize: '22px', fontWeight: 700, color: '#2B7FD4' }}>{k.val}</div>
                            <div style={{ fontSize: '10px', color: '#7a9aba', marginTop: '2px' }}>{k.label}</div>
                          </div>
                        ))}
                      </div>

                      {/* Sites table */}
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                        <thead><tr style={{ background: '#2B7FD4' }}>
                          {['Site Name', 'Province', 'Capacity (kWp)', 'BESS (kWh)', 'Contract', 'Type', 'Investor', 'Status'].map(h => (
                            <th key={h} style={{ padding: '8px 9px', textAlign: 'left', color: '#fff', fontSize: '10px', fontWeight: 600 }}>{h}</th>
                          ))}
                        </tr></thead>
                        <tbody>
                          {repSites.map((s, i) => (
                            <tr key={s.id} style={{ background: i % 2 === 0 ? '#fff' : '#f8fbff' }}>
                              <td style={{ padding: '6px 9px', borderBottom: '1px solid #f0f6ff', fontWeight: 500 }}>{s.name}</td>
                              <td style={{ padding: '6px 9px', borderBottom: '1px solid #f0f6ff' }}>{s.province || '—'}</td>
                              <td style={{ padding: '6px 9px', borderBottom: '1px solid #f0f6ff' }}>{s.capacity_kw ?? '—'}</td>
                              <td style={{ padding: '6px 9px', borderBottom: '1px solid #f0f6ff' }}>{s.battery_size_wh > 0 ? (s.battery_size_wh / 1000).toFixed(1) : '—'}</td>
                              <td style={{ padding: '6px 9px', borderBottom: '1px solid #f0f6ff' }}>{s.system_type || '—'}</td>
                              <td style={{ padding: '6px 9px', borderBottom: '1px solid #f0f6ff' }}>{s.business_type || '—'}</td>
                              <td style={{ padding: '6px 9px', borderBottom: '1px solid #f0f6ff' }}>{s.investment_party || '—'}</td>
                              <td style={{ padding: '6px 9px', borderBottom: '1px solid #f0f6ff' }}>{s.status || 'active'}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr style={{ background: '#f0f6ff', fontWeight: 700 }}>
                            <td colSpan={2} style={{ padding: '8px 9px', fontSize: '10px' }}>TOTAL — {repSites.length} sites</td>
                            <td style={{ padding: '8px 9px', fontSize: '10px' }}>{rCap.toFixed(1)} kWp</td>
                            <td style={{ padding: '8px 9px', fontSize: '10px' }}>{(rBess / 1000).toFixed(1)} kWh</td>
                            <td colSpan={4}></td>
                          </tr>
                        </tfoot>
                      </table>
                    </>
                  ) : (
                    <>
                      {/* Performance KPIs */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '10px', marginBottom: '24px' }}>
                        {[
                          { label: 'Records', val: repPerf.length },
                          { label: 'Measured (kWh)', val: rMeas.toLocaleString() },
                          { label: 'Expected (kWh)', val: rExp.toLocaleString() },
                          { label: 'Δ vs Expected', val: rDelta != null ? `${rDelta > 0 ? '+' : ''}${rDelta}%` : '—', color: rDelta >= 0 ? '#3a7a00' : '#9a1a1a' },
                          { label: 'Expected Band', val: rExpC },
                          { label: 'Moderate / Poor', val: `${rModC} / ${rPoorC}` },
                        ].map(k => (
                          <div key={k.label} style={{ background: '#f8fbff', border: '1px solid #dce8f8', borderRadius: '8px', padding: '12px', textAlign: 'center' }}>
                            <div style={{ fontSize: '16px', fontWeight: 700, color: k.color || '#2B7FD4' }}>{k.val}</div>
                            <div style={{ fontSize: '9px', color: '#7a9aba', marginTop: '2px' }}>{k.label}</div>
                          </div>
                        ))}
                      </div>

                      {/* Performance table */}
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                        <thead><tr style={{ background: '#2B7FD4' }}>
                          {['Site Name', 'Period', 'Measured (kWh)', 'Expected (kWh)', 'Δ %', 'PF Band', 'Comment'].map(h => (
                            <th key={h} style={{ padding: '8px 9px', textAlign: 'left', color: '#fff', fontSize: '10px', fontWeight: 600 }}>{h}</th>
                          ))}
                        </tr></thead>
                        <tbody>
                          {repPerf.length === 0 ? (
                            <tr><td colSpan={7} style={{ padding: '20px', textAlign: 'center', color: '#9ab8d8' }}>No performance records for the selected filters</td></tr>
                          ) : repPerf.map((p, i) => {
                            const d = p.kwh_produced != null && p.expected_kwh > 0 ? (((p.kwh_produced - p.expected_kwh) / p.expected_kwh) * 100).toFixed(1) : null
                            return (
                              <tr key={p.id} style={{ background: i % 2 === 0 ? '#fff' : '#f8fbff' }}>
                                <td style={{ padding: '6px 9px', borderBottom: '1px solid #f0f6ff', fontWeight: 500 }}>{p.site_name}</td>
                                <td style={{ padding: '6px 9px', borderBottom: '1px solid #f0f6ff', whiteSpace: 'nowrap' }}>{monthNamesR[p.month - 1]}-{String(p.year).slice(2)}</td>
                                <td style={{ padding: '6px 9px', borderBottom: '1px solid #f0f6ff' }}>{p.kwh_produced != null ? p.kwh_produced.toLocaleString() : '—'}</td>
                                <td style={{ padding: '6px 9px', borderBottom: '1px solid #f0f6ff' }}>{p.expected_kwh != null ? p.expected_kwh.toLocaleString() : '—'}</td>
                                <td style={{ padding: '6px 9px', borderBottom: '1px solid #f0f6ff', fontWeight: 600, color: d == null ? '#9ab8d8' : d >= 0 ? '#3a7a00' : '#9a1a1a' }}>{d != null ? `${d > 0 ? '+' : ''}${d}%` : '—'}</td>
                                <td style={{ padding: '6px 9px', borderBottom: '1px solid #f0f6ff' }}>{p.pf_band || '—'}</td>
                                <td style={{ padding: '6px 9px', borderBottom: '1px solid #f0f6ff', fontSize: '10px', color: '#5a7aaa', whiteSpace: 'pre-line', maxWidth: '220px' }}>{p.comment || '—'}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                        {repPerf.length > 0 && (
                          <tfoot>
                            <tr style={{ background: '#f0f6ff', fontWeight: 700 }}>
                              <td colSpan={2} style={{ padding: '8px 9px', fontSize: '10px' }}>TOTAL — {repPerf.length} records</td>
                              <td style={{ padding: '8px 9px', fontSize: '10px' }}>{rMeas.toLocaleString()}</td>
                              <td style={{ padding: '8px 9px', fontSize: '10px' }}>{rExp.toLocaleString()}</td>
                              <td style={{ padding: '8px 9px', fontSize: '10px', color: rDelta >= 0 ? '#3a7a00' : '#9a1a1a' }}>{rDelta != null ? `${rDelta > 0 ? '+' : ''}${rDelta}%` : '—'}</td>
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