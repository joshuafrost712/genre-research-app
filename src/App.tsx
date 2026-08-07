import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { Layout } from './components/Layout'
import { LocaleProvider } from './lib/i18n/LocaleContext'
import { DepthModeProvider } from './components/DepthModeContext'
import { ActiveContextProvider } from './components/ActiveContextProvider'
import { SyncEngineProvider } from './components/SyncEngineProvider'
import { TourProvider } from './components/tour/TourProvider'
import { Dashboard } from './pages/Dashboard'
import { WorksheetView } from './pages/WorksheetView'
import { Wizard } from './pages/Wizard'
import { DescribeLanding } from './pages/DescribeLanding'
import { FollowUp } from './pages/FollowUp'
import { Help } from './pages/Help'
import { Capture } from './pages/Capture'
import { GenreBank } from './pages/GenreBank'
import { GenreSummary } from './pages/GenreSummary'
import { PrintChart } from './pages/PrintChart'
import { ChooseGenre } from './pages/ChooseGenre'
import { MacroCompare } from './pages/MacroCompare'
import { StyleCompare } from './pages/StyleCompare'
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
        { path: 'describe', element: <DescribeLanding groupId="top" /> },
        { path: 'describe/big-picture', element: <DescribeLanding groupId="s2" /> },
        { path: 'describe/style', element: <DescribeLanding groupId="s3" /> },
        { path: 'follow-up', element: <FollowUp /> },
        { path: 'help', element: <Help /> },
        { path: 'capture', element: <Capture /> },
        { path: 'genres', element: <GenreBank /> },
        { path: 'summary', element: <GenreSummary /> },
        { path: 'chart', element: <PrintChart /> },
        { path: 'choose', element: <ChooseGenre /> },
        { path: 'macro', element: <MacroCompare /> },
        { path: 'style', element: <StyleCompare /> },
        { path: 'routing', element: <Routing /> },
        { path: 'review', element: <Review /> },
        { path: 'export', element: <ExportView /> },
        // Shared worksheets run on Postgres now, so these need a Supabase project
        // rather than a Google account. Both pages explain themselves when it is
        // absent, so the routes stay reachable and a join link never 404s.
        { path: 'teams', element: <Teams /> },
        { path: 'teams/join', element: <JoinTeam /> },
      ],
    },
  ],
  // Honors the Vite base so routing works at the domain root or a project-pages subpath.
  { basename: import.meta.env.BASE_URL },
)

export default function App() {
  // LocaleProvider is outermost: it mirrors the active locale into module state
  // during render, and the content loader reads that, so it must be set before any
  // descendant reads worksheet content.
  return (
    <LocaleProvider>
      <DepthModeProvider>
        <ActiveContextProvider>
          <SyncEngineProvider>
            <TourProvider>
              <RouterProvider router={router} />
            </TourProvider>
          </SyncEngineProvider>
        </ActiveContextProvider>
      </DepthModeProvider>
    </LocaleProvider>
  )
}
