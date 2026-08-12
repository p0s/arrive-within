# ADR 0004: Minimal public repository root

Status: accepted on 2026-08-12

Arrive Within keeps only the small-project essentials at the public root: `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `LICENSE`, `THIRD_PARTY_NOTICES.md`, build/tool version files, and `project.yml`.

Focused architecture, art, content, asset, and media-license material lives under `docs/`. The published bilingual website is the user-facing privacy policy. Community conduct is summarized in `CONTRIBUTING.md`; a separate formal policy can be added when contributor volume warrants it. The license notice retains the concise trademark boundary without a separate root trademark file.

`AGENTS.md`, `SPEC.md`, `GOAL.md`, and `LOCAL_*.md` are private local workflow/authority files and remain ignored. Generated validation reports are ignored local evidence so the public tree has no self-referential hash artifacts. `ArriveWithin.xcodeproj` is regenerated from `project.yml` and is ignored rather than published.

The owner selected MIT for project-owned code, documentation, and build tooling to maximize straightforward reuse. CC BY 4.0 media licensing, third-party notices, security reporting, privacy behavior, contributor rights requirements, and the public-byte validation gate remain separate and unchanged.
