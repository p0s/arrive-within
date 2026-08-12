#!/bin/zsh
set -euo pipefail

if [[ $# -lt 2 || $# -gt 3 ]]; then
  print -u2 "Usage: $0 unit|ui|all SIMULATOR_UDID [TEST_IDENTIFIER]"
  exit 64
fi

test_scope="$1"
simulator_udid="$2"
test_identifier="${3:-}"
case "$test_scope" in
  unit|ui|all) ;;
  *)
    print -u2 "Unknown test scope: $test_scope"
    exit 64
    ;;
esac

if [[ ! "$simulator_udid" =~ '^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$' ]]; then
  print -u2 "Simulator UDID is not valid."
  exit 64
fi

if [[ -n "$test_identifier" \
  && "$test_identifier" != ArriveWithinTests/* \
  && "$test_identifier" != ArriveWithinUITests/* ]]; then
  print -u2 "Test identifier must stay inside an Arrive Within test target."
  exit 64
fi

script_directory="${0:A:h}"
source "$script_directory/xcodebuild_runtime_test_preflight.zsh"

if ! xcrun simctl list devices available | /usr/bin/grep -Fq "$simulator_udid"; then
  print -u2 "The requested simulator is not currently available: $simulator_udid"
  exit 69
fi

lock_directory="${TMPDIR:?}/codex-ios-xctest-global.lock"
if ! /bin/mkdir "$lock_directory" 2>/dev/null; then
  print -u2 "Another XCTest invocation owns the machine-global lane."
  exit 75
fi

status_bar_time="${ARRIVE_WITHIN_STATUS_BAR_TIME:-}"
status_bar_active=0
booted_for_status_bar=0
simulator_wrapper="${ARRIVE_WITHIN_SIMULATOR_WRAPPER:-}"
if [[ -n "$status_bar_time" && -z "$simulator_wrapper" ]]; then
  simulator_wrapper="$(command -v codex-sim-safe || true)"
fi

cleanup() {
  if (( status_bar_active )); then
    if ! "$simulator_wrapper" status_bar "$simulator_udid" clear >/dev/null; then
      print -u2 "Warning: could not clear the bounded simulator status-bar override."
    fi
  fi
  if (( booted_for_status_bar )); then
    if ! "$simulator_wrapper" shutdown "$simulator_udid" >/dev/null; then
      print -u2 "Warning: could not restore the simulator's prior shutdown state."
    fi
  fi
  /bin/rmdir "$lock_directory"
}
trap cleanup EXIT HUP INT TERM

if [[ -n "$status_bar_time" && -z "$simulator_wrapper" ]]; then
  print -u2 "A status-bar override requires ARRIVE_WITHIN_SIMULATOR_WRAPPER or codex-sim-safe on PATH."
  exit 69
fi

if arrive_within_runtime_xctest_is_running; then
  print -u2 "Another XCTest invocation is already running on this Mac."
  exit 75
else
  preflight_status=$?
  if (( preflight_status != 1 )); then
    print -u2 "Could not inspect the machine-global XCTest process lane."
    exit 69
  fi
fi

if [[ -n "$status_bar_time" ]]; then
  if [[ ! "$status_bar_time" =~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' ]]; then
    print -u2 "ARRIVE_WITHIN_STATUS_BAR_TIME must be a millisecond-precision UTC ISO-8601 timestamp."
    exit 64
  fi
  if ! "$simulator_wrapper" list devices available | /usr/bin/grep -F "$simulator_udid" | /usr/bin/grep -Fq '(Booted)'; then
    "$simulator_wrapper" boot "$simulator_udid"
    "$simulator_wrapper" bootstatus "$simulator_udid" -b
    booted_for_status_bar=1
  fi
  "$simulator_wrapper" status_bar "$simulator_udid" override \
    --time "$status_bar_time" \
    --dataNetwork wifi \
    --wifiMode active \
    --wifiBars 3 \
    --cellularMode active \
    --cellularBars 4 \
    --operatorName '' \
    --batteryState charged \
    --batteryLevel 100
  status_bar_active=1
fi

project_root="${script_directory:h}"
derived_data_path="${ARRIVE_WITHIN_DERIVED_DATA_PATH:-${project_root}/.build/xcode-tests}"
destination="platform=iOS Simulator,id=${simulator_udid}"

only_testing=()
case "$test_scope" in
  unit) only_testing=(-only-testing:ArriveWithinTests) ;;
  ui) only_testing=(-only-testing:ArriveWithinUITests) ;;
  all) ;;
esac
if [[ -n "$test_identifier" ]]; then
  only_testing=(-only-testing:"$test_identifier")
fi

xcodebuild \
  -quiet \
  -project "$project_root/ArriveWithin.xcodeproj" \
  -scheme ArriveWithin \
  -configuration Debug \
  -destination "$destination" \
  -derivedDataPath "$derived_data_path" \
  -parallel-testing-enabled NO \
  -maximum-parallel-testing-workers 1 \
  "${only_testing[@]}" \
  test
