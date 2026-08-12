#!/bin/zsh
set -euo pipefail

if [[ $# -lt 2 || $# -gt 3 ]]; then
  print -u2 "Usage: $0 unit|ui|all DEVICE_IDENTIFIER [TEST_IDENTIFIER]"
  exit 64
fi

test_scope="$1"
device_identifier="$2"
test_identifier="${3:-}"
case "$test_scope" in
  unit|ui|all) ;;
  *)
    print -u2 "Unknown test scope: $test_scope"
    exit 64
    ;;
esac

if [[ ! "$device_identifier" =~ '^[0-9A-F]{8}-[0-9A-F]{16}$' ]]; then
  print -u2 "Physical device identifier is not valid."
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

destination="platform=iOS,id=${device_identifier}"
lock_directory="${TMPDIR:?}/codex-ios-xctest-physical-${device_identifier}.lock"
if ! /bin/mkdir "$lock_directory" 2>/dev/null; then
  print -u2 "Another XCTest invocation owns the requested physical-device lane."
  exit 75
fi

cleanup() {
  /bin/rmdir "$lock_directory"
}
trap cleanup EXIT HUP INT TERM

if arrive_within_runtime_xctest_is_running_for_destination "$destination"; then
  print -u2 "Another XCTest invocation is already running on the requested physical device."
  exit 75
else
  preflight_status=$?
  if (( preflight_status != 1 )); then
    print -u2 "Could not inspect the requested physical-device XCTest process lane."
    exit 69
  fi
fi

project_root="${script_directory:h}"
derived_data_path="${ARRIVE_WITHIN_DERIVED_DATA_PATH:-${project_root}/.build/xcode-physical-tests}"

only_testing=()
case "$test_scope" in
  unit) only_testing=(-only-testing:ArriveWithinTests) ;;
  ui) only_testing=(-only-testing:ArriveWithinUITests) ;;
  all) ;;
esac
if [[ -n "$test_identifier" ]]; then
  only_testing=(-only-testing:"$test_identifier")
fi

result_bundle=()
if [[ -n "${ARRIVE_WITHIN_RESULT_BUNDLE_PATH:-}" ]]; then
  result_bundle=(-resultBundlePath "$ARRIVE_WITHIN_RESULT_BUNDLE_PATH")
fi

signing_settings=()
if [[ -n "${ARRIVE_WITHIN_PHYSICAL_PROVISIONING_PROFILE_SPECIFIER:-}" ]]; then
  if [[ "$ARRIVE_WITHIN_PHYSICAL_PROVISIONING_PROFILE_SPECIFIER" == *$'\n'* \
    || ${#ARRIVE_WITHIN_PHYSICAL_PROVISIONING_PROFILE_SPECIFIER} -gt 128 ]]; then
    print -u2 "The physical provisioning profile specifier is not valid."
    exit 64
  fi
  signing_settings=(
    ARRIVE_WITHIN_APP_CODE_SIGN_STYLE=Manual
    "ARRIVE_WITHIN_PROVISIONING_PROFILE_SPECIFIER=$ARRIVE_WITHIN_PHYSICAL_PROVISIONING_PROFILE_SPECIFIER"
  )
fi

xcodebuild \
  -quiet \
  -project "$project_root/ArriveWithin.xcodeproj" \
  -scheme ArriveWithin \
  -configuration Debug \
  -destination "$destination" \
  -destination-timeout 60 \
  -derivedDataPath "$derived_data_path" \
  -parallel-testing-enabled NO \
  -maximum-parallel-testing-workers 1 \
  "${result_bundle[@]}" \
  "${only_testing[@]}" \
  "${signing_settings[@]}" \
  test
