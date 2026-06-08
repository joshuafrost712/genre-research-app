import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { Layout } from './components/Layout'
import { DepthModeProvider } from './components/DepthModeContext'
import { Dashboard } from './pages/Dashboard'
import { WorksheetView } from './pages/WorksheetView'

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'worksheet/:nodeId', element: <WorksheetView /> },
    ],
  },
])

export default function App() {
  return (
    <DepthModeProvider>
      <RouterProvider router={router} />
    </DepthModeProvider>
  )
}
