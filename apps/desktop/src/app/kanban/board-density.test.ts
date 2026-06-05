import { describe, expect, it } from 'vitest'

import type { KanbanStatus, KanbanTask } from '@/types/hermes'

import {
  buildKanbanColumnView,
  COLD_KANBAN_STATUSES,
  DEFAULT_KANBAN_COLUMN_PAGE_SIZE,
  getKanbanBoardDensity,
  KANBAN_BOARD_COMPACT_THRESHOLD,
  nextKeyboardTaskId
} from './board-density'

function task(id: string, status: KanbanStatus = 'ready'): KanbanTask {
  return {
    assignee: 'worker',
    body: null,
    completed_at: null,
    consecutive_failures: 0,
    created_at: 1,
    created_by: 'test',
    current_run_id: null,
    current_step_key: null,
    goal_mode: false,
    id,
    last_failure_error: null,
    last_heartbeat_at: null,
    priority: 0,
    result: null,
    started_at: null,
    status,
    tenant: null,
    title: `Task ${id}`,
    worker_pid: null,
    workflow_route: null,
    workflow_template_id: null,
    workflowRoute: null,
    workspace_kind: 'scratch',
    workspace_path: null
  }
}

const STATUS_ORDER: KanbanStatus[] = ['triage', 'todo', 'scheduled', 'ready', 'running', 'blocked', 'done']

describe('kanban board density helpers', () => {
  it('switches large boards to compact mode and collapses cold lanes by default', () => {
    const tasks = Array.from({ length: KANBAN_BOARD_COMPACT_THRESHOLD + 1 }, (_, index) => task(`t${index}`))

    expect(getKanbanBoardDensity(tasks)).toEqual({
      coldLaneStatuses: COLD_KANBAN_STATUSES,
      compact: true,
      defaultPageSize: DEFAULT_KANBAN_COLUMN_PAGE_SIZE,
      total: KANBAN_BOARD_COMPACT_THRESHOLD + 1
    })
  })

  it('keeps small boards expanded and uses the default visible page size', () => {
    const tasks = Array.from({ length: 3 }, (_, index) => task(`t${index}`, index === 0 ? 'triage' : 'ready'))

    const triageView = buildKanbanColumnView({ status: 'triage', tasks })
    const readyView = buildKanbanColumnView({ status: 'ready', tasks })

    expect(triageView.collapsed).toBe(false)
    expect(readyView.visibleTasks).toHaveLength(2)
    expect(readyView.hiddenCount).toBe(0)
  })

  it('limits each expanded column independently and reports hidden cards', () => {
    const tasks = Array.from({ length: 12 }, (_, index) => task(`ready-${index}`, 'ready'))

    const view = buildKanbanColumnView({ status: 'ready', tasks, visibleLimit: 10 })

    expect(view.collapsed).toBe(false)
    expect(view.total).toBe(12)
    expect(view.visibleTasks.map(item => item.id)).toEqual(tasks.slice(0, 10).map(item => item.id))
    expect(view.hiddenCount).toBe(2)
    expect(view.truncated).toBe(true)
  })

  it('hides card bodies in compact mode without changing non-card lanes', () => {
    const tasks = Array.from({ length: 101 }, (_, index) => task(`done-${index}`, 'done'))

    const view = buildKanbanColumnView({ status: 'done', tasks })

    expect(view.collapsed).toBe(true)
    expect(view.compactCards).toBe(true)
    expect(view.visibleTasks).toEqual([])
    expect(view.hiddenCount).toBe(101)
  })

  it('moves keyboard selection inside and across visible columns', () => {
    const tasks = [task('triage-1', 'triage'), task('ready-1', 'ready'), task('ready-2', 'ready'), task('blocked-1', 'blocked')]

    expect(nextKeyboardTaskId({ currentTaskId: null, direction: 'next', statusOrder: STATUS_ORDER, tasks })).toBe('triage-1')
    expect(nextKeyboardTaskId({ currentTaskId: 'ready-1', direction: 'next', statusOrder: STATUS_ORDER, tasks })).toBe('ready-2')
    expect(nextKeyboardTaskId({ currentTaskId: 'ready-2', direction: 'next', statusOrder: STATUS_ORDER, tasks })).toBe('blocked-1')
    expect(nextKeyboardTaskId({ currentTaskId: 'ready-1', direction: 'previous', statusOrder: STATUS_ORDER, tasks })).toBe('triage-1')
  })
})
