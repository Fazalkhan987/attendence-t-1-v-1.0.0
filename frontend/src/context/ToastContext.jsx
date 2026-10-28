import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'

const ToastContext = createContext(null)
const STYLES = {
  success: { icon: CheckCircle2, bar: 'bg-present', icon_c: 'text-present' },
  error: { icon: AlertCircle, bar: 'bg-danger', icon_c: 'text-danger' },
  info: { icon: Info, bar: 'bg-brand', icon_c: 'text-brand' },
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const idRef = useRef(0)

  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), [])
  const push = useCallback((type, title, message, ms = 4500) => {
    const id = ++idRef.current
    setToasts((t) => [...t.slice(-3), { id, type, title, message }])
    setTimeout(() => dismiss(id), ms)
  }, [dismiss])

  const toast = useMemo(() => ({
    success: (title, message) => push('success', title, message),
    error: (title, message) => push('error', title, message, 7000),
    info: (title, message) => push('info', title, message),
  }), [push])

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end"
           role="region" aria-live="polite" aria-label="Notifications">
        {toasts.map((t) => {
          const s = STYLES[t.type]
          const Icon = s.icon
          return (
            <div key={t.id} className="animate-toast pointer-events-auto flex w-full max-w-sm overflow-hidden rounded-lg bg-white shadow-pop ring-1 ring-black/5">
              <div className={`w-1 shrink-0 ${s.bar}`} />
              <div className="flex flex-1 items-start gap-3 p-3.5">
                <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${s.icon_c}`} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{t.title}</p>
                  {t.message && <p className="mt-0.5 text-sm text-muted">{t.message}</p>}
                </div>
                <button onClick={() => dismiss(t.id)} className="rounded p-0.5 text-muted hover:bg-paper" aria-label="Dismiss">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)
