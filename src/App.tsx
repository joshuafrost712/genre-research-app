import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { Layout } from './components/Layout'
import { DepthModeProvider } from './components/DepthModeContext'
import { ActiveContextProvider } from './components/ActiveContextProvider'
import { SyncEngineProvider } from './components/SyncEngineProvider'
import { TourProvider } from './components/tour/TourProvider'
import { Dashboard } from './pages/Dashboard'
import { WorksheetView } from './pages/WorksheetView'
import { Wizard } from './pages/Wizard'
import { Priorities } from './pages/Priorities'
import { FollowUp } from './pages/FollowUp'
import { Help } from './pages/Help'
import { Capture } from './pages/Capture'
import { GenreBank } from './pages/GenreBank'
import { GenreSummary } from './pages/GenreSummary'
import { PrintChart } from './pages/PrintChart'
import { Compare } from './pages/Compare'
import { ExportView } from './pages/ExportView'
import { Routing } from './pages/Routing'
import { Review } from './pages/Review'
import { Teams } from './pages/Teams'
import { JoinTeam } from './pages/JoinTeam'

const router = createBrowserRouter(
  [
    {
      path: '/',
      element: <Layout />,
      children: [
        { index: true, element: <Dashboard /> },
        { path: 'worksheet/:nodeId', element: <WorksheetView /> },
        { path: 'wizard', element: <Wizard /> },
        { path: 'priorities', element: <Priorities /> },
        { path: 'follow-up', element: <FollowUp /> },
        { path: 'help', element: <Help /> },
        { path: 'capture', element: <Capture /> },
        { path: 'genres', element: <GenreBank /> },
        { path: 'summary', element: <GenreSummary /> },
        { path: 'chart', element: <PrintChart /> },
        { path: 'compare', element: <Compare /> },
        { path: 'routing', element: <Routing /> },
        { path: 'review', element: <Review /> },
        { path: 'export', element: <ExportView /> },
        { path: 'teams', element: <Teams /> },
        { path: 'teams/join', element: <JoinTeam /> },
      ],
    },
  ],
  // Honors the Vite base so routing works at the domain root or a project-pages subpath.
  { basename: import.meta.env.BASE_URL },
)

export default function App() {
  return (
    <DepthModeProvider>
      <ActiveContextProvider>
        <SyncEngineProvider>
          <TourProvider>
            <RouterProvider router={router} />
          </TourProvider>
        </SyncEngineProvider>
      </ActiveContextProvider>
    </DepthModeProvider>
  )
}
