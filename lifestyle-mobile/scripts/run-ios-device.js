#!/usr/bin/env node

const http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

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

function printUsage() {
  console.log(`Usage: npm run ios:device -- [options]

Options:
  -d, --device <name-or-udid>   Device name, UDID, or CoreDevice identifier
      --configuration <name>    Xcode configuration to build (default: Debug)
      --host <lan|tunnel|localhost>
                               Metro hosting mode for Debug builds (default: lan)
      --port <number>           Metro port for Debug builds (default: 8081)
      --bundler-clear           Clear Metro cache before starting it
      --no-build-cache          Remove the local device DerivedData folder first
      --no-bundler              Skip starting Metro for Debug launches
      --no-install              Build only, skip app install
      --no-launch               Install only, skip app launch
  -h, --help                    Show this help text
`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
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
    bundlerClear: false,
    noBuildCache: false,
    noBundler: false,
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
      case '--bundler-clear':
        options.bundlerClear = true;
        break;
      case '--no-build-cache':
        options.noBuildCache = true;
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
  if (options.noBuildCache) {
    fs.rmSync(derivedDataPath, { recursive: true, force: true });
    if (legacyDerivedDataPath !== derivedDataPath) {
      fs.rmSync(legacyDerivedDataPath, { recursive: true, force: true });
    }
  }

  console.log(`Using device DerivedData at ${derivedDataPath}`);

  const buildArgs = [
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

  if (options.noBuildCache) {
    buildArgs.push('clean', 'build');
  } else {
    buildArgs.push('build');
  }

  console.log(`Building for ${deviceName}...`);
  run('xcodebuild', buildArgs);

  const appPath = path.join(
    derivedDataPath,
    'Build',
    'Products',
    `${options.configuration}-iphoneos`,
    'MSMLLifestyle.app'
  );

  if (!fs.existsSync(appPath)) {
    fail(`Build finished but the app bundle was not found at ${appPath}`);
  }

  const needsBundler = isDebugConfiguration(options.configuration) && !options.noLaunch && !options.noBundler;
  if (needsBundler) {
    await ensureBundlerRunning(options);
  }

  if (!options.noInstall) {
    console.log(`Installing on ${deviceName}...`);
    run('xcrun', ['devicectl', 'device', 'install', 'app', '--device', deviceUdid, appPath]);
  }

  if (!options.noInstall && !options.noLaunch) {
    if (isDeviceLocked(deviceUdid)) {
      fail(
        `${deviceName} is locked, so the app could not be launched automatically.\n` +
          `The app is already installed. Unlock the phone, then either tap the app icon manually or rerun:\n\n` +
          `npm run ios:device -- --no-install`
      );
    }

    console.log(`Launching ${defaultBundleId} on ${deviceName}...`);
    launchApp(deviceUdid, deviceName, defaultBundleId);
  }

  console.log(`Finished for ${deviceName}.`);
  if (needsBundler) {
    console.log(`Debug build is connected to Metro on port ${options.port}.`);
  } else if (isDebugConfiguration(options.configuration) && options.noLaunch) {
    console.log('Skipped Metro startup because the app was not launched.');
  } else if (isDebugConfiguration(options.configuration) && options.noBundler) {
    console.log('Metro startup was skipped because --no-bundler was supplied.');
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
