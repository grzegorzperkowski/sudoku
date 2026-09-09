(function () {
  "use strict";
  const S = globalThis.Sudoku;
  const { test, assert, equal, sameData } = globalThis.SudokuTests;
  // The browser's ?core mode is used by the UI regression runner, which tests
  // generation through New Game separately. The default page runs everything.
  if (typeof location !== "undefined" && location.search === "?core") return;
  globalThis.SudokuGenerationTests = (async function () {
    const samples = [], levels = Object.keys(S.DIFFICULTY_RULES);
    for (const level of levels) {
      const puzzles = [];
      for (let sample = 0; sample < 5; sample++) {
        const seed = 3100 + sample;
        if (typeof document !== "undefined") document.getElementById("summary").textContent = `Generating ${level} sample ${sample + 1} / 5…`;
        const started = Date.now();
        try {
          // Same production search and acceptance rules, with a repeatable RNG.
          // The limit produces an explicit test failure, never an easier puzzle.
          // Node need not pay browser timer pacing for every sample. Both APIs
          // drive the same iterator; yielding/cancellation is verified below.
          const generate = typeof document === "undefined" ? S.generatePuzzleSync : S.generatePuzzle;
          const puzzle = await generate(level, { random: S.seededRandom(seed), maxAttempts: 2000 });
          puzzles.push(puzzle);
          const report = S.analyzeDifficulty(puzzle.givens);
          samples.push({ level, seed, milliseconds: Date.now() - started, score: report.score, advancedSteps: report.advancedSteps,
            intermediateSteps: report.intermediateSteps, eliminations: report.eliminationCount, steps: report.steps.length,
            clues: puzzle.givens.filter(Boolean).length, attempts: puzzle.generationAttempts, usage: report.usage });
          test(`${level} generated seed ${seed}: unique, logically solved, correctly rated, sound trace`, () => {
            assert(S.Board.isValidBoard(puzzle.givens)); assert(S.Board.isValidBoard(puzzle.solution, true));
            equal(S.countSolutions(puzzle.givens), 1); sameData(S.solveExact(puzzle.givens).solution, puzzle.solution);
            assert(report.solved); sameData(report.board, puzzle.solution); equal(report.difficulty, level);
            sameData(report, puzzle.analysis); assert(S.validateGeneratedPuzzle(puzzle));
            const position = S.createLogicalPosition(puzzle.givens);
            for (const step of report.steps) {
              step.placements.forEach(({ cell, digit }) => equal(digit, puzzle.solution[cell]));
              step.eliminations.forEach(({ cell, digit }) => assert(digit !== puzzle.solution[cell]));
              S.applyLogicalStep(position, step);
              position.masks.forEach((mask, cell) => { if (!position.board[cell]) assert(mask & (1 << (puzzle.solution[cell] - 1))); });
            }
            sameData(position.board, puzzle.solution);
            if (level === "Expert" || level === "Extreme") {
              const intermediate = Object.keys(S.TECHNIQUES).filter(key => S.TECHNIQUES[key].rank < 4);
              assert(!S.solveLogical(puzzle.givens, { techniques: intermediate }).solved);
            }
            if (level === "Extreme") {
              assert(report.score >= 700 && report.advancedSteps >= 4 && report.eliminationCount >= 25 && report.steps.length >= 65);
            }
            const store = S.createGameStore(); store.actions.startGame(puzzle); store.actions.autoCandidates(); store.actions.hint();
            const before = store.getState(); store.actions.undo();
            const restored = S.createGameStore({ initialState: JSON.parse(JSON.stringify(store.getState())) }); restored.actions.redo();
            sameData(restored.getState().values, before.values); sameData(restored.getState().candidates, before.candidates);
          });
        } catch (error) {
          test(`${level} generated seed ${seed}`, () => { throw error; });
        }
        globalThis.renderSudokuTestResults();
      }
      test(`${level} generation varies solved grids and clue layouts across five seeds`, () => {
        equal(puzzles.length, 5);
        equal(new Set(puzzles.map(p => p.givens.join(""))).size, puzzles.length);
        equal(new Set(puzzles.map(p => p.solution.join(""))).size, puzzles.length);
        // Digit relabeling alone would leave these masks identical.
        equal(new Set(puzzles.map(p => p.givens.map(Boolean).join(""))).size, puzzles.length);
      });
    }
    test("Five-level calibration has strictly separated scores and distinct reasoning profiles", () => {
      equal(samples.length, 25);
      const byLevel = Object.fromEntries(levels.map(level => [level, samples.filter(sample => sample.level === level)]));
      for (let i = 1; i < levels.length; i++) assert(Math.min(...byLevel[levels[i]].map(s => s.score)) > Math.max(...byLevel[levels[i - 1]].map(s => s.score)));
      assert(byLevel.Easy.every(s => !s.intermediateSteps && !s.advancedSteps));
      assert(byLevel.Normal.every(s => s.intermediateSteps >= 1 && !s.advancedSteps));
      assert(byLevel.Hard.every(s => s.intermediateSteps >= 4 && !s.advancedSteps));
      assert(byLevel.Expert.every(s => s.advancedSteps >= 1));
      assert(byLevel.Extreme.every(s => s.advancedSteps >= 4));
      const mean = (level, field) => byLevel[level].reduce((sum, sample) => sum + sample[field], 0) / byLevel[level].length;
      assert(mean("Hard", "intermediateSteps") > mean("Normal", "intermediateSteps"));
      assert(mean("Extreme", "score") >= mean("Expert", "score") * 1.7);
      assert(mean("Extreme", "advancedSteps") > mean("Expert", "advancedSteps"));
      assert(mean("Extreme", "eliminations") > mean("Expert", "eliminations"));
    });
    let beats = 0;
    const heartbeat = setInterval(() => beats++, 0);
    const controller = new AbortController(); let cancelled = false;
    try {
      await S.generatePuzzle("Extreme", { random: S.seededRandom(3100), signal: controller.signal, onProgress: () => { if (beats >= 2) controller.abort(); } });
    } catch (error) { cancelled = error.message === "Generation cancelled."; }
    finally { clearInterval(heartbeat); }
    test("Asynchronous generation yields to the event loop and supports cancellation", () => { assert(beats >= 2); assert(cancelled); });
    globalThis.SudokuCalibrationResults = samples;
    globalThis.renderSudokuTestResults();
  }());
}());
