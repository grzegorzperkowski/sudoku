# Sudoku — Phase 1

A desktop Sudoku application made with HTML, CSS, and vanilla JavaScript. It runs fully offline with no dependencies, installation, build step, or server.

## Run

1. Open the project directory.
2. Open `index.html` in a modern desktop browser.

Click a cell, use the arrow keys to move, and enter digits with your keyboard or the number pad. Delete, Backspace, and Erase clear editable cells. Given digits are fixed. Incorrect player entries are marked immediately; completing the puzzle stops the timer. Restart resets the current puzzle. New Game loads the development puzzle again.

Choose Auto, Light, or Dark for the theme. Auto follows operating-system theme changes. The difficulty selector records Easy, Normal, Hard, Expert, or Extreme, but **all selections currently use the same development puzzle**. Puzzle generation and difficulty classification are not implemented.

## Files

```text
index.html          Application layout and accessible controls
styles.css          Desktop layout, board, and light/dark theme variables
js/game.js          Serializable state, central actions, timer, and derived checks
js/puzzles.js       Temporary development puzzle provider
js/view.js          State-driven board and control rendering
js/app.js           Input events, theme detection, and timer scheduling
tests/index.html    Offline regression-check page
tests/tests.js      Puzzle, action, timer, and state checks
```

Classic scripts are used so opening the HTML file directly works without a server or module loader.

## Architecture

`Sudoku.createGameStore()` owns the single source of truth. Its plain-data state keeps `givens`, `solution`, and current `values` separate, with per-cell `candidates`, `selectedCell`, `difficulty`, `status`, numeric `elapsedTime`, theme preference, and empty `history`/`future` placeholders. Puzzle input is copied; snapshots and their nested data are immutable. The DOM contains no authoritative game data.

Input handlers call central actions such as `selectCell`, `setCellValue`, `clearCell`, `restartGame`, and `startGame`. Each accepted action publishes one state transition; rendering derives highlights, incorrect entries, completion, and controls from that state. A replacement is one action. This boundary lets Phase 2 capture exact before/after snapshots, including candidate arrays, so undo can restore automatically removed candidates precisely.

Timer scheduling belongs to the application layer. The store measures elapsed milliseconds using a clock that can be injected for testing; runtime clock bookkeeping stays outside serializable state. Theme preference is separate from the detected system theme. Phase 2 can add serialization and timer restoration without using DOM text as data.

## Temporary puzzle boundary

`Sudoku.getDevelopmentPuzzle(difficulty)` supplies fresh fixture data. `store.actions.startGame({ givens, solution, difficulty })` accepts flat arrays of 81 cells: zero means an empty given, and the solution contains digits 1–9. The boundary checks array contents, a valid completed Sudoku solution, and matching givens. It does not solve puzzles or verify uniqueness.

Phase 3 can replace the fixture provider with a generator that supplies the same data. Input handling and board rendering do not depend on the puzzle's origin.

## Intentionally deferred

- **Phase 2:** Notes mode and candidate editing, automatic candidate removal, Auto Candidates, atomic Undo/Redo, and localStorage persistence of game state, timer, and preference. Candidate arrays and history placeholders are present but unused.
- **Phase 3:** Exact and logical solvers, uniqueness verification, procedural generation, logical difficulty classification for all five levels, genuinely difficult Extreme puzzles, Hint, and Solve.

Undo, Redo, Notes, Auto Candidates, Hint, and Solve are visible and genuinely disabled. Refreshing the page starts a fresh session.

## Verification

Open `tests/index.html` directly to run dependency-free regression checks for the puzzle fixture, validation, immutable state, protected givens, entry/replacement/erase, errors, navigation boundaries, atomic action notifications, completion, timer reset/freeze, themes, difficulty, and JSON serialization.

For a manual UI check, use mouse and keyboard selection, inspect row/column/box and matching-digit highlights, enter/correct/erase an incorrect digit, try editing a given, switch all three themes, and check that Restart resets the board and timer. The test page checks engine behavior; visual appearance and actual operating-system theme changes should also be checked in the browser.
