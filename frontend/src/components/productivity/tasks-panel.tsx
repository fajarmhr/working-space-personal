import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  CalendarBlank,
  Check,
  CheckCircle,
  Circle,
  Flag,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  Trash,
  X,
} from '@phosphor-icons/react'
import { api } from '../../lib/api'
import type { CreateTask, DailyTask, TaskPriority } from '../../lib/types'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import {
  CollectionFailure,
  CollectionSkeleton,
  DeleteConfirmation,
  EmptyCollection,
  ErrorNotice,
  errorMessage,
  focusEditor,
  formatDueDate,
  useCollection,
  workspaceToday,
} from './shared'

type TaskFilter = 'all' | 'today' | 'overdue' | 'completed'
const priorityLabels: Record<TaskPriority, string> = {
  high: 'Tinggi',
  normal: 'Normal',
  low: 'Rendah',
}
const priorityOrder: Record<TaskPriority, number> = { high: 0, normal: 1, low: 2 }

function sortTasks(tasks: DailyTask[]) {
  return [...tasks].sort(
    (left, right) =>
      Number(left.completed) - Number(right.completed) ||
      (left.due_date === null
        ? right.due_date === null
          ? 0
          : 1
        : right.due_date === null
          ? -1
          : left.due_date.localeCompare(right.due_date)) ||
      priorityOrder[left.priority] - priorityOrder[right.priority] ||
      right.created_at.localeCompare(left.created_at) ||
      right.id - left.id,
  )
}

export function DailyTasks({ onActivity }: { onActivity: (action: string) => void }) {
  const { items: tasks, setItems: setTasks, loading, loadError, retry } = useCollection(api.tasks)
  const [filter, setFilter] = useState<TaskFilter>('all')
  const [query, setQuery] = useState('')
  const [today, setToday] = useState(workspaceToday)
  const [editing, setEditing] = useState<number | null>(null)
  const [title, setTitle] = useState('')
  const [details, setDetails] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('normal')
  const [dueDate, setDueDate] = useState(workspaceToday)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [mutationError, setMutationError] = useState('')
  const [notice, setNotice] = useState('')
  const [pendingIds, setPendingIds] = useState<number[]>([])
  const [deleting, setDeleting] = useState<DailyTask | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const editorPending = editing !== null && pendingIds.includes(editing)

  useEffect(() => {
    const refresh = () => setToday(workspaceToday())
    const interval = setInterval(refresh, 60_000)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])

  const counts = useMemo(
    () => ({
      all: tasks.length,
      active: tasks.filter((task) => !task.completed).length,
      today: tasks.filter((task) => !task.completed && task.due_date === today).length,
      overdue: tasks.filter((task) => !task.completed && task.due_date && task.due_date < today)
        .length,
      completed: tasks.filter((task) => task.completed).length,
    }),
    [tasks, today],
  )
  const visibleTasks = useMemo(() => {
    const search = query.trim().toLocaleLowerCase('id')
    return sortTasks(
      tasks.filter((task) => {
        const matchesFilter =
          filter === 'all' ||
          (filter === 'today' && !task.completed && task.due_date === today) ||
          (filter === 'overdue' && !task.completed && !!task.due_date && task.due_date < today) ||
          (filter === 'completed' && task.completed)
        return (
          matchesFilter &&
          (!search || `${task.title}\n${task.details}`.toLocaleLowerCase('id').includes(search))
        )
      }),
    )
  }, [tasks, query, filter, today])

  function resetEditor() {
    setEditing(null)
    setTitle('')
    setDetails('')
    setPriority('normal')
    setDueDate(workspaceToday())
    setFormError('')
  }
  function newTask() {
    resetEditor()
    setNotice('')
    focusEditor(titleRef.current)
  }
  function editTask(task: DailyTask) {
    setEditing(task.id)
    setTitle(task.title)
    setDetails(task.details)
    setPriority(task.priority)
    setDueDate(task.due_date ?? '')
    setFormError('')
    setNotice('')
    focusEditor(titleRef.current)
  }
  async function saveTask(event: FormEvent) {
    event.preventDefault()
    if (saving || editorPending) return
    if (!title.trim()) {
      setFormError('Tulis judul tugas terlebih dahulu.')
      return
    }
    const payload: CreateTask = {
      title: title.trim(),
      details,
      priority,
      due_date: dueDate || null,
    }
    setSaving(true)
    setFormError('')
    setNotice('')
    try {
      const saved =
        editing === null ? await api.createTask(payload) : await api.updateTask(editing, payload)
      setTasks((previous) =>
        editing === null
          ? [saved, ...previous]
          : previous.map((task) => (task.id === saved.id ? saved : task)),
      )
      onActivity(editing === null ? 'Menambahkan tugas harian' : 'Memperbarui tugas harian')
      setNotice(editing === null ? 'Tugas ditambahkan ke workspace.' : 'Perubahan tugas tersimpan.')
      resetEditor()
      setFilter('all')
      setQuery('')
    } catch (caught) {
      setFormError(errorMessage(caught, 'Tugas belum tersimpan. Isianmu tetap ada.'))
    } finally {
      setSaving(false)
    }
  }
  async function toggleTask(task: DailyTask) {
    if (saving || pendingIds.includes(task.id)) return
    setPendingIds((previous) => [...previous, task.id])
    setMutationError('')
    try {
      const saved = await api.updateTask(task.id, { completed: !task.completed })
      setTasks((previous) => previous.map((item) => (item.id === saved.id ? saved : item)))
      onActivity(saved.completed ? 'Menyelesaikan tugas harian' : 'Membuka kembali tugas harian')
    } catch (caught) {
      setMutationError(errorMessage(caught, 'Status tugas belum berubah. Coba lagi.'))
    } finally {
      setPendingIds((previous) => previous.filter((id) => id !== task.id))
    }
  }
  async function deleteTask() {
    if (!deleting) return
    await api.deleteTask(deleting.id)
    setTasks((previous) => previous.filter((task) => task.id !== deleting.id))
    if (editing === deleting.id) resetEditor()
    onActivity('Menghapus tugas harian')
    setNotice('Tugas dihapus dari workspace.')
  }

  if (loading) return <CollectionSkeleton />
  if (loadError) return <CollectionFailure message={loadError} onRetry={retry} />

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-center justify-between gap-5 border-b border-border pb-6">
        <div className="flex items-center gap-6">
          <div>
            <p className="eyebrow mb-2">Masih terbuka</p>
            <p className="font-mono text-[28px] tracking-tight">
              {counts.active}
              <span className="ml-2 font-sans text-xs text-muted-foreground">tugas</span>
            </p>
          </div>
          <div className="border-l border-border pl-6">
            <p className="eyebrow mb-2">Sudah selesai</p>
            <p className="font-mono text-[28px] tracking-tight text-primary">{counts.completed}</p>
          </div>
        </div>
        <Button variant="secondary" onClick={newTask} disabled={saving}>
          <Plus size={17} />
          Tugas baru
        </Button>
      </div>
      <div className="grid grid-cols-1 items-start gap-8 xl:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.9fr)]">
        <section className="min-w-0 space-y-5" aria-label="Daftar tugas">
          <div className="flex flex-col gap-2">
            <label htmlFor="task-search" className="field-label">
              Cari tugas
            </label>
            <div className="relative">
              <MagnifyingGlass
                size={17}
                className="pointer-events-none absolute top-3.5 left-4 text-muted-foreground"
              />
              <input
                id="task-search"
                type="search"
                maxLength={200}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="field pl-11"
                placeholder="Cari judul atau rincian…"
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5" aria-label="Filter tugas">
            {(
              [
                { id: 'all', label: 'Semua' },
                { id: 'today', label: 'Hari ini' },
                { id: 'overdue', label: 'Terlewat' },
                { id: 'completed', label: 'Selesai' },
              ] as const
            ).map((item) => (
              <button
                type="button"
                key={item.id}
                aria-pressed={filter === item.id}
                onClick={() => setFilter(item.id)}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-3 py-2 text-[11px] transition-colors active:scale-[0.98]',
                  filter === item.id
                    ? 'bg-accent-soft font-medium text-primary'
                    : 'text-muted-foreground hover:bg-muted',
                )}
              >
                <span>{item.label}</span>
                <span className="font-mono text-[10px] opacity-65">{counts[item.id]}</span>
              </button>
            ))}
          </div>
          <ErrorNotice message={mutationError} />
          {visibleTasks.length ? (
            <div className="divide-y divide-border">
              {visibleTasks.map((task) => {
                const pending = pendingIds.includes(task.id)
                const overdue = !task.completed && !!task.due_date && task.due_date < today
                return (
                  <article
                    key={task.id}
                    className={cn('flex min-w-0 items-start gap-3.5 py-5', pending && 'opacity-60')}
                  >
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={task.completed}
                      aria-label={`${task.completed ? 'Buka kembali' : 'Selesaikan'} tugas: ${task.title}`}
                      onClick={() => void toggleTask(task)}
                      disabled={pending || saving}
                      className={cn(
                        'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg border transition-colors disabled:cursor-wait',
                        task.completed
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-surface text-muted-foreground hover:border-primary',
                      )}
                    >
                      {task.completed ? (
                        <Check size={14} weight="bold" />
                      ) : (
                        <Circle size={10} className="opacity-20" />
                      )}
                    </button>
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => editTask(task)}
                        disabled={pending || saving}
                        className={cn(
                          'block w-full break-words text-left text-[13px] leading-6 font-medium hover:text-primary',
                          task.completed && 'text-muted-foreground line-through',
                        )}
                      >
                        {task.title}
                      </button>
                      {task.details && (
                        <p className="mt-1 line-clamp-2 whitespace-pre-wrap break-words text-xs leading-6 text-muted-foreground">
                          {task.details}
                        </p>
                      )}
                      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 text-[10px]">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1.5',
                            task.priority === 'high' && !task.completed
                              ? 'text-primary'
                              : 'text-muted-foreground',
                          )}
                        >
                          <Flag size={12} weight={task.priority === 'high' ? 'fill' : 'regular'} />
                          {priorityLabels[task.priority]}
                        </span>
                        {task.due_date && (
                          <span
                            className={cn(
                              'inline-flex items-center gap-1.5',
                              overdue ? 'text-danger' : 'text-muted-foreground',
                            )}
                          >
                            <CalendarBlank size={12} />
                            {task.due_date === today ? 'Hari ini' : formatDueDate(task.due_date)}
                            {overdue && ' · terlewat'}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="size-8 px-0"
                        disabled={pending || saving}
                        onClick={() => editTask(task)}
                        aria-label={`Edit tugas: ${task.title}`}
                      >
                        <PencilSimple size={15} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="size-8 px-0 hover:text-danger"
                        disabled={pending || saving}
                        onClick={() => setDeleting(task)}
                        aria-label={`Hapus tugas: ${task.title}`}
                      >
                        <Trash size={15} />
                      </Button>
                    </div>
                  </article>
                )
              })}
            </div>
          ) : (
            <EmptyCollection
              title={tasks.length ? 'Belum ada yang cocok.' : 'Beri satu pekerjaan tempatnya.'}
              description={
                tasks.length
                  ? 'Coba kata kunci atau filter lain untuk melihat tugasmu.'
                  : 'Tulis tugas pertamamu, pilih prioritas, lalu tentukan kapan ingin menyelesaikannya.'
              }
            >
              {!tasks.length && (
                <Button variant="secondary" size="sm" onClick={newTask}>
                  <Plus size={15} />
                  Tulis tugas pertama
                </Button>
              )}
            </EmptyCollection>
          )}
          <p className="text-[10px] leading-5 text-muted-foreground">
            Filter hari ini mengikuti zona waktu Makassar (WITA).
          </p>
        </section>
        <form
          onSubmit={(event) => void saveTask(event)}
          className="min-w-0 rounded-[28px] border border-border bg-background p-5 sm:p-6"
          aria-label={editing === null ? 'Tambah tugas' : 'Edit tugas'}
        >
          <div className="mb-6 flex items-center justify-between gap-3">
            <div>
              <p className="eyebrow mb-2">Satu langkah berikutnya</p>
              <h3 className="text-base font-medium tracking-tight">
                {editing === null ? 'Tugas baru' : 'Edit tugas'}
              </h3>
            </div>
            {editing !== null && (
              <Button
                variant="ghost"
                size="icon"
                disabled={saving}
                onClick={resetEditor}
                aria-label="Batal edit tugas"
              >
                <X size={17} />
              </Button>
            )}
          </div>
          <fieldset disabled={saving || editorPending} className="min-w-0 space-y-5">
            <div className="flex flex-col gap-2">
              <label htmlFor="task-title" className="field-label">
                Judul tugas
              </label>
              <input
                ref={titleRef}
                id="task-title"
                className="field"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={180}
                required
                placeholder="Apa yang ingin kamu selesaikan?"
              />
              <p className="text-[10px] text-muted-foreground">Maksimal 180 karakter.</p>
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="task-details" className="field-label">
                Rincian
              </label>
              <textarea
                id="task-details"
                className="field min-h-28 text-xs leading-6"
                rows={4}
                value={details}
                onChange={(event) => setDetails(event.target.value)}
                maxLength={4000}
                placeholder="Langkah kecil, konteks, atau hal yang perlu diingat…"
              />
              <p className="text-[10px] text-muted-foreground">Opsional, hingga 4.000 karakter.</p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              <div className="flex min-w-0 flex-col gap-2">
                <label htmlFor="task-priority" className="field-label">
                  Prioritas
                </label>
                <select
                  id="task-priority"
                  className="field"
                  value={priority}
                  onChange={(event) => setPriority(event.target.value as TaskPriority)}
                >
                  <option value="low">Rendah</option>
                  <option value="normal">Normal</option>
                  <option value="high">Tinggi</option>
                </select>
              </div>
              <div className="flex min-w-0 flex-col gap-2">
                <label htmlFor="task-due" className="field-label">
                  Tenggat
                </label>
                <input
                  id="task-due"
                  type="date"
                  className="field min-w-0"
                  min="0001-01-01"
                  max="9999-12-31"
                  value={dueDate}
                  onChange={(event) => setDueDate(event.target.value)}
                />
                <p className="text-[10px] text-muted-foreground">Boleh dikosongkan.</p>
              </div>
            </div>
            <ErrorNotice message={formError} />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={!title.trim()}>
                <Plus size={16} />
                {saving ? 'Menyimpan…' : editing === null ? 'Tambah tugas' : 'Simpan perubahan'}
              </Button>
              {editing !== null && (
                <Button variant="ghost" onClick={resetEditor}>
                  Batal
                </Button>
              )}
            </div>
          </fieldset>
          <p className="mt-5 text-[10px] leading-5 text-muted-foreground">
            Judul dan rincian disimpan di perangkat ini setelah kamu menekan tombol simpan.
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
        noun="Tugas"
        onConfirm={deleteTask}
      />
    </div>
  )
}
