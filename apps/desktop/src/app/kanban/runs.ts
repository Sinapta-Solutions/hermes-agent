import type { KanbanTask } from '@/types/hermes'

export const KANBAN_LIVE_HEARTBEAT_SECONDS = 120

export interface KanbanTranscriptGroup {
  kind: string
  text: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

export function isKanbanTaskLive(task: KanbanTask, nowSeconds: number, heartbeatSeconds = KANBAN_LIVE_HEARTBEAT_SECONDS) {
  if (task.status === 'running' || task.current_run_id) {
    return true
  }

  return typeof task.last_heartbeat_at === 'number' && nowSeconds - task.last_heartbeat_at <= heartbeatSeconds
}

export function groupKanbanRunTranscript(run: Record<string, unknown>): KanbanTranscriptGroup[] {
  const metadata = asRecord(run.metadata)
  const groups = Array.isArray(metadata?.groups) ? metadata.groups : []

  const normalized = groups
    .map(group => asRecord(group))
    .filter((group): group is Record<string, unknown> => Boolean(group))
    .map(group => ({
      kind: String(group.kind || 'log'),
      text: String(group.text || group.message || '').trim()
    }))
    .filter(group => group.text.length > 0)

  if (normalized.length > 0) {
    return normalized
  }

  if (run.summary) {
    return [{ kind: 'final', text: String(run.summary) }]
  }

  if (run.error) {
    return [{ kind: 'stderr', text: String(run.error) }]
  }

  return [{ kind: 'waiting', text: 'Aguardando saída do run…' }]
}
