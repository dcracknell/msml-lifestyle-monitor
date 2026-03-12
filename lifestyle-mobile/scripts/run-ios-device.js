#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const iosRoot = path.join(projectRoot, 'ios');
const workspacePath = path.join(iosRoot, 'MSMLLifestyle.xcworkspace');
const derivedDataPath = path.join(projectRoot, '.expo', 'ios-device-build');
const scheme = 'MSMLLifestyle';
const defaultBundleId =
  process.env.EXPO_PUBLIC_IOS_BUNDLE_IDENTIFIER ||
  process.env.IOS_BUNDLE_IDENTIFIER ||
  'com.dcracknell.msml.lifestyle';

function printUsage() {
  console.log(`Usage: npm run ios:device -- [options]

Options:
  -d, --device <name-or-udid>   Device name, UDID, or CoreDevice identifier
      --configuration <name>    Xcode configuration to build (default: Debug)
      --no-build-cache          Remove the local device DerivedData folder first
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
    noBuildCache: false,
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
      case '--no-build-cache':
        options.noBuildCache = true;
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

function main() {
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
  }

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

  if (!options.noInstall) {
    console.log(`Installing on ${deviceName}...`);
    run('xcrun', ['devicectl', 'device', 'install', 'app', '--device', deviceUdid, appPath]);
  }

  if (!options.noInstall && !options.noLaunch) {
    console.log(`Launching ${defaultBundleId} on ${deviceName}...`);
    run('xcrun', [
      'devicectl',
      'device',
      'process',
      'launch',
      '--device',
      deviceUdid,
      '--terminate-existing',
      defaultBundleId,
    ]);
  }

  console.log(`Finished for ${deviceName}.`);
  if (options.configuration === 'Debug') {
    console.log('Start Metro separately with: npm run dev-client');
  }
}

main();
