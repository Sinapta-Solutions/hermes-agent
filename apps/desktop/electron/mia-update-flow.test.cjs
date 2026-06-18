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
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

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

test('M.i.A NSIS handoff waits for Desktop exit, shows progress, and relaunches', () => {
  const helperStart = mainSource.indexOf('function writeWindowsNsisHandoffScript')
  assert.notEqual(helperStart, -1, 'missing NSIS handoff script helper')
  const helperEnd = mainSource.indexOf('function launchWindowsNsisAfterExit', helperStart)
  assert.notEqual(helperEnd, -1, 'missing handoff launcher after script helper')
  const helper = mainSource.slice(helperStart, helperEnd)

  assert.match(helper, /System\.Windows\.Forms/, 'handoff must show an external Windows progress window')
  assert.match(helper, /ProgressBar/, 'handoff progress window must include a progress bar')
  assert.match(helper, /Get-Process -Id \$DesktopPid/, 'handoff script must wait for the Desktop process to exit')
  assert.match(helper, /ArgumentList @\("\/S", \("\/D=" \+ \$InstallDir\)\)/, 'NSIS silent args must be preserved with /D last')
  assert.match(helper, /Start-MiaHermes/, 'handoff must explicitly relaunch M.i.A Hermes after silent install')
  assert.match(helper, /Start-Process -FilePath \$RelaunchPath/, 'handoff must start the installed executable')
  assert.match(helper, /MIA_NSIS_HANDOFF_LOG_PATH/, 'handoff must leave a forensic log')
})

test('M.i.A NSIS handoff launches through hidden PowerShell UI process', () => {
  const launcherStart = mainSource.indexOf('function launchWindowsNsisAfterExit')
  assert.notEqual(launcherStart, -1, 'missing handoff launcher')
  const launcherEnd = mainSource.indexOf('async function handOffMiaNsisInstaller', launcherStart)
  assert.notEqual(launcherEnd, -1, 'missing installer handoff after launcher')
  const launcher = mainSource.slice(launcherStart, launcherEnd)

  assert.match(launcher, /windowsPowerShellPath\(\)/, 'launcher must prefer Windows PowerShell for progress UI')
  assert.match(launcher, /'-ExecutionPolicy', 'Bypass'/, 'PowerShell handoff must bypass local policy for generated script')
  assert.match(launcher, /windowsHide: true/, 'handoff launcher must not flash a console')
  assert.match(launcher, /relaunchPath/, 'launcher must pass relaunch path to the handoff script')
  assert.match(launcher, /appendMiaNsisHandoffLog/, 'handoff launcher must write a forensic log before Desktop quits')
})

test('M.i.A cmd fallback invokes generated handoff scripts without quote-wrapping regression', t => {
  if (process.platform !== 'win32') {
    t.skip('Windows cmd.exe-specific regression')
    return
  }

  const launcherStart = mainSource.indexOf('function launchWindowsNsisAfterExit')
  assert.notEqual(launcherStart, -1, 'missing handoff launcher')
  const launcherEnd = mainSource.indexOf('async function handOffMiaNsisInstaller', launcherStart)
  assert.notEqual(launcherEnd, -1, 'missing installer handoff after launcher')
  const launcher = mainSource.slice(launcherStart, launcherEnd)
  assert.match(launcher, /'\/d', '\/s', '\/c', 'call', scriptPath/, 'cmd fallback must pass call + raw scriptPath as separate argv entries')
  assert.doesNotMatch(launcher, /cmdQuote\(scriptPath\)/, 'cmd fallback must not pass a quote-wrapped script path to cmd.exe')

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mia cmd handoff '))
  const scriptPath = path.join(tmpDir, 'handoff script.cmd')
  const markerPath = path.join(tmpDir, 'marker.txt')
  fs.writeFileSync(scriptPath, ['@echo off', `echo ok > "${markerPath}"`, 'exit /b 0', ''].join(String.fromCharCode(13, 10)), 'utf8')

  const result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'call', scriptPath], {
    encoding: 'utf8',
    windowsHide: true
  })

  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.equal(fs.readFileSync(markerPath, 'utf8').trim(), 'ok')
})

test('M.i.A update rollback IPC is wired through main and preload', () => {
  assert.match(mainSource, /async function rollbackUpdates\(\)/, 'missing rollback implementation')
  assert.match(mainSource, /hermes:updates:rollback/, 'main process must expose rollback IPC')
  assert.match(preloadSource, /rollback:\s*\(\) => ipcRenderer\.invoke\('hermes:updates:rollback'\)/, 'preload must expose updates.rollback')
})
