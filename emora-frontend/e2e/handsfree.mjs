/**
 * Hands-free regression test.
 *
 * Two paths, both of which were broken:
 *   A. No browser transcript (offline Chrome, or VAD endpointing before Chrome
 *      finalises) — the recorded audio must still reach /api/stt.
 *   B. A transcript arrives — it must reach /api/chat.
 *
 * The microphone is synthesised inside the page rather than via Chrome's
 * fake-device flags. Chrome's built-in beep is not speech-shaped, so VAD can
 * never sustain an onset on it, and --use-file-for-fake-audio-capture stops
 * looping once a MediaRecorder attaches — which let the fixture, not the code,
 * decide whether a turn completed. A looping Web Audio buffer is deterministic
 * and needs no external file.
 *
 * A stub SpeechRecognition stands in for the speech service headless Chrome
 * does not have.
 */
import puppeteer from 'puppeteer-core'

const URL = 'http://localhost:5173'
const TOKEN = process.env.EMORA_TOKEN
if (!TOKEN) {
  console.error('Set EMORA_TOKEN')
  process.exit(2)
}

const results = []
const check = (name, pass, extra = '') => {
  results.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`)
}

async function run({ withTranscript }) {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: [
      '--no-sandbox',
      '--use-gl=swiftshader',
      '--enable-unsafe-swiftshader',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
    defaultViewport: { width: 1400, height: 900 },
  })
  const page = await browser.newPage()
  const calls = []
  page.on('request', (r) => {
    if (r.url().includes('/api/')) calls.push(r.url().split('/api/')[1].split('?')[0])
  })

  await page.evaluateOnNewDocument((emit) => {
    // Synthetic microphone: 1.2s of speech-shaped noise, then 1.8s of silence,
    // looping forever. Gives VAD a clean onset and a clean endpoint every cycle.
    const realGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (!constraints?.audio || constraints.video) return realGUM(constraints)
      const ctx = new AudioContext()
      await ctx.resume()
      const sr = ctx.sampleRate
      const buf = ctx.createBuffer(1, Math.floor(sr * 3), sr)
      const data = buf.getChannelData(0)
      const burst = Math.floor(sr * 1.2)
      for (let i = 0; i < burst; i++) {
        const env = 0.55 + 0.45 * Math.sin((2 * Math.PI * 4 * i) / sr)
        data[i] = (Math.random() * 2 - 1) * 0.35 * env
      }
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.loop = true
      const dest = ctx.createMediaStreamDestination()
      src.connect(dest)
      src.start()
      window.__micCtx = ctx // hold a reference so it is not collected
      return dest.stream
    }
    class StubSR {
      continuous = false
      interimResults = false
      lang = 'en-US'
      onresult = null
      onend = null
      onerror = null
      start() {
        if (!emit) return
        // Deliver a final result shortly after the mic opens.
        setTimeout(() => {
          this.onresult?.({
            resultIndex: 0,
            results: [{ isFinal: true, 0: { transcript: 'what is two plus two' } }],
          })
        }, 1200)
      }
      stop() {
        this.onend?.()
      }
      abort() {}
    }
    window.SpeechRecognition = StubSR
    window.webkitSpeechRecognition = StubSR
  }, withTranscript)

  await page.goto(`${URL}/login`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(
    (t, u) => {
      localStorage.setItem('emora_token', t)
      localStorage.setItem('emora_user', u)
    },
    TOKEN,
    JSON.stringify({ user_id: 1, name: 'Akash' }),
  )
  await page.goto(`${URL}/chat`, { waitUntil: 'domcontentloaded' })
  await new Promise((r) => setTimeout(r, 3000))

  // Wait for the control to exist AND be enabled, then assert the toggle
  // actually flipped — `?.click()` on a not-yet-mounted button silently no-ops,
  // which previously looked like a product failure.
  await page.waitForFunction(
    () => {
      const b = [...document.querySelectorAll('button')].find((x) =>
        /hands-free/i.test(x.textContent || ''),
      )
      return Boolean(b) && !b.disabled && !document.querySelector('.chat-warming')
    },
    { timeout: 180000 },
  )
  const clicked = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) =>
      /hands-free/i.test(x.textContent || ''),
    )
    if (!b || b.disabled) return false
    b.click()
    return true
  })
  if (!clicked) throw new Error('could not click the hands-free toggle')
  await page.waitForFunction(
    () =>
      /hands-free\s*·/i.test(
        [...document.querySelectorAll('button')].find((x) =>
          /hands-free/i.test(x.textContent || ''),
        )?.textContent || '',
      ),
    { timeout: 10000 },
  )

  // Wait for the expected call rather than a fixed duration: a turn takes
  // ~9s locally but the chat leg hits a real provider, so a wall-clock window
  // makes this test flaky on provider latency rather than on our own logic.
  const want = withTranscript ? 'chat' : 'stt'
  const deadline = Date.now() + Number(process.env.HF_TIMEOUT ?? 90000)
  while (Date.now() < deadline && !calls.includes(want)) {
    await new Promise((r) => setTimeout(r, 500))
  }
  // Let the rest of the turn land so the follow-up assertions are meaningful.
  await new Promise((r) => setTimeout(r, 6000))

  const label = await page.evaluate(
    () =>
      [...document.querySelectorAll('button')]
        .find((b) => /hands-free/i.test(b.textContent || ''))
        ?.textContent?.trim(),
  )
  await browser.close()
  return { calls, label }
}

// --- A: no transcript, audio must still reach the server --------------------
const a = await run({ withTranscript: false })
console.log(`\n[no transcript] state=${a.label}  api=${JSON.stringify(a.calls)}`)
check('turn endpoints without a browser transcript', a.calls.includes('stt'), 'expected /api/stt')
check('mic did not hang in one window', !/LISTENING/.test(a.label ?? ''), a.label)

// --- B: transcript present, must reach chat ---------------------------------
const b = await run({ withTranscript: true })
console.log(`\n[with transcript] state=${b.label}  api=${JSON.stringify(b.calls)}`)
check('transcript reaches /api/chat', b.calls.includes('chat'), 'expected /api/chat')
check('emotion analysed for the turn', b.calls.some((c) => c.startsWith('emotion')))

const failed = results.filter((r) => !r.pass).length
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed ? 1 : 0)
