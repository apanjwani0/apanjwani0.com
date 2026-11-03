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
  features?: string[]
}

export const games: Game[] = [
  {
    "slug": "deep-shore",
    "title": "Deep Shore",
    "description": "A Mandelbrot and Julia set explorer that keeps going. Scroll or click to dive into the boundary, drag to travel along it, and watch the detail keep arriving — the edge of the set never smooths out, at any magnification.\n\nArm Julia peek and the inset draws the Julia set belonging to whatever point is under your cursor, live; click and you are inside it. Six guided stops take you straight to the famous neighbourhoods. Every view encodes into the address bar with as many digits as the zoom actually needs, so the link you send lands on the same rock — and the status line tells you honestly when 64-bit arithmetic has run out of room, instead of letting the picture quietly turn to mush.\n\nMark the places you stop and it will record the descent between them as an animated GIF: the zoom climbs geometrically and the pan is weighted so it happens while the screen is still cheap, which is what makes the destination arrive rather than whip past. Preview it on the canvas first, then save it — or share the dive itself as a link and let someone else fall down the same hole.",
    "enabled": true,
    "interactive": true,
    "seoTitle": "Mandelbrot & Julia Set Explorer — Deep Zoom In Your Browser",
    "metaDescription": "Zoom into the Mandelbrot set until double precision runs out, preview the Julia set under your cursor, and share the exact spot you found as a link.",
    "keywords": "mandelbrot set explorer,julia set generator,fractal zoom,mandelbrot zoom,fractal explorer online,mandelbrot generator,julia set online,fractal viewer,escape time fractal,deep zoom fractal,mandelbrot zoom animation,fractal zoom gif maker",
    "intro": "Scroll to dive into the Mandelbrot set, drag to travel along its coastline, and arm Julia peek to see the Julia set for the point under your cursor. Mark the places you stop and record the whole descent as an animated GIF. Any view you find encodes into the URL, so you can send someone the exact spot — or the whole dive.",
  },
  {
    "slug": "poker-trainer",
    "title": "Poker Trainer",
    "description": "A free Texas Hold'em poker trainer. Play seven kinds of spots: single raised pots, three-bet pots, all-in shoves, multiway pots, river bets, and a raise against your own bet. Each one comes with the story of the hand, so you know the position, the stacks and the pot.\n\nYou never see their cards. Their range narrows with the size of their bet, from a third of the pot up to a 2.5× overbet, and your equity against it is counted exactly: every runout and every pair of hands, never sampled. After you answer, every number is named and worked out. The drill grades immediate expected value, not a solved strategy.",
    "enabled": true,
    "interactive": true,
    "seoTitle": "Free Poker Trainer: Exact Equity, Ranges and Pot Odds",
    "metaDescription": "Free Hold'em trainer: seven situations, multiway pots and bets from a third of the pot to an overbet, with exact equity and every number explained.",
    "keywords": "free poker trainer, free online poker trainer, poker trainer online, texas holdem poker trainer, poker odds calculator free, quant interview poker prep, jane street poker interview, sig poker interview, pot odds calculator, poker equity calculator, poker expected value drill, exact holdem odds, holdem equity, poker math trainer",
    "intro": "Play a spot without seeing their cards, the way a real table works — then see every number behind the decision, computed by counting every possible runout.",
    "features": [
      "Seven situations: single raised pots, three-bet pots, all-in shoves, multiway pots, river bets and a raise against your own bet",
      "Opponent ranges that narrow with bet size, from a third of the pot to a 2.5× overbet",
      "Multiway pots on the turn and river with exact three-way equity",
      "A fold, call or raise verdict from a stated raise model, with every number named and worked out",
      "Exact runout enumeration, never sampled, plus a Run the numbers tab for any hand or range",
      "Share a spot by link and see your accuracy by situation, kept only in your browser",
      "100% free client-side execution with zero ads or tracking"
    ],
    "seoContent": ""
  },
  {
    "slug": "2048",
    "title": "2048",
    "description": "Play 2048 online in your browser with weighted ceramic tiles, multi-step undo, and 3x3, 4x4, and 5x5 boards. 100% free, zero ads, zero trackers, and saves high scores locally.\n\nSlide the whole board with the arrow keys, WASD or a swipe — every tile shoves as far as it can, and two equal numbers that collide fuse into one worth double. Each move drops a new tile, so it's a race to keep merging before the board clogs. Reach a 2048 tile to win, then keep going for a higher score.",
    "seoTitle": "2048 Online — Sliding Tile Puzzle on 3x3, 4x4 or 5x5 Boards",
    "metaDescription": "Play 2048 in your browser on a 3x3, 4x4 or 5x5 board, with ceramic tiles and multi-step undo. No ads and no tracking; best scores stay on your device.",
    "enabled": true,
    "interactive": true,
    "keywords": "2048 online, free 2048 game, play 2048, 2048 sliding puzzle, 2048 with undo, 2048 5x5, 2048 3x3, tactile 2048, clean 2048 game, ad free 2048, sliding tile puzzle",
    "features": [
      "Tactile weighted ceramic tile rendering with specular highlights",
      "Multi-step Undo (up to 16 moves)",
      "3 board sizes: 3x3 compact, 4x4 classic, 5x5 expansive",
      "Independent best-score persistence per board size",
      "Touch swipe and keyboard (WASD / Arrow keys) support",
      "100% free client-side execution with zero ads or tracking"
    ],
    "seoContent": ""
  },
  {
    "slug": "quintle",
    "title": "Bytele",
    "description": "The free daily engineering word puzzle — Wordle built for software engineers, systems programmers, and tech interview prep. Guess the hidden 5-letter computer science or infrastructure keyword in six tries (MUTEX, SHARD, CACHE, ARENA, INODE), then review the post-game architecture gotcha card.\n\nAfter each game, unlock an instant Interview Gotcha card breaking down the architecture concept, time complexity, or common production gotchas. Play the daily global challenge or unlimited practice.",
    "seoTitle": "Bytele — Daily Engineering Wordle for Developers",
    "metaDescription": "A daily Wordle for developers: guess a 5-letter CS or systems word (MUTEX, SHARD) in six tries, then read a card on the interview gotcha behind it.",
    "enabled": true,
    "interactive": true,
    "keywords": "bytele, wordle for engineers, developer wordle, tech interview wordle, cs wordle, coding wordle, system design wordle, computer science word game, engineering daily puzzle, software engineer interview prep, free dev games, dev wordle, systems engineering puzzle",
    "features": [
      "Curated dictionary of 5-letter CS and systems keywords",
      "End-of-game Interview Gotcha & Architecture Takeaway card",
      "Daily global puzzle and unlimited practice modes",
      "Tactile mechanical keycap interface with zero ads",
      "Hard mode for hint-retention discipline",
      "100% client-side privacy with local streak saving"
    ],
    "seoContent": ""
  },
  {
    "slug": "maze-weaver",
    "title": "Maze Weaver",
    "description": "A seeded maze generator and pathfinding visualizer. Weave a perfect maze \u2014 every two cells joined by exactly one corridor \u2014 then watch a solver hunt the route from start to goal.\n\nBuild it three ways (recursive backtracker, Prim's or Kruskal's) and search it three ways (breadth-first, A*, or depth-first), and compare how differently each one explores. Every maze is fixed by a single seed, so you can reproduce one exactly or reroll for a new one. Tune the size and speed, single-step the animation, click any cell to move the goal, and download the frame as a PNG. Runs entirely in your browser.",
    "seoTitle": "Maze Generator & Solver Visualizer \u2014 Maze Weaver",
    "metaDescription": "Generate seeded mazes and watch BFS, A* or DFS solve them. Compare algorithms, move the goal, step the animation and export a PNG.",
    "enabled": true,
    "interactive": true,
    "keywords": "maze generator,maze solver,pathfinding visualizer,breadth first search,a star algorithm,depth first search,recursive backtracker,prim's algorithm,kruskal's algorithm,bfs vs a star,seeded maze,algorithm visualization",
  },
  {
    "slug": "type-trial",
    "title": "Type Trial",
    "description": "A fast, distraction-free typing race \u2014 now with a daily duel. Every day there's one shared passage, the same for everyone on Earth, and a leaderboard you can join under any name once you finish. Or practice quotes, code, and numbers on your own clock.\n\nEvery character lights up as you go, your speed and accuracy tick live, and a ranked result card lands when you finish. Practice bests stay in your browser; only a daily score you choose to submit is sent, and it's just your name and the numbers.",
    "seoTitle": "Daily Typing Race & Speed Test \u2014 Type Trial",
    "metaDescription": "One shared passage per day, a live leaderboard, and practice modes for quotes, code and numbers. Measure WPM and accuracy in a daily typing race.",
    "enabled": true,
    "interactive": true,
    "keywords": "daily typing race,typing leaderboard,typing game,typing race,typing speed test,wpm game,words per minute,typing practice,typing test",
  },
  {
    "slug": "hue-hunt",
    "title": "Hue Hunt",
    "description": "A hex colour guessing game with a daily. Every UTC day brings five colours \u2014 the same five for everyone on Earth \u2014 with one guess at each, a score out of 500, a shared leaderboard you can join by name, and a spoiler-free grid you can copy and compare.\n\nNot enough? Play on endlessly: pick the matching code from a lineup at three difficulties, or type your own guess and be scored on true perceptual closeness, drawn right beside the answer. Day streaks and best scores save in your browser \u2014 no account, and the only thing that ever leaves it is a daily run you choose to post.",
    "seoTitle": "Daily Hex Color Game \u2014 Hue Hunt",
    "metaDescription": "Five shared colours every day, one guess each, scored out of 500 with a daily leaderboard and a grid to share. Endless practice modes too. No signup.",
    "enabled": true,
    "interactive": true,
    "keywords": "daily color game,hex color game,color guessing game,guess the hex,hex code game,color quiz,rgb guessing game,learn hex colors,color memory game,daily color challenge",
  },
  {
    "slug": "flash-cricket",
    "title": "Flash Cricket",
    "description": "A 2D browser cricket game \u2014 swing your bat and hit the ball into the scoring zones.\n\nA hobby build. I grew up playing Miniclip-style cricket games like this one and can't find them anywhere anymore \u2014 so why not make my own? Writing it in C++.",
    "seoTitle": "Browser Cricket Game \u2014 Flash Cricket",
    "metaDescription": "A work-in-progress 2D browser cricket game inspired by old Flash cricket games, with batting, scoring zones and a simple hobby build story.",
    "enabled": false,
    "keywords": "cricket game,miniclip cricket,browser cricket game,2d cricket,flash cricket"
  }
]
