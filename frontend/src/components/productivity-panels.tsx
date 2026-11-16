import { DailyTasks } from './productivity/tasks-panel'
import { Snippets } from './productivity/snippets-panel'
import type { SearchTarget } from '../lib/types'

interface ProductivityPanelProps {
  id: 'daily-tasks' | 'snippets'
  onActivity: (action: string) => void
  requestedItem: SearchTarget | null
}

export function ProductivityPanel({ id, onActivity, requestedItem }: ProductivityPanelProps) {
  return id === 'daily-tasks' ? (
    <DailyTasks onActivity={onActivity} requestedItem={requestedItem} />
  ) : (
    <Snippets onActivity={onActivity} requestedItem={requestedItem} />
  )
}
