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
    "slug": "poker",
    "title": "Poker Together",
    "description": "A local-first, play-money poker room you host right in your browser. Create a table, fill the seats with friends (pass-the-device hotseat) or equity-aware bots, and deal — Texas Hold'em, Omaha or a Bomb Pot.\n\nRooms, chips and settings all save locally; nothing is uploaded and there's no sign-up. Under the hood: a cryptographically-shuffled deck, correct side pots and all-ins, an exact Omaha evaluator, and five bot personalities from tight Rocks to loose Maniacs. Open a second tab and the room list stays in sync.",
    "enabled": true,
    "interactive": true,
    "keywords": "poker,texas hold'em,omaha poker,bomb pot,play money poker,browser poker,local multiplayer poker,poker bots,poker against ai,side pots,poker room"
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
    "slug": "maze-weaver",
    "title": "Maze Weaver",
    "description": "A seeded maze generator and pathfinding visualizer. Weave a perfect maze — every two cells joined by exactly one corridor — then watch a solver hunt the route from start to goal.\n\nBuild it three ways (recursive backtracker, Prim's or Kruskal's) and search it three ways (breadth-first, A*, or depth-first), and compare how differently each one explores. Every maze is fixed by a single seed, so you can reproduce one exactly or reroll for a new one. Tune the size and speed, single-step the animation, click any cell to move the goal, and download the frame as a PNG. Runs entirely in your browser.",
    "enabled": true,
    "interactive": true,
    "keywords": "maze generator,maze solver,pathfinding visualizer,breadth first search,a star algorithm,depth first search,recursive backtracker,prim's algorithm,kruskal's algorithm,bfs vs a star,seeded maze,algorithm visualization"
  },
  {
    "slug": "starfield-toy",
    "title": "Starfield Voyager",
    "description": "A mouse-reactive warp-drive starfield you fly through in the browser. Point where you want to go and the field banks toward the cursor; click to punch the warp drive and watch the stars stretch into hyperspace streaks.\n\nGrown from the drifting stars on my home page into a full toy: tune the density, cruising speed, streak length, star size and spin, pick from six palettes, then download the frame you like as a PNG. Everything is drawn on a single canvas with no dependencies, remembers your settings, and runs entirely in your browser.",
    "enabled": true,
    "interactive": true,
    "keywords": "starfield,warp speed,hyperspace,star field animation,space flight simulation,interactive canvas art,generative art,mouse reactive,download png,star warp toy"
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
