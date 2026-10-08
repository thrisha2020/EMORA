import { useCallback } from 'react'
import { Particles, ParticlesProvider } from '@tsparticles/react'
import { loadSlim } from '@tsparticles/slim'
import type { Engine } from '@tsparticles/engine'

export interface ParticlesBgProps {
  variant?: 'default' | 'dense' | 'minimal'
}

function ParticlesInner({ variant = 'default' }: ParticlesBgProps) {
  const count = variant === 'dense' ? 120 : variant === 'minimal' ? 25 : 60

  return (
    <Particles
      id={`particles-${variant}`}
      style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none' }}
      options={{
        background: { color: { value: 'transparent' } },
        fpsLimit: 60,
        particles: {
          color: { value: ['#00D9FF', '#7B5CFF', '#ffffff'] },
          links: {
            color: '#00D9FF',
            distance: 120,
            enable: variant === 'dense',
            opacity: 0.08,
            width: 0.5,
          },
          move: {
            direction: 'none',
            enable: true,
            outModes: { default: 'bounce' },
            random: true,
            speed: 0.3,
            straight: false,
          },
          number: { density: { enable: true }, value: count },
          opacity: {
            value: { min: 0.05, max: 0.4 },
            animation: { enable: true, speed: 0.5 },
          },
          shape: { type: 'circle' },
          size: { value: { min: 0.5, max: 2.5 } },
        },
        detectRetina: true,
      }}
    />
  )
}

/** Animated star-field background using tsParticles slim engine.
 *  Variant controls density: 'minimal' (25), 'default' (60), 'dense' (120 + links). */
export default function ParticlesBg({ variant = 'default' }: ParticlesBgProps) {
  const initEngine = useCallback(async (engine: Engine) => {
    await loadSlim(engine)
  }, [])

  return (
    <ParticlesProvider init={initEngine}>
      <ParticlesInner variant={variant} />
    </ParticlesProvider>
  )
}
