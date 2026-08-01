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
    "slug": "2048",
    "title": "2048",
    "description": "The classic sliding-tile puzzle, in your browser. Slide the whole board with the arrow keys, WASD or a swipe — every tile shoves as far as it can, and two equal numbers that collide fuse into one worth double.\n\nEach move drops a new tile, so it's a race to keep merging before the board clogs. Reach a 2048 tile to win, then keep going for a higher score. Play it three ways — a gentle 3×3, the classic 4×4 or a roomy 5×5 — each with its own saved game and its own best score. Take back a move with Undo, and everything is saved right in your browser, so a refresh picks up exactly where you left off.",
    "enabled": true,
    "interactive": true,
    "keywords": "2048 game,2048 puzzle,sliding tile game,number puzzle,2048 online,play 2048,merge tiles game,2048 clone,browser puzzle game"
  },
  {
    "slug": "quintle",
    "title": "Quintle",
    "description": "A daily five-letter word guessing game. You get six tries to find the hidden word; after each guess the tiles light up — right letter in the right place, right letter in the wrong place, or not in the word at all — and you close in from there.\n\nA fresh puzzle drops every day, the same word for everyone, and it picks up right where you left off if you close the tab. Not enough? Switch to Practice for an endless run of random words, or flip on Hard mode, where every clue you uncover has to be reused. Type on your keyboard or tap the on-screen one, watch your win streak and guess distribution build up, and share your result as a spoiler-free emoji grid. Everything is saved in your browser — no sign-up, nothing uploaded.",
    "enabled": true,
    "interactive": true,
    "keywords": "word game,word guessing game,five letter word game,daily word puzzle,wordle style game,guess the word,vocabulary game,browser word game,unlimited word game,hard mode word game,quintle"
  },
  {
    "slug": "poker",
    "title": "Poker Together",
    "description": "A local-first, play-money poker room you host right in your browser. Create a table, fill the seats with friends (pass-the-device hotseat) or equity-aware bots, and deal — Texas Hold'em, Omaha or a Bomb Pot.\n\nRooms, chips and settings all save locally; nothing is uploaded and there's no sign-up. Under the hood: a cryptographically-shuffled deck, correct side pots and all-ins, an exact Omaha evaluator, and five bot personalities from tight Rocks to loose Maniacs. Open a second tab and the room list stays in sync.",
    "enabled": false,
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
    "slug": "murmuration",
    "title": "Murmuration",
    "description": "An interactive boids flocking simulation. A few hundred birds, each following just three local rules — steer apart, match your neighbours' heading, drift toward the group — and a living, swirling flock emerges with nobody in charge.\n\nDial the three rules from a marching grid to a nervous ball to a scattering cloud, tune how far each bird sees and how fast it flies, then make the pointer a magnet or a hawk and watch the murmuration split and re-form around it. Click to startle the flock, flip on trails to trace the flow, and download the frame you like as a PNG. Runs entirely in your browser.",
    "enabled": true,
    "interactive": true,
    "keywords": "boids,flocking simulation,murmuration,craig reynolds boids,swarm simulation,emergent behavior,separation alignment cohesion,generative art,interactive canvas,download png,flocking algorithm"
  },
  {
    "slug": "lsystem-tree",
    "title": "Fractal Garden",
    "description": "Plants that draw themselves. Each one is an L-system — a tiny rewriting grammar: start from a short seed string, replace every symbol with new symbols a few times over, then read the result as turtle graphics — step forward, turn, branch — and a whole tree falls out of the maths with nobody drawing a single leaf.\n\nGrow seven species, from a Barnsley fractal plant and a bushy weed to the Koch, Dragon and Sierpinski curves. Bend the branch angle, add organic wobble, thicken the trunk and toggle leaf blossoms; the branches are shaded trunk-to-tip and the geometric curves along their length. A text seed makes any plant reproducible, and you can download the frame you like as a PNG. Runs entirely in your browser.",
    "enabled": true,
    "interactive": true,
    "keywords": "l-system,lindenmayer system,fractal plant,fractal tree generator,generative art,turtle graphics,koch curve,dragon curve,sierpinski,barnsley fern,procedural plants,download png"
  },
  {
    "slug": "wallpaper-forge",
    "title": "Wallpaper Forge",
    "description": "A seeded generative wallpaper maker, right in your browser. Choose an engine — glowing gradient Aurora, layered Waves, Topographic noise contours, woven Truchet tiles, or scattered Terrazzo chips — then dial the density, detail and grain until it looks right.\n\nEvery piece is fixed by its settings and seed, so copy the seed to revisit one with the same settings or reroll for a fresh one. Pick a size for your phone, desktop, tablet or a square, and download a crisp, full-resolution PNG rendered at that exact device resolution — the preview and the download are the same picture. Seven palettes, everything drawn on one canvas with no dependencies, your settings saved in your browser, and nothing uploaded.",
    "enabled": true,
    "interactive": true,
    "keywords": "wallpaper generator,generative wallpaper,phone wallpaper maker,desktop wallpaper maker,generative art,seeded art,gradient wallpaper,mesh gradient,topographic art,truchet tiles,terrazzo pattern,download png wallpaper,make your own wallpaper,abstract wallpaper generator"
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
