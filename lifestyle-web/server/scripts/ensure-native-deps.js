#!/usr/bin/env node
const { execFileSync } = require('child_process');
const fs = require('fs');
const Module = require('module');
const path = require('path');

const SERVER_ROOT = path.resolve(__dirname, '..');
const NATIVE_MODULE = 'better-sqlite3';
const SKIP_AUTO_INSTALL_ENV = 'ENSURE_NATIVE_DEPS_SKIP_INSTALL';
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function getErrorMessage(error) {
  return [error?.message, error?.cause?.message].filter(Boolean).join('\n');
}

function getNativeModuleRoot() {
  return path.join(SERVER_ROOT, 'node_modules', NATIVE_MODULE);
}

function getNativeModuleEntryPath() {
  const packageJsonPath = path.join(getNativeModuleRoot(), 'package.json');
  const { main = 'index.js' } = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  return path.resolve(getNativeModuleRoot(), main);
}

function isNativeModuleInstalled() {
  return fs.existsSync(path.join(getNativeModuleRoot(), 'package.json'));
}

function isRecoverableNativeModuleError(error) {
  if (!error) {
    return false;
  }

  const message = getErrorMessage(error);
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

function installProjectDependencies() {
  if (process.env[SKIP_AUTO_INSTALL_ENV] === '1') {
    return;
  }

  console.warn(`Installing project dependencies because ${NATIVE_MODULE} is missing...`);
  execFileSync(npmCommand, ['install'], {
    cwd: SERVER_ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      [SKIP_AUTO_INSTALL_ENV]: '1',
    },
  });

  if (!isNativeModuleInstalled()) {
    throw new Error(`Failed to install ${NATIVE_MODULE} in ${SERVER_ROOT}.`);
  }
}

function resetModuleState() {
  if (Module._pathCache) {
    for (const key of Object.keys(Module._pathCache)) {
      delete Module._pathCache[key];
    }
  }

  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${path.sep}node_modules${path.sep}`)) {
      delete require.cache[key];
    }
  }
}

function getServerRequire() {
  return Module.createRequire(path.join(SERVER_ROOT, 'package.json'));
}

function probeBetterSqlite3() {
  const serverRequire = getServerRequire();
  const resolvedModulePath = getNativeModuleEntryPath();
  delete require.cache[resolvedModulePath];
  const Database = serverRequire(resolvedModulePath);
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

function ensureNativeModuleReady() {
  if (!isNativeModuleInstalled()) {
    installProjectDependencies();
    resetModuleState();
  }

  try {
    probeBetterSqlite3();
  } catch (error) {
    if (!isRecoverableNativeModuleError(error)) {
      throw error;
    }

    rebuildNativeModule();
    resetModuleState();
    probeBetterSqlite3();
  }
}

ensureNativeModuleReady();
