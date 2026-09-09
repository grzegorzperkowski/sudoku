(function (Sudoku) {
  "use strict";

  const persistence = Sudoku.createPersistence();
  const restoredState = persistence.load();
  const store = Sudoku.createGameStore({ initialState: restoredState });
  const view = Sudoku.createGameView(document);
  const { actions } = store;
  const board = document.querySelector("#board");
  const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
  let timerId = null;
  let lastSavedSecond = -1;

  // Scheduling and browser objects stay outside the serializable game state.
  function syncTimer(state) {
    if (state.status === "active" && timerId === null) {
      timerId = window.setInterval(actions.tick, 250);
    } else if (state.status !== "active" && timerId !== null) {
      window.clearInterval(timerId);
      timerId = null;
    }
  }

  function saveGame() {
    const state = store.captureState();
    if (state.status === "idle") return;
    const saved = persistence.save(state);
    view.renderPersistence(saved);
    lastSavedSecond = Math.floor(state.elapsedTime / 1000);
  }

  store.subscribe((state, previous, action) => {
    view.render(state);
    syncTimer(state);
    // Save all meaningful transitions, with timer-only writes capped at once
    // per second. Capture precise milliseconds again at lifecycle boundaries.
    if (action.type !== "TICK" || Math.floor(state.elapsedTime / 1000) !== lastSavedSecond) saveGame();
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
    if (event.altKey || event.isComposing || event.defaultPrevented) return;
    // Let native form controls and focused toolbar buttons retain their keys.
    if (event.target.closest("input, select, textarea, [contenteditable]:not([contenteditable='false'])")) return;
    if (event.ctrlKey || event.metaKey) {
      const key = event.key.toLowerCase();
      const undo = key === "z" && !event.shiftKey;
      const redo = (key === "y" && !event.shiftKey) || (key === "z" && event.shiftKey);
      const state = store.getState();
      if ((undo && state.history.length) || (redo && state.future.length)) {
        event.preventDefault();
        if (undo) actions.undo();
        else actions.redo();
        focusSelection();
      }
      return;
    }
    if (event.target.closest("button, a") && !board.contains(event.target)) return;
    const directions = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (directions[event.key]) {
      event.preventDefault();
      actions.moveSelection(...directions[event.key]);
      focusSelection();
    } else if (/^[1-9]$/.test(event.key)) {
      event.preventDefault();
      actions.inputDigit(Number(event.key));
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      actions.clearCell();
    }
  });

  document.querySelector("#keypad").addEventListener("click", (event) => {
    const button = event.target.closest("[data-digit]");
    if (!button || button.disabled) return;
    actions.inputDigit(Number(button.dataset.digit));
    focusSelection();
  });
  document.querySelector("#erase").addEventListener("click", () => {
    actions.clearCell();
    focusSelection();
  });
  document.querySelector("#restart").addEventListener("click", actions.restartGame);
  [["#undo", actions.undo], ["#redo", actions.redo], ["#notes", actions.toggleNotesMode], ["#auto-candidates", actions.autoCandidates]].forEach(([selector, action]) => {
    document.querySelector(selector).addEventListener("click", () => {
      action();
      focusSelection();
    });
  });
  document.querySelector("#new-game").addEventListener("click", startNewGame);
  document.querySelector("#difficulty").addEventListener("change", (event) => actions.setDifficulty(event.target.value));
  document.querySelector("#theme").addEventListener("change", (event) => actions.setTheme(event.target.value));
  systemTheme.addEventListener("change", (event) => actions.setSystemTheme(event.matches ? "dark" : "light"));
  document.addEventListener("visibilitychange", () => {
    actions.tick();
    saveGame();
  });
  window.addEventListener("pagehide", saveGame);
  window.addEventListener("pageshow", () => { actions.tick(); });

  actions.setSystemTheme(systemTheme.matches ? "dark" : "light");
  if (!restoredState) startNewGame();
  else {
    view.render(store.getState());
    syncTimer(store.getState());
    saveGame();
  }
})(window.Sudoku);
