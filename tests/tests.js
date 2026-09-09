/* Open tests/index.html directly. No libraries, server, or installation required. */
(function () {
  "use strict";

  const results = [];
  const Sudoku = globalThis.Sudoku;

  function assert(condition, message) {
    if (!condition) throw new Error(message || "Expected condition to be true.");
  }

  function equal(actual, expected, message) {
    assert(Object.is(actual, expected), `${message || "Values differ"}: expected ${expected}, received ${actual}.`);
  }

  function sameData(actual, expected, message) {
    assert(JSON.stringify(actual) === JSON.stringify(expected), message || "Data does not match.");
  }

  function throws(callback, message) {
    let rejected = false;
    try { callback(); } catch (error) { rejected = true; }
    assert(rejected, message || "Invalid input must be rejected.");
  }

  function test(name, callback) {
    try {
      callback();
      results.push({ name, passed: true });
    } catch (error) {
      results.push({ name, passed: false, error: error.stack || error.message });
    }
  }

  function newGame(difficulty = "Normal") {
    let time = 1000;
    const store = Sudoku.createGameStore({ now: () => time });
    const puzzle = Sudoku.getDevelopmentPuzzle(difficulty);
    store.actions.startGame(puzzle);
    return {
      store,
      puzzle,
      advance: (milliseconds) => { time += milliseconds; },
      emptyCell: puzzle.givens.findIndex((value) => value === 0),
      givenCell: puzzle.givens.findIndex((value) => value !== 0)
    };
  }

  test("The development fixture contains a valid complete Sudoku solution and matching givens", () => {
    const { givens, solution } = Sudoku.getDevelopmentPuzzle();
    equal(givens.length, 81);
    equal(solution.length, 81);
    assert(givens.some((value) => value === 0), "Fixture must contain editable cells.");
    assert(givens.some((value) => value !== 0), "Fixture must contain given cells.");
    const expected = "123456789";
    const sorted = (values) => values.slice().sort().join("");
    for (let index = 0; index < 9; index += 1) {
      equal(sorted(solution.slice(index * 9, index * 9 + 9)), expected, `Row ${index + 1}`);
      equal(sorted(Array.from({ length: 9 }, (_, row) => solution[row * 9 + index])), expected, `Column ${index + 1}`);
      const firstRow = Math.floor(index / 3) * 3;
      const firstColumn = (index % 3) * 3;
      const box = Array.from({ length: 9 }, (_, offset) => solution[(firstRow + Math.floor(offset / 3)) * 9 + firstColumn + offset % 3]);
      equal(sorted(box), expected, `Box ${index + 1}`);
    }
    givens.forEach((value, index) => {
      assert(Number.isInteger(value) && value >= 0 && value <= 9, "Givens must be digits or zero.");
      assert(value === 0 || value === solution[index], `Given ${index} must match the solution.`);
    });
  });

  test("Fixture calls provide independent data and retain the requested difficulty", () => {
    const first = Sudoku.getDevelopmentPuzzle("Extreme");
    const second = Sudoku.getDevelopmentPuzzle("Easy");
    equal(first.difficulty, "Extreme");
    equal(second.difficulty, "Easy");
    assert(first.givens !== second.givens && first.solution !== second.solution, "Fixture arrays must be fresh.");
    sameData(first.givens, second.givens, "Phase 1 must use the same fixture at every difficulty.");
  });

  test("Starting a game copies puzzle data and keeps immutable snapshots separate from current values", () => {
    const { store, puzzle, emptyCell, givenCell } = newGame();
    const original = store.getState();
    assert(original.givens !== puzzle.givens && original.solution !== puzzle.solution, "External arrays must be copied.");
    assert(original.values !== original.givens && original.values !== original.solution, "Player values must be a separate array.");
    sameData(original.values, original.givens);
    equal(original.status, "active");
    equal(original.elapsedTime, 0);
    equal(original.selectedCell, null);
    const givenValue = original.givens[givenCell];
    const solutionValue = original.solution[emptyCell];
    puzzle.givens[givenCell] = 0;
    puzzle.solution[emptyCell] = 0;
    equal(store.getState().givens[givenCell], givenValue, "External edits cannot change givens");
    equal(store.getState().solution[emptyCell], solutionValue, "External edits cannot change the solution");
    const serialized = JSON.stringify(original);
    try { original.values[emptyCell] = 9; } catch (error) { /* Frozen snapshots reject writes in strict mode. */ }
    try { original.candidates[emptyCell].push(2); } catch (error) { /* Nested state must be protected too. */ }
    equal(JSON.stringify(original), serialized, "A caller cannot mutate the snapshot");
    store.actions.selectCell(emptyCell);
    store.actions.setCellValue(solutionValue);
    equal(original.values[emptyCell], 0, "Earlier snapshots must stay unchanged");
    equal(store.getState().values[emptyCell], solutionValue);
  });

  test("Invalid puzzle input is rejected without replacing a running game", () => {
    const { store, puzzle, emptyCell } = newGame();
    const before = store.getState();
    const invalidInputs = [
      null,
      { ...puzzle, givens: puzzle.givens.slice(1) },
      { ...puzzle, solution: puzzle.solution.slice(1) },
      { ...puzzle, givens: puzzle.givens.map((value, index) => index === emptyCell ? 10 : value) },
      { ...puzzle, givens: puzzle.givens.map((value, index) => index === emptyCell ? 1.5 : value) },
      { ...puzzle, givens: puzzle.givens.map((value, index) => index === emptyCell ? (puzzle.solution[index] % 9) + 1 : value) },
      { ...puzzle, solution: puzzle.solution.map((value, index) => index === 0 ? 0 : value) },
      { ...puzzle, solution: puzzle.solution.map((value, index) => index === 0 ? puzzle.solution[1] : value) },
      { ...puzzle, difficulty: "Impossible" }
    ];
    invalidInputs.forEach((input) => {
      throws(() => store.actions.startGame(input));
      equal(store.getState(), before, "Failed starts must leave the previous state intact");
    });
  });

  test("Givens can be selected and navigated but never edited or erased", () => {
    const { store, givenCell } = newGame();
    store.actions.selectCell(givenCell);
    const selected = store.getState();
    equal(selected.selectedCell, givenCell);
    store.actions.setCellValue((selected.values[givenCell] % 9) + 1);
    equal(store.getState(), selected, "Entering a value on a given is a no-op");
    store.actions.clearCell();
    equal(store.getState(), selected, "Erasing a given is a no-op");
    store.actions.moveSelection(givenCell < 72 ? 1 : -1, 0);
    equal(store.getState().selectedCell, givenCell + (givenCell < 72 ? 9 : -9));
  });

  test("Entering, replacing, correcting, and erasing a player value update derived errors", () => {
    const { store, emptyCell } = newGame();
    store.actions.selectCell(emptyCell);
    const correct = store.getState().solution[emptyCell];
    const wrong = (correct % 9) + 1;
    store.actions.setCellValue(wrong);
    equal(store.getState().values[emptyCell], wrong);
    assert(Sudoku.isCellIncorrect(store.getState(), emptyCell), "Wrong entries must be recognized immediately.");
    store.actions.setCellValue(correct);
    equal(store.getState().values[emptyCell], correct);
    assert(!Sudoku.isCellIncorrect(store.getState(), emptyCell), "Correcting must remove the error.");
    store.actions.setCellValue(wrong);
    store.actions.clearCell();
    equal(store.getState().values[emptyCell], 0);
    assert(!Sudoku.isCellIncorrect(store.getState(), emptyCell), "Erasing must remove the error.");
  });

  test("Missing selection, repeated input, and invalid ordinary actions are no-ops", () => {
    const { store, emptyCell } = newGame();
    const initial = store.getState();
    store.actions.setCellValue(3);
    store.actions.clearCell();
    store.actions.selectCell(-1);
    store.actions.selectCell(81);
    store.actions.selectCell(1.5);
    equal(store.getState(), initial);
    store.actions.selectCell(emptyCell);
    const selected = store.getState();
    [0, 10, -1, 2.5, NaN, "5", null].forEach((value) => store.actions.setCellValue(value));
    store.actions.clearCell();
    equal(store.getState(), selected);
    store.actions.setCellValue(3);
    const entered = store.getState();
    store.actions.setCellValue(3);
    equal(store.getState(), entered);
  });

  test("Arrow navigation moves one cell and stops at each grid edge", () => {
    const { store } = newGame();
    store.actions.selectCell(0);
    store.actions.moveSelection(-1, 0);
    store.actions.moveSelection(0, -1);
    equal(store.getState().selectedCell, 0);
    store.actions.moveSelection(0, 1);
    equal(store.getState().selectedCell, 1);
    store.actions.moveSelection(1, 0);
    equal(store.getState().selectedCell, 10);
    store.actions.selectCell(8);
    store.actions.moveSelection(0, 1);
    equal(store.getState().selectedCell, 8, "Right edge must not wrap to the next row");
    store.actions.selectCell(72);
    store.actions.moveSelection(0, -1);
    equal(store.getState().selectedCell, 72, "Left edge must not wrap to the previous row");
    store.actions.selectCell(80);
    store.actions.moveSelection(1, 0);
    store.actions.moveSelection(0, 1);
    equal(store.getState().selectedCell, 80);
  });

  test("A value replacement emits one atomic transition and no-op input emits none", () => {
    const { store, emptyCell } = newGame();
    store.actions.selectCell(emptyCell);
    store.actions.setCellValue(1);
    const transitions = [];
    const unsubscribe = store.subscribe((next, previous, action) => transitions.push({ next, previous, action }));
    store.actions.setCellValue(2);
    equal(transitions.length, 1, "Replacement must be a single transaction");
    equal(transitions[0].previous.values[emptyCell], 1);
    equal(transitions[0].next.values[emptyCell], 2);
    assert(transitions[0].action, "Transition metadata supports future history integration.");
    store.actions.setCellValue(2);
    equal(transitions.length, 1);
    unsubscribe();
    store.actions.clearCell();
    equal(transitions.length, 1, "Unsubscribe must stop notifications");
  });

  test("Elapsed time follows the clock, including delayed ticks, and uses readable hours", () => {
    const { store, advance } = newGame();
    advance(1250);
    store.actions.tick();
    equal(store.getState().elapsedTime, 1250);
    advance(60000);
    store.actions.tick();
    equal(store.getState().elapsedTime, 61250, "Delayed ticks must not lose elapsed time");
    equal(Sudoku.formatElapsedTime(0), "00:00:00");
    equal(Sudoku.formatElapsedTime(999), "00:00:00");
    equal(Sudoku.formatElapsedTime(61250), "00:01:01");
    equal(Sudoku.formatElapsedTime(3661000), "01:01:01");
  });

  test("A full board with an incorrect value stays active; correcting the last error completes it", () => {
    const { store, puzzle, emptyCell, advance } = newGame();
    const wrong = (puzzle.solution[emptyCell] % 9) + 1;
    puzzle.givens.forEach((given, index) => {
      if (given !== 0) return;
      store.actions.selectCell(index);
      store.actions.setCellValue(index === emptyCell ? wrong : puzzle.solution[index]);
    });
    assert(store.getState().values.every((value) => value !== 0), "Test must fill every cell.");
    equal(store.getState().status, "active");
    assert(!Sudoku.isComplete(store.getState()));
    advance(65432);
    store.actions.selectCell(emptyCell);
    store.actions.setCellValue(puzzle.solution[emptyCell]);
    equal(store.getState().status, "completed");
    assert(Sudoku.isComplete(store.getState()));
    equal(store.getState().elapsedTime, 65432, "Completion must capture time since the last tick");
    advance(10000);
    store.actions.tick();
    equal(store.getState().elapsedTime, 65432, "The final solving time must remain frozen");
  });

  test("Restart clears player state and selection, keeps the puzzle, and resets the timer", () => {
    const { store, puzzle, emptyCell, advance } = newGame("Hard");
    store.actions.setTheme("dark");
    store.actions.selectCell(emptyCell);
    store.actions.setCellValue(puzzle.solution[emptyCell]);
    advance(8000);
    store.actions.tick();
    store.actions.restartGame();
    const restarted = store.getState();
    sameData(restarted.givens, puzzle.givens);
    sameData(restarted.solution, puzzle.solution);
    sameData(restarted.values, puzzle.givens);
    equal(restarted.status, "active");
    equal(restarted.selectedCell, null);
    equal(restarted.elapsedTime, 0);
    equal(restarted.difficulty, "Hard");
    equal(restarted.theme, "dark");
    assert(restarted.candidates.every((digits) => digits.length === 0));
    advance(1500);
    store.actions.tick();
    equal(store.getState().elapsedTime, 1500, "Restart must begin a fresh timer interval");
  });

  test("Starting a supplied puzzle replaces the fixture through the public game boundary", () => {
    const { store, puzzle, advance } = newGame();
    const givens = puzzle.solution.slice();
    givens[0] = 0;
    advance(9000);
    store.actions.tick();
    store.actions.startGame({ givens, solution: puzzle.solution, difficulty: "Expert" });
    equal(store.getState().difficulty, "Expert");
    equal(store.getState().values.filter((value) => value === 0).length, 1);
    equal(store.getState().elapsedTime, 0);
    equal(store.getState().selectedCell, null);
    store.actions.selectCell(0);
    store.actions.setCellValue(puzzle.solution[0]);
    equal(store.getState().status, "completed");
    store.actions.restartGame();
    equal(store.getState().status, "active");
    equal(store.getState().values[0], 0);
    sameData(store.getState().givens, givens);
  });

  test("Candidate slots start empty and independently addressable; value edits record history", () => {
    const { store, emptyCell } = newGame();
    const state = store.getState();
    equal(state.candidates.length, 81);
    assert(state.candidates.every((digits) => Array.isArray(digits) && digits.length === 0));
    equal(new Set(state.candidates).size, 81, "Candidate arrays must not be shared between cells");
    store.actions.selectCell(emptyCell);
    store.actions.setCellValue(4);
    store.actions.clearCell();
    equal(store.getState().history.length, 2, "Entry and deletion each record one history step.");
    sameData(store.getState().future, []);
    assert(store.getState().candidates.every((digits) => digits.length === 0), "Value entry and deletion do not generate notes.");
  });

  test("Theme preference and operating-system theme are independent serializable state", () => {
    const { store } = newGame();
    store.actions.setTheme("auto");
    store.actions.setSystemTheme("dark");
    equal(store.getState().theme, "auto");
    equal(store.getState().systemTheme, "dark");
    store.actions.setTheme("light");
    store.actions.setSystemTheme("light");
    store.actions.setSystemTheme("dark");
    equal(store.getState().theme, "light", "OS changes must not overwrite a manual preference");
    store.actions.setTheme("dark");
    equal(store.getState().theme, "dark");
    store.actions.setTheme("auto");
    store.actions.setSystemTheme("light");
    equal(store.getState().theme, "auto");
    equal(store.getState().systemTheme, "light");
  });

  test("Difficulty selection records future generator input without changing the active board", () => {
    const { store, emptyCell } = newGame();
    store.actions.selectCell(emptyCell);
    store.actions.setCellValue(5);
    const values = store.getState().values;
    ["Easy", "Normal", "Hard", "Expert", "Extreme"].forEach((difficulty) => {
      store.actions.setDifficulty(difficulty);
      equal(store.getState().difficulty, difficulty);
      sameData(store.getState().values, values);
    });
  });

  test("The complete state survives JSON serialization with numeric time and no runtime objects", () => {
    const { store, emptyCell, advance } = newGame();
    store.actions.selectCell(emptyCell);
    store.actions.setCellValue(7);
    store.actions.setTheme("dark");
    advance(12345);
    store.actions.tick();
    const state = store.getState();
    const serialized = JSON.stringify(state);
    const restored = JSON.parse(serialized);
    sameData(restored, state);
    equal(restored.elapsedTime, 12345);
    equal(restored.values[emptyCell], 7);
    equal(restored.selectedCell, emptyCell);
    function checkPlain(value) {
      if (value === null || ["string", "number", "boolean"].includes(typeof value)) return;
      assert(typeof value === "object", "State cannot contain functions or undefined.");
      assert(Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype, "State cannot contain DOM nodes, Sets, or class instances.");
      Object.values(value).forEach(checkPlain);
    }
    checkPlain(state);
  });

  // Phase 2 tests share the dependency-free runner and its assertions.
  globalThis.SudokuTests = { test, assert, equal, sameData, throws, newGame, results };
  globalThis.SudokuTestResults = results;
  globalThis.renderSudokuTestResults = function () {
    if (typeof document === "undefined") return;
    const passed = results.filter((result) => result.passed).length;
    const summary = document.getElementById("summary");
    summary.textContent = `${passed} of ${results.length} checks passed.`;
    summary.className = passed === results.length ? "passed" : "failed";
    const list = document.getElementById("results");
    list.replaceChildren();
    results.forEach((result) => {
      const item = document.createElement("li");
      item.className = result.passed ? "passed" : "failed";
      item.textContent = `${result.passed ? "PASS" : "FAIL"} · ${result.name}`;
      if (!result.passed) {
        const detail = document.createElement("pre");
        detail.textContent = result.error;
        item.append(detail);
      }
      list.append(item);
    });
  };
  globalThis.renderSudokuTestResults();
}());
