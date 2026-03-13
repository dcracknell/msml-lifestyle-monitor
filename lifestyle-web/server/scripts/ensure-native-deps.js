#!/usr/bin/env node
const { execFileSync } = require('child_process');
const path = require('path');

const SERVER_ROOT = path.resolve(__dirname, '..');
const NATIVE_MODULE = 'better-sqlite3';
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function isNativeBinaryMismatch(error) {
  if (!error) {
    return false;
  }

  const message = String(error.message || '');
  return (
    error.code === 'ERR_DLOPEN_FAILED' &&
    /(invalid (elf|win32) header|wrong elf class|mach-o|exec format error)/i.test(message)
  );
}

function rebuildNativeModule() {
  console.warn(`Rebuilding ${NATIVE_MODULE} for ${process.platform}/${process.arch}...`);
  execFileSync(npmCommand, ['rebuild', NATIVE_MODULE], {
    cwd: SERVER_ROOT,
    stdio: 'inherit',
  });
}

try {
  require(NATIVE_MODULE);
} catch (error) {
  if (!isNativeBinaryMismatch(error)) {
    throw error;
  }

  rebuildNativeModule();
  require(NATIVE_MODULE);
}
