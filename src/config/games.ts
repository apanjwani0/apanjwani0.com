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
    "slug": "2048",
    "title": "2048",
    "description": "The classic sliding-tile puzzle, in your browser. Slide the whole board with the arrow keys, WASD or a swipe — every tile shoves as far as it can, and two equal numbers that collide fuse into one worth double.\n\nEach move drops a new tile, so it's a race to keep merging before the board clogs. Reach a 2048 tile to win, then keep going for a higher score. Play it three ways — a gentle 3×3, the classic 4×4 or a roomy 5×5 — each with its own saved game and its own best score. Take back a move with Undo, and everything is saved right in your browser, so a refresh picks up exactly where you left off.",
    "seoTitle": "2048 Game Online — Free Sliding Tile Puzzle",
    "metaDescription": "Play 2048 online in your browser. Slide and merge numbered tiles, undo a move, choose 3x3, 4x4 or 5x5 boards, and save your best score locally.",
    "enabled": true,
    "interactive": true,
    "keywords": "2048 game,2048 puzzle,sliding tile game,number puzzle,2048 online,play 2048,merge tiles game,2048 clone,browser puzzle game",
    "seoContent": "## How to play 2048\n\nUse the arrow keys, WASD or swipe to move every tile on the board. When two tiles with the same number collide, they merge into one tile worth double. After every move, a new tile appears.\n\n## What is different in this version\n\n- Play the classic 4x4 board, a tight 3x3 board or a roomier 5x5 board.\n- Use Undo to take back one move.\n- Keep separate saved games and best scores for each board size.\n- Continue after 2048 if you want a higher score.\n\n## Simple 2048 strategy\n\nKeep your largest tile in one corner, build rows around it, and avoid moving in a direction that pulls the largest tile out of place. Empty spaces matter more than one big merge; if the board fills up, you lose control quickly.\n\n## FAQ\n\n### Is this the original 2048?\n\nNo. This is a browser version inspired by the classic sliding tile puzzle, with extra board sizes and undo.\n\n### Does my score save?\n\nYes. Your current game and best score are saved locally in your browser.\n\n### Can I play on mobile?\n\nYes. Swipe in the direction you want the tiles to move."
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
    "seoContent": "## How Quintle works\n\nGuess the hidden five-letter word in six tries. After each guess, the tiles tell you what changed: correct letter in the right spot, correct letter in the wrong spot, or a letter that is not in the word.\n\n## Modes\n\n- Daily gives everyone the same puzzle for the day.\n- Practice lets you keep playing random words.\n- Hard mode makes you reuse every clue you have already found.\n- Share copies a spoiler-free emoji grid.\n\n## Starting-word tips\n\nStart with a word that uses common vowels and consonants. After the first guess, stop chasing random words and use the colours: lock green letters in place, move yellow letters around, and avoid grey letters unless you are testing a repeated letter.\n\n## FAQ\n\n### Is Quintle a Wordle clone?\n\nIt is a five-letter word guessing game in the same broad style, but it has its own daily puzzle, practice mode, hard mode and local stats.\n\n### Do I need an account?\n\nNo. Streaks and guess history are saved in your browser.\n\n### Can I play more than once a day?\n\nYes. Use Practice mode when the daily puzzle is done."
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
    "slug": "maze-weaver",
    "title": "Maze Weaver",
    "description": "A seeded maze generator and pathfinding visualizer. Weave a perfect maze — every two cells joined by exactly one corridor — then watch a solver hunt the route from start to goal.\n\nBuild it three ways (recursive backtracker, Prim's or Kruskal's) and search it three ways (breadth-first, A*, or depth-first), and compare how differently each one explores. Every maze is fixed by a single seed, so you can reproduce one exactly or reroll for a new one. Tune the size and speed, single-step the animation, click any cell to move the goal, and download the frame as a PNG. Runs entirely in your browser.",
    "seoTitle": "Maze Generator & Solver Visualizer — Maze Weaver",
    "metaDescription": "Generate seeded mazes and watch BFS, A* or DFS solve them. Compare algorithms, move the goal, step the animation and export a PNG.",
    "enabled": true,
    "interactive": true,
    "keywords": "maze generator,maze solver,pathfinding visualizer,breadth first search,a star algorithm,depth first search,recursive backtracker,prim's algorithm,kruskal's algorithm,bfs vs a star,seeded maze,algorithm visualization",
    "seoContent": "## Perfect mazes, built three ways\n\nEvery maze here is perfect: exactly one path joins any two cells, with no loops and no sealed-off pockets. The three generators all produce perfect mazes that look nothing alike.\n\n- Recursive Backtracker carves one long winding corridor, doubling back whenever it hits a dead end. Expect long twisty passages and few junctions.\n- Randomized Prim grows the maze outward from a single cell, always opening a random wall on the frontier. The result is bushier, with many short branches.\n- Randomized Kruskal joins random cells whose regions are not yet connected, so the maze forms everywhere at once and comes out the most uniform.\n\n## Watching the solvers\n\nPick a solver and press Solve to watch it search from the green start to the coral goal. The contrast is the point:\n\n- BFS explores in expanding rings and always returns a shortest path, but visits nearly everything on the way.\n- A* uses distance-to-goal as a hint, so the search leans toward the target and touches far fewer cells for the same shortest path.\n- DFS charges down one corridor until it dead-ends, then backtracks. It often reaches the goal quickly but by a badly roundabout route.\n\nUse Step to advance one move at a time, or click any cell to move the goal and rerun the search against a new target.\n\n## Seeds and export\n\nEach maze comes from a seed. Regenerate with G for a new one, or type a seed back in to rebuild the exact same maze — which is what makes a fair comparison between two solvers possible. Press D to save the current frame as a PNG.\n\nShortcuts: space solves and pauses, G regenerates, S steps, C clears the search overlay, D downloads.\n\n## FAQ\n\n### Which maze solving algorithm is fastest?\n\nA* usually visits the fewest cells here, because it is guided toward the goal, and it still returns a shortest path. BFS also guarantees a shortest path but explores blindly in all directions. DFS can reach the goal in very few steps on a lucky layout, and rarely by a short route.\n\n### Can I compare two algorithms on the same maze?\n\nYes. Keep the seed, switch the solver and press Solve again. Same maze, different search — that is the clearest way to see how the strategies differ.\n\n### Does it run in my browser?\n\nYes. Generation, solving and PNG export all happen on your device. Nothing is uploaded."
  },
  {
    "slug": "type-trial",
    "title": "Type Trial",
    "description": "A fast, distraction-free typing race — now with a daily duel. Every day there's one shared passage, the same for everyone on Earth, and a leaderboard you can join under any name once you finish. Or practice quotes, code, and numbers on your own clock.\n\nEvery character lights up as you go, your speed and accuracy tick live, and a ranked result card lands when you finish. Practice bests stay in your browser; only a daily score you choose to submit is sent, and it's just your name and the numbers.",
    "seoTitle": "Daily Typing Race & Speed Test — Type Trial",
    "metaDescription": "One shared passage per day, a live leaderboard, and practice modes for quotes, code and numbers. Measure WPM and accuracy in a daily typing race.",
    "enabled": true,
    "interactive": true,
    "keywords": "daily typing race,typing leaderboard,typing game,typing race,typing speed test,wpm game,words per minute,typing practice,typing test",
    "seoContent": "## The daily race\n\nEvery UTC day has exactly one passage, and everyone who visits races the same text. Finish a run on the Daily tab and you can submit your words-per-minute and accuracy to that day's leaderboard under any display name — no account, no sign-up. The board resets at midnight UTC when the next passage arrives, so every day is a fresh race.\n\n## What it measures\n\n- WPM, or words per minute, based on standard word length.\n- Accuracy, based on every keystroke you entered — corrected mistakes still count.\n- Your rank on today's shared leaderboard, if you submit a daily run.\n- Local personal bests for the daily, quotes, code and numbers categories.\n\n## How to improve your score\n\nStart by typing cleanly, not quickly. Accuracy usually raises WPM because you spend less time correcting mistakes. Practice numbers and symbols separately if normal quote tests feel easy; they expose weak spots that plain words hide. Then bring the speed back to the daily passage and climb the board.\n\n## FAQ\n\n### Is this like Monkeytype?\n\nMonkeytype is a full typing practice platform. Type Trial is smaller: quick races over quotes, code and numbers, plus one shared daily passage with a leaderboard.\n\n### Are scores uploaded?\n\nPractice runs never leave your browser. A daily score is sent only if you press Submit, and it carries just your chosen display name, WPM, accuracy and time — no account, no tracking, and submissions are validated server-side against the day's passage.\n\n### When does the daily race reset?\n\nAt midnight UTC, everywhere at once — the passage and the leaderboard change together, so the whole world races the same text on the same day.\n\n### What does WPM mean?\n\nWPM means words per minute. It is a rough speed score, not a perfect measure of writing skill."
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
    "seoContent": "## How to play\n\nA mystery colour fills the swatch. In Pick mode you choose which hex code produced it from a set of candidates. In Type mode there are no candidates at all — you type a hex code yourself, and your guess is drawn right beside the answer with a closeness score out of 100.\n\nThree difficulties change how cruel the decoys are:\n\n- Easy shows 3 options that sit well apart.\n- Medium shows 4, noticeably closer together.\n- Hard shows 6, packed so tightly that only a trained eye separates them.\n\nPress a number key to choose that option, or N to jump to the next colour. Skip moves on but breaks your streak.\n\n## Reading a hex code\n\nA hex code is three numbers written in base 16. In #RRGGBB the first pair is Red, the middle is Green and the last is Blue, and each runs from 00 (that light off) to FF (that light at full). So #FF0000 is pure red, #FFFF00 is red plus green — which the eye reads as yellow — and #FF8000 is full red with half green, which is orange. Once that clicks, guessing stops being luck.\n\n## How the score works\n\nTyped guesses are scored on perceptual distance rather than raw numeric difference, so being wrong in a direction the eye barely registers costs you little, while a near-miss climbs fast. Your current streak, best streak and best accuracy carry over between visits.\n\n## FAQ\n\n### How do I get better at guessing hex codes?\n\nRead the swatch channel by channel before you look at the options. Is there more red than blue? Is any channel near 00 or near FF? Pinning down two channels usually eliminates most of the decoys on its own.\n\n### Are my scores saved?\n\nYes, in your browser. Best streak and best accuracy persist across visits; nothing is uploaded and there is no account. Reset scores clears them.\n\n### What is the difference between Pick and Type mode?\n\nPick is multiple choice and tests recognition. Type gives you no options at all, so it tests whether you can genuinely name a colour from sight."
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
