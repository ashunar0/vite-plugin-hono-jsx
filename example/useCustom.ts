import { useEffect, useState } from 'hono/jsx/dom'

export function useCustom() {
  const [value, setValue] = useState('')
  useEffect(() => {
    setValue('custom-v1')
  }, [])
  return value
}
