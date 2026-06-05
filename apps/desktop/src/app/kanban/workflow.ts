import type { KanbanStatus, KanbanTask, KanbanWorkflowStep, KanbanWorkflowStepStatus } from '@/types/hermes'

export function workflowRouteForTask(task: KanbanTask | null | undefined) {
  return task?.workflowRoute ?? task?.workflow_route ?? null
}

export function workflowStepsForTask(task: KanbanTask | null | undefined) {
  return workflowRouteForTask(task)?.steps ?? []
}

export function workflowCurrentStepForTask(task: KanbanTask | null | undefined) {
  const route = workflowRouteForTask(task)
  const steps = route?.steps ?? []
  const currentId = route?.current_step_id ?? task?.current_step_key ?? null

  return steps.find(step => step.id === currentId) ?? steps.find(step => ['ready', 'running', 'blocked'].includes(step.status)) ?? null
}

export function workflowProgress(task: KanbanTask | null | undefined) {
  const steps = workflowStepsForTask(task)
  const passed = steps.filter(step => step.status === 'passed' || step.status === 'skipped').length

  return { passed, total: steps.length }
}

export function workflowEvidencePreview(step: KanbanWorkflowStep | null | undefined) {
  const last = step?.evidence?.at(-1)

  return last?.text || last?.kind || null
}

export function hasWorkflowRoute(task: KanbanTask | null | undefined) {
  return workflowStepsForTask(task).length > 0
}

export function semanticStepStatusForKanbanDrop(status: KanbanStatus): KanbanWorkflowStepStatus | null {
  if (status === 'done') {
    return 'passed'
  }

  if (status === 'blocked') {
    return 'blocked'
  }

  return null
}

export function canUseRawKanbanStatusDrop(task: KanbanTask | null | undefined, status: KanbanStatus) {
  if (!hasWorkflowRoute(task)) {
    return true
  }

  return semanticStepStatusForKanbanDrop(status) !== null
}
