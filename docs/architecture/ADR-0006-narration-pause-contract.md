# ADR-0006: Whole-utterance narration and authored pauses

- Status: Accepted
- Date: 2026-08-20

## Context

The original production planner bounded synthesis by short word counts. A single
authored sentence could therefore be generated as several independent takes and
then assembled. Removing blank PCM at those joins fixed digital silence, but it
could not reconcile pitch, emphasis, breath, spectral colour, or discourse
contour. The result could remain audibly stitched even when the waveform was
time-continuous.

Synthetic silence also encoded editorial meaning in the production machinery.
That made arbitrary memory boundaries sound like intentional meditation pauses.

## Decision

One authored spoken sentence is one model generation call and one transcript cue.
The production path does not split a sentence at a word count, comma, semicolon,
or inferred phrase boundary. It does not insert or extend zero-filled audio inside
a spoken sentence.

Punctuation remains in the text passed to the model so the model can render
natural clause timing within one continuous prosodic take. Assembly preserves
that model-rendered timing byte-for-byte; it does not delete short punctuation
or breathing pauses. A pause that must be reliably audible is expressed as a
real sentence/instruction boundary or an explicit authored meditation pause.

The current native speaking pace remains unchanged. Catalog duration is reached
by allocating time to authored contemplation pauses, not by stretching speech or
placing synthetic blanks inside sentences.

Sentences above the guarded whole-utterance ceiling fail planning. They must be
edited at a genuine sentence or instruction boundary before production; the
pipeline never falls back to stitching unrelated takes.

## Verification

For current production semantics:

- each spoken sentence has exactly one generation segment with `unitIndex` zero;
- the segment source and generation text equal the authored sentence;
- no internal synthetic semantic pause is recorded;
- generated punctuation pauses are preserved rather than cadence-compressed;
- VTT cues retain exact script text and are scanned for unresolved internal
  near-digital silence, while model-rendered quiet aligned with literal authored
  comma, semicolon, or colon boundaries is classified as legitimate cadence;
- a non-punctuation model pause from 450 through 750 ms is retained only as an
  exact, AAC-rechecked `owner-listening-required` attention; anything longer is
  an unresolved failure;
- G02 permanently verifies that “steady view”, “in den Raum”, and “einen Teil der
  Arbeit” remain within single generation calls, and that “Otherwise” begins
  after an authored sentence boundary;
- owner listening remains a required gate because silence and transcript checks
  cannot prove natural prosody.

## Consequences

The number of model calls and checkpoint/model-load overhead falls substantially,
so guarded generation is expected to be faster. Individual calls are longer and
must still run under the host memory guard. Existing phrase-bounded PCM and human
approvals are cache- and hash-incompatible with this decision and cannot be
promoted.
