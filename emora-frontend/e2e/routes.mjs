import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const URL = 'http://localhost:5173'
const TOKEN = process.env.EMORA_TOKEN
if (!TOKEN) {
  console.error('Set EMORA_TOKEN first, e.g.\n  EMORA_TOKEN=$(venv/bin/python -c "from backend.app.services.jwt_service import create_token; print(create_token(1))") node e2e/routes.mjs')
  process.exit(2)
}
const USER = JSON.stringify({ user_id: 1, name: 'Akash' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (name, pass, extra='') => {
  results.push({ name, pass, extra })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`)
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  // SwiftShader gives the R3F canvas a real WebGL context in headless.
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1280, height: 800 },
})
const page = await browser.newPage()
const errors = []
page.on('pageerror', e => errors.push(String(e)))
page.on('console', m => { if (m.type()==='error') errors.push(m.text()) })

// Set auth before navigation
await page.goto(`${URL}/login`, { waitUntil: 'domcontentloaded' })
await page.evaluate((t, u) => {
  localStorage.setItem('emora_token', t)
  localStorage.setItem('emora_user', u)
}, TOKEN, USER)

const routes = [
  { path: '/chat', expect: 'E.M.O.R.A.' },
  // Retired pages redirect to chat.
  { path: '/dashboard', expect: 'E.M.O.R.A.' },
  { path: '/jarvis', expect: 'E.M.O.R.A.' },
  { path: '/mood', expect: 'MOOD' },
  { path: '/analytics', expect: 'ANALYTICS' },
  { path: '/reminders', expect: 'REMINDERS' },
  { path: '/profile', expect: 'Akash' },
  { path: '/settings', expect: 'SETTINGS' },
]

for (const r of routes) {
  await page.goto(`${URL}${r.path}`, { waitUntil: 'domcontentloaded' })
  await sleep(1200)
  const url = page.url()
  const body = await page.evaluate(() => document.body.innerText.slice(0, 4000))
  const ok = !url.includes('/login') && body.includes(r.expect)
  check(`route ${r.path} renders`, ok, ok ? '' : `url=${url} body_has=${body.includes(r.expect)} snippet=${body.slice(0,120).replace(/\n/g,' ')}`)
}

// Also verify unauthenticated redirect for one route
await page.evaluate(() => { localStorage.clear() })
await page.goto(`${URL}/chat`, { waitUntil: 'domcontentloaded' })
await sleep(800)
check('unauth /chat redirects to /login', page.url().includes('/login'), page.url())

check('no page errors', errors.length===0, JSON.stringify(errors.slice(0,3)))

await browser.close()
const failed = results.filter(r=>!r.pass).length
console.log(`\n${results.length-failed}/${results.length} checks passed`)
process.exit(failed?1:0)