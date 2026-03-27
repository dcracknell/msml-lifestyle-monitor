#!/bin/zsh

set -euo pipefail

SCRIPT_DIR=${0:A:h}
PROJECT_ROOT=${SCRIPT_DIR:h}
LAUNCHER_ROOT="${PROJECT_ROOT}/macos-launcher"
APP_NAME="MSML iPhone Launcher"
ARCHITECTURE=$(uname -m)
DEPLOYMENT_TARGET="13.0"
BUILD_ROOT="${HOME}/Library/Caches/msml-lifestyle/macos-launcher"
TEMP_ROOT="${BUILD_ROOT}/tmp"
APP_BUNDLE="${BUILD_ROOT}/${APP_NAME}.app"
RESOURCES_DIR="${APP_BUNDLE}/Contents/Resources"
MACOS_DIR="${APP_BUNDLE}/Contents/MacOS"
ICONSET_DIR="${TEMP_ROOT}/AppIcon.iconset"
ICON_1024="${TEMP_ROOT}/AppIcon-1024.png"
ICNS_PATH="${RESOURCES_DIR}/AppIcon.icns"
EXECUTABLE_PATH="${MACOS_DIR}/${APP_NAME}"
GENERATED_CONFIG="${TEMP_ROOT}/GeneratedLauncherConfig.swift"
APPLICATIONS_DIR="${HOME}/Applications"
INSTALLED_APP="${APPLICATIONS_DIR}/${APP_NAME}.app"
DESKTOP_DIR="${HOME}/Desktop"
DESKTOP_SHORTCUTS_DIR="${DESKTOP_DIR}/MSML iPhone Launchers"

apply_icon_to_bundle() {
  local bundle_path="$1"

  /usr/bin/swift - "${bundle_path}" "${INSTALLED_APP}/Contents/Resources/AppIcon.icns" <<'SWIFT'
import AppKit

let bundlePath = CommandLine.arguments[1]
let iconPath = CommandLine.arguments[2]

if let image = NSImage(contentsOfFile: iconPath) {
  NSWorkspace.shared.setIcon(image, forFile: bundlePath, options: [])
}
SWIFT
}

create_desktop_launcher() {
  local destination_app="$1"
  local temp_app="${TEMP_ROOT}/${destination_app:t:r}-desktop.app"

  mkdir -p "${destination_app:h}"
  rm -rf "${temp_app}" "${destination_app}"

  /usr/bin/osacompile -o "${temp_app}" <<EOF >/dev/null
on run
  do shell script "open -a " & quoted form of POSIX path of POSIX file "${INSTALLED_APP}"
end run
EOF

  /usr/bin/xattr -cr "${temp_app}" >/dev/null 2>&1 || true
  apply_icon_to_bundle "${temp_app}"
  /usr/bin/xattr -cr "${temp_app}" >/dev/null 2>&1 || true
  /usr/bin/ditto "${temp_app}" "${destination_app}"
  /usr/bin/xattr -cr "${destination_app}" >/dev/null 2>&1 || true
}

mkdir -p "${TEMP_ROOT}" "${RESOURCES_DIR}" "${MACOS_DIR}"
rm -rf "${APP_BUNDLE}" "${ICONSET_DIR}"
mkdir -p "${RESOURCES_DIR}" "${MACOS_DIR}" "${ICONSET_DIR}"

cat > "${GENERATED_CONFIG}" <<EOF
enum LauncherBuildConfig {
  static let projectRoot = "${PROJECT_ROOT}"
  static let metroLogPath = "${PROJECT_ROOT}/.expo/ios-device-metro.log"
}
EOF

/usr/bin/swift "${LAUNCHER_ROOT}/Scripts/GenerateLauncherIcon.swift" "${ICON_1024}"

for size in 16 32 64 128 256 512; do
  /usr/bin/sips -z "${size}" "${size}" "${ICON_1024}" --out "${ICONSET_DIR}/icon_${size}x${size}.png" >/dev/null
done

for size in 16 32 128 256 512; do
  double=$((size * 2))
  /usr/bin/sips -z "${double}" "${double}" "${ICON_1024}" --out "${ICONSET_DIR}/icon_${size}x${size}@2x.png" >/dev/null
done

/usr/bin/iconutil -c icns "${ICONSET_DIR}" -o "${ICNS_PATH}"

cat > "${APP_BUNDLE}/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleExecutable</key>
  <string>${APP_NAME}</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundleIconName</key>
  <string>AppIcon</string>
  <key>CFBundleIdentifier</key>
  <string>com.dcracknell.msml.iphone-launcher</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>${APP_NAME}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSApplicationCategoryType</key>
  <string>public.app-category.developer-tools</string>
  <key>LSMinimumSystemVersion</key>
  <string>${DEPLOYMENT_TARGET}</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSPrincipalClass</key>
  <string>NSApplication</string>
</dict>
</plist>
EOF

printf 'APPL????' > "${APP_BUNDLE}/Contents/PkgInfo"

/usr/bin/swiftc \
  -parse-as-library \
  -target "${ARCHITECTURE}-apple-macos${DEPLOYMENT_TARGET}" \
  -framework SwiftUI \
  "${LAUNCHER_ROOT}/Sources/MSMLLauncherApp.swift" \
  "${GENERATED_CONFIG}" \
  -o "${EXECUTABLE_PATH}"

chmod +x "${EXECUTABLE_PATH}"
/usr/bin/codesign --force --deep -s - "${APP_BUNDLE}" >/dev/null 2>&1 || true

mkdir -p "${APPLICATIONS_DIR}" "${INSTALLED_APP}"
/usr/bin/rsync -a --delete "${APP_BUNDLE}/" "${INSTALLED_APP}/"
/usr/bin/xattr -cr "${INSTALLED_APP}" >/dev/null 2>&1 || true

apply_icon_to_bundle "${INSTALLED_APP}"

rm -rf \
  "${DESKTOP_DIR}/${APP_NAME}.app" \
  "${DESKTOP_SHORTCUTS_DIR}/${APP_NAME}.app"

create_desktop_launcher "${DESKTOP_DIR}/${APP_NAME}.app"
create_desktop_launcher "${DESKTOP_SHORTCUTS_DIR}/${APP_NAME}.app"

echo "Built ${INSTALLED_APP}"
