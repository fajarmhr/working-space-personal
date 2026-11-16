import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  Check,
  CheckCircle,
  Copy,
  Files,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  Trash,
  X,
} from '@phosphor-icons/react'
import { api } from '../../lib/api'
import type { CreateSnippet, SearchTarget, Snippet } from '../../lib/types'
import { cn, copyText, formatDate } from '../../lib/utils'
import { Button } from '../ui/button'
import {
  CollectionFailure,
  CollectionSkeleton,
  DeleteConfirmation,
  EmptyCollection,
  ErrorNotice,
  errorMessage,
  focusEditor,
  useCollection,
} from './shared'

export function Snippets({
  onActivity,
  requestedItem,
}: {
  onActivity: (action: string) => void
  requestedItem: SearchTarget | null
}) {
  const { items, setItems, loading, loadError, retry } = useCollection(api.snippets)
  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [editing, setEditing] = useState<number | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [category, setCategory] = useState('Umum')
  const [saving, setSaving] = useState(false)
  const [openingTarget, setOpeningTarget] = useState(false)
  const [formError, setFormError] = useState('')
  const [copyError, setCopyError] = useState('')
  const [copied, setCopied] = useState<number | null>(null)
  const [notice, setNotice] = useState('')
  const [deleting, setDeleting] = useState<Snippet | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const openedRequest = useRef<SearchTarget | null>(null)
  const latestTarget = useRef({ requestedItem, saving })
  latestTarget.current = { requestedItem, saving }
  const copiedTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(copiedTimeout.current), [])

  const categories = useMemo(
    () =>
      [...new Set(items.map((item) => item.category))].sort((left, right) =>
        left.localeCompare(right, 'id'),
      ),
    [items],
  )
  useEffect(() => {
    if (categoryFilter && !categories.includes(categoryFilter)) setCategoryFilter('')
  }, [categories, categoryFilter])
  const visible = useMemo(() => {
    const search = query.trim().toLocaleLowerCase('id')
    return items
      .filter(
        (item) =>
          (!categoryFilter || categoryFilter === item.category) &&
          (!search ||
            `${item.title}\n${item.content}\n${item.category}`
              .toLocaleLowerCase('id')
              .includes(search)),
      )
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at) || right.id - left.id)
  }, [items, query, categoryFilter])

  function resetEditor() {
    setEditing(null)
    setTitle('')
    setContent('')
    setCategory('Umum')
    setFormError('')
  }
  function newSnippet() {
    resetEditor()
    setNotice('')
    focusEditor(titleRef.current)
  }
  function editSnippet(item: Snippet) {
    setEditing(item.id)
    setTitle(item.title)
    setContent(item.content)
    setCategory(item.category)
    setFormError('')
    setNotice('')
    focusEditor(titleRef.current)
  }
  useEffect(() => {
    if (
      !requestedItem ||
      requestedItem.kind !== 'snippet' ||
      loading ||
      loadError ||
      saving ||
      openedRequest.current === requestedItem
    ) {
      setOpeningTarget(false)
      return
    }
    let active = true
    const controller = new AbortController()
    const isCurrent = () =>
      active && latestTarget.current.requestedItem === requestedItem && !latestTarget.current.saving
    setOpeningTarget(true)
    resetEditor()
    setCategoryFilter('')
    setQuery('')
    void api
      .snippets(controller.signal)
      .then(({ items: current }) => {
        if (!isCurrent()) return
        openedRequest.current = requestedItem
        setItems(current)
        const item = current.find((candidate) => candidate.id === requestedItem.id)
        if (item) editSnippet(item)
        else
          setFormError(
            'Snippet dari hasil pencarian tidak ditemukan. Mungkin sudah dihapus; cari ulang data terbaru.',
          )
      })
      .catch((caught) => {
        if (!isCurrent() || controller.signal.aborted) return
        openedRequest.current = requestedItem
        setFormError(
          errorMessage(
            caught,
            'Snippet terbaru belum dapat dimuat. Cari ulang untuk mencoba lagi.',
          ),
        )
      })
      .finally(() => {
        if (isCurrent()) setOpeningTarget(false)
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [requestedItem, loading, loadError, saving])
  async function saveSnippet(event: FormEvent) {
    event.preventDefault()
    if (saving || openingTarget) return
    if (!title.trim()) {
      setFormError('Tulis judul snippet terlebih dahulu.')
      return
    }
    if (!content.trim()) {
      setFormError('Isi snippet tidak boleh kosong.')
      return
    }
    const payload: CreateSnippet = {
      title: title.trim(),
      content,
      category: category.trim() || 'Umum',
    }
    setSaving(true)
    setFormError('')
    setNotice('')
    try {
      const saved =
        editing === null
          ? await api.createSnippet(payload)
          : await api.updateSnippet(editing, payload)
      setItems((previous) =>
        editing === null
          ? [saved, ...previous]
          : previous.map((item) => (item.id === saved.id ? saved : item)),
      )
      onActivity(editing === null ? 'Menambahkan snippet' : 'Memperbarui snippet')
      setNotice(
        editing === null ? 'Snippet ditambahkan ke pustaka.' : 'Perubahan snippet tersimpan.',
      )
      resetEditor()
      setCategoryFilter('')
      setQuery('')
    } catch (caught) {
      setFormError(errorMessage(caught, 'Snippet belum tersimpan. Isianmu tetap ada.'))
    } finally {
      setSaving(false)
    }
  }
  async function copySnippet(item: Snippet) {
    setCopyError('')
    try {
      await copyText(item.content)
      setCopied(item.id)
      clearTimeout(copiedTimeout.current)
      copiedTimeout.current = setTimeout(() => setCopied(null), 2000)
      onActivity('Menyalin isi snippet')
    } catch (caught) {
      setCopyError(
        errorMessage(caught, 'Snippet belum tersalin. Buka editor untuk menyalin manual.'),
      )
    }
  }
  async function deleteSnippet() {
    if (!deleting) return
    await api.deleteSnippet(deleting.id)
    setItems((previous) => previous.filter((item) => item.id !== deleting.id))
    if (editing === deleting.id) resetEditor()
    onActivity('Menghapus snippet')
    setNotice('Snippet dihapus dari pustaka.')
  }

  if (loading) return <CollectionSkeleton />
  if (loadError) return <CollectionFailure message={loadError} onRetry={retry} />

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-accent-soft text-primary">
            <Files size={21} />
          </span>
          <div>
            <p className="text-sm font-medium">Teks yang siap dipakai lagi.</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              <span className="font-mono">{items.length}</span> snippet di perangkat ini
            </p>
          </div>
        </div>
        <Button variant="secondary" disabled={saving || openingTarget} onClick={newSnippet}>
          <Plus size={17} />
          Snippet baru
        </Button>
      </div>
      <div className="grid grid-cols-1 items-start gap-8 xl:grid-cols-[minmax(0,1.1fr)_minmax(300px,1fr)]">
        <section aria-label="Pustaka snippet" className="min-w-0 space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(120px,0.65fr)] xl:grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_minmax(120px,0.65fr)]">
            <div className="flex min-w-0 flex-col gap-2">
              <label htmlFor="snippet-search" className="field-label">
                Cari snippet
              </label>
              <div className="relative">
                <MagnifyingGlass
                  size={17}
                  className="pointer-events-none absolute top-3.5 left-4 text-muted-foreground"
                />
                <input
                  id="snippet-search"
                  type="search"
                  maxLength={200}
                  className="field pl-11"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Cari judul atau isi…"
                />
              </div>
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <label htmlFor="snippet-filter" className="field-label">
                Kategori
              </label>
              <select
                id="snippet-filter"
                className="field min-w-0"
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
              >
                <option value="">Semua kategori</option>
                {categories.map((value) => (
                  <option value={value} key={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <ErrorNotice message={copyError} />
          {visible.length ? (
            <div className="divide-y divide-border">
              {visible.map((item) => (
                <article
                  key={item.id}
                  className={cn(
                    'min-w-0 py-5',
                    editing === item.id && '-mx-3 rounded-2xl bg-accent-soft/50 px-3',
                  )}
                >
                  <div className="flex items-start gap-3">
                    <button
                      type="button"
                      className="min-w-0 flex-1 break-words text-left text-[13px] leading-6 font-medium hover:text-primary"
                      disabled={saving || openingTarget}
                      onClick={() => editSnippet(item)}
                    >
                      {item.title}
                    </button>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="size-8 px-0"
                        disabled={saving || openingTarget}
                        onClick={() => editSnippet(item)}
                        aria-label={`Edit snippet: ${item.title}`}
                      >
                        <PencilSimple size={15} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="size-8 px-0 hover:text-danger"
                        disabled={saving || openingTarget}
                        onClick={() => setDeleting(item)}
                        aria-label={`Hapus snippet: ${item.title}`}
                      >
                        <Trash size={15} />
                      </Button>
                    </div>
                  </div>
                  <pre className="mt-3 line-clamp-4 max-w-full overflow-hidden whitespace-pre-wrap break-words rounded-xl border border-border/70 bg-background px-3.5 py-3 font-mono text-[11px] leading-6 text-muted-foreground">
                    {item.content}
                  </pre>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                      <span className="max-w-full break-words rounded-md bg-muted px-2 py-1">
                        {item.category}
                      </span>
                      <span>{formatDate(item.updated_at)}</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void copySnippet(item)}
                      className={copied === item.id ? 'text-primary' : undefined}
                    >
                      {copied === item.id ? <Check size={14} /> : <Copy size={14} />}
                      {copied === item.id ? 'Tersalin' : 'Salin isi'}
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyCollection
              title={items.length ? 'Belum ada yang cocok.' : 'Simpan sekali. Pakai berkali-kali.'}
              description={
                items.length
                  ? 'Coba kata kunci atau kategori yang berbeda.'
                  : 'Siapkan template pesan, potongan perintah, atau checklist yang sering kamu ketik ulang.'
              }
            >
              {!items.length && (
                <Button variant="secondary" size="sm" onClick={newSnippet} disabled={openingTarget}>
                  <Plus size={15} />
                  Tulis snippet pertama
                </Button>
              )}
            </EmptyCollection>
          )}
        </section>
        <form
          onSubmit={(event) => void saveSnippet(event)}
          aria-label={editing === null ? 'Tambah snippet' : 'Edit snippet'}
          className="min-w-0 rounded-[28px] border border-border bg-background p-5 sm:p-6"
        >
          <div className="mb-6 flex items-center justify-between gap-3">
            <div>
              <p className="eyebrow mb-2">Pustaka kecilmu</p>
              <h3 className="text-base font-medium tracking-tight">
                {editing === null ? 'Snippet baru' : 'Edit snippet'}
              </h3>
            </div>
            {editing !== null && (
              <Button
                variant="ghost"
                size="icon"
                disabled={saving || openingTarget}
                onClick={resetEditor}
                aria-label="Batal edit snippet"
              >
                <X size={17} />
              </Button>
            )}
          </div>
          {openingTarget && (
            <p role="status" className="mb-4 text-xs text-muted-foreground">
              Memuat snippet terbaru…
            </p>
          )}
          <fieldset disabled={saving || openingTarget} className="min-w-0 space-y-5">
            <div className="flex flex-col gap-2">
              <label htmlFor="snippet-title" className="field-label">
                Judul snippet
              </label>
              <input
                ref={titleRef}
                id="snippet-title"
                className="field"
                required
                maxLength={120}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Nama yang mudah kamu temukan…"
              />
              <p className="text-[10px] text-muted-foreground">Maksimal 120 karakter.</p>
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="snippet-category" className="field-label">
                Kategori snippet
              </label>
              <input
                id="snippet-category"
                className="field"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                maxLength={40}
                list="snippet-categories"
                placeholder="Misalnya: Email atau Perintah"
              />
              <datalist id="snippet-categories">
                {categories.map((value) => (
                  <option key={value} value={value} />
                ))}
              </datalist>
              <p className="text-[10px] text-muted-foreground">
                Pilih kategori yang ada atau buat sendiri.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="snippet-content" className="field-label">
                Isi snippet
              </label>
              <textarea
                id="snippet-content"
                className="field min-h-56 font-mono text-[12px] leading-7"
                rows={10}
                value={content}
                onChange={(event) => setContent(event.target.value)}
                required
                maxLength={20000}
                spellCheck={false}
                placeholder="Tulis teks atau perintah yang ingin kamu simpan…"
              />
              <p className="font-mono text-[10px] text-muted-foreground">
                {content.length.toLocaleString('id-ID')} / 20.000 karakter
              </p>
            </div>
            <ErrorNotice message={formError} />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={!title.trim() || !content.trim()}>
                <Plus size={16} />
                {saving ? 'Menyimpan…' : editing === null ? 'Simpan snippet' : 'Simpan perubahan'}
              </Button>
              {editing !== null && (
                <Button variant="ghost" onClick={resetEditor}>
                  Batal
                </Button>
              )}
            </div>
          </fieldset>
          <p className="mt-5 text-[10px] leading-5 text-muted-foreground">
            Snippet disimpan sebagai teks biasa di perangkat ini. Perintah dan HTML tidak
            dijalankan.
          </p>
        </form>
      </div>
      {notice && (
        <p role="status" className="flex items-center gap-2 text-xs text-primary">
          <CheckCircle size={16} />
          {notice}
        </p>
      )}
      <DeleteConfirmation
        open={!!deleting}
        onOpenChange={(value) => {
          if (!value) setDeleting(null)
        }}
        noun="Snippet"
        onConfirm={deleteSnippet}
      />
    </div>
  )
}
