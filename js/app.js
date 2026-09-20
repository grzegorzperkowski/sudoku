(function (Sudoku) {
  "use strict";

  const persistence = Sudoku.createPersistence();
  const restoredState = persistence.load();
  const store = Sudoku.createGameStore({ initialState: restoredState });
  const view = Sudoku.createGameView(document);
  const { actions } = store;
  const elements = Object.freeze({
    board: document.querySelector("#board"),
    keypad: document.querySelector("#keypad"),
    erase: document.querySelector("#erase"),
    undo: document.querySelector("#undo"),
    redo: document.querySelector("#redo"),
    notes: document.querySelector("#notes"),
    autoCandidates: document.querySelector("#auto-candidates"),
    hint: document.querySelector("#hint"),
    solve: document.querySelector("#solve"),
    restart: document.querySelector("#restart"),
    newGame: document.querySelector("#new-game"),
    exportGame: document.querySelector("#export-game"),
    importGame: document.querySelector("#import-game"),
    importFile: document.querySelector("#import-game-file"),
    difficulty: document.querySelector("#difficulty"),
    themeToggle: document.querySelector("#theme-toggle"),
    confirmDialog: document.querySelector("#confirm-dialog"),
    confirmKicker: document.querySelector("#confirm-kicker"),
    confirmTitle: document.querySelector("#confirm-title"),
    confirmDescription: document.querySelector("#confirm-description"),
    confirmCancel: document.querySelector("#confirm-cancel"),
    confirmAccept: document.querySelector("#confirm-accept")
  });
  const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
  const KEYBOARD_DIRECTIONS = Object.freeze({
    ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1]
  });
  let timerId = null;
  let lastSavedSecond = -1;
  // Extreme's strict acceptance rules can make an unlucky search run for a
  // very long time. Bound only the interactive request; a timeout keeps the
  // current game playable and never substitutes an easier puzzle.
  const EXTREME_GENERATION_TIME_BUDGET_MS = 10_000;
  const MIN_GENERATION_DISPLAY_MS = 1_100;
  const RESULT_STORAGE_KEY = "playground.result.sudoku.v1";
  const CONFIRM_COPY = Object.freeze({
    newGame: {
      kicker: "NEW PUZZLE",
      title: "Abandon this unfinished puzzle?",
      description: "Starting a new game will replace your current progress.",
      acceptLabel: "New Game",
      announce: "Abandon this unfinished puzzle and start a new game? Cancel to keep this puzzle, or New Game to start over."
    },
    import: {
      kicker: "LOAD FILE",
      title: "Load this saved game?",
      description: "Your current game will be replaced.",
      acceptLabel: "Load game",
      announce: "Load this saved game? Your current game will be replaced. Cancel to keep this puzzle, or Load game to replace it."
    },
    solve: {
      kicker: "ASSISTANCE",
      title: "Reveal the complete solution?",
      description: "This fills every empty cell and ends the puzzle.",
      acceptLabel: "Reveal",
      announce: "Reveal the complete solution? Cancel to keep solving, or Reveal to fill the board."
    }
  });
  let pendingConfirmAction = null;

  function saveCompletedResult(state) {
    try {
      const previous = JSON.parse(window.localStorage.getItem(RESULT_STORAGE_KEY));
      const stats = previous?.version === 1 && previous.app === "sudoku" && previous.stats && typeof previous.stats === "object" ? previous.stats : {};
      const completedCount = (Number.isSafeInteger(stats.completedCount) ? stats.completedCount : 0) + 1;
      const fastestTimes = stats.fastestTimes && typeof stats.fastestTimes === "object" ? { ...stats.fastestTimes } : {};
      fastestTimes[state.difficulty] = Math.min(Number(fastestTimes[state.difficulty]) || Infinity, state.elapsedTime);
      const fastest = Object.entries(fastestTimes).sort((a, b) => a[1] - b[1])[0];
      const formatTime = milliseconds => {
        const seconds = Math.floor(milliseconds / 1000);
        return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
      };
      window.localStorage.setItem(RESULT_STORAGE_KEY, JSON.stringify({
        version: 1, app: "sudoku", updatedAt: Date.now(),
        summary: { primary: `${completedCount} completed`, secondary: fastest ? `${fastest[0]} best: ${formatTime(fastest[1])}` : "" },
        stats: { completedCount, fastestTimes, last: { difficulty: state.difficulty, elapsedMs: state.elapsedTime, completedAt: Date.now() } }
      }));
    } catch { /* Results are optional when storage is unavailable. */ }
  }

  // Scheduling and browser objects stay outside the serializable game state.
  function syncTimer(state) {
    const shouldRun = state.status === "active" && !elements.confirmDialog.open;
    if (shouldRun && timerId === null) {
      timerId = window.setInterval(actions.tick, 250);
    } else if (!shouldRun && timerId !== null) {
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
    } catch {
      view.renderFileStatus("Could not save this game file.", true);
    }
  }

  async function importGame(event) {
    const file = event.target.files[0];
    event.target.value = ""; // Allow selecting the same file again after an error.
    if (!file || store.getState().generating) return;
    try {
      const importedState = persistence.importGame(await file.text());
      const loadImported = () => {
        actions.loadState(importedState);
        focusSelection();
        view.renderFileStatus("Game loaded from file.");
      };
      if (store.getState().status !== "idle") {
        openConfirm("import", loadImported);
        return;
      }
      loadImported();
    } catch {
      view.renderFileStatus("Could not load that file. Choose a valid Sudoku game file.", true);
    }
  }

  store.subscribe((state, previous, action) => {
    view.render(state);
    syncTimer(state);
    if (action.type === "START_GAME" || action.type === "RESTART_GAME") view.playGameStartAnimation();
    if (state.status === "completed" && previous.status !== "completed" && action.type !== "LOAD_SAVED_STATE") {
      view.playCompletionAnimation();
      if (action.type !== "SOLVE") saveCompletedResult(state);
    }
    // Save all meaningful transitions, with timer-only writes capped at once
    // per second. Capture precise milliseconds again at lifecycle boundaries.
    if (action.type !== "TICK" || Math.floor(state.elapsedTime / 1000) !== lastSavedSecond) saveGame();
  });

  function focusSelection() {
    view.focusCell(store.getState().selectedCell);
  }

  async function startNewGame() {
    const state = store.getState();
    if (state.generating || elements.confirmDialog.open) return;
    if (state.status === "active" && gameHasProgress(state)) {
      openConfirm("newGame", () => { void beginNewGame(); });
      return;
    }
    await beginNewGame();
  }

  async function beginNewGame() {
    const state = store.getState();
    if (state.generating) return;
    actions.setGenerating(true);
    view.renderGenerationError(false);
    const minimumDisplay = new Promise(resolve => window.setTimeout(resolve, MIN_GENERATION_DISPLAY_MS));
    try {
      const puzzle = await Sudoku.generatePuzzle(state.difficulty, state.difficulty === "Extreme" ? {
        maxElapsedMilliseconds: EXTREME_GENERATION_TIME_BUDGET_MS
      } : undefined);
      await minimumDisplay;
      actions.startGame(puzzle);
    } catch {
      await minimumDisplay;
      actions.setGenerating(false);
      view.renderGenerationError(true);
    }
  }

  function openConfirm(kind, onAccept, onCancel) {
    const copy = CONFIRM_COPY[kind];
    if (!copy || elements.confirmDialog.open) return;
    actions.tick();
    saveGame();
    pendingConfirmAction = { onAccept, onCancel };
    elements.confirmKicker.textContent = copy.kicker;
    elements.confirmTitle.textContent = copy.title;
    elements.confirmDescription.textContent = copy.description;
    elements.confirmAccept.textContent = copy.acceptLabel;
    elements.confirmDialog.dataset.kind = kind;
    elements.confirmDialog.setAttribute("role", "alertdialog");
    elements.confirmDialog.showModal();
    elements.confirmCancel.focus();
    syncTimer(store.getState());
    view.announce(copy.announce);
  }

  function closeConfirm() {
    pendingConfirmAction = null;
    if (elements.confirmDialog.open) elements.confirmDialog.close();
    elements.confirmDialog.removeAttribute("data-kind");
    elements.confirmDialog.setAttribute("role", "dialog");
    syncTimer(store.getState());
  }

  function cancelConfirm() {
    const cancel = pendingConfirmAction?.onCancel;
    closeConfirm();
    if (cancel) cancel();
    view.announce("Action cancelled.");
  }

  function acceptConfirm() {
    const accept = pendingConfirmAction?.onAccept;
    closeConfirm();
    if (accept) accept();
  }

  function gameHasProgress(state) {
    return state.values.some((value, cell) => value !== state.givens[cell]) ||
      state.candidates.some(digits => digits.length > 0) || state.history.length > 0 || state.future.length > 0;
  }

  function selectBoardCell(event, focus = true) {
    const cell = event.target.closest("[data-cell]");
    if (!cell || !elements.board.contains(cell)) return;
    actions.selectCell(Number(cell.dataset.cell));
    if (focus) focusSelection();
  }

  function handleBoardFocus(event) {
    selectBoardCell(event, false);
  }

  function handleKeyboardInput(event) {
    if (store.getState().generating || elements.confirmDialog.open) return;
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
    if (event.target.closest("button, a") && !elements.board.contains(event.target)) return;
    if (KEYBOARD_DIRECTIONS[event.key]) {
      event.preventDefault();
      actions.moveSelection(...KEYBOARD_DIRECTIONS[event.key]);
      focusSelection();
    } else if (/^[1-9]$/.test(event.key)) {
      event.preventDefault();
      actions.inputDigit(Number(event.key));
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      actions.clearCell();
    }
  }

  function handleKeypadClick(event) {
    const button = event.target.closest("[data-digit]");
    if (!button || button.disabled) return;
    actions.inputDigit(Number(button.dataset.digit));
    focusSelection();
  }

  function eraseSelectedCell() {
    actions.clearCell();
    focusSelection();
  }

  function openImportDialog() {
    elements.importFile.value = "";
    elements.importFile.click();
  }

  function confirmSolve() {
    const state = store.getState();
    if (state.status !== "active" || state.generating || elements.confirmDialog.open) return;
    openConfirm("solve", () => actions.solve(true));
  }

  function dispatchAndFocus(action) {
    return () => {
      action();
      focusSelection();
    };
  }

  function saveOnVisibilityChange() {
    actions.tick();
    saveGame();
  }

  function bindEventListeners() {
    elements.board.addEventListener("click", selectBoardCell);
    elements.board.addEventListener("focusin", handleBoardFocus);
    document.addEventListener("keydown", handleKeyboardInput);
    elements.keypad.addEventListener("click", handleKeypadClick);
    elements.erase.addEventListener("click", eraseSelectedCell);
    elements.restart.addEventListener("click", actions.restartGame);
    [[elements.undo, actions.undo], [elements.redo, actions.redo], [elements.notes, actions.toggleNotesMode],
      [elements.autoCandidates, actions.autoCandidates], [elements.hint, actions.hint]]
      .forEach(([element, action]) => element.addEventListener("click", dispatchAndFocus(action)));
    elements.newGame.addEventListener("click", startNewGame);
    elements.exportGame.addEventListener("click", exportGame);
    elements.importGame.addEventListener("click", openImportDialog);
    elements.importFile.addEventListener("change", importGame);
    elements.solve.addEventListener("click", confirmSolve);
    elements.confirmCancel.addEventListener("click", cancelConfirm);
    elements.confirmAccept.addEventListener("click", acceptConfirm);
    elements.confirmDialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      cancelConfirm();
    });
    elements.difficulty.addEventListener("change", (event) => actions.setDifficulty(event.target.value));
    elements.themeToggle.addEventListener("click", () => {
      const state = store.getState();
      const resolvedTheme = state.theme === "auto" ? state.systemTheme : state.theme;
      actions.setTheme(resolvedTheme === "dark" ? "light" : "dark");
    });
    systemTheme.addEventListener("change", (event) => actions.setSystemTheme(event.matches ? "dark" : "light"));
    document.addEventListener("visibilitychange", saveOnVisibilityChange);
    window.addEventListener("pagehide", saveGame);
    window.addEventListener("pageshow", actions.tick);
  }

  bindEventListeners();

  actions.setSystemTheme(systemTheme.matches ? "dark" : "light");
  if (!restoredState) startNewGame();
  else {
    view.render(store.getState());
    view.playGameStartAnimation();
    syncTimer(store.getState());
    saveGame();
  }
})(window.Sudoku);
