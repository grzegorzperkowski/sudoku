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
      status: "idle",
      elapsedTime: 0,
      theme: "auto",
      systemTheme: "light",
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

    // This checks the supplied solution, without solving or checking uniqueness.
    for (let unit = 0; unit < 9; unit += 1) {
      const row = new Set();
      const column = new Set();
      const box = new Set();
      const boxRow = Math.floor(unit / 3) * 3;
      const boxColumn = (unit % 3) * 3;
      for (let offset = 0; offset < 9; offset += 1) {
        row.add(solution[unit * 9 + offset]);
        column.add(solution[offset * 9 + unit]);
        box.add(solution[(boxRow + Math.floor(offset / 3)) * 9 + boxColumn + offset % 3]);
      }
      if (row.size !== 9 || column.size !== 9 || box.size !== 9) {
        throw new RangeError("The supplied solution must satisfy every Sudoku row, column, and box.");
      }
    }
    return { givens: givens.slice(), solution: solution.slice(), difficulty };
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
      status: "active",
      elapsedTime: 0,
      history: [],
      future: []
    };
    if (isComplete(nextState)) nextState.status = "completed";
    return nextState;
  }

  function updateCellValue(state, value, elapsedTime) {
    const index = state.selectedCell;
    if (state.status !== "active" || index === null || state.givens[index] !== 0 || state.values[index] === value) {
      return state;
    }
    const values = state.values.slice();
    values[index] = value;
    const nextState = { ...state, values };
    if (isComplete(nextState)) {
      nextState.status = "completed";
      nextState.elapsedTime = elapsedTime;
    }
    return nextState;
  }

  // One reducer boundary keeps each edit atomic. Phase 2 can capture values and
  // candidates together here, including exact before/after candidate snapshots.
  function reduceGameState(state, action) {
    switch (action.type) {
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

  function createGameStore({ now } = {}) {
    const clock = now || (() => global.performance ? global.performance.now() : Date.now());
    let state = createInitialState();
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
      if (["SET_CELL_VALUE", "CLEAR_CELL", "TICK"].includes(action.type)) {
        action = { ...action, elapsedTime: currentElapsedTime() };
      }
      const previousState = state;
      const nextState = reduceGameState(previousState, action);
      if (nextState === previousState) return state;

      if (action.type === "START_GAME" || action.type === "RESTART_GAME") {
        startedAt = nextState.status === "active" ? readClock() : null;
      } else if (nextState.status !== "active") {
        startedAt = null;
      }

      state = deepFreeze(nextState);
      // Runtime listeners and clock anchors never enter the serializable state.
      Array.from(listeners).forEach(listener => listener(nextState, previousState, action));
      return nextState;
    }

    return Object.freeze({
      getState: () => state,
      subscribe(listener) {
        if (typeof listener !== "function") throw new TypeError("A state subscriber must be a function.");
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      actions: Object.freeze({
        startGame: puzzleData => dispatch({ type: "START_GAME", puzzleData }),
        restartGame: () => dispatch({ type: "RESTART_GAME" }),
        selectCell: index => dispatch({ type: "SELECT_CELL", index }),
        moveSelection: (deltaRow, deltaColumn) => dispatch({ type: "MOVE_SELECTION", deltaRow, deltaColumn }),
        setCellValue: value => dispatch({ type: "SET_CELL_VALUE", value }),
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
    isCellIncorrect,
    isComplete,
    formatElapsedTime
  });
})(window);
