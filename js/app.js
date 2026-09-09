(function (Sudoku) {
  "use strict";

  const store = Sudoku.createGameStore();
  const view = Sudoku.createGameView(document);
  const { actions } = store;
  const board = document.querySelector("#board");
  const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
  let timerId = null;

  // Scheduling and browser objects stay outside the serializable game state.
  function syncTimer(state) {
    if (state.status === "active" && timerId === null) {
      timerId = window.setInterval(actions.tick, 250);
    } else if (state.status !== "active" && timerId !== null) {
      window.clearInterval(timerId);
      timerId = null;
    }
  }

  store.subscribe((state) => {
    view.render(state);
    syncTimer(state);
  });

  function focusSelection() {
    view.focusCell(store.getState().selectedCell);
  }

  function startNewGame() {
    // Phase 3 replaces this provider; the store and view only consume puzzle data.
    actions.startGame(Sudoku.getDevelopmentPuzzle(store.getState().difficulty));
  }

  board.addEventListener("click", (event) => {
    const cell = event.target.closest("[data-cell]");
    if (!cell) return;
    actions.selectCell(Number(cell.dataset.cell));
    focusSelection();
  });

  board.addEventListener("focusin", (event) => {
    const cell = event.target.closest("[data-cell]");
    if (cell) actions.selectCell(Number(cell.dataset.cell));
  });

  document.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
    // Let native form controls and focused toolbar buttons retain their keys.
    if (event.target.closest("input, select, textarea, [contenteditable]:not([contenteditable='false'])")) return;
    if (event.target.closest("button, a") && !board.contains(event.target)) return;
    const directions = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (directions[event.key]) {
      event.preventDefault();
      actions.moveSelection(...directions[event.key]);
      focusSelection();
    } else if (/^[1-9]$/.test(event.key)) {
      event.preventDefault();
      actions.setCellValue(Number(event.key));
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      actions.clearCell();
    }
  });

  document.querySelector("#keypad").addEventListener("click", (event) => {
    const button = event.target.closest("[data-digit]");
    if (!button || button.disabled) return;
    actions.setCellValue(Number(button.dataset.digit));
    focusSelection();
  });
  document.querySelector("#erase").addEventListener("click", () => {
    actions.clearCell();
    focusSelection();
  });
  document.querySelector("#restart").addEventListener("click", actions.restartGame);
  document.querySelector("#new-game").addEventListener("click", startNewGame);
  document.querySelector("#difficulty").addEventListener("change", (event) => actions.setDifficulty(event.target.value));
  document.querySelector("#theme").addEventListener("change", (event) => actions.setTheme(event.target.value));
  systemTheme.addEventListener("change", (event) => actions.setSystemTheme(event.matches ? "dark" : "light"));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) actions.tick();
  });

  actions.setSystemTheme(systemTheme.matches ? "dark" : "light");
  startNewGame();
})(window.Sudoku);
