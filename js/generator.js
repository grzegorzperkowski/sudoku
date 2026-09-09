(function (Sudoku) {
  "use strict";
  const CELLS = Array.from({ length: 81 }, (_, cell) => cell);
  function seededRandom(seed) {
    let value = seed >>> 0;
    return () => {
      value = (value + 0x6D2B79F5) >>> 0;
      let t = Math.imul(value ^ value >>> 15, value | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function validateGeneratedPuzzle(puzzle) {
    if (!puzzle || typeof puzzle !== "object") return false;
    if (!Object.keys(Sudoku.DIFFICULTY_RULES).includes(puzzle.difficulty) ||
        (puzzle.puzzleDifficulty !== undefined && puzzle.puzzleDifficulty !== puzzle.difficulty)) return false;
    if (!Sudoku.Board.isValidBoard(puzzle.givens) || !Sudoku.Board.isValidBoard(puzzle.solution, true) ||
        !puzzle.givens.every((value, cell) => !value || value === puzzle.solution[cell])) return false;
    const analysis = Sudoku.analyzeDifficulty(puzzle.givens);
    const exact = Sudoku.solveExact(puzzle.givens);
    return exact.count === 1 && exact.solution.every((value, cell) => value === puzzle.solution[cell]) &&
      analysis.solved && analysis.board.every((value, cell) => value === puzzle.solution[cell]) && analysis.difficulty === puzzle.difficulty;
  }
  // The iterator makes identical work available to synchronous tests and to the
  // browser's time-sliced driver. It never returns an easier fallback.
  function* createPuzzleSearch(difficulty, { random = Math.random, maxAttempts = Infinity } = {}) {
    if (!Object.keys(Sudoku.DIFFICULTY_RULES).includes(difficulty)) throw new RangeError("Unknown difficulty.");
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const solution = Sudoku.solveExact(Array(81).fill(0), { random, limit: 1 }).solution;
      let givens = solution.slice();
      const promising = [];
      // Extreme explores fresh clue layouts near dynamically discovered difficult
      // candidates. Every outer attempt still starts from a new random full grid.
      const rounds = difficulty === "Extreme" ? 32 : 1;
      for (let round = 0; round < rounds; round++) {
        let clues = givens.filter(Boolean).length;
        yield { attempt, clues };
        for (const cell of Sudoku.shuffled(CELLS, random)) {
          const digit = givens[cell];
          if (!digit) continue;
          givens[cell] = 0;
          if (Sudoku.countSolutions(givens) !== 1) givens[cell] = digit;
          else {
            clues--;
            // For lower levels, stop partway through carving when the path fits.
            if ((difficulty === "Easy" || difficulty === "Normal") && clues <= (difficulty === "Easy" ? 45 : 36)) {
              const analysis = Sudoku.analyzeDifficulty(givens);
              if (analysis.difficulty === difficulty) {
                const puzzle = { givens: givens.slice(), solution, difficulty, puzzleDifficulty: difficulty, analysis, generationAttempts: attempt };
                if (!validateGeneratedPuzzle(puzzle)) throw new Error("Generated puzzle failed validation.");
                return puzzle;
              }
            }
          }
          yield { attempt, clues };
        }
        const analysis = Sudoku.analyzeDifficulty(givens);
        if (analysis.difficulty === difficulty) {
          const puzzle = { givens: givens.slice(), solution, difficulty, puzzleDifficulty: difficulty, analysis, generationAttempts: attempt };
          if (!validateGeneratedPuzzle(puzzle)) throw new Error("Generated puzzle failed validation.");
          return puzzle;
        }
        if (analysis.advancedSteps && analysis.score >= 200) {
          promising.push({ givens: givens.slice(), fitness: analysis.score * (analysis.solved ? 1 : 0.6) });
          promising.sort((a, b) => b.fitness - a.fitness);
          promising.length = Math.min(4, promising.length);
        }
        if (!promising.length) break;
        givens = promising[Math.floor(random() * promising.length)].givens.slice();
        Sudoku.shuffled(CELLS.filter(cell => !givens[cell]), random).slice(0, 3 + round % 3).forEach(cell => { givens[cell] = solution[cell]; });
      }
    }
    throw new Error(`No ${difficulty} puzzle found within the configured search budget.`);
  }
  function generatePuzzleSync(difficulty, options) {
    const search = createPuzzleSearch(difficulty, options);
    let result;
    do { result = search.next(); } while (!result.done);
    return result.value;
  }
  async function generatePuzzle(difficulty, options = {}) {
    const search = createPuzzleSearch(difficulty, options);
    const now = () => globalThis.performance ? globalThis.performance.now() : Date.now();
    let deadline = now();
    while (true) {
      if (options.signal && options.signal.aborted) throw new Error("Generation cancelled.");
      const result = search.next();
      if (result.done) return result.value;
      if (now() >= deadline) {
        if (options.onProgress) options.onProgress(result.value);
        await new Promise(resolve => setTimeout(resolve, 0));
        deadline = now() + 12;
      }
    }
  }
  Object.assign(Sudoku, { seededRandom, validateGeneratedPuzzle, createPuzzleSearch, generatePuzzleSync, generatePuzzle });
})(window.Sudoku);
