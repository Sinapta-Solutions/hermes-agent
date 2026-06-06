import { useCallback, useEffect, useMemo, useState } from 'react'

import { DiffLines } from '@/components/chat/diff-lines'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  commitPushKanbanGitChanges,
  getKanbanGitDiff,
  getKanbanGitRepositories,
  getKanbanGitStatus,
  type KanbanGitChangeFile,
  type KanbanGitRepository
} from '@/hermes'
import { cn } from '@/lib/utils'
import { notify, notifyError } from '@/store/notifications'

import { commitPathsForGitChanges, nextSelectedGitChangePath, selectedGitRepositoryId } from './git-changes'

interface GitChangesPanelProps {
  boardSlug: null | string
}

const SELECT_TRIGGER_CLASS =
  'h-9 rounded-md border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) text-sm text-(--ui-text-primary)'

const SELECT_CONTENT_CLASS = 'z-[160] border-(--ui-stroke-secondary) bg-(--ui-bg-elevated) text-(--ui-text-primary)'

const SELECT_ITEM_CLASS =
  'text-(--ui-text-primary) focus:bg-(--ui-control-hover-background) focus:text-(--ui-text-primary) data-[state=checked]:bg-(--ui-control-hover-background)'

function statusLabel(file: KanbanGitChangeFile) {
  if (file.sensitive) {
    return 'bloqueado'
  }

  return file.status
}

export function GitChangesPanel({ boardSlug }: GitChangesPanelProps) {
  const [repositories, setRepositories] = useState<KanbanGitRepository[]>([])
  const [selectedRepoId, setSelectedRepoId] = useState<null | string>(null)
  const [files, setFiles] = useState<KanbanGitChangeFile[]>([])
  const [selectedPath, setSelectedPath] = useState<null | string>(null)
  const [diff, setDiff] = useState('')
  const [commitMessage, setCommitMessage] = useState('')
  const [loadingRepos, setLoadingRepos] = useState(false)
  const [loadingStatus, setLoadingStatus] = useState(false)
  const [loadingDiff, setLoadingDiff] = useState(false)
  const [committing, setCommitting] = useState(false)

  const selectedRepository = useMemo(
    () => repositories.find(repository => repository.id === selectedRepoId) ?? null,
    [repositories, selectedRepoId]
  )

  const selectedFile = useMemo(() => files.find(file => file.path === selectedPath) ?? null, [files, selectedPath])
  const commitPaths = useMemo(() => commitPathsForGitChanges(files), [files])

  const loadRepositories = useCallback(async () => {
    if (!boardSlug) {
      setRepositories([])
      setSelectedRepoId(null)
      setFiles([])
      setSelectedPath(null)
      setDiff('')

      return
    }

    setLoadingRepos(true)

    try {
      const nextRepositories = await getKanbanGitRepositories(boardSlug)
      setRepositories(nextRepositories)
      setSelectedRepoId(current => selectedGitRepositoryId(nextRepositories, current))
    } catch (error) {
      notifyError(error, 'Failed to load Git repositories')
    } finally {
      setLoadingRepos(false)
    }
  }, [boardSlug])

  const loadStatus = useCallback(
    async (repoId = selectedRepoId) => {
      if (!boardSlug || !repoId) {
        setFiles([])
        setSelectedPath(null)
        setDiff('')

        return
      }

      setLoadingStatus(true)

      try {
        const status = await getKanbanGitStatus(boardSlug, repoId)
        setFiles(status.files)
        setSelectedPath(current => nextSelectedGitChangePath(status.files, current))
      } catch (error) {
        notifyError(error, 'Failed to load Git changes')
      } finally {
        setLoadingStatus(false)
      }
    },
    [boardSlug, selectedRepoId]
  )

  useEffect(() => {
    void loadRepositories()
  }, [loadRepositories])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  useEffect(() => {
    if (!boardSlug || !selectedRepoId || !selectedPath) {
      setDiff('')

      return
    }

    if (selectedFile?.sensitive) {
      setDiff('')

      return
    }

    let cancelled = false
    setLoadingDiff(true)
    void getKanbanGitDiff(boardSlug, selectedRepoId, selectedPath)
      .then(result => {
        if (!cancelled) {
          setDiff(result.diff)
        }
      })
      .catch(error => {
        if (!cancelled) {
          setDiff('')
          notifyError(error, 'Failed to load Git diff')
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingDiff(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [boardSlug, selectedFile?.sensitive, selectedPath, selectedRepoId])

  const commitPush = useCallback(async () => {
    if (!boardSlug || !selectedRepoId) {
      return
    }

    const message = commitMessage.trim()

    if (!message) {
      notify({ kind: 'warning', message: 'Escreva uma mensagem de commit.' })

      return
    }

    if (!commitPaths.length) {
      notify({ kind: 'warning', message: 'Não há mudanças seguras para commit.' })

      return
    }

    setCommitting(true)

    try {
      const result = await commitPushKanbanGitChanges(boardSlug, { message, paths: commitPaths, repo_id: selectedRepoId })
      notify({ kind: 'success', message: `Commit/push feito: ${result.commit.slice(0, 12)}` })
      setCommitMessage('')
      await loadRepositories()
      await loadStatus(selectedRepoId)
    } catch (error) {
      notifyError(error, 'Failed to commit and push Git changes')
    } finally {
      setCommitting(false)
    }
  }, [boardSlug, commitMessage, commitPaths, loadRepositories, loadStatus, selectedRepoId])

  return (
    <section
      className="rounded-2xl border border-(--ui-stroke-secondary) bg-(--ui-bg-elevated) p-3"
      onClick={event => event.stopPropagation()}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-(--ui-text-primary)">
            <Codicon name="git-compare" />
            Git Changes
          </div>
          <div className="mt-1 text-xs text-(--ui-text-tertiary)">Mudanças do repositório ligado a este Kanban.</div>
        </div>
        <Button onClick={() => void loadStatus()} type="button" variant="secondary">
          Refresh Git
        </Button>
      </div>

      <div className="grid min-h-[28rem] grid-cols-[22rem_1fr] gap-3">
        <aside className="min-w-0 rounded-xl border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-3">
          <div className="space-y-2">
            <div className="text-[0.68rem] font-semibold uppercase tracking-wide text-(--ui-text-tertiary)">Repositório</div>
            {repositories.length ? (
              <Select onValueChange={value => setSelectedRepoId(value)} value={selectedRepoId ?? repositories[0]?.id}>
                <SelectTrigger className={SELECT_TRIGGER_CLASS}>
                  <SelectValue placeholder="Escolha um repo" />
                </SelectTrigger>
                <SelectContent className={SELECT_CONTENT_CLASS}>
                  {repositories.map(repository => (
                    <SelectItem className={SELECT_ITEM_CLASS} key={repository.id} value={repository.id}>
                      {repository.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="rounded-lg border border-dashed border-(--ui-stroke-secondary) p-3 text-xs text-(--ui-text-quaternary)">
                {loadingRepos ? 'Carregando repos…' : 'Nenhum repo Git configurado neste board.'}
              </div>
            )}
            {selectedRepository && (
              <div className="space-y-1 rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-elevated) p-2 text-xs">
                <div className="truncate text-(--ui-text-primary)" title={selectedRepository.path}>
                  {selectedRepository.path}
                </div>
                <div className="text-(--ui-text-tertiary)">
                  Branch: {selectedRepository.branch || '—'} · {selectedRepository.source === 'task' ? 'card' : 'board'}
                </div>
              </div>
            )}
          </div>

          <div className="mt-3 space-y-2">
            <div className="text-[0.68rem] font-semibold uppercase tracking-wide text-(--ui-text-tertiary)">Commit manual</div>
            <Input
              className="border-(--ui-stroke-secondary) bg-(--ui-bg-elevated) text-(--ui-text-primary)"
              onChange={event => setCommitMessage(event.target.value)}
              placeholder="Mensagem de commit"
              value={commitMessage}
            />
            <Button
              className="w-full"
              disabled={committing || !selectedRepoId || !commitMessage.trim() || commitPaths.length === 0}
              onClick={() => void commitPush()}
              type="button"
              variant="secondary"
            >
              {committing ? 'Commit/push…' : `Commit + push (${commitPaths.length})`}
            </Button>
            {files.some(file => file.sensitive) && (
              <div className="text-[0.68rem] text-(--ui-text-quaternary)">Arquivos sensíveis aparecem, mas diff/commit ficam bloqueados.</div>
            )}
          </div>

          <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[0.68rem] font-semibold uppercase tracking-wide text-(--ui-text-tertiary)">Arquivos</div>
              <span className="text-[0.68rem] text-(--ui-text-quaternary)">{files.length}</span>
            </div>
            <div className="max-h-[22rem] space-y-1 overflow-y-auto pr-1">
              {loadingStatus ? (
                <div className="rounded-lg border border-dashed border-(--ui-stroke-secondary) p-3 text-xs text-(--ui-text-quaternary)">Carregando Git changes…</div>
              ) : files.length === 0 ? (
                <div className="rounded-lg border border-dashed border-(--ui-stroke-secondary) p-3 text-xs text-(--ui-text-quaternary)">Sem mudanças.</div>
              ) : (
                files.map(file => (
                  <button
                    className={cn(
                      'w-full rounded-lg border p-2 text-left text-xs transition',
                      selectedPath === file.path
                        ? 'border-(--ui-accent) bg-(--ui-control-hover-background) text-(--ui-text-primary)'
                        : 'border-(--ui-stroke-secondary) bg-(--ui-bg-elevated) text-(--ui-text-secondary) hover:border-(--ui-stroke-primary) hover:text-(--ui-text-primary)'
                    )}
                    key={file.path}
                    onClick={() => setSelectedPath(file.path)}
                    type="button"
                  >
                    <div className="truncate font-medium" title={file.path}>
                      {file.path}
                    </div>
                    <div className={cn('mt-1 text-[0.68rem]', file.sensitive ? 'text-(--ui-red)' : 'text-(--ui-text-quaternary)')}>
                      {statusLabel(file)} · {file.raw_status}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </aside>

        <div className="min-w-0 rounded-xl border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-3">
          <div className="mb-2 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[0.68rem] font-semibold uppercase tracking-wide text-(--ui-text-tertiary)">Diff</div>
              <div className="truncate text-sm font-semibold text-(--ui-text-primary)" title={selectedPath ?? undefined}>
                {selectedPath ?? 'Selecione um arquivo'}
              </div>
            </div>
          </div>

          {!selectedPath ? (
            <div className="rounded-xl border border-dashed border-(--ui-stroke-secondary) p-6 text-sm text-(--ui-text-quaternary)">
              Selecione um arquivo à esquerda para ver o diff.
            </div>
          ) : selectedFile?.sensitive ? (
            <div className="rounded-xl border border-(--ui-red) bg-(--ui-bg-elevated) p-6 text-sm text-(--ui-text-secondary)">
              Diff bloqueado para arquivo sensível. Bonito seria vazar token no painel, né? Não.
            </div>
          ) : loadingDiff ? (
            <div className="rounded-xl border border-dashed border-(--ui-stroke-secondary) p-6 text-sm text-(--ui-text-quaternary)">Carregando diff…</div>
          ) : diff ? (
            <DiffLines className="mt-0 max-h-[32rem] bg-(--ui-bg-elevated)" text={diff} />
          ) : (
            <div className="rounded-xl border border-dashed border-(--ui-stroke-secondary) p-6 text-sm text-(--ui-text-quaternary)">Sem diff textual para este arquivo.</div>
          )}
        </div>
      </div>
    </section>
  )
}
