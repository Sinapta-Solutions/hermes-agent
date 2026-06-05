import { describe, expect, it } from 'vitest'

import type { KanbanTask } from '@/types/hermes'

import {
  canUseRawKanbanStatusDrop,
  semanticStepStatusForKanbanDrop,
  workflowCurrentStepForTask,
  workflowEvidencePreview,
  workflowProgress,
  workflowRouteForTask
} from './workflow'

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

describe('kanban workflow helpers', () => {
  it('reads either workflowRoute casing and picks the current step', () => {
    const item = task({
      current_step_key: 'review',
      workflowRoute: {
        current_step_id: 'review',
        steps: [
          { id: 'plan', status: 'passed', title: 'Plan' },
          {
            evidence: [{ text: 'review proof' }],
            id: 'review',
            status: 'running',
            title: 'Review'
          }
        ],
        version: 1
      }
    })

    expect(workflowRouteForTask(item)?.current_step_id).toBe('review')
    expect(workflowCurrentStepForTask(item)?.id).toBe('review')
    expect(workflowProgress(item)).toEqual({ passed: 1, total: 2 })
    expect(workflowEvidencePreview(workflowCurrentStepForTask(item))).toBe('review proof')
  })

  it('counts skipped workflow steps as terminal progress', () => {
    const item = task({
      workflowRoute: {
        current_step_id: null,
        steps: [
          { id: 'plan', status: 'passed', title: 'Plan' },
          { id: 'optional', status: 'skipped', title: 'Optional' }
        ],
        version: 1
      }
    })

    expect(workflowProgress(item)).toEqual({ passed: 2, total: 2 })
  })

  it('converts workflow card drops to semantic step status only for done/blocked', () => {
    const item = task({
      workflowRoute: {
        current_step_id: 'review',
        steps: [{ id: 'review', status: 'running', title: 'Review' }],
        version: 1
      }
    })

    expect(semanticStepStatusForKanbanDrop('done')).toBe('passed')
    expect(semanticStepStatusForKanbanDrop('blocked')).toBe('blocked')
    expect(semanticStepStatusForKanbanDrop('ready')).toBeNull()
    expect(canUseRawKanbanStatusDrop(item, 'ready')).toBe(false)
    expect(canUseRawKanbanStatusDrop(item, 'done')).toBe(true)
    expect(canUseRawKanbanStatusDrop(task(), 'ready')).toBe(true)
  })
})
