import { Link } from 'react-router-dom'
import { useTour } from '../components/tour/TourProvider'
import { APP_TOUR } from '../components/tour/tours'

/**
 * Help / workflow page. Plain, Google-Translate-robust English explaining what
 * the app is for, the order of work, that going back and forth is expected, what
 * the flags mean, and the limits of the "Sort notes with AI" feature. Also the
 * place to replay the high-level app tour.
 */
export function Help() {
  const { replay } = useTour()
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Help &amp; how this works</h1>

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold text-gray-800">What this app is for</h2>
        <p className="text-sm text-gray-700">
          This app helps you study the songs and poems your own people already use,
          and then use what you learn to translate a passage of Scripture — a psalm
          or another text — in a way that sounds natural and powerful to them.
        </p>
        <button
          type="button"
          onClick={() => replay(APP_TOUR)}
          className="self-start rounded-lg bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800"
        >
          Show me the tour again
        </button>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold text-gray-800">The two workspaces</h2>
        <p className="text-sm text-gray-700">
          <span className="font-medium text-emerald-700">Workspace 1 — Find &amp; Describe
          Local Genres</span> stands on its own: list the kinds of songs and poems your
          people use (1a), describe each one (1b–1e), and see them side by side in the
          summary table (1f). Everything here is reusable for every passage you ever
          translate.
        </p>
        <p className="text-sm text-gray-700">
          <span className="font-medium text-sky-700">Workspace 2 — Create / Translate</span>{' '}
          takes one passage through the process: name it (2a), choose the best-fitting
          genre with the comparison tool (2b), work the big picture (2c) and the style
          (2d), and finish at the decisions summary with a first draft in text or voice
          (2e). The home page is the chart of all of this — you can also print it.
        </p>
        <p className="text-sm text-gray-700">
          You do not have to work in a straight line. It is normal and expected
          to go back and forth, to leave things unanswered, and to come back after
          you talk with a singer or an elder. Nothing is lost when you move around.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold text-gray-800">The fit flags and the safety check</h2>
        <p className="text-sm text-gray-700">
          While choosing a genre (2b), you can flag each factor for the passage you
          are translating: <span className="font-medium text-emerald-700">green</span>{' '}
          = good fit, <span className="font-medium text-amber-600">yellow</span> = a
          question to settle, <span className="font-medium text-red-600">red</span> = a
          warning. The flags are about this passage, not the genre itself — a genre can
          be green for one psalm and red for another. If you choose a genre that has
          yellow or red flags, the app shows them once more and asks you to confirm.
          It never blocks your choice; it only helps you be honest with yourselves.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold text-gray-800">The Jot button</h2>
        <p className="text-sm text-gray-700">
          A <span className="font-medium text-violet-700">Jot</span> button sits in
          the bottom corner of every page. When a thought comes to you about another
          part of the work, tap it and write the thought down without leaving the
          page you are on. Your jot is saved as a note. Later you can sort it to the
          right place from{' '}
          <Link to="/capture" className="text-sky-700 hover:underline">
            Quick note
          </Link>{' '}
          or with the AI helper.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold text-gray-800">The buttons on each question</h2>
        <ul className="flex flex-col gap-1.5 text-sm text-gray-700">
          <li>
            <span className="font-medium">Not applicable</span> — mark a question that
            does not apply to your situation, so you can pass it without leaving it blank.
          </li>
          <li>
            <span className="font-medium text-violet-700">Follow up</span> — mark a
            question you want to come back to or ask someone about. They all gather
            on the{' '}
            <Link to="/follow-up" className="text-sky-700 hover:underline">
              Follow up
            </Link>{' '}
            page so you have your questions ready when you meet an expert.
          </li>
          <li>
            <span className="font-medium text-amber-600">★ Star</span> — mark the one
            or two things that matter most to carry into your translation.
          </li>
          <li>
            <span className="font-medium text-emerald-700">Asked</span> — when you
            list people or places to ask, tick this once you have asked them.
          </li>
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold text-gray-800">About the AI helper</h2>
        <p className="text-sm text-gray-700">
          There is no automatic AI inside the app. “Sort notes with AI” prepares
          your notes so you can hand them to Claude yourself and bring the result
          back. The app will never change your answers on its own.
        </p>
        <p className="text-sm text-gray-700">
          When you bring AI results back, nothing is saved until you confirm it on
          the{' '}
          <Link to="/review" className="text-sky-700 hover:underline">
            Review
          </Link>{' '}
          page. If the AI suggests something different from an answer you already
          kept, it does not overwrite you: you choose to keep yours, use the AI's, or
          join them. Anything that came from AI shows a small{' '}
          <span className="rounded bg-sky-100 px-1 py-0.5 text-[11px] font-medium text-sky-700">
            from AI
          </span>{' '}
          mark until you edit it and make it your own. More help guides may be added
          later.
        </p>
      </section>
    </div>
  )
}
