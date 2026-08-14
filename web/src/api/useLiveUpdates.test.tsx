import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useLiveUpdates } from './useLiveUpdates'

// Minimal EventSource stand-in: jsdom does not implement one.
class FakeEventSource {
  static instances: FakeEventSource[] = []
  listeners = new Map<string, ((e: MessageEvent) => void)[]>()
  onerror: ((e: Event) => void) | null = null
  onopen: ((e: Event) => void) | null = null
  closed = false
  url: string

  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }
  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn])
  }
  close() { this.closed = true }

  emit(type: string, data: unknown) {
    const event = new MessageEvent(type, { data: JSON.stringify(data) })
    this.listeners.get(type)?.forEach(fn => fn(event))
  }
  fail() { this.onerror?.(new Event('error')) }
  open() { this.onopen?.(new Event('open')) }
}

beforeEach(() => {
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
})
afterEach(() => vi.unstubAllGlobals())

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('useLiveUpdates', () => {
  it('invalidates queries on refresh', async () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    renderHook(() => useLiveUpdates(), { wrapper: wrapper(qc) })

    act(() => {
      FakeEventSource.instances[0].emit('refresh', { change_token: '2', timestamp: 'x' })
    })
    expect(spy).toHaveBeenCalledTimes(1)
  })

  // td emits the same refresh twice per write. Two invalidations are harmless
  // but must not throw or double-count the connection state.
  it('tolerates a duplicate refresh for the same change token', async () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    renderHook(() => useLiveUpdates(), { wrapper: wrapper(qc) })

    act(() => {
      const es = FakeEventSource.instances[0]
      es.emit('refresh', { change_token: '2', timestamp: 'x' })
      es.emit('refresh', { change_token: '2', timestamp: 'x' })
    })
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('does not invalidate on ping', async () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    renderHook(() => useLiveUpdates(), { wrapper: wrapper(qc) })

    act(() => {
      FakeEventSource.instances[0].emit('ping', { change_token: '1' })
    })
    expect(spy).not.toHaveBeenCalled()
  })

  it('reports disconnection on error', async () => {
    const qc = new QueryClient()
    const { result } = renderHook(() => useLiveUpdates(), { wrapper: wrapper(qc) })

    act(() => { FakeEventSource.instances[0].open() })
    await waitFor(() => expect(result.current.connected).toBe(true))

    act(() => { FakeEventSource.instances[0].fail() })
    await waitFor(() => expect(result.current.connected).toBe(false))
  })
})
