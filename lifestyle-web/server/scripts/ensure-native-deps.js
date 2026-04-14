#!/usr/bin/env node
const { execFileSync } = require('child_process');
const path = require('path');

const SERVER_ROOT = path.resolve(__dirname, '..');
const NATIVE_MODULE = 'better-sqlite3';
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function isRecoverableNativeModuleError(error) {
  if (!error) {
    return false;
  }

  const message = [error.message, error.cause?.message].filter(Boolean).join('\n');
  const recoverablePattern = new RegExp(
    [
      'invalid (elf|win32) header',
      'wrong elf class',
      'mach-o',
      'exec format error',
      'node_module_version',
      'compiled against a different node\\.js version',
      'could not locate the bindings file',
      'cannot find module .*\\.node',
      'no such file',
    ].join('|'),
    'i'
  );
  return (
    ['ERR_DLOPEN_FAILED', 'MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND'].includes(error.code) &&
    recoverablePattern.test(message)
  );
}

function probeBetterSqlite3() {
  const Database = require(NATIVE_MODULE);
  const db = new Database(':memory:');
  try {
    db.prepare('SELECT 1').get();
  } finally {
    db.close();
  }
}

function rebuildNativeModule() {
  console.warn(`Rebuilding ${NATIVE_MODULE} for ${process.platform}/${process.arch}...`);
  execFileSync(npmCommand, ['rebuild', NATIVE_MODULE], {
    cwd: SERVER_ROOT,
    stdio: 'inherit',
  });
}

try {
  probeBetterSqlite3();
} catch (error) {
  if (!isRecoverableNativeModuleError(error)) {
    throw error;
  }

  rebuildNativeModule();
  probeBetterSqlite3();
}
