#!/bin/zsh
set -euo pipefail

script_directory="${0:A:h}"
source "$script_directory/xcodebuild_runtime_test_preflight.zsh"

permitted=(
  '/usr/bin/xcodebuild -project App.xcodeproj -scheme App build-for-testing'
  '/Applications/Xcode.app/Contents/Developer/usr/bin/xcodebuild -only-testing:AppTests/Example build-for-testing'
  'xcodebuild -project App.xcodeproj -scheme App build'
  'xcodebuild -project App.xcodeproj -scheme App analyze'
  'xcodebuild -project App.xcodeproj -scheme App test-plan'
  'xcodebuild -project App.xcodeproj -scheme App test-without-building-cache'
)

blocked=(
  '/usr/bin/xcodebuild -project App.xcodeproj -scheme App test'
  '/Applications/Xcode.app/Contents/Developer/usr/bin/xcodebuild test -project App.xcodeproj'
  'xcodebuild -project App.xcodeproj -scheme App test-without-building'
  'xcodebuild test-without-building -only-testing:AppUITests/Example'
)

for command_line in "${permitted[@]}"; do
  if arrive_within_command_line_has_runtime_xctest_verb "$command_line"; then
    print -u2 "Unexpected runtime-XCTest classification: $command_line"
    exit 1
  fi
done

for command_line in "${blocked[@]}"; do
  if ! arrive_within_command_line_has_runtime_xctest_verb "$command_line"; then
    print -u2 "Missed runtime-XCTest classification: $command_line"
    exit 1
  fi
done

first_physical_destination='platform=iOS,id=00000000-0000000000000001'
first_physical_runtime="xcodebuild -project App.xcodeproj -destination ${first_physical_destination} test"
second_physical_runtime='xcodebuild -project App.xcodeproj -destination platform=iOS,id=00000000-0000000000000002 test'

if ! arrive_within_command_line_has_runtime_xctest_for_destination "$first_physical_runtime" "$first_physical_destination"; then
  print -u2 "Missed the exact physical runtime-XCTest destination fixture."
  exit 1
fi

if arrive_within_command_line_has_runtime_xctest_for_destination "$second_physical_runtime" "$first_physical_destination"; then
  print -u2 "Cross-device physical XCTest fixture matched the wrong destination."
  exit 1
fi

print "Guarded XCTest preflight classification passed: ${#permitted} compile/non-test fixtures allowed; ${#blocked} runtime fixtures blocked."

if [[ "${1:-}" == "--live" ]]; then
  if arrive_within_runtime_xctest_is_running; then
    print -u2 "A runtime XCTest xcodebuild command currently owns the machine-global lane."
    exit 75
  else
    preflight_status=$?
    if (( preflight_status != 1 )); then
      print -u2 "Could not inspect the machine-global XCTest process lane."
      exit 69
    fi
  fi
  print "Live guarded XCTest preflight passed: no xcodebuild test or test-without-building command is running."
elif [[ $# -ne 0 ]]; then
  print -u2 "Usage: $0 [--live]"
  exit 64
fi
