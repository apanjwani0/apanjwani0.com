export interface Game {
  slug: string
  title: string
  description: string
  enabled: boolean
  keywords?: string
  /** true = ships a playable in-browser component; false/undefined = "coming soon" placeholder */
  interactive?: boolean
}

export const games: Game[] = [
  {
    "slug": "game-of-life",
    "title": "Game of Life Simulator",
    "description": "An interactive simulator of Conway's Game of Life — the famous \"zero-player\" game. You don't play to win: you plant a few cells, press play, and watch four simple rules turn them into living, moving patterns.\n\nClick to draw, drop in a glider gun or a pulsar, and see complexity emerge from almost nothing. Runs entirely in your browser.",
    "enabled": true,
    "interactive": true,
    "keywords": "game of life simulator,conway's game of life,cellular automaton,glider gun,life simulation,zero-player game"
  },
  {
    "slug": "type-trial",
    "title": "Type Trial",
    "description": "A fast, distraction-free typing race. Pick quotes, code, or numbers, then chase your best words-per-minute as the clock starts on your first keystroke.\n\nEvery character lights up as you go, your speed and accuracy tick live, and a ranked result card lands when you finish. Each category keeps its own personal best, saved right in your browser — nothing is ever uploaded.",
    "enabled": true,
    "interactive": true,
    "keywords": "typing game,typing race,typing speed test,wpm game,words per minute,typing practice,typing test"
  },
  {
    "slug": "flash-cricket",
    "title": "Flash Cricket",
    "description": "A 2D browser cricket game — swing your bat and hit the ball into the scoring zones.\n\nA hobby build. I grew up playing Miniclip-style cricket games like this one and can't find them anywhere anymore — so why not make my own? Writing it in C++.",
    "enabled": true,
    "keywords": "cricket,miniclip,flash-game, flash-cricket"
  }
]
