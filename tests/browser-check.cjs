const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const project = path.resolve(__dirname, '..');
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
  fs.writeFileSync(path.join(artifacts, 'phase2-' + name), Buffer.from(shot.data, 'base64'));
}
const saved = () => evaluate(`JSON.parse(localStorage.getItem('sudoku.game')).state`);
const candidatesAt = index => evaluate(`Array.from(document.querySelector('${cell(index)} .cell-candidates').children).map(s=>s.textContent)`);
const gameplay = state => ({ values: state.values, candidates: state.candidates, status: state.status });
async function ready() {
  for (let i = 0; i < 100; i++) {
    if (await evaluate(`!window.__reloadPending && document.querySelectorAll('.cell').length === 81 && document.readyState === 'complete'`)) return;
    await delay(50);
  }
  throw new Error('Game did not load');
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
const timeout = setTimeout(() => { console.error('Browser check timed out'); chrome.kill(); process.exitCode = 1; }, 55000);
(async () => {
  const target = await send('Target.createTarget', { url: 'about:blank' }, null);
  session = (await send('Target.attachToTarget', { targetId: target.targetId, flatten: true }, null)).sessionId;
  await send('Page.enable');
  await send('Page.bringToFront');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1360, height: 1100, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await send('Page.navigate', { url: 'file:///' + project.replaceAll('\\', '/') + '/index.html' });
  for (let i = 0; i < 50; i++) {
    if (await evaluate(`document.querySelectorAll('.cell').length === 81 && document.readyState === 'complete'`)) break;
    await delay(50);
  }
  check('9 rows and 81 cells render from file URL', await evaluate(`document.querySelectorAll('[role="row"]').length === 9 && document.querySelectorAll('[role="gridcell"]').length === 81`));
  check('30 givens and a square board', await evaluate(`document.querySelectorAll('.is-given').length === 30 && (() => {const r=document.querySelector('#board').getBoundingClientRect();return r.width===r.height;})()`));
  check('Thick box boundaries and thin internal boundaries', await evaluate(`getComputedStyle(document.querySelector('[data-cell="2"]')).borderRightWidth === '2px' && getComputedStyle(document.querySelector('[data-cell="1"]')).borderRightWidth === '1px'`));
  await screenshot('light.png');
  await click(cell(0));
  check('Mouse selection and grid focus', (await selected()) === 0 && await evaluate(`document.activeElement.dataset.cell === '0'`));
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
  check('Phase 2 controls enabled and Phase 3 Hint/Solve still disabled', await evaluate(`['Hint','Solve'].every(label=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()===label&&b.disabled)) && ['undo','notes','auto-candidates'].every(id=>!document.getElementById(id).disabled) && document.querySelector('#redo').disabled`));
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
  await click('#new-game');
  check('New Game retains requested difficulty and uses fixture', await evaluate(`document.querySelector('#difficulty').value === 'Extreme' && document.querySelectorAll('.is-given').length === 30 && !document.querySelector('.is-selected')`));
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
  check('Completion shown with final time', await evaluate(`document.querySelector('#game-status').textContent === 'Completed' && !document.querySelector('#completion').hidden && document.querySelector('#completion-message').textContent.includes(document.querySelector('#timer').textContent)`));
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
  check('New Game clears persisted old puzzle history and candidates', (await saved()).history.length === 0 && (await saved()).future.length === 0 && (await saved()).candidates.every(digits=>digits.length===0));
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
  // Corrupt only this runner's isolated profile, never the user's browser data.
  for (const bad of ['{', JSON.stringify({schemaVersion: 999, state: {}})]) {
    // Inject after the old document's pagehide autosave, before startup reads.
    const injection = await send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('sudoku.game', ${JSON.stringify(bad)})` });
    await reload();
    await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: injection.identifier });
    check('Bad JSON or incompatible schema falls back to a playable clean game', (await saved()).history.length === 0 && await valueAt(2) === '');
  }
  const corruptHistory = await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {const e=JSON.parse(localStorage.getItem('sudoku.game'));e.state.future=[{values:[],candidates:[],status:'active'}];localStorage.setItem('sudoku.game',JSON.stringify(e));})()` });
  await reload(); check('Corrupt nested history falls back safely in the browser', (await saved()).future.length === 0 && (await saved()).history.length === 0);
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: corruptHistory.identifier });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(window,'localStorage',{get(){throw new Error('Storage blocked in test');}});` });
  await reload(); await click(cell(2)); await key('4', 'Digit4'); await click('#undo');
  check('Denied browser storage shows save failure and keeps play/Undo usable', await valueAt(2) === '' && await evaluate(`!document.querySelector('#persistence-status').hidden && !document.querySelector('#redo').disabled`));
  await send('Page.navigate', { url: 'file:///' + project.replaceAll('\\', '/') + '/tests/index.html' });
  for (let i=0;i<100;i++) { if (await evaluate(`document.querySelector('#summary')?.textContent.includes('checks passed')`)) break; await delay(30); }
  check('Core regression page passes in the browser', await evaluate(`document.querySelector('#summary').className === 'passed' && document.querySelectorAll('#results li').length === 38`));
  check('No application JavaScript errors', errors.length === 0);
  check('No application network requests', network.every(url => url.startsWith('file:') || url.startsWith('data:')));
  console.log(JSON.stringify({ passed: passed.length, checks: passed, layout, errors, requests: network }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  clearTimeout(timeout);
  await send('Browser.close', {}, null).catch(() => {});
});
