const { spawnSync } = require('child_process');
const fs = require('fs');

function commandExists(command) {
  if (typeof command !== 'string' || !command.trim()) {
    return false;
  }

  const result = spawnSync(command, ['--version'], {
    stdio: 'ignore',
    windowsHide: true,
  });

  return !result.error && result.status === 0;
}

function isConfiguredRuntimeAvailable(runtime, { existsSync, commandExistsFn }) {
  if (typeof runtime !== 'string' || !runtime.trim()) {
    return false;
  }

  const trimmedRuntime = runtime.trim();
  if (/[\\/]/.test(trimmedRuntime)) {
    return existsSync(trimmedRuntime);
  }

  return commandExistsFn(trimmedRuntime);
}

function resolvePythonRuntime({
  envOverride = '',
  localVenvPython = '',
  localVenvWindowsPython = '',
  existsSync = fs.existsSync,
  commandExistsFn = commandExists,
} = {}) {
  const trimmedOverride = typeof envOverride === 'string' ? envOverride.trim() : '';
  const overrideIsPathLike = /[\\/]/.test(trimmedOverride);
  if (
    trimmedOverride &&
    overrideIsPathLike &&
    isConfiguredRuntimeAvailable(trimmedOverride, { existsSync, commandExistsFn })
  ) {
    return trimmedOverride;
  }

  if (localVenvPython && existsSync(localVenvPython)) {
    return localVenvPython;
  }

  if (localVenvWindowsPython && existsSync(localVenvWindowsPython)) {
    return localVenvWindowsPython;
  }

  if (
    trimmedOverride &&
    !overrideIsPathLike &&
    isConfiguredRuntimeAvailable(trimmedOverride, { existsSync, commandExistsFn })
  ) {
    return trimmedOverride;
  }

  if (commandExistsFn('python3')) {
    return 'python3';
  }

  return 'python';
}

module.exports = {
  commandExists,
  isConfiguredRuntimeAvailable,
  resolvePythonRuntime,
};
