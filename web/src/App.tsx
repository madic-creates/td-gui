import { Route, Routes } from 'react-router'
import IssueList from './features/issues/IssueList'
import IssueDetail from './features/issues/IssueDetail'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<IssueList />} />
      <Route path="/issues/:id" element={<IssueDetail />} />
    </Routes>
  )
}
