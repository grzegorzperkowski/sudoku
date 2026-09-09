(function (Sudoku) {
  "use strict";

  function createGameView(root) {
    const find = (selector) => root.querySelector(selector);
    const board = find("#board");
    const cells = [];
    const refs = {
      timer: find("#timer"), status: find("#game-status"),
      theme: find("#theme"), difficulty: find("#difficulty"),
      selection: find("#selection-label"), selectionHelp: find("#selection-help"),
      erase: find("#erase"), digits: [...root.querySelectorAll("[data-digit]")],
      filled: find("#filled-count"), progress: find("#progress"), progressFill: find("#progress-fill"),
      completion: find("#completion"), completionMessage: find("#completion-message"),
      undo: find("#undo"), redo: find("#redo"), notes: find("#notes"), autoCandidates: find("#auto-candidates"),
      inputHeading: find("#input-heading"), keypad: find("#keypad"), persistence: find("#persistence-status")
    };

    for (let row = 0; row < 9; row += 1) {
      const rowElement = document.createElement("div");
      rowElement.className = "board-row";
      rowElement.setAttribute("role", "row");
      rowElement.setAttribute("aria-rowindex", row + 1);
      for (let column = 0; column < 9; column += 1) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "cell";
        button.dataset.cell = row * 9 + column;
        button.setAttribute("role", "gridcell");
        button.setAttribute("aria-colindex", column + 1);
        const value = document.createElement("span");
        value.className = "cell-value";
        value.setAttribute("aria-hidden", "true");
        const candidates = document.createElement("span");
        candidates.className = "cell-candidates";
        candidates.setAttribute("aria-hidden", "true");
        candidates.hidden = true;
        const candidateSlots = Array.from({ length: 9 }, () => {
          const slot = document.createElement("span");
          candidates.append(slot);
          return slot;
        });
        button.append(value, candidates);
        rowElement.append(button);
        cells.push({ button, value, candidates, candidateSlots });
      }
      board.append(rowElement);
    }

    function renderCell(state, index) {
      const { button, value, candidates, candidateSlots } = cells[index];
      const digit = state.values[index];
      const given = state.givens[index] !== 0;
      const selected = state.selectedCell;
      const row = Math.floor(index / 9);
      const column = index % 9;
      const selectedRow = selected === null ? -1 : Math.floor(selected / 9);
      const selectedColumn = selected === null ? -1 : selected % 9;
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
      candidateSlots.forEach((slot, position) => { slot.textContent = notes.includes(position + 1) ? position + 1 : ""; });
      button.tabIndex = index === (selected === null ? 0 : selected) ? 0 : -1;
      button.setAttribute("aria-selected", String(selected === index));
      button.setAttribute("aria-readonly", String(given || state.status === "completed"));
      button.setAttribute("aria-invalid", String(incorrect));
      const cellKind = given ? "given" : state.status === "completed" ? "completed entry" : "editable";
      button.setAttribute("aria-label", `Row ${row + 1}, column ${column + 1}, ${digit || "empty"}, ${cellKind}${incorrect ? ", incorrect" : ""}${notes.length ? ", candidates " + notes.join(", ") : ""}`);
    }

    function render(state) {
      root.documentElement.dataset.theme = state.theme === "auto" ? state.systemTheme : state.theme;
      refs.theme.value = state.theme;
      refs.difficulty.value = state.difficulty;
      refs.timer.textContent = Sudoku.formatElapsedTime(state.elapsedTime);
      refs.timer.dateTime = `PT${Math.floor(state.elapsedTime / 1000)}S`;
      refs.status.textContent = state.status === "completed" ? "Completed" : "In progress";
      cells.forEach((cell, index) => renderCell(state, index));

      const selected = state.selectedCell;
      const editable = selected !== null && state.givens[selected] === 0 && state.status === "active";
      refs.selection.textContent = selected === null ? "Select a cell" : `R${Math.floor(selected / 9) + 1} · C${selected % 9 + 1}`;
      const help = state.status === "completed" ? "Puzzle complete. Ready for another?" :
        selected === null ? "Choose any empty cell to begin." : state.givens[selected] ? "This is a given and cannot be changed." :
        state.notesMode ? (state.values[selected] ? "Erase this value before adding notes." : "Type or click a digit to toggle its note.") :
        Sudoku.isCellIncorrect(state, selected) ? "Incorrect entry. Try another number." : "Use the keypad or type a number.";
      // Avoid re-announcing unchanged live-region text on each timer tick.
      if (refs.selectionHelp.textContent !== help) refs.selectionHelp.textContent = help;
      refs.digits.forEach((button) => {
        button.disabled = !editable || (state.notesMode && state.values[selected] !== 0);
        button.setAttribute("aria-label", `${state.notesMode ? "Toggle candidate" : "Enter"} ${button.dataset.digit}`);
      });
      refs.erase.disabled = !editable || (state.values[selected] === 0 && state.candidates[selected].length === 0);
      refs.undo.disabled = state.history.length === 0;
      refs.redo.disabled = state.future.length === 0;
      refs.notes.disabled = state.status !== "active";
      refs.notes.setAttribute("aria-pressed", String(state.notesMode));
      refs.autoCandidates.disabled = state.status !== "active";
      refs.inputHeading.textContent = state.notesMode ? "Pencil in notes" : "Place a number";
      refs.keypad.setAttribute("aria-label", state.notesMode ? "Toggle a candidate" : "Enter a number");

      const filled = state.values.filter(Boolean).length;
      refs.filled.replaceChildren(document.createTextNode(`${filled} `));
      const totalLabel = document.createElement("span");
      totalLabel.textContent = "/ 81 filled";
      refs.filled.append(totalLabel);
      refs.progress.setAttribute("aria-valuenow", filled);
      refs.progressFill.style.width = `${filled / 81 * 100}%`;

      const complete = state.status === "completed";
      const completionText = `You completed the puzzle in ${Sudoku.formatElapsedTime(state.elapsedTime)}.`;
      if (complete && refs.completionMessage.textContent !== completionText) refs.completionMessage.textContent = completionText;
      refs.completion.hidden = !complete;
    }

    function focusCell(index) {
      if (index !== null && cells[index]) cells[index].button.focus({ preventScroll: true });
    }

    function renderPersistence(saved) {
      refs.persistence.hidden = saved;
    }

    return { render, focusCell, renderPersistence };
  }

  Sudoku.createGameView = createGameView;
})(window.Sudoku = window.Sudoku || {});
