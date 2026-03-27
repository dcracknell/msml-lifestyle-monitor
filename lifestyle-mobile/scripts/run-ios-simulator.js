#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const { syncIosNative } = require('./sync-ios-native');

const projectRoot = path.resolve(__dirname, '..');
const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const passthroughArgs = process.argv.slice(2);
const useBundler =
  process.env.MSML_IOS_USE_METRO === '1' || passthroughArgs.includes('--with-bundler');
const normalizedArgs = passthroughArgs.filter((arg) => arg !== '--with-bundler');

const env = {
  ...process.env,
  // Suppress Expo's built-in dotenvx loading — app.config.js loads .env itself.
  // Without this, Expo calls dotenvx multiple times and prints tip spam to stdout.
  EXPO_NO_DOTENV: '1',
};

// Expo's iOS Debug simulator builds skip bundling by default. Force an
// embedded fallback bundle so launches still work when Metro is unavailable.
if (
  env.MSML_SKIP_DEBUG_BUNDLING !== '1' &&
  typeof env.FORCE_BUNDLING === 'undefined' &&
  typeof env.SKIP_BUNDLING === 'undefined'
) {
  env.FORCE_BUNDLING = '1';
}

syncIosNative(env);

if (!useBundler && !normalizedArgs.includes('--no-bundler')) {
  normalizedArgs.unshift('--no-bundler');
}

const args = ['expo', 'run:ios', ...normalizedArgs];
console.log(`$ ${npxCommand} ${args.join(' ')}`);

const result = spawnSync(npxCommand, args, {
  cwd: projectRoot,
  stdio: 'inherit',
  env,
});

if (result.error) {
  throw result.error;
}

if (typeof result.status === 'number') {
  process.exit(result.status);
}
