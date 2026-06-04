import type * as React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  createWorkspace,
  getWorkspaceEvents,
  getWorkspaces,
  getWorkspaceStatus,
  updateWorkspace,
  type Workspace,
  type WorkspaceEvent,
  type WorkspacePayload,
  type WorkspaceStatus
} from '@/hermes'
import { cn } from '@/lib/utils'
import { notify, notifyError } from '@/store/notifications'

import type { SetStatusbarItemGroup } from '../shell/statusbar-controls'

interface WorkspacesViewProps {
  onNewSessionInWorkspace?: (path: null | string) => void
  setStatusbarItemGroup?: SetStatusbarItemGroup
}

type WorkspaceFormState = Record<'board_id' | 'branch' | 'description' | 'name' | 'repo_path' | 'vault_path', string>

const EMPTY_FORM: WorkspaceFormState = {
  board_id: '',
  branch: '',
  description: '',
  name: '',
  repo_path: '',
  vault_path: ''
}

const JURISHUB_PRESET: WorkspaceFormState = {
  board_id: 'JUR',
  branch: 'dev',
  description: 'Workspace operacional do JurisHUB: repo, vault, agentes e tarefas sob coordenação da M.i.A.',
  name: 'JurisHUB',
  repo_path: 'D:\\2. JurisHUB\\app',
  vault_path: 'E:\\Cerebro\\Cérebro\\JurisHUB'
}

function compactPayload(form: WorkspaceFormState): WorkspacePayload {
  return {
    board_id: form.board_id.trim() || null,
    branch: form.branch.trim() || null,
    description: form.description.trim() || null,
    name: form.name.trim(),
    repo_path: form.repo_path.trim() || null,
    vault_path: form.vault_path.trim() || null
  }
}

function hydrateForm(workspace: Workspace): WorkspaceFormState {
  return {
    board_id: workspace.board_id ?? '',
    branch: workspace.branch ?? '',
    description: workspace.description ?? '',
    name: workspace.name,
    repo_path: workspace.repo_path ?? '',
    vault_path: workspace.vault_path ?? ''
  }
}

export function WorkspacesView({ onNewSessionInWorkspace, setStatusbarItemGroup }: WorkspacesViewProps) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [statuses, setStatuses] = useState<Record<string, WorkspaceStatus>>({})
  const [events, setEvents] = useState<WorkspaceEvent[]>([])
  const [form, setForm] = useState<WorkspaceFormState>(EMPTY_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const selected = useMemo(() => workspaces.find(workspace => workspace.id === selectedId) ?? workspaces[0] ?? null, [selectedId, workspaces])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const next = await getWorkspaces()
      setWorkspaces(next)
      setSelectedId(current => current ?? next[0]?.id ?? null)
      const statusEntries = await Promise.all(
        next.map(async workspace => {
          try {
            return [workspace.id, await getWorkspaceStatus(workspace.id)] as const
          } catch {
            return null
          }
        })
      )
      setStatuses(Object.fromEntries(statusEntries.filter(Boolean) as Array<readonly [string, WorkspaceStatus]>))
    } catch (error) {
      notifyError(error, 'Failed to load workspaces')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!selected) {
      setEvents([])
      return
    }
    void getWorkspaceEvents(selected.id, 20)
      .then(result => setEvents(result.events))
      .catch(() => setEvents([]))
  }, [selected])

  useEffect(() => {
    setStatusbarItemGroup?.('workspaces', [
      { id: 'workspaces-count', label: `${workspaces.length} workspace${workspaces.length === 1 ? '' : 's'}` }
    ])
    return () => setStatusbarItemGroup?.('workspaces', [])
  }, [setStatusbarItemGroup, workspaces.length])

  useEffect(() => {
    if (!selected || isCreating || editingId === selected.id) {
      return
    }
    setEditingId(selected.id)
    setForm(hydrateForm(selected))
  }, [editingId, isCreating, selected])

  const startCreate = (preset?: WorkspaceFormState) => {
    setIsCreating(true)
    setEditingId(null)
    setForm(preset ?? EMPTY_FORM)
  }

  const startEdit = (workspace: Workspace) => {
    setIsCreating(false)
    setSelectedId(workspace.id)
    setEditingId(workspace.id)
    setForm(hydrateForm(workspace))
  }

  const save = async () => {
    const payload = compactPayload(form)
    if (!payload.name) {
      notify({ message: 'Workspace name is required', title: 'Workspaces' })
      return
    }
    setSaving(true)
    try {
      const workspace = editingId && !isCreating ? await updateWorkspace(editingId, payload) : await createWorkspace(payload)
      await refresh()
      setSelectedId(workspace.id)
      setIsCreating(false)
      setEditingId(workspace.id)
      setForm(hydrateForm(workspace))
      notify({ message: `${workspace.name} saved`, title: 'M.i.A Workspace' })
    } catch (error) {
      notifyError(error, 'Failed to save workspace')
    } finally {
      setSaving(false)
    }
  }

  const activeStatus = selected ? statuses[selected.id] : undefined
  const taskTotal = activeStatus ? Object.values(activeStatus.task_counts).reduce((sum, value) => sum + value, 0) : 0

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-(--ui-chat-surface-background) pt-(--titlebar-height)">
      <div className="flex shrink-0 items-start justify-between gap-4 border-b border-(--ui-stroke-secondary) px-6 py-5">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-(--ui-text-tertiary)">
            <Codicon name="root-folder" /> Native M.i.A orchestrator
          </div>
          <h1 className="mt-2 text-2xl font-semibold text-foreground">Workspaces</h1>
          <p className="mt-1 max-w-2xl text-sm text-(--ui-text-secondary)">
            Projetos com repo, vault, board, agentes e histórico em SQLite. Sem dependência de Paperclip.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button onClick={() => startCreate(JURISHUB_PRESET)} type="button" variant="secondary">
            Preset JurisHUB
          </Button>
          <Button onClick={() => startCreate()} type="button">
            New workspace
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(16rem,22rem)_1fr] overflow-hidden">
        <aside className="min-h-0 overflow-y-auto border-r border-(--ui-stroke-secondary) p-3">
          {loading && <div className="p-3 text-sm text-(--ui-text-tertiary)">Loading workspaces…</div>}
          {!loading && workspaces.length === 0 && (
            <div className="rounded-lg border border-dashed border-(--ui-stroke-tertiary) p-4 text-sm text-(--ui-text-secondary)">
              No workspaces yet. Use the JurisHUB preset or create one manually.
            </div>
          )}
          <div className="flex flex-col gap-2">
            {workspaces.map(workspace => {
              const status = statuses[workspace.id]
              const active = selected?.id === workspace.id
              return (
                <button
                  className={cn(
                    'rounded-lg border border-(--ui-stroke-secondary) p-3 text-left transition-colors hover:bg-(--ui-control-hover-background)',
                    active && 'border-(--ui-stroke-tertiary) bg-(--ui-control-active-background)'
                  )}
                  key={workspace.id}
                  onClick={() => startEdit(workspace)}
                  type="button"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="truncate font-medium text-foreground">{workspace.name}</div>
                    {workspace.board_id && <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[0.68rem] text-primary">{workspace.board_id}</span>}
                  </div>
                  <div className="mt-1 truncate text-xs text-(--ui-text-tertiary)">{workspace.repo_path || 'No repo path'}</div>
                  <div className="mt-2 flex gap-2 text-[0.7rem] text-(--ui-text-tertiary)">
                    <span className={status?.repo_exists ? 'text-primary' : ''}>repo {status?.repo_exists ? 'ok' : 'missing'}</span>
                    <span className={status?.vault_exists ? 'text-primary' : ''}>vault {status?.vault_exists ? 'ok' : 'missing'}</span>
                    {workspace.branch && <span>base {workspace.branch}</span>}
                  </div>
                </button>
              )
            })}
          </div>
        </aside>

        <main className="min-h-0 overflow-y-auto p-6">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <section className="rounded-xl border border-(--ui-stroke-secondary) bg-(--ui-sidebar-surface-background) p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">{editingId && !isCreating ? 'Edit workspace' : 'Create workspace'}</h2>
                  <p className="mt-1 text-sm text-(--ui-text-secondary)">Base durável para orquestração da M.i.A.</p>
                </div>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <Field label="Name">
                  <Input onChange={event => setForm(prev => ({ ...prev, name: event.target.value }))} value={form.name} />
                </Field>
                <Field label="Board / tenant">
                  <Input onChange={event => setForm(prev => ({ ...prev, board_id: event.target.value }))} placeholder="JUR" value={form.board_id} />
                </Field>
                <Field className="md:col-span-2" label="Repository path">
                  <Input onChange={event => setForm(prev => ({ ...prev, repo_path: event.target.value }))} value={form.repo_path} />
                </Field>
                <Field label="Base branch/ref for Kanban worktrees">
                  <Input onChange={event => setForm(prev => ({ ...prev, branch: event.target.value }))} placeholder="auto, dev, main, origin/main" value={form.branch} />
                </Field>
                <Field className="md:col-span-2" label="Vault / notes path">
                  <Input onChange={event => setForm(prev => ({ ...prev, vault_path: event.target.value }))} value={form.vault_path} />
                </Field>
                <Field className="md:col-span-2" label="Description">
                  <Textarea onChange={event => setForm(prev => ({ ...prev, description: event.target.value }))} rows={5} value={form.description} />
                </Field>
              </div>

              <div className="mt-5 flex items-center justify-between gap-3">
                <div className="text-xs text-(--ui-text-tertiary)">Storage: <code>workspaces.db</code> no Hermes home ativo.</div>
                <Button disabled={saving} onClick={() => void save()} type="button">
                  {saving ? 'Saving…' : editingId && !isCreating ? 'Save changes' : 'Create workspace'}
                </Button>
              </div>
            </section>

            <section className="rounded-xl border border-(--ui-stroke-secondary) bg-(--ui-sidebar-surface-background) p-5">
              <h2 className="text-lg font-semibold text-foreground">Status</h2>
              {selected ? (
                <div className="mt-4 space-y-4 text-sm">
                  <div>
                    <div className="font-medium text-foreground">{selected.name}</div>
                    <div className="mt-1 text-xs text-(--ui-text-tertiary)">{selected.id}</div>
                  </div>
                  <StatusLine label="Board" value={selected.board_id || 'not configured'} />
                  <StatusLine label="Kanban base ref" value={selected.branch || 'auto on save'} />
                  <StatusLine label="Repo" ok={activeStatus?.repo_exists} value={selected.repo_path || 'not configured'} />
                  <StatusLine label="Vault" ok={activeStatus?.vault_exists} value={selected.vault_path || 'not configured'} />
                  <StatusLine label="Description" value={selected.description || 'not configured'} />
                  <div className="grid grid-cols-3 gap-2">
                    <Metric label="Profiles" value={activeStatus?.profile_count ?? 0} />
                    <Metric label="Tasks" value={taskTotal} />
                    <Metric label="Events" value={activeStatus?.event_count ?? events.length} />
                  </div>
                  <Button
                    className="w-full"
                    disabled={!selected.repo_path}
                    onClick={() => onNewSessionInWorkspace?.(selected.repo_path ?? null)}
                    type="button"
                    variant="secondary"
                  >
                    New session in repo
                  </Button>
                </div>
              ) : (
                <div className="mt-4 text-sm text-(--ui-text-tertiary)">Select or create a workspace.</div>
              )}
            </section>
          </div>

          <section className="mt-6 rounded-xl border border-(--ui-stroke-secondary) bg-(--ui-sidebar-surface-background) p-5">
            <h2 className="text-lg font-semibold text-foreground">Recent events</h2>
            <div className="mt-4 space-y-2">
              {events.length === 0 && <div className="text-sm text-(--ui-text-tertiary)">No events yet.</div>}
              {events.map(event => (
                <div className="rounded-lg border border-(--ui-stroke-secondary) px-3 py-2" key={event.id}>
                  <div className="flex items-center justify-between gap-3 text-xs text-(--ui-text-tertiary)">
                    <span>{event.type}</span>
                    <span>{new Date(event.created_at).toLocaleString()}</span>
                  </div>
                  <div className="mt-1 text-sm text-foreground">{event.message}</div>
                </div>
              ))}
            </div>
          </section>
        </main>
      </div>
    </div>
  )
}

function Field({ children, className, label }: { children: React.ReactNode; className?: string; label: string }) {
  return (
    <label className={cn('grid gap-1.5 text-sm font-medium text-(--ui-text-secondary)', className)}>
      {label}
      {children}
    </label>
  )
}

function StatusLine({ label, ok, value }: { label: string; ok?: boolean; value: string }) {
  return (
    <div className="rounded-lg border border-(--ui-stroke-secondary) p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-(--ui-text-tertiary)">{label}</span>
        {typeof ok === 'boolean' && (
          <span className={cn('text-xs', ok ? 'text-primary' : 'text-(--ui-text-tertiary)')}>{ok ? 'found' : 'not found'}</span>
        )}
      </div>
      <div className="mt-1 break-all text-sm text-foreground">{value}</div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-(--ui-stroke-secondary) p-3 text-center">
      <div className="text-lg font-semibold text-foreground">{value}</div>
      <div className="text-[0.7rem] uppercase tracking-wide text-(--ui-text-tertiary)">{label}</div>
    </div>
  )
}
