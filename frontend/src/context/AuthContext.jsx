import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api, getToken, setToken, setUnauthorizedHandler } from '../lib/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [admin, setAdmin] = useState(null)
  const [checking, setChecking] = useState(Boolean(getToken()))
  const [expired, setExpired] = useState(false)

  const clear = useCallback((wasExpired = false) => {
    setToken(null)
    setAdmin(null)
    setExpired(wasExpired)
  }, [])

  useEffect(() => {
    setUnauthorizedHandler(() => clear(true))
    if (!getToken()) return
    api.get('/api/auth/me')
      .then(setAdmin)
      .catch(() => clear(false))
      .finally(() => setChecking(false))
  }, [clear])

  const login = useCallback(async (username, password) => {
    const res = await api.post('/api/auth/login', { username, password })
    setToken(res.token)
    setExpired(false)
    setAdmin(res.admin)
    return res.admin
  }, [])

  const logout = useCallback(async () => {
    try { await api.post('/api/auth/logout') } catch { /* already invalid */ }
    clear(false)
  }, [clear])

  const value = useMemo(() => ({ admin, checking, expired, login, logout }), [admin, checking, expired, login, logout])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
