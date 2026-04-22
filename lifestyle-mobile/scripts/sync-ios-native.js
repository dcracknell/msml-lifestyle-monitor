#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const plist = require('@expo/plist').default;

const projectRoot = path.resolve(__dirname, '..');
const iosRoot = path.join(projectRoot, 'ios');
const expoRoot = path.join(projectRoot, '.expo');
const externalStaleRoot = path.join(projectRoot, '..', '.codex-stale-native-cache');
const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const podfilePath = path.join(iosRoot, 'Podfile');
const appDelegatePath = path.join(iosRoot, 'MSMLLifestyle', 'AppDelegate.swift');
const xcodeProjectPath = path.join(iosRoot, 'MSMLLifestyle.xcodeproj', 'project.pbxproj');
const xcodeEnvUpdatesPath = path.join(iosRoot, '.xcode.env.updates');
const expoWidgetsBuildBundleScriptPath = path.join(
  projectRoot,
  'node_modules',
  'expo-widgets',
  'scripts',
  'build-bundle.mjs'
);
const expoWidgetsDynamicViewPath = path.join(
  projectRoot,
  'node_modules',
  'expo-widgets',
  'ios',
  'Widgets',
  'DynamicView.swift'
);
const expoWidgetsEntryViewPath = path.join(
  projectRoot,
  'node_modules',
  'expo-widgets',
  'ios',
  'Widgets',
  'EntryView.swift'
);
const expoWidgetsStoragePath = path.join(
  projectRoot,
  'node_modules',
  'expo-widgets',
  'ios',
  'WidgetsStorage.swift'
);
const expoWidgetsWidgetSourceTemplatePath = path.join(
  projectRoot,
  'node_modules',
  'expo-widgets',
  'plugin',
  'src',
  'withWidgetSourceFiles.ts'
);
const expoWidgetsWidgetSourceTemplateBuildPath = path.join(
  projectRoot,
  'node_modules',
  'expo-widgets',
  'plugin',
  'build',
  'withWidgetSourceFiles.js'
);
const expoWidgetsTargetRoot = path.join(iosRoot, 'ExpoWidgetsTarget');
const expoWidgetsRequireLine =
  'require File.join(File.dirname(`node --print "require.resolve(\'expo-widgets/package.json\')"`), "scripts/autolinking")';
const expoWidgetsCompatibilityShim = `class Expo::AutolinkingManager
  public :resolve
end
`;
const debugBundlingOverrides = `# Keep a fallback JS bundle embedded in Debug builds so already-installed
# dev builds can still launch when Metro is unavailable.
if [[ "\${MSML_SKIP_DEBUG_BUNDLING:-0}" != "1" && "$CONFIGURATION" = *Debug* ]]; then
  unset SKIP_BUNDLING
  export FORCE_BUNDLING=1
fi
`;
const debugBundleFallbackAppDelegateSentinel =
  'return metroBundleURL ?? Bundle.main.url(forResource: "main", withExtension: "jsbundle")';
const xcodeEnvUpdatesSourceSentinel = 'source \\"$PODS_ROOT/../.xcode.env.updates\\"';
const defaultIosBundleIdentifier = 'com.dcracknell.msml.lifestyle';

function withUtf8Locale(env) {
  const localeCandidates = [env.LC_ALL, env.LC_CTYPE, env.LANG];
  const utf8Locale = localeCandidates.find((value) => /utf-?8/i.test(value || ''));
  const locale = utf8Locale || 'en_US.UTF-8';

  return {
    ...env,
    LANG: locale,
    LC_ALL: locale,
    LC_CTYPE: locale,
  };
}

function quoteArg(value) {
  if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function getIosBundleIdentifier(env = process.env) {
  return (
    env.EXPO_PUBLIC_IOS_BUNDLE_IDENTIFIER ||
    env.IOS_BUNDLE_IDENTIFIER ||
    defaultIosBundleIdentifier
  );
}

function run(command, args, options = {}) {
  const { cwd = projectRoot, env = process.env } = options;
  console.log(`$ ${command} ${args.map(quoteArg).join(' ')}`);
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env,
  });

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status);
  }
}

function detectAppleTeamId() {
  const certificateResult = spawnSync(
    '/bin/zsh',
    [
      '-lc',
      'security find-certificate -a -c "Apple Development" -p | openssl x509 -noout -subject -nameopt RFC2253',
    ],
    {
      cwd: projectRoot,
      encoding: 'utf8',
    }
  );

  if (
    !certificateResult.error &&
    typeof certificateResult.status === 'number' &&
    certificateResult.status === 0
  ) {
    const subjectOutput = `${certificateResult.stdout || ''}\n${certificateResult.stderr || ''}`;
    const teamIdMatch = subjectOutput.match(/(?:^|,)OU=([A-Z0-9]{10})(?:,|$)/m);
    if (teamIdMatch) {
      return teamIdMatch[1];
    }
  }

  const result = spawnSync('security', ['find-identity', '-v', '-p', 'codesigning'], {
    cwd: projectRoot,
    encoding: 'utf8',
  });

  if (result.error || typeof result.status !== 'number' || result.status !== 0) {
    return null;
  }

  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  const matches = Array.from(output.matchAll(/\(([A-Z0-9]{10})\)/g), (match) => match[1]);
  const uniqueTeamIds = [...new Set(matches)];

  if (uniqueTeamIds.length === 0) {
    return null;
  }

  return uniqueTeamIds[0];
}

function isFreeProvisioningTeam(teamId) {
  if (!teamId) {
    return false;
  }

  const result = spawnSync('defaults', ['read', 'com.apple.dt.Xcode'], {
    cwd: projectRoot,
    encoding: 'utf8',
  });

  if (result.error || typeof result.status !== 'number' || result.status !== 0) {
    return false;
  }

  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  const escapedTeamId = teamId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const freeTeamPattern = new RegExp(
    `isFreeProvisioningTeam = 1;[\\s\\S]{0,400}?teamID = ${escapedTeamId};|teamID = ${escapedTeamId};[\\s\\S]{0,400}?isFreeProvisioningTeam = 1;`,
    'm'
  );

  return freeTeamPattern.test(output);
}

function withAppleTeamId(env) {
  if (env.APPLE_TEAM_ID || env.MSML_SKIP_APPLE_TEAM_AUTO_DETECT === '1') {
    return env;
  }

  const detectedAppleTeamId = detectAppleTeamId();
  if (!detectedAppleTeamId) {
    return env;
  }

  console.log(`Using detected Apple team ${detectedAppleTeamId}.`);
  return {
    ...env,
    APPLE_TEAM_ID: detectedAppleTeamId,
  };
}

function withPersonalTeamDeviceCapabilityFallbacks(env) {
  if (env.MSML_IOS_FOR_DEVICE_BUILD !== '1' || !env.APPLE_TEAM_ID) {
    return env;
  }

  if (!isFreeProvisioningTeam(env.APPLE_TEAM_ID)) {
    return env;
  }

  console.log(
    'Using Personal Team device-build fallback: disabling widgets and HealthKit so Xcode can sign the app.'
  );
  return {
    ...env,
    MSML_DISABLE_WIDGETS: '1',
    MSML_DISABLE_HEALTHKIT: '1',
    EXPO_WIDGETS_DISABLE_APP_GROUPS: '1',
  };
}

function updatePlistFile(filePath, transform) {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  const originalContent = fs.readFileSync(filePath, 'utf8');
  const plistObject = plist.parse(originalContent);
  const updatedObject = transform(plistObject) || plistObject;
  const nextContent = plist.build(updatedObject);

  if (nextContent === originalContent) {
    return false;
  }

  fs.writeFileSync(filePath, nextContent, 'utf8');
  return true;
}

function ensurePlistFile(filePath, plistObject = {}) {
  if (fs.existsSync(filePath)) {
    return;
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, plist.build(plistObject), 'utf8');
}

function stripUnsupportedPersonalTeamCapabilities(teamId, env = process.env) {
  if (!isFreeProvisioningTeam(teamId)) {
    return;
  }

  const widgetsDisabled = env.MSML_DISABLE_WIDGETS === '1';
  const healthKitDisabled = env.MSML_DISABLE_HEALTHKIT === '1';
  const bundleIdentifier = getIosBundleIdentifier(env);
  const widgetKeychainAccessGroup = `${teamId}.${bundleIdentifier}.widgets`;
  const appEntitlementsPath = path.join(iosRoot, 'MSMLLifestyle', 'MSMLLifestyle.entitlements');
  const widgetEntitlementsPath = path.join(iosRoot, 'ExpoWidgetsTarget', 'ExpoWidgetsTarget.entitlements');
  const appInfoPlistPath = path.join(iosRoot, 'MSMLLifestyle', 'Info.plist');
  const widgetInfoPlistPath = path.join(iosRoot, 'ExpoWidgetsTarget', 'Info.plist');

  ensurePlistFile(appEntitlementsPath, {});
  if (!widgetsDisabled) {
    ensurePlistFile(widgetEntitlementsPath, {});
  }

  let changedFiles = 0;

  if (
    updatePlistFile(appEntitlementsPath, (entitlements) => {
      delete entitlements['aps-environment'];
      delete entitlements['com.apple.security.application-groups'];

      if (healthKitDisabled) {
        delete entitlements['com.apple.developer.healthkit'];
      }

      if (widgetsDisabled) {
        delete entitlements['keychain-access-groups'];
      } else {
        entitlements['keychain-access-groups'] = [widgetKeychainAccessGroup];
      }

      return entitlements;
    })
  ) {
    changedFiles += 1;
  }

  if (
    !widgetsDisabled &&
    updatePlistFile(widgetEntitlementsPath, (entitlements) => {
      delete entitlements['aps-environment'];
      delete entitlements['com.apple.security.application-groups'];
      entitlements['keychain-access-groups'] = [widgetKeychainAccessGroup];
      return entitlements;
    })
  ) {
    changedFiles += 1;
  }

  if (
    updatePlistFile(appInfoPlistPath, (infoPlist) => {
      if (widgetsDisabled) {
        delete infoPlist.ExpoWidgetsAppGroupIdentifier;
        delete infoPlist.ExpoWidgetsKeychainAccessGroup;
      } else {
        infoPlist.ExpoWidgetsKeychainAccessGroup = widgetKeychainAccessGroup;
      }
      return infoPlist;
    })
  ) {
    changedFiles += 1;
  }

  if (
    !widgetsDisabled &&
    updatePlistFile(widgetInfoPlistPath, (infoPlist) => {
      infoPlist.ExpoWidgetsKeychainAccessGroup = widgetKeychainAccessGroup;
      return infoPlist;
    })
  ) {
    changedFiles += 1;
  }

  if (changedFiles > 0) {
    const adjustments = [];
    if (widgetsDisabled) {
      adjustments.push('widget extensions');
    } else {
      adjustments.push(`widget capabilities via ${widgetKeychainAccessGroup}`);
    }
    if (healthKitDisabled) {
      adjustments.push('HealthKit');
    }
    console.log(`Adjusted Personal Team signing fallbacks for ${adjustments.join(' and ')}.`);
  }
}

function ensureExpoWidgetsPodfileCompatibility() {
  if (!fs.existsSync(podfilePath)) {
    return;
  }

  const podfileContent = fs.readFileSync(podfilePath, 'utf8');
  if (!podfileContent.includes('use_expo_modules_widgets!')) {
    return;
  }

  if (podfileContent.includes(expoWidgetsCompatibilityShim)) {
    return;
  }

  const patchedPodfile = podfileContent.replace(
    expoWidgetsRequireLine,
    `${expoWidgetsRequireLine}\n${expoWidgetsCompatibilityShim}`
  );

  if (patchedPodfile === podfileContent) {
    throw new Error('Could not apply the Expo widgets CocoaPods compatibility shim.');
  }

  fs.writeFileSync(podfilePath, patchedPodfile, 'utf8');
  console.log('Applied Expo widgets CocoaPods compatibility shim.');
}

function ensureExpoWidgetsBundleScriptCompatibility() {
  if (!fs.existsSync(expoWidgetsBuildBundleScriptPath)) {
    return;
  }

  const originalContent = fs.readFileSync(expoWidgetsBuildBundleScriptPath, 'utf8');
  let nextContent = originalContent;

  if (!nextContent.includes('const passthroughArgs = argv.slice(3);')) {
    nextContent = nextContent.replace(
      "const appBundlePath = path.join(outputDir, 'ExpoWidgets.bundle');",
      "const appBundlePath = path.join(outputDir, 'ExpoWidgets.bundle');\nconst passthroughArgs = argv.slice(3);"
    );
  }

  nextContent = nextContent.replace(
    "    '--dev',\n    'false',\n    '--skip-server',\n    ...argv.slice(2),",
    "    '--dev',\n    'false',\n    ...passthroughArgs,"
  );

  if (nextContent === originalContent) {
    return;
  }

  fs.writeFileSync(expoWidgetsBuildBundleScriptPath, nextContent, 'utf8');
  console.log('Patched expo-widgets bundle script for the current Expo CLI.');
}

function ensureExpoWidgetsSwiftCompatibility() {
  if (!fs.existsSync(expoWidgetsDynamicViewPath)) {
    return;
  }

  const originalContent = fs.readFileSync(expoWidgetsDynamicViewPath, 'utf8');
  const nextContent = originalContent.replace(
    'propsType.init(rawProps: rawProps, context: WidgetsContext.shared.context)',
    'propsType.init(from: rawProps, appContext: WidgetsContext.shared.context)'
  );

  if (nextContent === originalContent) {
    return;
  }

  fs.writeFileSync(expoWidgetsDynamicViewPath, nextContent, 'utf8');
  console.log('Patched expo-widgets Swift props initializer for ExpoModulesCore compatibility.');
}

function ensureExpoWidgetsStorageCompatibility() {
  if (!fs.existsSync(expoWidgetsStoragePath)) {
    return;
  }

  const nextContent = `import Foundation
import Security

enum WidgetsStorage {
  private static let keychainService = "expo.widgets.storage"

  static var appGroupIdentifier: String? = Bundle.main.object(forInfoDictionaryKey: "ExpoWidgetsAppGroupIdentifier") as? String
  static let defaults = appGroupIdentifier.flatMap(UserDefaults.init(suiteName:))
  static var keychainAccessGroup: String? = Bundle.main.object(forInfoDictionaryKey: "ExpoWidgetsKeychainAccessGroup") as? String

  static func set(_ value: [String: Any], forKey key: String) {
    if let defaults {
      defaults.set(value, forKey: key)
      return
    }

    guard JSONSerialization.isValidJSONObject(value),
          let data = try? JSONSerialization.data(withJSONObject: value) else {
      return
    }

    setKeychainData(data, forKey: key)
  }

  static func set(_ value: [[String: Any]], forKey key: String) {
    if let defaults {
      defaults.set(value, forKey: key)
      return
    }

    guard JSONSerialization.isValidJSONObject(value),
          let data = try? JSONSerialization.data(withJSONObject: value) else {
      return
    }

    setKeychainData(data, forKey: key)
  }

  static func set(_ value: String, forKey key: String) {
    if let defaults {
      defaults.set(value, forKey: key)
      return
    }

    guard let data = value.data(using: .utf8) else {
      return
    }

    setKeychainData(data, forKey: key)
  }

  static func set(_ value: Data, forKey key: String) {
    if let defaults {
      defaults.set(value, forKey: key)
      return
    }

    setKeychainData(value, forKey: key)
  }

  static func getDictionary(forKey key: String) -> [String: Any]? {
    if let defaults {
      return defaults.dictionary(forKey: key)
    }

    guard let data = getKeychainData(forKey: key),
          let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      return nil
    }

    return object
  }

  static func getArray(forKey key: String) -> [Any]? {
    if let defaults {
      return defaults.array(forKey: key)
    }

    guard let data = getKeychainData(forKey: key),
          let object = try? JSONSerialization.jsonObject(with: data) as? [Any] else {
      return nil
    }

    return object
  }

  static func getData(forKey key: String) -> Data? {
    if let defaults {
      return defaults.data(forKey: key)
    }

    return getKeychainData(forKey: key)
  }

  static func getString(forKey key: String) -> String? {
    if let defaults {
      return defaults.string(forKey: key)
    }

    guard let data = getKeychainData(forKey: key) else {
      return nil
    }

    return String(data: data, encoding: .utf8)
  }

  static func removeObject(forKey key: String) {
    if let defaults {
      defaults.removeObject(forKey: key)
      return
    }

    removeKeychainData(forKey: key)
  }

  private static func setKeychainData(_ data: Data, forKey key: String) {
    let query = baseKeychainQuery(forKey: key)
    var existingItem: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &existingItem)

    if status == errSecSuccess {
      SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
      return
    }

    guard status == errSecItemNotFound else {
      return
    }

    var attributes = query
    attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
    attributes[kSecValueData as String] = data
    SecItemAdd(attributes as CFDictionary, nil)
  }

  private static func getKeychainData(forKey key: String) -> Data? {
    var query = baseKeychainQuery(forKey: key)
    query[kSecReturnData as String] = kCFBooleanTrue
    query[kSecMatchLimit as String] = kSecMatchLimitOne

    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    guard status == errSecSuccess else {
      return nil
    }

    return result as? Data
  }

  private static func removeKeychainData(forKey key: String) {
    SecItemDelete(baseKeychainQuery(forKey: key) as CFDictionary)
  }

  private static func baseKeychainQuery(forKey key: String) -> [String: Any] {
    var query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: keychainService,
      kSecAttrAccount as String: key,
    ]

    if let keychainAccessGroup {
      query[kSecAttrAccessGroup as String] = keychainAccessGroup
    }

    return query
  }
}
`;
  const originalContent = fs.readFileSync(expoWidgetsStoragePath, 'utf8');
  if (originalContent === nextContent) {
    return;
  }

  fs.writeFileSync(expoWidgetsStoragePath, nextContent, 'utf8');
  console.log('Patched expo-widgets storage to use a shared keychain fallback when App Groups are unavailable.');
}

function ensureExpoWidgetsEntryFallbackCompatibility() {
  if (!fs.existsSync(expoWidgetsEntryViewPath)) {
    return;
  }

  const originalContent = fs.readFileSync(expoWidgetsEntryViewPath, 'utf8');
  if (originalContent.includes('private var fallbackWidgetView')) {
    return;
  }

  let nextContent = originalContent.replace(
    `  private var widgetEnvironmentString: String? {
    guard let data = try? JSONSerialization.data(withJSONObject: widgetEnvironment),
          let jsonString = String(data: data, encoding: .utf8) else {
        return nil
    }
    return jsonString
  }

  public var body: some View {`,
    `  private var widgetEnvironmentString: String? {
    guard let data = try? JSONSerialization.data(withJSONObject: widgetEnvironment),
          let jsonString = String(data: data, encoding: .utf8) else {
        return nil
    }
    return jsonString
  }

  @ViewBuilder
  private var fallbackWidgetView: some View {
    switch environment.widgetFamily {
    case .accessoryInline:
      Text("Open MSML Lifestyle")
        .font(.caption2.weight(.semibold))
        .lineLimit(1)
    case .accessoryCircular:
      ZStack {
        Circle().stroke(.white.opacity(0.35), lineWidth: 2)
        Text("MSML")
          .font(.system(size: 10, weight: .bold))
          .minimumScaleFactor(0.6)
      }
      .padding(6)
    case .accessoryRectangular:
      VStack(alignment: .leading, spacing: 2) {
        Text("MSML Lifestyle")
          .font(.caption2.weight(.semibold))
          .lineLimit(1)
        Text("Open app to finish widget setup")
          .font(.caption2)
          .lineLimit(2)
      }
    default:
      VStack(alignment: .leading, spacing: 8) {
        Text("MSML Lifestyle")
          .font(.headline)
          .lineLimit(1)
        Text("Open the app to finish widget setup.")
          .font(.caption)
          .foregroundStyle(.secondary)
          .lineLimit(2)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      .padding()
    }
  }

  public var body: some View {`
  );

  nextContent = nextContent.replace(
    `    } else {
      EmptyView()
    }`,
    `    } else if #available(iOS 17.0, *) {
      fallbackWidgetView
        .containerBackground(.clear, for: .widget)
    } else {
      fallbackWidgetView
    }`
  );

  if (nextContent === originalContent) {
    throw new Error('Could not patch expo-widgets EntryView fallback rendering.');
  }

  fs.writeFileSync(expoWidgetsEntryViewPath, nextContent, 'utf8');
  console.log('Patched expo-widgets EntryView to render a widget fallback when shared storage is unavailable.');
}

function normalizeExpoWidgetsImportsInFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  const originalContent = fs.readFileSync(filePath, 'utf8');
  const nextContent = originalContent.replaceAll('internal import ExpoWidgets', 'import ExpoWidgets');

  if (nextContent === originalContent) {
    return false;
  }

  fs.writeFileSync(filePath, nextContent, 'utf8');
  return true;
}

function ensureExpoWidgetsImportCompatibility() {
  let changed = 0;

  for (const filePath of [
    expoWidgetsWidgetSourceTemplatePath,
    expoWidgetsWidgetSourceTemplateBuildPath,
  ]) {
    if (normalizeExpoWidgetsImportsInFile(filePath)) {
      changed += 1;
    }
  }

  if (fs.existsSync(expoWidgetsTargetRoot)) {
    for (const entry of fs.readdirSync(expoWidgetsTargetRoot, { withFileTypes: true })) {
      if (!entry.isFile() || path.extname(entry.name) !== '.swift') {
        continue;
      }

      if (normalizeExpoWidgetsImportsInFile(path.join(expoWidgetsTargetRoot, entry.name))) {
        changed += 1;
      }
    }
  }

  if (changed > 0) {
    console.log('Normalized ExpoWidgets Swift imports for Swift access-level compatibility.');
  }
}

function ensureDebugBundleFallbackInAppDelegate() {
  if (!fs.existsSync(appDelegatePath)) {
    return;
  }

  const originalContent = fs.readFileSync(appDelegatePath, 'utf8');
  const nextContent = originalContent.replace(
    '#if DEBUG\n    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")\n#else\n    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")\n#endif',
    '#if DEBUG\n    let metroBundleURL = RCTBundleURLProvider.sharedSettings().jsBundleURL(\n      forBundleRoot: ".expo/.virtual-metro-entry"\n    )\n    return metroBundleURL ?? Bundle.main.url(forResource: "main", withExtension: "jsbundle")\n#else\n    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")\n#endif'
  );

  if (nextContent === originalContent) {
    return;
  }

  fs.writeFileSync(appDelegatePath, nextContent, 'utf8');
  console.log('Patched AppDelegate.swift to fall back to the embedded Debug JS bundle.');
}

function ensureDebugBundlingOverrides() {
  const currentContent = fs.existsSync(xcodeEnvUpdatesPath)
    ? fs.readFileSync(xcodeEnvUpdatesPath, 'utf8')
    : null;

  if (currentContent === debugBundlingOverrides) {
    return;
  }

  fs.writeFileSync(xcodeEnvUpdatesPath, debugBundlingOverrides, 'utf8');
  console.log('Wrote .xcode.env.updates to keep Debug fallback bundling enabled.');
}

function getDebugBundlePreflightIssues() {
  const issues = [];

  if (!fs.existsSync(appDelegatePath)) {
    issues.push(`Missing ${path.relative(projectRoot, appDelegatePath)}.`);
  } else {
    const appDelegateContent = fs.readFileSync(appDelegatePath, 'utf8');
    if (!appDelegateContent.includes(debugBundleFallbackAppDelegateSentinel)) {
      issues.push('AppDelegate.swift is missing the Debug fallback to the embedded JS bundle.');
    }
  }

  if (!fs.existsSync(xcodeEnvUpdatesPath)) {
    issues.push('ios/.xcode.env.updates is missing the Debug bundling override.');
  } else {
    const xcodeEnvUpdatesContent = fs.readFileSync(xcodeEnvUpdatesPath, 'utf8');
    if (
      !xcodeEnvUpdatesContent.includes('MSML_SKIP_DEBUG_BUNDLING') ||
      !xcodeEnvUpdatesContent.includes('export FORCE_BUNDLING=1')
    ) {
      issues.push('ios/.xcode.env.updates does not contain the expected Debug bundling override.');
    }
  }

  if (!fs.existsSync(xcodeProjectPath)) {
    issues.push(`Missing ${path.relative(projectRoot, xcodeProjectPath)}.`);
  } else {
    const xcodeProjectContent = fs.readFileSync(xcodeProjectPath, 'utf8');
    if (!xcodeProjectContent.includes(xcodeEnvUpdatesSourceSentinel)) {
      issues.push('The iOS Xcode project is not sourcing ios/.xcode.env.updates during bundling.');
    }
  }

  return issues;
}

function removeStaleGeneratedIosDirectories() {
  if (!fs.existsSync(iosRoot)) {
    return;
  }

  for (const entry of fs.readdirSync(iosRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const match = entry.name.match(/^(.*) (\d+)$/);
    if (!match) {
      continue;
    }

    const primaryPath = path.join(iosRoot, match[1]);
    const duplicatePath = path.join(iosRoot, entry.name);
    if (!fs.existsSync(primaryPath) || !fs.statSync(primaryPath).isDirectory()) {
      continue;
    }

    console.log(`Removing stale generated iOS directory: ${entry.name}`);
    run('/bin/rm', ['-rf', duplicatePath]);
  }
}

function removeDuplicateEntriesInDirectory(directoryPath) {
  if (!fs.existsSync(directoryPath)) {
    return;
  }

  for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
    const match = entry.name.match(/^(.*) (\d+)(\.[^/]+)?$/);
    if (!match) {
      continue;
    }

    const [, baseName, , extension = ''] = match;
    const primaryPath = path.join(directoryPath, `${baseName}${extension}`);
    const duplicatePath = path.join(directoryPath, entry.name);

    if (!fs.existsSync(primaryPath)) {
      continue;
    }

    console.log(`Removing stale duplicate entry: ${path.relative(projectRoot, duplicatePath)}`);
    run('/bin/rm', ['-rf', duplicatePath]);
  }
}

function moveAsidePath(targetPath, label) {
  if (!fs.existsSync(targetPath)) {
    return;
  }

  fs.mkdirSync(externalStaleRoot, { recursive: true });
  const parkedPath = path.join(
    externalStaleRoot,
    `${path.basename(targetPath)}-${Date.now()}`
  );

  console.log(`${label}: ${path.relative(projectRoot, targetPath)}`);
  fs.renameSync(targetPath, parkedPath);
}

function clearLegacyExpoCaches() {
  if (!fs.existsSync(expoRoot)) {
    return;
  }

  const removablePaths = [
    path.join(expoRoot, 'ios-device-build'),
    path.join(expoRoot, 'prebuild'),
  ];

  for (const targetPath of removablePaths) {
    moveAsidePath(targetPath, 'Moving stale Expo cache out of the project');
  }

  removeDuplicateEntriesInDirectory(expoRoot);
}

function createIosSyncEnv(overrides = {}) {
  return withUtf8Locale(
    withPersonalTeamDeviceCapabilityFallbacks(
      withAppleTeamId({
        ...process.env,
        ...overrides,
        CI: '1',
        EXPO_NO_DOTENV: '1',
      })
    )
  );
}

function syncIosNative(overrides = {}) {
  const env = createIosSyncEnv(overrides);

  if (env.MSML_SKIP_IOS_NATIVE_SYNC === '1') {
    console.log('Skipping iOS native sync because MSML_SKIP_IOS_NATIVE_SYNC=1.');
    return env;
  }

  // expo-widgets duplicates widget file references on incremental prebuilds in this Expo 54 setup,
  // so regenerate the iOS project cleanly before reinstalling pods.
  clearLegacyExpoCaches();
  removeStaleGeneratedIosDirectories();
  ensureExpoWidgetsBundleScriptCompatibility();
  ensureExpoWidgetsSwiftCompatibility();
  ensureExpoWidgetsStorageCompatibility();
  ensureExpoWidgetsEntryFallbackCompatibility();
  ensureExpoWidgetsImportCompatibility();
  run(npxCommand, ['expo', 'prebuild', '-p', 'ios', '--clean', '--no-install'], { env });
  ensureExpoWidgetsPodfileCompatibility();
  ensureExpoWidgetsBundleScriptCompatibility();
  ensureExpoWidgetsSwiftCompatibility();
  ensureExpoWidgetsStorageCompatibility();
  ensureExpoWidgetsEntryFallbackCompatibility();
  ensureExpoWidgetsImportCompatibility();
  ensureDebugBundleFallbackInAppDelegate();
  ensureDebugBundlingOverrides();
  stripUnsupportedPersonalTeamCapabilities(env.APPLE_TEAM_ID, env);
  run('pod', ['install'], { cwd: iosRoot, env });
  // Expo autolinking removes `.xcode.env.updates` unless EX_UPDATES_NATIVE_DEBUG is set,
  // so restore our Debug bundling override after Pods finish.
  ensureDebugBundlingOverrides();

  const debugBundlePreflightIssues = getDebugBundlePreflightIssues();
  if (debugBundlePreflightIssues.length > 0) {
    throw new Error(
      `Embedded-bundle preflight failed after iOS sync:\n- ${debugBundlePreflightIssues.join('\n- ')}`
    );
  }

  return env;
}

if (require.main === module) {
  try {
    syncIosNative();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = {
  createIosSyncEnv,
  detectAppleTeamId,
  getDebugBundlePreflightIssues,
  isFreeProvisioningTeam,
  syncIosNative,
  withAppleTeamId,
};
