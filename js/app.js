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
  // Extreme's strict acceptance rules can make an unlucky search run for a
  // very long time. Bound only the interactive request; a timeout keeps the
  // current game playable and never substitutes an easier puzzle.
  const EXTREME_GENERATION_TIME_BUDGET_MS = 10_000;
  const MIN_GENERATION_DISPLAY_MS = 1_100;

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

  function exportGame() {
    const state = store.captureState();
    if (state.generating || state.status === "idle") return;
    try {
      const file = new Blob([persistence.exportGame(state)], { type: "application/json" });
      const link = document.createElement("a");
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      link.href = URL.createObjectURL(file);
      link.download = `sudoku-game-${timestamp}.json`;
      link.hidden = true;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(link.href), 0);
      view.renderFileStatus("Game saved to a shareable file.");
    } catch (error) {
      view.renderFileStatus("Could not save this game file.", true);
    }
  }

  async function importGame(event) {
    const file = event.target.files[0];
    event.target.value = ""; // Allow selecting the same file again after an error.
    if (!file || store.getState().generating) return;
    try {
      const importedState = persistence.importGame(await file.text());
      if (store.getState().status !== "idle" && !window.confirm("Load this saved game? Your current game will be replaced.")) return;
      actions.loadState(importedState);
      focusSelection();
      view.renderFileStatus("Game loaded from file.");
    } catch (error) {
      view.renderFileStatus("Could not load that file. Choose a valid Sudoku game file.", true);
    }
  }

  store.subscribe((state, previous, action) => {
    view.render(state);
    syncTimer(state);
    if (action.type === "START_GAME" || action.type === "RESTART_GAME") view.playGameStartAnimation();
    if (state.status === "completed" && previous.status !== "completed" && action.type !== "LOAD_SAVED_STATE") view.playCompletionAnimation();
    // Save all meaningful transitions, with timer-only writes capped at once
    // per second. Capture precise milliseconds again at lifecycle boundaries.
    if (action.type !== "TICK" || Math.floor(state.elapsedTime / 1000) !== lastSavedSecond) saveGame();
  });

  function focusSelection() {
    view.focusCell(store.getState().selectedCell);
  }

  async function startNewGame() {
    const state = store.getState();
    if (state.generating) return;
    const hasProgress = state.values.some((value, cell) => value !== state.givens[cell]) || state.candidates.some(digits => digits.length) || state.history.length || state.future.length;
    if (state.status === "active" && hasProgress && !window.confirm("Abandon this unfinished puzzle and start a new game?")) return;
    actions.setGenerating(true);
    view.renderGenerationError(false);
    const minimumDisplay = new Promise(resolve => window.setTimeout(resolve, MIN_GENERATION_DISPLAY_MS));
    try {
      const puzzle = await Sudoku.generatePuzzle(state.difficulty, state.difficulty === "Extreme" ? {
        maxElapsedMilliseconds: EXTREME_GENERATION_TIME_BUDGET_MS
      } : undefined);
      await minimumDisplay;
      actions.startGame(puzzle);
    } catch (error) {
      await minimumDisplay;
      actions.setGenerating(false);
      view.renderGenerationError(true);
    }
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
    if (store.getState().generating) return;
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
  [["#undo", actions.undo], ["#redo", actions.redo], ["#notes", actions.toggleNotesMode], ["#auto-candidates", actions.autoCandidates], ["#hint", actions.hint]].forEach(([selector, action]) => {
    document.querySelector(selector).addEventListener("click", () => {
      action();
      focusSelection();
    });
  });
  document.querySelector("#new-game").addEventListener("click", startNewGame);
  document.querySelector("#export-game").addEventListener("click", exportGame);
  document.querySelector("#import-game").addEventListener("click", () => {
    const fileInput = document.querySelector("#import-game-file");
    fileInput.value = "";
    fileInput.click();
  });
  document.querySelector("#import-game-file").addEventListener("change", importGame);
  document.querySelector("#solve").addEventListener("click", () => {
    if (store.getState().status === "active" && !store.getState().generating && window.confirm("Reveal the complete solution?")) actions.solve(true);
  });
  document.querySelector("#difficulty").addEventListener("change", (event) => actions.setDifficulty(event.target.value));
  document.querySelector("#theme").addEventListener("change", (event) => actions.setTheme(event.target.value));
  systemTheme.addEventListener("change", (event) => actions.setSystemTheme(event.matches ? "dark" : "light"));
  document.addEventListener("visibilitychange", () => {
    actions.tick();
    saveGame();
  });
  window.addEventListener("pagehide", saveGame);
  window.addEventListener("pageshow", () => { actions.tick(); });

  // A service worker gives hosted copies of the game an offline app shell
  // after the first successful visit. file:// already loads these local files
  // directly and cannot register a service worker, so it is left untouched.
  if ((window.location.protocol === "http:" || window.location.protocol === "https:") &&
      window.isSecureContext && "serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {
      // Offline caching is optional: gameplay must still work if a host
      // forbids service workers or the browser has them disabled.
    });
  }

  actions.setSystemTheme(systemTheme.matches ? "dark" : "light");
  if (!restoredState) startNewGame();
  else {
    view.render(store.getState());
    view.playGameStartAnimation();
    syncTimer(store.getState());
    saveGame();
  }
})(window.Sudoku);
