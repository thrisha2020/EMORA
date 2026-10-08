import React, { memo, useRef } from 'react'
import type { FaceTrack } from '@/hooks/useFaceTracking'
import { Canvas, useFrame } from '@react-three/fiber'
import { useGLTF, PresentationControls } from '@react-three/drei'
import * as THREE from 'three'
import Character from './Character'
import { extendAvatarLoader, getAvatar } from './avatars'

export interface EmoraCoreProps {
  state?: string
  emotion?: string
  listening?: boolean
  speaking?: boolean
  materialize?: number
  rings?: number
  /** 0-1 confidence in `emotion`; scales how strongly the face expresses it. */
  confidence?: number
  /** 'head' (default) frames the face; 'full' shows the whole body. */
  framing?: 'head' | 'full'
  /** Live webcam head position; when present the avatar looks at the user. */
  faceTrack?: React.RefObject<FaceTrack>
  /** Model to show; defaults to the avatar picked in Settings. */
  avatarUrl?: string
  className?: string
  style?: React.CSSProperties
}

const EMOTION_COLORS: Record<string, [string, string]> = {
  happy: ['#ffc857', '#ff9f45'],
  sad: ['#5b8dff', '#3f5fd0'],
  angry: ['#ff5c5c', '#c0392b'],
  fear: ['#b088ff', '#7b5cff'],
  surprise: ['#4fd6c8', '#00d9ff'],
  disgust: ['#8fbf6a', '#5c8f3a'],
  neutral: ['#00d9ff', '#7b5cff'],
}

function GlowRings({ listening, emotion }: { listening: boolean; emotion: string }) {
  const [inner, outer] = EMOTION_COLORS[emotion] ?? EMOTION_COLORS.neutral
  const ring1 = useRef<THREE.Mesh>(null)
  const ring2 = useRef<THREE.Mesh>(null)

  useFrame((state) => {
    const t = state.clock.getElapsedTime()
    if (ring1.current) {
      ring1.current.rotation.z = t * 0.5
      const scale = listening ? 1.2 + Math.sin(t * 8) * 0.1 : 1
      ring1.current.scale.setScalar(scale)
    }
    if (ring2.current) {
      ring2.current.rotation.z = -t * 0.3
      const scale = listening ? 1.5 + Math.sin(t * 8) * 0.15 : 1.2
      ring2.current.scale.setScalar(scale)
    }
  })

  return (
    <group position={[0, -1.6, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh ref={ring1}>
        <ringGeometry args={[1, 1.05, 64]} />
        <meshBasicMaterial color={inner} transparent opacity={0.6} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={ring2}>
        <ringGeometry args={[1.3, 1.32, 64]} />
        <meshBasicMaterial color={outer} transparent opacity={0.4} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

function EmoraCore({
  className,
  style,
  listening,
  speaking,
  emotion,
  confidence,
  framing = 'head',
  faceTrack,
  avatarUrl,
}: EmoraCoreProps) {
  const head = framing === 'head'
  const url = avatarUrl ?? getAvatar().url
  return (
    <div className={className} style={{ width: '100%', height: '100%', ...style }}>
      <Canvas
        camera={head ? { position: [0, 0, 0.72], fov: 30 } : { position: [0, 0, 5], fov: 45 }}
      >
        {head ? (
          // Portrait rig, scaled to a camera 0.72 units away. Lights placed at
          // 10 units (the full-body setup) fall off to almost nothing this close
          // and leave the face flat and grey.
          <>
            <ambientLight intensity={0.85} />
            {/* key */}
            <pointLight position={[0.4, 0.5, 0.8]} intensity={2.2} />
            {/* fill, tinted to the HUD cyan */}
            <pointLight position={[-0.6, 0.1, 0.5]} intensity={0.9} color="#7fd8ff" />
            {/* rim, to lift her off the dark panel */}
            <pointLight position={[0, 0.4, -0.9]} intensity={1.4} color="#7b5cff" />
          </>
        ) : (
          <>
            <ambientLight intensity={0.6} />
            <spotLight position={[10, 10, 10]} angle={0.2} penumbra={1} intensity={1.5} castShadow />
            <pointLight position={[-10, -10, -10]} intensity={0.8} color="#00d9ff" />
          </>
        )}
        
        <PresentationControls
          global
          rotation={[0, 0, 0]}
          polar={[-0.1, 0.2]}
          azimuth={[-0.5, 0.5]}
          snap
        >
          <React.Suspense fallback={null}>
              <Character
                key={url} // fresh hook state per model; the pose restore runs on the old one
                url={url}
                speaking={speaking ?? false}
                emotion={emotion}
                confidence={confidence}
              framing={framing}
              faceTrack={faceTrack}
            />
          </React.Suspense>
        </PresentationControls>

        {!head && <GlowRings listening={listening ?? false} emotion={emotion ?? 'neutral'} />}
      </Canvas>
    </div>
  )
}

useGLTF.preload(getAvatar().url, undefined, undefined, extendAvatarLoader)

/** Memoized: the canvas only re-renders when a prop it actually uses changes. */
export default memo(EmoraCore)
