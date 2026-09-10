(function (global) {
  "use strict";

  const Sudoku = global.Sudoku;
  const STORAGE_KEY = "sudoku.game";
  const SCHEMA_VERSION = 1;
  const EXPORT_FORMAT = "sudoku-game";

  function createPersistence({ getStorage = () => global.localStorage, now = () => Date.now() } = {}) {
    function savedState(state) {
      // System theme and generation are runtime presentation details. They are
      // deliberately omitted from both browser storage and shared game files.
      const { systemTheme, generating, ...serializableState } = state;
      return serializableState;
    }

    function load() {
      try {
        const raw = getStorage().getItem(STORAGE_KEY);
        if (raw === null) return null;
        const envelope = JSON.parse(raw);
        const timestamp = now();
        if (!envelope || envelope.schemaVersion !== SCHEMA_VERSION ||
            !Number.isSafeInteger(envelope.savedAt) || envelope.savedAt < 0 ||
            !Number.isSafeInteger(timestamp) || timestamp < 0) return null;
        const state = Sudoku.validateSavedState(envelope.state);
        // An active game continues counting while closed, just as it does in a
        // background tab. Completed games retain their frozen final duration.
        const elapsedTime = state.elapsedTime + (state.status === "active" ? Math.max(0, timestamp - envelope.savedAt) : 0);
        return Sudoku.validateSavedState({ ...state, elapsedTime });
      } catch (error) {
        // Missing permissions, malformed JSON, and corrupt nested history all
        // take the same safe path: let the app generate a clean game.
        return null;
      }
    }

    function save(state) {
      try {
        const savedAt = now();
        if (!Number.isSafeInteger(savedAt) || savedAt < 0) return false;
        // The detected system theme is presentation state; detect it anew.
        getStorage().setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: SCHEMA_VERSION, savedAt, state: savedState(state) }));
        return true;
      } catch (error) {
        // A quota or storage-access failure must not interrupt play or history.
        return false;
      }
    }

    function exportGame(state) {
      const exportedAt = now();
      if (!Number.isSafeInteger(exportedAt) || exportedAt < 0) throw new TypeError("Invalid export time.");
      return JSON.stringify({ format: EXPORT_FORMAT, schemaVersion: SCHEMA_VERSION, exportedAt, state: savedState(state) }, null, 2);
    }

    function importGame(raw) {
      if (typeof raw !== "string") throw new TypeError("Game file must contain text.");
      const envelope = JSON.parse(raw);
      if (!envelope || typeof envelope !== "object" || Array.isArray(envelope) ||
          envelope.format !== EXPORT_FORMAT || envelope.schemaVersion !== SCHEMA_VERSION ||
          !Number.isSafeInteger(envelope.exportedAt) || envelope.exportedAt < 0) {
        throw new TypeError("Invalid Sudoku game file.");
      }
      // Unlike browser storage, time away from an exported file is not added:
      // sharing or archiving a game should preserve its exact saved state.
      return Sudoku.validateSavedState(envelope.state);
    }

    return Object.freeze({ load, save, exportGame, importGame });
  }

  Object.assign(Sudoku, { createPersistence, STORAGE_KEY, SCHEMA_VERSION, EXPORT_FORMAT });
})(window);
