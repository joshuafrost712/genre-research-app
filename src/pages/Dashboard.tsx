import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ensureActiveProject, getLastNode } from '../lib/storage/appState'
import { findNode, navOrder } from '../lib/content/loader'
import type { Project } from '../lib/types'

/**
 * Home dashboard. For this scaffold it ensures a starter project exists and
 * offers two entry points: resume where the team left off, or start at the
 * first subsection. Multi-file management and project setup arrive in later steps.
 */
export function Dashboard() {
  const [project, setProject] = useState<Project | null>(null)

  useEffect(() => {
    ensureActiveProject().then(setProject)
  }, [])

  const lastNodeId = useLiveQuery(
    async () => (project ? ((await getLastNode(project.id)) ?? null) : null),
    [project?.id],
  )

  const firstNodeId = navOrder()[0]
  const resumeRef = lastNodeId ? findNode(lastNodeId) : undefined

  if (!project) {
    return <p className="text-gray-500">Loading…</p>
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{project.name}</h1>
        <p className="mt-1 text-sm text-gray-500">
          Worksheet config {project.config_version}
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        {resumeRef && (
          <Link
            to={`/worksheet/${resumeRef.node.id}`}
            className="rounded-lg bg-gray-800 px-4 py-3 text-center font-medium text-white hover:bg-gray-700"
          >
            Resume: {resumeRef.node.label}
          </Link>
        )}
        {firstNodeId && (
          <Link
            to={`/worksheet/${firstNodeId}`}
            className="rounded-lg border border-gray-300 bg-white px-4 py-3 text-center font-medium text-gray-700 hover:bg-gray-50"
          >
            {resumeRef ? 'Start from the beginning' : 'Start the worksheet'}
          </Link>
        )}
      </div>

      <p className="text-sm text-gray-500">
        Use the menu to jump to any section or subsection at any time. The
        worksheet is non-linear by design.
      </p>
    </div>
  )
}
