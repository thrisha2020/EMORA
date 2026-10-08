import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  MessageSquare,
  Activity,
  BarChart3,
  Bell,
  User,
  Settings,
  LogOut,
  Cpu,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { getToken } from '@/services/api'
import './shell.css'

const NAV = [
  { to: '/chat', label: 'E.M.O.R.A.', icon: MessageSquare },
  { to: '/mood', label: 'MOOD', icon: Activity },
  { to: '/analytics', label: 'ANALYTICS', icon: BarChart3 },
  { to: '/reminders', label: 'REMINDERS', icon: Bell },
  { to: '/profile', label: 'PROFILE', icon: User },
  { to: '/settings', label: 'SETTINGS', icon: Settings },
]

export default function AppShell() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [clock, setClock] = useState('')

  useEffect(() => {
    const id = setInterval(() => {
      setClock(
        new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      )
    }, 1000)
    return () => clearInterval(id)
  }, [])

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="shell scanlines">
      {/* Left navigation */}
      <aside className="shell-nav">
        <div className="shell-nav-brand">
          <span className="shell-nav-logo font-orbitron">E</span>
          <span className="font-orbitron" style={{ fontSize: 13, letterSpacing: '0.3em' }}>
            EMORA
          </span>
        </div>
        <nav className="shell-nav-links">
          {NAV.map((item) => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => `shell-nav-item ${isActive ? 'active' : ''}`}
              >
                <Icon size={17} />
                <span>{item.label}</span>
              </NavLink>
            )
          })}
        </nav>
        <div className="shell-nav-foot">
          <div className="shell-user">
            <div className="shell-avatar">{user?.name?.slice(0, 1).toUpperCase() ?? '?'}</div>
            <div>
              <div className="shell-user-name">{user?.name ?? 'Operator'}</div>
              <div className="shell-user-sub">IDENTITY VERIFIED</div>
            </div>
          </div>
          <button className="shell-logout" onClick={handleLogout} title="Sign out">
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      {/* Main column */}
      <div className="shell-main">
        {/* Top status bar */}
        <header className="shell-topbar">
          <div className="shell-topbar-left">
            <Cpu size={15} style={{ color: 'var(--c-primary)' }} />
            <span className="font-orbitron" style={{ letterSpacing: '0.2em' }}>
              EMORA OS
            </span>
          </div>
          <div className="shell-topbar-right">
            <span className="shell-chip">
              <span className="pulse-dot" /> SYSTEM ONLINE
            </span>
            <span className="shell-chip">JWT · {getToken() ? 'AUTHENTICATED' : 'NO TOKEN'}</span>
            <span className="shell-clock">{clock}</span>
          </div>
        </header>

        {/* Page */}
        <main className="shell-content">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              style={{ height: '100%', overflow: 'hidden' }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  )
}