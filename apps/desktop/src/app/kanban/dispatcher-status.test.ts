import { describe, expect, it } from 'vitest'

import type { KanbanDispatcherStatusResponse } from '@/types/hermes'

import {
  hasKanbanDispatcherAttention,
  kanbanDispatcherHealth,
  kanbanDispatcherLabel,
  kanbanDispatcherSummary
} from './dispatcher-status'

function status(overrides: Partial<KanbanDispatcherStatusResponse> = {}): KanbanDispatcherStatusResponse {
  return {
    active_runs: [],
    board: null,
    dispatch_in_gateway: true,
    gateway_pid: 123,
    last_event_at: null,
    object: 'hermes.kanban.dispatcher_status',
    pending_approvals_count: 0,
    ready_count: 2,
    running_count: 1,
    stale_running_count: 0,
    ...overrides
  }
}

describe('kanban dispatcher status helpers', () => {
  it('treats missing status as loading, not an actionable alert', () => {
    expect(kanbanDispatcherHealth(null)).toBe('loading')
    expect(kanbanDispatcherLabel(null)).toBe('Dispatcher carregando')
    expect(kanbanDispatcherSummary(null)).toBe('Buscando estado do Kanban…')
    expect(hasKanbanDispatcherAttention(null)).toBe(false)
  })

  it('summarizes a healthy dispatcher without raw config flags', () => {
    const current = status()

    expect(kanbanDispatcherHealth(current)).toBe('healthy')
    expect(kanbanDispatcherLabel(current)).toBe('Dispatcher ativo')
    expect(kanbanDispatcherSummary(current)).toBe('2 prontos · 1 em execução')
    expect(hasKanbanDispatcherAttention(current)).toBe(false)
  })

  it('does not treat normal active runs as dispatcher attention', () => {
    const current = status({
      active_runs: [
        {
          id: 1,
          last_heartbeat_at: 2,
          profile: 'default',
          started_at: 1,
          status: 'running',
          step_key: 'work',
          task_id: 'task-1',
          task_status: 'running',
          title: 'Running task'
        }
      ]
    })

    expect(kanbanDispatcherHealth(current)).toBe('healthy')
    expect(hasKanbanDispatcherAttention(current)).toBe(false)
  })

  it('marks missing gateway dispatch as offline', () => {
    const current = status({ dispatch_in_gateway: false, gateway_pid: null })

    expect(kanbanDispatcherHealth(current)).toBe('offline')
    expect(kanbanDispatcherLabel(current)).toBe('Dispatcher parado')
    expect(hasKanbanDispatcherAttention(current)).toBe(true)
  })

  it('adds only actionable warnings to the summary', () => {
    const current = status({ invalid_workflow_route_count: 1, pending_approvals_count: 2, stale_running_count: 3 })

    expect(kanbanDispatcherHealth(current)).toBe('warning')
    expect(kanbanDispatcherLabel(current)).toBe('Dispatcher pede atenção')
    expect(kanbanDispatcherSummary(current)).toBe('2 prontos · 1 em execução · 2 aprovações · 3 stale · 1 rotas inválidas')
  })
})
