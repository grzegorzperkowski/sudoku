// Optional command-line runner using only built-in Node facilities.
global.window = global;
for (const name of ['board', 'exact', 'logical', 'difficulty', 'generator']) require('../js/' + name + '.js');
require('../js/game.js');
require('../js/puzzles.js');
require('../js/persistence.js');
require('./tests.js');
require('./phase2.js');
require('./phase3.js');
require('./generation.js');
(async () => {
await global.SudokuGenerationTests;
for (const result of global.SudokuTestResults) {
  console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.name}`);
  if (!result.passed) console.error(result.error);
}
const failed = global.SudokuTestResults.filter(result => !result.passed).length;
console.log(`${global.SudokuTestResults.length - failed}/${global.SudokuTestResults.length} checks passed`);
if (failed) process.exitCode = 1;
console.log(JSON.stringify({ calibration: global.SudokuCalibrationResults }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
