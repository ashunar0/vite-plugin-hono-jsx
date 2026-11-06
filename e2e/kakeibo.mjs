// Runs ../../hono-trials/kakeibo with a config of its own, so that its database is under PERSIST_PATH.
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const root = new URL('../../hono-trials/kakeibo/', import.meta.url)
const persist = process.env.PERSIST_PATH
if (!persist) throw new Error('PERSIST_PATH is required')
rmSync(persist, { recursive: true, force: true })
execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'migrations', 'apply', 'kakeibo', '--local', '--persist-to', persist], { cwd: root.pathname, stdio: 'ignore', env: { ...process.env, CI: '1' } })

const CONFIG = 'vite.e2e.config.ts'
writeFileSync(new URL(CONFIG, root), `
import { cloudflare } from "@cloudflare/vite-plugin";
import honoJsx from "vite-plugin-hono-jsx";
import { honoKit } from "hono-kit/vite";
import { honoKitUi } from "hono-kit-ui/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    honoKit(),
    ...honoKitUi(),
    ...(process.env.NO_REFRESH ? [] : [honoJsx()]),
    cloudflare({ persistState: { path: process.env.PERSIST_PATH! } }),
  ],
});
`)

const originals = new Map()
const edit = (name, from, to) => {
  const url = new URL(name, root)
  const src = readFileSync(url, 'utf8')
  if (!originals.has(name)) originals.set(name, src)
  if (!src.includes(from)) throw new Error(`not found in ${name}: ${from}`)
  writeFileSync(url, src.replace(from, to))
}
const restore = () => {
  originals.forEach((src, name) => (src === null ? rmSync(new URL(name, root), { force: true }) : writeFileSync(new URL(name, root), src)))
  originals.clear()
}
const create = (name, src) => {
  if (existsSync(new URL(name, root))) throw new Error(`already exists: ${name}`)
  originals.set(name, null)
  writeFileSync(new URL(name, root), src)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const dev = spawn('pnpm', ['exec', 'vite', '--config', CONFIG, '--port', '5173', '--strictPort'], { cwd: root.pathname, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
let devLog = ''
dev.stdout.on('data', (d) => { devLog += d })
dev.stderr.on('data', (d) => { devLog += d })
const base = 'http://localhost:5173'
for (let i = 0; i < 120; i++) { try { await fetch(base + '/login'); break } catch { await sleep(500) } }

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
const hasText = (sel, value, timeout = 8000) => page.waitForFunction(([s, v]) => document.querySelector(s)?.textContent?.includes(v), [sel, value], { timeout }).then(() => true, () => false)
const mark = () => page.evaluate(() => { window.__mark = 1 })
const marked = () => page.evaluate(() => window.__mark === 1)
const LOGIN = '[data-island="components/screens/login-form"]'
const FORM = '[data-island="components/screens/expense-form"]'
const EDITOR = '[data-island="components/screens/expense-editor"]'

try {
  await page.goto(base + '/login', { waitUntil: 'networkidle' }); await sleep(1500)
  await page.goto(base + '/login', { waitUntil: 'networkidle' })
  await page.waitForSelector(`${LOGIN}[data-started] button`)

  console.log('# ログインの島の文言を変える（入力中の文字）')
  await page.fill(`${LOGIN} input[type=email]`, 'typing@example.com')
  await mark()
  edit('src/components/screens/login-form.island.tsx', '<button type="submit">ログイン</button>', '<button type="submit">ログインする</button>')
  check('反映された', await hasText(`${LOGIN} button`, 'ログインする'), true)
  check('ページは読み直していない', await marked(), true)
  check('入力中の文字は残る', await page.inputValue(`${LOGIN} input[type=email]`), 'typing@example.com')
  restore(); await sleep(800)

  const signUp = await page.evaluate(() => fetch('/api/auth/sign-up/email', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'E2E', email: 'e2e@example.com', password: 'password-e2e-1234' }) }).then(async (r) => `${r.status} ${r.status === 200 ? '' : await r.text()}`.trim()))
  check('テスト用のアカウントを作れた', signUp, '200')
  await page.goto(base + '/expenses', { waitUntil: 'networkidle' })
  await page.waitForSelector(`${FORM}[data-started] button`)
  await page.fill(`${FORM} input[type=number]`, '1200')
  await page.click(`${FORM} button[type=submit]`)
  await page.waitForSelector(`${EDITOR}[data-started] button`)
  await sleep(500)

  console.log('# ダイアログの島の文言を変える（開いたまま、入力中）')
  await page.click(`${EDITOR} > button`)
  await page.fill(`${EDITOR} dialog input[type=text]`, 'hmr-memo')
  await mark()
  edit('src/components/screens/expense-editor.island.tsx', '<button type="submit">保存</button>', '<button type="submit">保存する</button>')
  check('反映された', await hasText(`${EDITOR} dialog`, '保存する'), true)
  check('ページは読み直していない', await marked(), true)
  check('ダイアログは開いたまま', await page.evaluate((s) => document.querySelector(s).open, `${EDITOR} dialog`), true)
  check('入力中の文字は残る', await page.inputValue(`${EDITOR} dialog input[type=text]`).catch(() => 'なし'), 'hmr-memo')

  console.log('# 差し替えの後に保存する（refreshPage まで）')
  await page.click(`${EDITOR} dialog button[type=submit]`)
  check('一覧に反映された', await hasText('body', 'hmr-memo'), true)
  check('ダイアログが閉じた', await page.evaluate((s) => document.querySelector(s).open, `${EDITOR} dialog`), false)
  check('ページは読み直していない', await marked(), true)
  restore(); await sleep(800)

  const openExpenses = async () => {
    restore(); await sleep(800)
    await page.goto(base + '/expenses', { waitUntil: 'networkidle' })
    await page.waitForSelector(`${FORM}[data-started] button`)
    await page.fill(`${FORM} input[type=number]`, '999')
    await mark()
  }

  console.log('# サーバーで描く部分を変える（レイアウト）')
  await openExpenses()
  edit('src/components/layout.tsx', '<Link href="/expenses">支出</Link>', '<Link href="/expenses">支出一覧</Link>')
  check('自動で反映された', await hasText('body', '支出一覧'), true)
  check('ページを読み直した', await marked(), false)

  console.log('# サーバーの画面を変える（screens/expenses.tsx）')
  await openExpenses()
  edit('src/components/screens/expenses.tsx', '<h1>', '<h1 data-edited="1">')
  check('自動で反映された', await page.waitForSelector('h1[data-edited="1"]', { timeout: 8000 }).then(() => true, () => false), true)
  check('ページを読み直した', await marked(), false)

  console.log('# サーバーと島の両方で使うファイルを変える（lib/format）')
  await openExpenses()
  edit('src/lib/format.ts', '¥', '円:')
  check('自動で反映された', await hasText('body', '円:'), true)
  check('ページを読み直した', await marked(), false)

  if (!process.env.NO_REFRESH) {
    console.log('# 島でしか使わない部品を変える（読み直さないはず）')
    await openExpenses()
    create('src/components/screens/only-island.tsx', 'export const OnlyIsland = () => <small id="only">only-v1</small>;\n')
    edit('src/components/screens/expense-form.island.tsx', 'import { categories }', 'import { OnlyIsland } from "./only-island";\nimport { categories }')
    edit('src/components/screens/expense-form.island.tsx', '<button type="submit">登録</button>', '<button type="submit">登録</button><OnlyIsland />')
    check('島に出た', await page.waitForSelector('#only', { timeout: 8000 }).then(() => true, () => false), true)
    await sleep(500)
    await page.goto(base + '/expenses', { waitUntil: 'networkidle' })
    await page.waitForSelector(`${FORM}[data-started] #only`)
    await page.fill(`${FORM} input[type=number]`, '999')
    await mark()
    edit('src/components/screens/only-island.tsx', 'only-v1', 'only-v2')
    check('反映された', await hasText('#only', 'only-v2'), true)
    check('ページは読み直していない', await marked(), true)
    check('入力中の文字は残る', await page.inputValue(`${FORM} input[type=number]`), '999')
  } else {
    console.log('# 島の編集（プラグインなしは読み直しで反映されるはず）')
    await openExpenses()
    edit('src/components/screens/expense-form.island.tsx', '<button type="submit">登録</button>', '<button type="submit">登録する</button>')
    check('自動で反映された', await hasText(FORM, '登録する'), true)
    check('ページを読み直した', await marked(), false)
  }
} finally {
  restore()
  await browser.close()
  try { process.kill(-dev.pid) } catch {}
  rmSync(new URL(CONFIG, root), { force: true })
}
console.log(errors.length ? `console/page errors:\n  ${[...new Set(errors)].join('\n  ')}` : 'console/page errors: なし')
console.log(failed ? `失敗 ${failed} 件` : '全部通過')
if (process.env.SHOW_LOG) console.log(devLog.split('\n').filter((l) => /error|warn|failed/i.test(l)).slice(0, 10).join('\n'))
process.exit(failed ? 1 : 0)
