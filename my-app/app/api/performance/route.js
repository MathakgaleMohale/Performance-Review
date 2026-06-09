import { supabase } from '@/lib/supabase'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const siteId = searchParams.get('site_id')
  const year = searchParams.get('year')

  let query = supabase
    .from('performance')
    .select('*')
    .order('year', { ascending: false })
    .order('month', { ascending: false })

  if (siteId) query = query.eq('site_id', siteId)
  if (year) query = query.eq('year', year)

  const { data, error } = await query

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}
