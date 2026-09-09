(function (Sudoku) {
  "use strict";
  const B = Sudoku.Board;
  const bit = digit => 1 << (digit - 1);
  const TECHNIQUES = Object.freeze({
    nakedSingle: { name: "Naked Single", weight: 1, rank: 1 },
    hiddenSingle: { name: "Hidden Single", weight: 2, rank: 1 },
    pointing: { name: "Pointing Pair / Triple", weight: 8, rank: 2 },
    claiming: { name: "Box-Line Reduction / Claiming", weight: 8, rank: 2 },
    nakedPair: { name: "Naked Pair", weight: 12, rank: 2 },
    hiddenPair: { name: "Hidden Pair", weight: 16, rank: 2 },
    nakedTriple: { name: "Naked Triple", weight: 24, rank: 3 },
    hiddenTriple: { name: "Hidden Triple", weight: 28, rank: 3 },
    xWing: { name: "X-Wing", weight: 60, rank: 4 },
    xyWing: { name: "XY-Wing", weight: 80, rank: 4 },
    swordfish: { name: "Swordfish", weight: 110, rank: 5 },
    coloring: { name: "Simple Coloring", weight: 100, rank: 5 }
  });
  Object.values(TECHNIQUES).forEach(Object.freeze);
  function createLogicalPosition(board, candidates) {
    if (!B.isValidBoard(board)) throw new TypeError("Invalid logical board.");
    const masks = B.candidateMasks(board);
    if (candidates !== undefined) {
      if (!Array.isArray(candidates) || candidates.length !== 81) throw new TypeError("Expected 81 candidate lists.");
      Array.from(candidates).forEach((list, cell) => {
        if (!Array.isArray(list) || !Array.from(list).every(d => Number.isInteger(d) && d >= 1 && d <= 9) || new Set(list).size !== list.length) throw new TypeError("Invalid candidate list.");
        const mask = list.reduce((m, d) => m | bit(d), 0);
        if (mask & ~masks[cell]) throw new TypeError("Candidates conflict with placed values.");
        masks[cell] = mask;
      });
    }
    return { board: board.slice(), masks };
  }
  function step(technique, cells, placements, eliminations, evidence) {
    return { technique, name: TECHNIQUES[technique].name, weight: TECHNIQUES[technique].weight,
      rank: TECHNIQUES[technique].rank, cells: [...new Set(cells)].sort((a, b) => a - b), placements, eliminations, evidence };
  }
  function removal(position, technique, cells, targets, mask, evidence) {
    const eliminations = [...new Set(targets)].sort((a, b) => a - b).flatMap(cell =>
      B.digits[position.masks[cell] & mask].map(digit => ({ cell, digit })));
    return eliminations.length ? step(technique, [...cells, ...eliminations.map(e => e.cell)], [], eliminations, evidence) : null;
  }
  // Callback returns the first productive deduction. All traversal orders are fixed.
  function combinations(items, size, visit, start = 0, chosen = []) {
    if (chosen.length === size) return visit(chosen);
    for (let i = start; i <= items.length - (size - chosen.length); i++) {
      const found = combinations(items, size, visit, i + 1, [...chosen, items[i]]);
      if (found) return found;
    }
    return null;
  }
  function nakedSingle(p) {
    for (let cell = 0; cell < 81; cell++) if (B.counts[p.masks[cell]] === 1)
      return step("nakedSingle", [cell], [{ cell, digit: B.digits[p.masks[cell]][0] }], [], { candidates: B.digits[p.masks[cell]] });
    return null;
  }
  function hiddenSingle(p) {
    for (let unit = 0; unit < 27; unit++) for (let digit = 1; digit <= 9; digit++) {
      const cells = B.units[unit].filter(cell => p.masks[cell] & bit(digit));
      if (cells.length === 1) return step("hiddenSingle", cells, [{ cell: cells[0], digit }], [], { unit, digit });
    }
    return null;
  }
  function intersection(p, pointing) {
    for (let unit = pointing ? 18 : 0; unit < (pointing ? 27 : 18); unit++) for (let digit = 1; digit <= 9; digit++) {
      const cells = B.units[unit].filter(cell => p.masks[cell] & bit(digit));
      if (cells.length < 2 || cells.length > 3) continue;
      const shared = B.cellUnits[cells[0]].filter(id => id !== unit && (pointing ? id < 18 : id >= 18) && cells.every(cell => B.units[id].includes(cell)));
      for (const targetUnit of shared) {
        const found = removal(p, pointing ? "pointing" : "claiming", cells, B.units[targetUnit].filter(cell => !B.units[unit].includes(cell)), bit(digit), { unit, targetUnit, digit, sources: cells });
        if (found) return found;
      }
    }
    return null;
  }
  function subset(p, size, hidden) {
    const technique = (hidden ? "hidden" : "naked") + (size === 2 ? "Pair" : "Triple");
    for (let unit = 0; unit < 27; unit++) {
      const cells = B.units[unit].filter(cell => p.masks[cell]);
      if (cells.length <= size) continue;
      if (!hidden) {
        const found = combinations(cells.filter(cell => B.counts[p.masks[cell]] <= size), size, sources => {
          const mask = sources.reduce((m, cell) => m | p.masks[cell], 0);
          if (B.counts[mask] !== size) return null;
          return removal(p, technique, sources, cells.filter(cell => !sources.includes(cell)), mask, { unit, sources, digits: B.digits[mask] });
        });
        if (found) return found;
      } else {
        const available = Array.from({ length: 9 }, (_, i) => i + 1).filter(digit => {
          const n = cells.filter(cell => p.masks[cell] & bit(digit)).length;
          return n >= 2 && n <= size;
        });
        const found = combinations(available, size, digits => {
          const mask = digits.reduce((m, d) => m | bit(d), 0);
          const sources = cells.filter(cell => p.masks[cell] & mask);
          if (sources.length !== size) return null;
          return removal(p, technique, sources, sources, B.ALL & ~mask, { unit, sources, digits });
        });
        if (found) return found;
      }
    }
    return null;
  }
  function fish(p, size) {
    for (let orientation = 0; orientation < 2; orientation++) for (let digit = 1; digit <= 9; digit++) {
      const baseUnits = orientation ? B.columns : B.rows;
      const cross = cell => orientation ? Math.floor(cell / 9) : cell % 9;
      const lines = baseUnits.map((unit, index) => ({ index, cells: unit.filter(cell => p.masks[cell] & bit(digit)) }))
        .filter(line => line.cells.length >= 2 && line.cells.length <= size);
      const found = combinations(lines, size, bases => {
        const covers = [...new Set(bases.flatMap(line => line.cells.map(cross)))].sort((a, b) => a - b);
        if (covers.length !== size) return null;
        const sources = bases.flatMap(line => line.cells);
        const targets = baseUnits.filter((_, index) => !bases.some(line => line.index === index)).flat().filter(cell => covers.includes(cross(cell)));
        return removal(p, size === 2 ? "xWing" : "swordfish", sources, targets, bit(digit),
          { orientation: orientation ? "columns" : "rows", digit, bases: bases.map(line => line.index), covers, sources });
      });
      if (found) return found;
    }
    return null;
  }
  function xyWing(p) {
    for (let pivot = 0; pivot < 81; pivot++) {
      const pivotMask = p.masks[pivot];
      if (B.counts[pivotMask] !== 2) continue;
      const wings = B.peers[pivot].filter(cell => B.counts[p.masks[cell]] === 2 && B.counts[p.masks[cell] & pivotMask] === 1);
      const found = combinations(wings, 2, ([first, second]) => {
        const a = p.masks[first], b = p.masks[second];
        const z = a & b & ~pivotMask;
        if (!z || (a & pivotMask) === (b & pivotMask) || B.counts[a | b | pivotMask] !== 3) return null;
        return removal(p, "xyWing", [pivot, first, second], B.peers[first].filter(cell => cell !== pivot && B.isPeer(second, cell)), z,
          { pivot, wings: [first, second], digits: B.digits[pivotMask], eliminatedDigit: B.digits[z][0] });
      });
      if (found) return found;
    }
    return null;
  }
  function coloring(p) {
    for (let digit = 1; digit <= 9; digit++) {
      const links = Array.from({ length: 81 }, () => []);
      B.units.forEach(unit => {
        const cells = unit.filter(cell => p.masks[cell] & bit(digit));
        if (cells.length === 2) { links[cells[0]].push(cells[1]); links[cells[1]].push(cells[0]); }
      });
      const visited = new Set();
      for (let root = 0; root < 81; root++) {
        if (!links[root].length || visited.has(root)) continue;
        const colors = new Map([[root, 0]]), queue = [root];
        let consistent = true;
        for (let at = 0; at < queue.length; at++) {
          const cell = queue[at];
          visited.add(cell);
          for (const peer of links[cell]) {
            if (!colors.has(peer)) { colors.set(peer, 1 - colors.get(cell)); queue.push(peer); }
            else if (colors.get(peer) === colors.get(cell)) consistent = false;
          }
        }
        if (!consistent) continue;
        const groups = [queue.filter(cell => colors.get(cell) === 0), queue.filter(cell => colors.get(cell) === 1)];
        const evidence = { digit, groups, links: queue.flatMap(cell => [...new Set(links[cell])].filter(peer => peer > cell).map(peer => [cell, peer])) };
        for (const group of groups) if (group.some((cell, i) => group.slice(i + 1).some(peer => B.isPeer(cell, peer))))
          return removal(p, "coloring", queue, group, bit(digit), { ...evidence, rule: "wrap" });
        const targets = B.rows.flat().filter(cell => (p.masks[cell] & bit(digit)) && !colors.has(cell) && groups.every(group => group.some(peer => B.isPeer(cell, peer))));
        const found = removal(p, "coloring", queue, targets, bit(digit), { ...evidence, rule: "trap" });
        if (found) return found;
      }
    }
    return null;
  }
  const finders = Object.freeze({ nakedSingle, hiddenSingle, pointing: p => intersection(p, true), claiming: p => intersection(p, false),
    nakedPair: p => subset(p, 2, false), hiddenPair: p => subset(p, 2, true),
    nakedTriple: p => subset(p, 3, false), hiddenTriple: p => subset(p, 3, true),
    xWing: p => fish(p, 2), xyWing, swordfish: p => fish(p, 3), coloring });
  function findLogicalStep(position, { techniques = Object.keys(finders) } = {}) {
    for (const technique of techniques) {
      if (!finders[technique]) throw new RangeError("Unknown logical technique.");
      const found = finders[technique](position);
      if (found) return found;
    }
    return null;
  }
  function applyLogicalStep(p, found) {
    for (const { cell, digit } of found.placements) {
      if (p.board[cell] || !(p.masks[cell] & bit(digit))) throw new Error("Invalid logical placement.");
      p.board[cell] = digit;
      p.masks[cell] = 0;
      B.peers[cell].forEach(peer => { p.masks[peer] &= ~bit(digit); });
    }
    for (const { cell, digit } of found.eliminations) {
      if (!(p.masks[cell] & bit(digit))) throw new Error("Invalid logical elimination.");
      p.masks[cell] &= ~bit(digit);
    }
  }
  function contradictory(p) {
    if (p.board.some((value, cell) => !value && !p.masks[cell])) return true;
    return B.units.some(unit => unit.reduce((mask, cell) => mask | (p.board[cell] ? bit(p.board[cell]) : p.masks[cell]), 0) !== B.ALL);
  }
  function solveLogical(board, options = {}) {
    const steps = [], usage = {};
    let p;
    try { p = createLogicalPosition(board, options.candidates); }
    catch (_) { return { solved: false, stuck: false, status: "invalid", board: Array.isArray(board) ? board.slice() : [], steps, usage, score: 0, hardestTechnique: null, hardestRank: 0, advancedSteps: 0, intermediateSteps: 0, eliminationCount: 0 }; }
    let status;
    while (true) {
      if (contradictory(p)) { status = "invalid"; break; }
      if (p.board.every(Boolean)) { status = "solved"; break; }
      const found = findLogicalStep(p, options);
      if (!found) { status = "stuck"; break; }
      applyLogicalStep(p, found);
      steps.push(found);
      usage[found.technique] = (usage[found.technique] || 0) + 1;
      if (options.stopAfterPlacement && found.placements.length) { status = "partial"; break; }
    }
    const hardest = steps.reduce((best, s) => !best || s.weight > best.weight ? s : best, null);
    // Placement peer cleanup is propagation, not counted as a logical elimination.
    const eliminationCount = steps.reduce((sum, s) => sum + s.eliminations.length, 0);
    return { solved: status === "solved", stuck: status === "stuck", status, board: p.board, candidates: p.masks.map(mask => B.digits[mask].slice()),
      steps, usage, hardestTechnique: hardest ? hardest.technique : null, hardestRank: hardest ? hardest.rank : 0,
      score: steps.reduce((sum, s) => sum + s.weight, 0) + 2 * eliminationCount,
      advancedSteps: steps.filter(s => s.rank >= 4).length, intermediateSteps: steps.filter(s => s.rank === 2 || s.rank === 3).length, eliminationCount };
  }
  Object.assign(Sudoku, { TECHNIQUES, createLogicalPosition, findLogicalStep, applyLogicalStep, solveLogical });
})(window.Sudoku);
