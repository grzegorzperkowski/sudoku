(function (global) {
  "use strict";
  const Sudoku = global.Sudoku = global.Sudoku || {};
  const ALL = 511;
  const rows = Array.from({ length: 9 }, (_, r) => Array.from({ length: 9 }, (_, c) => r * 9 + c));
  const columns = Array.from({ length: 9 }, (_, c) => rows.map(row => row[c]));
  const boxes = Array.from({ length: 9 }, (_, b) => Array.from({ length: 9 }, (_, n) =>
    (Math.floor(b / 3) * 3 + Math.floor(n / 3)) * 9 + (b % 3) * 3 + n % 3));
  const units = [...rows, ...columns, ...boxes];
  const cellUnits = rows.flat().map(cell => units.map((unit, index) => unit.includes(cell) ? index : -1).filter(index => index >= 0));
  const peers = cellUnits.map((ids, cell) => [...new Set(ids.flatMap(id => units[id]))].filter(peer => peer !== cell).sort((a, b) => a - b));
  const digits = Array.from({ length: 512 }, (_, mask) => Array.from({ length: 9 }, (_, n) => n + 1).filter(digit => mask & (1 << (digit - 1))));
  const counts = digits.map(list => list.length);
  function isValidBoard(board, complete = false) {
    if (!Array.isArray(board) || board.length !== 81 || !Array.from(board).every(n => Number.isInteger(n) && n >= (complete ? 1 : 0) && n <= 9)) return false;
    return units.every(unit => {
      let used = 0;
      for (const cell of unit) {
        if (!board[cell]) continue;
        const bit = 1 << (board[cell] - 1);
        if (used & bit) return false;
        used |= bit;
      }
      return true;
    });
  }
  function candidateMasks(board) {
    return board.map((value, cell) => value ? 0 : ALL & ~peers[cell].reduce((used, peer) => used | (board[peer] ? 1 << (board[peer] - 1) : 0), 0));
  }
  function freeze(value) {
    if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
  }
  Sudoku.Board = freeze({ ALL, rows, columns, boxes, units, cellUnits, peers, digits, counts,
    isPeer: (a, b) => peers[a].includes(b), isValidBoard, candidateMasks });
})(window);
