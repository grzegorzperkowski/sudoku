# Sudoku — Phase 3

A desktop Sudoku application made with HTML, CSS, and vanilla JavaScript. Open `index.html` directly in Chrome or another modern desktop browser. Everything runs offline: no dependencies, installation, build step, server, external resources, or network requests. Classic scripts work from `file://`.

When the game is hosted over HTTPS (or `localhost` during development), its service worker stores the complete app shell after the first successful load. Later visits work without an internet connection. The `file://` version remains directly playable without a service worker.

## Playing

Click a cell, move with the arrow keys, and enter digits using the keyboard or keypad. Delete, Backspace, and Erase clear editable cells. Givens are protected. Incorrect entries are checked against the verified solution; correct completion stops the timer and shows the existing completion message.

Use **Save to file** to download a shareable JSON snapshot of the current game, including entries, notes, settings, elapsed time, and Undo/Redo history. **Load from file** validates a snapshot before replacing the current game; invalid files leave the open game untouched. Imported games resume from the exported elapsed time, rather than adding time spent in transit.

Choose **Easy, Normal, Hard, Expert, or Extreme**, then **New Game**. Each new puzzle is generated dynamically, checked for exactly one solution, and solved entirely by the logical engine before it is accepted. Changing the selector chooses the next game's level; the label above the board continues to show the current puzzle's actual rating. New Game asks before abandoning unfinished progress. Restart retains its immediate Phase 2 behavior and resets the current puzzle.

Generation displays **Generating puzzle...** and its board animation for at least 1.5 seconds on every difficulty, disabling conflicting game controls and keyboard edits during the transition. Appearance controls remain usable. Extreme boards are constructed immediately from a verified seed using randomized Sudoku-preserving row, column, band, stack, and transpose transformations. The 15-second limit remains as a guard; it should not be reached during normal generation. The generator never returns an easier fallback: a failure leaves the old game intact and offers New Game again. Refresh during generation restores that saved game, or starts fresh generation if there was no previous game.

### Notes and history

**Notes** toggles manual candidates in empty editable cells, shown in fixed positions in a 3×3 mini-grid. Normal number entry clears the cell's notes and removes that digit from row, column, and box peers. Deleting a value never adds candidates back. Erase also clears all notes in an empty cell.

**Auto Candidates** replaces each empty cell's notes with all directly legal digits against the current board, including incorrect player entries. It does not consult the solution or run logical techniques. Manual notes may contain any digit.

**Undo / Redo** restore exact values, notes, and completion status. Each entry and all its peer removals, each Hint, each confirmed Solve, and each Auto Candidates operation are one atomic history step. New gameplay after Undo clears Redo; no-ops do not. Use the buttons, `Ctrl+Z`, `Ctrl+Y`, or `Ctrl+Shift+Z` (Command equivalents work). Native form controls retain their shortcuts. Settings, selection, and elapsed time stay outside gameplay history, as in Phase 2.

**Hint** fills exactly one correct digit without a textual technique explanation. It ignores manual notes and incorrect entries while finding the next logical placement; internal eliminations are not copied to player notes. If that position is logically stuck, Hint reveals one digit from the already verified solution. This assistance fallback is separate from puzzle rating: generated puzzles are never accepted using search to finish the logical solve. A Hint may correct one wrong cell. It keeps selection and Notes mode unchanged and uses the same value-entry/candidate-removal action path as ordinary input. Undo restores every affected note; Redo reproduces the Hint.

**Solve** always asks for confirmation before revealing the verified solution. Confirmation creates one central state action, fills the board, clears all candidate notes, marks completion, and stops the timer. Cancellation changes nothing. Solve supports exact Undo/Redo, including resuming/stopping the timer when completion changes.

Active time includes background-tab and closed time. Completed time stays frozen. Undo does not rewind the clock. Restart and New Game reset notes, both history stacks, selection, and time; theme, Notes mode, and the requested difficulty remain settings. Auto, Light, and Dark themes retain Phase 2 behavior.

## Architecture

`Sudoku.createGameStore()` remains the single source of truth. Immutable `givens` and `solution` are separate from player `values` and sorted candidate arrays. Published states and snapshots are deeply frozen. Input handlers dispatch central actions; rendering derives the board, highlights, errors, control availability, and completion from state. No solver or action edits DOM cells directly.

History still stores complete `{ values, candidates, status }` snapshots with no recursive history. Automatic peer removals are part of the same snapshot transition as an entry or Hint. The timer's injectable clock, anchors, listeners, and scheduler remain outside persisted gameplay. `captureState()` includes precise elapsed milliseconds between scheduled ticks.

| File | Responsibility |
| --- | --- |
| `index.html`, `styles.css` | Existing offline layout, keyboard help, themes, controls |
| `js/board.js` | Shared rows, columns, boxes, cell units, peers, validation, candidate masks |
| `js/exact.js` | Exact solution search, capped solution counting, randomized completed grids |
| `js/logical.js` | Independent technique finders, candidate state, logical loop, ordered trace and effort metrics |
| `js/difficulty.js` | Explicit five-level rules and analysis |
| `js/generator.js` | Random clue carving, uniqueness checks, rating acceptance, cooperative asynchronous driver |
| `js/game.js` | Existing immutable store, central actions, candidate semantics, history, state validation, clock |
| `js/persistence.js` | Versioned localStorage serialization and safe restoration |
| `js/view.js`, `js/app.js` | State-driven rendering, input, confirmations, generation scheduling, theme detection |
| `js/puzzles.js` | Original fixture retained only for regression tests; not loaded by the application |

### Exact solver and validation

`Sudoku.solveExact(board, { limit: 2 })` uses minimum-remaining-values backtracking with row/column/box bitmasks. It returns `valid`, `status`, `count`, a first `solution`, `stoppedAtLimit`, and diagnostic `nodes`. Duplicate or malformed input is `invalid`; consistent givens with no completion are `unsolvable`. `countSolutions(board)` stops at two, which is sufficient to reject ambiguity. Counts are capped, not a claim about the total number of solutions beyond the limit. A limit of one finds a solution but cannot certify uniqueness.

Randomized candidate traversal creates completed grids. Search is also used for uniqueness and internal validation. Search depth, node counts, and generation attempts do **not** contribute to difficulty.

The store's existing puzzle-input boundary now additionally verifies uniqueness. It still checks 81-cell arrays, digit ranges, Sudoku constraints, and matching givens before replacing the current game. Rated input is independently analyzed again. Rejected puzzle data cannot replace a running game.

### Logical solver

`Sudoku.solveLogical(board)` calculates its own candidates and applies deterministic deductions until solved, invalid, or stuck. It never invokes the exact solver and never reads player notes or the stored solution. After each placement/elimination it starts again at the beginning of the technique order below. Units, cells, digits, and combinations have fixed traversal orders.

Each step records a technique ID/name, affected cells, placements and/or explicit candidate eliminations, weight/rank, and evidence such as source units, subset digits, fish covers, wing cells, or coloring links. The result includes the final board/candidates, status, ordered steps, usage counts, hardest technique/rank, score, intermediate and advanced step counts, and elimination count. `createLogicalPosition`, `findLogicalStep`, and `applyLogicalStep` allow direct technique testing and trace replay. Technique inspection does not mutate a position.

| Technique, in search order | Weight | Group / rank |
| --- | ---: | --- |
| Naked Single | 1 | Basic / 1 |
| Hidden Single | 2 | Basic / 1 |
| Pointing Pair / Triple | 8 | Intermediate / 2 |
| Box-Line Reduction / Claiming | 8 | Intermediate / 2 |
| Naked Pair | 12 | Intermediate / 2 |
| Hidden Pair | 16 | Intermediate / 2 |
| Naked Triple | 24 | Intermediate / 3 |
| Hidden Triple | 28 | Intermediate / 3 |
| X-Wing | 60 | Advanced / 4 |
| XY-Wing | 80 | Advanced / 4 |
| Swordfish | 110 | Advanced / 5 |
| Simple Coloring | 100 | Advanced / 5 |

Subsets confine N digits to N cells, or N cells to N digits. Pointing and Claiming use box/line intersections. X-Wing and Swordfish support both row and column orientations; Swordfish includes staggered two/three-position bases. XY-Wing uses a bivalue pivot and two wings, eliminating their common third digit from cells seeing both wings. Simple Coloring builds strong-link components for one digit and implements both **wrap** (same-color peers make that color false) and **trap** (an outside candidate sees both colors). These are deterministic deductions, not trials of a guessed digit.

## Difficulty classification

The score is explicit in `logical.js`:

```text
score = sum of technique weights for all productive steps
        + 2 × number of explicit candidate eliminations
```

Placement peer cleanup is routine propagation and does not add elimination points. Empty cells normally produce one placement step each. An intermediate step has rank 2 or 3; an advanced step has rank 4 or 5. Technique weights distinguish reasoning complexity; cumulative work and elimination counts distinguish demanding sequences from isolated deductions.

`difficulty.js` contains the acceptance rules. All conditions in a row must hold, and **every accepted puzzle must solve completely with the logical engine**.

| Level | Score | Required logical profile |
| --- | --- | --- |
| Easy | 0–65 | Singles only; no intermediate or advanced technique |
| Normal | 80–155 | At least one intermediate step, limited to pairs and box/line interactions; no triples or advanced steps |
| Hard | 180–330 | At least four intermediate steps; triples allowed; no advanced steps |
| Expert | 350–480 | At least one advanced step and eight explicit eliminations |
| Extreme | At least 700 | At least four advanced steps, 25 explicit eliminations, and 65 total steps |

Expert and Extreme are additionally rerun with **all advanced techniques disabled**; they must remain unsolved under those restricted techniques. This establishes that advanced reasoning is necessary within the implemented technique set. No particular advanced technique is mandatory for every Extreme.

There are intentional gaps between bands. Puzzles in a gap, outside a profile, or logically stuck are rejected rather than rounded up or relabeled to satisfy a request. Extreme's score floor is over 45% above Expert's absolute ceiling, in addition to its much stronger workload requirements. A high intermediate-only score can never qualify as Extreme.

Clue count does not contribute to the score or classification. The generator uses clue counts only to avoid premature analysis during carving. Hard, Expert, and Extreme frequently have the same number of clues, with substantially different logical paths. Ratings describe this engine's deterministic path; they do not claim that no human could discover a shorter path using a technique outside the implemented set.

### Calibration

An exploratory survey analyzed 1,500 randomly carved minimal puzzles. Many low-clue puzzles needed only singles, while others remained logically stuck. This guided the separate profiles, acceptance gaps, and additional Extreme search.

The final rules were then checked with **10 independently seeded generations per level** (seeds 3100–3109), all unique and completely logically solvable:

| Level | Observed score | Mean score | Intermediate steps | Advanced steps | Explicit eliminations | Clues |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Easy | 36 | 36.0 | 0 | 0 | 0 | 45 |
| Normal | 80–138 | 98.2 | 1–5 | 0 | 3–12 | 23–35 |
| Hard | 184–259 | 209.1 | 8–13 | 0 | 17–29 | 22–26 |
| Expert | 351–398 | 372.2 | 1–8 | 2–3 | 11–25 | 22–26 |
| Extreme | 742 | 742.0 | 11 | 5 | 41 | 24 |

Extreme averages **2.0× Expert's score** and requires 73 total logical steps. Its path includes XY-Wing and Simple Coloring in addition to intermediate work. The full calibration can be reproduced with `node tests/calibrate.cjs`; it prints ten samples per level as JSON. Extreme construction is normally near-instant; exact wall-clock times still depend on hardware and browser scheduling. The 15-second UI guard remains in place, and there is no easier fallback.

## Generation algorithm

1. For Easy through Expert, create a fresh randomized valid completed grid using exact search.
2. Shuffle clue-removal order. Tentatively remove each clue and restore it unless solution counting proves there is exactly one solution.
3. Run the full deterministic logical solver and acceptance rules. Reject stuck puzzles and incorrect profiles.
4. For Extreme, transform one independently verified Extreme seed by randomly reordering row bands and rows within each band, column stacks and columns within each stack, and optionally transposing the board. These 3,359,232 transformations provide millions of positional variations while preserving its unique solution and the engine's Extreme technique path; digit relabeling is excluded because it changes the engine's deterministic tie-breaking.
5. Before returning a puzzle, independently validate its givens, completed solution, uniqueness, logical completion, and requested class again.

No puzzle database supplies the Easy-through-Expert gameplay. Extreme uses one verified seed pattern with 3,359,232 randomized positional transformations, providing millions of layout variations while retaining its verified solution and difficulty. `seededRandom(seed)` provides repeatability for tests; production uses `Math.random`. The synchronous and asynchronous APIs drive the same search iterator. The browser driver targets 12 ms work slices and yields with `setTimeout`; an individual exact/logical operation can exceed that budget. It uses no worker, module-loader, or server assumptions. The optional API `signal` supports cancellation; optional `maxAttempts` and asynchronous `maxElapsedMilliseconds` budgets throw if exhausted. The app applies a 15-second `maxElapsedMilliseconds` budget only to interactive Extreme generation.

## Persistence and compatibility

The `sudoku.game` key retains the Phase 2 envelope:

```js
{ schemaVersion: 1, savedAt: /* epoch milliseconds */, state: /* serializable game */ }
```

There is **no schema-version bump**. `puzzleDifficulty` is an optional backward-compatible field for the current puzzle's verified rating, separate from `difficulty`, the requested next-game setting. Legacy saves without it restore with a neutral Sudoku label; they are not mislabeled as rated puzzles. The transient `generating` flag and detected system theme are omitted from storage and reset on load. Large logical traces and generation diagnostics are not persisted.

Validation retains all Phase 2 checks on current values, candidate lists, givens, completion status, settings, elapsed time, and both history stacks. Nested history is still rejected. It additionally verifies the saved puzzle's uniqueness and, when a rating is present, recomputes that rating. Valid Phase 2 saves migrate without losing values, notes, history, settings, or elapsed time. Malformed JSON, incompatible versions, invalid solutions, ambiguous puzzles, incorrect ratings, or corrupt snapshots cause safe fresh generation.

Accepted central updates save automatically; timer-only writes are limited to once per elapsed second. `visibilitychange` and `pagehide` capture precise elapsed time. Active restoration adds the nonnegative difference from `savedAt`; completed games add no closed time. Restored arrays are copied and frozen.

Storage denial or quota errors leave gameplay usable and show the existing save-failure message. History is never silently truncated. There is one saved game per browser/location, with no synchronization across simultaneously open tabs. Direct-file persistence is verified in Chrome, including full browser closure/relaunch. Other browsers may restrict `file:` storage; private browsing, clearing browser data, or moving the application may prevent restoration.

## Verification

Before Phase 3 changes, all **38 core checks** and **68 Chrome checks** passed. The original assertions remain, except obsolete expectations that Hint/Solve were disabled or New Game returned the fixture. Coordinate-specific browser regressions deliberately load a valid legacy save; separate checks run actual generated games.

Final result: **101 / 101 automated checks passed** (69 core and technique/integration checks plus 32 generation/calibration checks), and **100 / 100 Chrome checks passed**.

Open `tests/index.html` directly to run the complete offline suite. With an already installed Node runtime, run:

```text
node tests/run.cjs
node tests/browser-check.cjs
node tests/calibrate.cjs
```

There is no npm dependency or installation step. The core runner covers exact solving/counting, invalid versus unsolvable boards, early exit at two solutions, every logical technique, both fish orientations, Coloring wrap/trap, negative patterns, deterministic inspection, replayable traces, and preservation of known solutions across 100 seeded candidate positions. It also covers Hint/Solve history, errors, completion/timer behavior, generation guards, backward-compatible persistence, corruption, and all Phase 1/2 candidate semantics.

The generator suite creates **five puzzles per level**, independently verifies every solution and rating, replays every deduction against the correct solution, checks advanced reasoning requirements, tests variation, and asserts separated aggregate difficulty. It also tests event-loop yielding, cancellation, repeatable randomness, and explicit failure without fallback. Full tests take several minutes because they perform genuine Extreme generation.

The Chrome runner uses the existing installed browser and built-in Node facilities, with a fresh isolated profile under `.tmp/`, hidden headless windows, and external network access blocked. `SUDOKU_CHROME` can specify another installed Chromium executable. It passed **100 browser checks**, covering real input, selection/highlighting, notes/peer removals, history shortcuts, themes, refresh/relaunch, all five generated levels, generation lockout/responsiveness, Hint → Undo → reload → Redo, Solve cancellation/confirmation, manual generated completion, corrupt/denied storage, no JavaScript errors, and no external requests. Light/dark candidate views, generation, and Extreme screenshots were visually checked, including the compact 1366×768 desktop layout.

`tests/index.html?core` skips the long generation sample when used inside the browser regression runner, which already exercises generation through New Game. The default test page and command-line runner include it.

## Practical limits

Difficulty is calibrated against the implemented logical solver, not a universal human rating standard. Some unique puzzles need techniques this engine does not implement; they are rejected for rated generation. Extreme uses a randomized transformation of its verified seed and normally generates immediately; the 15-second interactive limit protects against unexpected runtime failures. Browser scheduling can extend the wait slightly because an individual exact/logical operation cannot be interrupted. These limits do not relax uniqueness, logical solvability, or the Extreme acceptance criteria.
