(function (Sudoku) {
  "use strict";
  const B = Sudoku.Board;
  function shuffled(items, random) {
    const copy = items.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }
  // Search is confined to this module. Logical solving never calls it.
  function solveExact(input, { limit = 2, random = null } = {}) {
    if (!Number.isInteger(limit) || limit < 1) throw new RangeError("Solution limit must be a positive integer.");
    const result = { valid: B.isValidBoard(input), count: 0, solution: null, stoppedAtLimit: false, nodes: 0, status: "invalid" };
    if (!result.valid) return result;
    const board = input.slice();
    const used = B.units.map(unit => unit.reduce((mask, cell) => mask | (board[cell] ? 1 << (board[cell] - 1) : 0), 0));
    function search() {
      result.nodes++;
      let chosen = -1, options = 0, smallest = 10;
      for (let cell = 0; cell < 81; cell++) {
        if (board[cell]) continue;
        const ids = B.cellUnits[cell];
        const mask = B.ALL & ~(used[ids[0]] | used[ids[1]] | used[ids[2]]);
        const size = B.counts[mask];
        if (!size) return false;
        if (size < smallest) { smallest = size; chosen = cell; options = mask; if (size === 1) break; }
      }
      if (chosen === -1) {
        result.count++;
        if (!result.solution) result.solution = board.slice();
        return result.count >= limit;
      }
      const choices = random ? shuffled(B.digits[options], random) : B.digits[options];
      const ids = B.cellUnits[chosen];
      for (const digit of choices) {
        const bit = 1 << (digit - 1);
        board[chosen] = digit;
        ids.forEach(id => { used[id] |= bit; });
        const stop = search();
        ids.forEach(id => { used[id] &= ~bit; });
        board[chosen] = 0;
        if (stop) return true;
      }
      return false;
    }
    result.stoppedAtLimit = search();
    result.status = result.count === 0 ? "unsolvable" : result.count > 1 ? "multiple" : "solved";
    return result;
  }
  Object.assign(Sudoku, { solveExact, shuffled, countSolutions: (board, limit = 2) => solveExact(board, { limit }).count });
})(window.Sudoku);
