(function () {
  "use strict";
  const S = globalThis.Sudoku, B = S.Board;
  const { test, assert, equal, sameData, throws, newGame } = globalThis.SudokuTests;
  const fixture = S.getDevelopmentPuzzle();
  const board = text => Array.from(text, Number);
  const snapshot = state => ({ values: state.values, candidates: state.candidates, status: state.status });

  test("Exact solver returns the unique known solution without mutating input", () => {
    const before = fixture.givens.slice(), result = S.solveExact(before);
    equal(result.count, 1); equal(result.status, "solved"); assert(!result.stoppedAtLimit);
    sameData(result.solution, fixture.solution); sameData(before, fixture.givens);
    assert(B.isValidBoard(result.solution, true));
  });
  test("Exact solver accepts a completed valid board", () => {
    const result = S.solveExact(fixture.solution);
    equal(result.count, 1); equal(result.nodes, 1); sameData(result.solution, fixture.solution);
  });
  test("Exact solver rejects duplicate, malformed, sparse, and invalid boards", () => {
    const duplicate = fixture.givens.slice(); duplicate[2] = 5;
    for (const invalid of [duplicate, [], Array(81), null, Array(81).fill(10), Array(81).fill("0")]) {
      const result = S.solveExact(invalid); equal(result.status, "invalid"); equal(result.count, 0); equal(result.solution, null);
    }
    throws(() => S.solveExact(fixture.givens, { limit: 0 }));
  });
  test("Exact solver distinguishes legal-looking but unsolvable givens", () => {
    const impossible = fixture.givens.slice(); impossible[2] = 1;
    assert(B.isValidBoard(impossible)); equal(S.solveExact(impossible).status, "unsolvable");
    equal(S.countSolutions(impossible), 0);
  });
  test("Exact counting stops at two on a many-solution board", () => {
    const empty = Array(81).fill(0), two = S.solveExact(empty), three = S.solveExact(empty, { limit: 3 });
    equal(two.count, 2); equal(two.status, "multiple"); assert(two.stoppedAtLimit);
    equal(three.count, 3); assert(two.nodes < three.nodes); assert(two.nodes < 150);
    assert(B.isValidBoard(two.solution, true)); equal(S.countSolutions(empty, 1), 1);
  });
  test("Shared topology has exactly twenty symmetric peers per cell", () => {
    equal(B.units.length, 27);
    B.peers.forEach((peers, cell) => { equal(peers.length, 20); assert(!peers.includes(cell)); peers.forEach(peer => assert(B.isPeer(peer, cell))); });
    assert(Object.isFrozen(B.peers[0]));
  });

  function candidates() { return Array.from({ length: 81 }, () => [1,2,3,4,5,6,7,8,9]); }
  function without(notes, cells, digits) { cells.forEach(cell => { notes[cell] = notes[cell].filter(d => !digits.includes(d)); }); }
  function find(technique, notes) {
    const p = S.createLogicalPosition(Array(81).fill(0), notes), before = JSON.stringify(p);
    const result = S.findLogicalStep(p, { techniques: [technique] });
    equal(JSON.stringify(p), before, "Technique inspection must be pure");
    if (result) {
      equal(result.technique, technique); equal(result.weight, S.TECHNIQUES[technique].weight);
      assert(result.cells.length && result.evidence && result.placements.length + result.eliminations.length);
      sameData(S.findLogicalStep(p, { techniques: [technique] }), result);
    }
    return result;
  }
  const removes = (step, cell, digit) => step && step.eliminations.some(e => e.cell === cell && e.digit === digit);
  test("Naked Single places its only candidate", () => {
    const notes = candidates(); notes[40] = [7]; sameData(find("nakedSingle", notes).placements, [{ cell: 40, digit: 7 }]);
  });
  test("Hidden Single finds a unique unit position with several cell candidates", () => {
    const notes = candidates(); without(notes, B.rows[0].filter(c => c !== 3), [7]);
    sameData(find("hiddenSingle", notes).placements, [{ cell: 3, digit: 7 }]);
  });
  test("Naked Pair removes both digits outside its two cells", () => {
    const notes = candidates(); notes[0] = notes[1] = [1,2];
    const step = find("nakedPair", notes); assert(removes(step, 2, 1) && removes(step, 2, 2)); assert(!removes(step, 0, 1));
    notes[1] = [1,2,3]; equal(find("nakedPair", notes), null);
  });
  test("Hidden Pair preserves the pair and removes surplus candidates", () => {
    const notes = candidates(); without(notes, B.rows[0].slice(2), [1,2]);
    const step = find("hiddenPair", notes); assert(removes(step, 0, 3) && removes(step, 1, 9)); assert(!removes(step, 0, 1));
    notes[2].push(1,2); equal(find("hiddenPair", notes), null);
  });
  test("Naked Triple handles three overlapping bivalue cells", () => {
    const notes = candidates(); notes[0] = [1,2]; notes[1] = [2,3]; notes[2] = [1,3];
    const step = find("nakedTriple", notes); assert([1,2,3].every(digit => removes(step, 3, digit))); assert(!removes(step, 2, 1));
    notes[2] = [1,4]; equal(find("nakedTriple", notes), null);
  });
  test("Hidden Triple identifies three digits confined to three cells", () => {
    const notes = candidates(); without(notes, B.rows[0].slice(3), [1,2,3]);
    notes[0] = [1,2,4]; notes[1] = [2,3,5]; notes[2] = [1,3,6];
    const step = find("hiddenTriple", notes); assert(removes(step, 0, 4) && removes(step, 1, 5) && removes(step, 2, 6));
    assert(!removes(step, 0, 1)); notes[3].push(1,2,3); equal(find("hiddenTriple", notes), null);
  });
  test("Pointing Pair and Triple eliminate along a line outside the source box", () => {
    for (const sources of [[0,1], [0,1,2]]) {
      const notes = candidates(); without(notes, B.boxes[0].filter(c => !sources.includes(c)), [1]);
      const step = find("pointing", notes); assert(removes(step, 3, 1)); assert(!removes(step, 0, 1));
    }
    equal(find("pointing", candidates()), null);
  });
  test("Claiming removes a line's digit from other cells of its box", () => {
    const notes = candidates(); without(notes, B.rows[0].slice(2), [1]);
    const step = find("claiming", notes); assert(removes(step, 9, 1) && !removes(step, 0, 1));
    equal(find("claiming", candidates()), null);
  });
  function fishNotes(size, transpose = false) {
    const notes = candidates(), bases = size === 2 ? [0,3] : [0,3,6];
    const covers = size === 2 ? [[1,5],[1,5]] : [[1,4],[4,7],[1,7]];
    bases.forEach((base, i) => without(notes, (transpose ? B.columns : B.rows)[base].filter(cell => !covers[i].includes(transpose ? Math.floor(cell / 9) : cell % 9)), [1]));
    return notes;
  }
  test("X-Wing works in row and column orientations and rejects a third cover", () => {
    for (const transpose of [false, true]) {
      const notes = fishNotes(2, transpose), step = find("xWing", notes);
      assert(removes(step, 10, 1)); equal(step.evidence.orientation, transpose ? "columns" : "rows");
      notes[transpose ? 18 : 2].push(1); equal(find("xWing", notes), null);
    }
  });
  test("XY-Wing eliminates only the shared wing digit seen by both wings", () => {
    const notes = candidates(); notes[0] = [1,2]; notes[4] = [1,3]; notes[27] = [2,3];
    const step = find("xyWing", notes); assert(removes(step, 31, 3)); assert(!removes(step, 5, 3));
    notes[27] = [1,3]; equal(find("xyWing", notes), null);
  });
  test("Swordfish supports staggered covers in both orientations", () => {
    for (const transpose of [false, true]) {
      const notes = fishNotes(3, transpose), step = find("swordfish", notes);
      assert(removes(step, 10, 1)); equal(step.evidence.covers.length, 3);
      notes[transpose ? 18 : 2].push(1); equal(find("swordfish", notes), null);
    }
  });
  test("Simple Coloring trap sees both colors through a strong-link chain", () => {
    const notes = candidates();
    without(notes, B.rows[0].filter(c => ![0,4].includes(c)), [1]);
    without(notes, B.columns[4].filter(c => ![4,40].includes(c)), [1]);
    without(notes, B.rows[4].filter(c => ![36,40].includes(c)), [1]);
    const step = find("coloring", notes); equal(step.evidence.rule, "trap"); assert(removes(step, 9, 1));
    assert(!removes(step, 0, 1)); equal(find("coloring", candidates()), null);
  });
  test("Simple Coloring wrap eliminates a color containing two peers", () => {
    const notes = candidates();
    without(notes, B.rows[0].filter(c => ![0,1].includes(c)), [1]);
    without(notes, B.columns[1].filter(c => ![1,10].includes(c)), [1]);
    const step = find("coloring", notes); equal(step.evidence.rule, "wrap");
    assert(removes(step, 0, 1) && removes(step, 10, 1)); assert(!removes(step, 1, 1));
  });
  test("Logical loop is deterministic, structured, and independent of exact search", () => {
    const exact = S.solveExact, count = S.countSolutions;
    try {
      S.solveExact = S.countSolutions = () => { throw new Error("Logical solver called search"); };
      const a = S.solveLogical(fixture.givens), b = S.solveLogical(fixture.givens);
      sameData(a, b); assert(a.solved); sameData(a.board, fixture.solution);
      equal(a.score, a.steps.reduce((sum, step) => sum + step.weight + 2 * step.eliminations.length, 0));
      assert(a.steps.every(step => step.placements.length === 1 || step.eliminations.length));
      equal(S.solveLogical(Array(81).fill(0)).status, "stuck");
      equal(S.solveLogical(Array(81).fill(1)).status, "invalid");
    } finally { S.solveExact = exact; S.countSolutions = count; }
  });
  test("Logical solver reports contradictions instead of guessing", () => {
    const notes = candidates(); notes[0] = [];
    equal(S.solveLogical(Array(81).fill(0), { candidates: notes }).status, "invalid");
    throws(() => S.createLogicalPosition(fixture.givens, candidates()));
    throws(() => S.createLogicalPosition(Array(81).fill(0), Array(81)));
    const missingDigit = candidates(); without(missingDigit, B.rows[0], [9]);
    equal(S.solveLogical(Array(81).fill(0), { candidates: missingDigit }).status, "invalid");
  });
  test("A fixed advanced puzzle is solved with a sound replayable trace", () => {
    const givens = board("630400201007000040000020003000100000708000609400508000100860002000000800000305000");
    const exact = S.solveExact(givens), report = S.solveLogical(givens), position = S.createLogicalPosition(givens);
    equal(exact.count, 1); assert(report.solved && report.advancedSteps >= 4);
    for (const step of report.steps) {
      step.placements.forEach(({ cell, digit }) => equal(digit, exact.solution[cell]));
      step.eliminations.forEach(({ cell, digit }) => assert(digit !== exact.solution[cell]));
      S.applyLogicalStep(position, step);
      position.masks.forEach((mask, cell) => { if (!position.board[cell]) assert(mask & (1 << (exact.solution[cell] - 1))); });
    }
    sameData(position.board, exact.solution);
    const basics = Object.keys(S.TECHNIQUES).filter(key => S.TECHNIQUES[key].rank < 4);
    assert(!S.solveLogical(givens, { techniques: basics }).solved);
  });
  test("Difficulty rejects stuck boards and intermediate-only Extreme impostors", () => {
    equal(S.analyzeDifficulty(Array(81).fill(0)).difficulty, null);
    const report = S.solveLogical(fixture.givens);
    equal(S.classifyDifficulty({ ...report, score: 1000, intermediateSteps: 80, advancedSteps: 0 }), null);
    equal(S.classifyDifficulty({ ...report, score: 700, hardestRank: 5, advancedSteps: 4, eliminationCount: 25, steps: Array(65).fill({}) }), "Extreme");
    equal(S.classifyDifficulty({ ...report, score: 699, hardestRank: 5, advancedSteps: 4, eliminationCount: 25, steps: Array(65).fill({}) }), null);
    equal(S.classifyDifficulty({ ...report, score: 700, hardestRank: 5, advancedSteps: 3, eliminationCount: 25, steps: Array(65).fill({}) }), null);
  });
  test("All techniques preserve known solutions across 100 seeded candidate positions", () => {
    const random = S.seededRandom(903);
    for (let sample = 0; sample < 100; sample++) {
      const solution = S.solveExact(Array(81).fill(0), { random, limit: 1 }).solution;
      const givens = solution.map(value => random() < 0.22 ? value : 0);
      const notes = B.candidateMasks(givens).map((mask, cell) => B.digits[mask].filter(digit => digit === solution[cell] || random() < 0.65));
      const position = S.createLogicalPosition(givens, notes);
      for (const technique of Object.keys(S.TECHNIQUES)) {
        const step = S.findLogicalStep(position, { techniques: [technique] });
        if (!step) continue;
        step.placements.forEach(({ cell, digit }) => equal(digit, solution[cell], technique));
        step.eliminations.forEach(({ cell, digit }) => assert(digit !== solution[cell], technique));
      }
    }
  });
  test("Fixed Extreme regression requires advanced reasoning and meets every real acceptance gate", () => {
    const givens = board("005640208000005970000009000502000000000000000060080104810500000040200007003006800");
    const report = S.analyzeDifficulty(givens), exact = S.solveExact(givens);
    equal(exact.count, 1); equal(report.difficulty, "Extreme"); assert(report.solved);
    equal(report.score, 742); equal(report.advancedSteps, 5); equal(report.eliminationCount, 41);
    assert(report.steps.length >= 65); sameData(report.board, exact.solution);
    assert(!S.solveLogical(givens, { techniques: Object.keys(S.TECHNIQUES).filter(key => S.TECHNIQUES[key].rank < 4) }).solved);
  });
  test("Hint places exactly one correct value with exact candidate Undo and Redo", () => {
    const { store } = newGame(); store.actions.autoCandidates(); store.actions.toggleNotesMode();
    const before = store.getState(); let updates = 0; const unsub = store.subscribe(() => updates++);
    store.actions.hint(); unsub(); const after = store.getState();
    equal(updates, 1); equal(after.history.length, before.history.length + 1);
    const changed = after.values.map((value, cell) => value !== before.values[cell] ? cell : -1).filter(cell => cell >= 0);
    equal(changed.length, 1); const cell = changed[0]; equal(after.values[cell], after.solution[cell]);
    equal(after.selectedCell, before.selectedCell); assert(after.notesMode);
    B.peers[cell].forEach(peer => assert(!after.candidates[peer].includes(after.solution[cell])));
    store.actions.undo(); sameData(snapshot(store.getState()), snapshot(before));
    store.actions.redo(); sameData(snapshot(store.getState()), snapshot(after));
  });
  test("Hint handles incorrect entries and never changes givens or multiple cells", () => {
    const { store } = newGame();
    fixture.givens.forEach((value, cell) => { if (!value) { store.actions.selectCell(cell); store.actions.setCellValue(fixture.solution[cell]); } });
    store.actions.undo(); const cell = store.getState().values.findIndex(v => !v);
    store.actions.selectCell(cell); store.actions.setCellValue(fixture.solution[cell] % 9 + 1);
    const before = store.getState(); store.actions.hint(); const after = store.getState();
    equal(after.status, "completed"); equal(after.values.filter((v, i) => v !== before.values[i]).length, 1);
    store.actions.undo(); sameData(snapshot(store.getState()), snapshot(before));
  });
  test("Solve requires explicit confirmation and is one reversible timer-finishing action", () => {
    const { store, advance } = newGame(); store.actions.autoCandidates(); advance(3210);
    const before = store.getState(); store.actions.solve(); equal(store.getState(), before);
    store.actions.solve("yes"); equal(store.getState(), before);
    store.actions.solve(true); const solved = store.getState();
    sameData(solved.values, fixture.solution); assert(solved.candidates.every(list => !list.length)); equal(solved.status, "completed");
    equal(solved.elapsedTime, 3210); equal(solved.history.length, before.history.length + 1);
    advance(5000); store.actions.tick(); equal(store.getState().elapsedTime, 3210);
    store.actions.undo(); sameData(snapshot(store.getState()), snapshot(before));
    advance(900); store.actions.redo(); equal(store.getState().elapsedTime, 4110); equal(store.getState().status, "completed");
  });
  test("Generation blocks conflicting central actions and leaves the old game recoverable", () => {
    const { store } = newGame(); store.actions.autoCandidates(); store.actions.setGenerating(true);
    const before = store.getState();
    store.actions.hint(); store.actions.solve(true); store.actions.undo(); store.actions.restartGame(); store.actions.setDifficulty("Extreme");
    store.actions.selectCell(2); store.actions.setCellValue(4); store.actions.autoCandidates(); store.actions.toggleNotesMode();
    equal(store.getState(), before); store.actions.setGenerating(false); sameData(snapshot(store.getState()), snapshot(before));
  });
  test("Phase 2 saves remain compatible; uniqueness, rating, and generated history are validated", () => {
    const { store } = newGame(); store.actions.autoCandidates(); store.actions.hint(); store.actions.undo();
    const saved = JSON.parse(JSON.stringify(store.getState())); delete saved.puzzleDifficulty; delete saved.generating;
    const restored = S.validateSavedState(saved); equal(restored.puzzleDifficulty, null); equal(restored.generating, false);
    sameData(restored.future, saved.future);
    throws(() => S.validateSavedState({ ...saved, givens: Array(81).fill(0) }));
    throws(() => S.validateSavedState({ ...saved, puzzleDifficulty: "Extreme" }));
    const generated = S.generatePuzzleSync("Normal", { random: S.seededRandom(3100) }); store.actions.startGame(generated);
    store.actions.autoCandidates(); store.actions.hint(); store.actions.undo(); store.actions.setDifficulty("Extreme");
    const loaded = S.createGameStore({ initialState: JSON.parse(JSON.stringify(store.getState())) });
    equal(loaded.getState().puzzleDifficulty, "Normal"); equal(loaded.getState().difficulty, "Extreme");
    sameData(loaded.getState().future, store.getState().future); loaded.actions.redo();
    loaded.actions.restartGame(); equal(loaded.getState().puzzleDifficulty, "Normal"); equal(loaded.getState().difficulty, "Extreme");
  });
  test("Seed injection is repeatable and exhausted budgets never return an easier puzzle", () => {
    const a = S.generatePuzzleSync("Normal", { random: S.seededRandom(3100) }), b = S.generatePuzzleSync("Normal", { random: S.seededRandom(3100) });
    sameData(a, b); throws(() => S.generatePuzzleSync("Extreme", { maxAttempts: 0 }));
    throws(() => S.generatePuzzleSync("Unknown")); assert(S.validateGeneratedPuzzle(a));
    throws(() => S.generatePuzzleSync("__proto__"));
    assert(!S.validateGeneratedPuzzle({ ...a, difficulty: null }));
    assert(!S.validateGeneratedPuzzle({ ...a, puzzleDifficulty: "Extreme" }));
    assert(!S.validateGeneratedPuzzle({ ...a, solution: Array(81).fill(1) }));
  });
  globalThis.renderSudokuTestResults();
}());
