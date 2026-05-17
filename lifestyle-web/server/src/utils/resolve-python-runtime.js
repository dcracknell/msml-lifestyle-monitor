const path = require('path');
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

function normalizeConfiguredRuntime(runtime, { baseDir = process.cwd() } = {}) {
  if (typeof runtime !== 'string' || !runtime.trim()) {
    return '';
  }

  const trimmedRuntime = runtime.trim();
  if (!/[\\/]/.test(trimmedRuntime) || path.isAbsolute(trimmedRuntime)) {
    return trimmedRuntime;
  }

  return path.resolve(baseDir, trimmedRuntime);
}

function isConfiguredRuntimeAvailable(runtime, { existsSync, commandExistsFn, baseDir }) {
  if (typeof runtime !== 'string' || !runtime.trim()) {
    return false;
  }

  const normalizedRuntime = normalizeConfiguredRuntime(runtime, { baseDir });
  if (/[\\/]/.test(runtime.trim())) {
    return existsSync(normalizedRuntime);
  }

  return commandExistsFn(normalizedRuntime);
}

function resolvePythonRuntime({
  envOverride = '',
  baseDir = process.cwd(),
  localVenvPython = '',
  localVenvWindowsPython = '',
  existsSync = fs.existsSync,
  commandExistsFn = commandExists,
} = {}) {
  const trimmedOverride = typeof envOverride === 'string' ? envOverride.trim() : '';
  const overrideIsPathLike = /[\\/]/.test(trimmedOverride);
  const normalizedOverride = normalizeConfiguredRuntime(trimmedOverride, { baseDir });
  if (
    trimmedOverride &&
    overrideIsPathLike &&
    isConfiguredRuntimeAvailable(trimmedOverride, { existsSync, commandExistsFn, baseDir })
  ) {
    return normalizedOverride;
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
    isConfiguredRuntimeAvailable(trimmedOverride, { existsSync, commandExistsFn, baseDir })
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
