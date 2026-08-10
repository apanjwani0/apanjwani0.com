export interface Game {
  slug: string
  title: string
  description: string
  enabled: boolean
  seoTitle?: string
  metaDescription?: string
  intro?: string
  seoContent?: string
  keywords?: string
  /** true = ships a playable in-browser component; false/undefined = "coming soon" placeholder */
  interactive?: boolean
}

export const games: Game[] = [
  {
    "slug": "game-of-life",
    "title": "Game of Life Simulator",
    "description": "An interactive simulator of Conway's Game of Life — the famous \"zero-player\" game. You don't play to win: you plant a few cells, press play, and watch four simple rules turn them into living, moving patterns.\n\nClick to draw, drop in a glider gun or a pulsar, and see complexity emerge from almost nothing. Runs entirely in your browser.",
    "seoTitle": "Conway's Game of Life Simulator",
    "metaDescription": "Run Conway's Game of Life in your browser. Draw cells, drop in patterns, step generations and watch gliders, pulsars and random soups evolve.",
    "enabled": true,
    "interactive": true,
    "keywords": "game of life simulator,conway's game of life,cellular automaton,glider gun,life simulation,zero-player game"
  },
  {
    "slug": "2048",
    "title": "2048",
    "description": "The classic sliding-tile puzzle, in your browser. Slide the whole board with the arrow keys, WASD or a swipe — every tile shoves as far as it can, and two equal numbers that collide fuse into one worth double.\n\nEach move drops a new tile, so it's a race to keep merging before the board clogs. Reach a 2048 tile to win, then keep going for a higher score. Play it three ways — a gentle 3×3, the classic 4×4 or a roomy 5×5 — each with its own saved game and its own best score. Take back a move with Undo, and everything is saved right in your browser, so a refresh picks up exactly where you left off.",
    "seoTitle": "2048 Game Online — Free Sliding Tile Puzzle",
    "metaDescription": "Play 2048 online in your browser. Slide and merge numbered tiles, undo a move, choose 3x3, 4x4 or 5x5 boards, and save your best score locally.",
    "enabled": true,
    "interactive": true,
    "keywords": "2048 game,2048 puzzle,sliding tile game,number puzzle,2048 online,play 2048,merge tiles game,2048 clone,browser puzzle game",
    "seoContent": `## How to play 2048

Use the arrow keys, WASD or swipe to move every tile on the board. When two tiles with the same number collide, they merge into one tile worth double. After every move, a new tile appears.

## What is different in this version

- Play the classic 4x4 board, a tight 3x3 board or a roomier 5x5 board.
- Use Undo to take back one move.
- Keep separate saved games and best scores for each board size.
- Continue after 2048 if you want a higher score.

## Simple 2048 strategy

Keep your largest tile in one corner, build rows around it, and avoid moving in a direction that pulls the largest tile out of place. Empty spaces matter more than one big merge; if the board fills up, you lose control quickly.

## FAQ

### Is this the original 2048?

No. This is a browser version inspired by the classic sliding tile puzzle, with extra board sizes and undo.

### Does my score save?

Yes. Your current game and best score are saved locally in your browser.

### Can I play on mobile?

Yes. Swipe in the direction you want the tiles to move.`
  },
  {
    "slug": "quintle",
    "title": "Quintle",
    "description": "A daily five-letter word guessing game. You get six tries to find the hidden word; after each guess the tiles light up — right letter in the right place, right letter in the wrong place, or not in the word at all — and you close in from there.\n\nA fresh puzzle drops every day, the same word for everyone, and it picks up right where you left off if you close the tab. Not enough? Switch to Practice for an endless run of random words, or flip on Hard mode, where every clue you uncover has to be reused. Type on your keyboard or tap the on-screen one, watch your win streak and guess distribution build up, and share your result as a spoiler-free emoji grid. Everything is saved in your browser — no sign-up, nothing uploaded.",
    "seoTitle": "Daily Five-Letter Word Game — Quintle",
    "metaDescription": "Play a daily five-letter word game with six guesses, hard mode, practice mode, streaks and shareable emoji results. No signup, no upload.",
    "enabled": true,
    "interactive": true,
    "keywords": "word game,word guessing game,five letter word game,daily word puzzle,wordle style game,guess the word,vocabulary game,browser word game,unlimited word game,hard mode word game,quintle",
    "seoContent": `## How Quintle works

Guess the hidden five-letter word in six tries. After each guess, the tiles tell you what changed: correct letter in the right spot, correct letter in the wrong spot, or a letter that is not in the word.

## Modes

- Daily gives everyone the same puzzle for the day.
- Practice lets you keep playing random words.
- Hard mode makes you reuse every clue you have already found.
- Share copies a spoiler-free emoji grid.

## Starting-word tips

Start with a word that uses common vowels and consonants. After the first guess, stop chasing random words and use the colours: lock green letters in place, move yellow letters around, and avoid grey letters unless you are testing a repeated letter.

## FAQ

### Is Quintle a Wordle clone?

It is a five-letter word guessing game in the same broad style, but it has its own daily puzzle, practice mode, hard mode and local stats.

### Do I need an account?

No. Streaks and guess history are saved in your browser.

### Can I play more than once a day?

Yes. Use Practice mode when the daily puzzle is done.`
  },
  {
    "slug": "poker",
    "title": "Poker Together",
    "description": "A local-first, play-money poker room you host right in your browser. Create a table, fill the seats with friends (pass-the-device hotseat) or equity-aware bots, and deal — Texas Hold'em, Omaha or a Bomb Pot.\n\nRooms, chips and settings all save locally; nothing is uploaded and there's no sign-up. Under the hood: a cryptographically-shuffled deck, correct side pots and all-ins, an exact Omaha evaluator, and five bot personalities from tight Rocks to loose Maniacs. Open a second tab and the room list stays in sync.",
    "seoTitle": "Browser Poker Room with Bots — Poker Together",
    "metaDescription": "Host a local play-money poker room in your browser with Texas Hold'em, Omaha, bomb pots, bots, side pots and local saves.",
    "enabled": false,
    "interactive": true,
    "keywords": "poker,texas hold'em,omaha poker,bomb pot,play money poker,browser poker,local multiplayer poker,poker bots,poker against ai,side pots,poker room"
  },
  {
    "slug": "flow-field",
    "title": "Flow Field",
    "description": "Seeded generative art you steer in the browser. Hundreds of particles drift across an invisible field of currents woven from noise, each trailing colour as it flows — and the whole picture is fixed by a single seed.\n\nReroll for a new one or type a seed to reproduce a piece exactly. Tune the particle count, speed, field detail, trails and palette, click the canvas to stir the flow, then download the frame you like as a PNG. Runs entirely in your browser.",
    "seoTitle": "Flow Field Generator — Seeded Generative Art",
    "metaDescription": "Make seeded flow-field art in your browser. Tune particles, speed, detail, trails and palettes, stir the canvas, then download a PNG.",
    "enabled": true,
    "interactive": true,
    "keywords": "flow field generator,generative art,perlin noise art,particle flow,seeded art,algorithmic art,noise field,download png art"
  },
  {
    "slug": "maze-weaver",
    "title": "Maze Weaver",
    "description": "A seeded maze generator and pathfinding visualizer. Weave a perfect maze — every two cells joined by exactly one corridor — then watch a solver hunt the route from start to goal.\n\nBuild it three ways (recursive backtracker, Prim's or Kruskal's) and search it three ways (breadth-first, A*, or depth-first), and compare how differently each one explores. Every maze is fixed by a single seed, so you can reproduce one exactly or reroll for a new one. Tune the size and speed, single-step the animation, click any cell to move the goal, and download the frame as a PNG. Runs entirely in your browser.",
    "seoTitle": "Maze Generator & Solver Visualizer — Maze Weaver",
    "metaDescription": "Generate seeded mazes and watch BFS, A* or DFS solve them. Compare algorithms, move the goal, step the animation and export a PNG.",
    "enabled": true,
    "interactive": true,
    "keywords": "maze generator,maze solver,pathfinding visualizer,breadth first search,a star algorithm,depth first search,recursive backtracker,prim's algorithm,kruskal's algorithm,bfs vs a star,seeded maze,algorithm visualization"
  },
  {
    "slug": "starfield-toy",
    "title": "Starfield Voyager",
    "description": "A mouse-reactive warp-drive starfield you fly through in the browser. Point where you want to go and the field banks toward the cursor; click to punch the warp drive and watch the stars stretch into hyperspace streaks.\n\nGrown from the drifting stars on my home page into a full toy: tune the density, cruising speed, streak length, star size and spin, pick from six palettes, then download the frame you like as a PNG. Everything is drawn on a single canvas with no dependencies, remembers your settings, and runs entirely in your browser.",
    "seoTitle": "Interactive Starfield Animation — Starfield Voyager",
    "metaDescription": "Fly through a mouse-reactive starfield. Tune speed, density, streaks and palettes, punch warp, then download the frame as a PNG.",
    "enabled": true,
    "interactive": true,
    "keywords": "starfield,warp speed,hyperspace,star field animation,space flight simulation,interactive canvas art,generative art,mouse reactive,download png,star warp toy"
  },
  {
    "slug": "murmuration",
    "title": "Murmuration",
    "description": "An interactive boids flocking simulation. A few hundred birds, each following just three local rules — steer apart, match your neighbours' heading, drift toward the group — and a living, swirling flock emerges with nobody in charge.\n\nDial the three rules from a marching grid to a nervous ball to a scattering cloud, tune how far each bird sees and how fast it flies, then make the pointer a magnet or a hawk and watch the murmuration split and re-form around it. Click to startle the flock, flip on trails to trace the flow, and download the frame you like as a PNG. Runs entirely in your browser.",
    "seoTitle": "Boids Flocking Simulation — Murmuration",
    "metaDescription": "Play with a boids flocking simulation. Tune separation, alignment and cohesion, make the pointer attract or scare birds, and export PNG.",
    "enabled": true,
    "interactive": true,
    "keywords": "boids,flocking simulation,murmuration,craig reynolds boids,swarm simulation,emergent behavior,separation alignment cohesion,generative art,interactive canvas,download png,flocking algorithm"
  },
  {
    "slug": "turing-bloom",
    "title": "Turing Bloom",
    "description": "An interactive reaction-diffusion playground. Two make-believe chemicals spread and react across a grid, and from a few painted specks the self-organising patterns Alan Turing proposed for animal markings bloom on their own — spots, stripes, coral, mazes, and cells that endlessly divide.\n\nPick a regime, nudge the feed and kill rates to melt one pattern into another, and paint on the canvas to grow a bloom from your own strokes. Eight presets, seven palettes, a reproducible seed and one-click PNG export — all drawn on a single canvas with no dependencies, and it runs entirely in your browser.",
    "seoTitle": "Reaction Diffusion Simulator — Turing Bloom",
    "metaDescription": "Paint reaction-diffusion patterns in your browser. Try Gray-Scott presets for spots, stripes and coral, tune feed/kill rates and export PNG.",
    "enabled": true,
    "interactive": true,
    "keywords": "reaction diffusion,gray-scott,turing pattern,turing bloom,morphogenesis,cellular pattern simulation,generative art,coral pattern,mitosis simulation,paint simulation,download png,interactive canvas"
  },
  {
    "slug": "lsystem-tree",
    "title": "Fractal Garden",
    "description": "Plants that draw themselves. Each one is an L-system — a tiny rewriting grammar: start from a short seed string, replace every symbol with new symbols a few times over, then read the result as turtle graphics — step forward, turn, branch — and a whole tree falls out of the maths with nobody drawing a single leaf.\n\nGrow seven species, from a Barnsley fractal plant and a bushy weed to the Koch, Dragon and Sierpinski curves. Bend the branch angle, add organic wobble, thicken the trunk and toggle leaf blossoms; the branches are shaded trunk-to-tip and the geometric curves along their length. A text seed makes any plant reproducible, and you can download the frame you like as a PNG. Runs entirely in your browser.",
    "seoTitle": "L-System Fractal Tree Generator — Fractal Garden",
    "metaDescription": "Grow L-system fractal trees and curves from simple rules. Adjust angle, wobble, leaves and seed, then download the result as a PNG.",
    "enabled": true,
    "interactive": true,
    "keywords": "l-system,lindenmayer system,fractal plant,fractal tree generator,generative art,turtle graphics,koch curve,dragon curve,sierpinski,barnsley fern,procedural plants,download png"
  },
  {
    "slug": "type-trial",
    "title": "Type Trial",
    "description": "A fast, distraction-free typing race. Pick quotes, code, or numbers, then chase your best words-per-minute as the clock starts on your first keystroke.\n\nEvery character lights up as you go, your speed and accuracy tick live, and a ranked result card lands when you finish. Each category keeps its own personal best, saved right in your browser — nothing is ever uploaded.",
    "seoTitle": "Typing Speed Test Game — Type Trial",
    "metaDescription": "Race through quotes, code or numbers and measure WPM, accuracy and personal bests. A simple typing speed game that stays in your browser.",
    "enabled": true,
    "interactive": true,
    "keywords": "typing game,typing race,typing speed test,wpm game,words per minute,typing practice,typing test",
    "seoContent": `## A typing speed test for real text

Type Trial measures words per minute, accuracy and personal bests while you type short quotes, code or numbers. The timer starts when you press the first key, so setup time does not count against you.

## What it measures

- WPM, or words per minute, based on standard word length.
- Accuracy, based on how many characters you typed correctly.
- Category bests for quotes, code and numbers.
- A finish card you can use to compare attempts.

## How to improve your score

Start by typing cleanly, not quickly. Accuracy usually raises WPM because you spend less time correcting mistakes. Practice numbers and symbols separately if normal quote tests feel easy; they expose weak spots that plain words hide.

## FAQ

### Is this like Monkeytype?

Monkeytype is a full typing practice platform. Type Trial is smaller and focused on quick local races with quotes, code and numbers.

### Are scores uploaded?

No. Personal bests stay in your browser.

### What does WPM mean?

WPM means words per minute. It is a rough speed score, not a perfect measure of writing skill.`
  },
  {
    "slug": "hue-hunt",
    "title": "Hue Hunt",
    "description": "A hex colour guessing game. A mystery colour appears — pick the hex code that made it, or switch to type mode and guess the code yourself to see how sharp your eye really is.\n\nThree difficulty levels crowd the decoys closer together, and typed guesses are scored on true perceptual closeness and drawn right next to the answer. Streaks and best scores save in your browser — nothing is uploaded.",
    "seoTitle": "Hex Color Guessing Game — Hue Hunt",
    "metaDescription": "Guess the hex code behind a color, or type your own guess and see how close you got. Three difficulties, streaks and local best scores.",
    "enabled": true,
    "interactive": true,
    "keywords": "hex color game,color guessing game,guess the hex,hex code game,color quiz,rgb guessing game,learn hex colors,color memory game"
  },
  {
    "slug": "flash-cricket",
    "title": "Flash Cricket",
    "description": "A 2D browser cricket game — swing your bat and hit the ball into the scoring zones.\n\nA hobby build. I grew up playing Miniclip-style cricket games like this one and can't find them anywhere anymore — so why not make my own? Writing it in C++.",
    "seoTitle": "Browser Cricket Game — Flash Cricket",
    "metaDescription": "A work-in-progress 2D browser cricket game inspired by old Flash cricket games, with batting, scoring zones and a simple hobby build story.",
    "enabled": true,
    "keywords": "cricket game,miniclip cricket,browser cricket game,2d cricket,flash cricket"
  }
]
