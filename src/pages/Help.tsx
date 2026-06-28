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
          and then use what you learn to translate a Psalm in a way that sounds
          natural and powerful to them. Right now it is built for the Psalms.
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
        <h2 className="text-base font-semibold text-gray-800">The order of work</h2>
        <ol className="ml-5 list-decimal text-sm text-gray-700">
          <li>Say what your psalm is about and what it is doing.</li>
          <li>Find the local song and poem types your people use.</li>
          <li>Choose one type and study it: first the big picture, then the details.</li>
          <li>Match the psalm to that type and write your translation.</li>
        </ol>
        <p className="text-sm text-gray-700">
          You do not have to do this in a straight line. It is normal and expected
          to go back and forth, to leave things unanswered, and to come back after
          you talk with a singer or an elder. Nothing is lost when you move around.
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
            <span className="font-medium">N/A</span> — mark a question that does not
            apply to your situation, so you can pass it without leaving it blank.
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
