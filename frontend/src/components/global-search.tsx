import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowClockwise,
  ArrowUpRight,
  ListChecks,
  MagnifyingGlass,
  NotePencil,
  StackSimple,
  WarningCircle,
  type Icon as PhosphorIcon,
} from '@phosphor-icons/react'
import { api } from '../lib/api'
import {
  categoryLabels,
  toolLabels,
  type Page,
  type SearchItem,
  type Tool,
  type ToolId,
} from '../lib/types'
import { cn } from '../lib/utils'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'

type Result = { key: string; group: string; title: string; detail: string; icon: PhosphorIcon } & (
  { kind: 'tool'; tool: Tool } | { kind: 'content'; item: SearchItem }
)

const contentLabels = { note: 'Catatan', task: 'Tugas', snippet: 'Snippet' }
const contentIcons = { note: NotePencil, task: ListChecks, snippet: StackSimple }

export function CommandPalette({
  open,
  onOpenChange,
  tools,
  toolIcons,
  navigate,
  onContent,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  tools: Tool[]
  toolIcons: Record<ToolId, PhosphorIcon>
  navigate: (page: Page) => void
  onContent: (item: SearchItem) => void
}) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [items, setItems] = useState<SearchItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [more, setMore] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const term = query.trim()

  useEffect(() => {
    if (!open) {
      setQuery('')
      setItems([])
      setSelected(0)
      setError('')
      setMore(false)
      setLoading(false)
      return
    }
    setItems([])
    setError('')
    setMore(false)
    if (term.length < 2) {
      setLoading(false)
      return
    }
    let active = true
    const controller = new AbortController()
    setLoading(true)
    const timer = setTimeout(() => {
      void api
        .search(term, controller.signal)
        .then((response) => {
          if (active) {
            setItems(response.items)
            setMore(response.has_more)
          }
        })
        .catch((caught) => {
          if (active && !controller.signal.aborted)
            setError(caught instanceof Error ? caught.message : 'Pencarian lokal belum tersedia.')
        })
        .finally(() => {
          if (active) setLoading(false)
        })
    }, 250)
    return () => {
      active = false
      clearTimeout(timer)
      controller.abort()
    }
  }, [open, query, attempt])

  const results = useMemo<Result[]>(() => {
    const lower = term.toLocaleLowerCase('id')
    const matched: Result[] = tools
      .filter((tool) =>
        `${toolLabels[tool.id].title} ${toolLabels[tool.id].description}`
          .toLocaleLowerCase('id')
          .includes(lower),
      )
      .map((tool) => ({
        key: `tool-${tool.id}`,
        group: 'Alat',
        title: toolLabels[tool.id].title,
        detail: categoryLabels[tool.category],
        icon: toolIcons[tool.id],
        kind: 'tool',
        tool,
      }))
    for (const kind of ['note', 'task', 'snippet'] as const)
      for (const item of items.filter((item) => item.kind === kind))
        matched.push({
          key: `${item.kind}-${item.id}`,
          group: contentLabels[item.kind],
          title: item.title,
          detail: `${item.completed ? 'Selesai · ' : ''}${item.excerpt}`,
          icon: contentIcons[item.kind],
          kind: 'content',
          item,
        })
    return matched
  }, [term, tools, toolIcons, items])

  useEffect(() => {
    setSelected((previous) => Math.max(0, Math.min(previous, results.length - 1)))
  }, [results.length])
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [selected])
  function choose(result: Result) {
    onOpenChange(false)
    if (result.kind === 'tool') navigate(result.tool.id)
    else onContent(result.item)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0">
        <DialogTitle className="sr-only">Pencarian global</DialogTitle>
        <DialogDescription className="sr-only">
          Cari alat, isi catatan, tugas, dan snippet. Gunakan panah dan Enter untuk membuka hasil.
        </DialogDescription>
        <div className="flex items-center gap-3 border-b border-border px-5 pr-14">
          <MagnifyingGlass size={20} className="shrink-0 text-primary" />
          <input
            autoFocus
            value={query}
            maxLength={200}
            onChange={(event) => {
              setQuery(event.target.value)
              setSelected(0)
              setItems([])
              setMore(false)
              setError('')
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                setSelected((previous) =>
                  Math.max(
                    0,
                    Math.min(previous + (event.key === 'ArrowDown' ? 1 : -1), results.length - 1),
                  ),
                )
              } else if (event.key === 'Enter' && results[selected]) {
                event.preventDefault()
                choose(results[selected])
              }
            }}
            placeholder="Cari alat, catatan, tugas, atau snippet…"
            aria-label="Cari global"
            aria-controls="command-results"
            aria-activedescendant={
              results[selected] ? `command-${results[selected].key}` : undefined
            }
            role="combobox"
            aria-expanded={open}
            aria-autocomplete="list"
            autoComplete="off"
            className="h-[76px] min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div ref={list} className="max-h-[min(60dvh,460px)] overflow-y-auto p-3">
          {term.length < 2 && (
            <p className="px-3 py-3 text-[11px] leading-6 text-muted-foreground">
              Ketik minimal 2 karakter untuk mencari isi catatan, tugas, dan snippet. Data tersimpan
              dicari di kedua workspace.
            </p>
          )}
          <div
            id="command-results"
            role="listbox"
            aria-label="Hasil pencarian global"
            aria-busy={loading}
          >
            {results.map((result, index) => (
              <div key={result.key}>
                {(index === 0 || results[index - 1].group !== result.group) && (
                  <p className="eyebrow px-3 py-3">{result.group}</p>
                )}
                <button
                  type="button"
                  role="option"
                  aria-selected={index === selected}
                  id={`command-${result.key}`}
                  onMouseEnter={() => setSelected(index)}
                  onClick={() => choose(result)}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors',
                    index === selected ? 'bg-accent-soft text-primary' : 'hover:bg-muted',
                  )}
                >
                  <result.icon size={20} className="mt-0.5 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-[13px] font-medium">
                      {result.title}
                    </span>
                    <span className="mt-1 block line-clamp-2 break-words text-[11px] leading-5 text-muted-foreground">
                      {result.detail}
                    </span>
                  </span>
                  <ArrowUpRight size={15} className="mt-1 shrink-0" />
                </button>
              </div>
            ))}
          </div>
          {loading && (
            <div role="status" aria-label="Mencari data lokal" className="space-y-3 px-3 py-5">
              <div className="skeleton h-4 w-3/4" />
              <div className="skeleton h-4 w-1/2" />
            </div>
          )}
          {error && (
            <div role="alert" className="space-y-2 px-3 py-4">
              <p className="flex items-start gap-2 text-xs leading-6 text-danger">
                <WarningCircle size={16} className="mt-1 shrink-0" />
                {error}
              </p>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setAttempt((previous) => previous + 1)}
              >
                <ArrowClockwise size={14} />
                Coba lagi
              </Button>
            </div>
          )}
          {!results.length && !loading && !error && (
            <p role="status" className="px-3 py-9 text-center text-sm text-muted-foreground">
              Belum ada hasil. Coba kata lain.
            </p>
          )}
          {more && (
            <p className="px-3 py-4 text-[11px] leading-6 text-muted-foreground">
              Masih ada hasil lain. Tambahkan kata yang lebih spesifik.
            </p>
          )}
        </div>
        <div className="flex items-center gap-4 border-t border-border px-6 py-3 text-[10px] text-muted-foreground">
          <span>
            <span className="keyboard mr-1">↑ ↓</span>pilih
          </span>
          <span>
            <span className="keyboard mr-1">↵</span>buka
          </span>
          <span className="ml-auto">
            <span className="keyboard mr-1">esc</span>tutup
          </span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
