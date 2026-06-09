'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import './login.css'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [stats, setStats] = useState({ sites: 78, mwp: '7.2' })

  useEffect(() => {
    async function loadStats() {
      const { data } = await supabase.from('sites').select('capacity_kw, status')
      if (data) {
        const mwp = (data.reduce((sum, s) => sum + (s.capacity_kw || 0), 0) / 1000).toFixed(1)
        setStats({ sites: data.length, mwp })
      }
    }
    loadStats()
  }, [])

  async function handleLogin() {
    setLoading(true)
    setError('')

    const { data, error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError('Invalid email or password. Please try again.')
      setLoading(false)
      return
    }

    const { data: profile } = await supabase
      .from('users')
      .select('role')
      .eq('id', data.user.id)
      .single()

    if (profile?.role === 'employee') window.location.href = '/dashboard'
    else if (profile?.role === 'investor') window.location.href = '/investor'
    else {
      setError('No role assigned. Contact your administrator.')
      setLoading(false)
    }
  }

  return (
    <div className="login-page">

      {/* Left branding panel */}
      <div className="login-left">
        <div className="left-logo">
          <svg width="52" height="58" viewBox="0 0 46 52" fill="none">
            <ellipse cx="23" cy="16" rx="18" ry="16" fill="#F5D000"/>
            <ellipse cx="23" cy="36" rx="18" ry="16" fill="#2B7FD4"/>
            <rect x="14" y="20" width="14" height="12" rx="2" fill="#7DC242" transform="rotate(-8 14 20)"/>
          </svg>
          <div>
            <div className="left-brand-name">Sosimple</div>
            <div className="left-tagline">Cheap energy. Clean business.</div>
          </div>
        </div>

        <div className="left-hero">
          <h1>Solar performance,<br /><span>simplified.</span></h1>
          <p>Monitor your entire solar portfolio in one place. Real-time production data, site performance tracking and investor reporting — all in one clean dashboard.</p>
        </div>

        <div className="left-stats">
          <div>
            <div className="left-stat-val">{stats.sites}+</div>
            <div className="left-stat-label">Active Sites</div>
          </div>
          <div>
            <div className="left-stat-val">{stats.mwp} MWp</div>
            <div className="left-stat-label">Installed Capacity</div>
          </div>
          <div>
            <div className="left-stat-val">100%</div>
            <div className="left-stat-label">Clean Energy</div>
          </div>
        </div>

        <div className="left-footer">
          © 2026 Sosimple Energy · South Africa &amp; Zambia
        </div>
      </div>

      {/* Right login panel */}
      <div className="login-right">
        <div className="login-card">
          <h2>Welcome back</h2>
          <p className="subtitle">Sign in to your Sosimple Energy portal</p>

          {error && (
            <div className="error-box">
              <i className="ti ti-alert-circle" />
              {error}
            </div>
          )}

          <div className="form-group">
            <label>Email address</label>
            <div className="input-wrap">
              <i className="ti ti-mail" />
              <input
                className="form-input"
                type="email"
                placeholder="you@sosimpleenergy.co.za"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLogin()}
              />
            </div>
          </div>

          <div className="form-group">
            <label>Password</label>
            <div className="input-wrap">
              <i className="ti ti-lock" />
              <input
                className="form-input"
                type="password"
                placeholder="••••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLogin()}
              />
            </div>
          </div>

          <button className="login-btn" onClick={handleLogin} disabled={loading}>
            {loading
              ? <><i className="ti ti-loader" /> Signing in...</>
              : <><i className="ti ti-login" /> Sign In</>
            }
          </button>

          <div className="login-footer">
            Having trouble signing in? Contact<br />
            <a href="mailto:support@sosimpleenergy.co.za" style={{ color: '#2B7FD4' }}>
              support@sosimpleenergy.co.za
            </a>
          </div>
        </div>
      </div>

    </div>
  )
}
