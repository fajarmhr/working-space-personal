'use client'

import { memo, useRef, type ReactNode } from 'react'
import { motion, useMotionValue, useSpring, useReducedMotion } from 'framer-motion'
import { ArrowUpRight } from '@phosphor-icons/react'
import { cn } from '../lib/utils'

export const StatusPulse = memo(function StatusPulse({
  connected = true,
}: {
  connected?: boolean
}) {
  const reduced = useReducedMotion()
  return (
    <span className="relative flex size-2 shrink-0 items-center justify-center">
      {connected && (
        <motion.span
          className="absolute inset-0 rounded-full bg-primary/35"
          animate={reduced ? {} : { scale: [1, 2.2, 1], opacity: [0.45, 0, 0.45] }}
          transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}
      <span
        className={cn('size-1.5 rounded-full', connected ? 'bg-primary' : 'bg-muted-foreground')}
      />
    </span>
  )
})

export function MagneticButton({
  children,
  onClick,
  className,
}: {
  children: ReactNode
  onClick: () => void
  className?: string
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const reduced = useReducedMotion()
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const springX = useSpring(x, { stiffness: 100, damping: 20 })
  const springY = useSpring(y, { stiffness: 100, damping: 20 })
  return (
    <motion.button
      ref={ref}
      type="button"
      onClick={onClick}
      style={reduced ? undefined : { x: springX, y: springY }}
      onPointerMove={(event) => {
        if (reduced || event.pointerType !== 'mouse') return
        const rect = ref.current?.getBoundingClientRect()
        if (rect) {
          x.set((event.clientX - rect.left - rect.width / 2) * 0.12)
          y.set((event.clientY - rect.top - rect.height / 2) * 0.12)
        }
      }}
      onPointerLeave={() => {
        x.set(0)
        y.set(0)
      }}
      whileTap={{ scale: 0.97 }}
      className={cn(
        'inline-flex h-11 items-center gap-3 rounded-xl bg-primary px-5 text-[13px] font-medium text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        className,
      )}
    >
      {children}
      <ArrowUpRight size={17} />
    </motion.button>
  )
}

export const Orbit = memo(function Orbit() {
  const reduced = useReducedMotion()
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <motion.div
        className="absolute -right-8 -bottom-12 size-56 rounded-full border border-primary/10"
        animate={reduced ? {} : { rotate: 360 }}
        transition={{ duration: 65, repeat: Infinity, ease: 'linear' }}
      >
        <span className="absolute top-6 left-8 size-3 rounded-full border-[3px] border-surface bg-primary/50" />
      </motion.div>
      <div className="absolute -right-3 -bottom-7 size-44 rounded-full border border-primary/10" />
    </div>
  )
})
