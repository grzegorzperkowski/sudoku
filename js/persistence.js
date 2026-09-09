(function (global) {
  "use strict";

  const Sudoku = global.Sudoku;
  const STORAGE_KEY = "sudoku.game";
  const SCHEMA_VERSION = 1;

  function createPersistence({ getStorage = () => global.localStorage, now = () => Date.now() } = {}) {
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
        const { systemTheme, generating, ...savedState } = state;
        getStorage().setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: SCHEMA_VERSION, savedAt, state: savedState }));
        return true;
      } catch (error) {
        // A quota or storage-access failure must not interrupt play or history.
        return false;
      }
    }

    return Object.freeze({ load, save });
  }

  Object.assign(Sudoku, { createPersistence, STORAGE_KEY, SCHEMA_VERSION });
})(window);
