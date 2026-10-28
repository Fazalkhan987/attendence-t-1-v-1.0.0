import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { CalendarCheck, LayoutDashboard, Loader2, LogOut, Menu, ScanFace, Settings, TriangleAlert, Users, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { initials } from '../lib/format'

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/people', label: 'People', icon: Users },
  { to: '/live', label: 'Live camera', icon: ScanFace },
  { to: '/attendance', label: 'Attendance', icon: CalendarCheck },
  { to: '/settings', label: 'Settings', icon: Settings },
]
const TITLES = { '/': 'Dashboard', '/people': 'People', '/live': 'Live camera', '/attendance': 'Attendance', '/settings': 'Settings' }

function useEngineHealth() {
  const [engine, setEngine] = useState(null)
  useEffect(() => {
    let timer
    let alive = true
    const poll = async () => {
      try {
        const h = await api.get('/api/health')
        if (!alive) return
        setEngine(h.engine)
        timer = setTimeout(poll, h.engine === 'ready' ? 30000 : 4000)
      } catch {
        if (alive) { setEngine('offline'); timer = setTimeout(poll, 5000) }
      }
    }
    poll()
    return () => { alive = false; clearTimeout(timer) }
  }, [])
  return engine
}

function Sidebar({ onNavigate }) {
  const { admin, logout } = useAuth()
  return (
    <div className="flex h-full flex-col bg-ink text-white">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <img src="/favicon.svg" alt="" className="h-8 w-8" />
        <div className="leading-tight">
          <p className="text-[15px] font-semibold">Smart Attendance</p>
          <p className="text-xs text-ink-300">Face recognition register</p>
        </div>
      </div>
      <nav className="mt-2 flex-1 space-y-0.5 px-3" aria-label="Main">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} onClick={onNavigate}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive ? 'bg-white/10 text-white shadow-[inset_3px_0_0_#7da2ef]' : 'text-ink-300 hover:bg-white/5 hover:text-white'}`}>
            <Icon className="h-[18px] w-[18px]" aria-hidden />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-white/10 p-3">
        <div className="flex items-center gap-3 rounded-md px-2 py-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink-600 text-xs font-semibold">
            {initials(admin?.full_name || admin?.username)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{admin?.full_name || admin?.username}</p>
            <p className="truncate text-xs text-ink-300">{admin?.username}</p>
          </div>
          <button onClick={logout} className="rounded-md p-2 text-ink-300 hover:bg-white/10 hover:text-white" aria-label="Sign out" title="Sign out">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

function EngineBanner({ status }) {
  if (!status || status === 'ready') return null
  const map = {
    loading: { icon: Loader2, spin: true, cls: 'bg-brand-50 text-brand',
      text: 'Face recognition models are loading. The first start downloads about 280 MB, so this can take a few minutes. Records and settings work meanwhile.' },
    error: { icon: TriangleAlert, cls: 'bg-danger-50 text-danger',
      text: 'The face recognition engine failed to load. Open Settings to see the error and retry.' },
    not_loaded: { icon: TriangleAlert, cls: 'bg-late-50 text-late', text: 'The face recognition engine is not loaded. Open Settings to load it.' },
    offline: { icon: TriangleAlert, cls: 'bg-danger-50 text-danger', text: 'Cannot reach the backend server. Check that FastAPI is running on port 8000.' },
  }
  const m = map[status] || map.not_loaded
  const Icon = m.icon
  return (
    <div className={`flex items-start gap-2.5 px-4 py-2.5 text-sm sm:px-8 ${m.cls}`} role="status">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${m.spin ? 'animate-spin' : ''}`} aria-hidden />
      <span>{m.text}</span>
    </div>
  )
}

export default function Layout() {
  const [open, setOpen] = useState(false)
  const engine = useEngineHealth()
  const { pathname } = useLocation()
  useEffect(() => setOpen(false), [pathname])

  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block"><Sidebar /></aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85%]">
            <Sidebar onNavigate={() => setOpen(false)} />
            <button onClick={() => setOpen(false)} className="absolute right-3 top-5 rounded-md p-1.5 text-ink-300 hover:bg-white/10" aria-label="Close menu">
              <X className="h-5 w-5" />
            </button>
          </aside>
        </div>
      )}
      <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-white/95 px-4 backdrop-blur sm:px-8">
        <button onClick={() => setOpen(true)} className="-ml-1 rounded-md p-2 text-muted hover:bg-paper lg:hidden" aria-label="Open menu">
          <Menu className="h-5 w-5" />
        </button>
        <h1 className="text-lg font-semibold">{TITLES[pathname] || 'Smart Attendance'}</h1>
        <div className="ml-auto flex items-center gap-2 text-sm text-muted">
          <span className={`h-2 w-2 rounded-full ${engine === 'ready' ? 'bg-present' : engine === 'loading' ? 'bg-late' : 'bg-danger'}`} aria-hidden />
          <span className="hidden sm:inline">
            {engine === 'ready' ? 'Recognition ready' : engine === 'loading' ? 'Loading models' : engine === 'offline' ? 'Server offline' : 'Recognition unavailable'}
          </span>
        </div>
      </header>
      <EngineBanner status={engine} />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-8 sm:py-8">
        <Outlet context={{ engine }} />
      </main>
    </div>
  )
}
