import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

/**
 * Subscribes to td's SSE stream and invalidates the query cache on change.
 *
 * The stream is deliberately coarse: td sends only `refresh` with a global
 * change_token, never deltas. Invalidating everything is the whole strategy —
 * against a local API it is cheap and it removes any need for delta logic.
 *
 * The browser's EventSource reconnects on its own and replays Last-Event-ID,
 * which is exactly the contract td's spec describes.
 */
export function useLiveUpdates(): { connected: boolean } {
  const queryClient = useQueryClient()
  const [connected, setConnected] = useState(false)
  const lastToken = useRef<string | null>(null)

  useEffect(() => {
    const source = new EventSource('/v1/events')

    source.onopen = () => setConnected(true)
    source.onerror = () => setConnected(false)

    source.addEventListener('refresh', (event: MessageEvent) => {
      setConnected(true)
      // A single write produces this event twice — once broadcast after the
      // write, once from the poll cycle. Skipping the repeat avoids a
      // pointless second refetch of every visible query.
      let token: string | null = null
      try {
        token = (JSON.parse(event.data) as { change_token?: string }).change_token ?? null
      } catch {
        token = null
      }
      if (token !== null && token === lastToken.current) return
      lastToken.current = token
      void queryClient.invalidateQueries()
    })

    // Pings only prove the connection is alive; refetching on them would
    // reload everything twice a minute for nothing.
    source.addEventListener('ping', () => setConnected(true))

    return () => source.close()
  }, [queryClient])

  return { connected }
}
