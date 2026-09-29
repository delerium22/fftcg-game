# Rung V1-A4 — Codex code review adjudication (2026-09-30)

Codex (gpt-5.6-sol, xhigh, read-only) against feat/v1a4-source-characters at 94afb9c.

- **MEDIUM — `onSource` binds a CardId, not an incarnation:** a source that leaves and re-enters before resolution would get the effect. Engine-wide (declared targets have the same property); no pool card can re-enter while its ability waits (a plain Character is cast only with an empty stack). Recorded in the spec as backlog, no change.
- **LOW ×2 — accepted, fixed in c42acbb:** the gone-source test now proves the binding (a draw gated on `subjectMatches` of the source name; mutation-checked); an ISMCTS keys test pins a `characters` chooser (Forward vs Backup refs, round-trips across determinisations and a renumbered view).
