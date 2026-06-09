import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'

export default async function SitesPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const { data: sites } = await supabase
    .from('sites')
    .select('*')
    .order('name')

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div style={styles.headerInner}>
          <Link href={user.role === 'employee' ? '/dashboard' : '/investor'} style={styles.back}>← Back</Link>
          <span style={styles.brand}>☀️ Sosimple Energy</span>
        </div>
      </header>

      <main style={styles.main}>
        <h1 style={styles.heading}>All Sites</h1>
        <p style={styles.subheading}>{sites?.length || 0} solar installations</p>

        <table style={styles.table}>
          <thead>
            <tr style={styles.thead}>
              <th style={styles.th}>Site Name</th>
              <th style={styles.th}>Location</th>
              <th style={styles.th}>Capacity</th>
              <th style={styles.th}>Install Date</th>
              <th style={styles.th}>Status</th>
              <th style={styles.th}></th>
            </tr>
          </thead>
          <tbody>
            {sites?.map((site, i) => (
              <tr key={site.id} style={{ ...styles.tr, background: i % 2 === 0 ? '#fff' : '#FAFAFA' }}>
                <td style={styles.td}><strong>{site.name}</strong></td>
                <td style={styles.td}>{site.location}</td>
                <td style={styles.td}>{site.capacity_kw} kW</td>
                <td style={styles.td}>{site.install_date || '—'}</td>
                <td style={styles.td}>
                  <span style={{
                    ...styles.badge,
                    background: site.status === 'active' ? '#E8F5E9' : '#FFF3E0',
                    color: site.status === 'active' ? '#2E7D32' : '#E65100',
                  }}>
                    {site.status || 'active'}
                  </span>
                </td>
                <td style={styles.td}>
                  <Link href={`/sites/${site.id}`} style={styles.link}>View →</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </main>
    </div>
  )
}

const styles = {
  page: { minHeight: '100vh', background: '#F5F5F5' },
  header: { background: '#2E7D32', padding: '0 24px' },
  headerInner: { maxWidth: '1100px', margin: '0 auto', display: 'flex', alignItems: 'center', gap: '24px', height: '60px' },
  back: { color: '#A5D6A7', fontSize: '14px', textDecoration: 'none' },
  brand: { color: '#fff', fontWeight: '700', fontSize: '18px' },
  main: { maxWidth: '1100px', margin: '0 auto', padding: '32px 24px' },
  heading: { fontSize: '26px', fontWeight: '700', marginBottom: '4px' },
  subheading: { color: '#666', marginBottom: '24px' },
  table: { width: '100%', borderCollapse: 'collapse', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  thead: { background: '#2E7D32' },
  th: { padding: '12px 16px', textAlign: 'left', color: '#fff', fontSize: '13px', fontWeight: '600' },
  tr: {},
  td: { padding: '12px 16px', fontSize: '14px', borderBottom: '1px solid #F0F0F0' },
  badge: { fontSize: '12px', padding: '2px 10px', borderRadius: '20px', fontWeight: '500' },
  link: { color: '#2E7D32', fontWeight: '500', fontSize: '13px' },
}
