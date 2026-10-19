# Shared classifier for the machine-global XCTest runtime lane.
#
# Match only standalone xcodebuild action tokens. In particular,
# `build-for-testing` and `-only-testing:…` are compilation/filter arguments,
# not runtime XCTest actions, and must remain eligible for checkout-isolated
# overlap.

typeset -gr ARRIVE_WITHIN_RUNTIME_XCTEST_PGREP_PATTERN='(^|[/[:space:]])[x]codebuild.*[[:space:]](test|test-without-building)([[:space:]]|$)'

arrive_within_command_line_has_runtime_xctest_verb() {
  if [[ $# -ne 1 ]]; then
    return 2
  fi
  print -r -- "$1" | /usr/bin/grep -Eq "$ARRIVE_WITHIN_RUNTIME_XCTEST_PGREP_PATTERN"
}

arrive_within_runtime_xctest_is_running() {
  /usr/bin/pgrep -f "$ARRIVE_WITHIN_RUNTIME_XCTEST_PGREP_PATTERN" >/dev/null
  case $? in
    0) return 0 ;;
    1) return 1 ;;
    *) return 2 ;;
  esac
}

arrive_within_command_line_has_runtime_xctest_for_destination() {
  if [[ $# -ne 2 || -z "$2" ]]; then
    return 2
  fi

  arrive_within_command_line_has_runtime_xctest_verb "$1" \
    && [[ "$1" == *"-destination $2"* ]]
}

arrive_within_runtime_xctest_is_running_for_destination() {
  if [[ $# -ne 1 || -z "$1" ]]; then
    return 2
  fi

  local destination="$1"
  local command_lines
  command_lines="$(/bin/ps -Aww -o command=)" || return 2

  local command_line
  while IFS= read -r command_line; do
    if arrive_within_command_line_has_runtime_xctest_for_destination "$command_line" "$destination"; then
      return 0
    fi
  done <<< "$command_lines"

  return 1
}
