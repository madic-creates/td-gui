import { Route, Routes } from 'react-router'
import IssueList from './features/issues/IssueList'
import IssueDetail from './features/issues/IssueDetail'
import IssueForm from './features/issues/IssueForm'
import AppShell from './components/AppShell'
import { useLiveUpdates } from './api/useLiveUpdates'

export default function App() {
  const { connected } = useLiveUpdates()
  return (
    <AppShell connected={connected}>
      <Routes>
        <Route path="/" element={<IssueList />} />
        <Route path="/new" element={<IssueForm />} />
        <Route path="/issues/:id" element={<IssueDetail />} />
      </Routes>
    </AppShell>
  )
}
