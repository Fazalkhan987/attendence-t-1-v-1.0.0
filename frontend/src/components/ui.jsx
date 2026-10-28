import { useEffect, useRef } from 'react'
import { ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react'

const BTN = {
  primary: 'bg-brand text-white hover:bg-brand-600 disabled:bg-brand/50',
  secondary: 'bg-white text-[#1b2433] ring-1 ring-inset ring-line hover:bg-paper disabled:text-muted',
  danger: 'bg-danger text-white hover:bg-[#a83631] disabled:bg-danger/50',
  ghost: 'text-muted hover:bg-black/5 hover:text-[#1b2433]',
  success: 'bg-present text-white hover:bg-[#187247] disabled:bg-present/50',
}
const SIZE = { sm: 'h-8 px-3 text-sm gap-1.5', md: 'h-10 px-4 text-sm gap-2', lg: 'h-11 px-5 text-[15px] gap-2' }

export function Button({ variant = 'primary', size = 'md', loading, icon: Icon, children, className = '', ...props }) {
  return (
    <button
      className={`inline-flex shrink-0 items-center justify-center rounded-md font-medium transition-colors disabled:cursor-not-allowed ${BTN[variant]} ${SIZE[size]} ${className}`}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : Icon && <Icon className="h-4 w-4" aria-hidden />}
      {children}
    </button>
  )
}

export function IconButton({ icon: Icon, label, tone = 'default', className = '', ...props }) {
  const tones = { default: 'text-muted hover:bg-black/5 hover:text-[#1b2433]', danger: 'text-muted hover:bg-danger-50 hover:text-danger' }
  return (
    <button className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors ${tones[tone]} ${className}`}
            aria-label={label} title={label} {...props}>
      <Icon className="h-4 w-4" aria-hidden />
    </button>
  )
}

export function Field({ label, error, hint, children, className = '' }) {
  return (
    <div className={className}>
      {label && <span className="label">{label}</span>}
      {children}
      {error ? <p className="mt-1 text-xs text-danger">{error}</p> : hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  )
}

export function Panel({ title, action, children, className = '', bodyClass = 'p-5' }) {
  return (
    <section className={`rounded-lg bg-white shadow-panel ${className}`}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {action}
        </header>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  )
}

const BADGE = {
  present: 'bg-present-50 text-present',
  late: 'bg-late-50 text-late',
  absent: 'bg-danger-50 text-danger',
  neutral: 'bg-paper text-muted ring-1 ring-inset ring-line',
  brand: 'bg-brand-50 text-brand',
}
export function Badge({ tone = 'neutral', children, dot }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[tone]}`}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  )
}

export function Spinner({ label = 'Loading' }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted" role="status">
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> {label}…
    </div>
  )
}

export function EmptyState({ icon: Icon, title, children, action }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      {Icon && <Icon className="h-9 w-9 text-ink-300" aria-hidden />}
      <p className="mt-3 font-semibold">{title}</p>
      {children && <p className="mt-1 max-w-sm text-sm text-muted">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function ErrorNote({ children, onRetry }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-danger/30 bg-danger-50 px-4 py-3 text-sm text-danger" role="alert">
      <span>{children}</span>
      {onRetry && <Button size="sm" variant="secondary" onClick={onRetry}>Try again</Button>}
    </div>
  )
}

export function Modal({ open, onClose, title, children, footer, size = 'md', dismissable = true }) {
  const ref = useRef(null)
  const closeRef = useRef(onClose)
  closeRef.current = dismissable ? onClose : null
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement
    const onKey = (e) => { if (e.key === 'Escape') closeRef.current?.() }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    setTimeout(() => ref.current?.querySelector('input,select,textarea,button:not([data-close])')?.focus(), 30)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      prev?.focus?.()
    }
  }, [open])
  if (!open) return null
  const widths = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-3xl' }
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-4"
         onMouseDown={(e) => { if (e.target === e.currentTarget && dismissable) onClose?.() }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title}
           className={`flex max-h-[94vh] w-full ${widths[size]} flex-col rounded-t-xl bg-white shadow-pop sm:rounded-xl`}>
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-base font-semibold">{title}</h2>
          {dismissable && <IconButton icon={X} label="Close" onClick={onClose} data-close />}
        </header>
        <div className="overflow-y-auto px-5 py-5">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</footer>}
      </div>
    </div>
  )
}

export function ConfirmDialog({ open, title, children, confirmLabel, tone = 'danger', loading, onConfirm, onClose }) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm" dismissable={!loading}
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
        <Button variant={tone} onClick={onConfirm} loading={loading}>{confirmLabel}</Button>
      </>}>
      <div className="text-sm leading-relaxed text-[#2b3545]">{children}</div>
    </Modal>
  )
}

export function Pagination({ page, pageSize, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const from = total ? (page - 1) * pageSize + 1 : 0
  const to = Math.min(page * pageSize, total)
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm text-muted">
      <span className="tabular">{from}–{to} of {total}</span>
      <div className="flex items-center gap-1">
        <IconButton icon={ChevronLeft} label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)} className="disabled:opacity-40" />
        <span className="tabular px-2">Page {page} of {pages}</span>
        <IconButton icon={ChevronRight} label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)} className="disabled:opacity-40" />
      </div>
    </div>
  )
}

export function Segmented({ value, onChange, options, label }) {
  return (
    <div className="inline-flex rounded-md bg-paper p-0.5 ring-1 ring-inset ring-line" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${value === o.value ? 'bg-white text-[#1b2433] shadow-panel' : 'text-muted hover:text-[#1b2433]'}`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function StatusBadge({ status }) {
  if (status === 'present') return <Badge tone="present" dot>Present</Badge>
  if (status === 'late') return <Badge tone="late" dot>Late</Badge>
  return <Badge tone="absent" dot>Absent</Badge>
}
