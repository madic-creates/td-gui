import { Route, Routes } from 'react-router'
import IssueList from './features/issues/IssueList'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<IssueList />} />
    </Routes>
  )
}
