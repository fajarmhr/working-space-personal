import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from 'react'
import { AnimatePresence, motion, MotionConfig, useReducedMotion } from 'framer-motion'
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  ArrowsLeftRight,
  BracketsCurly,
  ChartLine,
  CalendarBlank,
  Camera,
  CaretRight,
  Check,
  ClockCounterClockwise,
  Command,
  Desktop,
  FileCsv,
  FileCode,
  FilePdf,
  Fingerprint,
  GitDiff,
  House,
  IconContext,
  IdentificationCard,
  ImageSquare,
  LinkSimple,
  List,
  ListChecks,
  LockKey,
  MagnifyingGlass,
  Moon,
  NotePencil,
  Play,
  ShieldCheck,
  SlidersHorizontal,
  SquaresFour,
  Star,
  StackSimple,
  Sun,
  TextT,
  Timer,
  Trash,
  WarningCircle,
  X,
  type Icon as PhosphorIcon,
} from '@phosphor-icons/react'
import { api } from './lib/api'
import {
  categoryLabels,
  toolLabels,
  type Activity,
  type Bootstrap,
  type Category,
  type Page,
  type Preferences,
  type SearchItem,
  type SearchTarget,
  type Theme,
  type Tool,
  type ToolId,
  type WorkspaceId,
} from './lib/types'
import { cn, formatDate } from './lib/utils'
import { Button } from './components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './components/ui/dialog'
import { MagneticButton, Orbit, StatusPulse } from './components/motion'
import { CommandPalette } from './components/global-search'
import { contentHash, readContentTarget } from './lib/global-search'
const LazyToolPanel = lazy(() =>
  import('./components/tool-panels').then((module) => ({ default: module.ToolPanel })),
)
const LazyProductivityPanel = lazy(() =>
  import('./components/productivity-panels').then((module) => ({
    default: module.ProductivityPanel,
  })),
)
const LazyDailyUtilityPanel = lazy(() =>
  import('./components/daily-utilities').then((module) => ({ default: module.DailyUtilityPanel })),
)
const LazyImageTools = lazy(() => import('./components/image-tools'))
const LazyTextCompare = lazy(() => import('./components/text-compare'))
const LazyPdfConverter = lazy(() => import('./components/pdf-converter'))
const LazyPdfImages = lazy(() => import('./components/pdf-images'))
const LazyCaptureStudio = lazy(() => import('./components/capture-studio'))
const LazyHuaweiLld = lazy(() => import('./components/huawei-lld'))
const LazyHuaweiReporting = lazy(() => import('./components/huawei-reporting'))

function ToolPanel(
  props: ComponentProps<typeof LazyToolPanel> & { requestedItem: SearchTarget | null },
) {
  let content
  switch (props.id) {
    case 'daily-tasks':
    case 'snippets':
      content = (
        <LazyProductivityPanel
          id={props.id}
          onActivity={props.onActivity}
          requestedItem={props.requestedItem}
        />
      )
      break
    case 'csv-json':
    case 'date-time':
    case 'url-tools':
    case 'uuid-generator':
    case 'file-hash':
      content = <LazyDailyUtilityPanel id={props.id} onActivity={props.onActivity} />
      break
    case 'text-diff':
      content = <LazyTextCompare onActivity={props.onActivity} />
      break
    case 'image-tools':
      content = <LazyImageTools onActivity={props.onActivity} />
      break
    case 'pdf-to-docx':
      content = <LazyPdfConverter onActivity={props.onActivity} />
      break
    case 'pdf-to-images':
      content = <LazyPdfImages onActivity={props.onActivity} />
      break
    case 'capture-studio':
      content = <LazyCaptureStudio onActivity={props.onActivity} />
      break
    case 'huawei-lld':
      content = <LazyHuaweiLld onActivity={props.onActivity} />
      break
    case 'huawei-reporting':
      content = <LazyHuaweiReporting onActivity={props.onActivity} />
      break
    default:
      content = <LazyToolPanel {...props} />
  }
  return (
    <Suspense
      fallback={
        <div
          role="status"
          aria-label="Memuat alat"
          className="grid grid-cols-1 min-h-80 gap-6 sm:grid-cols-2"
        >
          <div className="skeleton min-h-72" />
          <div className="skeleton min-h-72" />
        </div>
      }
    >
      {content}
    </Suspense>
  )
}

const icons: Record<ToolId, PhosphorIcon> = {
  'json-formatter': BracketsCurly,
  'text-case': TextT,
  base64: ArrowsLeftRight,
  'password-generator': LockKey,
  'focus-timer': Timer,
  'quick-note': NotePencil,
  'daily-tasks': ListChecks,
  snippets: StackSimple,
  'csv-json': FileCsv,
  'text-diff': GitDiff,
  'date-time': CalendarBlank,
  'url-tools': LinkSimple,
  'uuid-generator': IdentificationCard,
  'file-hash': Fingerprint,
  'image-tools': ImageSquare,
  'pdf-to-docx': FilePdf,
  'pdf-to-images': ImageSquare,
  'capture-studio': Camera,
  'huawei-lld': FileCode,
  'huawei-reporting': ChartLine,
}
function isHuaweiTool(page: string) {
  return page === 'huawei-lld' || page === 'huawei-reporting'
}
const huaweiSharedTools = new Set<ToolId>([
  'huawei-lld',
  'huawei-reporting',
  'text-diff',
  'snippets',
  'daily-tasks',
  'quick-note',
  'capture-studio',
  'file-hash',
  'csv-json',
  'date-time',
  'pdf-to-images',
])
const navItems: { id: Page; label: string; icon: PhosphorIcon }[] = [
  { id: 'home', label: 'Beranda', icon: House },
  { id: 'daily-tasks', label: 'Tugas harian', icon: ListChecks },
  { id: 'tools', label: 'Semua alat', icon: SquaresFour },
  { id: 'favorites', label: 'Favorit', icon: Star },
  { id: 'activity', label: 'Aktivitas', icon: ClockCounterClockwise },
]
const validPages = new Set<string>([
  'home',
  'tools',
  'favorites',
  'activity',
  'settings',
  ...Object.keys(toolLabels),
])

function readPage(): Page {
  const hash = window.location.hash.slice(1).replace(/^\//, '').split('?')[0]
  return validPages.has(hash) ? (hash as Page) : 'home'
}

function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'relative inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground',
        className,
      )}
      aria-hidden="true"
    >
      <span className="absolute top-[9px] left-[9px] h-[18px] w-[7px] rounded-[2px] border-[1.5px] border-current" />
      <span className="absolute top-[9px] right-[9px] size-[7px] rounded-[2px] bg-current" />
      <span className="absolute right-[9px] bottom-[9px] size-[7px] rounded-[2px] border-[1.5px] border-current" />
    </span>
  )
}

function Sidebar({
  page,
  navigate,
  tools,
  displayName,
  onSearch,
  workspace,
  huaweiEnabled,
  onWorkspaceChange,
  workspaceChanging,
  mobile = false,
}: {
  page: Page
  navigate: (page: Page) => void
  tools: Tool[]
  displayName: string
  onSearch: () => void
  workspace: WorkspaceId
  huaweiEnabled: boolean
  onWorkspaceChange: (workspace: WorkspaceId) => void
  workspaceChanging: boolean
  mobile?: boolean
}) {
  const favorites = tools.filter((tool) => tool.favorite)
  return (
    <aside
      className={cn(
        'flex h-full flex-col bg-surface',
        !mobile && 'fixed inset-y-0 left-0 z-20 hidden w-[224px] border-r border-border md:flex',
      )}
    >
      <button
        type="button"
        onClick={() => navigate('home')}
        aria-label="Ruang, kembali ke beranda"
        className="flex h-[94px] items-center gap-3 px-7 text-left"
      >
        <BrandMark />
        <span className="text-[23px] font-semibold tracking-[-0.065em]">
          ruang<span className="text-primary">.</span>
        </span>
      </button>
      <div className="flex flex-1 flex-col overflow-y-auto px-4 pb-5">
        {huaweiEnabled ? (
          <div className="px-3 pt-3 pb-5">
            <label
              htmlFor={mobile ? 'mobile-workspace' : 'workspace'}
              className="eyebrow mb-2 block"
            >
              Workspace
            </label>
            <select
              id={mobile ? 'mobile-workspace' : 'workspace'}
              className="field min-w-0 py-2.5 text-xs"
              value={workspace}
              disabled={workspaceChanging}
              onChange={(event) => onWorkspaceChange(event.target.value as WorkspaceId)}
            >
              <option value="personal">Ruang personal</option>
              <option value="huawei">Huawei personal</option>
            </select>
          </div>
        ) : (
          <p className="eyebrow mb-4 px-3 pt-4">Workspace</p>
        )}
        <nav aria-label="Navigasi utama" className="space-y-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => navigate(item.id)}
              aria-current={page === item.id ? 'page' : undefined}
              className={cn(
                'relative flex h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[13px] transition-colors',
                page === item.id
                  ? 'text-primary'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              )}
            >
              {page === item.id && (
                <motion.span
                  layoutId={mobile ? 'mobile-nav' : 'sidebar-nav'}
                  className="absolute inset-0 rounded-xl bg-accent-soft"
                  transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                />
              )}
              <item.icon size={19} className="relative" />
              <span className="relative">{item.label}</span>
              {item.id === 'tools' && (
                <span className="relative ml-auto font-mono text-[10px] opacity-55">
                  {tools.length.toString().padStart(2, '0')}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="mt-9 border-t border-border pt-6">
          <div className="mb-4 flex items-center justify-between px-3">
            <p className="eyebrow">Disematkan</p>
            <Star size={12} className="text-muted-foreground/55" />
          </div>
          {favorites.length ? (
            <div className="space-y-1">
              {favorites.map((tool) => {
                const Icon = icons[tool.id]
                return (
                  <button
                    type="button"
                    key={tool.id}
                    onClick={() => navigate(tool.id)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs transition-colors hover:bg-muted',
                      page === tool.id ? 'bg-muted text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    <Icon size={17} />
                    <span>{toolLabels[tool.id].title}</span>
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="px-3 text-xs leading-6 text-muted-foreground">
              Tandai alat favoritmu untuk akses lebih cepat.
            </p>
          )}
        </div>
        <div className="mt-auto pt-10">
          <button
            type="button"
            onClick={onSearch}
            className="mb-5 flex w-full items-center gap-2.5 rounded-xl border border-dashed border-border px-3 py-3 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            <Command size={16} />
            <span>Cari lebih cepat</span>
            <span className="keyboard ml-auto">K</span>
          </button>
          <button
            type="button"
            onClick={() => navigate('settings')}
            aria-current={page === 'settings' ? 'page' : undefined}
            className={cn(
              'flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-xs transition-colors hover:bg-muted',
              page === 'settings' ? 'bg-accent-soft text-primary' : 'text-muted-foreground',
            )}
          >
            <SlidersHorizontal size={18} />
            Pengaturan
          </button>
        </div>
      </div>
      <div className="flex items-center gap-3 border-t border-border px-6 py-5">
        <span className="flex size-9 items-center justify-center rounded-full border border-primary/15 bg-accent-soft text-[13px] font-medium text-primary">
          {displayName.trim() ? displayName.trim().slice(0, 1).toLocaleUpperCase('id') : 'R'}
        </span>
        <div className="min-w-0">
          <p className="truncate text-xs font-medium">{displayName || 'Ruang personal'}</p>
          <p className="mt-1 text-[10px] text-muted-foreground">Milikmu, di perangkatmu.</p>
        </div>
      </div>
    </aside>
  )
}

function ToolRow({
  tool,
  navigate,
  onFavorite,
  pending,
}: {
  tool: Tool
  navigate: (page: Page) => void
  onFavorite: (tool: Tool) => void
  pending: boolean
}) {
  const Icon = icons[tool.id]
  return (
    <motion.div
      layout
      className="group flex min-w-0 items-center gap-3.5 border-b border-border py-5"
      transition={{ type: 'spring', stiffness: 100, damping: 20 }}
    >
      <button
        type="button"
        onClick={() => navigate(tool.id)}
        className="flex min-w-0 flex-1 items-center gap-3.5 text-left"
      >
        <span className="flex size-11 shrink-0 items-center justify-center rounded-[15px] border border-border bg-surface transition-[transform,border-color] group-hover:-translate-y-0.5 group-hover:border-primary/25">
          <Icon size={21} className="text-foreground/80" />
        </span>
        <span className="min-w-0">
          <span className="block text-[13px] font-medium transition-colors group-hover:text-primary">
            {toolLabels[tool.id].title}
          </span>
          <span className="mt-1 block text-[11px] leading-5 text-muted-foreground">
            {toolLabels[tool.id].description}
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={() => onFavorite(tool)}
        disabled={pending}
        aria-label={`${tool.favorite ? 'Hapus' : 'Tambahkan'} ${toolLabels[tool.id].title} ${tool.favorite ? 'dari' : 'ke'} favorit`}
        aria-pressed={tool.favorite}
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-muted disabled:opacity-40',
          tool.favorite ? 'text-primary' : 'text-muted-foreground/45 hover:text-primary',
        )}
      >
        <Star size={16} weight={tool.favorite ? 'fill' : 'regular'} />
      </button>
      <button
        type="button"
        aria-label={`Buka ${toolLabels[tool.id].title}`}
        onClick={() => navigate(tool.id)}
        className="flex size-7 shrink-0 items-center justify-center text-muted-foreground/45 transition-[color,transform] group-hover:translate-x-0.5 group-hover:text-primary"
      >
        <ArrowUpRight size={17} />
      </button>
    </motion.div>
  )
}

function FeaturedTools({
  navigate,
  focusMinutes,
  note,
}: {
  navigate: (page: Page) => void
  focusMinutes: number
  note: string
}) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.45fr_1fr]">
      <div className="min-w-0">
        <button
          type="button"
          onClick={() => navigate('json-formatter')}
          className="group relative flex h-[250px] w-full overflow-hidden rounded-[2.5rem] bg-[#25312e] p-7 text-left text-[#dce8e2] outline-none transition-transform active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 sm:p-8"
        >
          <span className="absolute top-6 right-6 flex size-9 items-center justify-center rounded-full border border-white/15 text-white/75 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5">
            <ArrowUpRight size={17} />
          </span>
          <span className="relative flex h-full w-full flex-col">
            <span className="mb-6 inline-flex items-center gap-2 text-[10px] tracking-[0.12em] text-white/45 uppercase">
              <BracketsCurly size={15} />
              Sedikit lebih terstruktur
            </span>
            <span
              aria-hidden="true"
              className="block font-mono text-[12px] leading-[26px] sm:text-[13px]"
            >
              <span className="text-[#9cafaa]">{'{'}</span>
              <br />
              <span className="ml-5 text-[#91c6ad]">"workspace"</span>
              <span className="text-[#9cafaa]">: </span>
              <span className="text-[#dbe7df]">"ruang"</span>
              <span className="text-[#9cafaa]">,</span>
              <br />
              <span className="ml-5 text-[#91c6ad]">"semua_tertata"</span>
              <span className="text-[#9cafaa]">: </span>
              <span className="text-[#c0d6cc]">true</span>
              <br />
              <span className="text-[#9cafaa]">{'}'}</span>
            </span>
            <span className="mt-auto flex items-center gap-2 pt-3 text-[10px] text-white/40">
              <span className="size-1 rounded-full bg-[#91c6ad]" />
              CONTOH JSON<span className="ml-auto font-mono text-white/25">UTF-8</span>
            </span>
          </span>
          <span
            className="pointer-events-none absolute -right-14 bottom-5 font-mono text-[190px] leading-none font-extralight tracking-[-0.15em] text-white/[0.035]"
            aria-hidden="true"
          >
            {'{}'}
          </span>
        </button>
        <div className="flex items-start justify-between px-2 pt-4">
          <div>
            <button
              type="button"
              onClick={() => navigate('json-formatter')}
              className="text-[14px] font-medium hover:text-primary"
            >
              JSON formatter
            </button>
            <p className="mt-1.5 text-xs text-muted-foreground">Data rapi. Pikiran lebih lapang.</p>
          </div>
          <span className="rounded-full border border-border px-2.5 py-1 text-[9px] text-muted-foreground">
            Developer
          </span>
        </div>
      </div>
      <div className="min-w-0">
        <button
          type="button"
          onClick={() => navigate('focus-timer')}
          className="surface group relative flex h-[250px] w-full flex-col overflow-hidden p-7 text-left outline-none transition-transform active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 sm:p-8"
        >
          <Orbit />
          <span className="eyebrow relative flex items-center gap-2">
            <Timer size={15} />
            Waktunya satu hal
          </span>
          <span className="relative mt-7 flex items-baseline gap-1 font-mono text-[54px] leading-none font-normal tracking-[-0.08em] text-foreground">
            {String(focusMinutes).padStart(2, '0')}
            <span className="text-muted-foreground/40">:</span>00
            <span className="ml-2 text-[10px] tracking-normal text-muted-foreground">menit</span>
          </span>
          <span className="relative mt-auto flex items-center gap-2 pt-5 text-xs text-primary">
            <span className="flex size-8 items-center justify-center rounded-full bg-accent-soft transition-transform group-hover:scale-110">
              <Play size={12} weight="fill" />
            </span>
            Siapkan sesi fokus
            <span className="ml-auto flex size-8 items-center justify-center rounded-full border border-border transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5">
              <ArrowUpRight size={15} />
            </span>
          </span>
        </button>
        <div className="flex items-start justify-between px-2 pt-4">
          <div>
            <button
              type="button"
              onClick={() => navigate('focus-timer')}
              className="text-[14px] font-medium hover:text-primary"
            >
              Timer fokus
            </button>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Kerjakan yang penting, beri jeda.
            </p>
          </div>
          <span className="rounded-full border border-border px-2.5 py-1 text-[9px] text-muted-foreground">
            Produktivitas
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={() => navigate('daily-tasks')}
        className="group flex min-w-0 items-center gap-4 rounded-2xl border border-primary/15 bg-accent-soft px-5 py-4 text-left transition-transform active:scale-[0.995]"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface text-primary">
          <ListChecks size={21} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium">Apa yang ingin diselesaikan hari ini?</span>
          <span className="mt-1 block text-[11px] leading-5 text-muted-foreground">
            Susun tugas, pilih prioritas, beri satu langkah ruang.
          </span>
        </span>
        <ArrowUpRight
          size={17}
          className="shrink-0 text-primary transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
        />
      </button>
      <button
        type="button"
        onClick={() => navigate('quick-note')}
        className="group flex min-w-0 items-center gap-4 rounded-2xl border border-border/80 bg-surface px-5 py-4 text-left transition-[border-color,transform] hover:border-primary/30 active:scale-[0.995]"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-primary">
          <NotePencil size={21} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium">Ada ide yang ingin disimpan?</span>
          <span className="mt-1 block truncate text-[11px] text-muted-foreground">
            {note.trim()
              ? note.trim().split('\n')[0]
              : 'Buka catatan kecilmu. Tulis dulu, rapikan nanti.'}
          </span>
        </span>
        <ArrowRight
          size={17}
          className="shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1"
        />
      </button>
    </div>
  )
}

function EmptyState({
  title,
  description,
  icon: Icon = SquaresFour,
  children,
}: {
  title: string
  description: string
  icon?: PhosphorIcon
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center rounded-[28px] border border-dashed border-border px-6 py-14 text-center">
      <span className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-muted">
        <Icon size={25} className="text-muted-foreground" />
      </span>
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="mt-2 max-w-72 text-xs leading-6 text-muted-foreground">{description}</p>
      {children && <div className="mt-5">{children}</div>}
    </div>
  )
}

function ToolList({
  tools,
  navigate,
  onFavorite,
  pendingFavorites,
  initialCategory = 'all',
  title = 'Alat sehari-hari',
  showSearch = false,
}: {
  tools: Tool[]
  navigate: (page: Page) => void
  onFavorite: (tool: Tool) => void
  pendingFavorites: ToolId[]
  initialCategory?: Category | 'all'
  title?: string
  showSearch?: boolean
}) {
  const [category, setCategory] = useState<Category | 'all'>(initialCategory)
  const [search, setSearch] = useState('')
  const categories: (Category | 'all')[] = [
    'all',
    'developer',
    'productivity',
    'writing',
    'files',
    'security',
  ]
  const visible = tools.filter(
    (tool) =>
      (category === 'all' || tool.category === category) &&
      `${toolLabels[tool.id].title} ${toolLabels[tool.id].description}`
        .toLocaleLowerCase('id')
        .includes(search.toLocaleLowerCase('id')),
  )
  return (
    <section>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="eyebrow mb-2">Toolbox</div>
          <h2 className="text-xl font-medium tracking-tight">
            {title}
            <span className="ml-3 align-middle font-mono text-[11px] text-muted-foreground">
              {tools.length.toString().padStart(2, '0')}
            </span>
          </h2>
        </div>
        {!showSearch && (
          <button
            type="button"
            onClick={() => navigate('tools')}
            className="inline-flex items-center gap-2 text-[11px] text-muted-foreground transition-colors hover:text-primary"
          >
            Lihat semua alat
            <ArrowRight size={14} />
          </button>
        )}
      </div>
      {showSearch && (
        <label className="mb-5 flex items-center gap-3 rounded-xl border border-border bg-surface px-4">
          <MagnifyingGlass size={18} className="text-muted-foreground" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari alat yang kamu perlukan…"
            aria-label="Cari alat"
            className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </label>
      )}
      <div className="mb-1 flex flex-wrap gap-1.5" aria-label="Kategori alat">
        {categories.map((item) => (
          <button
            type="button"
            key={item}
            onClick={() => setCategory(item)}
            aria-pressed={category === item}
            className={cn(
              'relative rounded-lg px-3 py-2 text-[10px] font-medium transition-colors',
              category === item ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {category === item && (
              <motion.span
                layoutId={`filter-${title}`}
                className="absolute inset-0 rounded-lg bg-accent-soft"
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              />
            )}
            <span className="relative">{item === 'all' ? 'Semua' : categoryLabels[item]}</span>
          </button>
        ))}
      </div>
      {visible.length ? (
        <motion.div layout className="grid grid-cols-1 gap-x-9 lg:grid-cols-2">
          <AnimatePresence initial={false}>
            {visible.map((tool) => (
              <ToolRow
                key={tool.id}
                tool={tool}
                navigate={navigate}
                onFavorite={onFavorite}
                pending={pendingFavorites.includes(tool.id)}
              />
            ))}
          </AnimatePresence>
        </motion.div>
      ) : (
        <div className="mt-6">
          <EmptyState
            title="Belum ada yang cocok."
            description="Coba kata kunci lain atau pilih kategori yang berbeda."
            icon={MagnifyingGlass}
          />
        </div>
      )}
    </section>
  )
}

function ActivityList({
  recent,
  navigate,
  onClear,
  huaweiEnabled,
}: {
  recent: Activity[]
  navigate: (page: Page) => void
  onClear: () => Promise<void>
  huaweiEnabled: boolean
}) {
  const [confirm, setConfirm] = useState(false)
  const [clearing, setClearing] = useState(false)
  return (
    <>
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow mb-3">Jejak kecil</p>
          <h1 className="text-[32px] font-medium tracking-[-0.05em]">Aktivitasmu.</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Riwayat penggunaan alat. Isi pekerjaanmu tidak dicatat di sini.
          </p>
          {(huaweiEnabled || recent.some((item) => isHuaweiTool(item.tool_id))) && (
            <p className="mt-2 text-xs leading-6 text-muted-foreground">
              Riwayat Ruang personal dan Huawei digunakan bersama.
            </p>
          )}
        </div>
        {recent.length > 0 && (
          <Button variant="secondary" size="sm" onClick={() => setConfirm(true)}>
            <Trash size={15} />
            Bersihkan
          </Button>
        )}
      </div>
      {recent.length ? (
        <div className="surface px-5 py-2 sm:px-8">
          {recent.map((item) => {
            const Icon = icons[item.tool_id]
            return (
              <button
                type="button"
                key={item.id}
                onClick={() =>
                  navigate(isHuaweiTool(item.tool_id) && !huaweiEnabled ? 'settings' : item.tool_id)
                }
                className="group flex w-full items-center gap-4 border-b border-border py-5 text-left last:border-0"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted">
                  <Icon size={19} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium">{item.action}</span>
                  <span className="mt-1 block text-[11px] text-muted-foreground">
                    {toolLabels[item.tool_id].title}
                    {isHuaweiTool(item.tool_id) && !huaweiEnabled && ' · Aktifkan di Pengaturan'}
                  </span>
                </span>
                <span className="hidden font-mono text-[10px] text-muted-foreground sm:block">
                  {formatDate(item.created_at)}
                </span>
                <CaretRight
                  size={15}
                  className="text-muted-foreground/50 group-hover:text-primary"
                />
              </button>
            )
          })}
        </div>
      ) : (
        <EmptyState
          title="Halaman baru, jejak baru."
          description="Mulai gunakan salah satu alat. Aktivitasmu akan tersimpan di sini, tanpa menyimpan isi pekerjaanmu."
          icon={ClockCounterClockwise}
        >
          <Button variant="secondary" onClick={() => navigate('tools')}>
            Jelajahi alat
            <ArrowRight size={15} />
          </Button>
        </EmptyState>
      )}
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogTitle className="pr-8 text-lg font-medium tracking-tight">
            Bersihkan riwayat aktivitas?
          </DialogTitle>
          <DialogDescription className="mt-3 text-sm leading-7 text-muted-foreground">
            Seluruh riwayat penggunaan alat akan dihapus, termasuk riwayat Huawei. Catatan dan
            pengaturan tetap tersimpan. Riwayat yang dihapus tidak dapat dikembalikan.
          </DialogDescription>
          <div className="mt-7 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirm(false)}>
              Batal
            </Button>
            <Button
              variant="danger"
              disabled={clearing}
              onClick={() => {
                setClearing(true)
                void onClear()
                  .then(() => setConfirm(false))
                  .catch(() => undefined)
                  .finally(() => setClearing(false))
              }}
            >
              {clearing ? 'Menghapus…' : 'Hapus riwayat'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function HuaweiHome({
  tools,
  navigate,
  onFavorite,
  pendingFavorites,
}: {
  tools: Tool[]
  navigate: (page: Page) => void
  onFavorite: (tool: Tool) => void
  pendingFavorites: ToolId[]
}) {
  return (
    <>
      <p className="eyebrow mb-3">Huawei personal</p>
      <h1 className="text-[34px] leading-[1.16] font-medium tracking-[-0.055em] sm:text-[40px]">
        Siapkan perubahan dengan rapi<span className="text-primary">.</span>
      </h1>
      <p className="mt-3 max-w-xl text-[13px] leading-7 text-muted-foreground">
        LLD, template script, dan alat pendukung pekerjaan teknis dalam satu tempat lokal.
      </p>
      <section className="mt-9 grid grid-cols-1 overflow-hidden rounded-[28px] border border-border bg-surface lg:grid-cols-[1.3fr_1fr]">
        <div className="flex flex-col items-start bg-accent-soft p-6 sm:p-9">
          <FileCode size={28} className="text-primary" />
          <p className="eyebrow mt-8 text-primary">LLD Script Builder</p>
          <h2 className="mt-3 max-w-sm text-2xl font-medium leading-snug tracking-tight">
            Dari workbook ke paket script kerja.
          </h2>
          <p className="mt-4 max-w-md text-sm leading-7 text-muted-foreground">
            Unggah XLSX, periksa sheet dan pemetaan data, lalu susun hasil sesuai template. Pilih
            unduhan .txt atau .ini.
          </p>
          <Button className="mt-7" onClick={() => navigate('huawei-lld')}>
            <FileCode size={17} />
            Buka script builder
            <ArrowRight size={16} />
          </Button>
        </div>
        <div className="divide-y divide-border px-6 py-3 sm:px-9 sm:py-4">
          {[
            ['01', 'Preparation', 'Persiapan dan pemeriksaan sebelum perubahan.'],
            ['02', 'Execution', 'Urutan script yang saling bergantung.'],
            ['03', 'Verification', 'Pemeriksaan hasil setelah perubahan.'],
            ['04', 'Rollback', 'Langkah pemulihan sesuai template dan baseline.'],
          ].map(([number, title, description]) => (
            <div key={number} className="flex gap-4 py-5">
              <span className="pt-0.5 font-mono text-[11px] text-primary/65">{number}</span>
              <div>
                <h3 className="text-sm font-medium">{title}</h3>
                <p className="mt-1.5 text-xs leading-6 text-muted-foreground">{description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
      <div className="mt-10">
        <ToolList
          title="Alat pendukung"
          tools={tools.filter((tool) => tool.id !== 'huawei-lld')}
          navigate={navigate}
          onFavorite={onFavorite}
          pendingFavorites={pendingFavorites}
        />
      </div>
      <p className="mt-6 text-xs leading-6 text-muted-foreground">
        Catatan, tugas, snippet, favorit, dan riwayat digunakan bersama Ruang personal.
      </p>
    </>
  )
}

function Settings({
  preferences,
  onSave,
}: {
  preferences: Preferences
  onSave: (values: Partial<Preferences>) => Promise<void>
}) {
  const [name, setName] = useState(preferences.display_name)
  const [theme, setTheme] = useState<Theme>(preferences.theme)
  const [focusMinutes, setFocusMinutes] = useState(String(preferences.focus_minutes))
  const [breakMinutes, setBreakMinutes] = useState(String(preferences.break_minutes))
  const [huaweiEnabled, setHuaweiEnabled] = useState(preferences.huawei_enabled)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const dirty =
    name !== preferences.display_name ||
    theme !== preferences.theme ||
    Number(focusMinutes) !== preferences.focus_minutes ||
    Number(breakMinutes) !== preferences.break_minutes ||
    huaweiEnabled !== preferences.huawei_enabled
  function submit(event: React.FormEvent) {
    event.preventDefault()
    const focus = Number(focusMinutes)
    const pause = Number(breakMinutes)
    if (
      !Number.isInteger(focus) ||
      focus < 1 ||
      focus > 180 ||
      !Number.isInteger(pause) ||
      pause < 1 ||
      pause > 60
    ) {
      setError('Durasi fokus 1–180 menit dan istirahat 1–60 menit, dalam bilangan bulat.')
      return
    }
    setSaving(true)
    setError('')
    const changes: Partial<Preferences> = {}
    if (name.trim() !== preferences.display_name) changes.display_name = name.trim()
    if (theme !== preferences.theme) changes.theme = theme
    if (focus !== preferences.focus_minutes) changes.focus_minutes = focus
    if (pause !== preferences.break_minutes) changes.break_minutes = pause
    if (huaweiEnabled !== preferences.huawei_enabled) changes.huawei_enabled = huaweiEnabled
    void onSave(changes)
      .then(() => {
        setName(name.trim())
        setSaved(true)
      })
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : 'Pengaturan belum tersimpan.'),
      )
      .finally(() => setSaving(false))
  }
  return (
    <>
      <p className="eyebrow mb-3">Sesuai caramu</p>
      <h1 className="text-[32px] font-medium tracking-[-0.05em]">Ruang yang terasa milikmu.</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Sedikit penyesuaian untuk hari yang lebih nyaman.
      </p>
      <form onSubmit={submit} className="surface mt-9 max-w-3xl p-6 sm:p-9">
        <fieldset disabled={saving} className="min-w-0">
          <section className="grid grid-cols-1 gap-6 border-b border-border pb-8 sm:grid-cols-[0.7fr_1fr]">
            <div>
              <h2 className="text-sm font-medium">Sapaan personal</h2>
              <p className="mt-2 text-xs leading-6 text-muted-foreground">
                Nama yang muncul di workspace.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="display-name" className="field-label">
                Nama panggilan
              </label>
              <input
                id="display-name"
                className="field"
                value={name}
                maxLength={60}
                onChange={(e) => {
                  setName(e.target.value)
                  setSaved(false)
                }}
                placeholder="Kamu ingin dipanggil apa?"
                autoComplete="nickname"
              />
              <p className="text-[11px] leading-5 text-muted-foreground">
                Opsional. Tersimpan di perangkat ini.
              </p>
            </div>
          </section>
          <section className="grid grid-cols-1 gap-6 border-b border-border py-8 sm:grid-cols-[0.7fr_1fr]">
            <div>
              <h2 className="text-sm font-medium">Tampilan</h2>
              <p className="mt-2 text-xs leading-6 text-muted-foreground">
                Pilih cahaya yang nyaman.
              </p>
            </div>
            <fieldset>
              <legend className="field-label mb-3">Tema workspace</legend>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { value: 'light', label: 'Terang', icon: Sun },
                    { value: 'dark', label: 'Gelap', icon: Moon },
                    { value: 'system', label: 'Sistem', icon: Desktop },
                  ] as const
                ).map((item) => (
                  <label
                    key={item.value}
                    className={cn(
                      'flex cursor-pointer flex-col items-center gap-3 rounded-2xl border px-3 py-4 text-xs transition-colors',
                      theme === item.value
                        ? 'border-primary bg-accent-soft text-primary'
                        : 'border-border text-muted-foreground hover:bg-muted',
                    )}
                  >
                    <input
                      type="radio"
                      name="theme"
                      value={item.value}
                      checked={theme === item.value}
                      onChange={() => {
                        setTheme(item.value)
                        setSaved(false)
                      }}
                      className="sr-only"
                    />
                    <item.icon size={22} />
                    <span>{item.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </section>
          <section className="grid grid-cols-1 gap-6 border-b border-border py-8 sm:grid-cols-[0.7fr_1fr]">
            <div>
              <h2 className="text-sm font-medium">Huawei workspace</h2>
              <p className="mt-2 text-xs leading-6 text-muted-foreground">
                Ruang opsional untuk pekerjaan teknis sehari-hari.
              </p>
            </div>
            <div>
              <label className="flex cursor-pointer items-start justify-between gap-5 rounded-2xl border border-border px-4 py-4">
                <span>
                  <span className="block text-sm font-medium">Aktifkan Huawei personal</span>
                  <span className="mt-2 block text-xs leading-6 text-muted-foreground">
                    Tampilkan pilihan workspace, LLD Script Builder, dan KPI Reporting.
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={huaweiEnabled}
                  onChange={(event) => {
                    setHuaweiEnabled(event.target.checked)
                    setSaved(false)
                  }}
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                />
              </label>
              <p className="mt-3 text-[11px] leading-6 text-muted-foreground">
                Workspace mengelompokkan alat. Catatan, tugas, snippet, favorit, dan riwayat tetap
                digunakan bersama. Menonaktifkan pilihan ini tidak menghapus hasil kerja.
              </p>
            </div>
          </section>
          <section className="grid grid-cols-1 gap-6 py-8 sm:grid-cols-[0.7fr_1fr]">
            <div>
              <h2 className="text-sm font-medium">Ritme fokus</h2>
              <p className="mt-2 text-xs leading-6 text-muted-foreground">
                Dipakai saat memulai sesi baru.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <label htmlFor="focus-duration" className="field-label">
                  Fokus
                </label>
                <div className="relative">
                  <input
                    id="focus-duration"
                    type="number"
                    min="1"
                    max="180"
                    className="field pr-14"
                    value={focusMinutes}
                    onChange={(e) => {
                      setFocusMinutes(e.target.value)
                      setSaved(false)
                    }}
                  />
                  <span className="absolute top-3.5 right-3 text-[11px] text-muted-foreground">
                    menit
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground">1–180 menit</p>
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="break-duration" className="field-label">
                  Istirahat
                </label>
                <div className="relative">
                  <input
                    id="break-duration"
                    type="number"
                    min="1"
                    max="60"
                    className="field pr-14"
                    value={breakMinutes}
                    onChange={(e) => {
                      setBreakMinutes(e.target.value)
                      setSaved(false)
                    }}
                  />
                  <span className="absolute top-3.5 right-3 text-[11px] text-muted-foreground">
                    menit
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground">1–60 menit</p>
              </div>
            </div>
          </section>
        </fieldset>
        {error && (
          <p role="alert" className="mb-5 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6">
          <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
            {saved && <Check size={15} className="text-primary" />}
            {saved ? 'Pengaturan tersimpan.' : 'Hanya untuk workspace lokalmu.'}
          </p>
          <Button type="submit" disabled={saving || !dirty}>
            {saving ? 'Menyimpan…' : 'Simpan pengaturan'}
          </Button>
        </div>
      </form>
    </>
  )
}

function LoadingWorkspace() {
  return (
    <div role="status" aria-label="Memuat workspace" className="animate-pulse">
      <div className="mb-8 flex justify-between">
        <div>
          <div className="skeleton mb-4 h-3 w-24" />
          <div className="skeleton h-10 w-64 max-w-full" />
          <div className="skeleton mt-4 h-3 w-72 max-w-full" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.45fr_1fr]">
        <div className="skeleton h-[250px] rounded-[40px]" />
        <div className="skeleton h-[250px] rounded-[40px]" />
      </div>
      <div className="skeleton mt-10 h-5 w-36" />
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="skeleton h-16" />
        ))}
      </div>
      <span className="sr-only">Menghubungkan ke server lokal…</span>
    </div>
  )
}

export default function App() {
  const [page, setPage] = useState<Page>(readPage)
  const [contentTarget, setContentTarget] = useState<SearchTarget | null>(() =>
    readContentTarget(window.location.hash),
  )
  const [data, setData] = useState<Bootstrap | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [pendingFavorites, setPendingFavorites] = useState<ToolId[]>([])
  const [preferencesSaving, setPreferencesSaving] = useState(false)
  const preferenceRequest = useRef(false)
  const huaweiRouteAttempted = useRef(false)
  const reduced = useReducedMotion()
  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setData(await api.bootstrap())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Workspace belum dapat dimuat.')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])
  useEffect(() => {
    const listener = () => {
      setPage(readPage())
      setContentTarget(readContentTarget(window.location.hash))
    }
    window.addEventListener('hashchange', listener)
    return () => window.removeEventListener('hashchange', listener)
  }, [])
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen((previous) => !previous)
      }
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])
  useEffect(() => {
    if (!toast) return
    const timeout = setTimeout(() => setToast(''), 6000)
    return () => clearTimeout(timeout)
  }, [toast])
  useEffect(() => {
    const theme = data?.preferences.theme ?? 'system'
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    function apply() {
      document.documentElement.classList.toggle(
        'dark',
        theme === 'dark' || (theme === 'system' && query.matches),
      )
    }
    apply()
    query.addEventListener('change', apply)
    return () => query.removeEventListener('change', apply)
  }, [data?.preferences.theme])
  const navigate = useCallback((next: Page) => {
    window.location.hash = next === 'home' ? '/' : `/${next}`
    setPage(next)
    setContentTarget(null)
    setMobileOpen(false)
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [])
  const openContent = useCallback((item: SearchItem) => {
    const hash = contentHash(item)
    const next =
      item.kind === 'task' ? 'daily-tasks' : item.kind === 'snippet' ? 'snippets' : 'quick-note'
    if (window.location.hash !== hash) window.location.hash = hash
    else setContentTarget({ kind: item.kind, id: item.id })
    setPage(next)
    setMobileOpen(false)
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [])
  const huaweiEnabled = data?.preferences.huawei_enabled ?? false
  const activeWorkspace: WorkspaceId =
    huaweiEnabled && (isHuaweiTool(page) || data?.preferences.active_workspace === 'huawei')
      ? 'huawei'
      : 'personal'
  const visibleTools = useMemo(
    () =>
      (data?.tools ?? []).filter((tool) =>
        activeWorkspace === 'huawei' ? huaweiSharedTools.has(tool.id) : !isHuaweiTool(tool.id),
      ),
    [data?.tools, activeWorkspace],
  )
  const favorites = useMemo(() => visibleTools.filter((tool) => tool.favorite), [visibleTools])
  const savePreferences = useCallback(async (values: Partial<Preferences>) => {
    if (preferenceRequest.current) throw new Error('Tunggu pengaturan yang sedang disimpan.')
    preferenceRequest.current = true
    setPreferencesSaving(true)
    try {
      const preferences = await api.preferences(values)
      setData((previous) => (previous ? { ...previous, preferences } : previous))
      return preferences
    } finally {
      preferenceRequest.current = false
      setPreferencesSaving(false)
    }
  }, [])
  useEffect(() => {
    if (data && !huaweiEnabled && isHuaweiTool(page)) navigate('home')
  }, [data, huaweiEnabled, page, navigate])
  useEffect(() => {
    if (!isHuaweiTool(page)) {
      huaweiRouteAttempted.current = false
      return
    }
    if (
      !huaweiEnabled ||
      data?.preferences.active_workspace === 'huawei' ||
      preferencesSaving ||
      huaweiRouteAttempted.current
    )
      return
    huaweiRouteAttempted.current = true
    void savePreferences({ active_workspace: 'huawei' }).catch((caught) =>
      setToast(caught instanceof Error ? caught.message : 'Pilihan workspace belum tersimpan.'),
    )
  }, [page, huaweiEnabled, data?.preferences.active_workspace, preferencesSaving, savePreferences])
  const changeWorkspace = useCallback(
    (workspace: WorkspaceId) => {
      if (preferenceRequest.current || (workspace === 'huawei' && !huaweiEnabled)) return
      void savePreferences({ active_workspace: workspace })
        .then(() => {
          navigate('home')
        })
        .catch((caught) =>
          setToast(caught instanceof Error ? caught.message : 'Workspace belum dapat diganti.'),
        )
    },
    [huaweiEnabled, navigate, savePreferences],
  )
  const recordActivity = useCallback((toolId: ToolId, action: string) => {
    void api
      .activity(toolId, action)
      .then((item) =>
        setData((previous) =>
          previous ? { ...previous, recent: [item, ...previous.recent].slice(0, 100) } : previous,
        ),
      )
      .catch(() =>
        setToast('Hasil alat sudah siap, tetapi aktivitas belum tersimpan ke server lokal.'),
      )
  }, [])
  const favorite = useCallback(
    (tool: Tool) => {
      if (pendingFavorites.includes(tool.id)) return
      setPendingFavorites((previous) => [...previous, tool.id])
      void api
        .favorite(tool.id, !tool.favorite)
        .then((result) =>
          setData((previous) =>
            previous
              ? {
                  ...previous,
                  tools: previous.tools.map((item) =>
                    item.id === tool.id ? { ...item, favorite: result.favorite } : item,
                  ),
                }
              : previous,
          ),
        )
        .catch((caught) =>
          setToast(caught instanceof Error ? caught.message : 'Favorit belum tersimpan.'),
        )
        .finally(() => setPendingFavorites((previous) => previous.filter((id) => id !== tool.id)))
    },
    [pendingFavorites],
  )
  const saveNote = useCallback(async (content: string) => {
    const note = await api.note(content)
    setData((previous) => (previous ? { ...previous, note } : previous))
    return note
  }, [])
  const activeTool = data?.tools.find(
    (tool) => tool.id === page && (!isHuaweiTool(tool.id) || huaweiEnabled),
  )
  const breadcrumb = activeTool
    ? toolLabels[activeTool.id].title
    : page === 'settings'
      ? 'Pengaturan'
      : (navItems.find((item) => item.id === page)?.label ?? 'Beranda')
  const sidebarProps = {
    page,
    navigate,
    tools: visibleTools,
    displayName: data?.preferences.display_name ?? '',
    onSearch: () => setSearchOpen(true),
    workspace: activeWorkspace,
    huaweiEnabled,
    onWorkspaceChange: changeWorkspace,
    workspaceChanging: preferencesSaving,
  }
  return (
    <MotionConfig reducedMotion="user" transition={{ type: 'spring', stiffness: 100, damping: 20 }}>
      <IconContext.Provider value={{ weight: 'regular', size: 20 }}>
        <a
          href="#main-content"
          onClick={(event) => {
            event.preventDefault()
            const main = document.getElementById('main-content')
            main?.focus()
            main?.scrollIntoView({ behavior: 'smooth' })
          }}
          className="fixed top-2 left-2 z-50 -translate-y-20 rounded-lg bg-primary px-4 py-3 text-sm text-primary-foreground focus:translate-y-0"
        >
          Langsung ke konten
        </a>
        <Sidebar {...sidebarProps} />
        <div className="min-h-[100dvh] md:ml-[224px]">
          <header className="flex h-[94px] items-center justify-between gap-3 border-b border-border/60 px-5 sm:px-9 lg:px-12">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                aria-label="Buka navigasi"
                onClick={() => setMobileOpen(true)}
                className="-ml-1 flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted md:hidden"
              >
                <List size={22} />
              </button>
              <span className="hidden text-xs text-muted-foreground/65 sm:block">
                {activeWorkspace === 'huawei' ? 'Huawei' : 'Workspace'}
              </span>
              <CaretRight size={12} className="hidden text-muted-foreground/40 sm:block" />
              <span className="truncate text-xs font-medium">{breadcrumb}</span>
            </div>
            <div className="flex shrink-0 items-center gap-3 sm:gap-5">
              <div className="hidden items-center gap-2 text-[10px] text-muted-foreground lg:flex">
                <StatusPulse connected={!!data && !error} />
                {loading ? 'Menghubungkan…' : error ? 'Belum tersambung' : 'Berjalan lokal'}
              </div>
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                disabled={!data}
                className="flex h-9 items-center gap-2 rounded-xl border border-border bg-surface px-3 text-xs text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground disabled:opacity-40"
                aria-label="Cari global, Control K"
              >
                <MagnifyingGlass size={16} />
                <span className="hidden sm:inline">Cari global</span>
                <span className="keyboard ml-2 hidden sm:inline-flex">Ctrl K</span>
              </button>
            </div>
          </header>
          <main
            id="main-content"
            tabIndex={-1}
            className="mx-auto max-w-[1400px] px-5 pt-8 pb-8 outline-none sm:px-9 sm:pt-10 lg:px-12"
          >
            {loading ? (
              <LoadingWorkspace />
            ) : error || !data ? (
              <div className="mx-auto max-w-lg py-14">
                <EmptyState
                  title="Ruang belum tersambung."
                  description={error || 'Server lokal belum mengirim data workspace.'}
                  icon={WarningCircle}
                >
                  <Button onClick={() => void load()}>
                    Coba hubungkan lagi
                    <ArrowRight size={15} />
                  </Button>
                </EmptyState>
              </div>
            ) : (
              <motion.div
                key={`${activeWorkspace}-${page}`}
                initial={reduced ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35 }}
              >
                {page === 'home' && activeWorkspace === 'huawei' && (
                  <HuaweiHome
                    tools={visibleTools}
                    navigate={navigate}
                    onFavorite={favorite}
                    pendingFavorites={pendingFavorites}
                  />
                )}
                {page === 'home' && activeWorkspace === 'personal' && (
                  <>
                    <div className="mb-9 flex items-end justify-between gap-6">
                      <div>
                        <p className="eyebrow mb-3">
                          {data.preferences.display_name
                            ? `Selamat datang, ${data.preferences.display_name}`
                            : 'Sedikit alat, banyak kemungkinan'}
                        </p>
                        <h1 className="text-[34px] leading-[1.16] font-medium tracking-[-0.055em] sm:text-[40px]">
                          Mulai dari sini<span className="text-primary">.</span>
                        </h1>
                        <p className="mt-3 text-[13px] leading-7 text-muted-foreground">
                          Alat sehari-hari, satu ruang yang tenang.
                        </p>
                      </div>
                      <div className="hidden pb-1 text-right sm:block">
                        <p className="font-mono text-[10px] text-muted-foreground">
                          {new Intl.DateTimeFormat('id-ID', {
                            weekday: 'long',
                            timeZone: 'Asia/Makassar',
                          }).format(new Date())}
                        </p>
                        <p className="mt-2 text-xs font-medium">
                          {new Intl.DateTimeFormat('id-ID', {
                            day: 'numeric',
                            month: 'long',
                            year: 'numeric',
                            timeZone: 'Asia/Makassar',
                          }).format(new Date())}
                        </p>
                      </div>
                    </div>
                    <FeaturedTools
                      navigate={navigate}
                      focusMinutes={data.preferences.focus_minutes}
                      note={data.note.content}
                    />
                    <div className="mt-11">
                      <ToolList
                        tools={visibleTools}
                        navigate={navigate}
                        onFavorite={favorite}
                        pendingFavorites={pendingFavorites}
                      />
                    </div>
                  </>
                )}
                {page === 'tools' && (
                  <>
                    <div className="mb-9 flex flex-wrap items-end justify-between gap-4">
                      <div>
                        <p className="eyebrow mb-3">Pilih yang kamu butuhkan</p>
                        <h1 className="text-[32px] font-medium tracking-[-0.05em]">
                          Banyak cara untuk lebih mudah.
                        </h1>
                        <p className="mt-3 text-sm text-muted-foreground">
                          Alat-alat kecil untuk pekerjaan sehari-hari.
                        </p>
                      </div>
                      <MagneticButton onClick={() => setSearchOpen(true)}>
                        Cari dengan cepat
                      </MagneticButton>
                    </div>
                    <ToolList
                      title="Semua alat"
                      tools={visibleTools}
                      navigate={navigate}
                      onFavorite={favorite}
                      pendingFavorites={pendingFavorites}
                      showSearch
                    />
                  </>
                )}
                {page === 'favorites' && (
                  <>
                    <p className="eyebrow mb-3">Selalu dekat</p>
                    <h1 className="text-[32px] font-medium tracking-[-0.05em]">
                      Pilihan yang paling sering kembali.
                    </h1>
                    <p className="mt-3 mb-9 text-sm text-muted-foreground">
                      Alat yang kamu sematkan, siap saat dibutuhkan.
                    </p>
                    {favorites.length ? (
                      <ToolList
                        title="Alat favorit"
                        tools={favorites}
                        navigate={navigate}
                        onFavorite={favorite}
                        pendingFavorites={pendingFavorites}
                        showSearch
                      />
                    ) : (
                      <EmptyState
                        title="Tempat untuk alat andalanmu."
                        description="Klik ikon bintang pada alat yang kamu sukai. Favoritmu akan muncul di sini dan di sidebar."
                        icon={Star}
                      >
                        <Button variant="secondary" onClick={() => navigate('tools')}>
                          Pilih alat favorit
                          <ArrowRight size={15} />
                        </Button>
                      </EmptyState>
                    )}
                  </>
                )}
                {page === 'activity' && (
                  <ActivityList
                    recent={data.recent}
                    huaweiEnabled={huaweiEnabled}
                    navigate={navigate}
                    onClear={async () => {
                      try {
                        await api.clearActivity()
                        setData((previous) => (previous ? { ...previous, recent: [] } : previous))
                      } catch (caught) {
                        setToast(
                          caught instanceof Error ? caught.message : 'Riwayat belum terhapus.',
                        )
                        throw caught
                      }
                    }}
                  />
                )}
                {page === 'settings' && (
                  <Settings
                    preferences={data.preferences}
                    onSave={async (values) => {
                      await savePreferences(values)
                    }}
                  />
                )}
                {activeTool && (
                  <>
                    <button
                      type="button"
                      onClick={() => navigate('tools')}
                      className="mb-7 inline-flex items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-primary"
                    >
                      <ArrowLeft size={15} />
                      Semua alat
                    </button>
                    <div className="mb-8 flex items-start justify-between gap-4">
                      <div>
                        <p className="eyebrow mb-3">
                          {categoryLabels[activeTool.category]}
                          <span className="mx-2 opacity-40">/</span>
                          {toolLabels[activeTool.id].hint}
                        </p>
                        <h1 className="text-[32px] font-medium tracking-[-0.05em]">
                          {toolLabels[activeTool.id].title}
                          <span className="text-primary">.</span>
                        </h1>
                        <p className="mt-3 text-sm text-muted-foreground">
                          {toolLabels[activeTool.id].description}
                        </p>
                      </div>
                      <Button
                        variant="secondary"
                        size="icon"
                        disabled={pendingFavorites.includes(activeTool.id)}
                        onClick={() => favorite(activeTool)}
                        aria-label={
                          activeTool.favorite ? 'Hapus dari favorit' : 'Tambahkan ke favorit'
                        }
                        aria-pressed={activeTool.favorite}
                      >
                        <Star
                          size={18}
                          weight={activeTool.favorite ? 'fill' : 'regular'}
                          className={activeTool.favorite ? 'text-primary' : undefined}
                        />
                      </Button>
                    </div>
                    <div
                      className={cn(
                        'surface',
                        activeTool.id === 'text-diff' ? 'overflow-hidden' : 'p-5 sm:p-8',
                      )}
                    >
                      <ToolPanel
                        requestedItem={contentTarget}
                        id={activeTool.id}
                        preferences={data.preferences}
                        note={data.note}
                        onSaveNote={saveNote}
                        onActivity={(action) => recordActivity(activeTool.id, action)}
                      />
                    </div>
                    <div className="mt-5 flex items-start gap-2 px-1 text-[10px] leading-5 text-muted-foreground">
                      <ShieldCheck size={14} className="mt-0.5 shrink-0 text-primary" />
                      {activeTool.id === 'huawei-lld'
                        ? 'LLD dan parameter diproses di server lokal tanpa penyimpanan permanen. Riwayat hanya mencatat nama aksi.'
                        : activeTool.execution === 'hybrid'
                          ? 'Data dikirim ke server lokal dan disimpan di perangkat ini.'
                          : 'Isi pekerjaan diproses di browser. Riwayat hanya mencatat nama aksi.'}
                    </div>
                  </>
                )}
              </motion.div>
            )}
            <footer className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6 text-[10px] text-muted-foreground/70">
              <span className="flex items-center gap-2">
                <span className="size-1 rounded-full bg-primary/65" />
                Dibuat untuk keseharianmu.
              </span>
              <span className="font-mono">
                RUANG / {activeWorkspace === 'huawei' ? 'HUAWEI' : 'PERSONAL'} WORKSPACE
              </span>
            </footer>
          </main>
        </div>
        <CommandPalette
          open={searchOpen}
          onOpenChange={setSearchOpen}
          tools={visibleTools}
          toolIcons={icons}
          navigate={navigate}
          onContent={openContent}
        />
        <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
          <DialogContent className="top-0 left-0 h-[100dvh] w-[284px] max-w-[85vw] translate-x-0 rounded-none border-y-0 border-l-0 p-0">
            <DialogTitle className="sr-only">Navigasi workspace</DialogTitle>
            <DialogDescription className="sr-only">
              Buka halaman dan alat di Ruang.
            </DialogDescription>
            <Sidebar {...sidebarProps} mobile />
          </DialogContent>
        </Dialog>
        <AnimatePresence>
          {toast && (
            <motion.div
              role="status"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="fixed right-4 bottom-5 left-4 z-50 flex items-start gap-3 rounded-2xl border border-border bg-surface px-5 py-4 text-xs leading-6 shadow-lg sm:right-7 sm:left-auto sm:max-w-md"
            >
              <WarningCircle size={18} className="mt-1 shrink-0 text-muted-foreground" />
              <p className="flex-1">{toast}</p>
              <button
                type="button"
                onClick={() => setToast('')}
                aria-label="Tutup pemberitahuan"
                className="mt-0.5 rounded-md p-1 hover:bg-muted"
              >
                <X size={15} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </IconContext.Provider>
    </MotionConfig>
  )
}
