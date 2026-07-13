/**
 * Guided-tour content. The high-level app tour is mandatory on first open; each
 * special-feature page has its own short tour that runs the first time that page
 * is opened. Every tour is replayable. Text is plain and Google-Translate-robust.
 */
export interface TourStep {
  title: string
  body: string
}

export const APP_TOUR = 'app-overview'
export const GENRES_TOUR = 'genres-hub'
export const WORKSHEET_TOUR = 'worksheet-flags'
export const FOLLOWUP_TOUR = 'follow-up'
export const SORT_AI_TOUR = 'sort-ai'

export const APP_TOUR_STEPS: TourStep[] = [
  {
    title: 'Welcome',
    body: 'This app helps you study the songs and poems your own people use, and use them to translate a Psalm so it sounds natural and strong to them.',
  },
  {
    title: 'How the work goes',
    body: 'First say what your psalm is doing. Then find your local song types. Then pick one and study it. Then match the psalm to it and translate. The home page guides you step by step.',
  },
  {
    title: 'Go back and forth freely',
    body: 'You do not have to finish in order. It is normal to leave things blank, talk with a singer or elder, and come back later. Nothing is lost when you move around.',
  },
  {
    title: 'Mark things to come back to',
    body: 'On any question you can tap "Follow up" to save it for later, or "Not applicable" if it does not apply. Your "Follow up" questions gather on one page so you have them ready when you meet an expert.',
  },
  {
    title: 'About the AI helper',
    body: 'There is no automatic AI in the app. "Sort notes with AI" only prepares your notes so you can hand them to Claude yourself. The app never changes your answers on its own. You can open this tour again any time from Help.',
  },
]

export const GENRES_TOUR_STEPS: TourStep[] = [
  {
    title: 'All Psalms & Genres',
    body: 'A "genre" is a type of song or poem your people use. Add each one you want to study. Add the psalm you are translating in the psalms list.',
  },
  {
    title: 'Each genre shows its progress',
    body: 'Every genre card shows how far you have studied it: its details, the big picture, and the fine details. Tap a card to work on that genre.',
  },
  {
    title: 'One genre at a time',
    body: 'The genre you tap becomes the one you are working on. All the study questions are then about that genre, and it is named in the questions so you do not lose track.',
  },
]

export const WORKSHEET_TOUR_STEPS: TourStep[] = [
  {
    title: 'Answering questions',
    body: 'Type your answer in each box. Your work saves by itself as you go.',
  },
  {
    title: 'The buttons on each question',
    body: '"Follow up" saves a question to return to. "Not applicable" marks one that does not apply. The star marks the one or two things that matter most for your translation.',
  },
  {
    title: 'See an example',
    body: 'Where you see "Show example", tap it for a real example to help you understand the question.',
  },
]

export const FOLLOWUP_TOUR_STEPS: TourStep[] = [
  {
    title: 'Your follow-up list',
    body: 'Every question you marked "Follow up" appears here. Use it as your list of things to ask about or come back to. Tap "Open" to jump back to a question.',
  },
]

export const SORT_AI_TOUR_STEPS: TourStep[] = [
  {
    title: 'Sorting notes with AI',
    body: 'This prepares your loose notes so Claude can suggest where each one belongs. There is no automatic AI here.',
  },
  {
    title: 'You stay in control',
    body: 'Claude only suggests. Nothing is saved until you review each suggestion and confirm it. You can edit the text before you accept it.',
  },
]
