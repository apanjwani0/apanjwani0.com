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
    "slug": "poker-trainer",
    "title": "Poker Trainer",
    "description": "Set any Hold'em spot and get the real numbers: exact equity by full enumeration, the actual outs, and the pot-odds arithmetic laid out so you can check it yourself. Nothing is sampled and nothing is estimated \u2014 every runout is counted.",
    "enabled": true,
    "interactive": true,
    "seoTitle": "Poker Equity Calculator & Odds Trainer \u2014 Exact, Not Sampled",
    "metaDescription": "Exact Texas Hold'em equity by full enumeration, your real outs rather than the rule-of-2-and-4 guess, and whether a call is +EV. Runs in your browser.",
    "keywords": "poker equity calculator, poker odds calculator, texas holdem odds, poker outs calculator, pot odds calculator, poker ev calculator, poker trainer, holdem equity",
    "intro": "Pick two hands and a board, and every number is computed by enumerating every possible runout \u2014 no Monte Carlo, no margin of error. See your exact equity, the real list of outs, and whether calling is profitable at the price you're being offered.",
  },
  {
    "slug": "2048",
    "title": "2048",
    "description": "The classic sliding-tile puzzle, in your browser. Slide the whole board with the arrow keys, WASD or a swipe \u2014 every tile shoves as far as it can, and two equal numbers that collide fuse into one worth double.\n\nEach move drops a new tile, so it's a race to keep merging before the board clogs. Reach a 2048 tile to win, then keep going for a higher score. Play it three ways \u2014 a gentle 3\u00d73, the classic 4\u00d74 or a roomy 5\u00d75 \u2014 each with its own saved game and its own best score. Take back a move with Undo, and everything is saved right in your browser, so a refresh picks up exactly where you left off.",
    "seoTitle": "2048 Game Online \u2014 Free Sliding Tile Puzzle",
    "metaDescription": "Play 2048 online in your browser. Slide and merge numbered tiles, undo a move, choose 3x3, 4x4 or 5x5 boards, and save your best score locally.",
    "enabled": true,
    "interactive": true,
    "keywords": "2048 game,2048 puzzle,sliding tile game,number puzzle,2048 online,play 2048,merge tiles game,2048 clone,browser puzzle game",
  },
  {
    "slug": "quintle",
    "title": "Quintle",
    "description": "A daily five-letter word guessing game. You get six tries to find the hidden word; after each guess the tiles light up \u2014 right letter in the right place, right letter in the wrong place, or not in the word at all \u2014 and you close in from there.\n\nA fresh puzzle drops every day, the same word for everyone, and it picks up right where you left off if you close the tab. Not enough? Switch to Practice for an endless run of random words, or flip on Hard mode, where every clue you uncover has to be reused. Type on your keyboard or tap the on-screen one, watch your win streak and guess distribution build up, and share your result as a spoiler-free emoji grid. Everything is saved in your browser \u2014 no sign-up, nothing uploaded.",
    "seoTitle": "Daily Five-Letter Word Game \u2014 Quintle",
    "metaDescription": "Play a daily five-letter word game with six guesses, hard mode, practice mode, streaks and shareable emoji results. No signup, no upload.",
    "enabled": true,
    "interactive": true,
    "keywords": "word game,word guessing game,five letter word game,daily word puzzle,wordle style game,guess the word,vocabulary game,browser word game,unlimited word game,hard mode word game,quintle",
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
