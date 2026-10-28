import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Lock, User } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { Button, ErrorNote } from '../components/ui'

export default function Login() {
  const { admin, login, expired } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  if (admin) return <Navigate to={location.state?.from || '/'} replace />

  const submit = async (e) => {
    e.preventDefault()
    if (!username.trim() || !password) {
      setError('Enter your username and password.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      await login(username.trim(), password)
      navigate(location.state?.from || '/', { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden overflow-hidden bg-ink p-12 text-white lg:flex lg:flex-col">
        <div className="flex items-center gap-2.5">
          <img src="/favicon.svg" alt="" className="h-9 w-9" />
          <span className="text-lg font-semibold">Smart Attendance</span>
        </div>
        <div className="mt-auto max-w-md">
          <p className="text-[34px] font-semibold leading-[1.15] tracking-tight">
            Today’s register fills itself in as people walk past the camera.
          </p>
          <p className="mt-4 text-[15px] leading-relaxed text-ink-300">
            Register faces once, open the live camera, and each recognised person is marked for the day — once, with the time and match score.
          </p>
        </div>
        {/* A register page, drawn as ruled lines with ticks */}
        <svg className="pointer-events-none absolute -right-10 top-24 w-[420px] opacity-[0.13]" viewBox="0 0 420 300" aria-hidden>
          {Array.from({ length: 9 }).map((_, i) => (
            <g key={i}>
              <line x1="0" x2="420" y1={20 + i * 32} y2={20 + i * 32} stroke="#fff" strokeWidth="1" />
              {i % 3 !== 2 && <path d={`M40 ${8 + i * 32} l6 6 l12 -13`} stroke="#5fd39a" strokeWidth="3" fill="none" strokeLinecap="round" />}
              <rect x="80" y={8 + i * 32} width={120 + ((i * 47) % 140)} height="5" rx="2.5" fill="#fff" />
            </g>
          ))}
        </svg>
      </div>

      <div className="flex items-center justify-center px-5 py-12">
        <form onSubmit={submit} className="w-full max-w-sm" noValidate>
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <img src="/favicon.svg" alt="" className="h-9 w-9" />
            <span className="text-lg font-semibold">Smart Attendance</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-1.5 text-sm text-muted">Administrator access only.</p>

          <div className="mt-7 space-y-4">
            {expired && !error && <ErrorNote>Your session ended. Sign in again to continue.</ErrorNote>}
            {error && <ErrorNote>{error}</ErrorNote>}
            <label className="block">
              <span className="label">Username</span>
              <div className="relative">
                <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
                <input className="field h-11 pl-9" autoComplete="username" autoFocus value={username}
                       onChange={(e) => setUsername(e.target.value)} />
              </div>
            </label>
            <label className="block">
              <span className="label">Password</span>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
                <input className="field h-11 pl-9 pr-10" type={show ? 'text' : 'password'} autoComplete="current-password"
                       value={password} onChange={(e) => setPassword(e.target.value)} />
                <button type="button" onClick={() => setShow((s) => !s)}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1.5 text-muted hover:bg-paper"
                        aria-label={show ? 'Hide password' : 'Show password'}>
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </label>
            <Button type="submit" size="lg" loading={loading} className="w-full">Sign in</Button>
          </div>
          <p className="mt-8 text-xs leading-relaxed text-muted">
            Forgot the password? On the server, run <code className="rounded bg-white px-1 py-0.5 ring-1 ring-line">python -m app.manage reset-password --username admin</code>
          </p>
        </form>
      </div>
    </div>
  )
}
