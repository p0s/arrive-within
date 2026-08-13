# ADR 0005: Keep timer truth independent from recoverable audio

Status: accepted on 2026-08-13

## Context

A physical TestFlight run exposed three coupled failures in the original timer audio path: an audio interruption notice could claim the practice was paused before authoritative session persistence completed, opening and closing bell masters were effectively inaudible, and one-shot closing-bell scheduling could raise an Objective-C AVFoundation exception after the audio engine stopped or rebuilt.

Timer completion and local progress must never depend on audio availability. Guided narration has a different semantic constraint: allowing spoken content to advance silently would lose part of the practice.

## Decision

- Timer and stopwatch elapsed time continues through audio interruption, route loss, and media-services recovery. Their audio graph may stop and rebuild independently, then resume from current authoritative elapsed time when a safe output returns.
- Guided narration pauses durably on the same events and waits for an explicit user resume.
- User-facing notices describe the authoritative session state. A guided-pause notice appears only after the paused session has been saved.
- Every player node connects with its loaded media's explicit format. A stopped or rebuilt engine schedules a one-shot bell buffer before engine preparation and start. Bell failure remains best-effort and cannot own session completion or progress.
- Engine-configuration notifications are accepted only from the meditation controller's current engine.
- Shipping bell assets have automated hash, format, peak, and RMS bounds in addition to later exact-device listening QA.

## Consequences

Timer users do not lose elapsed practice because sound becomes unavailable, while guided users do not silently miss narration. Audio recovery may restart ambience from its loop and narration only from an authoritative guided resume point. Closing cues can still be unavailable under platform route or interruption constraints, but the app completes and persists truthfully without crashing or fabricating audio reliability.
