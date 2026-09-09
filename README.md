# Sudoku — Phase 2

A desktop Sudoku application made with HTML, CSS, and vanilla JavaScript. It runs fully offline with no dependencies, installation, build step, or server.

## Run

1. Open the project directory.
2. Open `index.html` in a modern desktop browser.

Click a cell, use the arrow keys to move, and enter digits with your keyboard or the number pad. Delete, Backspace, and Erase clear editable cells. Given digits are fixed. Incorrect player entries are marked immediately; completing the puzzle stops the timer. Restart resets the current puzzle. New Game loads the development puzzle again.

Turn on **Notes** to toggle candidate digits in empty editable cells. Notes appear in fixed positions in a 3×3 mini-grid. Normal number entry clears the cell's own notes and removes that digit from its row, column, and box peers. Deleting a value does not regenerate notes. Erase also clears all notes in an empty cell.

**Auto Candidates** replaces every empty cell's notes with all digits directly legal against the current board, including player entries. It does not use the stored solution or perform logical solving. Manual notes can contain any digit; only Auto Candidates calculates legality.

**Undo / Redo** restore exact values, notes, and completion status. Each move, its automatic peer removals, and each Auto Candidates operation take one history step. A new gameplay edit after Undo clears Redo. Use the buttons, `Ctrl+Z`, `Ctrl+Y`, or `Ctrl+Shift+Z` (Command equivalents also work). Native form controls retain their shortcuts, and unavailable Undo/Redo shortcuts are not intercepted.

Progress saves automatically and resumes when you reopen the same application location in the same browser profile. Active time includes time in a background tab or with the application closed. Completed time stays frozen. Undo does not rewind elapsed time; undoing completion resumes the clock, and redoing completion freezes it again. Theme, requested difficulty, Notes mode, and selection survive reload. Restart and New Game retain these settings except selection; both reset values, notes, timer, and both history stacks. The Phase 1 immediate button behavior is retained; there are no confirmation dialogs.

Choose Auto, Light, or Dark for the theme. Auto follows operating-system theme changes. The difficulty selector records Easy, Normal, Hard, Expert, or Extreme, but **all selections currently use the same development puzzle**. Puzzle generation and difficulty classification are not implemented.

## Files

```text
index.html          Application layout and accessible controls
styles.css          Desktop layout, board, and light/dark theme variables
js/game.js          Immutable state, central actions, candidate rules, history, validation, timer
js/puzzles.js       Temporary development puzzle provider
js/persistence.js   Versioned localStorage serialization and safe restoration
js/view.js          State-driven board and control rendering
js/app.js           Input events, theme detection, and timer scheduling
tests/index.html    Offline regression-check page
tests/tests.js      Puzzle, action, timer, and state checks
tests/phase2.js     Candidate, exact history, persistence, and corruption checks
tests/run.cjs       Optional dependency-free command-line test runner
tests/browser-check.cjs  Optional local Chrome UI and persistence regression runner
```

Classic scripts are used so opening the HTML file directly works without a server or module loader.

## Architecture

`Sudoku.createGameStore()` owns the single source of truth. Its plain-data state keeps immutable `givens` and `solution` separate from current `values` and per-cell `candidates`. It also holds `selectedCell`, `difficulty`, `status`, numeric `elapsedTime`, theme preference, `notesMode`, `history`, and `future`. Candidates are sorted arrays of unique digits, so state stays JSON-serializable. Puzzle input is copied; published state and nested data are deeply frozen. The DOM contains no authoritative game data.

Input handlers call central actions. `inputDigit` routes keyboard/keypad input through Notes mode; `setCellValue` remains an explicit normal-value action for future callers. `toggleCandidate`, `autoCandidates`, `clearCell`, `undo`, and `redo` share the same reducer boundary as Phase 1 actions. Each accepted action publishes one state transition. Rendering derives highlights, errors, accessible candidate labels, completion, and button availability from state.

History stores complete gameplay snapshots `{ values, candidates, status }`, never snapshots containing history. Candidate arrays can be shared safely because every published snapshot is frozen and edits replace arrays. Undo/Redo restore snapshots directly without recalculating notes. Therefore a manually removed note cannot accidentally return with unrelated peer removals. Settings, selection, and the continuously measured timer are outside gameplay history. No-op actions do not create history or clear Redo. Restart and New Game reset both stacks so another puzzle's moves cannot leak into the current game.

Timer scheduling belongs to the application layer. The store measures elapsed milliseconds using an injectable clock; runtime clock anchors and listeners stay outside serializable state. `captureState()` captures precise elapsed milliseconds even between scheduled ticks, without publishing an extra transition.

## Persistence

`Sudoku.createPersistence()` reads and writes the `sudoku.game` localStorage key with this envelope:

```js
{ schemaVersion: 1, savedAt: /* epoch milliseconds */, state: /* serializable game */ }
```

The saved state includes the puzzle and stored solution needed by Phase 1 error checking, current values, all candidates, both complete history stacks, difficulty, selection, status, elapsed milliseconds, theme preference, and Notes mode. The detected operating-system theme is omitted and detected anew. No DOM objects or runtime clock anchors are persisted.

On load, `validateSavedState()` checks the supplied puzzle, every value, candidate digit and candidate list, protected givens, completion status, settings, elapsed time, and every snapshot in both history stacks. Nested history inside snapshots is rejected. Restored arrays are copied and frozen. Missing optional settings get defaults; missing required gameplay/history data, malformed JSON, incompatible schema versions, or invalid content cause the whole saved game to be ignored and the normal development puzzle to start cleanly.

The app saves after accepted central updates. Timer-only writes are limited to once per elapsed second, with precise captures on `visibilitychange` and `pagehide`. Active restoration adds the nonnegative difference between the saved wall-clock timestamp and the current timestamp to the saved elapsed milliseconds, then establishes a fresh runtime clock anchor. Completed games add no closed time. Background tabs keep counting as in Phase 1.

Storage access or quota errors cannot interrupt play. A visible message reports when progress cannot be saved; no history is silently truncated to fit storage. There is one saved game per application location/browser profile, with no synchronization between simultaneously open tabs (the latest save wins).

Direct-file persistence was verified in Chrome, including closing and reopening the browser. Other browsers can restrict storage for `file:` URLs; the Web Storage API does not standardize that behavior. Private browsing, clearing browser data, or disabling storage can also prevent durable saves. See [MDN's localStorage documentation](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage). Keep the same file location/profile when reopening.

## Temporary puzzle boundary

`Sudoku.getDevelopmentPuzzle(difficulty)` supplies fresh fixture data. `store.actions.startGame({ givens, solution, difficulty })` accepts flat arrays of 81 cells: zero means an empty given, and the solution contains digits 1–9. The boundary checks array contents, a valid completed Sudoku solution, and matching givens. It does not solve puzzles or verify uniqueness.

Phase 3 can replace the fixture provider with a generator that supplies the same data. Input handling and board rendering do not depend on the puzzle's origin.

## Intentionally deferred to Phase 3

Exact and logical solvers, advanced solving techniques, uniqueness verification, procedural generation, difficulty scoring/classification for all five levels, genuinely difficult Extreme puzzles, Hint, and Solve. Hint and Solve remain visible and disabled. All levels still use the same ungraded development fixture. The existing puzzle-provider boundary is unchanged.

## Verification

Open `tests/index.html` directly to run all **38 core checks** without dependencies. If Node is already installed, the same checks can run with:

```text
node tests/run.cjs
```

The original baseline passed 17 core checks and 30 browser checks before changes. All Phase 1 behavior checks remain; the one core assertion and one browser assertion requiring Phase 2 features to stay deferred were updated for the new functionality.

The additional core checks cover candidate input, fixed-state invariants, every peer type, manual deletion, atomic Auto Candidates, sequences A–D, exact multi-step Undo/Redo, branching, immutable snapshots, completion Undo/Redo, persistence of settings and both stacks, timer restoration, missing fields, 29 corrupt-state cases, and denied/full storage.

The browser runner uses installed Chrome and built-in Node facilities only, with a fresh isolated profile under `.tmp/` and all external network access blocked:

```text
node tests/browser-check.cjs
```

It defaults to Chrome's standard Windows installation path; `SUDOKU_CHROME` can specify another Chromium executable. This is an optional development check, not an application dependency. It passed **68 browser checks**, including real keyboard/mouse input, control availability, candidate geometry, all themes, refresh, closing/reopening a tab, a full browser process close/relaunch, persisted Undo/Redo, completion, corrupt storage fallback, denied storage, no JavaScript errors, and no external requests. Screenshots in `.tmp/` were visually checked in light/dark themes and at a compact 1366×768 desktop size.
