import { redirect } from 'next/navigation'
import { getCurrentUser, getInvestorSites } from '@/lib/auth'
import Link from 'next/link'

export default async function InvestorPage() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'investor') redirect('/login')

  const sites = await getInvestorSites(user.id)
  const totalCapacity = sites?.reduce((sum, s) => sum + (s.capacity_kw || 0), 0) || 0

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div style={styles.headerInner}>
          <span style={styles.brand}>☀️ Sosimple Energy</span>
          <span style={styles.role}>Investor Portal</span>
        </div>
      </header>

      <main style={styles.main}>
        <h1 style={styles.heading}>Welcome, {user.full_name || 'Investor'}</h1>
        <p style={styles.subheading}>Your portfolio · {sites.length} site{sites.length !== 1 ? 's' : ''} · {totalCapacity.toFixed(1)} kW total capacity</p>

        <div style={styles.statsRow}>
          <div style={styles.statCard}>
            <p style={styles.statValue}>{sites.length}</p>
            <p style={styles.statLabel}>Your Sites</p>
          </div>
          <div style={styles.statCard}>
            <p style={styles.statValue}>{totalCapacity.toFixed(0)} kW</p>
            <p style={styles.statLabel}>Total Capacity</p>
          </div>
          <div style={styles.statCard}>
            <p style={styles.statValue}>{sites.filter(s => s.status === 'active').length}</p>
            <p style={styles.statLabel}>Active Sites</p>
          </div>
        </div>

        {sites.length === 0 ? (
          <p style={styles.empty}>No sites assigned to your account yet. Contact Sosimple Energy for assistance.</p>
        ) : (
          <div style={styles.grid}>
            {sites.map((site) => (
              <Link key={site.id} href={`/sites/${site.id}`} style={styles.card}>
                <div style={styles.cardTop}>
                  <span style={styles.siteName}>{site.name}</span>
                  <span style={{
                    ...styles.badge,
                    background: site.status === 'active' ? '#E8F5E9' : '#FFF3E0',
                    color: site.status === 'active' ? '#2E7D32' : '#E65100',
                  }}>
                    {site.status || 'active'}
                  </span>
                </div>
                <p style={styles.siteLocation}>📍 {site.location}</p>
                <p style={styles.siteStat}>⚡ {site.capacity_kw} kW installed</p>
                <p style={styles.siteDate}>Installed: {site.install_date || 'N/A'}</p>
                <p style={styles.viewLink}>View performance →</p>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

const styles = {
  page: { minHeight: '100vh', background: '#F5F5F5' },
  header: { background: '#1B5E20', padding: '0 24px' },
  headerInner: { maxWidth: '1100px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '60px' },
  brand: { color: '#fff', fontWeight: '700', fontSize: '18px' },
  role: { color: '#A5D6A7', fontSize: '14px' },
  main: { maxWidth: '1100px', margin: '0 auto', padding: '32px 24px' },
  heading: { fontSize: '26px', fontWeight: '700', marginBottom: '4px' },
  subheading: { color: '#666', marginBottom: '24px' },
  statsRow: { display: 'flex', gap: '16px', marginBottom: '32px', flexWrap: 'wrap' },
  statCard: { background: '#fff', borderRadius: '10px', padding: '20px 28px', flex: '1', minWidth: '140px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  statValue: { fontSize: '28px', fontWeight: '700', color: '#2E7D32' },
  statLabel: { fontSize: '13px', color: '#666', marginTop: '2px' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' },
  card: { background: '#fff', borderRadius: '10px', padding: '20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', textDecoration: 'none', color: 'inherit', display: 'block' },
  cardTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' },
  siteName: { fontWeight: '600', fontSize: '16px' },
  badge: { fontSize: '12px', padding: '2px 10px', borderRadius: '20px', fontWeight: '500' },
  siteLocation: { fontSize: '14px', color: '#555', marginBottom: '6px' },
  siteStat: { fontSize: '14px', color: '#555', marginBottom: '4px' },
  siteDate: { fontSize: '13px', color: '#888', marginBottom: '12px' },
  viewLink: { fontSize: '13px', color: '#2E7D32', fontWeight: '500' },
  empty: { background: '#fff', borderRadius: '10px', padding: '32px', textAlign: 'center', color: '#666' },
}
