import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const root = new URL('../../void-hono-jsx/', import.meta.url)
const config = process.env.VOID_CONFIG ?? 'vite.config.ts'
const originals = new Map()
const edit = (name, from, to) => {
  const url = new URL(name, root)
  const src = readFileSync(url, 'utf8')
  if (!originals.has(name)) originals.set(name, src)
  if (!src.includes(from)) throw new Error(`not found in ${name}: ${from}`)
  writeFileSync(url, src.replace(from, to))
}
const restore = () => { originals.forEach((src, name) => writeFileSync(new URL(name, root), src)); originals.clear() }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const dev = spawn('pnpm', ['exec', 'vite', '--config', config, '--port', '5198', '--strictPort'], { cwd: root.pathname, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
let devLog = ''
dev.stdout.on('data', (d) => { devLog += d })
dev.stderr.on('data', (d) => { devLog += d })
const base = 'http://localhost:5198'
for (let i = 0; i < 120; i++) { try { await fetch(base + '/plain'); break } catch { await sleep(500) } }

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH })
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
let failed = 0
const check = (label, actual, expected) => {
  const ok = actual === expected
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `  actual=${actual} expected=${expected}`}`)
}
const hasText = (sel, value) => page.waitForFunction(([s, v]) => document.querySelector(s)?.textContent?.includes(v), [sel, value], { timeout: 8000 }).then(() => true, () => false)
const mark = () => page.evaluate(() => { window.__mark = 1 })
const marked = () => page.evaluate(() => window.__mark === 1)
const open = async (path, ready) => {
  restore(); await sleep(400)
  await page.goto(base + path, { waitUntil: 'networkidle' })
  await page.waitForSelector(ready)
  await sleep(300)
}

try {
  // The first load may reload once while deps are discovered.
  await page.goto(base + '/plain', { waitUntil: 'networkidle' }); await sleep(1500)

  console.log('# 通常ページの部品を変える（/plain）')
  await open('/plain', 'main button, button')
  const btn = 'button:has-text("clicked")'
  await page.click(btn); await page.click(btn); await page.click(btn)
  await mark()
  edit('pages/plain.tsx', 'clicked: {count}', 'CLICKED: {count}')
  check('反映された（state 3 のまま）', await hasText('body', 'CLICKED: 3'), true)
  check('ページは読み直していない', await marked(), true)
  await page.click('button:has-text("CLICKED")')
  check('差し替え後も動く', await hasText('body', 'CLICKED: 4'), true)

  console.log('# レイアウトを変える（ページの state は残るはず）')
  await open('/plain', btn)
  await page.click(btn); await page.click(btn)
  await mark()
  edit('pages/layout.tsx', 'Plain (regular page)', 'PLAIN (regular page)')
  check('反映された', await hasText('nav', 'PLAIN (regular page)'), true)
  check('ページは読み直していない', await marked(), true)
  check('ページの state は残る', await hasText('body', 'clicked: 2'), true)

  console.log('# SPA 遷移の後のページを変える（/plain → /hello）')
  await open('/plain', btn)
  await mark()
  await page.click('main a:has-text("Go to /hello"), a:has-text("Go to /hello")')
  await page.waitForSelector('#message')
  edit('pages/hello.tsx', 'Back to /plain', 'BACK to /plain')
  check('反映された', await hasText('body', 'BACK to /plain'), true)
  check('ページは読み直していない（SPA 遷移の前からの目印が残る）', await marked(), true)

  console.log('# 島の部品を変える（/counter）')
  await open('/counter', '[data-hydrated] button, [data-island] button')
  await page.waitForSelector('[data-hydrated] button')
  const island = '[data-island] button'
  await page.click(island); await page.click(island)
  await mark()
  const before = await page.textContent(island)
  edit('components/Counter.tsx', "?? 'count')}: {count}", "?? 'COUNT')}= {count}")
  check('反映された（state 12 のまま）', await hasText(island, 'COUNT= 12'), true)
  check('ページは読み直していない', await marked(), true)
  console.log(`info 変更前の表示: ${before}`)

  console.log('# 島のページ本体を変える（サーバーで描く部分）')
  await open('/counter', '[data-hydrated] button')
  edit('pages/counter.island.tsx', 'Counter page (tsx)', 'COUNTER page (tsx)')
  check('反映された（読み直しでよい）', await hasText('h1', 'COUNTER page'), true)

  console.log('# hook を増やす（読み直しになるはず）')
  await open('/plain', btn)
  await page.click(btn)
  await mark()
  edit('pages/plain.tsx', 'const [count, setCount] = useState(0)', 'const [extra] = useState(0)\n  const [count, setCount] = useState(0)')
  check('反映された（0 に戻る）', await hasText('body', 'clicked: 0'), true)
  check('ページを読み直した', await marked(), false)
} finally {
  restore()
  await browser.close()
  try { process.kill(-dev.pid) } catch {}
}
console.log(errors.length ? `console/page errors:\n  ${[...new Set(errors)].join('\n  ')}` : 'console/page errors: なし')
const warn = devLog.split('\n').filter((l) => /error|warn|failed/i.test(l)).slice(0, 10)
if (warn.length) console.log('dev server:\n  ' + warn.join('\n  '))
console.log(failed ? `失敗 ${failed} 件` : '全部通過')
process.exit(failed ? 1 : 0)
