import { Route, Routes, useLocation } from 'react-router'
import IssueList from './features/issues/IssueList'
import IssueDetail from './features/issues/IssueDetail'
import IssueForm from './features/issues/IssueForm'
import BoardList from './features/boards/BoardList'
import BoardForm from './features/boards/BoardForm'
import AppShell from './components/AppShell'
import NotFound from './components/NotFound'
import ErrorBoundary from './components/ErrorBoundary'
import { useLiveUpdates } from './api/useLiveUpdates'

export default function App() {
  const { connected } = useLiveUpdates()
  const { pathname } = useLocation()
  return (
    <AppShell connected={connected}>
      {/* Keyed by pathname so navigating away from a page that crashed
          during render recovers the boundary instead of staying tripped. */}
      <ErrorBoundary key={pathname}>
        <Routes>
          <Route path="/" element={<IssueList />} />
          <Route path="/new" element={<IssueForm />} />
          <Route path="/issues/:id" element={<IssueDetail />} />
          <Route path="/boards" element={<BoardList />} />
          <Route path="/boards/new" element={<BoardForm />} />
          <Route path="/boards/:id/edit" element={<BoardForm />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </ErrorBoundary>
    </AppShell>
  )
}
