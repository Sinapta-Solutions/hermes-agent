import { useStore } from '@nanostores/react'
import { type ReactNode, useEffect } from 'react'

import { useMediaQuery } from '@/hooks/use-media-query'
import { $backgroundEffect, $motionMode, resolveMotionMode } from '@/store/appearance'

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const motionMode = useStore($motionMode)
  const backgroundEffect = useStore($backgroundEffect)
  const systemReduced = useMediaQuery('(prefers-reduced-motion: reduce)')
  const resolvedMotion = resolveMotionMode(motionMode, systemReduced)

  useEffect(() => {
    const root = document.documentElement

    root.dataset.hermesMotion = resolvedMotion
    root.dataset.hermesMotionPreference = motionMode
  }, [motionMode, resolvedMotion])

  useEffect(() => {
    document.documentElement.dataset.hermesBackgroundEffect = backgroundEffect
  }, [backgroundEffect])

  return children
}
