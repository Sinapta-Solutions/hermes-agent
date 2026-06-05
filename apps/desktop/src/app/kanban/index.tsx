import type * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  applyKanbanWorkflowPreset,
  createKanbanTask,
  createKanbanTaskComment,
  createKanbanWorkflowEvidence,
  createKanbanWorkflowStep,
  getKanbanAssignees,
  getKanbanBoards,
  getKanbanDispatcherStatus,
  getKanbanTaskDetail,
  getKanbanTasks,
  type KanbanBoard,
  type KanbanComment,
  type KanbanDispatcherStatusResponse,
  type KanbanFailure,
  type KanbanRun,
  type KanbanStatus,
  type KanbanTask,
  type KanbanTaskDetailResponse,
  type KanbanTaskUpdatePayload,
  type KanbanWorkflowStepStatus,
  type KanbanWorkflowStepUpdatePayload,
  requestKanbanWorkflowApproval,
  resolveKanbanWorkflowApproval,
  updateKanbanTask,
  updateKanbanTaskComment,
  updateKanbanWorkflowStep
} from '@/hermes'
import { cn } from '@/lib/utils'
import { notify, notifyError } from '@/store/notifications'

import type { SetStatusbarItemGroup } from '../shell/statusbar-controls'

import { buildKanbanColumnView, getKanbanBoardDensity, nextKeyboardTaskId } from './board-density'
import { groupKanbanRunTranscript, isKanbanTaskLive } from './runs'
import {
  canUseRawKanbanStatusDrop,
  semanticStepStatusForKanbanDrop,
  workflowCurrentStepForTask,
  workflowEvidencePreview,
  workflowProgress,
  workflowRouteForTask
} from './workflow'

interface KanbanViewProps {
  setStatusbarItemGroup?: SetStatusbarItemGroup
}

type TimelineFilter = 'all' | TimelineItem['type']

type TaskFormState = {
  assignee: string
  body: string
  priority: string
  status: KanbanStatus
  tenant: string
  title: string
  workspace_path: string
}

type WorkflowStepFormState = {
  assignee: string
  depends_on: string
  id: string
  max_retries: string
  title: string
  type: string
  validation_criteria: string
}

const EMPTY_FORM: TaskFormState = {
  assignee: '',
  body: '',
  priority: '0',
  status: 'ready',
  tenant: '',
  title: '',
  workspace_path: ''
}

const EMPTY_WORKFLOW_STEP_FORM: WorkflowStepFormState = {
  assignee: '',
  depends_on: '',
  id: '',
  max_retries: '1',
  title: '',
  type: 'implementation',
  validation_criteria: ''
}

const WORKFLOW_STEP_STATUSES: KanbanWorkflowStepStatus[] = ['pending', 'ready', 'running', 'passed', 'blocked', 'failed', 'skipped']

const STATUSES: Array<{ accent: string; description: string; label: string; value: KanbanStatus }> = [
  { value: 'triage', label: 'Triage', description: 'Entrada bruta para especificar', accent: 'var(--ui-orange)' },
  { value: 'todo', label: 'Todo', description: 'Pronto depois de dependências', accent: 'var(--ui-yellow)' },
  { value: 'scheduled', label: 'Scheduled', description: 'Aguardando janela/tempo', accent: 'var(--ui-blue)' },
  { value: 'ready', label: 'Ready', description: 'Dispatcher pode pegar', accent: 'var(--ui-green)' },
  { value: 'running', label: 'Running', description: 'Perfil executando agora', accent: 'var(--ui-cyan)' },
  { value: 'blocked', label: 'Blocked', description: 'Precisa intervenção', accent: 'var(--ui-red)' },
  { value: 'done', label: 'Done', description: 'Concluído/revisado', accent: 'var(--ui-accent)' }
]

const KANBAN_STATUS_ORDER = STATUSES.map(status => status.value)

const KANBAN_FAST_POLL_MS = 3000
const KANBAN_IDLE_POLL_MS = 10000
const KANBAN_BOARD_PREFS_STORAGE_KEY = 'mia-kanban-board-preferences'
const JURISHUB_WORKFLOW_PRESET_ID = 'jurishub-standard'
const UNASSIGNED_SELECT_VALUE = '__unassigned__'

const KANBAN_SELECT_TRIGGER_CLASS =
  'h-9 rounded-md border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) text-sm text-(--ui-text-primary)'

const KANBAN_SELECT_CONTENT_CLASS =
  'z-[160] border-(--ui-stroke-secondary) bg-(--ui-bg-elevated) text-(--ui-text-primary)'

const KANBAN_SELECT_ITEM_CLASS =
  'text-(--ui-text-primary) focus:bg-(--ui-control-hover-background) focus:text-(--ui-text-primary) data-[state=checked]:bg-(--ui-control-hover-background)'

type KanbanBoardColumnPreferences = {
  expandedColdStatuses?: KanbanStatus[]
  visibleLimits?: Partial<Record<KanbanStatus, number>>
}

function kanbanBoardPrefsKey(boardSlug: string) {
  return `${KANBAN_BOARD_PREFS_STORAGE_KEY}:${boardSlug}`
}

function readKanbanBoardColumnPreferences(boardSlug: string): Required<KanbanBoardColumnPreferences> {
  try {
    const raw = window.localStorage.getItem(kanbanBoardPrefsKey(boardSlug))
    const parsed = raw ? (JSON.parse(raw) as KanbanBoardColumnPreferences) : null

    return {
      expandedColdStatuses: parsed?.expandedColdStatuses ?? [],
      visibleLimits: parsed?.visibleLimits ?? {}
    }
  } catch {
    return { expandedColdStatuses: [], visibleLimits: {} }
  }
}

function writeKanbanBoardColumnPreferences(boardSlug: string, preferences: Required<KanbanBoardColumnPreferences>) {
  window.localStorage.setItem(kanbanBoardPrefsKey(boardSlug), JSON.stringify(preferences))
}


function isKanbanShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return Boolean(
    target.closest(
      'input, textarea, select, button, [contenteditable="true"], [role="textbox"], [role="combobox"], [role="listbox"], [role="option"], [role="menu"], [role="menuitem"]'
    )
  )
}

interface TimelineItem {
  body?: string
  key: string
  label: string
  meta?: string
  payload?: unknown
  time: number
  type: 'comment' | 'event' | 'failure' | 'run'
}

function formatTime(value?: null | number) {
  if (!value) {
    return '—'
  }

  return new Date(value * 1000).toLocaleString()
}

function formatShortDuration(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds))

  if (safeSeconds < 60) {
    return `${safeSeconds}s`
  }

  const minutes = Math.floor(safeSeconds / 60)

  if (minutes < 60) {
    return `${minutes}m`
  }

  const hours = Math.floor(minutes / 60)

  if (hours < 24) {
    return `${hours}h`
  }

  return `${Math.floor(hours / 24)}d`
}

function formatAgo(value: null | number | undefined, nowSeconds: number) {
  if (!value) {
    return '—'
  }

  return `há ${formatShortDuration(nowSeconds - value)}`
}

function kanbanWorkspaceKind(value?: null | string) {
  return value === 'scratch' || value === 'dir' || value === 'worktree' ? value : 'scratch'
}

function latestRunTimestamp(run: { ended_at?: null | number; started_at?: null | number }) {
  const endedAt = typeof run.ended_at === 'number' ? run.ended_at : null
  const startedAt = typeof run.started_at === 'number' ? run.started_at : null

  return endedAt ?? startedAt ?? 0
}

function buildTimeline(detail: KanbanTaskDetailResponse | null): TimelineItem[] {
  if (!detail) {
    return []
  }

  const comments: TimelineItem[] = detail.comments.map(comment => ({
    body: comment.body,
    key: `comment-${comment.id}`,
    label: `Comentário · ${comment.author}`,
    time: comment.created_at,
    type: 'comment'
  }))

  const events: TimelineItem[] = detail.events.map(event => ({
    key: `event-${event.id}`,
    label: `Evento · ${event.kind}`,
    meta: event.run_id ? `run ${event.run_id}` : undefined,
    payload: event.payload,
    time: event.created_at,
    type: 'event'
  }))

  const failures: TimelineItem[] = (detail.failures ?? []).map((failure, index) => ({
    body: failure.error || failure.summary || failure.outcome || failure.kind || 'Falha sem mensagem',
    key: `failure-${failure.source}-${failure.run_id ?? failure.event_id ?? index}`,
    label: `Falha · ${failure.source}`,
    meta: failure.profile ?? undefined,
    payload: failure.payload,
    time: failure.started_at ?? failure.ended_at ?? 0,
    type: 'failure'
  }))

  const runs: TimelineItem[] = detail.runs.map((run, index) => ({
    body: run.summary ? String(run.summary) : run.error ? String(run.error) : undefined,
    key: `run-${String(run.id ?? index)}`,
    label: `Run · ${String(run.status ?? 'run')}`,
    meta: run.profile ? String(run.profile) : undefined,
    payload: run,
    time: latestRunTimestamp(run),
    type: 'run'
  }))

  return [...comments, ...events, ...failures, ...runs].sort((left, right) => right.time - left.time)
}

function latestTaskSignal(task: KanbanTask, nowSeconds: number) {
  if (task.status === 'running') {
    if (task.last_heartbeat_at) {
      return `heartbeat ${formatAgo(task.last_heartbeat_at, nowSeconds)}`
    }

    if (task.started_at) {
      return `rodando ${formatAgo(task.started_at, nowSeconds)}`
    }

    return 'rodando agora'
  }

  if (task.last_failure_error) {
    return 'última falha registrada'
  }

  if (task.completed_at) {
    return `concluído ${formatAgo(task.completed_at, nowSeconds)}`
  }

  return task.started_at ? `iniciado ${formatAgo(task.started_at, nowSeconds)}` : null
}

function formatPayload(value: unknown) {
  if (!value) {
    return ''
  }

  if (typeof value !== 'string') {
    return JSON.stringify(value, null, 2)
  }

  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}


function splitWorkflowFormList(value: string) {
  return value
    .split(/[\n,]/)
    .map(item => item.trim())
    .filter(Boolean)
}

export function KanbanView({ setStatusbarItemGroup }: KanbanViewProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const query = useMemo(() => new URLSearchParams(location.search), [location.search])
  const requestedBoardSlug = query.get('board')
  const requestedTaskId = query.get('task')
  const [assignees, setAssignees] = useState<string[]>([])
  const [boards, setBoards] = useState<KanbanBoard[]>([])
  const [selectedBoardSlug, setSelectedBoardSlug] = useState<string | null>(null)
  const [tasks, setTasks] = useState<KanbanTask[]>([])
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null)
  const [detail, setDetail] = useState<KanbanTaskDetailResponse | null>(null)
  const [dispatcherStatus, setDispatcherStatus] = useState<KanbanDispatcherStatusResponse | null>(null)
  const [form, setForm] = useState<TaskFormState>(EMPTY_FORM)
  const [createOpen, setCreateOpen] = useState(false)
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null)
  const [expandedColdStatuses, setExpandedColdStatuses] = useState<KanbanStatus[]>([])
  const [columnVisibleLimits, setColumnVisibleLimits] = useState<Partial<Record<KanbanStatus, number>>>({})
  const [preferencesBoardSlug, setPreferencesBoardSlug] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000))
  const [saving, setSaving] = useState(false)
  const pollInFlightRef = useRef(false)

  const selectedBoard = useMemo(
    () => boards.find(board => board.slug === selectedBoardSlug) ?? boards[0] ?? null,
    [boards, selectedBoardSlug]
  )

  const boardTenant = selectedBoard?.slug ? selectedBoard.slug.toLowerCase() : ''
  const boardDensity = useMemo(() => getKanbanBoardDensity(tasks), [tasks])

  const keyboardTasks = useMemo(
    () =>
      STATUSES.flatMap(column =>
        buildKanbanColumnView({
          expandedStatuses: expandedColdStatuses,
          status: column.value,
          tasks,
          visibleLimit: columnVisibleLimits[column.value] ?? boardDensity.defaultPageSize
        }).visibleTasks
      ),
    [boardDensity.defaultPageSize, columnVisibleLimits, expandedColdStatuses, tasks]
  )

  useEffect(() => {
    if (!selectedBoard?.slug) {
      setExpandedColdStatuses([])
      setColumnVisibleLimits({})
      setPreferencesBoardSlug(null)

      return
    }

    const preferences = readKanbanBoardColumnPreferences(selectedBoard.slug)
    setExpandedColdStatuses(preferences.expandedColdStatuses)
    setColumnVisibleLimits(preferences.visibleLimits)
    setPreferencesBoardSlug(selectedBoard.slug)
  }, [selectedBoard?.slug])

  useEffect(() => {
    if (!selectedBoard?.slug || preferencesBoardSlug !== selectedBoard.slug) {
      return
    }

    writeKanbanBoardColumnPreferences(selectedBoard.slug, {
      expandedColdStatuses,
      visibleLimits: columnVisibleLimits
    })
  }, [columnVisibleLimits, expandedColdStatuses, preferencesBoardSlug, selectedBoard?.slug])

  const toggleColdStatus = useCallback((status: KanbanStatus) => {
    setExpandedColdStatuses(current =>
      current.includes(status) ? current.filter(item => item !== status) : [...current, status]
    )
  }, [])

  const showMoreInColumn = useCallback(
    (status: KanbanStatus, total: number) => {
      setColumnVisibleLimits(current => {
        const currentLimit = current[status] ?? boardDensity.defaultPageSize
        const nextLimit = currentLimit < 25 ? 25 : currentLimit < 50 ? 50 : total

        return { ...current, [status]: Math.min(nextLimit, total) }
      })
    },
    [boardDensity.defaultPageSize]
  )

  const updateRouteQuery = useCallback(
    (next: { board?: null | string; task?: null | string }, replace = true) => {
      const params = new URLSearchParams(location.search)

      for (const [key, value] of Object.entries(next)) {
        if (value) {
          params.set(key, value)
        } else {
          params.delete(key)
        }
      }

      const search = params.toString()
      navigate({ pathname: '/kanban', search: search ? `?${search}` : '' }, { replace })
    },
    [location.search, navigate]
  )

  const selectBoard = useCallback(
    (slug: string) => {
      setSelectedBoardSlug(slug)
      setSelectedTaskId(null)
      setDetailTaskId(null)
      updateRouteQuery({ board: slug, task: null })
    },
    [updateRouteQuery]
  )

  const selectedTask = useMemo(() => tasks.find(task => task.id === selectedTaskId) ?? null, [selectedTaskId, tasks])
  const detailTask = useMemo(() => tasks.find(task => task.id === detailTaskId) ?? null, [detailTaskId, tasks])

  const refreshBoards = useCallback(async () => {
    const next = await getKanbanBoards()
    setBoards(next)
    setSelectedBoardSlug(current =>
      current ?? next.find(board => board.slug === requestedBoardSlug)?.slug ?? next.find(board => board.slug === 'jur')?.slug ?? next[0]?.slug ?? null
    )
  }, [requestedBoardSlug])

  useEffect(() => {
    if (!requestedBoardSlug || !boards.some(board => board.slug === requestedBoardSlug)) {
      return
    }

    setSelectedBoardSlug(requestedBoardSlug)
  }, [boards, requestedBoardSlug])

  const refreshDispatcherStatus = useCallback(async (slug: string) => {
    const next = await getKanbanDispatcherStatus(slug)
    setDispatcherStatus(next)

    return next
  }, [])

  const refreshTasks = useCallback(async (slug: string) => {
    const result = await getKanbanTasks(slug)
    setTasks(result.tasks)
    setSelectedTaskId(current => (current && result.tasks.some(task => task.id === current) ? current : null))
    setDetailTaskId(current => (current && result.tasks.some(task => task.id === current) ? current : null))
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)

    try {
      await Promise.all([refreshBoards(), getKanbanAssignees().then(setAssignees)])
    } catch (error) {
      notifyError(error, 'Failed to load Kanban')
    } finally {
      setLoading(false)
    }
  }, [refreshBoards])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!selectedBoard?.slug) {
      setTasks([])

      return
    }

    void Promise.all([refreshTasks(selectedBoard.slug), refreshDispatcherStatus(selectedBoard.slug)]).catch(error =>
      notifyError(error, 'Failed to load Kanban tasks')
    )
  }, [refreshDispatcherStatus, refreshTasks, selectedBoard?.slug])

  useEffect(() => {
    const timer = window.setInterval(() => setNowSeconds(Math.floor(Date.now() / 1000)), 1000)

    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!selectedBoard?.slug) {
      return
    }

    const intervalMs = tasks.some(task => task.status === 'running') ? KANBAN_FAST_POLL_MS : KANBAN_IDLE_POLL_MS

    const timer = window.setInterval(() => {
      if (pollInFlightRef.current) {
        return
      }

      pollInFlightRef.current = true
      void Promise.all([refreshTasks(selectedBoard.slug), refreshDispatcherStatus(selectedBoard.slug)])
        .catch(error => notifyError(error, 'Failed to auto-refresh Kanban tasks'))
        .finally(() => {
          pollInFlightRef.current = false
        })
    }, intervalMs)

    return () => window.clearInterval(timer)
  }, [refreshDispatcherStatus, refreshTasks, selectedBoard?.slug, tasks])

  const loadTaskDetail = useCallback(
    async (taskId: string) => {
      if (!selectedBoard?.slug) {
        setDetail(null)

        return null
      }

      const next = await getKanbanTaskDetail(selectedBoard.slug, taskId)
      setDetail(next)

      return next
    },
    [selectedBoard?.slug]
  )

  useEffect(() => {
    if (!selectedBoard?.slug || !detailTaskId) {
      setDetail(null)

      return
    }

    void loadTaskDetail(detailTaskId).catch(() => setDetail(null))
  }, [detailTaskId, loadTaskDetail, selectedBoard?.slug])

  useEffect(() => {
    if (!requestedTaskId || !tasks.some(task => task.id === requestedTaskId)) {
      return
    }

    setSelectedTaskId(requestedTaskId)
    setDetailTaskId(requestedTaskId)
  }, [requestedTaskId, tasks])

  useEffect(() => {
    setStatusbarItemGroup?.('kanban', [
      { id: 'kanban-board', label: selectedBoard ? `Board ${selectedBoard.slug}` : 'Kanban' },
      { id: 'kanban-count', label: `${tasks.length} tasks` }
    ])

    return () => setStatusbarItemGroup?.('kanban', [])
  }, [selectedBoard, setStatusbarItemGroup, tasks.length])

  const openTaskDetail = useCallback(
    (taskId: string) => {
      setSelectedTaskId(taskId)
      setDetailTaskId(taskId)
      updateRouteQuery({ board: selectedBoard?.slug ?? selectedBoardSlug, task: taskId })
    },
    [selectedBoard?.slug, selectedBoardSlug, updateRouteQuery]
  )

  const openCreateTask = useCallback(() => {
    setForm(prev => ({
      ...EMPTY_FORM,
      assignee: prev.assignee,
      priority: prev.priority || EMPTY_FORM.priority,
      status: prev.status || EMPTY_FORM.status,
      tenant: boardTenant
    }))
    setCreateOpen(true)
  }, [boardTenant])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        createOpen ||
        detailTaskId ||
        isKanbanShortcutTarget(event.target)
      ) {
        return
      }

      if (!selectedBoard?.slug) {
        return
      }

      if (event.key === 'ArrowDown' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
        event.preventDefault()

        const nextId = nextKeyboardTaskId({
          currentTaskId: selectedTaskId,
          direction: event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 'next' : 'previous',
          statusOrder: KANBAN_STATUS_ORDER,
          tasks: keyboardTasks
        })

        if (nextId) {
          setSelectedTaskId(nextId)
        }

        return
      }

      if (event.key === 'Enter' && selectedTaskId) {
        event.preventDefault()
        openTaskDetail(selectedTaskId)

        return
      }

      if (event.key.toLowerCase() === 'n') {
        event.preventDefault()
        openCreateTask()

        return
      }

      if (event.key.toLowerCase() === 'r') {
        event.preventDefault()
        void Promise.all([refreshTasks(selectedBoard.slug), refreshDispatcherStatus(selectedBoard.slug)]).catch(error =>
          notifyError(error, 'Failed to refresh Kanban')
        )
      }
    }

    window.addEventListener('keydown', onKeyDown)

    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    createOpen,
    detailTaskId,
    openCreateTask,
    openTaskDetail,
    refreshDispatcherStatus,
    refreshTasks,
    selectedBoard?.slug,
    selectedTaskId,
    keyboardTasks
  ])

  const submit = async () => {
    if (!selectedBoard) {
      notify({ title: 'Kanban', message: 'Nenhum board selecionado' })

      return
    }

    if (!form.title.trim()) {
      notify({ title: 'Kanban', message: 'Título do card é obrigatório' })

      return
    }

    setSaving(true)

    const manualWorkdir = form.workspace_path.trim()
    const workspaceKind = manualWorkdir ? 'dir' : selectedBoard.default_workdir ? 'worktree' : 'scratch'

    try {
      const task = await createKanbanTask(selectedBoard.slug, {
        assignee: form.assignee.trim() || null,
        body: form.body.trim() || null,
        priority: Number.parseInt(form.priority, 10) || 0,
        status: form.status,
        tenant: form.tenant.trim() || boardTenant || null,
        title: form.title.trim(),
        workspace_kind: workspaceKind,
        workspace_path: manualWorkdir || null
      })

      setForm(prev => ({ ...prev, body: '', title: '' }))
      setCreateOpen(false)
      await refreshTasks(selectedBoard.slug)
      setSelectedTaskId(task.id)
      setDetailTaskId(task.id)
      updateRouteQuery({ board: selectedBoard.slug, task: task.id })
      notify({ title: 'M.i.A Kanban', message: `Card criado: ${task.title}` })
    } catch (error) {
      notifyError(error, 'Failed to create Kanban task')
    } finally {
      setSaving(false)
    }
  }

  const moveTaskStatus = useCallback(
    async (taskId: string, status: KanbanStatus) => {
      if (!selectedBoard) {
        return
      }

      const task = tasks.find(item => item.id === taskId)

      if (!task || task.status === status) {
        return
      }

      if (!canUseRawKanbanStatusDrop(task, status)) {
        notify({
          title: 'WorkflowRoute',
          message: 'Use Done para concluir etapa, Blocked para bloquear, ou ações da etapa no detalhe.'
        })

        return
      }

      const previousTasks = tasks
      setSelectedTaskId(taskId)

      try {
        const semanticStatus = semanticStepStatusForKanbanDrop(status)
        const currentStep = workflowCurrentStepForTask(task)

        const updated = semanticStatus && currentStep
          ? await updateKanbanWorkflowStep(selectedBoard.slug, taskId, currentStep.id, { status: semanticStatus })
          : await updateKanbanTask(selectedBoard.slug, taskId, { status })

        setTasks(current => current.map(item => (item.id === updated.id ? updated : item)))
        setDetail(current => (current?.task.id === updated.id ? { ...current, task: updated } : current))
      } catch (error) {
        setTasks(previousTasks)
        notifyError(error, 'Failed to move Kanban task')
      }
    },
    [selectedBoard, tasks]
  )

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-(--ui-chat-surface-background) pt-(--titlebar-height) text-(--ui-text-primary)">
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-4 border-b border-(--ui-stroke-secondary) bg-(--ui-chat-surface-background) px-6 py-5 backdrop-blur">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-(--ui-accent)">
            <Codicon name="project" /> M.i.A command board
          </div>
          <h1 className="mt-2 text-2xl font-semibold text-(--ui-text-primary)">Kanban</h1>
          <p className="mt-1 max-w-3xl text-sm text-(--ui-text-secondary)">
            Painel nativo da orquestração. Clique para selecionar; duplo clique ou botão abre detalhes completos.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Select onValueChange={selectBoard} value={selectedBoard?.slug ?? ''}>
            <SelectTrigger className={cn(KANBAN_SELECT_TRIGGER_CLASS, 'w-52 rounded-lg bg-(--ui-bg-elevated) px-3')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className={KANBAN_SELECT_CONTENT_CLASS}>
              {boards.map(board => (
                <SelectItem className={KANBAN_SELECT_ITEM_CLASS} key={board.slug} value={board.slug}>
                  {board.icon} {board.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={openCreateTask} type="button">
            <Codicon name="add" /> Novo card
          </Button>
          <div className="hidden text-right text-[0.68rem] leading-tight text-(--ui-text-quaternary) md:block">
            Auto-refresh
            <br />
            {tasks.some(task => task.status === 'running') ? '3s em execução' : '10s ocioso'}
          </div>
          <Button
            onClick={() => {
              void refresh()

              if (selectedBoard?.slug) {
                void Promise.all([refreshTasks(selectedBoard.slug), refreshDispatcherStatus(selectedBoard.slug)]).catch(error =>
                  notifyError(error, 'Failed to refresh Kanban')
                )
              }
            }}
            type="button"
            variant="secondary"
          >
            Refresh
          </Button>
        </div>
      </div>

      <main className="min-h-0 flex-1 overflow-auto p-5" onClick={() => setSelectedTaskId(null)}>
        {loading ? (
          <div className="rounded-xl border border-(--ui-stroke-secondary) bg-(--ui-bg-elevated) p-6 text-sm text-(--ui-text-tertiary)">
            Carregando Kanban…
          </div>
        ) : !selectedBoard ? (
          <div className="rounded-xl border border-dashed border-(--ui-stroke-primary) bg-(--ui-bg-elevated) p-6 text-sm text-(--ui-text-tertiary)">
            Nenhum board Kanban encontrado ainda.
          </div>
        ) : (
          <div className="min-w-[1180px] space-y-3">
            <DispatcherStatusPanel
              onRefresh={() =>
                selectedBoard?.slug
                  ? void refreshDispatcherStatus(selectedBoard.slug).catch(error => notifyError(error, 'Failed to load dispatcher status'))
                  : undefined
              }
              status={dispatcherStatus}
            />
            <div className="grid grid-cols-7 gap-3">
              {STATUSES.map(column => {
                const columnView = buildKanbanColumnView({
                  expandedStatuses: expandedColdStatuses,
                  status: column.value,
                  tasks,
                  visibleLimit: columnVisibleLimits[column.value] ?? boardDensity.defaultPageSize
                })

                const isColdColumn = boardDensity.coldLaneStatuses.includes(column.value)

                return (
                  <section
                    className={cn(
                      'rounded-2xl border border-(--ui-stroke-secondary) bg-(--ui-bg-elevated) p-3 transition',
                      columnView.collapsed ? 'min-h-32' : 'min-h-[28rem]',
                      draggingTaskId && 'border-(--ui-accent) bg-(--ui-bg-secondary)'
                    )}
                    key={column.value}
                    onDragOver={event => {
                      event.preventDefault()
                      event.dataTransfer.dropEffect = 'move'
                    }}
                    onDrop={event => {
                      event.preventDefault()

                      const taskId =
                        event.dataTransfer.getData('application/x-hermes-kanban-task') ||
                        event.dataTransfer.getData('text/plain')

                      setDraggingTaskId(null)

                      if (taskId) {
                        void moveTaskStatus(taskId, column.value)
                      }
                    }}
                  >
                    <div className="mb-3 flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2 text-sm font-semibold text-(--ui-text-primary)">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: column.accent }} />
                          {column.label}
                        </div>
                        <div className="mt-1 text-[0.68rem] leading-tight text-(--ui-text-tertiary)">
                          {column.description}
                        </div>
                      </div>
                      <span className="rounded-full border border-(--ui-stroke-secondary) px-2 py-0.5 text-xs text-(--ui-accent)">
                        {columnView.total}
                      </span>
                    </div>
                    {boardDensity.compact && isColdColumn && columnView.total > 0 && (
                      <Button
                        className="mb-2 h-7 w-full text-[0.68rem]"
                        onClick={() => toggleColdStatus(column.value)}
                        type="button"
                        variant="secondary"
                      >
                        {columnView.collapsed ? `Expandir ${columnView.total} cards frios` : 'Colapsar coluna fria'}
                      </Button>
                    )}
                    {columnView.collapsed ? (
                      <div className="rounded-lg border border-dashed border-(--ui-stroke-secondary) p-3 text-xs text-(--ui-text-quaternary)">
                        Coluna fria colapsada. Drag/drop continua aceito aqui.
                      </div>
                    ) : (
                      <>
                        {columnView.truncated && (
                          <div className="mb-2 text-[0.68rem] text-(--ui-text-quaternary)">
                            Mostrando {columnView.visibleTasks.length} de {columnView.total}; há {columnView.hiddenCount} ocultos.
                          </div>
                        )}
                        <div className="flex flex-col gap-2 pr-1">
                          {columnView.visibleTasks.map(task => (
                            <TaskCard
                              active={selectedTask?.id === task.id}
                              compact={columnView.compactCards}
                              dragging={draggingTaskId === task.id}
                              key={task.id}
                              nowSeconds={nowSeconds}
                              onDragEnd={() => setDraggingTaskId(null)}
                              onDragStart={event => {
                                event.dataTransfer.effectAllowed = 'move'
                                event.dataTransfer.setData('application/x-hermes-kanban-task', task.id)
                                event.dataTransfer.setData('text/plain', task.id)
                                setDraggingTaskId(task.id)
                              }}
                              onOpenDetail={() => openTaskDetail(task.id)}
                              onSelect={() => setSelectedTaskId(task.id)}
                              task={task}
                            />
                          ))}
                          {columnView.total === 0 && (
                            <div className="rounded-lg border border-dashed border-(--ui-stroke-secondary) p-3 text-xs text-(--ui-text-quaternary)">
                              Vazio
                            </div>
                          )}
                        </div>
                        {columnView.truncated && (
                          <Button
                            className="mt-2 h-8 w-full text-xs"
                            onClick={() => showMoreInColumn(column.value, columnView.total)}
                            type="button"
                            variant="secondary"
                          >
                            Mostrar mais
                          </Button>
                        )}
                      </>
                    )}
                  </section>
                )
              })}
            </div>
          </div>
        )}
      </main>

      <CreateTaskDialog
        assignees={assignees}
        board={selectedBoard}
        form={form}
        onOpenChange={setCreateOpen}
        onSubmit={() => void submit()}
        open={createOpen}
        saving={saving}
        setForm={setForm}
      />

      <TaskDetailDialog
        assignees={assignees}
        boardSlug={selectedBoard?.slug ?? null}
        detail={detailTask ? detail : null}
        onOpenChange={open => {
          if (!open) {
            setDetailTaskId(null)
            updateRouteQuery({ task: null })
          }
        }}
        onRefreshDetail={loadTaskDetail}
        onRefreshDispatcherStatus={() => (selectedBoard?.slug ? refreshDispatcherStatus(selectedBoard.slug) : Promise.resolve(null))}
        onTaskArchived={archivedTaskId => {
          setTasks(current => current.filter(item => item.id !== archivedTaskId))
          setDetail(current => (current?.task.id === archivedTaskId ? null : current))
          setDetailTaskId(current => (current === archivedTaskId ? null : current))
          setSelectedTaskId(current => (current === archivedTaskId ? null : current))
          updateRouteQuery({ task: null })
        }}
        onTaskUpdated={updated => {
          setTasks(current => current.map(item => (item.id === updated.id ? updated : item)))
          setDetail(current => (current?.task.id === updated.id ? { ...current, task: updated } : current))
        }}
        open={!!detailTaskId}
        task={detailTask}
      />
    </div>
  )
}

function DispatcherStatusPanel({
  onRefresh,
  status
}: {
  onRefresh: () => void
  status: KanbanDispatcherStatusResponse | null
}) {
  if (!status) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-(--ui-stroke-secondary) bg-(--ui-bg-elevated) p-3 text-xs text-(--ui-text-tertiary)">
        <span>Diagnóstico dispatcher: carregando…</span>
        <Button onClick={onRefresh} size="sm" type="button" variant="secondary">
          Diagnóstico
        </Button>
      </div>
    )
  }

  const healthy = status.dispatch_in_gateway && status.gateway_pid

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-(--ui-stroke-secondary) bg-(--ui-bg-elevated) p-3 text-xs">
        <div className="flex flex-wrap items-center gap-2 text-(--ui-text-secondary)">
          <span className={cn('rounded px-2 py-1', healthy ? 'bg-(--ui-bg-secondary) text-(--ui-green)' : 'bg-(--ui-bg-secondary) text-(--ui-red)')}>
            dispatcher {healthy ? `ativo pid ${status.gateway_pid}` : 'sem gateway ativo'}
          </span>
          <span className="rounded bg-(--ui-bg-secondary) px-2 py-1 text-(--ui-text-tertiary)">
            dispatch_in_gateway={String(status.dispatch_in_gateway)}
          </span>
          <span className="rounded bg-(--ui-bg-secondary) px-2 py-1 text-(--ui-text-tertiary)">
            ready {status.ready_count} · running {status.running_count} · stale {status.stale_running_count}
          </span>
          <span className="rounded bg-(--ui-bg-secondary) px-2 py-1 text-(--ui-text-tertiary)">
            runs ativos {status.active_runs.length}
          </span>
          <span className={cn('rounded bg-(--ui-bg-secondary) px-2 py-1', status.pending_approvals_count > 0 ? 'text-(--ui-orange)' : 'text-(--ui-text-tertiary)')}>
            approvals {status.pending_approvals_count}
          </span>
          {status.invalid_workflow_route_count ? (
            <span className="rounded bg-(--ui-bg-secondary) px-2 py-1 text-(--ui-red)">
              rotas inválidas {status.invalid_workflow_route_count}
            </span>
          ) : null}
          <span className="rounded bg-(--ui-bg-secondary) px-2 py-1 text-(--ui-text-quaternary)">
            ↑↓ seleciona · Enter abre · N novo · R refresh
          </span>
        </div>
        <Button onClick={onRefresh} size="sm" type="button" variant="secondary">
          Diagnóstico
        </Button>
      </div>
      {status.active_runs.length > 0 && (
        <div className="rounded-xl border border-(--ui-stroke-secondary) bg-(--ui-bg-elevated) p-3 text-xs">
          <div className="mb-2 font-semibold uppercase tracking-[0.16em] text-(--ui-accent)">Runs ativos</div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {status.active_runs.map(run => (
              <div className="rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-2" key={`${run.task_id}-${run.id}`}>
                <div className="flex items-center justify-between gap-2 text-(--ui-text-primary)">
                  <span className="line-clamp-1">{run.title}</span>
                  <span className="rounded bg-(--ui-red) px-1.5 py-0.5 text-white">Live</span>
                </div>
                <div className="mt-1 text-(--ui-text-tertiary)">
                  run {run.id} · {run.profile || 'perfil?'} · {run.step_key || 'sem etapa'}
                </div>
                <div className="mt-1 text-(--ui-text-quaternary)">heartbeat {formatTime(run.last_heartbeat_at)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function CreateTaskDialog({
  assignees,
  board,
  form,
  onOpenChange,
  onSubmit,
  open,
  saving,
  setForm
}: {
  assignees: string[]
  board: KanbanBoard | null
  form: TaskFormState
  onOpenChange: (open: boolean) => void
  onSubmit: () => void
  open: boolean
  saving: boolean
  setForm: React.Dispatch<React.SetStateAction<TaskFormState>>
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-2xl border-(--ui-stroke-secondary) bg-(--ui-bg-elevated) text-(--ui-text-primary)">
        <DialogHeader>
          <DialogTitle className="text-(--ui-text-primary)">Novo card</DialogTitle>
          <DialogDescription>Cria uma tarefa scoped para o dispatcher da M.i.A.</DialogDescription>
        </DialogHeader>
        {board && (
          <div className="rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) px-3 py-2 text-xs text-(--ui-text-tertiary)">
            <div className="font-medium text-(--ui-text-secondary)">Workspace do board: {board.name}</div>
            <div className="mt-1 break-all">Repo fonte: {board.default_workdir || 'não configurado'}</div>
            <div>Base worktree: {board.worktree_base_ref || 'HEAD/auto'}</div>
            <div className="mt-1 text-(--ui-text-quaternary)">Sem workdir manual, o card cria um git worktree isolado a partir desse workspace.</div>
          </div>
        )}
        <div className="grid gap-3">
          <Field label="Título">
            <Input
              className="border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) text-(--ui-text-primary)"
              onChange={event => setForm(prev => ({ ...prev, title: event.target.value }))}
              value={form.title}
            />
          </Field>
          <Field label="Descrição">
            <Textarea
              className="border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) text-(--ui-text-primary)"
              onChange={event => setForm(prev => ({ ...prev, body: event.target.value }))}
              rows={6}
              value={form.body}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Status">
              <Select
                onValueChange={value => setForm(prev => ({ ...prev, status: value as KanbanStatus }))}
                value={form.status}
              >
                <SelectTrigger className={KANBAN_SELECT_TRIGGER_CLASS}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className={KANBAN_SELECT_CONTENT_CLASS}>
                  {STATUSES.map(status => (
                    <SelectItem className={KANBAN_SELECT_ITEM_CLASS} key={status.value} value={status.value}>
                      {status.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Assignee">
              <Select
                onValueChange={value =>
                  setForm(prev => ({ ...prev, assignee: value === UNASSIGNED_SELECT_VALUE ? '' : value }))
                }
                value={form.assignee || UNASSIGNED_SELECT_VALUE}
              >
                <SelectTrigger className={KANBAN_SELECT_TRIGGER_CLASS}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className={KANBAN_SELECT_CONTENT_CLASS}>
                  <SelectItem className={KANBAN_SELECT_ITEM_CLASS} value={UNASSIGNED_SELECT_VALUE}>
                    Sem perfil
                  </SelectItem>
                  {assignees.map(name => (
                    <SelectItem className={KANBAN_SELECT_ITEM_CLASS} key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-[1fr_7rem] gap-3">
            <Field label="Tenant">
              <Input
                className="border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) text-(--ui-text-primary)"
                onChange={event => setForm(prev => ({ ...prev, tenant: event.target.value }))}
                value={form.tenant}
              />
            </Field>
            <Field label="Prioridade">
              <Input
                className="border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) text-(--ui-text-primary)"
                onChange={event => setForm(prev => ({ ...prev, priority: event.target.value }))}
                type="number"
                value={form.priority}
              />
            </Field>
          </div>
          <Field label="Workdir manual (opcional)">
            <Input
              className="border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) text-(--ui-text-primary)"
              onChange={event => setForm(prev => ({ ...prev, workspace_path: event.target.value }))}
              placeholder="vazio = worktree automático do workspace selecionado"
              value={form.workspace_path}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} type="button" variant="secondary">
            Cancelar
          </Button>
          <Button disabled={saving} onClick={onSubmit} type="button">
            {saving ? 'Criando…' : 'Criar card'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TaskDetailDialog({
  assignees,
  boardSlug,
  detail,
  onTaskArchived,
  onOpenChange,
  onRefreshDetail,
  onRefreshDispatcherStatus,
  onTaskUpdated,
  open,
  task
}: {
  assignees: string[]
  boardSlug: null | string
  detail: KanbanTaskDetailResponse | null
  onTaskArchived: (taskId: string) => void
  onOpenChange: (open: boolean) => void
  onRefreshDetail: (taskId: string) => Promise<KanbanTaskDetailResponse | null>
  onRefreshDispatcherStatus: () => Promise<KanbanDispatcherStatusResponse | null>
  onTaskUpdated: (task: KanbanTask) => void
  open: boolean
  task: KanbanTask | null
}) {
  const activeTask = detail?.task ?? task
  const blockers = detail?.blockers ?? []
  const failures = detail?.failures ?? []
  const [commentBody, setCommentBody] = useState('')
  const [editForm, setEditForm] = useState<TaskFormState>(EMPTY_FORM)
  const [editingCommentBody, setEditingCommentBody] = useState('')
  const [editingCommentId, setEditingCommentId] = useState<null | number>(null)
  const [expandedCommentId, setExpandedCommentId] = useState<null | number>(null)
  const [savingComment, setSavingComment] = useState(false)
  const [savingCommentEdit, setSavingCommentEdit] = useState(false)
  const [savingTask, setSavingTask] = useState(false)
  const [archivingTask, setArchivingTask] = useState(false)
  const [workflowEvidenceBody, setWorkflowEvidenceBody] = useState('')
  const [workflowStepForm, setWorkflowStepForm] = useState<WorkflowStepFormState>(EMPTY_WORKFLOW_STEP_FORM)
  const [savingWorkflowEvidence, setSavingWorkflowEvidence] = useState(false)
  const [savingWorkflowStep, setSavingWorkflowStep] = useState(false)
  const [updatingWorkflowStepId, setUpdatingWorkflowStepId] = useState<null | string>(null)
  const [applyingWorkflowPreset, setApplyingWorkflowPreset] = useState(false)
  const activeTaskId = activeTask?.id ?? null
  const [timelineFilter, setTimelineFilter] = useState<TimelineFilter>('all')
  const timeline = useMemo(() => buildTimeline(detail), [detail])

  const filteredTimeline = useMemo(
    () => (timelineFilter === 'all' ? timeline : timeline.filter(item => item.type === timelineFilter)),
    [timeline, timelineFilter]
  )

  useEffect(() => {
    if (!open || !activeTaskId) {
      return
    }

    const timer = window.setInterval(() => {
      void onRefreshDetail(activeTaskId).catch(() => undefined)
    }, KANBAN_FAST_POLL_MS)

    return () => window.clearInterval(timer)
  }, [activeTaskId, onRefreshDetail, open])

  useEffect(() => {
    if (!open || !activeTask) {
      return
    }

    setCommentBody('')
    setEditingCommentBody('')
    setEditingCommentId(null)
    setExpandedCommentId(null)
    setWorkflowEvidenceBody('')
    setWorkflowStepForm(EMPTY_WORKFLOW_STEP_FORM)
    setEditForm({
      assignee: activeTask.assignee ?? '',
      body: activeTask.body ?? '',
      priority: String(activeTask.priority ?? 0),
      status: activeTask.status,
      tenant: activeTask.tenant ?? '',
      title: activeTask.title,
      workspace_path: activeTask.workspace_path ?? ''
    })
  }, [activeTask, open])

  const saveTask = async () => {
    if (!boardSlug || !activeTask) {
      return
    }

    if (!editForm.title.trim()) {
      notify({ title: 'Kanban', message: 'Título do card é obrigatório' })

      return
    }

    const manualWorkdir = editForm.workspace_path.trim()
    const currentWorkspaceKind = kanbanWorkspaceKind(activeTask.workspace_kind)
    const workspaceKind = manualWorkdir ? 'dir' : currentWorkspaceKind === 'dir' ? 'scratch' : currentWorkspaceKind

    const payload: KanbanTaskUpdatePayload = {
      assignee: editForm.assignee.trim() || null,
      body: editForm.body.trim() || null,
      priority: Number.parseInt(editForm.priority, 10) || 0,
      status: editForm.status,
      tenant: editForm.tenant.trim() || null,
      title: editForm.title.trim(),
      workspace_kind: workspaceKind,
      workspace_path: manualWorkdir || null
    }

    setSavingTask(true)

    try {
      const updated = await updateKanbanTask(boardSlug, activeTask.id, payload)
      onTaskUpdated(updated)
      await onRefreshDetail(updated.id)
      notify({ title: 'Kanban', message: `Card atualizado: ${updated.title}` })
    } catch (error) {
      notifyError(error, 'Failed to update Kanban task')
    } finally {
      setSavingTask(false)
    }
  }

  const archiveTask = async () => {
    if (!boardSlug || !activeTask) {
      return
    }

    setArchivingTask(true)

    try {
      await updateKanbanTask(boardSlug, activeTask.id, { status: 'archived' })
      onTaskArchived(activeTask.id)
      notify({ title: 'Kanban', message: `Card arquivado: ${activeTask.title}` })
    } catch (error) {
      notifyError(error, 'Failed to archive Kanban task')
    } finally {
      setArchivingTask(false)
    }
  }

  const addComment = async (intent?: 'interrupt' | 'resume') => {
    if (!boardSlug || !activeTask) {
      return
    }

    const fallbackBody = intent === 'resume' ? 'Retomar card' : intent === 'interrupt' ? 'Solicitar interrupção do run ativo' : ''
    const body = commentBody.trim() || fallbackBody

    if (!body) {
      notify({ title: 'Kanban', message: 'Comentário vazio' })

      return
    }

    setSavingComment(true)

    try {
      await createKanbanTaskComment(boardSlug, activeTask.id, { author: 'desktop', body, ...(intent ? { intent } : {}) })
      setCommentBody('')
      await onRefreshDetail(activeTask.id)
      notify({
        title: 'Kanban',
        message: intent === 'resume' ? 'Retomada solicitada' : intent === 'interrupt' ? 'Interrupção solicitada' : 'Comentário adicionado'
      })
    } catch (error) {
      notifyError(error, 'Failed to create Kanban comment')
    } finally {
      setSavingComment(false)
    }
  }

  const saveCommentEdit = async (commentId: number) => {
    if (!boardSlug || !activeTask) {
      return
    }

    const body = editingCommentBody.trim()

    if (!body) {
      notify({ title: 'Kanban', message: 'Comentário vazio' })

      return
    }

    setSavingCommentEdit(true)

    try {
      await updateKanbanTaskComment(boardSlug, activeTask.id, commentId, { author: 'desktop', body })
      setEditingCommentBody('')
      setEditingCommentId(null)
      await onRefreshDetail(activeTask.id)
      notify({ title: 'Kanban', message: 'Comentário atualizado' })
    } catch (error) {
      notifyError(error, 'Failed to update Kanban comment')
    } finally {
      setSavingCommentEdit(false)
    }
  }

  const applyWorkflowPreset = async () => {
    if (!boardSlug || !activeTask) {
      return
    }

    setApplyingWorkflowPreset(true)

    try {
      const updated = await applyKanbanWorkflowPreset(boardSlug, activeTask.id, {
        assignee: activeTask.assignee ?? null,
        preset_id: JURISHUB_WORKFLOW_PRESET_ID
      })

      onTaskUpdated(updated)
      await onRefreshDetail(updated.id)
      notify({ title: 'Kanban', message: 'Preset JurisHUB aplicado' })
    } catch (error) {
      notifyError(error, 'Failed to apply Kanban workflow preset')
    } finally {
      setApplyingWorkflowPreset(false)
    }
  }

  const addWorkflowEvidence = async () => {
    if (!boardSlug || !activeTask) {
      return
    }

    const body = workflowEvidenceBody.trim()
    const currentStep = workflowCurrentStepForTask(activeTask)

    if (!body) {
      notify({ title: 'Kanban', message: 'Evidência vazia' })

      return
    }

    if (!currentStep) {
      notify({ title: 'Kanban', message: 'Card sem etapa workflow atual' })

      return
    }

    setSavingWorkflowEvidence(true)

    try {
      const updated = await createKanbanWorkflowEvidence(boardSlug, activeTask.id, {
        step_id: currentStep.id,
        text: body
      })

      setWorkflowEvidenceBody('')
      onTaskUpdated(updated)
      await onRefreshDetail(updated.id)
      notify({ title: 'Kanban', message: `Evidência registrada em ${currentStep.id}` })
    } catch (error) {
      notifyError(error, 'Failed to record Kanban workflow evidence')
    } finally {
      setSavingWorkflowEvidence(false)
    }
  }

  const addWorkflowStep = async () => {
    if (!boardSlug || !activeTask) {
      return
    }

    const stepId = workflowStepForm.id.trim()

    if (!stepId) {
      notify({ title: 'Kanban', message: 'ID da etapa é obrigatório' })

      return
    }

    setSavingWorkflowStep(true)

    try {
      const maxRetries = workflowStepForm.max_retries.trim()

      const updated = await createKanbanWorkflowStep(boardSlug, activeTask.id, {
        assignee: workflowStepForm.assignee.trim() || null,
        depends_on: splitWorkflowFormList(workflowStepForm.depends_on),
        id: stepId,
        max_retries: maxRetries ? Number.parseInt(maxRetries, 10) || 0 : null,
        title: workflowStepForm.title.trim() || stepId,
        type: workflowStepForm.type.trim() || 'custom',
        validation_criteria: splitWorkflowFormList(workflowStepForm.validation_criteria)
      })

      setWorkflowStepForm(EMPTY_WORKFLOW_STEP_FORM)
      onTaskUpdated(updated)
      await onRefreshDetail(updated.id)
      notify({ title: 'Kanban', message: `Etapa adicionada: ${stepId}` })
    } catch (error) {
      notifyError(error, 'Failed to add Kanban workflow step')
    } finally {
      setSavingWorkflowStep(false)
    }
  }

  const updateWorkflowStep = async (stepId: string, payload: KanbanWorkflowStepUpdatePayload) => {
    if (!boardSlug || !activeTask) {
      return
    }

    setUpdatingWorkflowStepId(stepId)

    try {
      const updated = await updateKanbanWorkflowStep(boardSlug, activeTask.id, stepId, payload)
      onTaskUpdated(updated)
      await onRefreshDetail(updated.id)
      notify({ title: 'Kanban', message: `Etapa atualizada: ${stepId}` })
    } catch (error) {
      notifyError(error, 'Failed to update Kanban workflow step')
    } finally {
      setUpdatingWorkflowStepId(null)
    }
  }

  const requestWorkflowApproval = async (stepId: string) => {
    if (!boardSlug || !activeTask) {
      return
    }

    setUpdatingWorkflowStepId(stepId)

    try {
      const updated = await requestKanbanWorkflowApproval(boardSlug, activeTask.id, stepId, {
        reason: `Gate solicitado pelo Desktop para ${stepId}`
      })

      onTaskUpdated(updated)
      await onRefreshDetail(updated.id)
      await onRefreshDispatcherStatus()
      notify({ title: 'Kanban', message: `Approval solicitado em ${stepId}` })
    } catch (error) {
      notifyError(error, 'Failed to request Kanban workflow approval')
    } finally {
      setUpdatingWorkflowStepId(null)
    }
  }

  const resolveWorkflowApproval = async (stepId: string, decision: 'approved' | 'rejected') => {
    if (!boardSlug || !activeTask) {
      return
    }

    setUpdatingWorkflowStepId(stepId)

    try {
      const updated = await resolveKanbanWorkflowApproval(boardSlug, activeTask.id, stepId, { decision })
      onTaskUpdated(updated)
      await onRefreshDetail(updated.id)
      await onRefreshDispatcherStatus()
      notify({ title: 'Kanban', message: `Approval ${decision === 'approved' ? 'aprovado' : 'rejeitado'} em ${stepId}` })
    } catch (error) {
      notifyError(error, 'Failed to resolve Kanban workflow approval')
    } finally {
      setUpdatingWorkflowStepId(null)
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="flex h-[min(92vh,58rem)] max-h-[92vh] max-w-6xl flex-col overflow-hidden border-(--ui-stroke-secondary) bg-(--ui-chat-bubble-background) p-0 text-(--ui-text-primary)">
        <DialogHeader className="shrink-0 border-b border-(--ui-stroke-secondary) px-5 py-4">
          <DialogTitle className="pr-8 text-(--ui-text-primary)">{activeTask?.title ?? 'Card'}</DialogTitle>
          <DialogDescription>
            {activeTask ? `${activeTask.id} · ${activeTask.assignee || 'sem perfil'}` : 'Carregando detalhes…'}
          </DialogDescription>
        </DialogHeader>
        {activeTask ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-sm">
            <div className="grid gap-4">
              <AccordionBlock defaultOpen title="Editar card">
                <div className="grid gap-3">
                  <Field label="Título">
                    <Input
                      className="border-(--ui-stroke-secondary) bg-(--ui-bg-chrome) text-(--ui-text-primary)"
                      onChange={event => setEditForm(prev => ({ ...prev, title: event.target.value }))}
                      value={editForm.title}
                    />
                  </Field>
                  <Field label="Descrição">
                    <Textarea
                      className="border-(--ui-stroke-secondary) bg-(--ui-bg-chrome) text-(--ui-text-primary)"
                      onChange={event => setEditForm(prev => ({ ...prev, body: event.target.value }))}
                      rows={5}
                      value={editForm.body}
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <Field label="Status">
                      <Select
                        onValueChange={value =>
                          setEditForm(prev => ({ ...prev, status: value as KanbanStatus }))
                        }
                        value={editForm.status}
                      >
                        <SelectTrigger className={KANBAN_SELECT_TRIGGER_CLASS}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className={KANBAN_SELECT_CONTENT_CLASS}>
                          {STATUSES.map(status => (
                            <SelectItem className={KANBAN_SELECT_ITEM_CLASS} key={status.value} value={status.value}>
                              {status.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Assignee">
                      <Select
                        onValueChange={value =>
                          setEditForm(prev => ({ ...prev, assignee: value === UNASSIGNED_SELECT_VALUE ? '' : value }))
                        }
                        value={editForm.assignee || UNASSIGNED_SELECT_VALUE}
                      >
                        <SelectTrigger className={KANBAN_SELECT_TRIGGER_CLASS}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className={KANBAN_SELECT_CONTENT_CLASS}>
                          <SelectItem className={KANBAN_SELECT_ITEM_CLASS} value={UNASSIGNED_SELECT_VALUE}>
                            Sem perfil
                          </SelectItem>
                          {assignees.map(name => (
                            <SelectItem className={KANBAN_SELECT_ITEM_CLASS} key={name} value={name}>
                              {name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Tenant">
                      <Input
                        className="border-(--ui-stroke-secondary) bg-(--ui-bg-chrome) text-(--ui-text-primary)"
                        onChange={event => setEditForm(prev => ({ ...prev, tenant: event.target.value }))}
                        value={editForm.tenant}
                      />
                    </Field>
                    <Field label="Prioridade">
                      <Input
                        className="border-(--ui-stroke-secondary) bg-(--ui-bg-chrome) text-(--ui-text-primary)"
                        onChange={event => setEditForm(prev => ({ ...prev, priority: event.target.value }))}
                        type="number"
                        value={editForm.priority}
                      />
                    </Field>
                  </div>
                  <Field label="Workdir">
                    <Input
                      className="border-(--ui-stroke-secondary) bg-(--ui-bg-chrome) text-(--ui-text-primary)"
                      onChange={event => setEditForm(prev => ({ ...prev, workspace_path: event.target.value }))}
                      value={editForm.workspace_path}
                    />
                  </Field>
                  <div className="flex flex-wrap justify-between gap-2">
                    <Button
                      disabled={archivingTask || savingTask}
                      onClick={() => void archiveTask()}
                      type="button"
                      variant="outline"
                    >
                      {archivingTask ? 'Arquivando…' : 'Arquivar card'}
                    </Button>
                    <Button disabled={savingTask} onClick={() => void saveTask()} type="button">
                      {savingTask ? 'Salvando…' : 'Salvar alterações'}
                    </Button>
                  </div>
                </div>
              </AccordionBlock>

              <AccordionBlock defaultOpen title="Metadados">
                <div className="grid grid-cols-2 gap-2 text-xs text-(--ui-text-tertiary) md:grid-cols-4">
                  <Meta label="Criado" value={formatTime(activeTask.created_at)} />
                  <Meta label="Status" value={activeTask.status} />
                  <Meta label="Prioridade" value={String(activeTask.priority)} />
                  <Meta label="Falhas" value={String(activeTask.consecutive_failures)} />
                  <Meta label="Tenant" value={activeTask.tenant || '—'} />
                  <Meta label="Workdir" value={activeTask.workspace_path || '—'} />
                  <Meta label="Branch" value={activeTask.branch_name || '—'} />
                  <Meta label="Run" value={activeTask.current_run_id ? String(activeTask.current_run_id) : '—'} />
                </div>
              </AccordionBlock>

              <AccordionBlock defaultOpen={blockers.length > 0} title={`Blockers (${blockers.length})`}>
                <div className="space-y-2">
                  {blockers.map(blocker => (
                    <div
                      className="rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-chrome) p-3 text-xs"
                      key={blocker.id}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 text-(--ui-text-primary)">
                        <span className="font-medium">{blocker.title}</span>
                        <span className="rounded bg-(--ui-orange) px-1.5 py-0.5 text-(--ui-bg-primary)">{blocker.status}</span>
                      </div>
                      <div className="mt-1 text-(--ui-text-tertiary)">
                        {blocker.id} · {blocker.assignee || 'sem perfil'}
                      </div>
                    </div>
                  ))}
                  {!blockers.length && <div className="text-xs text-(--ui-text-quaternary)">Sem blockers abertos.</div>}
                </div>
              </AccordionBlock>

              <WorkflowRoutePanel
                applyingPreset={applyingWorkflowPreset}
                assignees={assignees}
                evidenceBody={workflowEvidenceBody}
                onAddStep={() => void addWorkflowStep()}
                onApplyPreset={() => void applyWorkflowPreset()}
                onEvidenceBodyChange={setWorkflowEvidenceBody}
                onRecordEvidence={() => void addWorkflowEvidence()}
                onRequestApproval={stepId => void requestWorkflowApproval(stepId)}
                onResolveApproval={(stepId, decision) => void resolveWorkflowApproval(stepId, decision)}
                onStepFormChange={setWorkflowStepForm}
                onUpdateStep={(stepId, payload) => void updateWorkflowStep(stepId, payload)}
                savingEvidence={savingWorkflowEvidence}
                savingStep={savingWorkflowStep}
                stepForm={workflowStepForm}
                task={activeTask}
                updatingStepId={updatingWorkflowStepId}
              />

              <AccordionBlock defaultOpen title={`Atividade recente (${filteredTimeline.length}/${timeline.length})`}>
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {(['all', 'event', 'comment', 'run', 'failure'] as TimelineFilter[]).map(filter => (
                      <Button
                        className="h-7 px-2 text-[0.68rem]"
                        key={filter}
                        onClick={() => setTimelineFilter(filter)}
                        type="button"
                        variant={timelineFilter === filter ? 'default' : 'secondary'}
                      >
                        {filter === 'all' ? 'todos' : filter}
                      </Button>
                    ))}
                  </div>
                  <div className="space-y-2">
                    {filteredTimeline.map(item => (
                      <TimelineCard item={item} key={item.key} />
                    ))}
                    {!filteredTimeline.length && <div className="text-xs text-(--ui-text-quaternary)">Sem atividade para este filtro.</div>}
                  </div>
                </div>
              </AccordionBlock>

              {activeTask.result && (
                <AccordionBlock title="Resultado">
                  <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-(--ui-text-secondary)">
                    {activeTask.result}
                  </pre>
                </AccordionBlock>
              )}

              <AccordionBlock defaultOpen={failures.length > 0} title={`Falhas detectadas (${failures.length})`}>
                <div className="space-y-2">
                  {failures.map((failure, index) => (
                    <FailureCard
                      failure={failure}
                      key={`${failure.source}-${failure.run_id ?? failure.event_id ?? index}`}
                    />
                  ))}
                  {!failures.length && (
                    <div className="text-xs text-(--ui-text-quaternary)">Sem falhas registradas.</div>
                  )}
                </div>
              </AccordionBlock>

              <AccordionBlock title={`Eventos completos (${detail?.events.length ?? 0})`}>
                <div className="space-y-2">
                  {(detail?.events ?? []).map(event => {
                    const payload = formatPayload(event.payload)

                    return (
                      <div
                        className="rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-chrome) p-3 text-xs"
                        key={event.id}
                      >
                        <div className="flex flex-wrap justify-between gap-2 text-(--ui-text-primary)">
                          <span>{event.kind}</span>
                          <span className="text-(--ui-text-quaternary)">{formatTime(event.created_at)}</span>
                        </div>
                        {payload && (
                          <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded bg-(--ui-bg-secondary) p-2 text-(--ui-text-tertiary)">
                            {payload}
                          </pre>
                        )}
                      </div>
                    )
                  })}
                  {!detail?.events?.length && (
                    <div className="text-xs text-(--ui-text-quaternary)">Sem eventos ainda.</div>
                  )}
                </div>
              </AccordionBlock>

              <AccordionBlock defaultOpen title={`Comentários (${detail?.comments.length ?? 0})`}>
                <div className="space-y-3">
                  <div className="rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-chrome) p-3">
                    <Textarea
                      className="min-h-24 border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) text-(--ui-text-primary)"
                      onChange={event => setCommentBody(event.target.value)}
                      placeholder="Adicionar comentário operacional…"
                      value={commentBody}
                    />
                    <div className="mt-2 flex flex-wrap justify-end gap-2">
                      <Button
                        disabled={savingComment || activeTask.status !== 'blocked'}
                        onClick={() => void addComment('resume')}
                        size="sm"
                        type="button"
                        variant="secondary"
                      >
                        Retomar
                      </Button>
                      <Button
                        disabled={savingComment || !activeTask.current_run_id}
                        onClick={() => void addComment('interrupt')}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        Interromper run
                      </Button>
                      <Button disabled={savingComment} onClick={() => void addComment()} size="sm" type="button">
                        {savingComment ? 'Enviando…' : 'Comentar'}
                      </Button>
                    </div>
                  </div>
                  {(detail?.comments ?? []).map(comment => (
                    <CommentCard
                      comment={comment}
                      editing={editingCommentId === comment.id}
                      editingBody={editingCommentId === comment.id ? editingCommentBody : ''}
                      expanded={expandedCommentId === comment.id}
                      key={comment.id}
                      onCancelEdit={() => {
                        setEditingCommentBody('')
                        setEditingCommentId(null)
                      }}
                      onEdit={() => {
                        setEditingCommentBody(comment.body)
                        setEditingCommentId(comment.id)
                      }}
                      onEditingBodyChange={setEditingCommentBody}
                      onSave={() => void saveCommentEdit(comment.id)}
                      onToggleExpanded={() =>
                        setExpandedCommentId(current => (current === comment.id ? null : comment.id))
                      }
                      saving={savingCommentEdit}
                    />
                  ))}
                  {!detail?.comments?.length && (
                    <div className="text-xs text-(--ui-text-quaternary)">Sem comentários ainda.</div>
                  )}
                </div>
              </AccordionBlock>

              <AccordionBlock title={`Runs (${detail?.runs.length ?? 0})`}>
                <div className="space-y-2">
                  {(detail?.runs ?? []).map((run, index) => (
                    <RunCard key={String(run.id ?? index)} run={run} />
                  ))}
                  {!detail?.runs?.length && <div className="text-xs text-(--ui-text-quaternary)">Sem runs ainda.</div>}
                </div>
              </AccordionBlock>
            </div>
          </div>
        ) : (
          <div className="m-5 rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-4 text-sm text-(--ui-text-tertiary)">
            Carregando detalhes…
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function WorkflowRoutePanel({
  applyingPreset,
  assignees,
  evidenceBody,
  onAddStep,
  onApplyPreset,
  onEvidenceBodyChange,
  onRecordEvidence,
  onRequestApproval,
  onResolveApproval,
  onStepFormChange,
  onUpdateStep,
  savingEvidence,
  savingStep,
  stepForm,
  task,
  updatingStepId
}: {
  applyingPreset: boolean
  assignees: string[]
  evidenceBody: string
  onAddStep: () => void
  onApplyPreset: () => void
  onEvidenceBodyChange: (value: string) => void
  onRecordEvidence: () => void
  onRequestApproval: (stepId: string) => void
  onResolveApproval: (stepId: string, decision: 'approved' | 'rejected') => void
  onStepFormChange: React.Dispatch<React.SetStateAction<WorkflowStepFormState>>
  onUpdateStep: (stepId: string, payload: KanbanWorkflowStepUpdatePayload) => void
  savingEvidence: boolean
  savingStep: boolean
  stepForm: WorkflowStepFormState
  task: KanbanTask
  updatingStepId: null | string
}) {
  const route = workflowRouteForTask(task)
  const currentStep = workflowCurrentStepForTask(task)
  const progress = workflowProgress(task)

  if (!route) {
    return (
      <AccordionBlock title="WorkflowRoute">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs text-(--ui-text-tertiary)">Card legado: sem rota multi-agente.</div>
          </div>
          <Button disabled={applyingPreset} onClick={onApplyPreset} size="sm" type="button">
            {applyingPreset ? 'Aplicando…' : 'Aplicar preset JurisHUB'}
          </Button>
        </div>
      </AccordionBlock>
    )
  }

  return (
    <AccordionBlock defaultOpen title={`WorkflowRoute (${progress.passed}/${progress.total})`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs text-(--ui-text-tertiary)">
            {route.template_id || 'custom'} · etapa atual {currentStep?.id ?? '—'} · {progress.passed}/{progress.total} concluídas
          </div>
        </div>
        <span className="rounded-full border border-(--ui-stroke-secondary) px-2 py-0.5 text-xs text-(--ui-cyan)">
          v{route.version ?? 1}
        </span>
      </div>

      <div className="mt-3 space-y-2">
        {route.steps.map(step => {
          const active = step.id === currentStep?.id
          const evidence = step.evidence ?? []
          const approval = step.approval
          const approvalPending = approval?.status === 'pending'

          return (
            <div
              className={cn(
                'rounded-lg border bg-(--ui-bg-chrome) p-3 text-xs',
                active ? 'border-(--ui-accent)' : 'border-(--ui-stroke-secondary)',
                step.status === 'blocked' && 'border-(--ui-red)'
              )}
              key={step.id}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 text-(--ui-text-primary)">
                <span>
                  {active ? '● ' : ''}{step.id} · {step.title || step.id}
                </span>
                <span className="rounded bg-(--ui-bg-secondary) px-1.5 py-0.5 text-(--ui-text-tertiary)">
                  {step.status} · @{step.assignee || '—'}
                </span>
              </div>
              <div className="mt-1 text-(--ui-text-tertiary)">
                tipo {step.type || 'custom'} · retry {step.retry_count ?? 0}/{step.max_retries ?? '∞'}
              </div>
              {approval?.status && (
                <div className="mt-2 rounded border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-2 text-(--ui-text-tertiary)">
                  Approval: <span className="text-(--ui-accent)">{approval.status}</span>
                  {approval.reason ? ` · ${approval.reason}` : ''}
                </div>
              )}
              <div className="mt-3 grid gap-2 md:grid-cols-[10rem_1fr_auto_auto_auto_auto_auto]">
                <Select
                  disabled={updatingStepId === step.id}
                  onValueChange={value => onUpdateStep(step.id, { status: value as KanbanWorkflowStepStatus })}
                  value={step.status}
                >
                  <SelectTrigger className={KANBAN_SELECT_TRIGGER_CLASS}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className={KANBAN_SELECT_CONTENT_CLASS}>
                    {WORKFLOW_STEP_STATUSES.map(status => (
                      <SelectItem className={KANBAN_SELECT_ITEM_CLASS} key={status} value={status}>
                        {status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  disabled={updatingStepId === step.id}
                  onValueChange={value => onUpdateStep(step.id, { assignee: value === UNASSIGNED_SELECT_VALUE ? null : value })}
                  value={step.assignee || UNASSIGNED_SELECT_VALUE}
                >
                  <SelectTrigger className={KANBAN_SELECT_TRIGGER_CLASS}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className={KANBAN_SELECT_CONTENT_CLASS}>
                    <SelectItem className={KANBAN_SELECT_ITEM_CLASS} value={UNASSIGNED_SELECT_VALUE}>
                      Sem perfil
                    </SelectItem>
                    {assignees.map(name => (
                      <SelectItem className={KANBAN_SELECT_ITEM_CLASS} key={name} value={name}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  disabled={updatingStepId === step.id}
                  onClick={() => onUpdateStep(step.id, { status: 'passed' })}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  Passar
                </Button>
                <Button
                  disabled={updatingStepId === step.id}
                  onClick={() => onUpdateStep(step.id, { status: 'blocked' })}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Bloquear
                </Button>
                <Button
                  disabled={updatingStepId === step.id || approvalPending}
                  onClick={() => onRequestApproval(step.id)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Approval
                </Button>
                <Button
                  disabled={updatingStepId === step.id || !approvalPending}
                  onClick={() => onResolveApproval(step.id, 'approved')}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  Aprovar
                </Button>
                <Button
                  disabled={updatingStepId === step.id || !approvalPending}
                  onClick={() => onResolveApproval(step.id, 'rejected')}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Rejeitar
                </Button>
              </div>
              {!!step.depends_on?.length && (
                <div className="mt-1 text-(--ui-text-quaternary)">depende de: {step.depends_on.join(', ')}</div>
              )}
              {!!step.validation_criteria?.length && (
                <ul className="mt-2 list-disc space-y-1 pl-4 text-(--ui-text-secondary)">
                  {step.validation_criteria.map((criterion, index) => (
                    <li key={`${step.id}-criterion-${index}`}>{criterion}</li>
                  ))}
                </ul>
              )}
              {!!evidence.length && (
                <div className="mt-2 rounded bg-(--ui-bg-secondary) p-2 text-(--ui-text-tertiary)">
                  <div className="mb-1 text-[0.65rem] uppercase tracking-[0.14em] text-(--ui-text-quaternary)">
                    Evidência recente
                  </div>
                  {evidence.slice(-3).map((item, index) => (
                    <div className="mt-1 whitespace-pre-wrap break-words" key={`${step.id}-evidence-${index}`}>
                      {item.text || item.kind || JSON.stringify(item)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="mt-3 rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-chrome) p-3">
        <div className="mb-2 text-xs font-medium text-(--ui-text-secondary)">Adicionar etapa</div>
        <div className="grid gap-2 md:grid-cols-[10rem_1fr_9rem_1fr]">
          <Input
            className="border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) text-(--ui-text-primary)"
            onChange={event => onStepFormChange(prev => ({ ...prev, id: event.target.value }))}
            placeholder="id-etapa"
            value={stepForm.id}
          />
          <Input
            className="border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) text-(--ui-text-primary)"
            onChange={event => onStepFormChange(prev => ({ ...prev, title: event.target.value }))}
            placeholder="Título"
            value={stepForm.title}
          />
          <Input
            className="border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) text-(--ui-text-primary)"
            onChange={event => onStepFormChange(prev => ({ ...prev, type: event.target.value }))}
            placeholder="tipo"
            value={stepForm.type}
          />
          <Select
            onValueChange={value => onStepFormChange(prev => ({ ...prev, assignee: value === UNASSIGNED_SELECT_VALUE ? '' : value }))}
            value={stepForm.assignee || UNASSIGNED_SELECT_VALUE}
          >
            <SelectTrigger className={KANBAN_SELECT_TRIGGER_CLASS}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className={KANBAN_SELECT_CONTENT_CLASS}>
              <SelectItem className={KANBAN_SELECT_ITEM_CLASS} value={UNASSIGNED_SELECT_VALUE}>
                Sem perfil
              </SelectItem>
              {assignees.map(name => (
                <SelectItem className={KANBAN_SELECT_ITEM_CLASS} key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="mt-2 grid gap-2 md:grid-cols-[1fr_1fr_7rem_auto]">
          <Input
            className="border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) text-(--ui-text-primary)"
            onChange={event => onStepFormChange(prev => ({ ...prev, depends_on: event.target.value }))}
            placeholder="depends_on: plan,review"
            value={stepForm.depends_on}
          />
          <Input
            className="border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) text-(--ui-text-primary)"
            onChange={event => onStepFormChange(prev => ({ ...prev, validation_criteria: event.target.value }))}
            placeholder="critério 1, critério 2"
            value={stepForm.validation_criteria}
          />
          <Input
            className="border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) text-(--ui-text-primary)"
            onChange={event => onStepFormChange(prev => ({ ...prev, max_retries: event.target.value }))}
            type="number"
            value={stepForm.max_retries}
          />
          <Button disabled={savingStep} onClick={onAddStep} size="sm" type="button">
            {savingStep ? 'Adicionando…' : 'Adicionar'}
          </Button>
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-chrome) p-3">
        <div className="mb-2 text-xs font-medium text-(--ui-text-secondary)">
          Registrar evidência na etapa atual {currentStep?.id ? `(${currentStep.id})` : ''}
        </div>
        <Textarea
          className="min-h-20 border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) text-(--ui-text-primary)"
          disabled={!currentStep}
          onChange={event => onEvidenceBodyChange(event.target.value)}
          placeholder="Comando, resultado, blocker ou decisão da etapa…"
          value={evidenceBody}
        />
        <div className="mt-2 flex justify-end">
          <Button disabled={!currentStep || savingEvidence} onClick={onRecordEvidence} size="sm" type="button">
            {savingEvidence ? 'Registrando…' : 'Registrar evidência'}
          </Button>
        </div>
      </div>
    </AccordionBlock>
  )
}

function TaskCard({
  active,
  compact,
  dragging,
  nowSeconds,
  onDragEnd,
  onDragStart,
  onOpenDetail,
  onSelect,
  task
}: {
  active: boolean
  compact: boolean
  dragging: boolean
  nowSeconds: number
  onDragEnd: () => void
  onDragStart: (event: React.DragEvent<HTMLDivElement>) => void
  onOpenDetail: () => void
  onSelect: () => void
  task: KanbanTask
}) {
  const signal = latestTaskSignal(task, nowSeconds)
  const live = isKanbanTaskLive(task, nowSeconds)
  const currentStep = workflowCurrentStepForTask(task)
  const workflow = workflowProgress(task)
  const evidence = workflowEvidencePreview(currentStep)

  return (
    <div
      className={cn(
        'rounded-xl border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) text-left shadow-sm transition hover:border-(--ui-accent) hover:bg-(--ui-control-hover-background)',
        compact ? 'p-2' : 'p-3',
        active && 'border-(--ui-accent) ring-1 ring-(--ui-accent)',
        dragging && 'opacity-55 ring-1 ring-(--ui-accent)'
      )}
      data-kanban-card="true"
      draggable
      onClick={event => {
        event.stopPropagation()
        onSelect()
      }}
      onDoubleClick={event => {
        event.stopPropagation()
        onOpenDetail()
      }}
      onDragEnd={onDragEnd}
      onDragStart={event => {
        event.stopPropagation()
        onDragStart(event)
      }}
      onKeyDown={event => {
        if (event.key === 'Enter') {
          onOpenDetail()
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="line-clamp-2 text-sm font-medium text-(--ui-text-primary)">{task.title}</div>
      {!compact && task.body && (
        <div className="mt-2 line-clamp-3 text-xs leading-relaxed text-(--ui-text-tertiary)">{task.body}</div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[0.68rem] text-(--ui-text-tertiary)">
        <span className="rounded bg-(--ui-bg-primary) px-1.5 py-0.5">{task.assignee || 'unassigned'}</span>
        {live && <span className="rounded bg-(--ui-red) px-1.5 py-0.5 text-white">Live</span>}
        {workflow.total > 0 && (
          <span className="rounded bg-(--ui-bg-primary) px-1.5 py-0.5 text-(--ui-cyan)">
            wf {currentStep?.id ?? '—'} {workflow.passed}/{workflow.total}
          </span>
        )}
        {evidence && (
          <span className="line-clamp-1 max-w-36 rounded bg-(--ui-bg-primary) px-1.5 py-0.5 text-(--ui-text-tertiary)">
            ev: {evidence}
          </span>
        )}
        {task.tenant && <span className="rounded bg-(--ui-bg-primary) px-1.5 py-0.5">{task.tenant}</span>}
        {task.current_run_id && (
          <span className="rounded bg-(--ui-bg-primary) px-1.5 py-0.5 text-(--ui-cyan)">
            run {task.current_run_id}
          </span>
        )}
        {signal && (
          <span className="rounded bg-(--ui-bg-primary) px-1.5 py-0.5 text-(--ui-accent)">{signal}</span>
        )}
        {task.consecutive_failures > 0 && (
          <span className="rounded bg-(--ui-bg-primary) px-1.5 py-0.5 text-(--ui-red)">
            ⚠ {task.consecutive_failures}
          </span>
        )}
        <button
          className="ml-auto rounded border border-(--ui-stroke-primary) px-1.5 py-0.5 text-(--ui-accent) transition hover:bg-(--ui-bg-primary)"
          onClick={event => {
            event.stopPropagation()
            onOpenDetail()
          }}
          type="button"
        >
          Detalhes
        </button>
      </div>
    </div>
  )
}

function AccordionBlock({
  children,
  defaultOpen = false,
  title
}: {
  children: React.ReactNode
  defaultOpen?: boolean
  title: string
}) {
  const [open, setOpen] = useState(defaultOpen)

  useEffect(() => {
    setOpen(defaultOpen)
  }, [defaultOpen, title])

  return (
    <section className="rounded-xl border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary)">
      <button
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.16em] text-(--ui-accent) transition hover:bg-(--ui-control-hover-background)"
        onClick={() => setOpen(current => !current)}
        type="button"
      >
        <span>{title}</span>
        <span className="text-(--ui-text-tertiary)">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="border-t border-(--ui-stroke-secondary) p-3">{children}</div>}
    </section>
  )
}

function TimelineCard({ item }: { item: TimelineItem }) {
  const payload = formatPayload(item.payload)

  return (
    <div
      className={cn(
        'rounded-lg border bg-(--ui-bg-chrome) p-3 text-xs',
        item.type === 'failure' ? 'border-(--ui-red)' : 'border-(--ui-stroke-secondary)'
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 text-(--ui-text-primary)">
        <span className={item.type === 'failure' ? 'text-(--ui-red)' : undefined}>{item.label}</span>
        <span className="text-(--ui-text-quaternary)">{formatTime(item.time)}</span>
      </div>
      {item.meta && <div className="mt-1 text-(--ui-text-tertiary)">{item.meta}</div>}
      {item.body && (
        <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words text-(--ui-text-secondary)">
          {item.body}
        </pre>
      )}
      {payload && (
        <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-(--ui-bg-secondary) p-2 text-(--ui-text-tertiary)">
          {payload}
        </pre>
      )}
    </div>
  )
}

function FailureCard({ failure }: { failure: KanbanFailure }) {
  const payload = formatPayload(failure.payload)
  const error = failure.error || failure.summary || failure.outcome || failure.kind || 'Falha sem mensagem'

  return (
    <div className="rounded-lg border border-(--ui-red) bg-(--ui-bg-chrome) p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 text-(--ui-red)">
        <span>
          {failure.source}
          {failure.run_id ? ` · run ${failure.run_id}` : ''}
          {failure.event_id ? ` · evento ${failure.event_id}` : ''}
        </span>
        <span className="text-(--ui-text-quaternary)">
          {formatTime(failure.started_at)}
          {failure.ended_at ? ` → ${formatTime(failure.ended_at)}` : ''}
        </span>
      </div>
      {failure.profile && <div className="mt-1 text-(--ui-text-tertiary)">Perfil: {failure.profile}</div>}
      <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-(--ui-bg-secondary) p-2 text-(--ui-red)">
        {error}
      </pre>
      {payload && payload !== error && (
        <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-(--ui-bg-secondary) p-2 text-(--ui-text-tertiary)">
          {payload}
        </pre>
      )}
    </div>
  )
}

function RunCard({ run }: { run: KanbanRun }) {
  const transcriptGroups = groupKanbanRunTranscript(run as unknown as Record<string, unknown>)

  return (
    <div className="rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-chrome) p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 text-(--ui-text-primary)">
        <span>
          Run {run.id} · {run.status}
          {run.step_key ? ` · ${run.step_key}` : ''}
        </span>
        <span className="text-(--ui-text-quaternary)">
          {formatTime(run.started_at)}
          {run.ended_at ? ` → ${formatTime(run.ended_at)}` : ''}
        </span>
      </div>
      {run.profile && <div className="mt-1 text-(--ui-text-tertiary)">Perfil: {run.profile}</div>}
      <div className="mt-2 space-y-2">
        {transcriptGroups.map((group, index) => (
          <div className="rounded bg-(--ui-bg-secondary) p-2" key={`${group.kind}-${index}`}>
            <div className="mb-1 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-(--ui-accent)">{group.kind}</div>
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words text-(--ui-text-secondary)">{group.text}</pre>
          </div>
        ))}
      </div>
      <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-(--ui-bg-secondary) p-2 text-(--ui-text-tertiary)">
        {JSON.stringify(run, null, 2)}
      </pre>
    </div>
  )
}

function CommentCard({
  comment,
  editing,
  editingBody,
  expanded,
  onCancelEdit,
  onEdit,
  onEditingBodyChange,
  onSave,
  onToggleExpanded,
  saving
}: {
  comment: KanbanComment
  editing: boolean
  editingBody: string
  expanded: boolean
  onCancelEdit: () => void
  onEdit: () => void
  onEditingBodyChange: (value: string) => void
  onSave: () => void
  onToggleExpanded: () => void
  saving: boolean
}) {
  return (
    <div className="rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-chrome) p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 text-(--ui-text-primary)">
        <span>{comment.author}</span>
        <span className="text-(--ui-text-quaternary)">{formatTime(comment.created_at)}</span>
      </div>
      {editing ? (
        <div className="mt-3 space-y-2">
          <Textarea
            className="min-h-32 border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) text-(--ui-text-primary)"
            onChange={event => onEditingBodyChange(event.target.value)}
            value={editingBody}
          />
          <div className="flex justify-end gap-2">
            <Button disabled={saving} onClick={onCancelEdit} size="sm" type="button" variant="secondary">
              Cancelar
            </Button>
            <Button disabled={saving} onClick={onSave} size="sm" type="button">
              {saving ? 'Salvando…' : 'Salvar comentário'}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <pre
            className={cn(
              'mt-2 whitespace-pre-wrap break-words text-(--ui-text-secondary)',
              !expanded && 'max-h-36 overflow-hidden'
            )}
          >
            {comment.body}
          </pre>
          <div className="mt-2 flex justify-end gap-2">
            <Button onClick={onToggleExpanded} size="sm" type="button" variant="secondary">
              {expanded ? 'Recolher' : 'Abrir'}
            </Button>
            <Button onClick={onEdit} size="sm" type="button" variant="secondary">
              Editar
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

function Field({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <label className="grid gap-1.5 text-xs font-medium uppercase tracking-[0.12em] text-(--ui-text-tertiary)">
      {label}
      {children}
    </label>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-2">
      <div className="text-[0.65rem] uppercase tracking-[0.14em] text-(--ui-text-quaternary)">{label}</div>
      <div className="mt-1 truncate text-(--ui-text-primary)" title={value}>
        {value}
      </div>
    </div>
  )
}
