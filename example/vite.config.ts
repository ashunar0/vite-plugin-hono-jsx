import { defineConfig } from 'vite'
import { honoJsxRefresh } from '../src/index'

export default defineConfig({
  oxc: { jsx: { runtime: 'automatic', importSource: 'hono/jsx/dom' } },
  plugins: [honoJsxRefresh()],
})
