import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'

export default async function Home() {
  const user = await getCurrentUser()

  if (!user) redirect('/login')
  if (user.role === 'employee') redirect('/dashboard')
  if (user.role === 'investor') redirect('/investor')

  redirect('/login')
}
