# ADR 0011: Physical capture clock and product identity

Status: Accepted

## Context

CoreDevice reports a physical device's product identifier rather than its marketing name. The supported 13-inch iPad returns `iPad16,5`; native hardware metadata independently identifies it as iPad Pro 13-inch (M4).

A physical device can report a different IANA timezone while showing the same actual Singapore clock. Requiring the string `Asia/Singapore` rejects truthful captures without checking whether their date and visible time agree with the capture instant.

## Decision

Preserve the observed product identifier and timezone in physical provenance. Require family `iPad` and exact supported product identifier `iPad16,5`, alongside the existing native route binding and 2064×2752 opaque image checks.

Convert the report's offset-bearing `startedAt` timestamp using both its observed IANA timezone and `Asia/Singapore`. Require equal UTC offsets and local dates/times at that instant, then require the reported date and visible minute to match. Python report validation and TypeScript ingestion/final validation enforce the same clock contract. Actual screenshot clocks still require visual inspection.

## Consequences

No device clock or timezone setting is changed, and no status overlay is used. Equivalent timezone names are accepted only when their clock is equivalent at the capture instant; historical daylight-saving differences fail. Missing offsets, invalid zones, mismatched dates/minutes, wrong hardware and wrong image dimensions remain failures. Simulator evidence retains its existing timezone contract. Changed validator inputs require fresh signed-source capture evidence.
