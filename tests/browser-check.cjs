const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const project = path.resolve(__dirname, '..');
// Preserve the original coordinate-based regressions using an actual legacy
// save as test setup. Production startup and every New Game use the generator.
global.window = global;
for (const name of ['board', 'exact', 'logical', 'difficulty', 'generator', 'game', 'puzzles']) require('../js/' + name + '.js');
const legacyStore = Sudoku.createGameStore(); legacyStore.actions.startGame(Sudoku.getDevelopmentPuzzle());
const legacyState = JSON.parse(JSON.stringify(legacyStore.getState()));
delete legacyState.puzzleDifficulty; delete legacyState.generating;
const artifacts = path.join(project, '.tmp');
fs.mkdirSync(artifacts, { recursive: true });
const profile = fs.mkdtempSync(path.join(artifacts, 'phase2-browser-'));
let chrome;
function launchBrowser() {
chrome = spawn(process.env.SUDOKU_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--in-process-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--disable-component-update', '--disable-sync',
  '--disable-extensions', '--disable-features=MediaRouter,OptimizationHints',
  '--host-resolver-rules=MAP * ~NOTFOUND', '--remote-debugging-pipe',
  `--user-data-dir=${profile}`, 'about:blank'
], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
chrome.stdio[4].on('data', (chunk) => {
  buffer += chunk.toString();
  let boundary;
  while ((boundary = buffer.indexOf('\0')) !== -1) {
    const message = JSON.parse(buffer.slice(0, boundary));
    buffer = buffer.slice(boundary + 1);
    if (message.id && pending.has(message.id)) {
      const operation = pending.get(message.id);
      pending.delete(message.id);
      message.error ? operation.reject(message.error) : operation.resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    if (message.method === 'Network.requestWillBeSent') network.push(message.params.request.url);
    if (message.method === 'Page.javascriptDialogOpening') {
      dialogs.push(message.params); const accept = nextDialogAnswer; nextDialogAnswer = true;
      send('Page.handleJavaScriptDialog', { accept }).catch(error => errors.push(error));
    }
  }
});
chrome.stderr.on('data', (chunk) => { if (chunk.toString().includes('FATAL')) console.error(chunk.toString()); });
chrome.on('exit', (code) => { if (pending.size) { console.error('Browser exited:', code); process.exitCode = 1; for (const operation of pending.values()) operation.reject(new Error('Browser exited')); pending.clear(); } });
}
let sequence = 0;
let pending = new Map();
let buffer = '';
let errors = [];
let network = [];
let session;
const dialogs = [];
let nextDialogAnswer = true;
launchBrowser();
function send(method, params = {}, sessionId = session) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    chrome.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
  });
}
async function evaluate(expression) {
  const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
  return response.result.value;
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const passed = [];
function check(name, condition) { assert.ok(condition, name); passed.push(name); }
async function click(selector) {
  const point = await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
}
async function key(key, code = key, modifiers = 0) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, modifiers, ...(/^[1-9]$/.test(key) ? { text: key } : {}) });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers });
}
async function select(selector, value) {
  await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('change', {bubbles:true})); })()`);
}
const cell = index => `[data-cell="${index}"]`;
const valueAt = index => evaluate(`document.querySelector('${cell(index)} .cell-value').textContent`);
const selected = () => evaluate(`Number(document.querySelector('.is-selected').dataset.cell)`);
async function screenshot(name) {
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  fs.writeFileSync(path.join(artifacts, 'phase3-' + name), Buffer.from(shot.data, 'base64'));
}
const saved = () => evaluate(`JSON.parse(localStorage.getItem('sudoku.game')).state`);
const candidatesAt = index => evaluate(`Array.from(document.querySelector('${cell(index)} .cell-candidates').children).map(s=>s.textContent)`);
const gameplay = state => ({ values: state.values, candidates: state.candidates, status: state.status });
async function ready() {
  for (let i = 0; i < 3600; i++) {
    if (await evaluate(`!window.__reloadPending && document.querySelectorAll('.cell').length === 81 && document.readyState === 'complete' && !document.querySelector('#new-game').disabled`)) return;
    await delay(50);
  }
  throw new Error('Game did not load');
}
async function legacyFixture(settings = {}) {
  const state = { ...legacyState, ...settings };
  const injection = await send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('sudoku.game', ${JSON.stringify(JSON.stringify({ schemaVersion: 1, savedAt: Date.now(), state }))})` });
  await reload();
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: injection.identifier });
}
async function seedGeneration(seed = 3103) {
  await evaluate(`(() => { const generate = Sudoku.generatePuzzle; Sudoku.generatePuzzle = (level, options = {}) => generate(level, { ...options, random: Sudoku.seededRandom(${seed}) }); })()`);
}
async function reload() {
  await evaluate(`window.__reloadPending = true`);
  await send('Page.reload');
  await ready();
}
async function attach() {
  const target = await send('Target.createTarget', { url: 'about:blank' }, null);
  session = (await send('Target.attachToTarget', { targetId: target.targetId, flatten: true }, null)).sessionId;
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
}
const timeout = setTimeout(() => { console.error('Browser check timed out'); chrome.kill(); process.exitCode = 1; }, 300000);
(async () => {
  const target = await send('Target.createTarget', { url: 'about:blank' }, null);
  session = (await send('Target.attachToTarget', { targetId: target.targetId, flatten: true }, null)).sessionId;
  await send('Page.enable');
  await send('Page.bringToFront');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1360, height: 1100, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  const initialSave = await send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('sudoku.game', ${JSON.stringify(JSON.stringify({ schemaVersion: 1, savedAt: Date.now(), state: legacyState }))})` });
  await send('Page.navigate', { url: 'file:///' + project.replaceAll('\\', '/') + '/index.html' });
  for (let i = 0; i < 50; i++) {
    if (await evaluate(`document.querySelectorAll('.cell').length === 81 && document.readyState === 'complete'`)) break;
    await delay(50);
  }
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: initialSave.identifier });
  check('9 rows and 81 cells render from file URL', await evaluate(`document.querySelectorAll('[role="row"]').length === 9 && document.querySelectorAll('[role="gridcell"]').length === 81`));
  check('Restored game plays the board entrance animation', await evaluate(`document.querySelector('#board').classList.contains('is-game-starting')`));
  check('30 givens and a square board', await evaluate(`document.querySelectorAll('.is-given').length === 30 && (() => {const r=document.querySelector('#board').getBoundingClientRect();return r.width===r.height;})()`));
  check('Thick box boundaries and thin internal boundaries', await evaluate(`getComputedStyle(document.querySelector('[data-cell="2"]')).borderRightWidth === '2px' && getComputedStyle(document.querySelector('[data-cell="1"]')).borderRightWidth === '1px' && getComputedStyle(document.querySelector('[data-cell="18"]')).borderBottomWidth === '2px' && getComputedStyle(document.querySelector('[data-cell="9"]')).borderBottomWidth === '1px'`));
  await screenshot('light.png');
  await click(cell(0));
  check('Mouse selection and grid focus', (await selected()) === 0 && await evaluate(`document.activeElement.dataset.cell === '0'`));
  check('Keypad highlights the selected given digit', await evaluate(`document.querySelector('[data-digit="5"]').classList.contains('is-selected-digit') && !document.querySelector('[data-digit="4"]').classList.contains('is-selected-digit')`));
  check('Row, column, box, matching highlights', await evaluate(`[1,9,10].every(i=>document.querySelector('[data-cell="'+i+'"]').classList.contains('is-related')) && document.querySelectorAll('.is-matching').length === 3 && !document.querySelector('[data-cell="40"]').classList.contains('is-related')`));
  await key('4', 'Digit4');
  await key('Delete');
  await key('Backspace');
  check('Given is protected across keyboard entry and deletion', await valueAt(0) === '5');
  await key('ArrowUp'); await key('ArrowLeft');
  check('Arrow keys stop at top-left edge', await selected() === 0);
  await key('ArrowRight'); await key('ArrowDown');
  check('Arrow keys navigate givens and empties', await selected() === 10);
  await click(cell(80)); await key('ArrowRight'); await key('ArrowDown');
  check('Arrow keys stop at bottom-right edge', await selected() === 80);
  await click(cell(2)); await key('1', 'Digit1');
  check('Wrong keyboard entry is retained and marked', await valueAt(2) === '1' && await evaluate(`document.querySelector('${cell(2)}').getAttribute('aria-invalid') === 'true'`));
  check('Keypad highlights the selected player digit', await evaluate(`document.querySelector('[data-digit="1"]').classList.contains('is-selected-digit') && !document.querySelector('[data-digit="5"]').classList.contains('is-selected-digit')`));
  check('Selected error retains selection shading', await evaluate(`getComputedStyle(document.querySelector('${cell(2)}')).backgroundColor === 'rgb(199, 221, 194)'`));
  await key('4', 'Digit4');
  check('Replacement corrects error without clearing first', await valueAt(2) === '4' && await evaluate(`!document.querySelector('${cell(2)}').classList.contains('is-incorrect')`));
  await key('Backspace');
  check('Backspace clears a player value', await valueAt(2) === '');
  await key('7', 'Digit7'); await key('Delete');
  check('Delete clears a player value and error', await valueAt(2) === '' && await evaluate(`!document.querySelector('${cell(2)}').classList.contains('is-incorrect')`));
  await click('[data-digit="4"]');
  check('Onscreen keypad enters a digit and restores board focus', await valueAt(2) === '4' && await evaluate(`document.activeElement.dataset.cell === '2'`));
  await click('#erase');
  check('Erase clears a player value', await valueAt(2) === '');
  check('Phase 2 controls and implemented Hint/Solve are enabled', await evaluate(`['hint','solve','undo','notes','auto-candidates'].every(id=>!document.getElementById(id).disabled) && document.querySelector('#redo').disabled`));
  await select('#theme', 'dark');
  check('Manual Dark applies', await evaluate(`document.documentElement.dataset.theme === 'dark'`));
  await screenshot('dark.png');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await delay(50);
  check('Manual Dark overrides system Light', await evaluate(`document.documentElement.dataset.theme === 'dark'`));
  await select('#theme', 'light');
  check('Manual Light applies', await evaluate(`document.documentElement.dataset.theme === 'light'`));
  await select('#theme', 'auto');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await delay(50);
  check('Auto follows a live system change to Dark', await evaluate(`document.documentElement.dataset.theme === 'dark'`));
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await delay(50);
  check('Auto follows a live system change to Light', await evaluate(`document.documentElement.dataset.theme === 'light'`));
  await select('#difficulty', 'Extreme');
  await seedGeneration();
  await click('#new-game');
  await ready();
  check('New Game retains requested difficulty and generates a verified Extreme puzzle', await evaluate(`document.querySelector('#difficulty').value === 'Extreme' && document.querySelector('#puzzle-label').textContent === 'Extreme puzzle' && !document.querySelector('.is-selected') && Sudoku.analyzeDifficulty(JSON.parse(localStorage.getItem('sudoku.game')).state.givens).difficulty === 'Extreme'`));
  await legacyFixture({ difficulty: 'Extreme' });
  await delay(1500);
  check('Timer advances while active', await evaluate(`document.querySelector('#timer').textContent !== '00:00:00'`));
  await click(cell(2)); await key('4', 'Digit4');
  await click('#restart');
  check('Restart clears entries, selection, and time', await valueAt(2) === '' && await evaluate(`!document.querySelector('.is-selected') && document.querySelector('#timer').textContent === '00:00:00' && document.querySelector('#game-status').textContent === 'In progress'`));
  check('Restart disables empty Undo and Redo', await evaluate(`document.querySelector('#undo').disabled && document.querySelector('#redo').disabled`));
  check('Unavailable history shortcut leaves browser default intact', await evaluate(`(() => {const e=new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true});document.body.dispatchEvent(e);return !e.defaultPrevented;})()`));
  await click(cell(2)); await click('#notes'); await key('1', 'Digit1'); await click('[data-digit="4"]'); await key('9', 'Digit9');
  assert.deepEqual(await candidatesAt(2), ['1','','','4','','','','','9']);
  check('Keyboard and keypad Notes share fixed 1–9 grid positions', await valueAt(2) === '' && await evaluate(`document.querySelector('#notes').getAttribute('aria-pressed') === 'true' && !document.querySelector('${cell(2)} .cell-candidates').hidden && document.querySelector('${cell(2)}').getAttribute('aria-label').includes('candidates 1, 4, 9')`));
  const positions = await evaluate(`Array.from(document.querySelector('${cell(2)} .cell-candidates').children).map(s=>{const r=s.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};})`);
  check('Candidate mini-grid has three aligned rows and columns', positions[0].y === positions[2].y && positions[0].x === positions[6].x && positions[4].x > positions[3].x && positions[4].y > positions[1].y && positions[8].w > 8 && positions[8].h > 8);
  await screenshot('manual-notes.png');
  await key('4', 'Digit4'); check('Repeated candidate input removes its note', (await candidatesAt(2))[3] === '');
  await key('z', 'KeyZ', 2); check('Ctrl+Z restores candidate removal', (await candidatesAt(2))[3] === '4');
  await key('y', 'KeyY', 2); check('Ctrl+Y redoes candidate removal', (await candidatesAt(2))[3] === '');
  await click('#undo'); await key('Z', 'KeyZ', 10); check('Ctrl+Shift+Z supports Redo', (await candidatesAt(2))[3] === '');
  await click('#erase'); check('Erase clears all notes and disables itself', (await candidatesAt(2)).every(digit=>digit==='') && await evaluate(`document.querySelector('#erase').disabled`));
  await click('#undo'); check('Visible Undo restores erased notes', (await candidatesAt(2))[0] === '1' && (await candidatesAt(2))[8] === '9');
  await click('#notes'); await key('4', 'Digit4');
  check('Normal input clears own notes', await valueAt(2) === '4' && (await candidatesAt(2)).every(digit=>digit===''));
  await click('#notes'); await key('7', 'Digit7');
  check('Notes cannot be added to filled cells', await valueAt(2) === '4' && (await candidatesAt(2)).every(digit=>digit==='') && await evaluate(`document.querySelector('[data-digit="7"]').disabled`));
  await click(cell(0)); await key('7', 'Digit7');
  check('Notes cannot be added to givens', await valueAt(0) === '5' && (await candidatesAt(0)).every(digit=>digit===''));
  await click('#notes'); await click('#restart');
  // Candidate highlighting is entirely derived from the selected normal value.
  // Seed the same mixed notes in several cells so the checks can distinguish a
  // matching digit from its unchanged siblings.
  await click('#notes');
  for (const index of [2,10,11,40]) {
    await click(cell(index));
    for (const digit of [2,4,7,9]) await key(String(digit), 'Digit' + digit);
  }
  await click('#notes'); await click(cell(4));
  check('Selecting normal 7 preserves same-number cells and emphasizes every candidate 7 in Light theme', await evaluate(`(() => {
    const slots = Array.from(document.querySelectorAll('.cell-candidates > span'));
    const highlights = slots.filter(slot => slot.classList.contains('is-matching'));
    return document.documentElement.dataset.theme === 'light' &&
      document.querySelectorAll('.cell.is-matching').length === 3 && highlights.length === 4 &&
      highlights.every(slot => slot.textContent === '7' && getComputedStyle(slot).fontWeight === '800') &&
      [2,10,11,40].every(index => [1,3,8].every(position => !document.querySelector('[data-cell="' + index + '"] .cell-candidates').children[position].classList.contains('is-matching')));
  })()`));
  await click(cell(36));
  check('Changing selection from 7 to normal 4 clears 7 notes and emphasizes only candidate 4', await evaluate(`(() => {
    const slots = Array.from(document.querySelectorAll('.cell-candidates > span'));
    const highlights = slots.filter(slot => slot.classList.contains('is-matching'));
    return document.querySelectorAll('.cell.is-matching').length === 2 && highlights.length === 4 &&
      highlights.every(slot => slot.textContent === '4') &&
      !slots.some(slot => slot.textContent === '7' && slot.classList.contains('is-matching'));
  })()`));
  await select('#theme', 'dark');
  check('Candidate 4 emphasis keeps bold, distinct contrast in Dark theme', await evaluate(`(() => {
    const highlighted = document.querySelector('${cell(2)} .cell-candidates').children[3];
    const plain = document.querySelector('${cell(2)} .cell-candidates').children[1];
    return document.documentElement.dataset.theme === 'dark' && highlighted.classList.contains('is-matching') &&
      getComputedStyle(highlighted).fontWeight === '800' && getComputedStyle(highlighted).color === 'rgb(255, 209, 124)' &&
      getComputedStyle(highlighted).color !== getComputedStyle(plain).color;
  })()`));
  await select('#theme', 'auto');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] }); await delay(50);
  check('Candidate emphasis remains visible when Auto resolves to Light', await evaluate(`document.documentElement.dataset.theme === 'light' && document.querySelector('${cell(2)} .cell-candidates').children[3].classList.contains('is-matching')`));
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }); await delay(50);
  check('Candidate emphasis remains visible when Auto resolves to Dark', await evaluate(`document.documentElement.dataset.theme === 'dark' && document.querySelector('${cell(2)} .cell-candidates').children[3].classList.contains('is-matching')`));
  await click(cell(2));
  check('Selecting an empty cell clears all candidate highlighting', await evaluate(`!document.querySelector('.cell-candidates > span.is-matching')`));
  await key('7', 'Digit7');
  check('Entering 7 immediately highlights remaining non-peer candidate 7 notes', await evaluate(`(() => {
    const matches = Array.from(document.querySelectorAll('.cell-candidates > span.is-matching'));
    return matches.length === 1 && matches[0] === document.querySelector('${cell(40)} .cell-candidates').children[6];
  })()`));
  await key('Delete');
  check('Deleting the selected normal value clears candidate highlighting immediately', await evaluate(`!document.querySelector('.cell-candidates > span.is-matching')`));
  await click('#undo');
  check('Undo restores candidate highlighting with the restored selected value', await evaluate(`document.querySelectorAll('.cell-candidates > span.is-matching').length === 1 && document.querySelector('${cell(40)} .cell-candidates').children[6].classList.contains('is-matching')`));
  await click('#redo');
  check('Redo clears candidate highlighting after restoring the empty selection', await evaluate(`!document.querySelector('.cell-candidates > span.is-matching')`));
  await click('#notes'); await key('7', 'Digit7'); await click('#notes'); await click(cell(4));
  check('Manually adding a candidate updates the next selected-number highlight', await evaluate(`document.querySelectorAll('.cell-candidates > span.is-matching').length === 2 && document.querySelector('${cell(2)} .cell-candidates').children[6].classList.contains('is-matching')`));
  await click(cell(2)); await click('#notes'); await key('7', 'Digit7'); await click('#notes'); await click(cell(4));
  check('Manually removing a candidate leaves no stale matching candidate highlight', await evaluate(`document.querySelectorAll('.cell-candidates > span.is-matching').length === 1 && !document.querySelector('${cell(2)} .cell-candidates').children[6].classList.contains('is-matching')`));
  await click(cell(36)); await click('#auto-candidates');
  check('Auto Candidates recalculates the visible matching candidates', await evaluate(`(() => {
    const state = JSON.parse(localStorage.getItem('sudoku.game')).state;
    return document.querySelectorAll('.cell-candidates > span.is-matching').length === state.candidates.filter(notes => notes.includes(4)).length;
  })()`));
  await click('#hint');
  check('Hint changes candidates without leaving stale matching candidate highlights', await evaluate(`(() => {
    const state = JSON.parse(localStorage.getItem('sudoku.game')).state;
    return state.selectedCell === 36 && document.querySelectorAll('.cell-candidates > span.is-matching').length === state.candidates.filter(notes => notes.includes(4)).length;
  })()`));
  await reload();
  check('Restored saved game redraws matching candidates from its selection', await evaluate(`(() => {
    const state = JSON.parse(localStorage.getItem('sudoku.game')).state;
    return state.selectedCell === 36 && document.querySelectorAll('.cell-candidates > span.is-matching').length === state.candidates.filter(notes => notes.includes(4)).length;
  })()`));
  await click('#restart');
  await click('#notes');
  for (const index of [6,29,10,11,3,40]) { await click(cell(index)); await key('7', 'Digit7'); }
  await click(cell(3)); await key('7', 'Digit7');
  await click('#notes'); await click(cell(2));
  const beforePeerEntry = gameplay(await saved());
  await key('7', 'Digit7'); const afterPeerEntry = gameplay(await saved());
  check('Value entry removes row, column, box, and overlapping peer notes only', [6,29,10,11,3].every(index=>afterPeerEntry.candidates[index].length===0) && afterPeerEntry.candidates[40][0]===7);
  await click('#undo'); assert.deepEqual(gameplay(await saved()), beforePeerEntry); check('One visible Undo restores exact peer notes without restoring manual removals', true);
  await click('#redo'); assert.deepEqual(gameplay(await saved()), afterPeerEntry); check('One visible Redo reproduces the entire atomic move', true);
  await key('Delete'); check('Manual Delete does not recreate peer notes', (await saved()).candidates[6].length === 0);
  const beforeAuto = gameplay(await saved()); await click('#auto-candidates'); const afterAuto = gameplay(await saved());
  assert.deepEqual(afterAuto.candidates[2], [1,2,4]);
  check('Auto Candidates replaces manual notes with direct legal digits', afterAuto.candidates[40].join() !== '7' && afterAuto.candidates[0].length === 0);
  await screenshot('auto-candidates.png');
  await select('#theme', 'dark'); await screenshot('dark-candidates.png');
  await click('#undo'); assert.deepEqual(gameplay(await saved()), beforeAuto); check('One Undo restores every candidate before Auto Candidates', true);
  await click('#redo'); assert.deepEqual(gameplay(await saved()), afterAuto);
  await click('#notes'); await click(cell(2)); await key('4', 'Digit4');
  const beforePersistedEntry = gameplay(await saved());
  await click('#notes'); await click(cell(10)); await key('7', 'Digit7'); const redoExpected = gameplay(await saved());
  await click('#undo'); await click('#notes'); await select('#difficulty', 'Hard');
  const beforeReload = await saved();
  await reload(); const afterReload = await saved();
  assert.deepEqual(gameplay(afterReload), gameplay(beforeReload));
  assert.deepEqual(afterReload.history, beforeReload.history); assert.deepEqual(afterReload.future, beforeReload.future);
  check('Refresh restores exact board, candidates, and both history stacks', true);
  check('Refresh restores settings, selection, Notes mode, and timer', afterReload.theme === 'dark' && afterReload.difficulty === 'Hard' && afterReload.notesMode && afterReload.selectedCell === 10 && afterReload.elapsedTime >= beforeReload.elapsedTime);
  await click('#redo'); assert.deepEqual(gameplay(await saved()), redoExpected); check('Redo works after reload', true);
  await click('#undo'); assert.deepEqual(gameplay(await saved()), beforePersistedEntry); check('Undo works after reload', true);
  await click(cell(2)); await key('9', 'Digit9'); check('Continued play after reload clears old Redo branch', (await saved()).future.length === 0 && await evaluate(`document.querySelector('#redo').disabled`));
  check('Native form shortcut is not intercepted', await evaluate(`(() => {const e=new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true});document.querySelector('#difficulty').dispatchEvent(e);return !e.defaultPrevented;})()`));
  await click('#restart');
  check('Restart discards persisted history and notes and preserves original givens', await evaluate(`(() => {const s=JSON.parse(localStorage.getItem('sudoku.game')).state;return !s.history.length&&!s.future.length&&s.candidates.every(d=>!d.length)&&s.values.every((v,i)=>v===s.givens[i]);})()`));
  if ((await saved()).notesMode) await click('#notes');
  await delay(1050);
  const solution = '534678912672195348198342567859761423426853791713924856961537284287419635345286179';
  await evaluate(`(() => { const solution=${JSON.stringify(solution)}; for (let i=0;i<81;i++){ const el=document.querySelector('[data-cell="'+i+'"]'); if (!el.classList.contains('is-given')) { el.click(); el.dispatchEvent(new KeyboardEvent('keydown',{key:solution[i],bubbles:true})); } } })()`);
  check('Completion shown with final time and celebration animation', await evaluate(`document.querySelector('#game-status').textContent === 'Completed' && !document.querySelector('#completion').hidden && document.querySelector('#completion').classList.contains('is-celebrating') && document.querySelector('#completion-message').textContent.includes(document.querySelector('#timer').textContent)`));
  const finalTime = await evaluate(`document.querySelector('#timer').textContent`);
  await delay(1200);
  check('Timer remains stopped on completion', await evaluate(`document.querySelector('#timer').textContent`) === finalTime);
  await screenshot('complete.png');
  const completedSave = await saved();
  await reload();
  check('Completed state and frozen final duration survive refresh', (await saved()).elapsedTime === completedSave.elapsedTime && await evaluate(`!document.querySelector('#completion').hidden`));
  await click('#undo'); check('Undo completion reopens the board', await evaluate(`document.querySelector('#completion').hidden && document.querySelector('#game-status').textContent === 'In progress'`));
  await click('#redo'); check('Redo completion stops play again', await evaluate(`!document.querySelector('#completion').hidden && document.querySelector('[data-digit="1"]').disabled`));
  await click('#new-game');
  await ready();
  check('New Game clears persisted old puzzle history and candidates', (await saved()).history.length === 0 && (await saved()).future.length === 0 && (await saved()).candidates.every(digits=>digits.length===0));
  await legacyFixture({ difficulty: 'Hard', theme: 'dark' });
  await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  check('Board and game actions fit a 1366 by 768 desktop', await evaluate(`document.querySelector('#board').getBoundingClientRect().bottom <= innerHeight && document.querySelector('.game-actions').getBoundingClientRect().bottom <= innerHeight`));
  await screenshot('compact.png');
  await click('#auto-candidates'); await screenshot('compact-candidates.png');
  const layout = await evaluate(`(() => { const selectors=['.app-header','.page-heading','#board','.control-panel','.app-footer']; return Object.fromEntries(selectors.map(s=>{const r=document.querySelector(s).getBoundingClientRect();return [s,{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom}]})); })()`);
  await click('#notes'); await click(cell(2)); await key('4', 'Digit4'); await click('#undo');
  const beforeTabClose = await saved();
  const closingTarget = (await send('Target.getTargetInfo')).targetInfo.targetId;
  await attach();
  await send('Target.closeTarget', { targetId: closingTarget }, null);
  await send('Page.navigate', { url: 'file:///' + project.replaceAll('\\', '/') + '/index.html' }); await ready();
  assert.deepEqual(gameplay(await saved()), gameplay(beforeTabClose));
  check('Closing and reopening a tab preserves board and history', (await saved()).future.length === beforeTabClose.future.length);
  const beforeBrowserClose = await saved();
  const exited = new Promise(resolve=>chrome.once('exit', resolve));
  await send('Browser.close', {}, null); await exited;
  buffer = ''; session = undefined; launchBrowser(); await attach();
  await send('Page.navigate', { url: 'file:///' + project.replaceAll('\\', '/') + '/index.html' }); await ready();
  const afterBrowserClose = await saved();
  assert.deepEqual(gameplay(afterBrowserClose), gameplay(beforeBrowserClose));
  assert.deepEqual(afterBrowserClose.history, beforeBrowserClose.history); assert.deepEqual(afterBrowserClose.future, beforeBrowserClose.future);
  check('Full browser close and relaunch retains board, candidates, Undo/Redo, and elapsed time', afterBrowserClose.elapsedTime >= beforeBrowserClose.elapsedTime);
  await click('#redo'); check('Redo still works after full browser relaunch', !(await saved()).candidates[2].includes(4));
  // Phase 3: exercise real generation through the application's UI. A seeded
  // random source stabilizes timing; no generator result is stubbed or cached.
  const beforeCancel = await saved(), dialogCount = dialogs.length;
  nextDialogAnswer = false; await click('#new-game');
  assert.deepEqual(gameplay(await saved()), gameplay(beforeCancel));
  check('Cancelling New Game preserves an unfinished game and its history', dialogs.length === dialogCount + 1 && (await saved()).history.length === beforeCancel.history.length);
  const generatedBoards = [];
  for (const difficulty of ['Easy','Normal','Hard','Expert','Extreme']) {
    await select('#difficulty', difficulty); await seedGeneration();
    const old = await saved();
    if (old.puzzleDifficulty) check('Selecting ' + difficulty + ' preserves the active puzzle rating', await evaluate(`document.querySelector('#puzzle-label').textContent`) === old.puzzleDifficulty + ' puzzle');
    await click('#new-game');
    if (difficulty === 'Extreme') {
      check('Extreme shows a named generation animation and disables conflicting controls', await evaluate(`document.querySelector('#board').getAttribute('aria-busy') === 'true' && document.querySelector('#board').classList.contains('is-generating') && !document.querySelector('#generation-status').hidden && !document.querySelector('#generation-animation-name').hidden && document.querySelectorAll('.generation-overlay .generation-digit').length > 0 && ['new-game','restart','hint','solve','notes','auto-candidates','undo','redo','difficulty'].every(id => document.getElementById(id).disabled)`));
      await evaluate(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key:'1', bubbles:true }));`);
      assert.deepEqual(gameplay(await saved()), gameplay(old));
      await select('#theme', 'light');
      check('Appearance remains responsive during Extreme generation', await evaluate(`document.documentElement.dataset.theme === 'light'`));
      await screenshot('generating.png');
    }
    await ready();
    const state = await saved(); generatedBoards.push(state.givens.join(''));
    check(difficulty + ' New Game initializes a unique, logically solved puzzle of the requested class',
      Sudoku.validateGeneratedPuzzle({ givens: state.givens, solution: state.solution, difficulty }) && state.puzzleDifficulty === difficulty);
    check(difficulty + ' initialization resets notes, selection, history, timer and persists', state.status === 'active' && state.selectedCell === null && !state.history.length && !state.future.length && state.candidates.every(list => !list.length) && state.elapsedTime < 1000);
    if (difficulty === 'Extreme') {
      const report = Sudoku.analyzeDifficulty(state.givens);
      check('Extreme has substantial advanced work and exceeds the Expert score ceiling', report.score >= 700 && report.advancedSteps >= 4 && report.eliminationCount >= 25 && report.steps.length >= 65);
      await click('#auto-candidates'); await click('#hint');
      check('Extreme accepts play and one Hint after initialization', (await saved()).values.filter((value, cell) => value !== state.givens[cell]).length === 1);
      await screenshot('extreme.png');
    }
    if (difficulty !== 'Normal') continue;
    if (state.notesMode) await click('#notes');
    await click('#auto-candidates'); const auto = await saved();
    assert.deepEqual(auto.candidates, Sudoku.Board.candidateMasks(auto.values).map(mask => Sudoku.Board.digits[mask]));
    check('Auto Candidates calculates direct legal notes on a generated puzzle', auto.history.length === 1);
    const editable = auto.values.findIndex((value, cell) => !value && Sudoku.Board.peers[cell].some(peer => auto.candidates[peer].includes(auto.solution[cell])));
    assert(editable >= 0); await click(cell(editable));
    const wrong = auto.solution[editable] % 9 + 1; await key(String(wrong), 'Digit' + wrong);
    check('Incorrect input is checked against the generated solution', await evaluate(`document.querySelector('${cell(editable)}').getAttribute('aria-invalid') === 'true'`));
    await click('#undo'); const beforeEntry = gameplay(await saved());
    await key(String(auto.solution[editable]), 'Digit' + auto.solution[editable]); const afterEntry = gameplay(await saved());
    check('Correct input clears the error and removes generated peer candidates', await evaluate(`document.querySelector('${cell(editable)}').getAttribute('aria-invalid') === 'false'`) && Sudoku.Board.peers[editable].every(peer => !afterEntry.candidates[peer].includes(auto.solution[editable])));
    await click('#undo'); assert.deepEqual(gameplay(await saved()), beforeEntry);
    await click('#redo'); assert.deepEqual(gameplay(await saved()), afterEntry);
    check('Generated value entry Undo and Redo restore exact candidate state', true);
    const beforeHint = await saved(); await click('#hint'); const afterHint = await saved();
    const changes = afterHint.values.map((value, cell) => value !== beforeHint.values[cell] ? cell : -1).filter(cell => cell >= 0);
    check('Hint fills exactly one correct generated digit and records one action', changes.length === 1 && afterHint.values[changes[0]] === afterHint.solution[changes[0]] && afterHint.history.length === beforeHint.history.length + 1);
    await click('#undo'); assert.deepEqual(gameplay(await saved()), gameplay(beforeHint));
    check('Hint Undo restores all values and candidate notes exactly', true);
    await reload(); assert.deepEqual(gameplay(await saved()), gameplay(beforeHint));
    assert.deepEqual((await saved()).future, afterHint.future.concat([gameplay(afterHint)]));
    await click('#redo'); assert.deepEqual(gameplay(await saved()), gameplay(afterHint));
    check('Refreshing a generated game preserves candidates and redoable Hint', (await saved()).puzzleDifficulty === 'Normal');
    await screenshot('generated-notes.png');
    const beforeSolve = await saved(), beforeDialog = dialogs.length;
    nextDialogAnswer = false; await click('#solve'); assert.deepEqual(gameplay(await saved()), gameplay(beforeSolve));
    check('Solve cancellation preserves the entire generated board', dialogs.length === beforeDialog + 1);
    await click('#solve'); const solved = await saved();
    check('Confirmed Solve completes through state, clears notes and records one history action', solved.status === 'completed' && solved.values.join('') === solved.solution.join('') && solved.candidates.every(list => !list.length) && solved.history.length === beforeSolve.history.length + 1);
    await delay(1100); await reload();
    check('Solved generated board persists with a frozen timer and completion UI', (await saved()).elapsedTime === solved.elapsedTime && await evaluate(`!document.querySelector('#completion').hidden`));
    await click('#undo'); assert.deepEqual(gameplay(await saved()), gameplay(beforeSolve));
    await click('#redo'); assert.deepEqual(gameplay(await saved()), gameplay(solved));
    check('Solve Undo and Redo restore exact generated gameplay and completion', true);
    await click('#undo');
    await evaluate(`(() => {const s=JSON.parse(localStorage.getItem('sudoku.game')).state;for(let cell=0;cell<81;cell++){if(s.givens[cell])continue;const el=document.querySelector('[data-cell="'+cell+'"]');el.click();el.dispatchEvent(new KeyboardEvent('keydown',{key:String(s.solution[cell]),bubbles:true}));}})()`);
    check('Manually completing a generated puzzle triggers normal completion and stops play', (await saved()).status === 'completed' && await evaluate(`!document.querySelector('#completion').hidden && document.querySelector('#hint').disabled && document.querySelector('#solve').disabled`));
  }
  check('Repeated New Game produces five distinct generated boards', new Set(generatedBoards).size === 5);
  // Corrupt only this runner's isolated profile, never the user's browser data.
  for (const bad of ['{', JSON.stringify({schemaVersion: 999, state: {}})]) {
    // Inject after the old document's pagehide autosave, before startup reads.
    const injection = await send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('sudoku.game', ${JSON.stringify(bad)})` });
    await reload();
    await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: injection.identifier });
    check('Bad JSON or incompatible schema falls back to a playable generated game', (await saved()).history.length === 0 && (await saved()).status === 'active' && (await saved()).puzzleDifficulty === 'Normal');
  }
  const corruptHistory = await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {const e=JSON.parse(localStorage.getItem('sudoku.game'));e.state.future=[{values:[],candidates:[],status:'active'}];localStorage.setItem('sudoku.game',JSON.stringify(e));})()` });
  await reload(); check('Corrupt nested history falls back safely in the browser', (await saved()).future.length === 0 && (await saved()).history.length === 0);
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: corruptHistory.identifier });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(window,'localStorage',{get(){throw new Error('Storage blocked in test');}});` });
  await reload(); const deniedEmpty = await evaluate(`Number(document.querySelector('.cell:not(.is-given)').dataset.cell)`);
  await click(cell(deniedEmpty)); await key('4', 'Digit4'); await click('#undo');
  check('Denied browser storage shows save failure and keeps play/Undo usable', await valueAt(deniedEmpty) === '' && await evaluate(`!document.querySelector('#persistence-status').hidden && !document.querySelector('#redo').disabled`));
  await send('Page.navigate', { url: 'file:///' + project.replaceAll('\\', '/') + '/tests/index.html?core' });
  for (let i=0;i<100;i++) { if (await evaluate(`document.querySelector('#summary')?.textContent.includes('checks passed')`)) break; await delay(30); }
  check('Core regression page passes in the browser', await evaluate(`document.querySelector('#summary').className === 'passed' && document.querySelectorAll('#results li').length === SudokuTestResults.length && SudokuTestResults.length >= 67`));
  check('No application JavaScript errors', errors.length === 0);
  check('No application network requests', network.every(url => url.startsWith('file:') || url.startsWith('data:')));
  console.log(JSON.stringify({ passed: passed.length, checks: passed, layout, errors, requests: network }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  clearTimeout(timeout);
  await send('Browser.close', {}, null).catch(() => {});
});
