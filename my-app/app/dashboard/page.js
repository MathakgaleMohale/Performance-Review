'use client'

import { useEffect, useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'

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
  const chartsRef = useRef({})

  useEffect(() => {
    if (window.Chart) { setChartReady(true); return }
    const script = document.createElement('script')
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js'
    script.onload = () => setChartReady(true)
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
    if ((activePage === 'performance' || activePage === 'siteperf') && perfData.length === 0) {
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
  }, [loading, sites, activePage, chartReady, filterInvestor, filterInstaller, filterOverviewContract])

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

    const provCapMap = {}
    sitesData.forEach(s => { const p = s.province || 'Unknown'; provCapMap[p] = (provCapMap[p] || 0) + (s.capacity_kw || 0) })
    const provKeys = Object.keys(provCapMap).sort((a, b) => provCapMap[b] - provCapMap[a]).slice(0, 9)
    destroy('provMwpChart')
    const provMwpEl = document.getElementById('provMwpChart')
    if (provMwpEl) chartsRef.current['provMwpChart'] = new Chart(provMwpEl, { type: 'bar', data: { labels: provKeys, datasets: [{ data: provKeys.map(p => (provCapMap[p]/1000).toFixed(2)), backgroundColor: C.blue, borderRadius: 4 }] }, options: { ...commonOpts, plugins: { legend: { display: false } }, scales: { x: { ticks: { maxRotation: 40, font: { size: 9 } } }, y: { grid: { color: '#dce8f8' }, ticks: { callback: v => v+' MWp' } } } } })

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
        .tbl-row:hover td { background: #f8fbff; }
        .tab:hover { background: #f0f6ff; }
      `}</style>

      {/* Topbar */}
      <div style={{ background: '#fff', borderBottom: '3px solid #2B7FD4', padding: '0 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '64px', position: 'sticky', top: 0, zIndex: 100, boxShadow: '0 2px 12px rgba(43,127,212,0.1)' }}>
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

      <div style={{ display: 'flex', height: 'calc(100vh - 64px)' }}>
        {/* Sidebar */}
        <nav style={{ width: '220px', background: '#fff', borderRight: '1px solid #dce8f8', padding: '14px 0', flexShrink: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '1px', color: '#9ab8d8', padding: '8px 18px 4px', fontWeight: 600 }}>Portfolio</div>
          {[
            { id: 'overview', icon: 'ti-dashboard', label: 'Installation Overview' },
            { id: 'sites', icon: 'ti-map-pin', label: 'All Sites' },
            { id: 'performance', icon: 'ti-activity', label: 'Performance' },
            { id: 'siteperf', icon: 'ti-chart-line', label: 'Site Performance' },
            { id: 'investor', icon: 'ti-chart-bar', label: 'Investor View' },
          ].map(item => (
            <div key={item.id} className="nav-item" onClick={() => setActivePage(item.id)} style={{ display: 'flex', alignItems: 'center', gap: '9px', padding: '8px 18px', cursor: 'pointer', fontSize: '13px', color: activePage === item.id ? '#2B7FD4' : '#5a7aaa', borderLeft: `3px solid ${activePage === item.id ? '#2B7FD4' : 'transparent'}`, background: activePage === item.id ? '#f0f6ff' : 'transparent', fontWeight: activePage === item.id ? 600 : 400 }}>
              <i className={`ti ${item.icon}`} style={{ fontSize: '16px' }} />
              <span>{item.label}</span>
            </div>
          ))}
          <div style={{ marginTop: 'auto', padding: '14px 18px', borderTop: '1px solid #dce8f8', fontSize: '10px', color: '#9ab8d8', lineHeight: 1.6 }}>2026 Sosimple Energy<br />Cheap energy. Clean business.</div>
        </nav>

        <main style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>

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
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a2a4a', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '7px' }}><i className="ti ti-map" style={{ color: '#2B7FD4' }} />MWp by province</div>
                  <div style={{ position: 'relative', height: '190px' }}><canvas id="provMwpChart" /></div>
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

              <div style={{ background: '#fff', border: '1px solid #dce8f8', borderRadius: '10px', padding: '16px' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a2a4a', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '7px' }}><i className="ti ti-users" style={{ color: '#7DC242' }} />By investor</div>
                <div style={{ position: 'relative', height: '170px' }}><canvas id="investorChart" /></div>
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
                          <div key={n} onClick={() => { setSpSite(n); setSpYear(''); setSpYearA(''); setSpYearB('') }} style={{ padding: '8px 10px', border: '1px solid #c0d8f8', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', background: spSite === n ? '#1a2a4a' : '#fff', color: spSite === n ? '#fff' : '#1a2a4a', fontWeight: spSite === n ? 600 : 400, textAlign: 'center' }}>
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
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })()}

          {/* ── INVESTOR VIEW ── */}
          {activePage === 'investor' && (
            <div>
              <div style={{ fontSize: '19px', fontWeight: 700, color: '#1a2a4a', marginBottom: '2px' }}>Investor View</div>
              <div style={{ fontSize: '12px', color: '#7a9aba', marginBottom: '18px' }}>Portfolio by investment party</div>
              <div style={{ display: 'flex', gap: '5px', marginBottom: '14px', flexWrap: 'wrap' }}>
                {['all','SSI','Anuva','12B Fund'].map(inv => (
                  <div key={inv} className="tab" onClick={() => setActiveInvTab(inv)} style={{ padding: '5px 13px', borderRadius: '20px', fontSize: '11px', border: '1px solid #c0d8f8', cursor: 'pointer', background: activeInvTab === inv ? '#2B7FD4' : '#fff', color: activeInvTab === inv ? '#fff' : '#5a7aaa', fontWeight: activeInvTab === inv ? 600 : 400 }}>
                    {inv === 'all' ? 'All' : inv}
                  </div>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: '10px', marginBottom: '18px' }}>
                {[
                  { label: 'Sites', val: invSites.length, accent: '#2B7FD4' },
                  { label: 'Capacity (MWp)', val: (invSites.reduce((s,x) => s+(x.capacity_kw||0),0)/1000).toFixed(2), accent: '#F5D000' },
                  { label: 'BESS (MWh)', val: (invSites.reduce((s,x) => s+(x.battery_size_wh||0),0)/1000000).toFixed(2), accent: '#7DC242' },
                  { label: 'PPA', val: invSites.filter(s=>s.system_type==='PPA').length, accent: '#2B7FD4' },
                  { label: 'RTO', val: invSites.filter(s=>s.system_type==='RTO').length, accent: '#7DC242' },
                ].map(k => (
                  <div key={k.label} style={{ background: '#fff', border: '1px solid #dce8f8', borderRadius: '10px', padding: '12px 14px', borderTop: `3px solid ${k.accent}` }}>
                    <div style={{ fontSize: '10px', color: '#7a9aba', marginBottom: '5px', fontWeight: 500 }}>{k.label}</div>
                    <div style={{ fontSize: '24px', fontWeight: 700, color: '#1a2a4a' }}>{k.val}</div>
                  </div>
                ))}
              </div>
              <div style={{ background: '#fff', border: '1px solid #dce8f8', borderRadius: '10px', padding: '16px', marginBottom: '14px' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a2a4a', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '7px' }}><i className="ti ti-chart-bar" style={{ color: '#2B7FD4' }} />Capacity by investor (MWp)</div>
                <div style={{ position: 'relative', height: '200px' }}><canvas id="invCapChart" /></div>
              </div>
              <div style={{ background: '#fff', border: '1px solid #dce8f8', borderRadius: '10px', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead><tr style={{ background: '#f8fbff' }}>
                    {['Site','Province','Capacity','BESS (kWh)','Contract','Type','Status'].map(h => (
                      <th key={h} style={{ textAlign: 'left', padding: '7px 9px', fontSize: '10px', color: '#9ab8d8', fontWeight: 600, borderBottom: '2px solid #dce8f8', textTransform: 'uppercase' }}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {invSites.map(site => (
                      <tr key={site.id} className="tbl-row" style={{ cursor: 'pointer' }} onClick={() => window.location.href = `/sites/${site.id}`}>
                        <td style={{ padding: '7px 9px', borderBottom: '1px solid #f0f6ff', fontWeight: 500, color: '#2B7FD4' }}>{site.name}</td>
                        <td style={{ padding: '7px 9px', borderBottom: '1px solid #f0f6ff' }}>{site.province || '—'}</td>
                        <td style={{ padding: '7px 9px', borderBottom: '1px solid #f0f6ff' }}>{site.capacity_kw} kWp</td>
                        <td style={{ padding: '7px 9px', borderBottom: '1px solid #f0f6ff' }}>{site.battery_size_wh > 0 ? (site.battery_size_wh/1000).toFixed(1) : '—'}</td>
                        <td style={{ padding: '7px 9px', borderBottom: '1px solid #f0f6ff' }}>{site.system_type || '--'}</td>
                        <td style={{ padding: '7px 9px', borderBottom: '1px solid #f0f6ff' }}>{typeBadge(site.business_type)}</td>
                        <td style={{ padding: '7px 9px', borderBottom: '1px solid #f0f6ff' }}>{statusBadge(site.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </main>
      </div>
    </>
  )
}
