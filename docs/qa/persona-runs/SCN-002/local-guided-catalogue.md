# SCN-002 local guided catalogue and source-content probe

Date: 2026-08-09
Status: Passed for the named local catalogue boundary; 84-track product closure remains in progress
Product tree: current uncommitted local source; Git lineage does not exist and is not claimed

## Outcome

The app loads one typed, versioned catalogue containing exactly G01–G42 with English/German parity. Selecting Guided renders the searchable, filterable 42-practice list directly in the lower Meditate surface without a separate library selector. Each row opens the localized detail view, favorites persist, and guided playback still refuses to start while approved local narration is absent. No missing media is represented as available.

All 42 concepts now have complete English and German draft scripts. The 84 source files pass metadata, literal-source, safety, placeholder, and duration-based word-bound validation. Draft status is not fluent editorial, safety-editor, narration, or listening approval.

## Reproducible checks

| Check | Target | Result |
|---|---|---|
| `swift test --package-path Packages/ArriveWithinCore` | Host Swift package | Latest coherent package freeze: 41 passed across 7 suites; 0 failed/skipped |
| Hosted app unit suite | iPhone 17 Pro simulator, iOS 26.5 | Latest coherent hosted freeze: 9 passed, 0 failed/skipped; result bundle `Test-ArriveWithin-2026.08.09_20-11-34-+0800.xcresult` |
| Guarded `testGuidedCatalogueFiltersAllFortyTwoWithoutPretendingAudioIsReady` | iPhone 17 Pro simulator, iOS 26.5 | 1 passed, 0 failed/skipped; result bundle `Test-ArriveWithin-2026.08.09_16-44-55-+0800.xcresult` |
| `./scripts/validate_guided_content.py catalog` | Public catalogue contract | 42 concepts × 2 languages passed |
| `./scripts/validate_guided_content.py source` | Public script-source contract | 42 concepts × 2 languages and 21,019 EN / 21,027 DE spoken words passed; exact G01–G42 order and all source hashes recorded by the validator output |
| `generate_auditions.py --validate-only` | Pinned default-voice audition inputs | Exact 6 × 2 matrix, source hashes, and literal excerpts passed |
| `scripts/analyze_narration_auditions.py` | Private raw WAVs to public-safe objective ledger | 12 of 12 cells decoded, hash/format checked, and measured; no normalization or human approval applied |
| `generate_pacing_auditions.py --validate-only` | Owner-directed sentence-aware comparison contract | Exact two English plus three German variants, literal G01/G30 sentences, hashes, rights boundary, and pause ranges passed |
| `scripts/analyze_pacing_auditions.py` | Private revised WAVs to public-safe objective ledger | Five clips decoded and measured; English sentence renders proved byte-identical across spacing variants; no time stretch, normalization, or production approval applied |
| `generate_cadence_accent_auditions.py --validate-only` | Urgently corrected owner contract | Exact slower E1/E2 and three isolated German-only candidates, literal G01/G30 text, pins, rights boundaries, and per-call language requirements passed |
| `scripts/analyze_cadence_accent_auditions.py` | Private corrected WAVs to public-safe objective ledger | Five clips, four fresh process manifests, exact hashes/assemblies, separate speech-only/overall WPM, duration boundaries, and clipping attention passed objective validation |

## Reproducibility and rights boundary

The public audition environment locks Chatterbox `5de7a54…`, Perth `ce86c49…`, Python 3.11, and the complete transitive graph. The plan fixes model revision `5bb1f6e…`, German multilingual V3, seed `20260809`, and the owner-directed `.30/.70` settings. It prohibits reference audio. Raw auditions, model files, and detailed local manifests remain ignored; public-safe hashes and objective measurements live in `docs/audio/audition-results.json`.

No narration file is approved or counted complete. Seven raw cells carry clipping attention, and the raw set intentionally has no mastering normalization; this is actionable audition evidence, not a production failure or release pass. Owner voice/pacing choice, public-redistribution sign-off, fluent English/German editorial and safety review, listening QA, production-track generation/mastering, transcript alignment, physical route/lock/interruption proof, and final package size remain separate gates.

The owner subsequently approved the English default identity but found even the preferred 850 ms version too fast overall. The corrected private E1/E2 packet uses one newly regenerated English-only set of fluid sentence units with 1.1/1.35 second sentence gaps and 1.6/1.9 second transitions; speech-only and overall rates are reported separately. German C-like pacing was closest, but its English-accent drift was a hard rejection. Three bounded candidates were therefore generated in separate fresh German-only processes, with `language_id="de"` on all five calls per candidate and no English generation calls. Objective results live in `docs/audio/cadence-accent-audition-results.json`.

The owner then selected German C2 and English F2 as the production-candidate directions, retaining F1 as rejected-but-good audition provenance. Those decisions clear the direction gates only. Mastering, fluent bilingual listening/editorial/pronunciation review, redistribution sign-off, VTT human review, physical audio, and finished-library approval remain open; no audition clip is a finished track.
