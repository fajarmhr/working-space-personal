import { useEffect, useState, type ReactNode } from 'react'
import { ArrowClockwise, CheckCircle, WarningCircle } from '@phosphor-icons/react'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog'

export function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

export function ErrorNotice({ message }: { message: string }) {
  return message ? (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-xl bg-danger/5 px-4 py-3 text-xs leading-6 text-danger"
    >
      <WarningCircle size={17} className="mt-1 shrink-0" />
      {message}
    </p>
  ) : null
}

export function EmptyCollection({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children?: ReactNode
}) {
  return (
    <div className="flex flex-col items-start rounded-[24px] border border-dashed border-border px-5 py-9 sm:px-7">
      <span className="mb-5 flex size-11 items-center justify-center rounded-2xl bg-accent-soft text-primary">
        <CheckCircle size={23} />
      </span>
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="mt-2 max-w-80 text-xs leading-6 text-muted-foreground">{description}</p>
      {children && <div className="mt-5">{children}</div>}
    </div>
  )
}

export function CollectionSkeleton() {
  return (
    <div
      role="status"
      aria-label="Memuat data lokal"
      className="grid grid-cols-1 gap-8 xl:grid-cols-[1.2fr_0.9fr]"
    >
      <div className="space-y-5">
        <div className="skeleton h-7 w-40" />
        <div className="skeleton h-12 w-full" />
        {[0, 1, 2].map((index) => (
          <div key={index} className="skeleton h-24 w-full" />
        ))}
      </div>
      <div className="skeleton min-h-96 rounded-[28px]" />
    </div>
  )
}

export function CollectionFailure({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="space-y-5">
      <ErrorNotice message={message} />
      <Button variant="secondary" onClick={onRetry}>
        <ArrowClockwise size={16} />
        Coba muat lagi
      </Button>
    </div>
  )
}

export function useCollection<T>(fetcher: () => Promise<{ items: T[] }>) {
  const [items, setItems] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let active = true
    setLoading(true)
    setLoadError('')
    void fetcher()
      .then((result) => {
        if (active) setItems(result.items)
      })
      .catch((error) => {
        if (active) setLoadError(errorMessage(error, 'Data lokal belum dapat dimuat.'))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [fetcher, revision])
  return {
    items,
    setItems,
    loading,
    loadError,
    retry: () => setRevision((previous) => previous + 1),
  }
}

export function DeleteConfirmation({
  open,
  onOpenChange,
  onConfirm,
  noun,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => Promise<void>
  noun: string
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!open) setError('')
  }, [open])
  async function confirm() {
    setBusy(true)
    setError('')
    try {
      await onConfirm()
      onOpenChange(false)
    } catch (caught) {
      setError(errorMessage(caught, `${noun} belum dapat dihapus.`))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) onOpenChange(value)
      }}
    >
      <DialogContent>
        <DialogTitle className="pr-10 text-lg font-medium tracking-tight">
          Hapus {noun.toLocaleLowerCase('id')} ini?
        </DialogTitle>
        <DialogDescription className="mt-3 max-w-sm text-sm leading-7 text-muted-foreground">
          Data akan dihapus dari workspace lokal. Tindakan ini tidak dapat dibatalkan.
        </DialogDescription>
        <div className="mt-5">
          <ErrorNotice message={error} />
        </div>
        <div className="mt-7 flex flex-wrap justify-end gap-3">
          <Button variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button variant="danger" disabled={busy} onClick={() => void confirm()}>
            {busy ? 'Menghapus…' : `Hapus ${noun.toLocaleLowerCase('id')}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function workspaceToday() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Makassar',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const part = (type: string) => parts.find((value) => value.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

export function formatDueDate(value: string) {
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Makassar',
  }).format(new Date(`${value}T12:00:00+08:00`))
}

export function focusEditor(input: HTMLInputElement | null) {
  if (!input) return
  input.focus({ preventScroll: true })
  input.scrollIntoView({
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    block: 'center',
  })
}
