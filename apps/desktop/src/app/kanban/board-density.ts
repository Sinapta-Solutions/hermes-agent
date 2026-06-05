import type { KanbanStatus, KanbanTask } from '@/types/hermes'

export const KANBAN_BOARD_COMPACT_THRESHOLD = 100
export const DEFAULT_KANBAN_COLUMN_PAGE_SIZE = 10
export const KANBAN_COLUMN_PAGE_SIZE_OPTIONS = [10, 25, 50] as const
export const COLD_KANBAN_STATUSES: KanbanStatus[] = ['triage', 'scheduled', 'done', 'archived']

export interface KanbanBoardDensity {
  coldLaneStatuses: KanbanStatus[]
  compact: boolean
  defaultPageSize: number
  total: number
}

export interface KanbanColumnViewOptions {
  collapsedStatuses?: KanbanStatus[]
  expandedStatuses?: KanbanStatus[]
  status: KanbanStatus
  tasks: KanbanTask[]
  visibleLimit?: number
}

export interface KanbanColumnView {
  collapsed: boolean
  compactCards: boolean
  hiddenCount: number
  total: number
  truncated: boolean
  visibleTasks: KanbanTask[]
}

export function getKanbanBoardDensity(tasks: KanbanTask[]): KanbanBoardDensity {
  return {
    coldLaneStatuses: COLD_KANBAN_STATUSES,
    compact: tasks.length > KANBAN_BOARD_COMPACT_THRESHOLD,
    defaultPageSize: DEFAULT_KANBAN_COLUMN_PAGE_SIZE,
    total: tasks.length
  }
}

export function buildKanbanColumnView({
  collapsedStatuses,
  expandedStatuses = [],
  status,
  tasks,
  visibleLimit = DEFAULT_KANBAN_COLUMN_PAGE_SIZE
}: KanbanColumnViewOptions): KanbanColumnView {
  const density = getKanbanBoardDensity(tasks)
  const columnTasks = tasks.filter(task => task.status === status)
  const coldLanes = collapsedStatuses ?? density.coldLaneStatuses
  const collapsed = density.compact && coldLanes.includes(status) && !expandedStatuses.includes(status)
  const visibleTasks = collapsed ? [] : columnTasks.slice(0, visibleLimit)
  const hiddenCount = Math.max(0, columnTasks.length - visibleTasks.length)

  return {
    collapsed,
    compactCards: density.compact,
    hiddenCount,
    total: columnTasks.length,
    truncated: hiddenCount > 0,
    visibleTasks
  }
}

export type KanbanKeyboardDirection = 'next' | 'previous'

export interface KanbanKeyboardSelectionOptions {
  currentTaskId: null | string
  direction: KanbanKeyboardDirection
  statusOrder: KanbanStatus[]
  tasks: KanbanTask[]
}

export function nextKeyboardTaskId({
  currentTaskId,
  direction,
  statusOrder,
  tasks
}: KanbanKeyboardSelectionOptions): null | string {
  const statusRank = new Map(statusOrder.map((status, index) => [status, index]))

  const ordered = tasks
    .map((task, index) => ({ index, rank: statusRank.get(task.status), task }))
    .filter((item): item is { index: number; rank: number; task: KanbanTask } => item.rank !== undefined)
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map(item => item.task)

  if (ordered.length === 0) {
    return null
  }

  const fallbackIndex = direction === 'next' ? 0 : ordered.length - 1
  const currentIndex = currentTaskId ? ordered.findIndex(task => task.id === currentTaskId) : -1

  if (currentIndex === -1) {
    return ordered[fallbackIndex].id
  }

  const nextIndex = direction === 'next'
    ? Math.min(currentIndex + 1, ordered.length - 1)
    : Math.max(currentIndex - 1, 0)

  return ordered[nextIndex].id
}
