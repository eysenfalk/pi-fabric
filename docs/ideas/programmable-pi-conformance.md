# Programmable Pi conformance and integration evidence

**Status:** Idea / uncommitted  
**Implementation authority:** None

This document MUST NOT be treated as implementation scope. An active Epic or Story is authoritative for implementation.

## Essence

Each programmable Pi-Fabric capability should eventually be proven in realistic combinations, not only through isolated API tests.

## Intent

Retain the cross-surface evidence vision without coupling optional UI, authoring, or resource work into one baseline release.

## Things we do not want to forget

- one small reference workflow per supported delivery slice
- Program invocation through each supported entry point
- Pi-core override, captured extension, and MCP mediation tested separately
- exact Skill binding and prompt rendering when those surfaces exist
- child-agent and nested-Program behavior when supported
- TUI and non-TUI evidence
- trust, approval, cancellation, partial effects, and resume display
- deterministic contract conformance separated from model task quality
- tests against the freshly built `dist/` bundle
- migration guidance for Programs v1
- explicit current-Main nesting limitations

## Constraints and principles

- validation accompanies each delivery increment; it is not one late umbrella gate
- optional UI and authoring work do not block foundation evidence
- no large opinionated workflow catalog is required
- resume display is not execution replay
- unknown or uncertain effects are reported, never presented as rolled back
- cross-host portability must not be claimed without a second host

## Open questions

- Which smallest workflow exercises each supported surface without testing model luck?
- Which evidence belongs in deterministic tests, PTY recordings, or manual review?
- How are old-session rendering and rollback verified across bundle versions?
- What startup/schema/performance baseline detects accidental model-facing complexity?

## Possible directions

These are hypotheses, not requirements:

- foundation evidence for ProgramRunner parity
- separately gated composition evidence
- command-invocation evidence only after command semantics are approved
- resource and UI conformance added with their own increments

## Delivery status

Not committed. Historical discussion: GitHub #10 and architecture review #17.
