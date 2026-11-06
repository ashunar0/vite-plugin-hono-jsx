import { readFileSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const root = process.env.E2E_ROOT ? `${process.env.E2E_ROOT}/` : new URL('../example/', import.meta.url).pathname
const file = (name) => `${root}${name}`
const originals = new Map()
const edit = (name, from, to) => {
  const src = readFileSync(file(name), 'utf8')
  if (!originals.has(name)) originals.set(name, src)
  if (!src.includes(from)) throw new Error(`not found in ${name}: ${from}`)
  writeFileSync(file(name), src.replace(from, to))
}
const restore = () => originals.forEach((src, name) => writeFileSync(file(name), src))

const server = await createServer({ root, logLevel: 'error', server: { port: 5199, strictPort: true } })
await server.listen()
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH })
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
let failed = 0
const check = (label, actual, expected) => {
  const ok = actual === expected
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `  actual=${actual} expected=${expected}`}`)
}
const text = (id) => page.textContent(`#${id}`)
const waitText = (id, value) => page.waitForFunction(([i, v]) => document.getElementById(i)?.textContent === v, [id, value], { timeout: 5000 }).then(() => true, () => false)
const mark = () => page.evaluate(() => { window.__mark = 1 })
const marked = () => page.evaluate(() => window.__mark === 1)

const fresh = async () => {
  restore(); originals.clear()
  await new Promise((r) => setTimeout(r, 200))
  await page.goto('http://localhost:5199/')
  await page.waitForSelector('#child')
  await page.click('#app'); await page.click('#app')
  await page.click('#child'); await page.click('#child'); await page.click('#child')
  await page.click('#arrow')
  await page.fill('#text', 'typing')
  await mark()
}

try {
  await fresh()
  console.log('# 関数宣言の部品の文言を変える')
  edit('Child.tsx', 'child-v1', 'child-v2')
  check('反映された', await waitText('child', 'child-v2:3'), true)
  check('ページは読み直していない', await marked(), true)
  check('親の state は残る', await text('app'), 'app:2')
  check('隣の部品の state は残る', await text('arrow'), 'arrow-v1:1')
  check('入力中の値は残る', await page.inputValue('#text'), 'typing')
  await page.click('#child')
  check('差し替えた後も state が動く', await text('child'), 'child-v2:4')

  await fresh()
  console.log('# const＋export default の部品')
  edit('Arrow.tsx', 'arrow-v1', 'arrow-v2')
  check('反映された', await waitText('arrow', 'arrow-v2:1'), true)
  check('ページは読み直していない', await marked(), true)

  await fresh()
  console.log('# 親の部品を変える')
  edit('App.tsx', 'app:{count}', 'APP:{count}')
  check('反映された', await waitText('app', 'APP:2'), true)
  check('ページは読み直していない', await marked(), true)
  check('子の state は残る', await text('child'), 'child-v1:3')

  await fresh()
  console.log('# hook を増やす（読み直しになるはず）')
  edit('Child.tsx', "const [count, setCount] = useState(0)", "const [extra] = useState(0)\n  const [count, setCount] = useState(0)")
  check('反映された（state は 0 に戻る）', await waitText('child', 'child-v1:0'), true)
  check('ページを読み直した', await marked(), false)

  await fresh()
  console.log('# 部品でない export のファイルを変える（import 元が読み込み直される）')
  edit('helper.ts', 'helper-v1', 'helper-v2')
  check('反映された', await waitText('helper', 'helper-v2'), true)
  console.log(`info 読み直し: ${!(await marked())} / app=${await text('app')}`)

  await fresh()
  console.log('# effect の中身を変える')
  const log = () => page.evaluate(() => window.__log.join(' '))
  check('変更前', await log(), 'effect-v1')
  edit('Hooks.tsx', 'effect-v1', 'effect-v2')
  check('新しい effect が動く', await page.waitForFunction(() => window.__log.includes('effect-v2'), null, { timeout: 5000 }).then(() => true, () => false), true)
  check('古い cleanup が先に 1 回、新しい effect が 1 回', await log(), 'effect-v1 cleanup-v1 effect-v2')
  check('ページは読み直していない', await marked(), true)
  await page.click('#hooks')
  check('編集がなければ effect は動かない（押しても増えない）', await log(), 'effect-v1 cleanup-v1 effect-v2')

  await fresh()
  console.log('# useMemo と useCallback の中身を変える')
  check('変更前の memo', await text('memo'), 'memo-v1')
  await page.click('#hooks')
  check('変更前の callback', await text('hooks'), 'hooks:1')
  edit('Hooks.tsx', 'memo-v1', 'memo-v2')
  edit('Hooks.tsx', 'n + 1', 'n + 10')
  check('memo が新しくなる', await waitText('memo', 'memo-v2'), true)
  await new Promise((r) => setTimeout(r, 300))
  await page.click('#hooks')
  check('callback が新しくなる、state は残る', await text('hooks'), 'hooks:11')
  check('ページは読み直していない', await marked(), true)

  await fresh()
  console.log('# 別ファイルのカスタム hook の中身を変える')
  check('変更前', await text('custom'), 'custom-v1:0')
  edit('useCustom.ts', 'custom-v1', 'custom-v2')
  check('effect が動き直して反映', await waitText('custom', 'custom-v2:0'), true)
  check('ページは読み直していない', await marked(), true)
  check('子の state は残る', await text('child'), 'child-v1:3')

  for (const [title, name, from, to] of [
    ['別ファイルのカスタム hook', 'useCustom.ts', "const [value, setValue] = useState('')", "const [extra] = useState('extra')\n  ;(window as any).__extra = extra\n  const [value, setValue] = useState('')"],
    ['同じファイルのカスタム hook', 'Hooks.tsx', "const [value] = useState('local-v1')", "const [extra] = useState('extra')\n  ;(window as any).__extra = extra\n  const [value] = useState('local-v1')"],
  ]) {
    await fresh()
    await page.click('#hooks'); await page.click('#hooks')
    console.log(`# ${title}に hook を増やす（読み直しになるはず）`)
    edit(name, from, to)
    await new Promise((r) => setTimeout(r, 1500))
    console.log(`info hooks=${await text('hooks')} memo=${await text('memo')} local=${await text('local')} custom=${await text('custom')}`)
    check('ページを読み直した', await marked(), false)
    check('足した hook が自分の初期値を受け取る', await page.evaluate(() => window.__extra), 'extra')
    check('読み直したので state は初期値', await text('hooks'), 'hooks:0')
  }

} finally {
  restore()
  await browser.close()
  await server.close()
}
console.log(errors.length ? `page errors: ${errors.join(' | ')}` : 'page errors: なし')
console.log(failed ? `失敗 ${failed} 件` : '全部通過')
process.exit(failed ? 1 : 0)
