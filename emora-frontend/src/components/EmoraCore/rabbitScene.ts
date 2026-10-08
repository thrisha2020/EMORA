/**
 * Holographic rabbit scene renderer (port of the Streamlit RABBIT_JS canvas).
 * Self-contained: create a scene with `makeRabbitScene(ctx, W, H)`, then drive
 * `init()` once and `draw(dt, opts)` every animation frame.
 */

const TAU = Math.PI * 2

export interface RabbitSceneOpts {
  state?: string
  emotion?: string
  focusing?: boolean
  listening?: boolean
  speaking?: boolean
  materialize?: number
  rings?: number
}

export interface RabbitScene {
  init: () => void
  draw: (dt: number, o: RabbitSceneOpts) => void
}

const EXPR: Record<string, [number, number, number]> = {
  happy: [255, 215, 0],
  sad: [80, 150, 255],
  angry: [255, 92, 92],
  fear: [178, 110, 255],
  surprise: [70, 255, 180],
  disgust: [255, 190, 110],
  neutral: [0, 212, 255],
}

function rand(a: number, b: number) {
  return a + Math.random() * (b - a)
}

function mix(a: number, b: number, t: number) {
  return a + (b - a) * t
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

function ease(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}

function rgba(c: [number, number, number], a: number) {
  return `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`
}

function exprFor(e: string) {
  return EXPR[e.toLowerCase()] ?? EXPR.neutral
}

interface Particle {
  x: number
  y: number
  bx: number
  by: number
  r: number
  ph: number
  big: boolean
  ring: number
}

export function makeRabbitScene(ctx: CanvasRenderingContext2D, W: number, H: number): RabbitScene {
  const u = Math.min(W, H)
  const cx = W / 2
  const cy = H * 0.42

  let particles: Particle[] = []
  const fogA = { x: rand(0, W), y: rand(0, H), r: rand(0.3, 0.5) * W, vx: rand(4, 12), vy: rand(-6, 6) }
  const fogB = { x: rand(0, W), y: rand(0, H), r: rand(0.25, 0.4) * W, vx: rand(-10, -4), vy: rand(-5, 5) }

  function spawn() {
    particles = []
    const n = Math.round(clamp((W * H) / 3400, 30, 80))
    for (let i = 0; i < n; i++) {
      particles.push({
        x: rand(0, W),
        y: rand(0, H),
        bx: rand(0, W),
        by: rand(0, H),
        r: rand(0.6, 2.2),
        ph: rand(0, TAU),
        big: Math.random() < 0.14,
        ring: rand(0, TAU),
      })
    }
  }

  function drawBackdrop(time: number, accent: [number, number, number], boot: number) {
    ctx.fillStyle = '#020609'
    ctx.fillRect(0, 0, W, H)

    fogA.x += fogA.vx * 0.016
    fogA.y += fogA.vy * 0.016
    fogB.x += fogB.vx * 0.016
    fogB.y += fogB.vy * 0.016
    if (fogA.x < -fogA.r) fogA.x = W + fogA.r
    else if (fogA.x > W + fogA.r) fogA.x = -fogA.r
    if (fogA.y < -fogA.r) fogA.y = H + fogA.r
    else if (fogA.y > H + fogA.r) fogA.y = -fogA.r
    if (fogB.x < -fogB.r) fogB.x = W + fogB.r
    else if (fogB.x > W + fogB.r) fogB.x = -fogB.r
    if (fogB.y < -fogB.r) fogB.y = H + fogB.r
    else if (fogB.y > H + fogB.r) fogB.y = -fogB.r
    ctx.save()
    const fa = ctx.createRadialGradient(fogA.x, fogA.y, 0, fogA.x, fogA.y, fogA.r)
    fa.addColorStop(0, 'rgba(0,120,200,0.05)')
    fa.addColorStop(1, 'rgba(0,120,200,0)')
    ctx.fillStyle = fa
    ctx.fillRect(0, 0, W, H)
    const fb = ctx.createRadialGradient(fogB.x, fogB.y, 0, fogB.x, fogB.y, fogB.r)
    fb.addColorStop(0, 'rgba(0,180,255,0.04)')
    fb.addColorStop(1, 'rgba(0,180,255,0)')
    ctx.fillStyle = fb
    ctx.fillRect(0, 0, W, H)
    ctx.restore()

    const gridFade = ease(boot)
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, u * 0.9)
    glow.addColorStop(0, `rgba(${accent[0]},${accent[1]},${accent[2]},${0.14 * gridFade})`)
    glow.addColorStop(0.5, 'rgba(0,212,255,0.05)')
    glow.addColorStop(1, 'rgba(0,212,255,0)')
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, W, H)

    ctx.strokeStyle = 'rgba(0,212,255,0.05)'
    ctx.lineWidth = 1
    const gs = 56
    ctx.beginPath()
    for (let gx = 0; gx <= W; gx += gs) {
      ctx.moveTo(gx, 0)
      ctx.lineTo(gx, H)
    }
    for (let gy = 0; gy <= H; gy += gs) {
      ctx.moveTo(0, gy)
      ctx.lineTo(W, gy)
    }
    ctx.stroke()

    const converge = 1 - boot
    const ringR = u * 0.5
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i]
      let tx = p.bx
      let ty = p.by
      if (converge > 0) {
        const ang = p.ring + time * 0.6
        tx = cx + Math.cos(ang) * ringR * (0.4 + 0.6 * boot)
        ty = cy + Math.sin(ang) * ringR * 0.35 * (0.4 + 0.6 * boot)
      }
      p.x = mix(p.x, tx, 0.04 + converge * 0.08)
      p.y = mix(p.y, ty, 0.04 + converge * 0.08)
      p.bx += Math.sin(time * 0.5 + p.ph) * 0.02
      p.by += Math.cos(time * 0.4 + p.ph) * 0.02
      const pulse = 0.4 + 0.6 * Math.abs(Math.sin(time * 1.3 + p.ph))
      if (p.big) {
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 3)
        g.addColorStop(0, rgba(accent, 0.55 * pulse))
        g.addColorStop(1, rgba(accent, 0))
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r * 3, 0, TAU)
        ctx.fill()
      } else {
        ctx.fillStyle = rgba(accent, 0.28 * pulse)
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, TAU)
        ctx.fill()
      }
    }
  }

  function drawRings(time: number, accent: [number, number, number], rings: number, thinking: boolean) {
    const sweep = time * (thinking ? 1.6 : 0.5) * (rings + 0.2)
    const radii = [u * 0.52, u * 0.43, u * 0.31]
    ctx.save()
    for (let i = 0; i < 3; i++) {
      const R = radii[i] * rings
      const op = 0.3 - i * 0.07
      const dash = i === 1 ? [u * 0.05, u * 0.03] : []
      ctx.strokeStyle = rgba(accent, op)
      ctx.lineWidth = i === 0 ? 1.6 : 1
      if (dash.length) ctx.setLineDash(dash)
      ctx.beginPath()
      ctx.arc(cx, cy, Math.max(R, 1), i % 2 ? -sweep : sweep, (i % 2 ? -sweep : sweep) + TAU)
      ctx.stroke()
      ctx.setLineDash([])
    }
    const R0 = Math.max(radii[0] * rings, 1)
    for (let t = 0; t < 48; t++) {
      const ang = (t / 48) * TAU + sweep * 0.5
      const len = t % 4 === 0 ? u * 0.024 : u * 0.011
      ctx.strokeStyle = rgba(accent, t % 4 === 0 ? 0.35 : 0.14)
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(cx + Math.cos(ang) * R0, cy + Math.sin(ang) * R0)
      ctx.lineTo(cx + Math.cos(ang) * (R0 - len), cy + Math.sin(ang) * (R0 - len))
      ctx.stroke()
    }
    ctx.restore()
  }

  function holoEar(x: number, w: number, h: number, side: number, sway: number, alpha: number) {
    ctx.save()
    ctx.translate(x, 0)
    ctx.rotate(side * sway)
    ctx.translate(-x, 0)
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.quadraticCurveTo(x + side * w, -h * 0.5, x + side * w * 0.3, -h)
    ctx.quadraticCurveTo(x + side * w * 0.05, -h * 1.06, x - side * w * 0.42, -h * 0.92)
    ctx.quadraticCurveTo(x - side * w * 0.98, -h * 0.55, x - side * w * 0.5, 0)
    ctx.closePath()
    const g = ctx.createLinearGradient(x - w, -h, x + w, 0)
    g.addColorStop(0, `rgba(190,235,255,${0.28 * alpha})`)
    g.addColorStop(1, 'rgba(190,235,255,0.04)')
    ctx.fillStyle = g
    ctx.fill()
    ctx.strokeStyle = `rgba(0,212,255,${0.75 * alpha})`
    ctx.lineWidth = 1.2
    ctx.shadowColor = 'rgba(0,212,255,0.8)'
    ctx.shadowBlur = 8
    ctx.stroke()
    ctx.shadowBlur = 0
    ctx.beginPath()
    ctx.moveTo(x, -h * 0.12)
    ctx.quadraticCurveTo(x + side * w * 0.5, -h * 0.5, x + side * w * 0.2, -h * 0.9)
    ctx.quadraticCurveTo(x - side * w * 0.4, -h * 0.6, x - side * w * 0.2, -h * 0.12)
    ctx.closePath()
    ctx.fillStyle = `rgba(0,212,255,${0.28 * alpha})`
    ctx.fill()
    ctx.restore()
  }

  function blinkFactor(t: number) {
    const c = t % 4.8
    if (c > 4.55 && c < 4.75) return Math.abs(Math.sin(((c - 4.55) / 0.2) * Math.PI)) * 0.1
    return 1
  }

  function drawRabbit(time: number, o: RabbitSceneOpts, alpha: number) {
    const thinking = o.state === 'THINKING'
    const listening = !!o.listening || o.state === 'LISTENING'
    const speaking = !!o.speaking || o.state === 'SPEAKING'
    const happy = o.emotion === 'happy' || o.state === 'NAME_RECEIVED'

    const breath = Math.sin(time * (thinking ? 2.3 : 1.2)) * u * 0.006
    const bob = Math.sin(time * 1.4) * u * 0.008
    const floatY = cy + bob + breath

    const headW = u * 0.3
    const headH = u * 0.23
    let sway = Math.sin(time * 0.9) * 0.03
    if (listening) sway += Math.sin(time * 2.8) * 0.05
    if (o.focusing) sway += 0.04
    const tilt = (o.focusing ? 0.035 : 0) + (listening ? Math.sin(time * 2.6) * 0.04 : 0)

    ctx.save()
    ctx.translate(cx, floatY)
    ctx.rotate(tilt)
    ctx.scale(o.materialize ?? 1, o.materialize ?? 1)

    holoEar(-headW * 0.45, u * 0.1, u * 0.34, -1, sway, alpha)
    holoEar(headW * 0.45, u * 0.1, u * 0.34, 1, sway, alpha)

    ctx.beginPath()
    ctx.ellipse(0, 0, headW, headH, 0, 0, TAU)
    const hg = ctx.createRadialGradient(0, -headH * 0.15, headH * 0.1, 0, 0, headH * 1.4)
    hg.addColorStop(0, `rgba(225,245,255,${0.3 * alpha})`)
    hg.addColorStop(0.6, `rgba(170,215,240,${0.12 * alpha})`)
    hg.addColorStop(1, 'rgba(170,215,240,0)')
    ctx.fillStyle = hg
    ctx.fill()
    ctx.strokeStyle = `rgba(0,212,255,${0.85 * alpha})`
    ctx.lineWidth = 1.3
    ctx.shadowColor = 'rgba(0,212,255,0.9)'
    ctx.shadowBlur = 10
    ctx.stroke()
    ctx.shadowBlur = 0

    ctx.beginPath()
    ctx.ellipse(0, headH * 0.16, headW * 0.78, headH * 0.95, 0, 0, TAU)
    const cg = ctx.createRadialGradient(0, headH * 0.2, headH * 0.05, 0, headH * 0.16, headW * 0.85)
    cg.addColorStop(0, `rgba(0,212,255,${0.1 * alpha})`)
    cg.addColorStop(1, 'rgba(0,212,255,0)')
    ctx.fillStyle = cg
    ctx.fill()

    const eyeDX = headW * 0.42
    const eyeY = -headH * 0.1
    const eyeW = headW * 0.26
    const eyeH = headH * 0.44
    const blink = blinkFactor(time)
    for (let s = -1; s <= 1; s += 2) {
      const ex = eyeDX * s
      const og = ctx.createRadialGradient(ex, eyeY, 0, ex, eyeY, eyeW * 1.9)
      og.addColorStop(0, `rgba(0,212,255,${0.5 * alpha * blink})`)
      og.addColorStop(1, 'rgba(0,212,255,0)')
      ctx.fillStyle = og
      ctx.beginPath()
      ctx.arc(ex, eyeY, eyeW * 1.9, 0, TAU)
      ctx.fill()

      if (happy) {
        ctx.strokeStyle = `rgba(210,245,255,${0.95 * alpha})`
        ctx.lineWidth = Math.max(2.2, eyeW * 0.3)
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.arc(ex, eyeY + eyeH * 0.18, eyeW * 0.8, Math.PI * 1.12, Math.PI * 1.88)
        ctx.stroke()
      } else {
        ctx.beginPath()
        ctx.ellipse(ex, eyeY, eyeW, Math.max(eyeH * blink, 1), 0, 0, TAU)
        ctx.fillStyle = `rgba(6,18,28,${0.9 * alpha})`
        ctx.fill()
        ctx.beginPath()
        ctx.ellipse(ex, eyeY, eyeW * 0.72, Math.max(eyeH * 0.7 * blink, 0.6), 0, 0, TAU)
        const ig = ctx.createRadialGradient(ex, eyeY, 0, ex, eyeY, eyeW)
        ig.addColorStop(0, `rgba(255,255,255,${0.95 * alpha})`)
        ig.addColorStop(0.4, `rgba(120,230,255,${0.9 * alpha})`)
        ig.addColorStop(1, `rgba(0,150,255,${0.25 * alpha})`)
        ctx.fillStyle = ig
        ctx.fill()
        ctx.fillStyle = `rgba(2,8,14,${0.9 * alpha})`
        ctx.beginPath()
        ctx.arc(ex, eyeY, eyeW * 0.26, 0, TAU)
        ctx.fill()
      }
    }

    const ny = headH * 0.16
    ctx.beginPath()
    ctx.moveTo(0, ny - headW * 0.1)
    ctx.quadraticCurveTo(headW * 0.07, ny + headW * 0.01, 0, ny + headW * 0.05)
    ctx.quadraticCurveTo(-headW * 0.07, ny + headW * 0.01, 0, ny - headW * 0.1)
    ctx.closePath()
    ctx.fillStyle = `rgba(0,212,255,${0.9 * alpha})`
    ctx.shadowColor = 'rgba(0,212,255,0.9)'
    ctx.shadowBlur = 6
    ctx.fill()
    ctx.shadowBlur = 0
    ctx.strokeStyle = `rgba(0,212,255,${0.4 * alpha})`
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, ny + headW * 0.05)
    ctx.lineTo(0, ny + headW * 0.13)
    ctx.stroke()

    const my = headH * 0.3
    ctx.save()
    if (speaking || listening) {
      const open = 0.05 + 0.09 * Math.abs(Math.sin(time * 9))
      ctx.fillStyle = `rgba(0,212,255,${0.6 * alpha})`
      ctx.beginPath()
      ctx.ellipse(0, my + headW * 0.02, headW * 0.09, headW * 0.05 + open, 0, 0, TAU)
      ctx.fill()
    } else {
      ctx.strokeStyle = `rgba(0,212,255,${0.6 * alpha})`
      ctx.lineWidth = 1.2
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.arc(0, my, headW * 0.11, Math.PI * 1.15, Math.PI * 1.85)
      ctx.stroke()
    }
    ctx.restore()

    ctx.strokeStyle = `rgba(0,212,255,${0.26 * alpha})`
    ctx.lineWidth = 1
    for (let s = -1; s <= 1; s += 2) {
      for (let k = 0; k < 3; k++) {
        const wy = ny + headW * 0.04 + k * headW * 0.06
        ctx.beginPath()
        ctx.moveTo(s * headW * 0.55, wy)
        ctx.quadraticCurveTo(s * headW, wy + headW * 0.02, s * headW * 1.22, wy - headW * 0.02)
        ctx.stroke()
      }
    }

    ctx.restore()
  }

  function drawScanline(time: number) {
    const sy = (time * 30) % H
    const g = ctx.createLinearGradient(0, sy - 2, 0, sy + 2)
    g.addColorStop(0, 'rgba(0,212,255,0)')
    g.addColorStop(0.5, 'rgba(0,212,255,0.03)')
    g.addColorStop(1, 'rgba(0,212,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, sy - 2, W, 4)
  }

  let time = 0

  function init() {
    spawn()
  }

  function draw(dt: number, o: RabbitSceneOpts) {
    time += dt
    const accent = exprFor(o.emotion ?? 'neutral')
    const boot = clamp(o.materialize ?? 0, 0, 1)
    const rings = clamp(o.rings ?? 0, 0, 1)
    const alpha = clamp(boot * 1.6, 0, 1)
    const thinking = o.state === 'THINKING'
    const listening = !!o.listening || o.state === 'LISTENING'

    drawBackdrop(time, accent, boot)
    drawRings(time, accent, rings, thinking)

    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    drawRabbit(
      time,
      {
        state: o.state,
        emotion: o.emotion,
        focusing: o.focusing,
        listening,
        speaking: o.speaking,
        materialize: boot,
      },
      alpha,
    )
    ctx.restore()

    drawScanline(time)
  }

  return { init, draw }
}