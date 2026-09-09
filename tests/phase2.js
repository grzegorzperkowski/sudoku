(function () {
  "use strict";
  const { test, assert, equal, sameData, throws, newGame } = globalThis.SudokuTests;
  const Sudoku = globalThis.Sudoku;
  const logical = state => ({ values: state.values, candidates: state.candidates, status: state.status });
  function note(store, index, ...digits) {
    store.actions.selectCell(index);
    digits.forEach(store.actions.toggleCandidate);
  }
  function place(store, index, digit) {
    store.actions.selectCell(index);
    store.actions.setCellValue(digit);
  }
  function storageHarness() {
    let raw = null, time = 100000;
    const persistence = Sudoku.createPersistence({
      getStorage: () => ({ getItem: key => { equal(key, Sudoku.STORAGE_KEY); return raw; }, setItem: (key, value) => { equal(key, Sudoku.STORAGE_KEY); raw = value; } }),
      now: () => time
    });
    return { persistence, raw: () => raw, setRaw: value => { raw = value; }, advance: ms => { time += ms; } };
  }

  test("Notes input toggles digits 1–9 with both additions and removals", () => {
    const { store, emptyCell } = newGame();
    store.actions.selectCell(emptyCell);
    store.actions.toggleNotesMode();
    for (let digit = 9; digit >= 1; digit--) store.actions.inputDigit(digit);
    sameData(store.getState().candidates[emptyCell], [1,2,3,4,5,6,7,8,9]);
    equal(store.getState().values[emptyCell], 0);
    for (let digit = 1; digit <= 9; digit++) store.actions.inputDigit(digit);
    sameData(store.getState().candidates[emptyCell], []);
    equal(store.getState().history.length, 18);
  });

  test("Candidates reject invalid digits, missing selection, givens, and filled cells", () => {
    const { store, emptyCell, givenCell } = newGame();
    const initial = store.getState();
    store.actions.toggleCandidate(1);
    equal(store.getState(), initial);
    store.actions.selectCell(givenCell);
    let before = store.getState();
    store.actions.toggleCandidate(1);
    equal(store.getState(), before);
    store.actions.selectCell(emptyCell);
    before = store.getState();
    [0, 10, -1, 1.5, NaN, "1", null].forEach(store.actions.toggleCandidate);
    equal(store.getState(), before);
    store.actions.setCellValue(4);
    store.actions.toggleNotesMode();
    before = store.getState();
    store.actions.inputDigit(2);
    equal(store.getState(), before);
  });

  test("Normal value entry clears local candidates; Undo restores them", () => {
    const { store, emptyCell } = newGame();
    note(store, emptyCell, 2, 4, 7);
    const before = logical(store.getState());
    store.actions.setCellValue(4);
    sameData(store.getState().candidates[emptyCell], []);
    store.actions.undo();
    sameData(logical(store.getState()), before);
  });

  test("Sequence A: one entry removes row, column, box, and overlapping peers atomically and restores exact notes", () => {
    const { store } = newGame();
    // Enter at R1C3. 6 is row-only, 29 column-only, 10 box-only, 11 column+box.
    [6,29,10,11,3,40].forEach(index => note(store, index, 2, 7));
    note(store, 3, 7); // This peer's 7 was deliberately removed by the player.
    store.actions.selectCell(2);
    const before = logical(store.getState());
    const historyLength = store.getState().history.length;
    let notifications = 0;
    const stop = store.subscribe(() => { notifications++; });
    store.actions.setCellValue(7);
    equal(notifications, 1);
    equal(store.getState().history.length, historyLength + 1);
    [6,29,10,11,3].forEach(index => sameData(store.getState().candidates[index], [2]));
    sameData(store.getState().candidates[40], [2,7], "Non-peer notes must survive");
    const after = logical(store.getState());
    store.actions.undo();
    sameData(logical(store.getState()), before);
    assert(!store.getState().candidates[3].includes(7), "Manual removal must survive Undo");
    store.actions.redo();
    sameData(logical(store.getState()), after);
    stop();
  });

  test("Manual deletion never regenerates notes and itself supports exact Undo/Redo", () => {
    const { store } = newGame();
    note(store, 3, 7);
    place(store, 2, 7);
    const placed = logical(store.getState());
    store.actions.clearCell();
    equal(store.getState().values[2], 0);
    sameData(store.getState().candidates[3], []);
    const deleted = logical(store.getState());
    store.actions.undo(); sameData(logical(store.getState()), placed);
    store.actions.redo(); sameData(logical(store.getState()), deleted);
  });

  test("Erase clears all local notes in one step without changing peers", () => {
    const { store } = newGame();
    note(store, 3, 1, 2);
    note(store, 2, 4, 7);
    const before = logical(store.getState());
    const length = store.getState().history.length;
    store.actions.clearCell();
    sameData(store.getState().candidates[2], []);
    sameData(store.getState().candidates[3], [1,2]);
    equal(store.getState().history.length, length + 1);
    store.actions.undo(); sameData(logical(store.getState()), before);
  });

  test("Auto Candidates uses current row/column/box values, replaces manual notes, and is one history action", () => {
    const { store } = newGame();
    note(store, 2, 9);
    place(store, 3, 1); // Include an incorrect player value in direct legality.
    const before = logical(store.getState());
    const historyLength = store.getState().history.length;
    let transitions = 0;
    const stop = store.subscribe(() => { transitions++; });
    store.actions.autoCandidates();
    equal(transitions, 1);
    equal(store.getState().history.length, historyLength + 1);
    const state = store.getState();
    sameData(state.candidates[2], [2,4]);
    state.values.forEach((value, index) => {
      const row = Math.floor(index / 9), col = index % 9;
      const occupied = [];
      for (let offset = 0; offset < 9; offset++) {
        occupied.push(state.values[row * 9 + offset], state.values[offset * 9 + col]);
        occupied.push(state.values[(Math.floor(row / 3) * 3 + Math.floor(offset / 3)) * 9 + Math.floor(col / 3) * 3 + offset % 3]);
      }
      const expected = value ? [] : [1,2,3,4,5,6,7,8,9].filter(digit => !occupied.includes(digit));
      sameData(state.candidates[index], expected, `Direct candidates at ${index}`);
    });
    store.actions.autoCandidates();
    equal(store.getState(), state, "Identical recalculation is a no-op");
    store.actions.undo(); sameData(logical(store.getState()), before);
    store.actions.redo(); sameData(logical(store.getState()), logical(state));
    stop();
  });

  test("Sequence B: Auto Candidates, manual removal, entry, multi-step Undo and Redo preserve every intermediate board", () => {
    const { store } = newGame();
    const states = [logical(store.getState())];
    store.actions.autoCandidates(); states.push(logical(store.getState()));
    note(store, 2, 4); states.push(logical(store.getState()));
    place(store, 10, 7); states.push(logical(store.getState()));
    assert(!store.getState().candidates[11].includes(7));
    for (let index = states.length - 2; index >= 0; index--) {
      store.actions.undo(); sameData(logical(store.getState()), states[index], `Undo intermediate ${index}`);
    }
    for (let index = 1; index < states.length; index++) {
      store.actions.redo(); sameData(logical(store.getState()), states[index], `Redo intermediate ${index}`);
    }
  });

  test("Sequence C: new gameplay after Undo discards the Redo branch", () => {
    const { store } = newGame();
    place(store, 2, 4); place(store, 3, 6);
    store.actions.undo();
    equal(store.getState().future.length, 1);
    note(store, 3, 2);
    equal(store.getState().future.length, 0);
    const before = store.getState(); store.actions.redo(); equal(store.getState(), before);
    equal(store.getState().values[2], 4); equal(store.getState().values[3], 0);
  });

  test("Settings, selection, ticks, and no-ops do not enter history or clear Redo", () => {
    const { store, advance } = newGame();
    place(store, 2, 4); store.actions.undo();
    store.actions.selectCell(3); store.actions.setTheme("dark"); store.actions.setDifficulty("Hard");
    store.actions.toggleNotesMode(); advance(1234); store.actions.tick();
    store.actions.toggleCandidate(0); store.actions.clearCell();
    equal(store.getState().history.length, 0); equal(store.getState().future.length, 1);
    store.actions.redo();
    equal(store.getState().theme, "dark"); equal(store.getState().notesMode, true);
    equal(store.getState().difficulty, "Hard"); equal(store.getState().selectedCell, 3);
    equal(store.getState().elapsedTime, 1234);
  });

  test("Frozen history has no recursive history and never mutates original puzzle or earlier candidate snapshots", () => {
    const { store, puzzle } = newGame();
    const original = JSON.stringify(puzzle);
    note(store, 2, 1, 4); store.actions.autoCandidates();
    const before = store.getState(); const serialized = JSON.stringify(before);
    throws(() => before.history[1].candidates[2].push(9));
    throws(() => before.history[0].values[2] = 4);
    before.history.forEach(snapshot => sameData(Object.keys(snapshot).sort(), ["candidates", "status", "values"]));
    place(store, 2, 4); store.actions.undo(); store.actions.redo();
    equal(JSON.stringify(before), serialized); equal(JSON.stringify(puzzle), original);
    sameData(store.getState().givens, puzzle.givens); sameData(store.getState().solution, puzzle.solution);
  });

  test("Restart and New Game discard values, candidates, and both history stacks", () => {
    const { store, puzzle, advance } = newGame();
    store.actions.setTheme("dark"); store.actions.autoCandidates(); place(store, 2, 4); store.actions.undo();
    advance(5000); store.actions.restartGame();
    sameData(store.getState().values, puzzle.givens); sameData(store.getState().givens, puzzle.givens);
    equal(store.getState().history.length, 0); equal(store.getState().future.length, 0);
    assert(store.getState().candidates.every(digits => digits.length === 0)); equal(store.getState().elapsedTime, 0);
    store.actions.autoCandidates(); place(store, 2, 4); store.actions.undo();
    const givens = puzzle.solution.slice(); givens[0] = 0;
    store.actions.startGame({ givens, solution: puzzle.solution, difficulty: "Easy" });
    sameData(store.getState().values, givens); equal(store.getState().theme, "dark");
    equal(store.getState().history.length, 0); equal(store.getState().future.length, 0);
    const started = store.getState(); store.actions.undo(); store.actions.redo(); equal(store.getState(), started);
  });

  test("Undo completion reopens play and resumes time; Redo completes and freezes time again", () => {
    const { store, puzzle, advance } = newGame();
    const givens = puzzle.solution.slice(); givens[0] = 0;
    store.actions.startGame({ ...puzzle, givens });
    advance(1200); place(store, 0, puzzle.solution[0]);
    equal(store.getState().status, "completed"); equal(store.getState().elapsedTime, 1200);
    const complete = store.getState(); store.actions.autoCandidates(); store.actions.toggleCandidate(1); equal(store.getState(), complete);
    advance(8000); store.actions.undo(); equal(store.getState().status, "active");
    advance(400); store.actions.tick(); equal(store.getState().elapsedTime, 1600);
    store.actions.redo(); equal(store.getState().status, "completed");
    advance(5000); store.actions.tick(); equal(store.getState().elapsedTime, 1600);
  });

  test("Sequence D: saved board, candidates, settings, Undo and Redo restore exactly and play continues", () => {
    const { store, advance } = newGame("Expert"); const harness = storageHarness();
    note(store, 2, 1, 4); place(store, 3, 6); store.actions.autoCandidates(); note(store, 2, 4);
    place(store, 10, 7); store.actions.undo(); store.actions.undo();
    store.actions.setTheme("dark"); store.actions.toggleNotesMode(); advance(12345);
    const captured = store.captureState();
    assert(harness.persistence.save(captured));
    const envelope = JSON.parse(harness.raw()); equal(envelope.schemaVersion, Sudoku.SCHEMA_VERSION);
    assert(!Object.hasOwn(envelope.state, "systemTheme"));
    const restored = Sudoku.createGameStore({ initialState: harness.persistence.load(), now: () => 0 });
    sameData(restored.getState(), captured);
    for (let index = 0; index < 2; index++) {
      store.actions.redo(); restored.actions.redo(); sameData(logical(restored.getState()), logical(store.getState()));
    }
    for (let index = 0; index < 5; index++) {
      store.actions.undo(); restored.actions.undo(); sameData(logical(restored.getState()), logical(store.getState()));
    }
    note(restored, 2, 9); equal(restored.getState().future.length, 0);
    assert(restored.getState().candidates[2].includes(9));
  });

  test("Persistence captures sub-tick time, counts closed active time, and resumes from a fresh clock origin", () => {
    const { store, advance } = newGame(); const harness = storageHarness();
    advance(12345); harness.persistence.save(store.captureState());
    harness.advance(6500);
    let clock = 10;
    const restored = Sudoku.createGameStore({ initialState: harness.persistence.load(), now: () => clock });
    equal(restored.getState().elapsedTime, 18845);
    clock += 1111; restored.actions.tick(); equal(restored.getState().elapsedTime, 19956);
    const before = restored.getState(); restored.captureState(); equal(restored.getState(), before);
  });

  test("Completed game saves freeze time across closure and retain undoable completion", () => {
    const { store, puzzle, advance } = newGame(); const harness = storageHarness();
    const givens = puzzle.solution.slice(); givens[0] = 0;
    store.actions.startGame({ ...puzzle, givens }); advance(2345); place(store, 0, puzzle.solution[0]);
    harness.persistence.save(store.captureState()); harness.advance(1000000);
    const restored = Sudoku.createGameStore({ initialState: harness.persistence.load() });
    equal(restored.getState().elapsedTime, 2345); equal(restored.getState().status, "completed");
    restored.actions.undo(); equal(restored.getState().status, "active"); equal(restored.getState().values[0], 0);
  });

  test("Missing or malformed storage and incompatible schema safely return no saved game", () => {
    const harness = storageHarness(); equal(harness.persistence.load(), null);
    ["", "{", "null", "[]", "{}", '{"schemaVersion":999}', '{"schemaVersion":1,"savedAt":1,"state":{}}'].forEach(raw => {
      harness.setRaw(raw); equal(harness.persistence.load(), null, raw);
    });
  });

  test("Corrupt current data or either history stack rejects the entire saved game", () => {
    const { store } = newGame(); const harness = storageHarness();
    store.actions.autoCandidates(); place(store, 2, 4); store.actions.undo();
    harness.persistence.save(store.captureState()); const valid = harness.raw();
    const mutations = [
      e => delete e.state.values, e => delete e.state.candidates, e => delete e.state.history, e => delete e.state.future,
      e => e.state.values[0] = 0, e => e.state.solution[0] = 1, e => e.state.givens[0] = 1,
      e => e.state.candidates[0] = [1], e => e.state.candidates[2] = [1,1], e => e.state.candidates[2] = [10],
      e => e.state.candidates[2] = ["2"], e => e.state.candidates.pop(), e => e.state.values[2] = 1.5,
      e => e.state.elapsedTime = -1, e => e.state.elapsedTime = "1", e => e.state.status = "completed",
      e => e.state.history[0].values[0] = 0, e => e.state.future[0].candidates[2] = [4],
      e => e.state.future[0].history = [], e => e.state.history[0].status = "completed",
      e => e.state.history = {}, e => e.state.future = [null], e => e.state.history = [null],
      e => e.state.selectedCell = 81, e => e.state.theme = "blue", e => e.state.notesMode = "yes",
      e => e.state.difficulty = "Impossible", e => e.savedAt = -1, e => delete e.savedAt
    ];
    mutations.forEach((mutate, index) => {
      const envelope = JSON.parse(valid); mutate(envelope); harness.setRaw(JSON.stringify(envelope));
      equal(harness.persistence.load(), null, `Corruption ${index}`);
    });
  });

  test("Optional missing settings get safe defaults; restored data is copied and deeply frozen", () => {
    const { store } = newGame(); store.actions.autoCandidates();
    const saved = JSON.parse(JSON.stringify(store.getState()));
    delete saved.theme; delete saved.selectedCell; delete saved.notesMode; delete saved.difficulty;
    const restored = Sudoku.validateSavedState(saved);
    equal(restored.theme, "auto"); equal(restored.selectedCell, null); equal(restored.notesMode, false); equal(restored.difficulty, "Normal");
    const before = JSON.stringify(restored);
    saved.givens[0] = 0; saved.values[0] = 0; saved.candidates[2].push(9); saved.history[0].values[0] = 0;
    equal(JSON.stringify(restored), before);
    throws(() => restored.history[0].candidates[2].push(1));
  });

  test("Storage access and quota failures never throw or disturb an in-memory game", () => {
    const { store } = newGame(); note(store, 2, 4); const before = store.getState();
    const denied = Sudoku.createPersistence({ getStorage: () => { throw new Error("SecurityError"); } });
    equal(denied.load(), null); equal(denied.save(before), false);
    const quota = Sudoku.createPersistence({ getStorage: () => ({ getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); } }) });
    equal(quota.save(before), false); equal(store.getState(), before);
    store.actions.undo(); sameData(store.getState().candidates[2], []);
  });

  test("Backward wall-clock changes cannot produce negative elapsed time", () => {
    const { store, advance } = newGame(); const harness = storageHarness();
    advance(4567); harness.persistence.save(store.captureState()); harness.advance(-1000);
    equal(harness.persistence.load().elapsedTime, 4567);
  });

  globalThis.renderSudokuTestResults();
}());
