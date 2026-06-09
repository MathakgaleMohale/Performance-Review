import { supabase } from '@/lib/supabase'

export async function GET(request, { params }) {
  const { data, error } = await supabase
    .from('sites')
    .select('*')
    .eq('id', params.id)
    .single()

  if (error) return Response.json({ error: error.message }, { status: 404 })
  return Response.json(data)
}
