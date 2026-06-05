import { describe, expect, it } from 'vitest'

import type { KanbanTask } from '@/types/hermes'

import { groupKanbanRunTranscript, isKanbanTaskLive } from './runs'

function task(overrides: Partial<KanbanTask> = {}): KanbanTask {
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
    id: 't1',
    last_failure_error: null,
    last_heartbeat_at: null,
    priority: 0,
    result: null,
    started_at: null,
    status: 'ready',
    tenant: null,
    title: 'Task',
    worker_pid: null,
    workflow_route: null,
    workflow_template_id: null,
    workflowRoute: null,
    workspace_kind: 'scratch',
    workspace_path: null,
    ...overrides
  }
}

describe('kanban run helpers', () => {
  it('marks a task live when it is running, has a current run, or has a fresh heartbeat', () => {
    expect(isKanbanTaskLive(task({ status: 'running' }), 1_000)).toBe(true)
    expect(isKanbanTaskLive(task({ current_run_id: 42 }), 1_000)).toBe(true)
    expect(isKanbanTaskLive(task({ last_heartbeat_at: 940 }), 1_000)).toBe(true)
    expect(isKanbanTaskLive(task({ last_heartbeat_at: 100 }), 1_000)).toBe(false)
  })

  it('groups transcript metadata and falls back to waiting output', () => {
    expect(
      groupKanbanRunTranscript({
        metadata: {
          groups: [
            { kind: 'tool', text: 'pytest' },
            { kind: 'stderr', text: 'boom' }
          ]
        }
      })
    ).toEqual([
      { kind: 'tool', text: 'pytest' },
      { kind: 'stderr', text: 'boom' }
    ])

    expect(groupKanbanRunTranscript({ status: 'running' })).toEqual([{ kind: 'waiting', text: 'Aguardando saída do run…' }])
  })
})
