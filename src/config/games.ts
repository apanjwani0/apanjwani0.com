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
    "slug": "flow-field",
    "title": "Flow Field",
    "description": "Seeded generative art you steer in the browser. Hundreds of particles drift across an invisible field of currents woven from noise, each trailing colour as it flows — and the whole picture is fixed by a single seed.\n\nReroll for a new one or type a seed to reproduce a piece exactly. Tune the particle count, speed, field detail, trails and palette, click the canvas to stir the flow, then download the frame you like as a PNG. Runs entirely in your browser.",
    "enabled": true,
    "interactive": true,
    "keywords": "flow field generator,generative art,perlin noise art,particle flow,seeded art,algorithmic art,noise field,download png art"
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
    "slug": "hue-hunt",
    "title": "Hue Hunt",
    "description": "A hex colour guessing game. A mystery colour appears — pick the hex code that made it, or switch to type mode and guess the code yourself to see how sharp your eye really is.\n\nThree difficulty levels crowd the decoys closer together, and typed guesses are scored on true perceptual closeness and drawn right next to the answer. Streaks and best scores save in your browser — nothing is uploaded.",
    "enabled": true,
    "interactive": true,
    "keywords": "hex color game,color guessing game,guess the hex,hex code game,color quiz,rgb guessing game,learn hex colors,color memory game"
  },
  {
    "slug": "flash-cricket",
    "title": "Flash Cricket",
    "description": "A 2D browser cricket game — swing your bat and hit the ball into the scoring zones.\n\nA hobby build. I grew up playing Miniclip-style cricket games like this one and can't find them anywhere anymore — so why not make my own? Writing it in C++.",
    "enabled": true,
    "keywords": "cricket game,miniclip cricket,browser cricket game,2d cricket,flash cricket"
  }
]
