import { lazy } from 'react'
import TabbedPage from '../components/layout/TabbedPage'

const DiaryPage = lazy(() => import('./DiaryPage'))
const ReadingPage = lazy(() => import('./ReadingPage'))
const LettersPage = lazy(() => import('./LettersPage'))

// 手记：你写的日记和读书笔记，还有她每周写给你的信——文字往来都在这一处。
const TABS = [
  { id: 'diary', label: '日记', render: () => <DiaryPage embedded /> },
  { id: 'reading', label: '读书', render: () => <ReadingPage embedded /> },
  { id: 'letters', label: '来信', render: () => <LettersPage embedded /> },
]

export default function NotesPage() {
  return <TabbedPage title="手记" label="手记分类" tabs={TABS} />
}
