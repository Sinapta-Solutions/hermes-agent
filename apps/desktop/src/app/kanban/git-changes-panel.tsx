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
import { buildSideBySideDiffRows, type SideBySideDiffRow, type SideBySideDiffRowKind } from './git-diff'

type GitDiffViewMode = 'side-by-side' | 'unified'

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
  const [diffViewMode, setDiffViewMode] = useState<GitDiffViewMode>('unified')
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
  const sideBySideRows = useMemo(() => buildSideBySideDiffRows(diff), [diff])

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
      className="rounded-2xl border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-4"
      onClick={event => event.stopPropagation()}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-(--ui-text-primary)">
            <Codicon name="git-compare" />
            Git Changes
          </div>
          <div className="mt-0.5 text-xs text-(--ui-text-tertiary)">Mudanças do repositório ligado a este Kanban.</div>
        </div>
        <Button onClick={() => void loadStatus()} size="sm" type="button" variant="ghost">
          Refresh Git
        </Button>
      </div>

      <div className="grid min-h-[28rem] grid-cols-[20rem_minmax(0,1fr)] gap-4">
        <aside className="min-w-0 rounded-xl border border-(--ui-stroke-secondary) bg-(--ui-bg-chrome) p-3">
          <div className="space-y-2">
            <div className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-(--ui-text-quaternary)">Repositório</div>
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
              <div className="rounded-lg border border-dashed border-(--ui-stroke-secondary) px-3 py-2 text-xs text-(--ui-text-quaternary)">
                {loadingRepos ? 'Carregando repos…' : 'Nenhum repo Git configurado neste board.'}
              </div>
            )}
            {selectedRepository && (
              <div className="space-y-1 rounded-lg bg-(--ui-bg-secondary) px-3 py-2 text-xs">
                <div className="truncate text-(--ui-text-secondary)" title={selectedRepository.path}>
                  {selectedRepository.path}
                </div>
                <div className="text-(--ui-text-quaternary)">
                  Branch: {selectedRepository.branch || '—'} · {selectedRepository.source === 'task' ? 'card' : 'board'}
                </div>
              </div>
            )}
          </div>

          <div className="mt-4 space-y-2">
            <div className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-(--ui-text-quaternary)">Commit manual</div>
            <Input
              className="border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) text-(--ui-text-primary)"
              onChange={event => setCommitMessage(event.target.value)}
              placeholder="Mensagem de commit"
              value={commitMessage}
            />
            <Button
              className="w-full"
              disabled={committing || !selectedRepoId || !commitMessage.trim() || commitPaths.length === 0}
              onClick={() => void commitPush()}
              size="sm"
              type="button"
              variant="secondary"
            >
              {committing ? 'Commit/push…' : `Commit + push (${commitPaths.length})`}
            </Button>
            {files.some(file => file.sensitive) && (
              <div className="text-[0.68rem] text-(--ui-text-quaternary)">Arquivos sensíveis aparecem, mas diff/commit ficam bloqueados.</div>
            )}
          </div>

          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-(--ui-text-quaternary)">Arquivos</div>
              <span className="text-[0.68rem] text-(--ui-text-quaternary)">{files.length}</span>
            </div>
            <div className="max-h-[22rem] overflow-y-auto rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary)">
              {loadingStatus ? (
                <div className="p-3 text-xs text-(--ui-text-quaternary)">Carregando Git changes…</div>
              ) : files.length === 0 ? (
                <div className="p-3 text-xs text-(--ui-text-quaternary)">Sem mudanças.</div>
              ) : (
                files.map(file => (
                  <button
                    className={cn(
                      'w-full border-l-2 px-3 py-2 text-left text-xs transition not-last:border-b not-last:border-(--ui-stroke-secondary)',
                      selectedPath === file.path
                        ? 'border-l-[var(--ui-accent)] bg-(--ui-control-hover-background) text-(--ui-text-primary)'
                        : 'border-l-transparent text-(--ui-text-secondary) hover:bg-(--ui-control-hover-background) hover:text-(--ui-text-primary)'
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

        <div className="min-w-0 overflow-hidden rounded-xl border border-(--ui-stroke-secondary) bg-(--ui-bg-chrome)">
          <div className="flex items-center justify-between gap-3 border-b border-(--ui-stroke-secondary) px-3 py-2">
            <div className="min-w-0">
              <div className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-(--ui-text-quaternary)">Diff</div>
              <div className="truncate text-sm font-semibold text-(--ui-text-primary)" title={selectedPath ?? undefined}>
                {selectedPath ?? 'Selecione um arquivo'}
              </div>
            </div>
            {diff && <DiffViewModeToggle mode={diffViewMode} onChange={setDiffViewMode} />}
          </div>

          <div className="p-3">
            {!selectedPath ? (
              <div className="rounded-xl border border-dashed border-(--ui-stroke-secondary) p-6 text-sm text-(--ui-text-quaternary)">
                Selecione um arquivo à esquerda para ver o diff.
              </div>
            ) : selectedFile?.sensitive ? (
              <div className="rounded-xl border border-(--ui-red) bg-(--ui-bg-secondary) p-6 text-sm text-(--ui-text-secondary)">
                Diff bloqueado para arquivo sensível. Bonito seria vazar token no painel, né? Não.
              </div>
            ) : loadingDiff ? (
              <div className="rounded-xl border border-dashed border-(--ui-stroke-secondary) p-6 text-sm text-(--ui-text-quaternary)">Carregando diff…</div>
            ) : diff ? (
              diffViewMode === 'unified' ? (
                <DiffLines className="mt-0 max-h-[32rem] bg-(--ui-bg-elevated)" text={diff} />
              ) : (
                <SideBySideDiff rows={sideBySideRows} />
              )
            ) : (
              <div className="rounded-xl border border-dashed border-(--ui-stroke-secondary) p-6 text-sm text-(--ui-text-quaternary)">Sem diff textual para este arquivo.</div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

function DiffViewModeToggle({
  mode,
  onChange
}: {
  mode: GitDiffViewMode
  onChange: (mode: GitDiffViewMode) => void
}) {
  const options: Array<{ label: string; value: GitDiffViewMode }> = [
    { label: 'Unified', value: 'unified' },
    { label: 'Lado a lado', value: 'side-by-side' }
  ]

  return (
    <div className="flex rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-0.5">
      {options.map(option => (
        <button
          className={cn(
            'rounded-md px-2 py-1 text-[0.68rem] font-medium transition',
            mode === option.value
              ? 'bg-(--ui-control-hover-background) text-(--ui-text-primary)'
              : 'text-(--ui-text-quaternary) hover:text-(--ui-text-primary)'
          )}
          key={option.value}
          onClick={() => onChange(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function SideBySideDiff({ rows }: { rows: SideBySideDiffRow[] }) {
  return (
    <div className="max-h-[32rem] overflow-auto rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-elevated) font-mono text-[0.7rem] leading-relaxed">
      <div className="sticky top-0 z-10 grid min-w-[64rem] grid-cols-2 border-b border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-(--ui-text-quaternary)">
        <div className="border-r border-(--ui-stroke-secondary) px-3 py-2">Antes</div>
        <div className="px-3 py-2">Depois</div>
      </div>
      <div className="min-w-[64rem]">
        {rows.map((row, index) => (
          <SideBySideDiffRowView key={`${index}-${row.kind}-${row.meta ?? row.oldText ?? ''}-${row.newText ?? ''}`} row={row} />
        ))}
      </div>
    </div>
  )
}

function SideBySideDiffRowView({ row }: { row: SideBySideDiffRow }) {
  if (row.kind === 'meta') {
    return (
      <div className="border-b border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) px-3 py-1.5 text-(--ui-cyan)">
        {row.meta || ' '}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 border-b border-(--ui-stroke-secondary)">
      <SideBySideDiffCell kind={row.kind} side="old" text={row.oldText ?? ''} />
      <SideBySideDiffCell kind={row.kind} side="new" text={row.newText ?? ''} />
    </div>
  )
}

function diffCellPrefix(kind: SideBySideDiffRowKind, side: 'new' | 'old') {
  if ((kind === 'removed' || kind === 'changed') && side === 'old') {
    return '−'
  }

  if ((kind === 'added' || kind === 'changed') && side === 'new') {
    return '+'
  }

  return ' '
}

function diffCellTone(kind: SideBySideDiffRowKind, side: 'new' | 'old') {
  if ((kind === 'removed' || kind === 'changed') && side === 'old') {
    return 'bg-[color-mix(in_srgb,var(--ui-red)_10%,transparent)] text-(--ui-red)'
  }

  if ((kind === 'added' || kind === 'changed') && side === 'new') {
    return 'bg-[color-mix(in_srgb,var(--ui-green)_10%,transparent)] text-(--ui-green)'
  }

  return 'text-(--ui-text-secondary)'
}

function SideBySideDiffCell({
  kind,
  side,
  text
}: {
  kind: SideBySideDiffRowKind
  side: 'new' | 'old'
  text: string
}) {
  return (
    <div
      className={cn(
        'min-h-7 whitespace-pre px-3 py-1.5',
        side === 'old' && 'border-r border-(--ui-stroke-secondary)',
        diffCellTone(kind, side)
      )}
    >
      <span className="mr-2 select-none text-(--ui-text-quaternary)">{diffCellPrefix(kind, side)}</span>
      {text || ' '}
    </div>
  )
}
