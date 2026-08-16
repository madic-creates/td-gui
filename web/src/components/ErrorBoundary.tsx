import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Catches render-time exceptions from the routed content so a single
 * malformed issue (e.g. an API response that violates its assumed shape)
 * can't blank the whole app. Query-level errors already surface through
 * ErrorPanel; this is the fallback for exceptions React itself throws
 * while rendering. App.tsx remounts this per-route (`key={pathname}`) so
 * navigating away from the broken page recovers without a full reload.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled render error', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="p-4">
        <p className="mb-1.5 text-[11px] uppercase tracking-widest text-danger">Something went wrong</p>
        <div role="alert" className="rounded-md border border-danger/40 bg-danger/5 px-3.5 py-3">
          <p className="text-danger">{error.message}</p>
        </div>
        <a href="/" className="mt-3 inline-block text-[11px] text-ink-muted underline">
          back to list
        </a>
      </div>
    )
  }
}
