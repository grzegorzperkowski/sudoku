// Optional command-line runner using only built-in Node facilities.
global.window = global;
require('../js/game.js');
require('../js/puzzles.js');
require('../js/persistence.js');
require('./tests.js');
require('./phase2.js');
for (const result of global.SudokuTestResults) {
  console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.name}`);
  if (!result.passed) console.error(result.error);
}
const failed = global.SudokuTestResults.filter(result => !result.passed).length;
console.log(`${global.SudokuTestResults.length - failed}/${global.SudokuTestResults.length} checks passed`);
if (failed) process.exitCode = 1;
