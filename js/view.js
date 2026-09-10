(function (Sudoku) {
  "use strict";

  function createGameView(root) {
    const find = (selector) => root.querySelector(selector);
    const board = find("#board");
    const BOARD_SIZE = 9;
    const CELL_COUNT = BOARD_SIZE * BOARD_SIZE;
    const cells = [];
    const generationAnimations = Object.freeze([
      { id: "ghost-grid", name: "Ghost grid", count: 48 },
      { id: "box-build", name: "Box build", count: 36 },
      { id: "number-rain", name: "Number rain", count: 30 },
      { id: "solver-pulse", name: "Solver pulse", count: 20 }
    ]);
    let activeGenerationAnimation = null;
    let wasGenerating = false;
    let wasComplete = false;
    let persistenceWasAvailable = true;
    const generationOverlay = root.createElement("span");
    generationOverlay.className = "generation-overlay";
    generationOverlay.setAttribute("aria-hidden", "true");
    generationOverlay.hidden = true;
    const refs = {
      timer: find("#timer"), status: find("#game-status"),
      theme: find("#theme"), difficulty: find("#difficulty"),
      selection: find("#selection-label"), selectionHelp: find("#selection-help"),
      erase: find("#erase"), digits: [...root.querySelectorAll("[data-digit]")],
      filled: find("#filled-count"), progress: find("#progress"),
      completion: find("#completion"), completionMessage: find("#completion-message"),
      undo: find("#undo"), redo: find("#redo"), notes: find("#notes"), autoCandidates: find("#auto-candidates"),
      inputHeading: find("#input-heading"), keypad: find("#keypad"), persistence: find("#persistence-status"),
      hint: find("#hint"), solve: find("#solve"), newGame: find("#new-game"), restart: find("#restart"),
      puzzleLabel: find("#puzzle-label"), generation: find("#generation-status"), generationAnimationName: find("#generation-animation-name"), generationError: find("#generation-error"),
      exportGame: find("#export-game"), importGame: find("#import-game"), importFile: find("#import-game-file"),
      fileStatus: find("#file-status"), announcements: find("#live-announcements")
    };

    for (let row = 0; row < BOARD_SIZE; row += 1) {
      const rowElement = root.createElement("div");
      rowElement.className = "board-row";
      rowElement.setAttribute("role", "row");
      rowElement.setAttribute("aria-rowindex", row + 1);
      for (let column = 0; column < BOARD_SIZE; column += 1) {
        const button = root.createElement("button");
        button.type = "button";
        button.className = "cell";
        button.dataset.cell = row * BOARD_SIZE + column;
        button.setAttribute("role", "gridcell");
        button.setAttribute("aria-colindex", column + 1);
        const value = root.createElement("span");
        value.className = "cell-value";
        value.setAttribute("aria-hidden", "true");
        const candidates = root.createElement("span");
        candidates.className = "cell-candidates";
        candidates.setAttribute("aria-hidden", "true");
        candidates.hidden = true;
        const candidateSlots = Array.from({ length: BOARD_SIZE }, () => {
          const slot = root.createElement("span");
          candidates.append(slot);
          return slot;
        });
        button.append(value, candidates);
        rowElement.append(button);
        cells.push({ button, value, candidates, candidateSlots });
      }
      board.append(rowElement);
    }
    // Keep this after the rows so row-based 3×3 box borders retain their
    // actual child positions in the board grid.
    board.append(generationOverlay);

    function shuffledCells() {
      const indexes = Array.from({ length: CELL_COUNT }, (_, index) => index);
      for (let index = indexes.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(Math.random() * (index + 1));
        [indexes[index], indexes[swap]] = [indexes[swap], indexes[index]];
      }
      return indexes;
    }

    function addGenerationDigit(index, order, animation) {
      const digit = root.createElement("span");
      const row = Math.floor(index / BOARD_SIZE);
      const column = index % BOARD_SIZE;
      digit.className = "generation-digit";
      digit.textContent = String(Math.floor(Math.random() * 9) + 1);
      digit.style.left = `${(column + .5) / BOARD_SIZE * 100}%`;
      digit.style.top = `${(row + .5) / BOARD_SIZE * 100}%`;
      const duration = animation.id === "number-rain" ? 1.7 + Math.random() * 1.2 : 1.1 + Math.random() * 1.1;
      digit.style.setProperty("--duration", `${duration}s`);
      digit.style.setProperty("--delay", `${-(order * .13 + Math.random() * duration)}s`);
      generationOverlay.append(digit);
    }

    function startGenerationAnimation() {
      const animation = generationAnimations[Math.floor(Math.random() * generationAnimations.length)];
      activeGenerationAnimation = animation;
      generationOverlay.replaceChildren();
      generationOverlay.className = `generation-overlay is-${animation.id}`;
      generationOverlay.hidden = false;
      refs.generationAnimationName.textContent = animation.name;
      refs.generationAnimationName.hidden = false;

      const cellsForAnimation = shuffledCells();
      if (animation.id === "box-build") {
        const boxes = Array.from({ length: 9 }, (_, box) => box).sort(() => Math.random() - .5);
        boxes.forEach((box, boxOrder) => {
          const boxRow = Math.floor(box / 3) * 3;
          const boxColumn = box % 3 * 3;
          for (let position = 0; position < 4; position += 1) {
            const cell = (boxRow + Math.floor(Math.random() * 3)) * BOARD_SIZE + boxColumn + Math.floor(Math.random() * 3);
            addGenerationDigit(cell, boxOrder * 4 + position, animation);
          }
        });
      } else if (animation.id === "number-rain") {
        cellsForAnimation.slice(0, animation.count).forEach((cell, order) => {
          const digit = root.createElement("span");
          digit.className = "generation-digit";
          digit.textContent = String(Math.floor(Math.random() * 9) + 1);
          digit.style.left = `${Math.random() * 100}%`;
          digit.style.top = `${-15 + Math.random() * 25}%`;
          digit.style.setProperty("--duration", `${1.7 + Math.random() * 1.2}s`);
          digit.style.setProperty("--delay", `${-(order * .1 + Math.random() * 1.5)}s`);
          generationOverlay.append(digit);
        });
      } else {
        cellsForAnimation.slice(0, animation.count).forEach((cell, order) => addGenerationDigit(cell, order, animation));
      }
    }

    function stopGenerationAnimation() {
      activeGenerationAnimation = null;
      generationOverlay.replaceChildren();
      generationOverlay.hidden = true;
      refs.generationAnimationName.textContent = "";
      refs.generationAnimationName.hidden = true;
    }

    function announce(message) {
      if (message && refs.announcements.textContent !== message) refs.announcements.textContent = message;
    }

    function renderCell(state, index) {
      const { button, value, candidates, candidateSlots } = cells[index];
      const digit = state.values[index];
      const given = state.givens[index] !== 0;
      const selected = state.selectedCell;
      const row = Math.floor(index / BOARD_SIZE);
      const column = index % BOARD_SIZE;
      const selectedRow = selected === null ? -1 : Math.floor(selected / BOARD_SIZE);
      const selectedColumn = selected === null ? -1 : selected % BOARD_SIZE;
      const selectedDigit = selected === null ? 0 : state.values[selected];
      const related = selected !== null && (row === selectedRow || column === selectedColumn ||
        (Math.floor(row / 3) === Math.floor(selectedRow / 3) && Math.floor(column / 3) === Math.floor(selectedColumn / 3)));
      const matching = selected !== null && digit !== 0 && digit === state.values[selected];
      const incorrect = Sudoku.isCellIncorrect(state, index);

      button.className = ["cell", given && "is-given", related && "is-related",
        matching && "is-matching", selected === index && "is-selected", incorrect && "is-incorrect"]
        .filter(Boolean).join(" ");
      value.textContent = digit || "";
      const notes = state.candidates[index];
      candidates.hidden = digit !== 0 || given || notes.length === 0;
      candidateSlots.forEach((slot, position) => {
        const candidate = position + 1;
        slot.textContent = notes.includes(candidate) ? candidate : "";
        slot.classList.toggle("is-matching", selectedDigit !== 0 && candidate === selectedDigit && notes.includes(candidate));
      });
      button.tabIndex = index === (selected === null ? 0 : selected) ? 0 : -1;
      button.setAttribute("aria-selected", String(selected === index));
      button.setAttribute("aria-readonly", String(given || state.status === "completed"));
      button.setAttribute("aria-invalid", String(incorrect));
      const cellKind = given ? "given" : state.status === "completed" ? "completed entry" : "editable";
      button.setAttribute("aria-label", `Row ${row + 1}, column ${column + 1}, ${digit || "empty"}, ${cellKind}${incorrect ? ", incorrect" : ""}${notes.length ? ", candidates " + notes.join(", ") : ""}`);
    }

    function render(state) {
      const busy = state.generating;
      root.documentElement.dataset.theme = state.theme === "auto" ? state.systemTheme : state.theme;
      root.documentElement.dataset.appReady = "true";
      refs.theme.value = state.theme;
      refs.difficulty.value = state.difficulty;
      refs.timer.textContent = Sudoku.formatElapsedTime(state.elapsedTime);
      refs.timer.dateTime = `PT${Math.floor(state.elapsedTime / 1000)}S`;
      refs.status.textContent = busy ? "Generating puzzle..." : state.status === "completed" ? "Completed" : state.status === "idle" ? "Ready" : "In progress";
      refs.puzzleLabel.textContent = state.puzzleDifficulty ? `${state.puzzleDifficulty} puzzle` : "Sudoku";
      refs.generation.hidden = !busy;
      board.setAttribute("aria-busy", String(busy));
      board.classList.toggle("is-generating", busy);
      if (busy && !wasGenerating) announce("Generating puzzle.");
      if (busy && activeGenerationAnimation === null) startGenerationAnimation();
      if (!busy && activeGenerationAnimation !== null) stopGenerationAnimation();
      cells.forEach((cell, index) => renderCell(state, index));
      cells.forEach(cell => { cell.button.disabled = busy; });

      const selected = state.selectedCell;
      const editable = !busy && selected !== null && state.givens[selected] === 0 && state.status === "active";
      refs.selection.textContent = selected === null ? "Select a cell" : `R${Math.floor(selected / BOARD_SIZE) + 1} · C${selected % BOARD_SIZE + 1}`;
      const help = state.status === "completed" ? "Puzzle complete. Ready for another?" :
        selected === null ? "Choose any empty cell to begin." : state.givens[selected] ? "This is a given and cannot be changed." :
        state.notesMode ? (state.values[selected] ? "Erase this value before adding notes." : "Type or click a digit to toggle its note.") :
        Sudoku.isCellIncorrect(state, selected) ? "Incorrect entry. Try another number." : "Use the keypad or type a number.";
      // Avoid re-announcing unchanged live-region text on each timer tick.
      if (refs.selectionHelp.textContent !== help) refs.selectionHelp.textContent = help;
      const digitCounts = state.values.reduce((counts, digit) => {
        if (digit !== 0) counts[digit] += 1;
        return counts;
      }, Array(10).fill(0));
      refs.digits.forEach((button) => {
        const digit = Number(button.dataset.digit);
        const isSelectedDigit = selected !== null &&
          (digit === state.values[selected] || state.candidates[selected].includes(digit));
        button.hidden = digitCounts[digit] >= 9;
        button.disabled = button.hidden || !editable || (state.notesMode && state.values[selected] !== 0);
        button.classList.toggle("is-selected-digit", isSelectedDigit);
        button.setAttribute("aria-label", `${state.notesMode ? "Toggle candidate" : "Enter"} ${digit}`);
      });
      refs.erase.disabled = !editable || (state.values[selected] === 0 && state.candidates[selected].length === 0);
      refs.undo.disabled = busy || state.history.length === 0;
      refs.redo.disabled = busy || state.future.length === 0;
      refs.notes.disabled = busy || state.status !== "active";
      refs.notes.setAttribute("aria-pressed", String(state.notesMode));
      refs.autoCandidates.disabled = busy || state.status !== "active";
      refs.hint.disabled = busy || state.status !== "active";
      refs.solve.disabled = busy || state.status !== "active";
      refs.newGame.disabled = busy;
      refs.restart.disabled = busy || state.status === "idle";
      refs.exportGame.disabled = busy || state.status === "idle";
      refs.importGame.disabled = busy;
      refs.importFile.disabled = busy;
      refs.difficulty.disabled = busy;
      refs.inputHeading.textContent = state.notesMode ? "Pencil in notes" : "Place a number";
      refs.keypad.setAttribute("aria-label", state.notesMode ? "Toggle a candidate" : "Enter a number");

      const filled = state.values.filter(Boolean).length;
      refs.filled.replaceChildren(root.createTextNode(`${filled} `));
      const totalLabel = root.createElement("span");
      totalLabel.textContent = "/ 81 filled";
      refs.filled.append(totalLabel);
      refs.progress.value = filled;

      const complete = state.status === "completed";
      const completionText = `You completed the puzzle in ${Sudoku.formatElapsedTime(state.elapsedTime)}.`;
      if (complete && refs.completionMessage.textContent !== completionText) refs.completionMessage.textContent = completionText;
      if (complete && !wasComplete) announce(completionText);
      refs.completion.hidden = !complete;
      if (!complete) refs.completion.classList.remove("is-celebrating");
      wasGenerating = busy;
      wasComplete = complete;
    }

    function focusCell(index) {
      if (index !== null && cells[index]) cells[index].button.focus({ preventScroll: true });
    }

    function renderPersistence(saved) {
      refs.persistence.hidden = saved;
      if (!saved && persistenceWasAvailable) announce(refs.persistence.textContent);
      persistenceWasAvailable = saved;
    }

    function replayAnimation(element, className) {
      element.classList.remove(className);
      // Restart the CSS animation when a player begins another game.
      void element.offsetWidth;
      element.classList.add(className);
    }

    function playGameStartAnimation() { replayAnimation(board, "is-game-starting"); }
    function playCompletionAnimation() { replayAnimation(refs.completion, "is-celebrating"); }

    function renderFileStatus(message, failed = false) {
      refs.fileStatus.textContent = message || "";
      refs.fileStatus.hidden = !message;
      refs.fileStatus.classList.toggle("is-error", Boolean(failed));
      announce(message);
    }

    function renderGenerationError(failed) {
      refs.generationError.hidden = !failed;
      if (failed) announce(refs.generationError.textContent);
    }
    return { render, focusCell, playGameStartAnimation, playCompletionAnimation, renderPersistence, renderFileStatus, renderGenerationError };
  }

  Sudoku.createGameView = createGameView;
})(window.Sudoku = window.Sudoku || {});
