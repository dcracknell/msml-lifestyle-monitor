#!/usr/bin/env node

const http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  detectAppleTeamId,
  getDebugBundlePreflightIssues,
  syncIosNative,
} = require('./sync-ios-native');

// Suppress Expo's built-in dotenvx loading — app.config.js loads .env itself.
// Without this, Expo calls dotenvx multiple times and prints tip spam to stdout.
process.env.EXPO_NO_DOTENV = '1';
if (!/utf-?8/i.test(process.env.LANG || '')) {
  process.env.LANG = 'en_US.UTF-8';
}
if (!/utf-?8/i.test(process.env.LC_ALL || '')) {
  process.env.LC_ALL = process.env.LANG;
}
if (!/utf-?8/i.test(process.env.LC_CTYPE || '')) {
  process.env.LC_CTYPE = process.env.LANG;
}

const projectRoot = path.resolve(__dirname, '..');
const iosRoot = path.join(projectRoot, 'ios');
const workspacePath = path.join(iosRoot, 'MSMLLifestyle.xcworkspace');
const legacyDerivedDataPath = path.join(projectRoot, '.expo', 'ios-device-build');
const defaultDerivedDataPath = path.join(
  os.homedir(),
  'Library',
  'Caches',
  'msml-lifestyle',
  'ios-device-build'
);
const derivedDataPath =
  process.env.MSML_IOS_DERIVED_DATA_PATH ||
  process.env.IOS_DEVICE_DERIVED_DATA_PATH ||
  defaultDerivedDataPath;
const scheme = 'MSMLLifestyle';
const defaultMetroPort = 8081;
const metroLogPath = path.join(projectRoot, '.expo', 'ios-device-metro.log');
const defaultBundleId =
  process.env.EXPO_PUBLIC_IOS_BUNDLE_IDENTIFIER ||
  process.env.IOS_BUNDLE_IDENTIFIER ||
  'com.dcracknell.msml.lifestyle';
const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function getEmbeddedMainBundlePath(appPath) {
  return path.join(appPath, 'main.jsbundle');
}

function getEmbeddedMainBundleStats(bundlePath) {
  try {
    const stats = fs.statSync(bundlePath);
    return stats.isFile() ? stats : null;
  } catch {
    return null;
  }
}

function hasEmbeddedMainBundle(bundlePath) {
  const stats = getEmbeddedMainBundleStats(bundlePath);
  return Boolean(stats && stats.size > 0);
}

function printUsage() {
  console.log(`Usage: npm run ios:device -- [options]

Options:
  -d, --device <name-or-udid>   Device name, UDID, or CoreDevice identifier
      --configuration <name>    Xcode configuration to build (default: Debug)
      --host <lan|tunnel|localhost>
                               Metro hosting mode when using --with-bundler (default: lan)
      --port <number>           Metro port when using --with-bundler (default: 8081)
      --no-build               Skip xcodebuild and reuse the last built / installed app
      --bundler-clear           Clear Metro cache before starting it (implies --with-bundler)
      --no-build-cache          Remove the local device DerivedData folder first
      --with-bundler            Start Metro and use the live-reload dev-client flow
      --no-bundler              Force the embedded bundle flow (default)
      --no-install              Skip app install
      --no-launch               Skip app launch
  -h, --help                    Show this help text
`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function formatIssueList(issues) {
  return issues.map((issue) => `- ${issue}`).join('\n');
}

function quoteArg(value) {
  if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function run(command, args) {
  console.log(`$ ${command} ${args.map(quoteArg).join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    env: process.env,
  });

  if (result.error) {
    throw result.error;
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status);
  }
}

function applyDeviceBuildEnv(syncEnv) {
  const forwardedKeys = [
    'APPLE_TEAM_ID',
    'MSML_IOS_FOR_DEVICE_BUILD',
    'MSML_DISABLE_WIDGETS',
    'MSML_DISABLE_HEALTHKIT',
    'EXPO_WIDGETS_DISABLE_APP_GROUPS',
  ];

  for (const key of forwardedKeys) {
    if (syncEnv[key]) {
      process.env[key] = syncEnv[key];
    } else {
      delete process.env[key];
    }
  }
}

function runStreaming(command, args, options = {}) {
  const { cwd = projectRoot, env = process.env, outputLimit = 200000 } = options;
  console.log(`$ ${command} ${args.map(quoteArg).join(' ')}`);

  return new Promise((resolve, reject) => {
    let combinedOutput = '';
    const appendOutput = (chunk) => {
      combinedOutput += chunk;
      if (combinedOutput.length > outputLimit) {
        combinedOutput = combinedOutput.slice(-outputLimit);
      }
    };

    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      process.stdout.write(chunk);
      appendOutput(text);
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      process.stderr.write(chunk);
      appendOutput(text);
    });

    child.on('error', reject);
    child.on('close', (code) => {
      resolve({
        code: typeof code === 'number' ? code : 1,
        output: combinedOutput,
      });
    });
  });
}

function runJson(command, args, options = {}) {
  const { allowFailure = false } = options;
  const jsonPath = path.join(
    os.tmpdir(),
    `msml-ios-device-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`
  );
  const result = spawnSync(command, [...args, '--json-output', jsonPath], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: process.env,
  });

  const stdout = result.stdout || '';
  const stderr = result.stderr || '';

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch (error) {
    if (result.error) {
      throw result.error;
    }
    throw error;
  } finally {
    fs.rmSync(jsonPath, { force: true });
  }

  if (!allowFailure && typeof result.status === 'number' && result.status !== 0) {
    const message = parsed?.error?.userInfo?.NSLocalizedDescription?.string || stderr || stdout;
    fail(message || `${command} exited with code ${result.status}`);
  }

  return parsed;
}

function parseArgs(argv) {
  const options = {
    configuration: 'Debug',
    device: null,
    host: 'lan',
    port: defaultMetroPort,
    noBuild: false,
    bundlerClear: false,
    noBuildCache: false,
    noBundler: true,
    noInstall: false,
    noLaunch: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '-d':
      case '--device':
        index += 1;
        options.device = argv[index];
        if (!options.device) {
          fail('Missing value for --device');
        }
        break;
      case '--configuration':
        index += 1;
        options.configuration = argv[index];
        if (!options.configuration) {
          fail('Missing value for --configuration');
        }
        break;
      case '--host':
        index += 1;
        options.host = argv[index];
        if (!options.host) {
          fail('Missing value for --host');
        }
        if (!['lan', 'tunnel', 'localhost'].includes(options.host)) {
          fail(`Unsupported host mode: ${options.host}`);
        }
        break;
      case '--port':
        index += 1;
        options.port = Number(argv[index]);
        if (!Number.isInteger(options.port) || options.port <= 0) {
          fail('Port must be a positive integer.');
        }
        break;
      case '--no-build':
        options.noBuild = true;
        break;
      case '--bundler-clear':
        options.bundlerClear = true;
        options.noBundler = false;
        break;
      case '--no-build-cache':
        options.noBuildCache = true;
        break;
      case '--with-bundler':
        options.noBundler = false;
        break;
      case '--no-bundler':
        options.noBundler = true;
        break;
      case '--no-install':
        options.noInstall = true;
        break;
      case '--no-launch':
        options.noLaunch = true;
        break;
      case '-h':
      case '--help':
        printUsage();
        process.exit(0);
        break;
      default:
        fail(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function formatDevice(device) {
  const name = device.deviceProperties?.name || 'Unknown device';
  const osVersion = device.deviceProperties?.osVersionNumber || 'unknown';
  const udid = device.hardwareProperties?.udid || device.identifier || 'unknown';
  return `${name} (${osVersion}) [${udid}]`;
}

function selectDevice(requested) {
  const data = runJson('xcrun', ['devicectl', 'list', 'devices']);
  const devices = (data.result?.devices || []).filter((device) => {
    return (
      device.hardwareProperties?.platform === 'iOS' &&
      device.hardwareProperties?.reality === 'physical' &&
      device.connectionProperties?.pairingState === 'paired'
    );
  });

  if (!devices.length) {
    fail('No paired physical iOS devices are available.');
  }

  if (requested) {
    const match = devices.find((device) => {
      return [
        device.hardwareProperties?.udid,
        device.identifier,
        device.deviceProperties?.name,
      ].includes(requested);
    });

    if (!match) {
      fail(`Device not found: ${requested}\nAvailable devices:\n${devices.map(formatDevice).join('\n')}`);
    }

    return match;
  }

  if (devices.length === 1) {
    return devices[0];
  }

  fail(`Multiple devices are available. Re-run with --device.\nAvailable devices:\n${devices.map(formatDevice).join('\n')}`);
}

function ensureDeviceReady(deviceUdid, deviceName) {
  const ddiInfo = runJson(
    'xcrun',
    ['devicectl', 'device', 'info', 'ddiServices', '--device', deviceUdid, '--timeout', '20'],
    { allowFailure: true }
  );

  if (ddiInfo.info?.outcome === 'success') {
    return;
  }

  const message =
    ddiInfo.error?.userInfo?.NSLocalizedDescription?.string ||
    'The connected iPhone is not available for development.';

  if (/device is locked/i.test(JSON.stringify(ddiInfo.error || {}))) {
    fail(`${deviceName} is locked. Unlock the phone, keep it awake, and run the command again.`);
  }

  fail(`${deviceName} is not ready for Xcode builds. ${message}`);
}

function isDeviceLocked(deviceUdid) {
  const lockState = runJson(
    'xcrun',
    ['devicectl', 'device', 'info', 'lockState', '--device', deviceUdid, '--timeout', '20'],
    { allowFailure: true }
  );

  if (lockState.info?.outcome !== 'success') {
    return false;
  }

  return lockState.result?.passcodeRequired === true;
}

function isLockedLaunchError(launchResult) {
  const errorText = JSON.stringify(launchResult.error || {});
  return /could not be unlocked|reason:\s*Locked|\"Locked\"/i.test(errorText);
}

function launchApp(deviceUdid, deviceName, bundleId) {
  const args = [
    'devicectl',
    'device',
    'process',
    'launch',
    '--device',
    deviceUdid,
    '--terminate-existing',
    bundleId,
  ];
  console.log(`$ xcrun ${args.map(quoteArg).join(' ')}`);

  const launchResult = runJson('xcrun', args, { allowFailure: true });
  if (launchResult.info?.outcome === 'success') {
    return;
  }

  if (isLockedLaunchError(launchResult)) {
    fail(
      `${deviceName} is locked, so iOS refused to launch ${bundleId}.\n` +
        `The app is already installed. Unlock the phone, then either tap the app icon manually or rerun:\n\n` +
        `npm run ios:device -- --no-install`
    );
  }

  const message =
    launchResult.error?.userInfo?.NSUnderlyingError?.error?.userInfo?.NSLocalizedFailureReason?.string ||
    launchResult.error?.userInfo?.NSLocalizedDescription?.string ||
    'The application failed to launch.';
  fail(`${deviceName} failed to launch ${bundleId}. ${message}`);
}

function isDebugConfiguration(configuration) {
  return String(configuration).toLowerCase() === 'debug';
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isBusyDestinationBuildError(output) {
  return (
    /Timed out waiting for all destinations matching the provided destination specifier/i.test(
      output
    ) &&
    /Device is busy \(Connecting to /i.test(output)
  );
}

function isProvisioningAccountBuildError(output) {
  return /No Accounts:\s*Add a new account in Accounts settings\./i.test(output);
}

async function buildForDevice(deviceUdid, deviceName, buildArgs) {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt === 1) {
      console.log(`Building for ${deviceName}...`);
    } else {
      console.log(`Retrying build for ${deviceName} (${attempt}/${maxAttempts})...`);
    }

    const result = await runStreaming('xcodebuild', buildArgs);
    if (result.code === 0) {
      return;
    }

    if (attempt < maxAttempts && isBusyDestinationBuildError(result.output)) {
      console.log(
        `${deviceName} is still connecting to Xcode. Waiting 15 seconds before retrying the build...`
      );
      await sleep(15000);
      ensureDeviceReady(deviceUdid, deviceName);
      continue;
    }

    if (isBusyDestinationBuildError(result.output)) {
      fail(
        `${deviceName} stayed busy while Xcode was trying to connect.\n` +
          `Unlock the phone, keep it awake on the home screen, leave it plugged in, then rerun the same command.`
      );
    }

    if (isProvisioningAccountBuildError(result.output)) {
      fail(
        'The Personal Team-compatible build is ready, but Xcode still has no usable Apple account/profile for signing on this Mac.\n' +
          'Open Xcode > Settings > Accounts, sign in or refresh your Apple ID, then retry the same command.\n' +
          'If the account already appears there, open ios/MSMLLifestyle.xcworkspace in Xcode once, select your iPhone, and let Xcode finish creating the development profile before rerunning the launcher.'
      );
    }

    process.exit(result.code);
  }
}

function withCleanBuildActions(buildArgs) {
  const nextArgs = [...buildArgs];
  while (nextArgs.length > 0 && ['clean', 'build'].includes(nextArgs[nextArgs.length - 1])) {
    nextArgs.pop();
  }
  nextArgs.push('clean', 'build');
  return nextArgs;
}

function getMissingEmbeddedBundleMessage(options, appPath, embeddedMainBundlePath) {
  return options.noBuild
    ? `The cached iPhone build at ${appPath} does not contain an embedded main.jsbundle.\nRun \`npm run ios:device\` once to rebuild the app before installing or launching it again.`
    : `Build finished, but ${embeddedMainBundlePath} was not created.\nInstalling this Debug iPhone build would recreate the red screen because the embedded JS bundle is missing.`;
}

async function ensureEmbeddedBundleReady({
  appPath,
  buildArgs,
  deviceName,
  deviceUdid,
  embeddedMainBundlePath,
  options,
}) {
  const expectsEmbeddedBundle = isDebugConfiguration(options.configuration) && options.noBundler;
  if (!expectsEmbeddedBundle) {
    return;
  }

  if (!options.noBuild) {
    const debugBundlePreflightIssues = getDebugBundlePreflightIssues();
    if (debugBundlePreflightIssues.length > 0) {
      fail(
        `Embedded-bundle preflight failed before install:\n${formatIssueList(debugBundlePreflightIssues)}`
      );
    }
    console.log('Embedded-bundle preflight passed. Install will stop if main.jsbundle is missing.');
  }

  if (hasEmbeddedMainBundle(embeddedMainBundlePath)) {
    console.log(`Verified embedded Debug JS bundle at ${embeddedMainBundlePath}.`);
    return;
  }

  if (options.noBuild || !buildArgs) {
    fail(getMissingEmbeddedBundleMessage(options, appPath, embeddedMainBundlePath));
  }

  console.log(
    'Embedded Debug JS bundle is missing after the build. Repairing the native bundle setup and rebuilding once before install...'
  );
  const syncEnv = syncIosNative({
    ...process.env,
    MSML_IOS_FOR_DEVICE_BUILD: '1',
  });
  applyDeviceBuildEnv(syncEnv || {});

  const repairPreflightIssues = getDebugBundlePreflightIssues();
  if (repairPreflightIssues.length > 0) {
    fail(
      `Automatic repair could not restore the iPhone bundle setup:\n${formatIssueList(repairPreflightIssues)}`
    );
  }

  await buildForDevice(deviceUdid, deviceName, withCleanBuildActions(buildArgs));

  if (!hasEmbeddedMainBundle(embeddedMainBundlePath)) {
    fail(
      `${getMissingEmbeddedBundleMessage(options, appPath, embeddedMainBundlePath)}\nAutomatic repair was attempted, but install was cancelled because the rebuilt app is still missing main.jsbundle.`
    );
  }

  console.log(`Repaired and verified embedded Debug JS bundle at ${embeddedMainBundlePath}.`);
}

function isMetroRunning(port) {
  return new Promise((resolve) => {
    const request = http.get(
      {
        host: '127.0.0.1',
        port,
        path: '/status',
        timeout: 1000,
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          resolve(response.statusCode === 200 && /packager-status:running/i.test(body));
        });
      }
    );

    request.on('error', () => resolve(false));
    request.on('timeout', () => {
      request.destroy();
      resolve(false);
    });
  });
}

function getMetroProcessIds(port) {
  const result = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: process.env,
  });

  if (result.error || typeof result.status !== 'number' || result.status !== 0) {
    return [];
  }

  return [...new Set((result.stdout || '')
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean))];
}

function getProcessCommand(pid) {
  const result = spawnSync('ps', ['-p', String(pid), '-o', 'command='], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: process.env,
  });

  if (result.error || typeof result.status !== 'number' || result.status !== 0) {
    return '';
  }

  return (result.stdout || '').trim();
}

async function ensureEmbeddedLaunchUsesBundle(port) {
  if (!(await isMetroRunning(port))) {
    return;
  }

  const metroPids = getMetroProcessIds(port).filter((pid) => {
    const command = getProcessCommand(pid);
    return /(?:^|\s)(?:npx\s+)?expo\s+start\b|node .*expo start\b/i.test(command);
  });

  if (!metroPids.length) {
    fail(
      `Port ${port} is already in use, and the running process does not look like Metro.\n` +
        'Stop that process or rerun with `--with-bundler` if you intend to use live reload.'
    );
  }

  console.log(`Stopping Metro on port ${port} so the embedded Debug bundle is used...`);
  for (const pid of metroPids) {
    try {
      process.kill(Number(pid), 'SIGTERM');
    } catch {
      // Ignore races where Metro exits between detection and termination.
    }
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < 5000) {
    if (!(await isMetroRunning(port))) {
      console.log('Metro stopped. Launch will use the embedded bundle.');
      return;
    }
    await sleep(250);
  }

  fail(
    `Metro is still running on port ${port}, so the device would keep preferring the dev bundle.\n` +
      'Stop Metro manually or rerun with `--with-bundler` if you want the live-reload flow.'
  );
}

async function waitForMetro(port, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    // Poll Metro directly so we only launch the app once the bundle server is actually ready.
    if (await isMetroRunning(port)) {
      return true;
    }
    await sleep(1000);
  }
  return false;
}

async function ensureBundlerRunning(options) {
  if (await isMetroRunning(options.port)) {
    console.log(`Metro is already running on port ${options.port}. Reusing the existing server.`);
    return;
  }

  fs.mkdirSync(path.dirname(metroLogPath), { recursive: true });
  const logFd = fs.openSync(metroLogPath, 'a');
  const startArgs = ['expo', 'start', '--dev-client', '--host', options.host, '--port', String(options.port)];
  if (options.bundlerClear) {
    startArgs.push('--clear');
  }

  console.log(`Starting Metro (${options.host}) on port ${options.port}...`);
  const child = spawn(npxCommand, startArgs, {
    cwd: projectRoot,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: process.env,
  });
  child.unref();
  fs.closeSync(logFd);

  const ready = await waitForMetro(options.port, 60000);
  if (!ready) {
    fail(`Metro did not become ready within 60 seconds. Check ${metroLogPath} for details.`);
  }

  console.log(`Metro ready. Logs: ${metroLogPath}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const device = selectDevice(options.device);
  const deviceName = device.deviceProperties?.name || 'iPhone';
  const deviceUdid = device.hardwareProperties?.udid || device.identifier;

  if (!deviceUdid) {
    fail(`Could not determine a UDID for ${deviceName}.`);
  }

  ensureDeviceReady(deviceUdid, deviceName);

  fs.mkdirSync(path.dirname(derivedDataPath), { recursive: true });
  if (options.noBuildCache && options.noBuild) {
    console.warn('Ignoring --no-build-cache because --no-build was supplied.');
  } else if (options.noBuildCache) {
    fs.rmSync(derivedDataPath, { recursive: true, force: true });
    if (legacyDerivedDataPath !== derivedDataPath) {
      fs.rmSync(legacyDerivedDataPath, { recursive: true, force: true });
    }
  }

  console.log(`Using device DerivedData at ${derivedDataPath}`);
  const appPath = path.join(
    derivedDataPath,
    'Build',
    'Products',
    `${options.configuration}-iphoneos`,
    'MSMLLifestyle.app'
  );
  const embeddedMainBundlePath = getEmbeddedMainBundlePath(appPath);
  const expectsEmbeddedBundle = isDebugConfiguration(options.configuration) && options.noBundler;
  let buildArgs = null;

  if (!options.noBuild) {
    const syncEnv = syncIosNative({
      ...process.env,
      MSML_IOS_FOR_DEVICE_BUILD: '1',
    });
    applyDeviceBuildEnv(syncEnv || {});

    buildArgs = [
      '-workspace',
      workspacePath,
      '-configuration',
      options.configuration,
      '-scheme',
      scheme,
      '-destination',
      `id=${deviceUdid}`,
      '-derivedDataPath',
      derivedDataPath,
      '-allowProvisioningUpdates',
      '-allowProvisioningDeviceRegistration',
    ];

    const detectedAppleTeamId =
      process.env.APPLE_TEAM_ID || (process.env.MSML_SKIP_APPLE_TEAM_AUTO_DETECT === '1'
        ? null
        : detectAppleTeamId());
    if (detectedAppleTeamId) {
      buildArgs.push(`DEVELOPMENT_TEAM=${detectedAppleTeamId}`);
      buildArgs.push('CODE_SIGN_STYLE=Automatic');
    }

    if (options.noBuildCache) {
      buildArgs.push('clean', 'build');
    } else {
      buildArgs.push('build');
    }

    await buildForDevice(deviceUdid, deviceName, buildArgs);
  }

  if (!fs.existsSync(appPath)) {
    fail(
      options.noBuild
        ? `No cached app bundle was found at ${appPath}.\nRun \`npm run ios:device\` once to create and install a device build, then use the faster no-build path.`
        : `Build finished but the app bundle was not found at ${appPath}`
    );
  }

  await ensureEmbeddedBundleReady({
    appPath,
    buildArgs,
    deviceName,
    deviceUdid,
    embeddedMainBundlePath,
    options,
  });

  if (expectsEmbeddedBundle) {
    await ensureEmbeddedLaunchUsesBundle(options.port);
  }

  const needsBundler = isDebugConfiguration(options.configuration) && !options.noLaunch && !options.noBundler;
  if (needsBundler) {
    await ensureBundlerRunning(options);
  }

  if (!options.noInstall) {
    console.log(
      options.noBuild
        ? `Installing cached build on ${deviceName}...`
        : `Installing on ${deviceName}...`
    );
    run('xcrun', ['devicectl', 'device', 'install', 'app', '--device', deviceUdid, appPath]);
  }

  if (!options.noLaunch) {
    if (isDeviceLocked(deviceUdid)) {
      fail(
        `${deviceName} is locked, so the app could not be launched automatically.\n` +
          `The app is already installed. Unlock the phone, then either tap the app icon manually or rerun:\n\n` +
          `${options.noBuild ? 'npm run ios:device:launch' : 'npm run ios:device -- --no-install'}`
      );
    }

    console.log(`Launching ${defaultBundleId} on ${deviceName}...`);
    launchApp(deviceUdid, deviceName, defaultBundleId);
  }

  console.log(`Finished for ${deviceName}.`);
  if (needsBundler) {
    console.log(`Debug build is connected to Metro on port ${options.port}.`);
    if (options.noBuild && options.noInstall) {
      console.log('Reused the already-installed dev build for a faster launch.');
    }
  } else if (isDebugConfiguration(options.configuration) && options.noLaunch) {
    console.log('Skipped Metro startup because the app was not launched.');
  } else if (expectsEmbeddedBundle) {
    console.log('Launched from the embedded Debug bundle. Metro is now optional, not required.');
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
