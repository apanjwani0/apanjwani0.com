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
    "keywords": "game of life simulator,conway's game of life,cellular automaton,glider gun,life simulation,zero-player game",
    "seoContent": `## The rules, in four lines

Every square is a cell — alive or empty. On each generation all cells update at once, based on how many of their eight touching neighbours are alive:

- A live cell with fewer than two live neighbours dies of loneliness.
- A live cell with two or three live neighbours survives.
- A live cell with more than three dies of overcrowding.
- An empty cell with exactly three live neighbours comes to life.

That is the entire game. John Conway published it in 1970, and everything else — gliders, oscillators, guns — is a consequence of those four lines.

## How to use the simulator

Click or drag on the grid to draw cells, then press Play. Step advances a single generation, Random fills the board with a soup to see what emerges, and Clear empties it. The speed slider sets generations per second, and Wrap edges makes cells that leave one side reappear on the other, so a glider can circle forever instead of dying against the wall.

Keyboard shortcuts work while the grid is focused: space plays and pauses, S steps, R randomizes, C clears.

## Patterns to drop in

- Glider — the famous five-cell shape that walks diagonally across the board.
- Spaceship — a lightweight spaceship that travels in a straight line.
- Pulsar — an oscillator that returns to its starting shape every three generations.
- Glider gun — Gosper's gun, which fires a new glider forever and proved that Life patterns can grow without limit.

## FAQ

### How do you win Conway's Game of Life?

You do not. It is a zero-player game: you set the starting cells, then the rules take over. The interest is entirely in what those rules build out of your starting pattern.

### Why is it called a cellular automaton?

Because the board is a grid of cells and each one updates itself from a fixed local rule, with no central controller. It is the classic demonstration of complex behaviour emerging from very simple parts.

### Does it run entirely in my browser?

Yes. The whole simulation is drawn on a canvas on your device. Nothing is uploaded and no account is needed.`
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
    "keywords": "flow field generator,generative art,perlin noise art,particle flow,seeded art,algorithmic art,noise field,download png art",
    "seoContent": `## What a flow field is

Imagine a wind map laid over the canvas: at every point there is an arrow pointing some direction. Drop hundreds of particles into it and each one simply reads the arrow beneath it, takes a small step that way and paints a short line. The arrows come from smooth value noise rather than raw randomness, so neighbouring points push in similar directions and the paths braid and swirl instead of scattering. Do that for hundreds of particles over thousands of steps and the hidden field emerges as flowing ribbons.

## The controls

- Particles — how many are in the field at once. More gives a denser, more painterly image.
- Speed — how far each particle travels per frame.
- Detail — the scale of the noise. Low means broad sweeping currents; high means tight, busy eddies.
- Trails — how much of each frame lingers, from crisp single strokes to long smeared ribbons.
- Six palettes, including one that follows the site's own theme colours.

Click anywhere on the canvas to stir the flow. Space plays and pauses, R regenerates, C wipes the canvas while keeping the field, and D downloads the current frame as a PNG.

## Seeds

Every field is built from a seed. Reroll for a new one, or type a seed back in to reproduce that exact piece — same seed and same settings, same artwork. Copy the seed next to any frame worth keeping.

## FAQ

### Can I download the art?

Yes. Press D or use Download PNG to save the current frame at canvas resolution. No watermark, no sign-up.

### Is this Perlin noise?

It uses value noise — the same family of smooth, seeded, lattice-based randomness. That continuity is what makes the field flow rather than jitter; the visual result is what people usually mean by "Perlin noise art".

### Does it run in my browser?

Yes, entirely. The particles are simulated and drawn on your device and nothing is uploaded.`
  },
  {
    "slug": "maze-weaver",
    "title": "Maze Weaver",
    "description": "A seeded maze generator and pathfinding visualizer. Weave a perfect maze — every two cells joined by exactly one corridor — then watch a solver hunt the route from start to goal.\n\nBuild it three ways (recursive backtracker, Prim's or Kruskal's) and search it three ways (breadth-first, A*, or depth-first), and compare how differently each one explores. Every maze is fixed by a single seed, so you can reproduce one exactly or reroll for a new one. Tune the size and speed, single-step the animation, click any cell to move the goal, and download the frame as a PNG. Runs entirely in your browser.",
    "seoTitle": "Maze Generator & Solver Visualizer — Maze Weaver",
    "metaDescription": "Generate seeded mazes and watch BFS, A* or DFS solve them. Compare algorithms, move the goal, step the animation and export a PNG.",
    "enabled": true,
    "interactive": true,
    "keywords": "maze generator,maze solver,pathfinding visualizer,breadth first search,a star algorithm,depth first search,recursive backtracker,prim's algorithm,kruskal's algorithm,bfs vs a star,seeded maze,algorithm visualization",
    "seoContent": `## Perfect mazes, built three ways

Every maze here is perfect: exactly one path joins any two cells, with no loops and no sealed-off pockets. The three generators all produce perfect mazes that look nothing alike.

- Recursive Backtracker carves one long winding corridor, doubling back whenever it hits a dead end. Expect long twisty passages and few junctions.
- Randomized Prim grows the maze outward from a single cell, always opening a random wall on the frontier. The result is bushier, with many short branches.
- Randomized Kruskal joins random cells whose regions are not yet connected, so the maze forms everywhere at once and comes out the most uniform.

## Watching the solvers

Pick a solver and press Solve to watch it search from the green start to the coral goal. The contrast is the point:

- BFS explores in expanding rings and always returns a shortest path, but visits nearly everything on the way.
- A* uses distance-to-goal as a hint, so the search leans toward the target and touches far fewer cells for the same shortest path.
- DFS charges down one corridor until it dead-ends, then backtracks. It often reaches the goal quickly but by a badly roundabout route.

Use Step to advance one move at a time, or click any cell to move the goal and rerun the search against a new target.

## Seeds and export

Each maze comes from a seed. Regenerate with G for a new one, or type a seed back in to rebuild the exact same maze — which is what makes a fair comparison between two solvers possible. Press D to save the current frame as a PNG.

Shortcuts: space solves and pauses, G regenerates, S steps, C clears the search overlay, D downloads.

## FAQ

### Which maze solving algorithm is fastest?

A* usually visits the fewest cells here, because it is guided toward the goal, and it still returns a shortest path. BFS also guarantees a shortest path but explores blindly in all directions. DFS can reach the goal in very few steps on a lucky layout, and rarely by a short route.

### Can I compare two algorithms on the same maze?

Yes. Keep the seed, switch the solver and press Solve again. Same maze, different search — that is the clearest way to see how the strategies differ.

### Does it run in my browser?

Yes. Generation, solving and PNG export all happen on your device. Nothing is uploaded.`
  },
  {
    "slug": "starfield-toy",
    "title": "Starfield Voyager",
    "description": "A mouse-reactive warp-drive starfield you fly through in the browser. Point where you want to go and the field banks toward the cursor; click to punch the warp drive and watch the stars stretch into hyperspace streaks.\n\nGrown from the drifting stars on my home page into a full toy: tune the density, cruising speed, streak length, star size and spin, pick from six palettes, then download the frame you like as a PNG. Everything is drawn on a single canvas with no dependencies, remembers your settings, and runs entirely in your browser.",
    "seoTitle": "Interactive Starfield Animation — Starfield Voyager",
    "metaDescription": "Fly through a mouse-reactive starfield. Tune speed, density, streaks and palettes, punch warp, then download the frame as a PNG.",
    "enabled": true,
    "interactive": true,
    "keywords": "starfield,warp speed,hyperspace,star field animation,space flight simulation,interactive canvas art,generative art,mouse reactive,download png,star warp toy",
    "seoContent": `## How to fly it

Move the pointer over the field and the vanishing point eases toward it, so you steer simply by pointing where you want to go. Click the canvas — or press B — to punch the warp drive: the stars stretch into long hyperspace streaks, then relax as you decelerate. Space holds position, R scatters a fresh field, and D saves the current frame as a PNG.

## The controls

- Density — how many stars are in flight at once.
- Speed — your cruising rate before any boost.
- Warp — how far a star smears into a streak, from crisp points to full hyperspace lines.
- Star size — the thickness of each star, from fine dust to fat glowing dots.
- Spin — a slow roll of the whole field around the vanishing point.

Six palettes are included — Ice, Aurora, Ember, Candy and Mono, plus a Theme option that follows the site's own colours.

## Where it came from

This grew out of the drifting stars behind the home page of this site. That version is decorative and fixed; this one exposes every parameter, adds pointer steering and the warp boost, and lets you export a frame you like.

## Privacy

Everything is drawn on a single canvas in your browser, with no dependencies and no network calls. Your sliders and palette are remembered on this device only.

## FAQ

### How do I make the stars streak?

Push the Warp slider up for a permanently stretched field, or leave it low and press B — or click the canvas — for a temporary boost that stretches and then relaxes.

### Can I save the image?

Yes. Press D or use Download PNG to save the frame exactly as it appears, at canvas resolution.

### Does it work on a touchscreen?

Yes. Drag a finger across the field to steer and tap to fire the warp boost; steering follows your finger the same way it follows a pointer.`
  },
  {
    "slug": "murmuration",
    "title": "Murmuration",
    "description": "An interactive boids flocking simulation. A few hundred birds, each following just three local rules — steer apart, match your neighbours' heading, drift toward the group — and a living, swirling flock emerges with nobody in charge.\n\nDial the three rules from a marching grid to a nervous ball to a scattering cloud, tune how far each bird sees and how fast it flies, then make the pointer a magnet or a hawk and watch the murmuration split and re-form around it. Click to startle the flock, flip on trails to trace the flow, and download the frame you like as a PNG. Runs entirely in your browser.",
    "seoTitle": "Boids Flocking Simulation — Murmuration",
    "metaDescription": "Play with a boids flocking simulation. Tune separation, alignment and cohesion, make the pointer attract or scare birds, and export PNG.",
    "enabled": true,
    "interactive": true,
    "keywords": "boids,flocking simulation,murmuration,craig reynolds boids,swarm simulation,emergent behavior,separation alignment cohesion,generative art,interactive canvas,download png,flocking algorithm",
    "seoContent": `## Three rules, one flock

Craig Reynolds showed in 1986 that flocking needs no leader and no plan. Each simulated bird — a boid — looks only at the neighbours it can see and obeys three rules:

- Separation: steer away from anyone too close.
- Alignment: match the average heading of your neighbours.
- Cohesion: drift toward the average position of your neighbours.

No bird knows the shape of the flock, yet a swirling murmuration appears anyway. That is emergence, and the sliders here let you take it apart.

## What each slider does to the flock

- Push Separation up and the flock loosens into a nervous, spread-out cloud.
- Push Alignment up and it stiffens into a marching column that moves as one body.
- Push Cohesion up and it collapses into a tight ball orbiting its own centre.
- Vision sets how far each bird can see. Small vision gives many little sub-flocks; large vision makes the whole group act as one.
- Boids and Speed set how many birds there are and how fast they fly.

Set all three rules low and you get drifting dust with no flock at all — which is the lesson. The flock does not live in any bird; it lives in the balance between the rules.

## Playing with it

Make the pointer an Attract magnet and the flock chases it. Switch to Avoid and it becomes a hawk: the murmuration splits around the pointer and re-forms behind it. Click to startle everything at once, press T for motion trails that trace the flow lines, and D to save the frame as a PNG. Space pauses, B scatters, R re-seeds a fresh flock.

## FAQ

### What are boids?

Boids are the simulated birds in Craig Reynolds' 1986 flocking model. Each one follows the same three local rules, and convincing flock behaviour falls out of them with no global choreography at all.

### Is this how real starlings behave?

Broadly yes. Real murmurations rely on each bird tracking a handful of nearest neighbours rather than the whole flock, which is exactly what the Vision setting models here.

### Does it run in my browser?

Yes, entirely on a canvas on your device. Nothing is uploaded.`
  },
  {
    "slug": "turing-bloom",
    "title": "Turing Bloom",
    "description": "An interactive reaction-diffusion playground. Two make-believe chemicals spread and react across a grid, and from a few painted specks the self-organising patterns Alan Turing proposed for animal markings bloom on their own — spots, stripes, coral, mazes, and cells that endlessly divide.\n\nPick a regime, nudge the feed and kill rates to melt one pattern into another, and paint on the canvas to grow a bloom from your own strokes. Eight presets, seven palettes, a reproducible seed and one-click PNG export — all drawn on a single canvas with no dependencies, and it runs entirely in your browser.",
    "seoTitle": "Reaction Diffusion Simulator — Turing Bloom",
    "metaDescription": "Paint reaction-diffusion patterns in your browser. Try Gray-Scott presets for spots, stripes and coral, tune feed/kill rates and export PNG.",
    "enabled": true,
    "interactive": true,
    "keywords": "reaction diffusion,gray-scott,turing pattern,turing bloom,morphogenesis,cellular pattern simulation,generative art,coral pattern,mitosis simulation,paint simulation,download png,interactive canvas",
    "seoContent": `## What reaction-diffusion is

Two imaginary chemicals share a grid. One is fed in steadily, the other is removed; wherever they meet, the second converts the first, and both spread outward at different rates. Alan Turing proposed in 1952 that exactly this could explain animal markings — spots, stripes, the whorls on a shell — from chemistry alone, with no blueprint stored anywhere. This is the Gray-Scott form of that idea, running live in your browser.

## The eight presets

Each one is nothing more than a different pair of feed and kill rates:

- Coral — branching growth that keeps thickening.
- Mitosis — blobs that swell and split, endlessly.
- Spots — isolated dots that space themselves evenly.
- Maze — winding corridors of even width.
- Worms — wandering stripes with rounded ends.
- Waves — broad expanding fronts.
- Holes — a filled field pocked with clearings.
- U-Skate — gliding structures that drift across the grid.

Nudge Feed or Kill by a thousandth and one regime melts into another. The narrow band between two patterns is where the strangest results live.

## Painting your own

Click or drag on the canvas to inject the second chemical wherever you touch, then watch a bloom grow out of your own stroke. Clear wipes the field so you can start from nothing but what you paint. Reseed scatters fresh specks from a new seed, and every seed is reproducible — type it back in to grow the same bloom again.

Scale sets the grid resolution (coarser runs faster), Speed sets how many solver steps run per animation frame, and D saves the current frame as a PNG.

## FAQ

### What do the feed and kill rates mean?

Feed is how fast the first chemical is replenished; kill is how fast the second is removed. That single pair of numbers produces the entire range of patterns. The useful territory here runs from about 0.010 to 0.100 for feed and 0.040 to 0.075 for kill.

### Why did my pattern die out or flood the screen?

Some feed and kill combinations are unstable and collapse to an empty or saturated field. Go back to a preset and move the sliders in small steps from there.

### Does it run in my browser?

Yes. The solver runs on your device and nothing is uploaded.`
  },
  {
    "slug": "sand-loom",
    "title": "Sand Loom",
    "description": "A falling-sand sandbox — a little world of powders, liquids, fire and stone that runs on simple per-cell physics. Pick a material and paint it on the canvas; then just watch. Sand piles into slopes, water finds its level and pours off ledges, oil floats, fire climbs anything flammable, and lava freezes into stone the instant it touches water, hissing off steam.\n\nTwelve materials with real interactions: acid eats through solids, plants creep along water, salt dissolves, smoke and steam drift upward and fade. Which material sits on top of which is decided purely by density. Load a demo scene, adjust your brush, and pour a whole ecosystem into being. Runs entirely in your browser — no downloads, no sign-up.",
    "seoTitle": "Falling Sand Game — Sand Loom Physics Sandbox",
    "metaDescription": "Play a falling-sand physics sandbox in your browser. Paint sand, water, fire, lava, oil, acid and plants and watch them react. No download, no sign-up.",
    "enabled": true,
    "interactive": true,
    "keywords": "falling sand game,sand simulation,powder game,physics sandbox,cellular automaton,sandbox game,water sand fire simulation,falling sand online,sand physics,pixel physics",
    "seoContent": `## How to play Sand Loom

Pick a material from the palette, then click or drag on the canvas to paint it. Everything obeys simple physics from there: powders fall and pile up, liquids flow and seek their level, gases rise. Use the brush slider to draw broad strokes or fine detail, Clear to wipe the grid, and Scene to load a ready-made setup to play with.

## The materials and how they react

- Sand and salt are powders that fall and slide into slopes; salt dissolves in water.
- Water, oil, acid and lava are liquids. Oil is lighter than water so it floats; lava is the heaviest of all.
- Fire climbs anything flammable — wood, plant and oil — then burns out into smoke.
- Lava sets flammables alight and freezes into stone the moment it meets water, releasing steam.
- Acid eats through sand, stone, wood and plant. Plants slowly grow along water.

## Things to try

Build a stone bowl, fill it with water, float a layer of oil on top and drop a spark of fire on the oil. Or pour lava onto a pool of water and watch it turn to rock. Set a wooden wall alight and watch the fire spread and smoke rise.

## FAQ

### Is Sand Loom free?

Yes. It runs entirely in your browser with no download and no sign-up.

### Does it save my drawing?

Your material, brush size and settings are saved locally. The grid itself resets when you reload — use the Scene button for ready-made setups.

### Can I play on mobile?

Yes. Drag your finger to paint; the canvas will not scroll the page while you draw.`
  },
  {
    "slug": "lsystem-tree",
    "title": "Fractal Garden",
    "description": "Plants that draw themselves. Each one is an L-system — a tiny rewriting grammar: start from a short seed string, replace every symbol with new symbols a few times over, then read the result as turtle graphics — step forward, turn, branch — and a whole tree falls out of the maths with nobody drawing a single leaf.\n\nGrow seven species, from a Barnsley fractal plant and a bushy weed to the Koch, Dragon and Sierpinski curves. Bend the branch angle, add organic wobble, thicken the trunk and toggle leaf blossoms; the branches are shaded trunk-to-tip and the geometric curves along their length. A text seed makes any plant reproducible, and you can download the frame you like as a PNG. Runs entirely in your browser.",
    "seoTitle": "L-System Fractal Tree Generator — Fractal Garden",
    "metaDescription": "Grow L-system fractal trees and curves from simple rules. Adjust angle, wobble, leaves and seed, then download the result as a PNG.",
    "enabled": true,
    "interactive": true,
    "keywords": "l-system,lindenmayer system,fractal plant,fractal tree generator,generative art,turtle graphics,koch curve,dragon curve,sierpinski,barnsley fern,procedural plants,download png",
    "seoContent": `## How an L-system draws a plant

Start with a short string — the axiom, often just "F". Apply a rewriting rule that replaces every symbol with a longer group of symbols, then apply it again to the result, a handful of times. The string explodes in length. Now read it as turtle graphics: F means step forward drawing a line, + and - mean turn by the branch angle, and the bracket symbols mean save and restore the turtle's position, which is what makes a branch.

That is the whole trick. Nobody places a twig or draws a leaf; the tree is a consequence of one rule applied over and over. Aristid Lindenmayer invented the notation in 1968 to model how plants actually grow.

## The seven species

Four of them branch like plants — Fractal Plant (the fern-like classic), Bushy Weed, Seaweed and Twiggy Tree — and are shaded from dark trunk to bright tip, with optional leaf blossoms at the ends. Three are geometric curves — Koch Curve, Dragon Curve and Sierpinski — coloured along their length instead, since they have no trunk to shade.

## The controls

- Iterations — how many times the rule is applied. Each step multiplies the detail, so one extra iteration is a big jump.
- Angle — how far each turn goes. Small angles give narrow upright trees; wide angles fan them open or fold the curves into new shapes entirely.
- Wobble — random variation on every turn, driven by the seed. Zero is machine-perfect; a little makes the plant look grown rather than printed.
- Thickness — how heavy the trunk starts before tapering toward the tips.

Press L to toggle leaves, space to replay the growth animation, R to reroll the wobble seed, and D to save the frame as a PNG. Type a seed back in to grow the identical plant again.

## FAQ

### What is a Lindenmayer system?

A grammar for growth: a starting string plus rules for rewriting each symbol, applied repeatedly. Interpreting the resulting string as drawing commands is what turns it into a fractal plant or curve.

### Why do the Koch and Dragon curves look nothing like plants?

Their rules contain no branching symbols, so the turtle never saves a position and never forks. The output stays a single continuous line instead of a tree.

### Does it run in my browser?

Yes. The string rewriting and the drawing both happen on your device, and nothing is uploaded.`
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
    "keywords": "hex color game,color guessing game,guess the hex,hex code game,color quiz,rgb guessing game,learn hex colors,color memory game",
    "seoContent": `## How to play

A mystery colour fills the swatch. In Pick mode you choose which hex code produced it from a set of candidates. In Type mode there are no candidates at all — you type a hex code yourself, and your guess is drawn right beside the answer with a closeness score out of 100.

Three difficulties change how cruel the decoys are:

- Easy shows 3 options that sit well apart.
- Medium shows 4, noticeably closer together.
- Hard shows 6, packed so tightly that only a trained eye separates them.

Press a number key to choose that option, or N to jump to the next colour. Skip moves on but breaks your streak.

## Reading a hex code

A hex code is three numbers written in base 16. In #RRGGBB the first pair is Red, the middle is Green and the last is Blue, and each runs from 00 (that light off) to FF (that light at full). So #FF0000 is pure red, #FFFF00 is red plus green — which the eye reads as yellow — and #FF8000 is full red with half green, which is orange. Once that clicks, guessing stops being luck.

## How the score works

Typed guesses are scored on perceptual distance rather than raw numeric difference, so being wrong in a direction the eye barely registers costs you little, while a near-miss climbs fast. Your current streak, best streak and best accuracy carry over between visits.

## FAQ

### How do I get better at guessing hex codes?

Read the swatch channel by channel before you look at the options. Is there more red than blue? Is any channel near 00 or near FF? Pinning down two channels usually eliminates most of the decoys on its own.

### Are my scores saved?

Yes, in your browser. Best streak and best accuracy persist across visits; nothing is uploaded and there is no account. Reset scores clears them.

### What is the difference between Pick and Type mode?

Pick is multiple choice and tests recognition. Type gives you no options at all, so it tests whether you can genuinely name a colour from sight.`
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
