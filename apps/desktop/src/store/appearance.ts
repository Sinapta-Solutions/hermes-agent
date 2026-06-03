import { atom } from 'nanostores'

import { persistString, storedString } from '@/lib/storage'

const MOTION_STORAGE_KEY = 'hermes.desktop.motionMode.v1'
const BACKGROUND_EFFECT_STORAGE_KEY = 'hermes.desktop.backgroundEffect.v1'

export type MotionMode = 'system' | 'full' | 'reduced' | 'off'
export type ResolvedMotionMode = 'full' | 'reduced' | 'off'
export type BackgroundEffect = 'none' | 'dots' | 'rain' | 'constellations' | 'petals' | 'sparkles' | 'embers'

const MOTION_MODES = new Set<MotionMode>(['system', 'full', 'reduced', 'off'])
const BACKGROUND_EFFECTS = new Set<BackgroundEffect>([
  'none',
  'dots',
  'rain',
  'constellations',
  'petals',
  'sparkles',
  'embers'
])

function normalizeMotionMode(value: null | string): MotionMode {
  return value && MOTION_MODES.has(value as MotionMode) ? (value as MotionMode) : 'system'
}

function normalizeBackgroundEffect(value: null | string): BackgroundEffect {
  return value && BACKGROUND_EFFECTS.has(value as BackgroundEffect) ? (value as BackgroundEffect) : 'none'
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export function resolveMotionMode(mode: MotionMode, systemReduced = prefersReducedMotion()): ResolvedMotionMode {
  if (mode === 'system') {
    return systemReduced ? 'reduced' : 'full'
  }

  return mode
}

export function shouldReduceMotion(): boolean {
  if (typeof document !== 'undefined') {
    const resolved = document.documentElement.dataset.hermesMotion

    if (resolved === 'off' || resolved === 'reduced') {
      return true
    }

    if (resolved === 'full') {
      return false
    }
  }

  return resolveMotionMode($motionMode.get()) !== 'full'
}

export const $motionMode = atom<MotionMode>(normalizeMotionMode(storedString(MOTION_STORAGE_KEY)))
export const $backgroundEffect = atom<BackgroundEffect>(normalizeBackgroundEffect(storedString(BACKGROUND_EFFECT_STORAGE_KEY)))

$motionMode.subscribe(mode => persistString(MOTION_STORAGE_KEY, mode))
$backgroundEffect.subscribe(effect => persistString(BACKGROUND_EFFECT_STORAGE_KEY, effect))

export function setMotionMode(mode: MotionMode) {
  $motionMode.set(normalizeMotionMode(mode))
}

export function setBackgroundEffect(effect: BackgroundEffect) {
  $backgroundEffect.set(normalizeBackgroundEffect(effect))
}
