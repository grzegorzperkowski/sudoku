// Optional, repeatable calibration. No application dependencies or build step.
global.window = global;
for (const name of ['board', 'exact', 'logical', 'difficulty', 'generator']) require('../js/' + name + '.js');
const samples = [];
for (const level of Object.keys(Sudoku.DIFFICULTY_RULES)) {
  for (let seed = 3100; seed < 3110; seed++) {
    const started = Date.now();
    const puzzle = Sudoku.generatePuzzleSync(level, { random: Sudoku.seededRandom(seed), maxAttempts: 2000 });
    if (!Sudoku.validateGeneratedPuzzle(puzzle)) throw new Error('Invalid calibration puzzle');
    const a = puzzle.analysis;
    const result = { level, seed, milliseconds: Date.now() - started, attempts: puzzle.generationAttempts,
      score: a.score, advanced: a.advancedSteps, intermediate: a.intermediateSteps,
      eliminations: a.eliminationCount, steps: a.steps.length, clues: puzzle.givens.filter(Boolean).length, usage: a.usage };
    samples.push(result);
    console.error(level, seed, 'score', a.score, 'advanced', a.advancedSteps);
  }
}
console.log(JSON.stringify(samples, null, 2));
