import { supabase } from './supabase'

// Get the currently logged in user with their role
export async function getCurrentUser() {
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return null

  // Fetch role from the users table
  const { data: profile } = await supabase
    .from('users')
    .select('role, full_name')
    .eq('id', user.id)
    .single()

  return { ...user, role: profile?.role, full_name: profile?.full_name }
}

// Check if user is a Sosimple employee
export async function isEmployee() {
  const user = await getCurrentUser()
  return user?.role === 'employee'
}

// Check if user is an investor
export async function isInvestor() {
  const user = await getCurrentUser()
  return user?.role === 'investor'
}

// Get sites assigned to an investor
export async function getInvestorSites(userId) {
  const { data, error } = await supabase
    .from('investor_sites')
    .select('site_id, sites(*)')
    .eq('investor_id', userId)

  if (error) return []
  return data.map((row) => row.sites)
}
