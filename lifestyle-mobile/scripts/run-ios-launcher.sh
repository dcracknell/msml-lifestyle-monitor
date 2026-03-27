#!/bin/zsh

set -u

SCRIPT_DIR=${0:A:h}
PROJECT_DIR=${SCRIPT_DIR:h}
DEVICE_COUNT=0
DEVICE_SUMMARY=""
DEVICE_QUERY_ERROR=""
SELECTED_DEVICE_LABEL=""
SELECTED_DEVICE_UDID=""
DEVICE_LABELS=()
DEVICE_UDIDS=()

show_dialog() {
  local title=$1
  local message=$2
  local icon=${3:-note}

  /usr/bin/osascript - "$title" "$message" "$icon" <<'APPLESCRIPT'
on run argv
  set dialogTitle to item 1 of argv
  set dialogMessage to item 2 of argv
  set dialogIcon to item 3 of argv

  if dialogIcon is "stop" then
    display dialog dialogMessage with title dialogTitle buttons {"OK"} default button "OK" with icon stop
  else if dialogIcon is "caution" then
    display dialog dialogMessage with title dialogTitle buttons {"OK"} default button "OK" with icon caution
  else
    display dialog dialogMessage with title dialogTitle buttons {"OK"} default button "OK"
  end if
end run
APPLESCRIPT
}

prompt_retry() {
  local title=$1
  local message=$2

  /usr/bin/osascript - "$title" "$message" <<'APPLESCRIPT'
on run argv
  set dialogTitle to item 1 of argv
  set dialogMessage to item 2 of argv
  set resultButton to button returned of (display dialog dialogMessage with title dialogTitle buttons {"Cancel", "Retry"} default button "Retry" with icon caution)
  return resultButton
end run
APPLESCRIPT
}

find_connected_iphones() {
  local tmp parsed rc label udid index
  local -a lines

  DEVICE_COUNT=0
  DEVICE_SUMMARY=""
  DEVICE_QUERY_ERROR=""
  DEVICE_LABELS=()
  DEVICE_UDIDS=()

  tmp=$(mktemp)
  if ! xcrun devicectl list devices --json-output "$tmp" >/dev/null 2>&1; then
    DEVICE_QUERY_ERROR="Could not query Xcode for connected iPhones. Make sure your iPhone is plugged in, unlocked, trusted, and available to Xcode."
    rm -f "$tmp"
    return 2
  fi

  parsed=$(node - "$tmp" <<'NODE'
const fs = require('fs');

const outputPath = process.argv[2];
const data = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
const devices = (data.result?.devices ?? []).filter((device) => {
  return (
    device.hardwareProperties?.platform === 'iOS' &&
    device.hardwareProperties?.reality === 'physical' &&
    device.connectionProperties?.pairingState === 'paired'
  );
});

console.log(devices.length);
for (const device of devices) {
  const name = device.deviceProperties?.name ?? 'Unknown iPhone';
  const model =
    device.hardwareProperties?.marketingName ??
    device.hardwareProperties?.deviceType ??
    'iPhone';
  const transport = device.connectionProperties?.transportType ?? 'unknown';
  const udid = device.hardwareProperties?.udid ?? device.identifier ?? '';
  console.log(`${name} (${model}, ${transport})\t${udid}`);
}
NODE
)
  rc=$?
  rm -f "$tmp"

  if [[ $rc -ne 0 || -z "$parsed" ]]; then
    DEVICE_QUERY_ERROR="The launcher could not read Xcode's connected-device list."
    return 2
  fi

  lines=("${(@f)parsed}")
  DEVICE_COUNT="${lines[1]:-0}"

  if (( DEVICE_COUNT > 0 )); then
    for (( index = 2; index <= ${#lines[@]}; index += 1 )); do
      label=${lines[$index]%%$'\t'*}
      udid=${lines[$index]#*$'\t'}
      DEVICE_LABELS+=("$label")
      DEVICE_UDIDS+=("$udid")
    done

    DEVICE_SUMMARY="${(j:\n:)DEVICE_LABELS}"
  fi

  if (( DEVICE_COUNT == 0 )); then
    return 1
  fi

  return 0
}

choose_device() {
  if (( DEVICE_COUNT == 1 )); then
    SELECTED_DEVICE_LABEL="${DEVICE_LABELS[1]}"
    SELECTED_DEVICE_UDID="${DEVICE_UDIDS[1]}"
    return 0
  fi

  local picked index

  picked=$(/usr/bin/osascript - "${DEVICE_LABELS[@]}" <<'APPLESCRIPT'
on run argv
set picked to choose from list argv with title "Choose iPhone" with prompt "More than one paired iPhone is connected. Choose which one to use:" OK button name "Use iPhone" cancel button name "Cancel"
if picked is false then
  return ""
end if
return item 1 of picked
end run
APPLESCRIPT
)

  if [[ -z "$picked" ]]; then
    return 1
  fi

  for (( index = 1; index <= ${#DEVICE_LABELS[@]}; index += 1 )); do
    if [[ "${DEVICE_LABELS[$index]}" == "$picked" ]]; then
      SELECTED_DEVICE_LABEL="${DEVICE_LABELS[$index]}"
      SELECTED_DEVICE_UDID="${DEVICE_UDIDS[$index]}"
      return 0
    fi
  done

  return 1
}

choose_action() {
  local device_label=${1:-}

  /usr/bin/osascript - "$device_label" <<'APPLESCRIPT'
on run argv
set deviceLabel to item 1 of argv
set options to {"Fast Launch", "Live Reload Launch", "Live Reload Launch (Clear Cache)", "Full Rebuild + Install", "Reinstall Last Build", "Check Connection Only"}
set promptText to "Choose what to run for your iPhone:" & return & return & ¬
  "Fast Launch: launch the installed app from its embedded bundle" & return & ¬
  "Live Reload Launch: opt into Metro and hot reload" & return & ¬
  "Live Reload Launch (Clear Cache): same Metro flow, but clears cache first" & return & ¬
  "Full Rebuild: native rebuild plus install using the embedded bundle" & return & ¬
  "Reinstall Last Build: install the last built app again" & return & ¬
  "Check Connection Only: just confirm the selected iPhone is ready"
if deviceLabel is not "" then
  set promptText to promptText & return & return & "Selected iPhone:" & return & deviceLabel
end if
set picked to choose from list options with title "MSML iPhone Launcher" with prompt promptText default items {"Fast Launch"} OK button name "Run" cancel button name "Cancel"
if picked is false then
  return ""
end if
return item 1 of picked
end run
APPLESCRIPT
}

ACTION=${1:-}

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[[ "${LANG:-}" == *UTF-8* || "${LANG:-}" == *utf-8* ]] || export LANG="en_US.UTF-8"
[[ "${LC_ALL:-}" == *UTF-8* || "${LC_ALL:-}" == *utf-8* ]] || export LC_ALL="$LANG"
[[ "${LC_CTYPE:-}" == *UTF-8* || "${LC_CTYPE:-}" == *utf-8* ]] || export LC_CTYPE="$LANG"

if [[ -s "$NVM_DIR/nvm.sh" ]]; then
  . "$NVM_DIR/nvm.sh"
fi

cd "$PROJECT_DIR" || exit 1

while true; do
  find_connected_iphones
  DEVICE_CHECK_RESULT=$?
  case "$DEVICE_CHECK_RESULT" in
    0)
      break
      ;;
    1)
      RETRY_CHOICE=$(prompt_retry \
        "No iPhone Connected" \
        $'No paired physical iPhone was detected.\n\nPlug in your iPhone, unlock it, trust this Mac if prompted, then click Retry.')
      [[ "$RETRY_CHOICE" == "Retry" ]] || exit 1
      ;;
    2)
      RETRY_CHOICE=$(prompt_retry \
        "iPhone Check Failed" \
        "$DEVICE_QUERY_ERROR")
      [[ "$RETRY_CHOICE" == "Retry" ]] || exit 1
      ;;
  esac
done

choose_device || exit 0

if [[ -z "$ACTION" ]]; then
  CHOICE=$(choose_action "$SELECTED_DEVICE_LABEL")
  case "$CHOICE" in
    "Fast Launch")
      ACTION="fast-launch"
      ;;
    "Live Reload Launch")
      ACTION="live-reload-launch"
      ;;
    "Live Reload Launch (Clear Cache)")
      ACTION="live-reload-launch-clear"
      ;;
    "Full Rebuild + Install")
      ACTION="full-rebuild"
      ;;
    "Reinstall Last Build")
      ACTION="reinstall"
      ;;
    "Check Connection Only")
      ACTION="check-connection"
      ;;
    "")
      exit 0
      ;;
    *)
      show_dialog "Launcher Error" "Unknown launcher choice: $CHOICE" "stop"
      exit 1
      ;;
  esac
fi

case "$ACTION" in
  fast-launch)
    ACTION_LABEL="Fast Launch"
    NPM_SCRIPT="ios:device:launch"
    ;;
  fast-launch-clear|live-reload-launch-clear)
    ACTION_LABEL="Live Reload Launch (Clear Cache)"
    NPM_SCRIPT="ios:device:launch:dev:clear"
    ;;
  live-reload-launch)
    ACTION_LABEL="Live Reload Launch"
    NPM_SCRIPT="ios:device:launch:dev"
    ;;
  full-rebuild)
    ACTION_LABEL="Full Rebuild + Install"
    NPM_SCRIPT="ios:device"
    ;;
  reinstall)
    ACTION_LABEL="Reinstall Last Build"
    NPM_SCRIPT="ios:device:install"
    ;;
  check-connection)
    ACTION_LABEL="Check Connection Only"
    NPM_SCRIPT=""
    ;;
  *)
    show_dialog "Launcher Error" "Unknown launcher action: $ACTION" "stop"
    exit 1
    ;;
esac

if [[ "$ACTION" == "check-connection" ]]; then
  show_dialog \
    "iPhone Ready" \
    $'Selected iPhone:\n'"$SELECTED_DEVICE_LABEL"$'\n\nUse Fast Launch for bundle-first launches.\nUse Live Reload Launch when you want Metro and hot reload.\nUse Full Rebuild + Install after native or package changes.'
  exit 0
fi

clear
echo "MSML iPhone Launcher"
echo
echo "Selected iPhone:"
echo "$SELECTED_DEVICE_LABEL"
echo
echo "Action: $ACTION_LABEL"
echo "Command: npm run $NPM_SCRIPT -- --device $SELECTED_DEVICE_UDID"
echo

npm run "$NPM_SCRIPT" -- --device "$SELECTED_DEVICE_UDID"
STATUS=$?

echo
if [[ $STATUS -eq 0 ]]; then
  echo "Finished successfully."
else
  echo "Command failed with exit code $STATUS."
fi
echo
echo "You can close this window now."
read '?Press Return to close... '

exit $STATUS
