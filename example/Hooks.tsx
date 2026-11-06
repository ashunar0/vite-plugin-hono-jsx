import { useCallback, useEffect, useMemo, useState } from 'hono/jsx/dom'
import { useCustom } from './useCustom'

export function Hooks() {
  const [count, setCount] = useState(0)
  const custom = useCustom()
  useEffect(() => {
    const w = window as any
    ;(w.__log ||= []).push('effect-v1')
    return () => w.__log.push('cleanup-v1')
  }, [])
  const memo = useMemo(() => 'memo-v1', [])
  const onClick = useCallback(() => setCount((n) => n + 1), [])
  return (
    <section>
      <button id="hooks" onClick={onClick}>hooks:{count}</button>
      <span id="memo">{memo}</span>
      <span id="custom">{custom}:0</span>
    </section>
  )
}
