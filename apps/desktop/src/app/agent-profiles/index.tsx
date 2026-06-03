import type * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { PageLoader } from '@/components/page-loader'
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
  createProfile,
  getProfiles,
  getProfileSetupCommand,
  getProfileSoul,
  type ProfileInfo,
  updateProfileSoul
} from '@/hermes'
import { AlertTriangle, Save, Terminal, Users } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { notify, notifyError } from '@/store/notifications'

import type { SetStatusbarItemGroup } from '../shell/statusbar-controls'
import { titlebarHeaderBaseClass } from '../shell/titlebar'
import type { SetTitlebarToolGroup } from '../shell/titlebar-controls'

const AGENT_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/
const AGENT_NAME_HINT = 'Lowercase letters, digits, hyphens, and underscores. Must start with a letter or digit.'

interface AgentProfilesViewProps extends React.ComponentProps<'section'> {
  setStatusbarItemGroup?: SetStatusbarItemGroup
  setTitlebarToolGroup?: SetTitlebarToolGroup
}

export function AgentProfilesView({
  setStatusbarItemGroup: _setStatusbarItemGroup,
  setTitlebarToolGroup,
  ...props
}: AgentProfilesViewProps) {
  const [profiles, setProfiles] = useState<null | ProfileInfo[]>(null)
  const [selectedName, setSelectedName] = useState<null | string>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)

  const refresh = useCallback(async () => {
    setRefreshing(true)

    try {
      const { profiles: list } = await getProfiles()
      setProfiles(list)
      setSelectedName(current => {
        if (current && list.some(profile => profile.name === current)) {
          return current
        }

        return list.find(profile => profile.is_default)?.name ?? list[0]?.name ?? null
      })
    } catch (err) {
      notifyError(err, 'Failed to load agents')
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!setTitlebarToolGroup) {
      return
    }

    setTitlebarToolGroup('agent-profiles', [
      {
        disabled: refreshing,
        icon: <Codicon name="refresh" spinning={refreshing} />,
        id: 'refresh-agent-profiles',
        label: refreshing ? 'Refreshing agents' : 'Refresh agents',
        onSelect: () => void refresh()
      }
    ])

    return () => setTitlebarToolGroup('agent-profiles', [])
  }, [refresh, refreshing, setTitlebarToolGroup])

  const selected = useMemo(() => {
    if (!profiles) {
      return null
    }

    return profiles.find(profile => profile.name === selectedName) ?? profiles[0] ?? null
  }, [profiles, selectedName])

  const handleCreate = useCallback(
    async (name: string, cloneFromDefault: boolean) => {
      const trimmed = name.trim().toLowerCase()

      if (!AGENT_NAME_RE.test(trimmed)) {
        throw new Error(AGENT_NAME_HINT)
      }

      await createProfile({ name: trimmed, clone_from_default: cloneFromDefault })
      notify({ kind: 'success', title: 'Agent created', message: trimmed })
      setSelectedName(trimmed)
      await refresh()
    },
    [refresh]
  )

  return (
    <section {...props} className="flex h-full min-w-0 flex-col overflow-hidden rounded-b-[0.9375rem] bg-background">
      <header className={titlebarHeaderBaseClass}>
        <h2 className="pointer-events-auto text-base font-semibold leading-none tracking-tight">Agents</h2>
        <span className="pointer-events-auto text-xs text-muted-foreground">
          {profiles ? `${profiles.length} ${profiles.length === 1 ? 'agent' : 'agents'}` : ''}
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden rounded-b-[1.0625rem] border border-border/50 bg-background/85">
        {!profiles ? (
          <PageLoader label="Loading agents..." />
        ) : (
          <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[20rem_minmax(0,1fr)]">
            <aside className="flex min-h-0 flex-col overflow-hidden border-b border-border/50 bg-muted/10 lg:border-b-0 lg:border-r">
              <div className="border-b border-border/40 p-3">
                <Button className="w-full" onClick={() => setCreateOpen(true)} size="sm">
                  <Codicon name="add" />
                  New agent
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                <div className="grid gap-2">
                  {profiles.map(profile => (
                    <AgentCard
                      active={selected?.name === profile.name}
                      key={profile.name}
                      onSelect={() => setSelectedName(profile.name)}
                      profile={profile}
                    />
                  ))}
                  {profiles.length === 0 && (
                    <div className="rounded-lg border border-dashed border-border/60 px-4 py-8 text-center text-xs text-muted-foreground">
                      No agents yet.
                    </div>
                  )}
                </div>
              </div>
            </aside>

            <main className="min-h-0 overflow-hidden">
              {selected ? (
                <AgentDetail key={selected.name} profile={selected} />
              ) : (
                <div className="grid h-full place-items-center px-6 py-12 text-center text-sm text-muted-foreground">
                  <div>
                    <Users className="mx-auto size-6 text-muted-foreground/60" />
                    <p className="mt-3">Select an agent to view or edit its prompt.</p>
                  </div>
                </div>
              )}
            </main>
          </div>
        )}
      </div>

      <CreateAgentDialog
        onClose={() => setCreateOpen(false)}
        onCreate={async (name, cloneFromDefault) => handleCreate(name, cloneFromDefault)}
        open={createOpen}
      />
    </section>
  )
}

function AgentCard({ active, onSelect, profile }: { active: boolean; onSelect: () => void; profile: ProfileInfo }) {
  const provider = profile.provider || 'auto'
  const model = profile.model ? profile.model.split('/').pop() : 'No model set'

  return (
    <button
      className={cn(
        'group rounded-xl border px-3 py-3 text-left transition-colors',
        active ? 'border-primary/40 bg-primary/10 text-foreground' : 'border-border/50 bg-background/70 hover:bg-accent/50'
      )}
      onClick={onSelect}
      type="button"
    >
      <div className="flex items-start gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-full bg-accent text-sm font-semibold text-foreground">
          {profile.name === 'default' ? <Codicon name="robot" /> : profile.name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold">{profile.name}</span>
            {profile.is_default && <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[0.6rem] text-primary">default</span>}
          </div>
          <div className="mt-1 truncate text-[0.68rem] text-muted-foreground">{provider} · {model}</div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[0.64rem] text-muted-foreground">
            <span>{profile.skill_count} skills</span>
            {profile.has_env && <span>· .env</span>}
            <span>· SOUL.md</span>
          </div>
        </div>
      </div>
    </button>
  )
}

function AgentDetail({ profile }: { profile: ProfileInfo }) {
  const [copying, setCopying] = useState(false)

  const handleCopySetup = useCallback(async () => {
    setCopying(true)

    try {
      const { command } = await getProfileSetupCommand(profile.name)
      await navigator.clipboard.writeText(command)
      notify({ kind: 'success', title: 'Setup command copied', message: command })
    } catch (err) {
      notifyError(err, 'Failed to copy setup command')
    } finally {
      setCopying(false)
    }
  }, [profile.name])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-6 px-6 py-6">
          <header className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-xl font-semibold tracking-tight">{profile.name}</h3>
                  {profile.is_default && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[0.65rem] font-medium text-primary">
                      Default
                    </span>
                  )}
                </div>
                <p className="mt-1 font-mono text-[0.7rem] text-muted-foreground" title={profile.path}>
                  {profile.path}
                </p>
              </div>
              <Button disabled={copying} onClick={() => void handleCopySetup()} size="sm" variant="outline">
                <Terminal />
                {copying ? 'Copying...' : 'Copy setup'}
              </Button>
            </div>

            <dl className="grid gap-2 rounded-lg border border-border/40 bg-background/70 px-3 py-3 text-xs sm:grid-cols-3">
              <DetailRow label="Provider">{profile.provider || 'auto'}</DetailRow>
              <DetailRow label="Model">{profile.model || 'Not set'}</DetailRow>
              <DetailRow label="Skills">{profile.skill_count}</DetailRow>
            </dl>
          </header>

          <AgentPromptEditor profileName={profile.name} />
        </div>
      </div>
    </div>
  )
}

function DetailRow({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <dt className="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</dt>
      <dd className="break-all text-sm text-foreground">{children}</dd>
    </div>
  )
}

function AgentPromptEditor({ profileName }: { profileName: string }) {
  const [content, setContent] = useState('')
  const [original, setOriginal] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<null | string>(null)
  const requestRef = useRef(profileName)

  useEffect(() => {
    requestRef.current = profileName
    setLoading(true)
    setError(null)
    setContent('')
    setOriginal('')

    void (async () => {
      try {
        const soul = await getProfileSoul(profileName)

        if (requestRef.current === profileName) {
          setContent(soul.content)
          setOriginal(soul.content)
        }
      } catch (err) {
        if (requestRef.current === profileName) {
          setError(err instanceof Error ? err.message : 'Failed to load agent prompt')
        }
      } finally {
        if (requestRef.current === profileName) {
          setLoading(false)
        }
      }
    })()
  }, [profileName])

  const dirty = content !== original
  const isEmpty = !content.trim()

  async function handleSave() {
    setSaving(true)
    setError(null)

    try {
      await updateProfileSoul(profileName, content)
      setOriginal(content)
      notify({ kind: 'success', title: 'Agent prompt saved', message: profileName })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save agent prompt')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h4 className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Agent prompt</h4>
          <p className="text-xs text-muted-foreground">Reads and edits this agent's SOUL.md persona/system instructions.</p>
        </div>
        {dirty && <span className="text-[0.65rem] text-muted-foreground">Unsaved changes</span>}
      </div>

      {loading ? (
        <div className="grid h-72 place-items-center rounded-md border border-border/40 bg-background/60 text-xs text-muted-foreground">
          Loading prompt...
        </div>
      ) : (
        <Textarea
          className="min-h-[28rem] font-mono text-xs leading-5"
          onChange={event => setContent(event.target.value)}
          placeholder={isEmpty ? 'Empty SOUL.md — write this agent persona here...' : undefined}
          value={content}
        />
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex justify-end">
        <Button disabled={!dirty || saving || loading} onClick={() => void handleSave()} size="sm">
          <Save />
          {saving ? 'Saving...' : 'Save prompt'}
        </Button>
      </div>
    </section>
  )
}

function CreateAgentDialog({
  onClose,
  onCreate,
  open
}: {
  onClose: () => void
  onCreate: (name: string, cloneFromDefault: boolean) => Promise<void>
  open: boolean
}) {
  const [name, setName] = useState('')
  const [cloneFromDefault, setCloneFromDefault] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<null | string>(null)

  useEffect(() => {
    if (!open) {
      return
    }

    setName('')
    setCloneFromDefault(true)
    setError(null)
    setSaving(false)
  }, [open])

  const trimmed = name.trim().toLowerCase()
  const invalid = trimmed !== '' && !AGENT_NAME_RE.test(trimmed)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()

    if (!trimmed || invalid) {
      setError(invalid ? `Invalid name. ${AGENT_NAME_HINT}` : 'Name is required.')

      return
    }

    setSaving(true)
    setError(null)

    try {
      await onCreate(trimmed, cloneFromDefault)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create agent')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog onOpenChange={value => !value && !saving && onClose()} open={open}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New agent</DialogTitle>
          <DialogDescription>
            Agents are Hermes profiles: separate config, skills, environment, and SOUL.md prompt.
          </DialogDescription>
        </DialogHeader>

        <form className="grid gap-4" onSubmit={handleSubmit}>
          <div className="grid gap-1.5">
            <label className="text-xs font-medium" htmlFor="new-agent-name">
              Name
            </label>
            <Input
              aria-invalid={invalid}
              autoFocus
              id="new-agent-name"
              onChange={event => setName(event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
              placeholder="jurishub-reviewer"
              value={name}
            />
            <p className={cn('text-[0.66rem] leading-4', invalid ? 'text-destructive' : 'text-muted-foreground')}>
              {AGENT_NAME_HINT}
            </p>
          </div>

          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border/40 bg-background/50 px-3 py-2 text-sm">
            <input
              checked={cloneFromDefault}
              className="size-4 accent-primary"
              onChange={event => setCloneFromDefault(event.target.checked)}
              type="checkbox"
            />
            <span>
              <span className="font-medium">Clone from default</span>
              <span className="ml-2 text-xs text-muted-foreground">Copy config, skills, and prompt.</span>
            </span>
          </label>

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <DialogFooter>
            <Button disabled={saving} onClick={onClose} type="button" variant="outline">
              Cancel
            </Button>
            <Button disabled={saving || !trimmed || invalid} type="submit">
              {saving ? 'Creating...' : 'Create agent'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
