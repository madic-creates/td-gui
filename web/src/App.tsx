import { Route, Routes } from 'react-router'
import IssueList from './features/issues/IssueList'
import IssueDetail from './features/issues/IssueDetail'
import IssueForm from './features/issues/IssueForm'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<IssueList />} />
      <Route path="/new" element={<IssueForm />} />
      <Route path="/issues/:id" element={<IssueDetail />} />
    </Routes>
  )
}
