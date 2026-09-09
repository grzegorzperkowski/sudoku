(function (global) {
  "use strict";

  const Sudoku = global.Sudoku = global.Sudoku || {};

  // Temporary Phase 1 development fixture. Phase 3 will replace this provider
  // with generated puzzle data using the same { givens, solution, difficulty } API.
  // Difficulty is a requested setting; this fixture has not been classified.
  const GIVEN_ROWS = [
    "530070000",
    "600195000",
    "098000060",
    "800060003",
    "400803001",
    "700020006",
    "060000280",
    "000419005",
    "000080079"
  ];

  const SOLUTION_ROWS = [
    "534678912",
    "672195348",
    "198342567",
    "859761423",
    "426853791",
    "713924856",
    "961537284",
    "287419635",
    "345286179"
  ];

  Sudoku.getDevelopmentPuzzle = function (difficulty = "Normal") {
    return {
      givens: Array.from(GIVEN_ROWS.join(""), Number),
      solution: Array.from(SOLUTION_ROWS.join(""), Number),
      difficulty
    };
  };
})(window);
