import { useState } from 'hono/jsx/dom'
import Arrow from './Arrow'
import { Child } from './Child'
import { Hooks } from './Hooks'
import { helperLabel } from './helper'

export function App() {
  const [count, setCount] = useState(0)
  return (
    <main>
      <button id="app" onClick={() => setCount((n) => n + 1)}>app:{count}</button>
      <input id="text" />
      <span id="helper">{helperLabel}</span>
      <Child />
      <Arrow />
      <Hooks />
    </main>
  )
}
