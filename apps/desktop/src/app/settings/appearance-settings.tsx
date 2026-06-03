import { useStore } from '@nanostores/react'

import { triggerHaptic } from '@/lib/haptics'
import { Check, Palette } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { $backgroundEffect, $motionMode, setBackgroundEffect, setMotionMode } from '@/store/appearance'
import type { BackgroundEffect, MotionMode } from '@/store/appearance'
import { $toolViewMode, setToolViewMode } from '@/store/tool-view'
import { useTheme } from '@/themes/context'
import { BUILTIN_THEMES } from '@/themes/presets'

import { MODE_OPTIONS } from './constants'
import { prettyName } from './helpers'
import { Pill, SectionHeading, SettingsContent } from './primitives'

const MOTION_OPTIONS: Array<{ id: MotionMode; label: string; description: string }> = [
  { id: 'system', label: 'System', description: 'Follow the OS reduced-motion setting.' },
  { id: 'full', label: 'Full', description: 'Keep ambient backgrounds and UI motion active.' },
  { id: 'reduced', label: 'Reduced', description: 'Slow down ambient motion and shorten transitions.' },
  { id: 'off', label: 'Off', description: 'Disable decorative animation across the desktop.' }
]

const BACKGROUND_EFFECT_OPTIONS: Array<{ id: BackgroundEffect; label: string; description: string; preview: string }> = [
  { id: 'none', label: 'Solid', description: 'No ambient layer.', preview: 'bg-(--ui-bg-quinary)' },
  { id: 'dots', label: 'Dots', description: 'Soft tactical dot field.', preview: 'bg-[radial-gradient(circle,var(--ui-accent)_1px,transparent_1px)] bg-[length:10px_10px]' },
  { id: 'rain', label: 'Rain', description: 'Odysseus midnight streaks.', preview: 'bg-[repeating-linear-gradient(100deg,transparent_0_12px,var(--ui-accent)_13px_14px)]' },
  { id: 'constellations', label: 'Constellations', description: 'Quiet star-map mesh.', preview: 'bg-[radial-gradient(circle,var(--ui-accent)_1px,transparent_2px)] bg-[length:18px_18px]' },
  { id: 'petals', label: 'Petals', description: 'Ume-style sakura drift.', preview: 'bg-[radial-gradient(circle_at_30%_30%,#f5c2e7_0_2px,transparent_3px)] bg-[length:16px_16px]' },
  { id: 'sparkles', label: 'Sparkles', description: 'Subtle assistant shimmer.', preview: 'bg-[radial-gradient(circle,#f5c2e7_0_1px,transparent_2px)] bg-[length:12px_12px]' },
  { id: 'embers', label: 'Embers', description: 'Warm forge particles.', preview: 'bg-[radial-gradient(circle,#f59e0b_0_1px,transparent_2px)] bg-[length:14px_14px]' }
]

function ThemePreview({ name }: { name: string }) {
  const t = BUILTIN_THEMES[name]

  if (!t) {
    return null
  }

  const c = t.colors

  return (
    <div
      className="h-20 overflow-hidden rounded-xl border shadow-xs"
      style={{ backgroundColor: c.background, borderColor: c.border }}
    >
      <div className="flex h-full">
        <div
          className="w-12 border-r"
          style={{
            backgroundColor: c.sidebarBackground ?? c.muted,
            borderColor: c.sidebarBorder ?? c.border
          }}
        />
        <div className="flex flex-1 flex-col gap-2 p-3">
          <div className="h-2.5 w-16 rounded-full" style={{ backgroundColor: c.foreground }} />
          <div className="h-2 w-24 rounded-full" style={{ backgroundColor: c.mutedForeground }} />
          <div className="mt-auto flex justify-end">
            <div
              className="h-5 w-16 rounded-full border"
              style={{
                backgroundColor: c.userBubble ?? c.muted,
                borderColor: c.userBubbleBorder ?? c.border
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export function AppearanceSettings() {
  const { themeName, mode, availableThemes, setTheme, setMode } = useTheme()
  const toolViewMode = useStore($toolViewMode)
  const motionMode = useStore($motionMode)
  const backgroundEffect = useStore($backgroundEffect)
  const activeTheme = availableThemes.find(t => t.name === themeName)
  const activeMotion = MOTION_OPTIONS.find(option => option.id === motionMode)
  const activeBackgroundEffect = BACKGROUND_EFFECT_OPTIONS.find(option => option.id === backgroundEffect)

  return (
    <SettingsContent>
      <div className="space-y-5">
        <div>
          <SectionHeading icon={Palette} title="Appearance" />
          <p className="max-w-2xl text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
            These are desktop-only display preferences. Mode controls brightness; theme controls the accent palette and
            chat surface styling.
          </p>
        </div>

        <section className="rounded-xl border border-(--ui-stroke-tertiary) bg-(--ui-chat-bubble-background) p-3 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">Color Mode</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Pick a fixed mode or let Hermes follow your system setting.
              </div>
            </div>
            <Pill>{prettyName(mode)}</Pill>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {MODE_OPTIONS.map(({ id, label, description, icon: Icon }) => {
              const active = mode === id

              return (
                <button
                  className={cn(
                    'group rounded-lg border border-(--ui-stroke-tertiary) bg-(--ui-bg-quinary) p-2.5 text-left transition hover:bg-(--chrome-action-hover)',
                    active && 'border-(--ui-stroke-secondary) bg-(--ui-bg-tertiary)'
                  )}
                  key={id}
                  onClick={() => {
                    triggerHaptic('crisp')
                    setMode(id)
                  }}
                  type="button"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-foreground transition group-hover:bg-background">
                      <Icon className="size-4" />
                    </span>
                    {active && (
                      <span className="grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
                        <Check className="size-3.5" />
                      </span>
                    )}
                  </div>
                  <div className="mt-2 text-[length:var(--conversation-text-font-size)] font-medium">{label}</div>
                  <div className="mt-1 text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
                    {description}
                  </div>
                </button>
              )
            })}
          </div>
        </section>


        <section className="rounded-xl border border-(--ui-stroke-tertiary) bg-(--ui-chat-bubble-background) p-3 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">Ambient Background</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Odysseus-inspired patterns applied behind the whole desktop shell.
              </div>
            </div>
            {activeBackgroundEffect && <Pill>{activeBackgroundEffect.label}</Pill>}
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {BACKGROUND_EFFECT_OPTIONS.map(option => {
              const active = backgroundEffect === option.id

              return (
                <button
                  className={cn(
                    'group rounded-lg border border-(--ui-stroke-tertiary) bg-(--ui-bg-quinary) p-2.5 text-left transition hover:bg-(--chrome-action-hover)',
                    active && 'border-(--ui-stroke-secondary) bg-(--ui-bg-tertiary)'
                  )}
                  key={option.id}
                  onClick={() => {
                    triggerHaptic('selection')
                    setBackgroundEffect(option.id)
                  }}
                  type="button"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className={cn('h-10 flex-1 rounded-lg border border-(--ui-stroke-tertiary) opacity-70', option.preview)} />
                    {active && (
                      <span className="grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
                        <Check className="size-3.5" />
                      </span>
                    )}
                  </div>
                  <div className="mt-2 text-[length:var(--conversation-text-font-size)] font-medium">{option.label}</div>
                  <div className="mt-1 text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
                    {option.description}
                  </div>
                </button>
              )
            })}
          </div>
        </section>

        <section className="rounded-xl border border-(--ui-stroke-tertiary) bg-(--ui-chat-bubble-background) p-3 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">Animations</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Controls decorative motion, transitions, and Web Animations API enter effects globally.
              </div>
            </div>
            {activeMotion && <Pill>{activeMotion.label}</Pill>}
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {MOTION_OPTIONS.map(option => {
              const active = motionMode === option.id

              return (
                <button
                  className={cn(
                    'group rounded-lg border border-(--ui-stroke-tertiary) bg-(--ui-bg-quinary) p-2.5 text-left transition hover:bg-(--chrome-action-hover)',
                    active && 'border-(--ui-stroke-secondary) bg-(--ui-bg-tertiary)'
                  )}
                  key={option.id}
                  onClick={() => {
                    triggerHaptic('selection')
                    setMotionMode(option.id)
                  }}
                  type="button"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-[length:var(--conversation-text-font-size)] font-medium">{option.label}</div>
                    {active && (
                      <span className="grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
                        <Check className="size-3.5" />
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
                    {option.description}
                  </div>
                </button>
              )
            })}
          </div>
        </section>

        <section className="rounded-xl border border-(--ui-stroke-tertiary) bg-(--ui-chat-bubble-background) p-3 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">Tool Call Display</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Product hides raw tool payloads; Technical shows full input/output.
              </div>
            </div>
            <Pill>{toolViewMode === 'technical' ? 'Technical' : 'Product'}</Pill>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                {
                  id: 'product',
                  label: 'Product',
                  description: 'Human-friendly tool activity with concise summaries.'
                },
                {
                  id: 'technical',
                  label: 'Technical',
                  description: 'Include raw tool args/results and low-level details.'
                }
              ] as const
            ).map(option => {
              const active = toolViewMode === option.id

              return (
                <button
                  className={cn(
                    'group rounded-lg border border-(--ui-stroke-tertiary) bg-(--ui-bg-quinary) p-2.5 text-left transition hover:bg-(--chrome-action-hover)',
                    active && 'border-(--ui-stroke-secondary) bg-(--ui-bg-tertiary)'
                  )}
                  key={option.id}
                  onClick={() => {
                    triggerHaptic('selection')
                    setToolViewMode(option.id)
                  }}
                  type="button"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-[length:var(--conversation-text-font-size)] font-medium">{option.label}</div>
                    {active && (
                      <span className="grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
                        <Check className="size-3.5" />
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
                    {option.description}
                  </div>
                </button>
              )
            })}
          </div>
        </section>

        <section className="rounded-xl border border-(--ui-stroke-tertiary) bg-(--ui-chat-bubble-background) p-3 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">Theme</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Desktop palettes only. The selected mode is applied on top.
              </div>
            </div>
            {activeTheme && <Pill>{activeTheme.label}</Pill>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {availableThemes.map(theme => {
              const active = themeName === theme.name

              return (
                <button
                  className={cn(
                    'rounded-lg border border-(--ui-stroke-tertiary) bg-(--ui-bg-quinary) p-2 text-left transition hover:bg-(--chrome-action-hover)',
                    active && 'border-(--ui-stroke-secondary) bg-(--ui-bg-tertiary)'
                  )}
                  key={theme.name}
                  onClick={() => {
                    triggerHaptic('crisp')
                    setTheme(theme.name)
                  }}
                  type="button"
                >
                  <ThemePreview name={theme.name} />
                  <div className="mt-3 flex items-start justify-between gap-3 px-1">
                    <div className="min-w-0">
                      <div className="truncate text-[length:var(--conversation-text-font-size)] font-medium">
                        {theme.label}
                      </div>
                      <div className="mt-0.5 line-clamp-2 text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
                        {theme.description}
                      </div>
                    </div>
                    {active && (
                      <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                        <Check className="size-3.5" />
                      </span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </section>
      </div>
    </SettingsContent>
  )
}
