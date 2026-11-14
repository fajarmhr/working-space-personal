import { DailyTasks } from './productivity/tasks-panel'
import { Snippets } from './productivity/snippets-panel'

interface ProductivityPanelProps {
  id: 'daily-tasks' | 'snippets'
  onActivity: (action: string) => void
}

export function ProductivityPanel({ id, onActivity }: ProductivityPanelProps) {
  return id === 'daily-tasks' ? (
    <DailyTasks onActivity={onActivity} />
  ) : (
    <Snippets onActivity={onActivity} />
  )
}
