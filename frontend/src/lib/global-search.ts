import type { SearchTarget } from './types'

export function contentHash(target: SearchTarget): string {
  if (!Number.isSafeInteger(target.id) || target.id < 1)
    throw new Error('ID hasil pencarian tidak valid.')
  if (target.kind === 'note') return '#/quick-note'
  return `#/${target.kind === 'task' ? 'daily-tasks' : 'snippets'}?item=${target.id}`
}

export function readContentTarget(hash: string): SearchTarget | null {
  const route = hash.replace(/^#\/?/, '')
  const [path, query = ''] = route.split('?')
  if (path === 'quick-note') return { kind: 'note', id: 1 }
  if (path !== 'daily-tasks' && path !== 'snippets') return null
  const params = new URLSearchParams(query)
  const ids = params.getAll('item')
  if (ids.length !== 1 || !/^[1-9]\d*$/.test(ids[0])) return null
  const id = Number(ids[0])
  return Number.isSafeInteger(id) ? { kind: path === 'daily-tasks' ? 'task' : 'snippet', id } : null
}
