import type * as React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  createKanbanTask,
  getKanbanAssignees,
  getKanbanBoards,
  getKanbanTaskDetail,
  getKanbanTasks,
  updateKanbanTask,
  type KanbanBoard,
  type KanbanEvent,
  type KanbanStatus,
  type KanbanTask,
  type KanbanTaskDetailResponse
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
  { value: 'triage', label: 'Triage', description: 'Entrada bruta para especificar', accent: '#f5a97f' },
  { value: 'todo', label: 'Todo', description: 'Pronto depois de dependências', accent: '#eed49f' },
  { value: 'scheduled', label: 'Scheduled', description: 'Aguardando janela/tempo', accent: '#8aadf4' },
  { value: 'ready', label: 'Ready', description: 'Dispatcher pode pegar', accent: '#a6da95' },
  { value: 'running', label: 'Running', description: 'Perfil executando agora', accent: '#8bd5ca' },
  { value: 'blocked', label: 'Blocked', description: 'Precisa intervenção', accent: '#ed8796' },
  { value: 'done', label: 'Done', description: 'Concluído/revisado', accent: '#c6a0f6' }
]

function formatTime(value?: null | number) {
  if (!value) {
    return '—'
  }
  return new Date(value * 1000).toLocaleString()
}

function payloadText(event: KanbanEvent) {
  if (!event.payload) {
    return ''
  }
  return typeof event.payload === 'string' ? event.payload : JSON.stringify(event.payload)
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
  const [detail, setDetail] = useState<KanbanTaskDetailResponse | null>(null)
  const [form, setForm] = useState<TaskFormState>(EMPTY_FORM)
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const selectedBoard = useMemo(
    () => boards.find(board => board.slug === selectedBoardSlug) ?? boards[0] ?? null,
    [boards, selectedBoardSlug]
  )
  const selectedTask = useMemo(() => tasks.find(task => task.id === selectedTaskId) ?? null, [selectedTaskId, tasks])

  const refreshBoards = useCallback(async () => {
    const next = await getKanbanBoards()
    setBoards(next)
    setSelectedBoardSlug(current => current ?? next.find(board => board.slug === 'jur')?.slug ?? next[0]?.slug ?? null)
  }, [])

  const refreshTasks = useCallback(async (slug: string) => {
    const result = await getKanbanTasks(slug)
    setTasks(result.tasks)
    setSelectedTaskId(current => (current && result.tasks.some(task => task.id === current) ? current : null))
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
    if (!selectedBoard?.slug || !selectedTask?.id) {
      setDetail(null)
      return
    }
    void getKanbanTaskDetail(selectedBoard.slug, selectedTask.id)
      .then(setDetail)
      .catch(() => setDetail(null))
  }, [selectedBoard?.slug, selectedTask?.id])

  useEffect(() => {
    setStatusbarItemGroup?.('kanban', [
      { id: 'kanban-board', label: selectedBoard ? `Board ${selectedBoard.slug}` : 'Kanban' },
      { id: 'kanban-count', label: `${tasks.length} tasks` }
    ])
    return () => setStatusbarItemGroup?.('kanban', [])
  }, [selectedBoard, setStatusbarItemGroup, tasks.length])

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
        workspace_kind: 'repo',
        workspace_path: form.workspace_path.trim() || selectedBoard.default_workdir || null
      })
      setForm(prev => ({ ...prev, body: '', title: '' }))
      await refreshTasks(selectedBoard.slug)
      setSelectedTaskId(task.id)
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
    <div
      className="relative flex h-full min-h-0 flex-col overflow-hidden pt-(--titlebar-height) text-[#cdd6f4]"
      style={{ background: 'radial-gradient(circle at top left, rgba(203,166,247,.22), transparent 30%), #1e1e2e' }}
    >
      <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[#313244] bg-[#11111b]/85 px-6 py-5 backdrop-blur">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-[#cba6f7]">
            <Codicon name="project" /> M.i.A command board
          </div>
          <h1 className="mt-2 text-2xl font-semibold text-[#f5e0dc]">Kanban</h1>
          <p className="mt-1 max-w-3xl text-sm text-[#bac2de]">
            Painel nativo da orquestração. Visual inspirado nos temas Odysseus/Catppuccin; execução continua sendo M.i.A Hermes.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <select
            className="h-9 rounded-lg border border-[#313244] bg-[#181825] px-3 text-sm text-[#cdd6f4] outline-none"
            onChange={event => setSelectedBoardSlug(event.target.value)}
            value={selectedBoard?.slug ?? ''}
          >
            {boards.map(board => (
              <option key={board.slug} value={board.slug}>{board.icon} {board.name}</option>
            ))}
          </select>
          <Button onClick={() => void refresh()} type="button" variant="secondary">Refresh</Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_24rem] overflow-hidden">
        <main className="min-h-0 overflow-auto p-5" onClick={() => setSelectedTaskId(null)}>
          {loading ? (
            <div className="rounded-xl border border-[#313244] bg-[#181825] p-6 text-sm text-[#a6adc8]">Carregando Kanban…</div>
          ) : !selectedBoard ? (
            <div className="rounded-xl border border-dashed border-[#45475a] bg-[#181825] p-6 text-sm text-[#a6adc8]">Nenhum board Kanban encontrado ainda.</div>
          ) : (
            <div className="grid min-w-[1180px] grid-cols-7 gap-3">
              {STATUSES.map(column => {
                const columnTasks = tasks.filter(task => task.status === column.value)
                return (
                  <section
                    className={cn(
                      'min-h-[28rem] rounded-2xl border border-[#313244] bg-[#181825]/90 p-3 transition',
                      draggingTaskId && 'border-[#cba6f7]/50 bg-[#1e1e2e]'
                    )}
                    key={column.value}
                    onDragOver={event => {
                      event.preventDefault()
                      event.dataTransfer.dropEffect = 'move'
                    }}
                    onDrop={event => {
                      event.preventDefault()
                      const taskId = event.dataTransfer.getData('application/x-hermes-kanban-task') || event.dataTransfer.getData('text/plain')
                      setDraggingTaskId(null)
                      if (taskId) {
                        void moveTaskStatus(taskId, column.value)
                      }
                    }}
                  >
                    <div className="mb-3 flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2 text-sm font-semibold text-[#f5e0dc]">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: column.accent }} />
                          {column.label}
                        </div>
                        <div className="mt-1 text-[0.68rem] leading-tight text-[#a6adc8]">{column.description}</div>
                      </div>
                      <span className="rounded-full border border-[#313244] px-2 py-0.5 text-xs text-[#cba6f7]">{taskCount(tasks, column.value)}</span>
                    </div>
                    <div className="flex flex-col gap-2">
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
                          onSelect={() => setSelectedTaskId(task.id)}
                          task={task}
                        />
                      ))}
                      {columnTasks.length === 0 && <div className="rounded-lg border border-dashed border-[#313244] p-3 text-xs text-[#6c7086]">Vazio</div>}
                    </div>
                  </section>
                )
              })}
            </div>
          )}
        </main>

        <aside className="min-h-0 overflow-y-auto border-l border-[#313244] bg-[#11111b] p-4">
          <section className="rounded-2xl border border-[#313244] bg-[#181825] p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-[#f5e0dc]"><Codicon name="add" /> Novo card</div>
            <div className="mt-4 grid gap-3">
              <Field label="Título">
                <Input className="border-[#313244] bg-[#1e1e2e] text-[#cdd6f4]" onChange={event => setForm(prev => ({ ...prev, title: event.target.value }))} value={form.title} />
              </Field>
              <Field label="Descrição">
                <Textarea className="border-[#313244] bg-[#1e1e2e] text-[#cdd6f4]" onChange={event => setForm(prev => ({ ...prev, body: event.target.value }))} rows={4} value={form.body} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Status">
                  <select className="h-9 w-full rounded-md border border-[#313244] bg-[#1e1e2e] px-2 text-sm" onChange={event => setForm(prev => ({ ...prev, status: event.target.value as KanbanStatus }))} value={form.status}>
                    {STATUSES.map(status => <option key={status.value} value={status.value}>{status.label}</option>)}
                  </select>
                </Field>
                <Field label="Assignee">
                  <select className="h-9 w-full rounded-md border border-[#313244] bg-[#1e1e2e] px-2 text-sm" onChange={event => setForm(prev => ({ ...prev, assignee: event.target.value }))} value={form.assignee}>
                    <option value="">Sem perfil</option>
                    {assignees.map(name => <option key={name} value={name}>{name}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="Workdir">
                <Input className="border-[#313244] bg-[#1e1e2e] text-[#cdd6f4]" onChange={event => setForm(prev => ({ ...prev, workspace_path: event.target.value }))} value={form.workspace_path} />
              </Field>
              <Button disabled={saving} onClick={() => void submit()} type="button">
                {saving ? 'Criando…' : 'Criar card'}
              </Button>
            </div>
          </section>

          <section className="mt-4 rounded-2xl border border-[#313244] bg-[#181825] p-4">
            <div className="text-sm font-semibold text-[#f5e0dc]">Detalhes</div>
            {selectedTask ? (
              <div className="mt-3 space-y-3 text-sm">
                <div>
                  <div className="font-medium text-[#cdd6f4]">{selectedTask.title}</div>
                  <div className="mt-1 text-xs text-[#a6adc8]">{selectedTask.id} · {selectedTask.assignee || 'sem perfil'}</div>
                </div>
                {selectedTask.body && <p className="rounded-lg bg-[#1e1e2e] p-3 text-xs leading-relaxed text-[#bac2de]">{selectedTask.body}</p>}
                <div className="grid grid-cols-2 gap-2 text-xs text-[#a6adc8]">
                  <Meta label="Criado" value={formatTime(selectedTask.created_at)} />
                  <Meta label="Status" value={selectedTask.status} />
                  <Meta label="Prioridade" value={String(selectedTask.priority)} />
                  <Meta label="Falhas" value={String(selectedTask.consecutive_failures)} />
                </div>
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#cba6f7]">Eventos</div>
                  <div className="space-y-2">
                    {(detail?.events ?? []).slice(0, 8).map(event => (
                      <div className="rounded-lg border border-[#313244] bg-[#1e1e2e] p-2 text-xs" key={event.id}>
                        <div className="flex justify-between gap-2 text-[#cdd6f4]"><span>{event.kind}</span><span className="text-[#6c7086]">{formatTime(event.created_at)}</span></div>
                        {payloadText(event) && <div className="mt-1 truncate text-[#a6adc8]">{payloadText(event)}</div>}
                      </div>
                    ))}
                    {!detail?.events?.length && <div className="text-xs text-[#6c7086]">Sem eventos ainda.</div>}
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-3 text-sm text-[#a6adc8]">Selecione um card.</div>
            )}
          </section>
        </aside>
      </div>
    </div>
  )
}

function TaskCard({
  active,
  dragging,
  onDragEnd,
  onDragStart,
  onSelect,
  task
}: {
  active: boolean
  dragging: boolean
  onDragEnd: () => void
  onDragStart: (event: React.DragEvent<HTMLButtonElement>) => void
  onSelect: () => void
  task: KanbanTask
}) {
  return (
    <button
      className={cn(
        'rounded-xl border border-[#313244] bg-[#1e1e2e] p-3 text-left shadow-sm transition hover:border-[#cba6f7]/60 hover:bg-[#24273a]',
        active && 'border-[#cba6f7] shadow-[0_0_0_1px_rgba(203,166,247,.35)]',
        dragging && 'opacity-55 ring-1 ring-[#cba6f7]/40'
      )}
      data-kanban-card="true"
      draggable
      onClick={event => {
        event.stopPropagation()
        onSelect()
      }}
      onDragEnd={onDragEnd}
      onDragStart={event => {
        event.stopPropagation()
        onDragStart(event)
      }}
      type="button"
    >
      <div className="line-clamp-2 text-sm font-medium text-[#cdd6f4]">{task.title}</div>
      {task.body && <div className="mt-2 line-clamp-3 text-xs leading-relaxed text-[#a6adc8]">{task.body}</div>}
      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[0.68rem] text-[#a6adc8]">
        <span className="rounded bg-[#313244] px-1.5 py-0.5">{task.assignee || 'unassigned'}</span>
        {task.tenant && <span className="rounded bg-[#313244] px-1.5 py-0.5">{task.tenant}</span>}
        {task.consecutive_failures > 0 && <span className="rounded bg-[#ed8796]/20 px-1.5 py-0.5 text-[#ed8796]">⚠ {task.consecutive_failures}</span>}
      </div>
    </button>
  )
}

function Field({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <label className="grid gap-1.5 text-xs font-medium uppercase tracking-[0.12em] text-[#a6adc8]">
      {label}
      {children}
    </label>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#313244] bg-[#1e1e2e] p-2">
      <div className="text-[0.65rem] uppercase tracking-[0.14em] text-[#6c7086]">{label}</div>
      <div className="mt-1 truncate text-[#cdd6f4]">{value}</div>
    </div>
  )
}
