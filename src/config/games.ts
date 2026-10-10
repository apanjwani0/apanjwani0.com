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
    "description": "A free online Texas Hold'em poker trainer and exact equity calculator for Hold'em strategy and quantitative trading interview prep (Jane Street, Susquehanna SIG, Citadel). Computes exact runout enumeration, pot odds arithmetic, and real expected value (+EV) calculations with zero sign-up or paywalls.\n\nSet any Hold'em spot across pre-flop, flop, turn, or river and get the real numbers: exact equity by full enumeration, the actual outs, and the pot-odds arithmetic laid out so you can check it yourself. Nothing is sampled and nothing is estimated — every single runout combination is counted.",
    "enabled": true,
    "interactive": true,
    "seoTitle": "Free Online Poker Trainer & Hold'em Odds Calculator — Exact & Unsampled",
    "metaDescription": "100% free online Texas Hold'em poker trainer and exact odds calculator. Practice pot odds, expected value (+EV), and full runout enumeration for poker and quant trading interviews. Runs in your browser with zero sign-up.",
    "keywords": "free poker trainer, free online poker trainer, poker trainer online, texas holdem poker trainer, gto poker trainer free, poker odds calculator free, quant interview poker prep, jane street poker interview, sig poker interview, pot odds calculator, poker equity calculator, poker expected value drill, exact holdem odds, holdem equity, poker math trainer",
    "intro": "Play a spot without seeing their cards, the way a real table works — then see every number behind the decision, computed by counting every possible runout.",
    "features": [
      "Exact runout enumeration (up to 1,712,304 combinations)",
      "Interactive GTO drill with instant decision feedback",
      "Pot odds & break-even % arithmetic breakdown",
      "Expected value (+EV) call vs fold calculation",
      "Hand range heatmaps and out analysis",
      "100% free client-side execution with zero ads or tracking"
    ],
    "seoContent": "## Free Online Texas Hold'em Poker Trainer & Exact Odds Calculator\n\nMaster Texas Hold'em probability, pot odds, and expected value (+EV) decision-making with mathematically exact calculations. Built for competitive poker players and candidates preparing for quantitative trading and finance interviews.\n\n### Why Quantitative Trading Firms Use Poker in Interviews\n\nProprietary trading firms and market makers — including Jane Street, Susquehanna International Group (SIG), Citadel Securities, Akuna Capital, and Five Rings — famously test candidates with poker scenarios during quantitative interviews.\n\nInterviewers use Hold'em because it models real trading under incomplete information:\n- **Bayesian Updating**: Recalculating your hand equity as new information (the flop, turn, and river) is revealed.\n- **Pot Odds & Risk-Reward Ratio**: Comparing the cost of a call against the pot size to determine the mathematical break-even threshold.\n- **Expected Value (+EV) Calculation**: Making positive expectation decisions regardless of short-term variance.\n- **Range-vs-Range Thinking**: Modeling your opponent as a distribution of possible holdings rather than guessing a single hand.\n\n### Full Runout Enumeration vs. Monte Carlo Sampling\n\nMost free online poker tools use Monte Carlo approximation, simulating 10,000 to 50,000 random hands. While fast, Monte Carlo produces sampling noise that fluctuates by 1% to 2% between runs.\n\nThis Poker Trainer calculates **exact equity by exhaustive enumeration**:\n- On the flop, it evaluates all 990 possible turn and river card combinations.\n- On the turn, it calculates all 44 remaining river cards.\n- On pre-flop match-ups, it computes up to 1,712,304 five-card board runouts.\n\nEvery percentage, out count, and pot odds calculation is deterministic, transparent, and provably exact.\n\n### Frequently Asked Questions\n\n### Is this poker trainer completely free to use?\nYes. This online poker trainer is 100% free with no subscriptions, no accounts, no software installation, and zero ads. It runs entirely in your browser using high-performance client-side TypeScript.\n\n### Why do quantitative trading firms use poker in interviews?\nProprietary trading firms like SIG, Jane Street, and Citadel test candidates with poker scenarios because it measures expected value (EV) calculations, pot odds arithmetic, Bayes' theorem, and disciplined risk-taking under incomplete information.\n\n### What is the difference between exact runout enumeration and Monte Carlo sampling?\nMonte Carlo tools estimate equity by simulating a sample of random boards, producing 1% to 2% noise. Exact full runout enumeration evaluates all remaining card combinations in the deck to deliver mathematically exact equity values down to the hundredth of a percent.\n\n### Can I use this poker trainer for quant trading interview prep?\nYes. The Solve Any Spot and GTO Drill modes are specifically designed for quant interview practice at firms like Jane Street and SIG, helping you drill rapid probability, pot odds, and expected value calculations under time pressure.\n\n### How does the solver compute exact equity?\nUnlike commercial simulators that sample random runs, our engine evaluates every remaining card combination in the deck to derive mathematically exact equity percentages down to the hundredth of a percent.\n\n### What game variants and betting rounds are supported?\nThe trainer supports No-Limit Texas Hold'em across all four betting streets: Pre-Flop, Flop, Turn, and River."
  },
  {
    "slug": "2048",
    "title": "2048",
    "description": "Play 2048 online in your browser with weighted ceramic tiles, multi-step undo, and 3x3, 4x4, and 5x5 boards. 100% free, zero ads, zero trackers, and saves high scores locally.\n\nSlide the whole board with the arrow keys, WASD or a swipe — every tile shoves as far as it can, and two equal numbers that collide fuse into one worth double. Each move drops a new tile, so it's a race to keep merging before the board clogs. Reach a 2048 tile to win, then keep going for a higher score.",
    "seoTitle": "2048 Online Game — Free Tactile Sliding Tile Puzzle (3x3, 4x4, 5x5)",
    "metaDescription": "Play 2048 online in your browser with tactile ceramic tiles, multi-step undo, and 3x3, 4x4 or 5x5 boards. 100% free, zero ads, zero tracking, and saves high scores locally.",
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
    "seoContent": "## Play 2048 Online: Free Tactile Sliding Tile Puzzle\n\nExperience the classic 2048 sliding-tile puzzle re-engineered for smooth performance, tactile physical materials, and zero distractions.\n\n### How 2048 Works\n\nSlide tiles across the grid using your arrow keys, WASD, or swipe gestures on touchscreens.\n- All tiles slide as far as possible in the chosen direction.\n- Two tiles with identical numbers collide and merge into a single tile of double the value (e.g. 2 + 2 = 4, 1024 + 1024 = 2048).\n- After each valid move, a new tile (a 2 nine times out of ten, or a 4) spawns in an empty cell.\n- The goal is to create a tile with the value **2048** before the board fills up, with the option to continue playing for higher scores.\n\n### Essential Strategy: The Corner Pinning Technique\n\nTo achieve high scores and reach 2048, follow these mathematical principles:\n1. **Anchor Your Highest Tile in One Corner**: Choose a corner (such as bottom-right) and never move your highest tile out of that position.\n2. **Maintain a Value Gradient**: Organize tiles in decreasing monotonic order leading away from your anchor corner (e.g., 2048 → 1024 → 512 → 256).\n3. **Restrict Your Movement Directions**: Limit your moves to two primary directions (e.g., Down and Right). Only swipe Up or Left when absolutely forced by board geometry.\n\n### Frequently Asked Questions\n\n### How do I play 2048 online?\nUse your keyboard's arrow keys or WASD (or swipe on your mobile device) to slide tiles. When matching numbers touch, they merge. Keep merging to build a 2048 tile!\n\n### Does this version of 2048 have an undo feature?\nYes! This version includes a 16-move undo history buffer. Click the Undo button or press 'U' on your keyboard to take back accidental mis-swipes.\n\n### Are there advertisements or in-app purchases?\nNo. This version is completely free, open, and ad-free. It runs client-side in your browser with zero trackers and zero popups."
  },
  {
    "slug": "quintle",
    "title": "Bytele",
    "description": "The free daily engineering word puzzle — Wordle built for software engineers, systems programmers, and tech interview prep. Guess the hidden 5-letter computer science or infrastructure keyword in six tries (MUTEX, SHARD, CACHE, ARENA, INODE), then review the post-game architecture gotcha card.\n\nAfter each game, unlock an instant Interview Gotcha card breaking down the architecture concept, time complexity, or common production gotchas. Play the daily global challenge or unlimited practice.",
    "seoTitle": "Bytele — Daily Engineering & Tech Interview Wordle for Developers",
    "metaDescription": "The free daily engineering Wordle for developers and tech interview prep. Guess 5-letter CS, systems, and architecture keywords (MUTEX, SHARD, ARENA) in six tries, and review the post-game interview gotcha card.",
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
    "seoContent": "## Bytele: The Daily Engineering Wordle for Software Engineers\n\nBytele is the daily 5-letter word puzzle created specifically for software engineers, systems architects, and programmers preparing for technical interviews.\n\n### Wordle Built for Technical & System Design Interview Prep\n\nStandard word games rely on general dictionary vocabulary. Bytele transforms the daily puzzle habit into active technical interview revision by centering every puzzle on core computer science, distributed systems, and low-level engineering concepts:\n- **Memory Models & Allocators**: Concepts like `ARENA` bump allocation, stack vs heap layout, and slab allocators.\n- **Concurrency & Synchronization**: Critical primitives like `MUTEX`, race conditions, deadlocks, and async execution.\n- **Distributed Systems & Storage**: Core patterns like `SHARD` partitioning, `CACHE` invalidation, `PROXY` routing, and `INODE` filesystems.\n- **Networking & Transport**: Low-level framing, byte `OCTET` alignment, and cryptographic `TOKEN` verification.\n\n### Post-Game Interview Gotcha & Concept Breakdown\n\nEvery completed game — whether won or lost — unlocks a comprehensive **Interview Gotcha & Architecture Takeaway** card.\n\nThese cards explain:\n1. **The System Design Tradeoff**: Why and when the pattern is used in production infrastructure.\n2. **The Interview Gotcha**: Common architectural traps, edge cases, or complexity questions asked in senior engineering interviews at top tech companies.\n3. **Real-World Examples**: How systems like Linux, Redis, PostgreSQL, and modern browser engines implement the concept.\n\n### Frequently Asked Questions\n\n### What is Bytele?\nBytele is a free, daily word puzzle for software engineers. Players have six guesses to identify a hidden 5-letter computer science, infrastructure, or software architecture keyword.\n\n### How does Bytele help prepare for tech interviews?\nBytele reinforces fundamental systems engineering and computer science vocabulary tested in coding and system design interviews. Each solved word provides an architecture breakdown and common production gotchas.\n\n### Is Bytele free and does it require an account?\nBytele is completely free, requires no account or registration, and collects no personal data. Game state, win streaks, and guess statistics are saved securely in your browser's local storage.\n\n### Can I play more than one puzzle per day?\nYes. Bytele features a shared global Daily mode (one deterministic puzzle per UTC day) and an unlimited Practice mode for continuous engineering interview prep."
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
    "enabled": true,
    "keywords": "cricket game,miniclip cricket,browser cricket game,2d cricket,flash cricket"
  }
]
