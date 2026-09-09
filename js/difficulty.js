(function (Sudoku) {
  "use strict";
  // Deliberate gaps are rejected, never rounded up to a requested label.
  const DIFFICULTY_RULES = Object.freeze({
    Easy: Object.freeze({ minScore: 0, maxScore: 65, maxRank: 1 }),
    Normal: Object.freeze({ minScore: 80, maxScore: 155, maxRank: 2, minIntermediate: 1 }),
    Hard: Object.freeze({ minScore: 180, maxScore: 330, maxRank: 3, minIntermediate: 4 }),
    Expert: Object.freeze({ minScore: 350, maxScore: 480, minAdvanced: 1, minEliminations: 8 }),
    Extreme: Object.freeze({ minScore: 700, maxScore: Infinity, minAdvanced: 4, minEliminations: 25, minSteps: 65 })
  });
  function classifyDifficulty(report) {
    if (!report.solved) return null;
    for (const [name, rule] of Object.entries(DIFFICULTY_RULES)) {
      if (report.score < rule.minScore || report.score > rule.maxScore ||
          (rule.maxRank && report.hardestRank > rule.maxRank) ||
          report.intermediateSteps < (rule.minIntermediate || 0) ||
          report.advancedSteps < (rule.minAdvanced || 0) ||
          report.eliminationCount < (rule.minEliminations || 0) ||
          report.steps.length < (rule.minSteps || 0)) continue;
      return name;
    }
    return null;
  }
  function analyzeDifficulty(board) {
    const report = Sudoku.solveLogical(board);
    let difficulty = classifyDifficulty(report);
    if (difficulty === "Expert" || difficulty === "Extreme") {
      const intermediate = Object.keys(Sudoku.TECHNIQUES).filter(key => Sudoku.TECHNIQUES[key].rank < 4);
      if (Sudoku.solveLogical(board, { techniques: intermediate }).solved) difficulty = null;
    }
    return { ...report, difficulty };
  }
  Object.assign(Sudoku, { DIFFICULTY_RULES, classifyDifficulty, analyzeDifficulty });
})(window.Sudoku);
