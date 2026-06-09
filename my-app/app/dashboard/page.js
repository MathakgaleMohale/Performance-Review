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

  // Rebuild charts when filters, data or chartReady changes
  useEffect(() => {
    if (!loading && sites.length > 0 && chartReady && activePage === 'overview') {
      setTimeout(() => buildCharts(filteredOverview), 100)
    }
  }, [loading, sites, activePage, chartReady, filterInvestor, filterInstaller, filterOverviewContract])

  useEffect(() => {
    if (activePage === 'investor' && chartReady) setTimeout(() => buildCharts(invSites), 100)
  }, [activePage, activeInvTab, chartReady])

  function signOut() { supabase.auth.signOut().then(() => { window.location.href = '/login' }) }

  // Derived values
  const investors = [...new Set(sites.map(s => s.investment_party).filter(Boolean))].sort()
  const installers = [...new Set(sites.map(s => s.installer_name).filter(Boolean))].sort()
  const activeSites = sites.filter(s => s.status === 'active')
  const totalCap = activeSites.reduce((sum, s) => sum + (s.capacity_kw || 0), 0)
  const ppaCount = sites.filter(s => s.system_type === 'PPA').length
  const rtoCount = sites.filter(s => s.system_type === 'RTO').length
  const totalBessWh = sites.reduce((sum, s) => sum + (s.battery_size_wh || 0), 0)
  const totalBessMwh = (totalBessWh / 1000000).toFixed(2)

  // Overview filter
  const filteredOverview = sites.filter(s => {
    const mI = !filterInvestor || s.investment_party === filterInvestor
    const mIn = !filterInstaller || s.installer_name === filterInstaller
    const mC = !filterOverviewContract || s.system_type === filterOverviewContract
    return mI && mIn && mC
  })

  // All sites filter
  const filteredSites = sites.filter(s => {
    const q = searchQuery.toLowerCase()
    const matchQ = !q || s.name?.toLowerCase().includes(q) || s.location?.toLowerCase().includes(q)
    const matchType = !filterType || s.business_type === filterType
    const matchContract = !filterContract || s.system_type === filterContract
    return matchQ && matchType && matchContract
  })

  const invSites = activeInvTab === 'all' ? sites : sites.filter(s => s.investment_party === activeInvTab)

  function buildCharts(sitesData) {
    if (typeof window === 'undefined') return
    const Chart = window.Chart
    if (!Chart) return

    const destroy = (id) => { if (chartsRef.current[id]) { chartsRef.current[id].destroy(); delete chartsRef.current[id] } }
    const C = { blue: '#2B7FD4', yellow: '#F5D000', green: '#7DC242', orange: '#f0a500', gray: '#9ab8d8', purple: '#8b5cf6', red: '#ef4444' }
    const commonOpts = { responsive: true, maintainAspectRatio: false }

    // Business type donut
    const types = ['Retail', 'Manufacture', 'Residential', 'Commercial', 'Agricultural']
    const tColors = [C.blue, C.yellow, C.green, C.orange, C.gray]
    const tCounts = types.map(t => sitesData.filter(s => s.business_type === t).length)
    destroy('bizChart')
    const bizEl = document.getElementById('bizChart')
    if (bizEl) chartsRef.current['bizChart'] = new Chart(bizEl, { type: 'doughnut', data: { labels: types, datasets: [{ data: tCounts, backgroundColor: tColors, borderWidth: 2, borderColor: '#fff' }] }, options: { ...commonOpts, cutout: '55%', plugins: { legend: { display: true, position: 'right', labels: { font: { size: 11 }, boxWidth: 12 } } } } })

    // MWp by province bar chart
    const provCapMap = {}
    sitesData.forEach(s => {
      const p = s.province || s.location?.split(',').slice(-2, -1)[0]?.trim() || 'Unknown'
      provCapMap[p] = (provCapMap[p] || 0) + (s.capacity_kw || 0)
    })
    const provKeys = Object.keys(provCapMap).sort((a, b) => provCapMap[b] - provCapMap[a]).slice(0, 9)
    destroy('provMwpChart')
    const provMwpEl = document.getElementById('provMwpChart')
    if (provMwpEl) chartsRef.current['provMwpChart'] = new Chart(provMwpEl, {
      type: 'bar',
      data: { labels: provKeys, datasets: [{ label: 'MWp', data: provKeys.map(p => (provCapMap[p] / 1000).toFixed(2)), backgroundColor: C.blue, borderRadius: 4 }] },
      options: { ...commonOpts, plugins: { legend: { display: false } }, scales: { x: { ticks: { maxRotation: 40, font: { size: 9 } } }, y: { grid: { color: '#dce8f8' }, ticks: { callback: v => v + ' MWp' } } } }
    })

    // MWh BESS by province bar chart
    const provBessMap = {}
    sitesData.forEach(s => {
      const p = s.province || s.location?.split(',').slice(-2, -1)[0]?.trim() || 'Unknown'
      if (s.battery_size_wh > 0) provBessMap[p] = (provBessMap[p] || 0) + (s.battery_size_wh || 0)
    })
    const bessKeys = Object.keys(provBessMap).sort((a, b) => provBessMap[b] - provBessMap[a])
    destroy('provBessChart')
    const provBessEl = document.getElementById('provBessChart')
    if (provBessEl) chartsRef.current['provBessChart'] = new Chart(provBessEl, {
      type: 'bar',
      data: { labels: bessKeys.length ? bessKeys : ['No BESS data'], datasets: [{ label: 'MWh', data: bessKeys.length ? bessKeys.map(p => (provBessMap[p] / 1000000).toFixed(2)) : [0], backgroundColor: C.yellow, borderRadius: 4 }] },
      options: { ...commonOpts, plugins: { legend: { display: false } }, scales: { x: { ticks: { maxRotation: 40, font: { size: 9 } } }, y: { grid: { color: '#dce8f8' }, ticks: { callback: v => v + ' MWh' } } } }
    })

    // Contract split donut
    const otherC = sitesData.filter(s => s.system_type !== 'PPA' && s.system_type !== 'RTO').length
    const ppa = sitesData.filter(s => s.system_type === 'PPA').length
    const rto = sitesData.filter(s => s.system_type === 'RTO').length
    destroy('contractChart')
    const conEl = document.getElementById('contractChart')
    if (conEl) chartsRef.current['contractChart'] = new Chart(conEl, { type: 'doughnut', data: { labels: ['PPA', 'RTO', 'Other'], datasets: [{ data: [ppa, rto, otherC], backgroundColor: [C.blue, C.green, C.gray], borderWidth: 2, borderColor: '#fff' }] }, options: { ...commonOpts, cutout: '60%', plugins: { legend: { display: true, position: 'right', labels: { font: { size: 11 }, boxWidth: 12 } } } } })

    // Investor donut
    const invList = ['SSI', 'Anuva', '12B Fund']
    const invCounts = invList.map(inv => sitesData.filter(s => s.investment_party === inv).length)
    destroy('investorChart')
    const invEl = document.getElementById('investorChart')
    if (invEl) chartsRef.current['investorChart'] = new Chart(invEl, { type: 'doughnut', data: { labels: invList, datasets: [{ data: invCounts, backgroundColor: [C.blue, C.yellow, C.green], borderWidth: 2, borderColor: '#fff' }] }, options: { ...commonOpts, cutout: '60%', plugins: { legend: { display: true, position: 'right', labels: { font: { size: 11 }, boxWidth: 12 } } } } })

    // Investor capacity bar
    const invCaps = invList.map(inv => (sitesData.filter(s => s.investment_party === inv).reduce((s, x) => s + (x.capacity_kw || 0), 0) / 1000).toFixed(2))
    destroy('invCapChart')
    const invCapEl = document.getElementById('invCapChart')
    if (invCapEl) chartsRef.current['invCapChart'] = new Chart(invCapEl, { type: 'bar', data: { labels: invList, datasets: [{ data: invCaps, backgroundColor: [C.blue, C.yellow, C.green], borderRadius: 8 }] }, options: { ...commonOpts, plugins: { legend: { display: false } }, scales: { y: { grid: { color: '#dce8f8' }, ticks: { callback: v => v + ' MWp' } } } } })
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

  const selectStyle = { padding: '6px 11px', border: '1px solid #c0d8f8', borderRadius: '8px', fontSize: '12px', color: '#1a2a4a', background: '#fff', outline: 'none', cursor: 'pointer' }

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontSize: '14px', color: '#7a9aba' }}>Loading Sosimple Portal...</div>

  // Filtered overview stats
  const fCap = filteredOverview.reduce((sum, s) => sum + (s.capacity_kw || 0), 0)
  const fBess = filteredOverview.reduce((sum, s) => sum + (s.battery_size_wh || 0), 0)
  const fPpa = filteredOverview.filter(s => s.system_type === 'PPA').length
  const fRto = filteredOverview.filter(s => s.system_type === 'RTO').length

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
            { id: 'investor', icon: 'ti-chart-bar', label: 'Investor View' },
          ].map(item => (
            <div key={item.id} className="nav-item" onClick={() => setActivePage(item.id)} style={{ display: 'flex', alignItems: 'center', gap: '9px', padding: '8px 18px', cursor: 'pointer', fontSize: '13px', color: activePage === item.id ? '#2B7FD4' : '#5a7aaa', borderLeft: `3px solid ${activePage === item.id ? '#2B7FD4' : 'transparent'}`, background: activePage === item.id ? '#f0f6ff' : 'transparent', fontWeight: activePage === item.id ? 600 : 400 }}>
              <i className={`ti ${item.icon}`} style={{ fontSize: '16px' }} />
              <span>{item.label}</span>
            </div>
          ))}
          <div style={{ marginTop: 'auto', padding: '14px 18px', borderTop: '1px solid #dce8f8', fontSize: '10px', color: '#9ab8d8', lineHeight: 1.6 }}>2026 Sosimple Energy<br />Cheap energy. Clean business.</div>
        </nav>

        {/* Main content */}
        <main style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>

          {/* ── OVERVIEW PAGE ── */}
          {activePage === 'overview' && (
            <div>
              {/* Hero */}
              <div style={{ background: 'linear-gradient(135deg,#2B7FD4,#1a5fa0)', borderRadius: '14px', padding: '20px 24px', marginBottom: '18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '14px' }}>
                <div>
                  <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#fff', marginBottom: '3px' }}>Portfolio Dashboard</h2>
                  <p style={{ fontSize: '12px', color: '#c0d8f8' }}>{sites.length} solar installations across South Africa &amp; beyond</p>
                </div>
                <div style={{ display: 'flex', gap: '18px', flexWrap: 'wrap' }}>
                  {[
                    { val: sites.length, label: 'Total Sites' },
                    { val: (totalCap / 1000).toFixed(2), label: 'MWp Installed' },
                    { val: totalBessMwh, label: 'MWh BESS' },
                    { val: ppaCount, label: 'PPA Sites' },
                    { val: rtoCount, label: 'RTO Sites' },
                  ].map(s => (
                    <div key={s.label}>
                      <div style={{ fontSize: '22px', fontWeight: 700, color: '#F5D000' }}>{s.val}</div>
                      <div style={{ fontSize: '10px', color: '#c0d8f8' }}>{s.label}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Filters */}
              <div style={{ background: '#fff', border: '1px solid #dce8f8', borderRadius: '10px', padding: '14px 16px', marginBottom: '16px', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: '11px', fontWeight: 600, color: '#7a9aba', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  <i className="ti ti-filter" style={{ marginRight: '4px' }} />Filter
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
                  <option>PPA</option>
                  <option>RTO</option>
                </select>
                {(filterInvestor || filterInstaller || filterOverviewContract) && (
                  <button onClick={() => { setFilterInvestor(''); setFilterInstaller(''); setFilterOverviewContract('') }} style={{ ...selectStyle, background: '#fce8e8', border: '1px solid #f5b8b8', color: '#9a1a1a', cursor: 'pointer' }}>
                    Clear filters ×
                  </button>
                )}
                <span style={{ fontSize: '11px', color: '#9ab8d8', marginLeft: 'auto' }}>
                  Showing {filteredOverview.length} of {sites.length} sites
                </span>
              </div>

              {/* KPI Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: '10px', marginBottom: '18px' }}>
                {[
                  { label: 'Total Sites', val: filteredOverview.length, sub: `${filteredOverview.filter(s=>s.status==='active').length} active`, accent: '#F5D000' },
                  { label: 'Capacity (MWp)', val: (fCap / 1000).toFixed(2), accent: '#2B7FD4' },
                  { label: 'BESS (MWh)', val: (fBess / 1000000).toFixed(2), accent: '#7DC242' },
                  { label: 'PPA Sites', val: fPpa, accent: '#2B7FD4' },
                  { label: 'RTO Sites', val: fRto, accent: '#7DC242' },
                  { label: 'Inactive Sites', val: filteredOverview.filter(s => s.status === 'inactive').length, accent: '#ef4444' },
                ].map(k => (
                  <div key={k.label} style={{ background: '#fff', border: '1px solid #dce8f8', borderRadius: '10px', padding: '12px 14px', borderTop: `3px solid ${k.accent}` }}>
                    <div style={{ fontSize: '10px', color: '#7a9aba', marginBottom: '5px', fontWeight: 500 }}>{k.label}</div>
                    <div style={{ fontSize: '24px', fontWeight: 700, color: '#1a2a4a' }}>{k.val}</div>
                    {k.sub && <div style={{ fontSize: '10px', color: '#9ab8d8' }}>{k.sub}</div>}
                  </div>
                ))}
              </div>

              {/* Charts Row 1 — Business type + MWp by province */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
                <div style={{ background: '#fff', border: '1px solid #dce8f8', borderRadius: '10px', padding: '16px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a2a4a', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '7px' }}>
                    <i className="ti ti-chart-donut" style={{ color: '#2B7FD4' }} />By business type
                  </div>
                  <div style={{ position: 'relative', height: '190px' }}><canvas id="bizChart" /></div>
                </div>
                <div style={{ background: '#fff', border: '1px solid #dce8f8', borderRadius: '10px', padding: '16px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a2a4a', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '7px' }}>
                    <i className="ti ti-map" style={{ color: '#2B7FD4' }} />MWp by province
                  </div>
                  <div style={{ position: 'relative', height: '190px' }}><canvas id="provMwpChart" /></div>
                </div>
              </div>

              {/* Charts Row 2 — MWh BESS by province + Contract split */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
                <div style={{ background: '#fff', border: '1px solid #dce8f8', borderRadius: '10px', padding: '16px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a2a4a', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '7px' }}>
                    <i className="ti ti-battery" style={{ color: '#7DC242' }} />MWh BESS by province
                  </div>
                  <div style={{ position: 'relative', height: '190px' }}><canvas id="provBessChart" /></div>
                </div>
                <div style={{ background: '#fff', border: '1px solid #dce8f8', borderRadius: '10px', padding: '16px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a2a4a', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '7px' }}>
                    <i className="ti ti-file-invoice" style={{ color: '#F5D000' }} />Contract split
                  </div>
                  <div style={{ position: 'relative', height: '190px' }}><canvas id="contractChart" /></div>
                </div>
              </div>

              {/* Charts Row 3 — Investor */}
              <div style={{ background: '#fff', border: '1px solid #dce8f8', borderRadius: '10px', padding: '16px' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a2a4a', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '7px' }}>
                  <i className="ti ti-users" style={{ color: '#7DC242' }} />By investor
                </div>
                <div style={{ position: 'relative', height: '170px' }}><canvas id="investorChart" /></div>
              </div>
            </div>
          )}

          {/* ── ALL SITES PAGE ── */}
          {activePage === 'sites' && (
            <div>
              <div style={{ fontSize: '19px', fontWeight: 700, color: '#1a2a4a', marginBottom: '2px' }}>All Sites</div>
              <div style={{ fontSize: '12px', color: '#7a9aba', marginBottom: '18px' }}>Complete portfolio — {sites.length} solar installations</div>

              <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
                <input type="text" placeholder="Search site name or location..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} style={{ padding: '6px 11px', border: '1px solid #c0d8f8', borderRadius: '8px', fontSize: '12px', color: '#1a2a4a', flex: 1, minWidth: '160px', outline: 'none' }} />
                <select value={filterType} onChange={e => setFilterType(e.target.value)} style={selectStyle}>
                  <option value="">All Types</option>
                  {['Retail', 'Manufacture', 'Residential', 'Commercial', 'Agricultural'].map(t => <option key={t}>{t}</option>)}
                </select>
                <select value={filterContract} onChange={e => setFilterContract(e.target.value)} style={selectStyle}>
                  <option value="">All Contracts</option>
                  <option>PPA</option>
                  <option>RTO</option>
                </select>
              </div>

              <div style={{ fontSize: '11px', color: '#7a9aba', marginBottom: '8px' }}>Showing {filteredSites.length} of {sites.length} sites</div>

              <div style={{ background: '#fff', border: '1px solid #dce8f8', borderRadius: '10px', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ background: '#f8fbff' }}>
                      {['Site Name', 'Province', 'Capacity', 'BESS (kWh)', 'Type', 'Contract', 'Investor', 'Status'].map(h => (
                        <th key={h} style={{ textAlign: 'left', padding: '7px 9px', fontSize: '10px', color: '#9ab8d8', fontWeight: 600, borderBottom: '2px solid #dce8f8', textTransform: 'uppercase' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSites.map(site => (
                      <tr key={site.id} className="tbl-row" style={{ cursor: 'pointer' }} onClick={() => window.location.href = `/sites/${site.id}`}>
                        <td style={{ padding: '7px 9px', borderBottom: '1px solid #f0f6ff', fontWeight: 500, color: '#2B7FD4' }}>{site.name}</td>
                        <td style={{ padding: '7px 9px', borderBottom: '1px solid #f0f6ff', color: '#2a3a5a' }}>{site.province || '—'}</td>
                        <td style={{ padding: '7px 9px', borderBottom: '1px solid #f0f6ff', color: '#2a3a5a' }}>{site.capacity_kw} kWp</td>
                        <td style={{ padding: '7px 9px', borderBottom: '1px solid #f0f6ff', color: '#2a3a5a' }}>{site.battery_size_wh > 0 ? (site.battery_size_wh / 1000).toFixed(1) : '—'}</td>
                        <td style={{ padding: '7px 9px', borderBottom: '1px solid #f0f6ff' }}>{typeBadge(site.business_type)}</td>
                        <td style={{ padding: '7px 9px', borderBottom: '1px solid #f0f6ff', color: '#2a3a5a' }}>{site.system_type || '--'}</td>
                        <td style={{ padding: '7px 9px', borderBottom: '1px solid #f0f6ff', color: '#2a3a5a' }}>{site.investment_party || '--'}</td>
                        <td style={{ padding: '7px 9px', borderBottom: '1px solid #f0f6ff' }}>{statusBadge(site.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── INVESTOR VIEW PAGE ── */}
          {activePage === 'investor' && (
            <div>
              <div style={{ fontSize: '19px', fontWeight: 700, color: '#1a2a4a', marginBottom: '2px' }}>Investor View</div>
              <div style={{ fontSize: '12px', color: '#7a9aba', marginBottom: '18px' }}>Portfolio by investment party</div>

              <div style={{ display: 'flex', gap: '5px', marginBottom: '14px', flexWrap: 'wrap' }}>
                {['all', 'SSI', 'Anuva', '12B Fund'].map(inv => (
                  <div key={inv} className="tab" onClick={() => setActiveInvTab(inv)} style={{ padding: '5px 13px', borderRadius: '20px', fontSize: '11px', border: '1px solid #c0d8f8', cursor: 'pointer', background: activeInvTab === inv ? '#2B7FD4' : '#fff', color: activeInvTab === inv ? '#fff' : '#5a7aaa', fontWeight: activeInvTab === inv ? 600 : 400 }}>
                    {inv === 'all' ? 'All' : inv}
                  </div>
                ))}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: '10px', marginBottom: '18px' }}>
                {[
                  { label: 'Sites', val: invSites.length, accent: '#2B7FD4' },
                  { label: 'Capacity (MWp)', val: (invSites.reduce((s, x) => s + (x.capacity_kw || 0), 0) / 1000).toFixed(2), accent: '#F5D000' },
                  { label: 'BESS (MWh)', val: (invSites.reduce((s, x) => s + (x.battery_size_wh || 0), 0) / 1000000).toFixed(2), accent: '#7DC242' },
                  { label: 'PPA', val: invSites.filter(s => s.system_type === 'PPA').length, accent: '#2B7FD4' },
                  { label: 'RTO', val: invSites.filter(s => s.system_type === 'RTO').length, accent: '#7DC242' },
                ].map(k => (
                  <div key={k.label} style={{ background: '#fff', border: '1px solid #dce8f8', borderRadius: '10px', padding: '12px 14px', borderTop: `3px solid ${k.accent}` }}>
                    <div style={{ fontSize: '10px', color: '#7a9aba', marginBottom: '5px', fontWeight: 500 }}>{k.label}</div>
                    <div style={{ fontSize: '24px', fontWeight: 700, color: '#1a2a4a' }}>{k.val}</div>
                  </div>
                ))}
              </div>

              <div style={{ background: '#fff', border: '1px solid #dce8f8', borderRadius: '10px', padding: '16px', marginBottom: '14px' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a2a4a', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '7px' }}>
                  <i className="ti ti-chart-bar" style={{ color: '#2B7FD4' }} />Capacity by investor (MWp)
                </div>
                <div style={{ position: 'relative', height: '200px' }}><canvas id="invCapChart" /></div>
              </div>

              <div style={{ background: '#fff', border: '1px solid #dce8f8', borderRadius: '10px', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ background: '#f8fbff' }}>
                      {['Site', 'Province', 'Capacity', 'BESS (kWh)', 'Contract', 'Type', 'Status'].map(h => (
                        <th key={h} style={{ textAlign: 'left', padding: '7px 9px', fontSize: '10px', color: '#9ab8d8', fontWeight: 600, borderBottom: '2px solid #dce8f8', textTransform: 'uppercase' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {invSites.map(site => (
                      <tr key={site.id} className="tbl-row" style={{ cursor: 'pointer' }} onClick={() => window.location.href = `/sites/${site.id}`}>
                        <td style={{ padding: '7px 9px', borderBottom: '1px solid #f0f6ff', fontWeight: 500, color: '#2B7FD4' }}>{site.name}</td>
                        <td style={{ padding: '7px 9px', borderBottom: '1px solid #f0f6ff', color: '#2a3a5a' }}>{site.province || '—'}</td>
                        <td style={{ padding: '7px 9px', borderBottom: '1px solid #f0f6ff', color: '#2a3a5a' }}>{site.capacity_kw} kWp</td>
                        <td style={{ padding: '7px 9px', borderBottom: '1px solid #f0f6ff', color: '#2a3a5a' }}>{site.battery_size_wh > 0 ? (site.battery_size_wh / 1000).toFixed(1) : '—'}</td>
                        <td style={{ padding: '7px 9px', borderBottom: '1px solid #f0f6ff', color: '#2a3a5a' }}>{site.system_type || '--'}</td>
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
