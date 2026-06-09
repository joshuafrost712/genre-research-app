import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { Layout } from './components/Layout'
import { DepthModeProvider } from './components/DepthModeContext'
import { ActiveContextProvider } from './components/ActiveContextProvider'
import { Dashboard } from './pages/Dashboard'
import { WorksheetView } from './pages/WorksheetView'
import { Wizard } from './pages/Wizard'
import { Priorities } from './pages/Priorities'
import { Capture } from './pages/Capture'
import { GenreBank } from './pages/GenreBank'
import { ExportView } from './pages/ExportView'
import { Routing } from './pages/Routing'
import { Review } from './pages/Review'

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'worksheet/:nodeId', element: <WorksheetView /> },
      { path: 'wizard', element: <Wizard /> },
      { path: 'priorities', element: <Priorities /> },
      { path: 'capture', element: <Capture /> },
      { path: 'genres', element: <GenreBank /> },
      { path: 'routing', element: <Routing /> },
      { path: 'review', element: <Review /> },
      { path: 'export', element: <ExportView /> },
    ],
  },
])

export default function App() {
  return (
    <DepthModeProvider>
      <ActiveContextProvider>
        <RouterProvider router={router} />
      </ActiveContextProvider>
    </DepthModeProvider>
  )
}
