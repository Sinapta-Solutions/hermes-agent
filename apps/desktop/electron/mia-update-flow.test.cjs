/**
 * Static regression tests for the M.i.A prepared-installer update branch.
 *
 * electron/main.cjs is intentionally not importable in Node tests because it
 * boots Electron IPC at module load. Keep this narrow: pin the merge invariant
 * that the M.i.A branch must release the backend/venv lock before spawning the
 * prepared installer.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const mainSource = fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf8')

function miaInstallerBlock() {
  const start = mainSource.indexOf('if (isMiaInstallerPending(miaState))')
  assert.notEqual(start, -1, 'missing M.i.A installer update branch')
  const end = mainSource.indexOf('const updater = resolveUpdaterBinary()', start)
  assert.notEqual(end, -1, 'missing generic updater branch after M.i.A installer branch')
  return mainSource.slice(start, end)
}

test('M.i.A prepared installer releases backend lock before spawning installer', () => {
  const block = miaInstallerBlock()
  const releaseIndex = block.indexOf('await releaseBackendLockForUpdate(resolveUpdateRoot())')
  const spawnIndex = block.indexOf('spawn(miaState.installerPath')

  assert.notEqual(releaseIndex, -1, 'M.i.A installer branch must release backend/venv lock')
  assert.notEqual(spawnIndex, -1, 'M.i.A installer branch must still spawn the prepared installer')
  assert.ok(releaseIndex < spawnIndex, 'backend lock release must happen before installer spawn')
})
