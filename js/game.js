(function (global) {
  "use strict";

  const Sudoku = global.Sudoku = global.Sudoku || {};
  const DIFFICULTIES = Object.freeze(["Easy", "Normal", "Hard", "Expert", "Extreme"]);
  const CELL_COUNT = 81;

  function deepFreeze(value) {
    if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
      return value;
    }
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  }

  function emptyCandidates() {
    return Array.from({ length: CELL_COUNT }, () => []);
  }

  function createInitialState() {
    return deepFreeze({
      givens: Array(CELL_COUNT).fill(0),
      solution: Array(CELL_COUNT).fill(0),
      values: Array(CELL_COUNT).fill(0),
      candidates: emptyCandidates(),
      selectedCell: null,
      difficulty: "Normal",
      puzzleDifficulty: null,
      generating: false,
      status: "idle",
      elapsedTime: 0,
      theme: "auto",
      systemTheme: "light",
      notesMode: false,
      history: [],
      future: []
    });
  }

  function isCellIndex(index) {
    return Number.isInteger(index) && index >= 0 && index < CELL_COUNT;
  }

  function isCellIncorrect(state, index) {
    return isCellIndex(index) && state.values[index] !== 0 &&
      state.values[index] !== state.solution[index];
  }

  function isComplete(state) {
    return state.values.length === CELL_COUNT && state.values.every((value, index) =>
      value !== 0 && value === state.solution[index]);
  }

  function formatElapsedTime(milliseconds) {
    const totalSeconds = Math.floor(Math.max(0, milliseconds) / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor(totalSeconds / 60) % 60;
    const seconds = totalSeconds % 60;
    return [hours, minutes, seconds].map(value => String(value).padStart(2, "0")).join(":");
  }

  function validateDigits(values, name, minimum) {
    if (!Array.isArray(values) || values.length !== CELL_COUNT) {
      throw new TypeError(`${name} must be an array of 81 digits.`);
    }
    // Array.from also exposes holes, so sparse arrays cannot pass validation.
    if (!Array.from(values).every(value => Number.isInteger(value) && value >= minimum && value <= 9)) {
      throw new RangeError(`${name} must contain integers from ${minimum} to 9.`);
    }
  }

  function validatePuzzle(puzzleData, fallbackDifficulty) {
    if (!puzzleData || typeof puzzleData !== "object") {
      throw new TypeError("startGame requires puzzle data.");
    }
    const { givens, solution } = puzzleData;
    const difficulty = puzzleData.difficulty === undefined ? fallbackDifficulty : puzzleData.difficulty;
    validateDigits(givens, "givens", 0);
    validateDigits(solution, "solution", 1);
    if (!DIFFICULTIES.includes(difficulty)) {
      throw new RangeError("Unknown difficulty.");
    }
    if (!givens.every((value, index) => value === 0 || value === solution[index])) {
      throw new RangeError("Every given must match its solution digit.");
    }

    if (!Sudoku.Board.isValidBoard(solution, true) || Sudoku.countSolutions(givens) !== 1) {
      throw new RangeError("The puzzle must have exactly one valid solution.");
    }
    const puzzleDifficulty = puzzleData.puzzleDifficulty === undefined ? null : puzzleData.puzzleDifficulty;
    if (puzzleDifficulty !== null && (!DIFFICULTIES.includes(puzzleDifficulty) || Sudoku.analyzeDifficulty(givens).difficulty !== puzzleDifficulty)) {
      throw new RangeError("The puzzle's logical difficulty does not match its rating.");
    }
    return { givens: givens.slice(), solution: solution.slice(), difficulty, puzzleDifficulty };
  }

  function startPuzzle(state, puzzleData) {
    const puzzle = validatePuzzle(puzzleData, state.difficulty);
    const nextState = {
      ...state,
      givens: puzzle.givens,
      solution: puzzle.solution,
      values: puzzle.givens.slice(),
      candidates: emptyCandidates(),
      selectedCell: null,
      difficulty: puzzle.difficulty,
      puzzleDifficulty: puzzle.puzzleDifficulty,
      generating: false,
      status: "active",
      elapsedTime: 0,
      history: [],
      future: []
    };
    if (isComplete(nextState)) nextState.status = "completed";
    return nextState;
  }

  function isPeer(first, second) {
    return Sudoku.Board.isPeer(first, second);
  }

  function canEdit(state) {
    return state.status === "active" && state.selectedCell !== null && state.givens[state.selectedCell] === 0;
  }

  function updateCellValue(state, value, elapsedTime, index = state.selectedCell) {
    if (!canEdit({ ...state, selectedCell: index }) || (state.values[index] === value && state.candidates[index].length === 0)) {
      return state;
    }
    const values = state.values.slice();
    values[index] = value;
    const candidates = state.candidates.map((digits, peer) => {
      if (peer === index) return [];
      // Deletion never regenerates notes. Each peer is visited once, even if it
      // shares both a row/column and box with the entered cell.
      return value !== 0 && isPeer(index, peer) ? digits.filter(digit => digit !== value) : digits;
    });
    const nextState = { ...state, values, candidates };
    if (isComplete(nextState)) {
      nextState.status = "completed";
      nextState.elapsedTime = elapsedTime;
    }
    return nextState;
  }

  function toggleCandidate(state, digit) {
    if (!canEdit(state) || state.values[state.selectedCell] !== 0 || !Number.isInteger(digit) || digit < 1 || digit > 9) return state;
    const candidates = state.candidates.slice();
    const previous = candidates[state.selectedCell];
    candidates[state.selectedCell] = previous.includes(digit) ? previous.filter(value => value !== digit) :
      [...previous, digit].sort((a, b) => a - b);
    return { ...state, candidates };
  }

  function autoCandidates(state) {
    if (state.status !== "active") return state;
    const candidates = state.values.map((value, index) => {
      if (value !== 0 || state.givens[index] !== 0) return [];
      const occupied = new Set(state.values.filter((digit, peer) => isPeer(index, peer)));
      return Array.from({ length: 9 }, (_, digit) => digit + 1).filter(digit => !occupied.has(digit));
    });
    return candidates.every((digits, index) => digits.join() === state.candidates[index].join()) ? state : { ...state, candidates };
  }

  // Snapshots contain only gameplay data, never history, puzzle input, settings,
  // or clocks. Frozen nested arrays can safely be shared between snapshots.
  function gameplaySnapshot(state) {
    return { values: state.values, candidates: state.candidates, status: state.status };
  }

  function travelHistory(state, undo) {
    const source = undo ? state.history : state.future;
    if (source.length === 0) return state;
    const snapshot = source[source.length - 1];
    return {
      ...state, ...snapshot,
      history: undo ? source.slice(0, -1) : [...state.history, gameplaySnapshot(state)],
      future: undo ? [...state.future, gameplaySnapshot(state)] : source.slice(0, -1)
    };
  }

  function reduceGameState(state, action) {
    if (state.generating && !["START_GAME", "SET_GENERATING", "SET_THEME", "SET_SYSTEM_THEME", "TICK"].includes(action.type)) return state;
    switch (action.type) {
      case "SET_GENERATING":
        return typeof action.generating !== "boolean" || action.generating === state.generating ? state : { ...state, generating: action.generating };
      case "START_GAME":
        return startPuzzle(state, action.puzzleData);
      case "RESTART_GAME":
        return state.status === "idle" ? state : startPuzzle(state, state);
      case "SELECT_CELL":
        return !isCellIndex(action.index) || action.index === state.selectedCell ? state :
          { ...state, selectedCell: action.index };
      case "MOVE_SELECTION": {
        if (!Number.isInteger(action.deltaRow) || !Number.isInteger(action.deltaColumn)) return state;
        const current = state.selectedCell;
        const row = current === null ? 0 : Math.min(8, Math.max(0, Math.floor(current / 9) + action.deltaRow));
        const column = current === null ? 0 : Math.min(8, Math.max(0, current % 9 + action.deltaColumn));
        const selectedCell = row * 9 + column;
        return selectedCell === current ? state : { ...state, selectedCell };
      }
      case "SET_CELL_VALUE":
        return !Number.isInteger(action.value) || action.value < 1 || action.value > 9 ? state :
          updateCellValue(state, action.value, action.elapsedTime);
      case "CLEAR_CELL":
        return updateCellValue(state, 0, action.elapsedTime);
      case "INPUT_DIGIT":
        return state.notesMode ? toggleCandidate(state, action.value) :
          reduceGameState(state, { ...action, type: "SET_CELL_VALUE" });
      case "TOGGLE_CANDIDATE":
        return toggleCandidate(state, action.value);
      case "AUTO_CANDIDATES":
        return autoCandidates(state);
      case "HINT": {
        if (state.status !== "active") return state;
        // Player notes are not solver candidates. Ignore incorrect entries when
        // looking for a placement; a Hint may correct exactly one wrong cell.
        const clean = state.values.map((value, cell) => value === state.solution[cell] ? value : 0);
        const report = Sudoku.solveLogical(clean, { stopAfterPlacement: true });
        const placement = report.steps.flatMap(step => step.placements)[0];
        const cell = placement ? placement.cell : clean.findIndex(value => !value);
        return cell < 0 ? state : updateCellValue(state, state.solution[cell], action.elapsedTime, cell);
      }
      case "SOLVE":
        return state.status !== "active" || action.confirmed !== true ? state :
          { ...state, values: state.solution.slice(), candidates: emptyCandidates(), status: "completed" };
      case "TOGGLE_NOTES_MODE":
        return { ...state, notesMode: !state.notesMode };
      case "UNDO":
        return travelHistory(state, true);
      case "REDO":
        return travelHistory(state, false);
      case "SET_DIFFICULTY":
        return !DIFFICULTIES.includes(action.difficulty) || action.difficulty === state.difficulty ? state :
          { ...state, difficulty: action.difficulty };
      case "SET_THEME":
        return !["auto", "light", "dark"].includes(action.theme) || action.theme === state.theme ? state :
          { ...state, theme: action.theme };
      case "SET_SYSTEM_THEME":
        return !["light", "dark"].includes(action.theme) || action.theme === state.systemTheme ? state :
          { ...state, systemTheme: action.theme };
      case "TICK":
        return state.status !== "active" || action.elapsedTime === state.elapsedTime ? state :
          { ...state, elapsedTime: action.elapsedTime };
      default:
        return state;
    }
  }

  function validateSavedState(saved) {
    const puzzle = validatePuzzle(saved, "Normal");
    function validateSnapshot(snapshot) {
      if (!snapshot || typeof snapshot !== "object" || Object.keys(snapshot).some(key => !["values", "candidates", "status"].includes(key))) {
        throw new TypeError("Invalid gameplay snapshot.");
      }
      validateDigits(snapshot.values, "values", 0);
      if (!puzzle.givens.every((value, index) => value === 0 || value === snapshot.values[index])) throw new TypeError("Saved givens were changed.");
      if (!Array.isArray(snapshot.candidates) || snapshot.candidates.length !== CELL_COUNT) throw new TypeError("Invalid candidates.");
      const candidates = Array.from(snapshot.candidates, (digits, index) => {
        if (!Array.isArray(digits) || digits.length > 9 || !Array.from(digits).every(digit => Number.isInteger(digit) && digit >= 1 && digit <= 9) ||
            new Set(digits).size !== digits.length || (snapshot.values[index] !== 0 && digits.length !== 0)) throw new TypeError("Invalid candidate digits.");
        return digits.slice().sort((a, b) => a - b);
      });
      const status = isComplete({ values: snapshot.values, solution: puzzle.solution }) ? "completed" : "active";
      if (snapshot.status !== status) throw new TypeError("Invalid saved status.");
      return { values: snapshot.values.slice(), candidates, status };
    }
    const gameplay = validateSnapshot(gameplaySnapshot(saved));
    if (!Number.isSafeInteger(saved.elapsedTime) || saved.elapsedTime < 0) throw new TypeError("Invalid elapsed time.");
    if (!Array.isArray(saved.history) || !Array.isArray(saved.future)) throw new TypeError("Invalid history.");
    const selectedCell = saved.selectedCell === undefined ? null : saved.selectedCell;
    const theme = saved.theme === undefined ? "auto" : saved.theme;
    const notesMode = saved.notesMode === undefined ? false : saved.notesMode;
    if ((selectedCell !== null && !isCellIndex(selectedCell)) || !["auto", "light", "dark"].includes(theme) || typeof notesMode !== "boolean") {
      throw new TypeError("Invalid saved settings.");
    }
    return deepFreeze({
      ...createInitialState(), ...puzzle, ...gameplay, selectedCell, theme, notesMode,
      elapsedTime: saved.elapsedTime,
      history: Array.from(saved.history, validateSnapshot), future: Array.from(saved.future, validateSnapshot)
    });
  }

  function createGameStore({ now, initialState } = {}) {
    const clock = now || (() => global.performance ? global.performance.now() : Date.now());
    let state = initialState ? validateSavedState(initialState) : createInitialState();
    let startedAt = null;
    const listeners = new Set();

    function readClock() {
      const timestamp = clock();
      if (!Number.isFinite(timestamp)) throw new TypeError("The game clock must return a finite timestamp.");
      return timestamp;
    }

    function currentElapsedTime() {
      if (state.status !== "active" || startedAt === null) return state.elapsedTime;
      // Wall-clock differences remain accurate even if a background tab delays ticks.
      return Math.max(state.elapsedTime, Math.floor(readClock() - startedAt), 0);
    }

    function dispatch(action) {
      action = { ...action, elapsedTime: currentElapsedTime() };
      const previousState = state;
      let nextState = reduceGameState(previousState, action);
      if (nextState === previousState) return state;

      const edit = ["SET_CELL_VALUE", "CLEAR_CELL", "INPUT_DIGIT", "TOGGLE_CANDIDATE", "AUTO_CANDIDATES", "HINT", "SOLVE"].includes(action.type);
      if (edit) {
        nextState = { ...nextState, history: [...state.history, gameplaySnapshot(state)], future: [] };
      }

      if (action.type === "START_GAME" || action.type === "RESTART_GAME") {
        startedAt = nextState.status === "active" ? readClock() : null;
      } else {
        nextState = { ...nextState, elapsedTime: action.elapsedTime };
        if (nextState.status !== "active") startedAt = null;
        else if (previousState.status !== "active") startedAt = readClock() - nextState.elapsedTime;
      }

      state = deepFreeze(nextState);
      // Runtime listeners and clock anchors never enter the serializable state.
      Array.from(listeners).forEach(listener => listener(nextState, previousState, action));
      return nextState;
    }

    if (state.status === "active") startedAt = readClock() - state.elapsedTime;

    return Object.freeze({
      getState: () => state,
      captureState: () => deepFreeze({ ...state, elapsedTime: currentElapsedTime() }),
      subscribe(listener) {
        if (typeof listener !== "function") throw new TypeError("A state subscriber must be a function.");
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      actions: Object.freeze({
        startGame: puzzleData => dispatch({ type: "START_GAME", puzzleData }),
        setGenerating: generating => dispatch({ type: "SET_GENERATING", generating }),
        restartGame: () => dispatch({ type: "RESTART_GAME" }),
        selectCell: index => dispatch({ type: "SELECT_CELL", index }),
        moveSelection: (deltaRow, deltaColumn) => dispatch({ type: "MOVE_SELECTION", deltaRow, deltaColumn }),
        setCellValue: value => dispatch({ type: "SET_CELL_VALUE", value }),
        inputDigit: value => dispatch({ type: "INPUT_DIGIT", value }),
        toggleCandidate: value => dispatch({ type: "TOGGLE_CANDIDATE", value }),
        toggleNotesMode: () => dispatch({ type: "TOGGLE_NOTES_MODE" }),
        autoCandidates: () => dispatch({ type: "AUTO_CANDIDATES" }),
        hint: () => dispatch({ type: "HINT" }),
        solve: (confirmed = false) => dispatch({ type: "SOLVE", confirmed }),
        undo: () => dispatch({ type: "UNDO" }),
        redo: () => dispatch({ type: "REDO" }),
        clearCell: () => dispatch({ type: "CLEAR_CELL" }),
        setDifficulty: difficulty => dispatch({ type: "SET_DIFFICULTY", difficulty }),
        setTheme: theme => dispatch({ type: "SET_THEME", theme }),
        setSystemTheme: theme => dispatch({ type: "SET_SYSTEM_THEME", theme }),
        tick: () => dispatch({ type: "TICK" })
      })
    });
  }

  Object.assign(Sudoku, {
    DIFFICULTIES,
    createGameStore,
    validateSavedState,
    isCellIncorrect,
    isComplete,
    formatElapsedTime
  });
})(window);
