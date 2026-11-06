// exclude: the file is not swapped in place. Its importer takes the update, and it starts again.
import { readFileSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import honoJsx from '../src/index.ts'

const root = new URL('../example/', import.meta.url).pathname
const child = `${root}Child.tsx`
const src = readFileSync(child, 'utf8')
const server = await createServer({
  configFile: false,
  root,
  logLevel: 'error',
  server: { port: 5197, strictPort: true },
  plugins: [honoJsx({ exclude: [/\/node_modules\//, /Child\.tsx$/] })],
})
await server.listen()
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH })
let failed = 0
try {
  const page = await browser.newPage()
  await page.goto('http://localhost:5197/')
  await page.waitForSelector('#child')
  await page.click('#child')
  await page.click('#app')
  await page.evaluate(() => { window.__mark = 1 })
  writeFileSync(child, src.replace('child-v1', 'child-v2'))
  await page.waitForFunction(() => document.getElementById('child')?.textContent?.startsWith('child-v2'), null, { timeout: 5000 })
  const child2 = await page.textContent('#child')
  const app = await page.textContent('#app')
  const kept = await page.evaluate(() => window.__mark === 1)
  console.log(`child=${child2} app=${app} 読み直しなし=${kept}`)
  if (child2 !== 'child-v2:0' || app !== 'app:1' || !kept) failed = 1
} finally {
  writeFileSync(child, src)
  await browser.close()
  await server.close()
}
console.log(failed ? '失敗' : '通過')
process.exit(failed)
