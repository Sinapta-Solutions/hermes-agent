/**
 * Static regression tests for the M.i.A prepared-installer update branch.
 *
 * electron/main.cjs is intentionally not importable in Node tests because it
 * boots Electron IPC at module load. Keep this narrow: pin the merge invariant
 * that the M.i.A branch must validate the installer, release the backend/venv
 * lock, hand off NSIS only after the Desktop exits, and expose rollback.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const mainSource = fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf8')
const preloadSource = fs.readFileSync(path.join(__dirname, 'preload.cjs'), 'utf8')

function miaInstallerBlock() {
  const start = mainSource.indexOf('if (isMiaInstallerPending(miaState))')
  assert.notEqual(start, -1, 'missing M.i.A installer update branch')
  const end = mainSource.indexOf('const updater = resolveUpdaterBinary()', start)
  assert.notEqual(end, -1, 'missing generic updater branch after M.i.A installer branch')
  return mainSource.slice(start, end)
}

test('M.i.A prepared installer uses validated post-exit NSIS handoff', () => {
  const block = miaInstallerBlock()

  assert.match(block, /handOffMiaNsisInstaller\(\{/, 'M.i.A installer branch must use the handoff helper')
  assert.match(block, /installerPath:\s*miaState\.installerPath/, 'handoff must use the prepared installer path')
  assert.match(block, /installerSha512:\s*miaState\.installerSha512/, 'handoff must validate the prepared installer hash')
  assert.doesNotMatch(block, /spawn\(miaState\.installerPath/, 'installer must not be spawned before Desktop exits')
})

test('M.i.A NSIS handoff waits for Desktop exit and keeps silent args', () => {
  const helperStart = mainSource.indexOf('function writeWindowsNsisHandoffScript')
  assert.notEqual(helperStart, -1, 'missing NSIS handoff script helper')
  const helperEnd = mainSource.indexOf('function launchWindowsNsisAfterExit', helperStart)
  assert.notEqual(helperEnd, -1, 'missing handoff launcher after script helper')
  const helper = mainSource.slice(helperStart, helperEnd)

  assert.match(helper, /:wait_desktop/, 'handoff script must wait for the Desktop process to exit')
  assert.match(helper, /tasklist \/FI/, 'handoff script must poll the parent pid')
  assert.match(helper, /\/S \/D=\$\{installDir\}/, 'NSIS silent args must be preserved with /D last')
  assert.match(helper, /MIA_NSIS_HANDOFF_LOG_PATH/, 'handoff must leave a forensic log')
})

test('M.i.A update rollback IPC is wired through main and preload', () => {
  assert.match(mainSource, /async function rollbackUpdates\(\)/, 'missing rollback implementation')
  assert.match(mainSource, /hermes:updates:rollback/, 'main process must expose rollback IPC')
  assert.match(preloadSource, /rollback:\s*\(\) => ipcRenderer\.invoke\('hermes:updates:rollback'\)/, 'preload must expose updates.rollback')
})
