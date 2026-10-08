/**
 * E2E for the rebuilt login conversation and the Settings provider manager.
 *
 * Run the backend on :8000 and `npm run dev` first, then: node e2e/flows.mjs
 */
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const URL = 'http://localhost:5173'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (name, pass, extra = '') => {
  results.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`)
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  // SwiftShader gives the R3F canvas a real WebGL context in headless.
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
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})

// --- login conversation -----------------------------------------------------
await page.goto(`${URL}/login`, { waitUntil: 'domcontentloaded' })
await page.evaluate(() => localStorage.clear())
await page.goto(`${URL}/login`, { waitUntil: 'domcontentloaded' })

// Boot (~1.9s) then the greeting types out.
await sleep(4500)
let body = await page.evaluate(() => document.body.innerText)
check('login greets by name request', /what should i call you/i.test(body), body.slice(0, 90).replace(/\n/g, ' '))

// The camera element must exist but never be visible during login.
const camState = await page.evaluate(() => {
  const v = document.querySelector('video.login-hidden-cam')
  if (!v) return { present: false }
  const r = v.getBoundingClientRect()
  const s = getComputedStyle(v)
  return { present: true, w: r.width, h: r.height, opacity: s.opacity }
})
check(
  'camera present but not displayed',
  camState.present && Number(camState.opacity) === 0 && camState.w <= 2,
  JSON.stringify(camState),
)
check('no visible webcam preview on login', !(await page.$('.chat-cam-video')))

// Type a known name and continue.
await page.waitForSelector('.login-input', { timeout: 8000 })
await page.type('.login-input', 'Akash')
await page.click('.login-go')
await sleep(2500)
body = await page.evaluate(() => document.body.innerText)
const reachedScan = /verifying|identity|hold still|learning/i.test(body)
check('known name advances to silent scan', reachedScan, body.slice(0, 130).replace(/\n/g, ' '))
check('scan UI shown instead of camera feed', Boolean(await page.$('.scan-wrap')))

// Unknown name should offer inline enrollment rather than a Register page.
await page.goto(`${URL}/login`, { waitUntil: 'domcontentloaded' })
await sleep(4500)
await page.waitForSelector('.login-input', { timeout: 8000 })
await page.type('.login-input', 'Zzq Nobody')
await page.click('.login-go')
await sleep(2500)
body = await page.evaluate(() => document.body.innerText)
check(
  'unknown name offers inline enrollment',
  /we've met|learn my face|learn your face/i.test(body),
  body.slice(0, 130).replace(/\n/g, ' '),
)

// /register must fold back into the single login flow.
await page.goto(`${URL}/register`, { waitUntil: 'domcontentloaded' })
await sleep(900)
check('/register redirects into login flow', page.url().includes('/login'), page.url())

// --- settings ---------------------------------------------------------------
const TOKEN = process.env.EMORA_TOKEN
if (!TOKEN) {
  console.log('\nSet EMORA_TOKEN to also exercise Settings.')
} else {
  await page.evaluate(
    (t, u) => {
      localStorage.setItem('emora_token', t)
      localStorage.setItem('emora_user', u)
    },
    TOKEN,
    JSON.stringify({ user_id: 1, name: 'Akash' }),
  )
  await page.goto(`${URL}/settings`, { waitUntil: 'domcontentloaded' })
  await sleep(2200)
  body = await page.evaluate(() => document.body.innerText)
  const cards = await page.$$eval('.set-provider', (els) => els.length)
  check('settings lists all 5 providers', cards === 5, `found ${cards}`)
  for (const label of ['OpenAI', 'Claude', 'Groq', 'Grok', 'Nemotron']) {
    check(`provider "${label}" offered`, body.includes(label))
  }
  const masked = await page.$$eval('.set-field input[type="password"]', (els) => els.length)
  check('api keys entered as password fields', masked === 5, `found ${masked}`)
}

check('no page errors', errors.length === 0, JSON.stringify(errors.slice(0, 3)))

await browser.close()
const failed = results.filter((r) => !r.pass).length
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed ? 1 : 0)
