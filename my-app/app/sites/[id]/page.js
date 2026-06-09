import { redirect } from 'next/navigation'
import { getCurrentUser, getInvestorSites } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'

export default async function SiteDetailPage({ params }) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  // Fetch site details
  const { data: site, error } = await supabase
    .from('sites')
    .select('*')
    .eq('id', params.id)
    .single()

  if (error || !site) redirect('/dashboard')

  // Investors can only view their own sites
  if (user.role === 'investor') {
    const investorSites = await getInvestorSites(user.id)
    const hasAccess = investorSites.some((s) => s.id === site.id)
    if (!hasAccess) redirect('/investor')
  }

  // Fetch monthly performance data for this site
  const { data: performance } = await supabase
    .from('performance')
    .select('*')
    .eq('site_id', params.id)
    .order('year', { ascending: false })
    .order('month', { ascending: false })
    .limit(12)

  const totalKwh = performance?.reduce((sum, p) => sum + (p.kwh_produced || 0), 0) || 0
  const backLink = user.role === 'employee' ? '/dashboard' : '/investor'

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div style={styles.headerInner}>
          <Link href={backLink} style={styles.back}>← Back to portfolio</Link>
          <span style={styles.brand}>☀️ Sosimple Energy</span>
        </div>
      </header>

      <main style={styles.main}>
        {/* Site overview card */}
        <div style={styles.overviewCard}>
          <div style={styles.overviewTop}>
            <div>
              <h1 style={styles.siteName}>{site.name}</h1>
              <p style={styles.siteLocation}>📍 {site.location}</p>
            </div>
            <span style={{
              ...styles.badge,
              background: site.status === 'active' ? '#E8F5E9' : '#FFF3E0',
              color: site.status === 'active' ? '#2E7D32' : '#E65100',
            }}>
              {site.status || 'active'}
            </span>
          </div>

          <div style={styles.detailsGrid}>
            <div style={styles.detailItem}>
              <p style={styles.detailLabel}>Installed Capacity</p>
              <p style={styles.detailValue}>⚡ {site.capacity_kw} kW</p>
            </div>
            <div style={styles.detailItem}>
              <p style={styles.detailLabel}>Install Date</p>
              <p style={styles.detailValue}>📅 {site.install_date || '—'}</p>
            </div>
            <div style={styles.detailItem}>
              <p style={styles.detailLabel}>System Type</p>
              <p style={styles.detailValue}>🔆 {site.system_type || 'Grid-tied Solar PV'}</p>
            </div>
            <div style={styles.detailItem}>
              <p style={styles.detailLabel}>Inverter Brand</p>
              <p style={styles.detailValue}>🔧 {site.inverter_brand || '—'}</p>
            </div>
            <div style={styles.detailItem}>
              <p style={styles.detailLabel}>Panel Count</p>
              <p style={styles.detailValue}>🌞 {site.panel_count || '—'} panels</p>
            </div>
            <div style={styles.detailItem}>
              <p style={styles.detailLabel}>Last 12 Months</p>
              <p style={styles.detailValue}>📊 {totalKwh.toLocaleString()} kWh</p>
            </div>
          </div>

          {site.notes && (
            <div style={styles.notes}>
              <p style={styles.detailLabel}>Notes</p>
              <p style={{ fontSize: '14px', color: '#444', marginTop: '4px' }}>{site.notes}</p>
            </div>
          )}
        </div>

        {/* Monthly performance table */}
        <h2 style={styles.sectionTitle}>Monthly Performance</h2>
        {performance?.length === 0 ? (
          <p style={styles.empty}>No performance data available yet.</p>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr style={styles.thead}>
                <th style={styles.th}>Month</th>
                <th style={styles.th}>Year</th>
                <th style={styles.th}>kWh Produced</th>
                <th style={styles.th}>CO₂ Saved (kg)</th>
                <th style={styles.th}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {performance?.map((record, i) => (
                <tr key={record.id} style={{ background: i % 2 === 0 ? '#fff' : '#FAFAFA' }}>
                  <td style={styles.td}>{getMonthName(record.month)}</td>
                  <td style={styles.td}>{record.year}</td>
                  <td style={{ ...styles.td, fontWeight: '600', color: '#2E7D32' }}>
                    {record.kwh_produced?.toLocaleString()} kWh
                  </td>
                  <td style={styles.td}>{record.co2_saved_kg?.toLocaleString() || '—'}</td>
                  <td style={{ ...styles.td, color: '#666' }}>{record.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>
    </div>
  )
}

function getMonthName(monthNumber) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return months[monthNumber - 1] || monthNumber
}

const styles = {
  page: { minHeight: '100vh', background: '#F5F5F5' },
  header: { background: '#2E7D32', padding: '0 24px' },
  headerInner: { maxWidth: '1100px', margin: '0 auto', display: 'flex', alignItems: 'center', gap: '24px', height: '60px' },
  back: { color: '#A5D6A7', fontSize: '14px', textDecoration: 'none' },
  brand: { color: '#fff', fontWeight: '700', fontSize: '18px' },
  main: { maxWidth: '1100px', margin: '0 auto', padding: '32px 24px' },
  overviewCard: { background: '#fff', borderRadius: '12px', padding: '28px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', marginBottom: '32px' },
  overviewTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' },
  siteName: { fontSize: '24px', fontWeight: '700', marginBottom: '4px' },
  siteLocation: { color: '#555', fontSize: '15px' },
  badge: { fontSize: '13px', padding: '4px 14px', borderRadius: '20px', fontWeight: '500', whiteSpace: 'nowrap' },
  detailsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px' },
  detailItem: { background: '#F9F9F9', borderRadius: '8px', padding: '14px 16px' },
  detailLabel: { fontSize: '12px', color: '#888', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' },
  detailValue: { fontSize: '15px', fontWeight: '600', color: '#1A1A1A' },
  notes: { marginTop: '20px', paddingTop: '20px', borderTop: '1px solid #F0F0F0' },
  sectionTitle: { fontSize: '20px', fontWeight: '700', marginBottom: '16px' },
  empty: { background: '#fff', borderRadius: '10px', padding: '32px', textAlign: 'center', color: '#666' },
  table: { width: '100%', borderCollapse: 'collapse', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  thead: { background: '#2E7D32' },
  th: { padding: '12px 16px', textAlign: 'left', color: '#fff', fontSize: '13px', fontWeight: '600' },
  td: { padding: '12px 16px', fontSize: '14px', borderBottom: '1px solid #F0F0F0' },
}
