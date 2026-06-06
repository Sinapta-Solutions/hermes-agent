import type { KanbanDispatcherStatusResponse } from '@/types/hermes'

export type KanbanDispatcherHealth = 'healthy' | 'loading' | 'offline' | 'warning'

export function kanbanDispatcherHealth(status: KanbanDispatcherStatusResponse | null): KanbanDispatcherHealth {
  if (!status) {
    return 'loading'
  }

  if (!status.dispatch_in_gateway || !status.gateway_pid) {
    return 'offline'
  }

  if (
    status.stale_running_count > 0 ||
    status.pending_approvals_count > 0 ||
    (status.invalid_workflow_route_count ?? 0) > 0
  ) {
    return 'warning'
  }

  return 'healthy'
}

export function kanbanDispatcherLabel(status: KanbanDispatcherStatusResponse | null): string {
  const health = kanbanDispatcherHealth(status)

  if (!status) {
    return 'Dispatcher carregando'
  }

  if (health === 'offline') {
    return 'Dispatcher parado'
  }

  if (health === 'warning') {
    return 'Dispatcher pede atenção'
  }

  return 'Dispatcher ativo'
}

export function kanbanDispatcherSummary(status: KanbanDispatcherStatusResponse | null): string {
  if (!status) {
    return 'Buscando estado do Kanban…'
  }

  const queue = `${status.ready_count} prontos · ${status.running_count} em execução`
  const approvals = status.pending_approvals_count > 0 ? ` · ${status.pending_approvals_count} aprovações` : ''
  const stale = status.stale_running_count > 0 ? ` · ${status.stale_running_count} stale` : ''
  const invalid = status.invalid_workflow_route_count ? ` · ${status.invalid_workflow_route_count} rotas inválidas` : ''

  return `${queue}${approvals}${stale}${invalid}`
}

export function hasKanbanDispatcherAttention(status: KanbanDispatcherStatusResponse | null): boolean {
  if (!status) {
    return false
  }

  return (
    kanbanDispatcherHealth(status) !== 'healthy' ||
    status.pending_approvals_count > 0 ||
    (status.invalid_workflow_route_count ?? 0) > 0
  )
}
