import type * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

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
import { Textarea } from '@/components/ui/textarea'
import {
  createKanbanTask,
  createKanbanTaskComment,
  getKanbanAssignees,
  getKanbanBoards,
  getKanbanTaskDetail,
  getKanbanTasks,
  type KanbanBoard,
  type KanbanComment,
  type KanbanEvent,
  type KanbanFailure,
  type KanbanStatus,
  type KanbanTask,
  type KanbanTaskDetailResponse,
  type KanbanTaskUpdatePayload,
  updateKanbanTask,
  updateKanbanTaskComment
} from '@/hermes'
import { cn } from '@/lib/utils'
import { notify, notifyError } from '@/store/notifications'

import type { SetStatusbarItemGroup } from '../shell/statusbar-controls'

interface KanbanViewProps {
  setStatusbarItemGroup?: SetStatusbarItemGroup
}

type TaskFormState = {
  assignee: string
  body: string
  priority: string
  status: KanbanStatus
  tenant: string
  title: string
  workspace_path: string
}

const EMPTY_FORM: TaskFormState = {
  assignee: '',
  body: '',
  priority: '0',
  status: 'ready',
  tenant: 'jur',
  title: '',
  workspace_path: 'D:\\2. JurisHUB\\app'
}

const STATUSES: Array<{ accent: string; description: string; label: string; value: KanbanStatus }> = [
  { value: 'triage', label: 'Triage', description: 'Entrada bruta para especificar', accent: 'var(--ui-orange)' },
  { value: 'todo', label: 'Todo', description: 'Pronto depois de dependências', accent: 'var(--ui-yellow)' },
  { value: 'scheduled', label: 'Scheduled', description: 'Aguardando janela/tempo', accent: 'var(--ui-blue)' },
  { value: 'ready', label: 'Ready', description: 'Dispatcher pode pegar', accent: 'var(--ui-green)' },
  { value: 'running', label: 'Running', description: 'Perfil executando agora', accent: 'var(--ui-cyan)' },
  { value: 'blocked', label: 'Blocked', description: 'Precisa intervenção', accent: 'var(--ui-red)' },
  { value: 'done', label: 'Done', description: 'Concluído/revisado', accent: 'var(--ui-accent)' }
]

const KANBAN_VISIBLE_CARD_LIMIT = 5
const KANBAN_COLUMN_SCROLL_MAX_HEIGHT = `calc(${KANBAN_VISIBLE_CARD_LIMIT} * 8.5rem + ${KANBAN_VISIBLE_CARD_LIMIT - 1} * 0.5rem)`
const KANBAN_FAST_POLL_MS = 3000
const KANBAN_IDLE_POLL_MS = 10000

interface TimelineItem {
  body?: string
  key: string
  label: string
  meta?: string
  payload?: KanbanEvent['payload'] | Record<string, unknown> | null | string
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

function latestRunTimestamp(run: Record<string, unknown>) {
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

function formatPayload(value: KanbanEvent['payload'] | Record<string, unknown> | null | string | undefined) {
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

function taskCount(tasks: KanbanTask[], status: KanbanStatus) {
  return tasks.filter(task => task.status === status).length
}

export function KanbanView({ setStatusbarItemGroup }: KanbanViewProps) {
  const [assignees, setAssignees] = useState<string[]>([])
  const [boards, setBoards] = useState<KanbanBoard[]>([])
  const [selectedBoardSlug, setSelectedBoardSlug] = useState<string | null>(null)
  const [tasks, setTasks] = useState<KanbanTask[]>([])
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null)
  const [detail, setDetail] = useState<KanbanTaskDetailResponse | null>(null)
  const [form, setForm] = useState<TaskFormState>(EMPTY_FORM)
  const [createOpen, setCreateOpen] = useState(false)
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000))
  const [saving, setSaving] = useState(false)
  const pollInFlightRef = useRef(false)

  const selectedBoard = useMemo(
    () => boards.find(board => board.slug === selectedBoardSlug) ?? boards[0] ?? null,
    [boards, selectedBoardSlug]
  )

  const selectedTask = useMemo(() => tasks.find(task => task.id === selectedTaskId) ?? null, [selectedTaskId, tasks])
  const detailTask = useMemo(() => tasks.find(task => task.id === detailTaskId) ?? null, [detailTaskId, tasks])

  const refreshBoards = useCallback(async () => {
    const next = await getKanbanBoards()
    setBoards(next)
    setSelectedBoardSlug(current => current ?? next.find(board => board.slug === 'jur')?.slug ?? next[0]?.slug ?? null)
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

    void refreshTasks(selectedBoard.slug).catch(error => notifyError(error, 'Failed to load Kanban tasks'))
  }, [refreshTasks, selectedBoard?.slug])

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
      void refreshTasks(selectedBoard.slug)
        .catch(error => notifyError(error, 'Failed to auto-refresh Kanban tasks'))
        .finally(() => {
          pollInFlightRef.current = false
        })
    }, intervalMs)

    return () => window.clearInterval(timer)
  }, [refreshTasks, selectedBoard?.slug, tasks])

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
    setStatusbarItemGroup?.('kanban', [
      { id: 'kanban-board', label: selectedBoard ? `Board ${selectedBoard.slug}` : 'Kanban' },
      { id: 'kanban-count', label: `${tasks.length} tasks` }
    ])

    return () => setStatusbarItemGroup?.('kanban', [])
  }, [selectedBoard, setStatusbarItemGroup, tasks.length])

  const openTaskDetail = useCallback((taskId: string) => {
    setSelectedTaskId(taskId)
    setDetailTaskId(taskId)
  }, [])

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

    try {
      const task = await createKanbanTask(selectedBoard.slug, {
        assignee: form.assignee.trim() || null,
        body: form.body.trim() || null,
        priority: Number.parseInt(form.priority, 10) || 0,
        status: form.status,
        tenant: form.tenant.trim() || null,
        title: form.title.trim(),
        workspace_kind: form.workspace_path.trim() ? 'dir' : 'scratch',
        workspace_path: form.workspace_path.trim() || selectedBoard.default_workdir || null
      })

      setForm(prev => ({ ...prev, body: '', title: '' }))
      setCreateOpen(false)
      await refreshTasks(selectedBoard.slug)
      setSelectedTaskId(task.id)
      setDetailTaskId(task.id)
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

      const previousTasks = tasks
      setTasks(current => current.map(item => (item.id === taskId ? { ...item, status } : item)))
      setSelectedTaskId(taskId)

      try {
        const updated = await updateKanbanTask(selectedBoard.slug, taskId, { status })
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
          <select
            className="h-9 rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-elevated) px-3 text-sm text-(--ui-text-primary) outline-none"
            onChange={event => setSelectedBoardSlug(event.target.value)}
            value={selectedBoard?.slug ?? ''}
          >
            {boards.map(board => (
              <option key={board.slug} value={board.slug}>
                {board.icon} {board.name}
              </option>
            ))}
          </select>
          <Button onClick={() => setCreateOpen(true)} type="button">
            <Codicon name="add" /> Novo card
          </Button>
          <div className="hidden text-right text-[0.68rem] leading-tight text-(--ui-text-quaternary) md:block">
            Auto-refresh
            <br />
            {tasks.some(task => task.status === 'running') ? '3s em execução' : '10s ocioso'}
          </div>
          <Button onClick={() => void refresh()} type="button" variant="secondary">
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
          <div className="grid min-w-[1180px] grid-cols-7 gap-3">
            {STATUSES.map(column => {
              const columnTasks = tasks.filter(task => task.status === column.value)

              return (
                <section
                  className={cn(
                    'min-h-[28rem] rounded-2xl border border-(--ui-stroke-secondary) bg-(--ui-bg-elevated) p-3 transition',
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
                      {taskCount(tasks, column.value)}
                    </span>
                  </div>
                  {columnTasks.length > KANBAN_VISIBLE_CARD_LIMIT && (
                    <div className="mb-2 text-[0.68rem] text-(--ui-text-quaternary)">
                      Mostrando 5 cards visíveis; role para ver mais {columnTasks.length - KANBAN_VISIBLE_CARD_LIMIT}.
                    </div>
                  )}
                  <div
                    className={cn(
                      'flex flex-col gap-2 pr-1',
                      columnTasks.length > KANBAN_VISIBLE_CARD_LIMIT && 'overflow-y-auto overscroll-contain'
                    )}
                    style={
                      columnTasks.length > KANBAN_VISIBLE_CARD_LIMIT
                        ? { maxHeight: KANBAN_COLUMN_SCROLL_MAX_HEIGHT }
                        : undefined
                    }
                  >
                    {columnTasks.map(task => (
                      <TaskCard
                        active={selectedTask?.id === task.id}
                        dragging={draggingTaskId === task.id}
                        key={task.id}
                        onDragEnd={() => setDraggingTaskId(null)}
                        onDragStart={event => {
                          event.dataTransfer.effectAllowed = 'move'
                          event.dataTransfer.setData('application/x-hermes-kanban-task', task.id)
                          event.dataTransfer.setData('text/plain', task.id)
                          setDraggingTaskId(task.id)
                        }}
                        onOpenDetail={() => openTaskDetail(task.id)}
                        nowSeconds={nowSeconds}
                        onSelect={() => setSelectedTaskId(task.id)}
                        task={task}
                      />
                    ))}
                    {columnTasks.length === 0 && (
                      <div className="rounded-lg border border-dashed border-(--ui-stroke-secondary) p-3 text-xs text-(--ui-text-quaternary)">
                        Vazio
                      </div>
                    )}
                  </div>
                </section>
              )
            })}
          </div>
        )}
      </main>

      <CreateTaskDialog
        assignees={assignees}
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
        onTaskArchived={archivedTaskId => {
          setTasks(current => current.filter(item => item.id !== archivedTaskId))
          setDetail(current => (current?.task.id === archivedTaskId ? null : current))
          setDetailTaskId(current => (current === archivedTaskId ? null : current))
          setSelectedTaskId(current => (current === archivedTaskId ? null : current))
        }}
        onOpenChange={open => {
          if (!open) {
            setDetailTaskId(null)
          }
        }}
        onRefreshDetail={loadTaskDetail}
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

function CreateTaskDialog({
  assignees,
  form,
  onOpenChange,
  onSubmit,
  open,
  saving,
  setForm
}: {
  assignees: string[]
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
              <select
                className="h-9 w-full rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) px-2 text-sm"
                onChange={event => setForm(prev => ({ ...prev, status: event.target.value as KanbanStatus }))}
                value={form.status}
              >
                {STATUSES.map(status => (
                  <option key={status.value} value={status.value}>
                    {status.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Assignee">
              <select
                className="h-9 w-full rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) px-2 text-sm"
                onChange={event => setForm(prev => ({ ...prev, assignee: event.target.value }))}
                value={form.assignee}
              >
                <option value="">Sem perfil</option>
                {assignees.map(name => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
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
          <Field label="Workdir">
            <Input
              className="border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) text-(--ui-text-primary)"
              onChange={event => setForm(prev => ({ ...prev, workspace_path: event.target.value }))}
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
  onTaskUpdated: (task: KanbanTask) => void
  open: boolean
  task: KanbanTask | null
}) {
  const activeTask = detail?.task ?? task
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
  const activeTaskId = activeTask?.id ?? null
  const timeline = useMemo(() => buildTimeline(detail), [detail])

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

    const payload: KanbanTaskUpdatePayload = {
      assignee: editForm.assignee.trim() || null,
      body: editForm.body.trim() || null,
      priority: Number.parseInt(editForm.priority, 10) || 0,
      status: editForm.status,
      tenant: editForm.tenant.trim() || null,
      title: editForm.title.trim(),
      workspace_kind: kanbanWorkspaceKind(activeTask.workspace_kind),
      workspace_path: editForm.workspace_path.trim() || null
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

  const addComment = async () => {
    if (!boardSlug || !activeTask) {
      return
    }

    const body = commentBody.trim()

    if (!body) {
      notify({ title: 'Kanban', message: 'Comentário vazio' })

      return
    }

    setSavingComment(true)

    try {
      await createKanbanTaskComment(boardSlug, activeTask.id, { author: 'desktop', body })
      setCommentBody('')
      await onRefreshDetail(activeTask.id)
      notify({ title: 'Kanban', message: 'Comentário adicionado' })
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
              <section className="rounded-xl border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-3">
                <div className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-(--ui-accent)">
                  Editar card
                </div>
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
                      <select
                        className="h-9 w-full rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-chrome) px-2 text-sm"
                        onChange={event =>
                          setEditForm(prev => ({ ...prev, status: event.target.value as KanbanStatus }))
                        }
                        value={editForm.status}
                      >
                        {STATUSES.map(status => (
                          <option key={status.value} value={status.value}>
                            {status.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Assignee">
                      <select
                        className="h-9 w-full rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-chrome) px-2 text-sm"
                        onChange={event => setEditForm(prev => ({ ...prev, assignee: event.target.value }))}
                        value={editForm.assignee}
                      >
                        <option value="">Sem perfil</option>
                        {assignees.map(name => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
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
              </section>

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

              <AccordionBlock defaultOpen title={`Atividade recente (${timeline.length})`}>
                <div className="space-y-2">
                  {timeline.slice(0, 8).map(item => (
                    <TimelineCard item={item} key={item.key} />
                  ))}
                  {!timeline.length && <div className="text-xs text-(--ui-text-quaternary)">Sem atividade ainda.</div>}
                </div>
              </AccordionBlock>

              {activeTask.result && (
                <section className="rounded-xl border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-3">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-(--ui-accent)">
                    Resultado
                  </div>
                  <pre className="whitespace-pre-wrap break-words text-(--ui-text-secondary)">{activeTask.result}</pre>
                </section>
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
                    <div className="mt-2 flex justify-end">
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

function TaskCard({
  active,
  dragging,
  nowSeconds,
  onDragEnd,
  onDragStart,
  onOpenDetail,
  onSelect,
  task
}: {
  active: boolean
  dragging: boolean
  nowSeconds: number
  onDragEnd: () => void
  onDragStart: (event: React.DragEvent<HTMLDivElement>) => void
  onOpenDetail: () => void
  onSelect: () => void
  task: KanbanTask
}) {
  const signal = latestTaskSignal(task, nowSeconds)

  return (
    <div
      className={cn(
        'rounded-xl border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-3 text-left shadow-sm transition hover:border-(--ui-accent) hover:bg-(--ui-control-hover-background)',
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
      {task.body && (
        <div className="mt-2 line-clamp-3 text-xs leading-relaxed text-(--ui-text-tertiary)">{task.body}</div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[0.68rem] text-(--ui-text-tertiary)">
        <span className="rounded bg-(--ui-bg-primary) px-1.5 py-0.5">{task.assignee || 'unassigned'}</span>
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

function RunCard({ run }: { run: Record<string, unknown> }) {
  const status = String(run.status ?? 'run')
  const startedAt = typeof run.started_at === 'number' ? run.started_at : null
  const endedAt = typeof run.ended_at === 'number' ? run.ended_at : null

  return (
    <div className="rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-chrome) p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 text-(--ui-text-primary)">
        <span>
          Run {String(run.id ?? '—')} · {status}
        </span>
        <span className="text-(--ui-text-quaternary)">
          {formatTime(startedAt)}
          {endedAt ? ` → ${formatTime(endedAt)}` : ''}
        </span>
      </div>
      {run.summary ? (
        <pre className="mt-2 whitespace-pre-wrap break-words text-(--ui-text-secondary)">{String(run.summary)}</pre>
      ) : null}
      {run.error ? (
        <pre className="mt-2 whitespace-pre-wrap break-words text-(--ui-red)">{String(run.error)}</pre>
      ) : null}
      <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded bg-(--ui-bg-secondary) p-2 text-(--ui-text-tertiary)">
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
