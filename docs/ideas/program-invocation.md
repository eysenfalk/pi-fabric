# Program invocation surfaces

**Status:** Idea / uncommitted  
**Implementation authority:** None

This document MUST NOT be treated as implementation scope. An active Epic or Story is authoritative for implementation.

## Essence

A reusable Program could be invoked directly by a person, by `fabric_exec`, by another Program, or by a supported host adapter while retaining one governed execution path.

## Intent

Make stored Programs usable capabilities rather than files that only a model may choose to pass to `fabric_exec`.

## Things we do not want to forget

- a canonical `/fabric run <scope/name>` entry point
- list and describe flows
- manifest-driven argument help and completion
- direct per-Program aliases as a possible later convenience
- explicit name-collision and stale-command behavior
- durable result display in Pi sessions
- TUI and non-TUI behavior
- cancellation, shutdown, reload, and session-generation fencing
- one runner rather than separate command and tool runtimes

## Constraints and principles

- user invocation does not pre-approve Program effects
- policy parity does not imply transcript or context parity
- native handoff currently belongs to the outer `fabric_exec` tool-result boundary
- no synthetic assistant tool turns
- no implicit Main-agent invocation
- no generic dispatcher for arbitrary Pi slash commands
- command lifecycle limits must be reported explicitly

## Open questions

- What cancellation signal does a command-owned run receive?
- How should a command react when its Pi session is replaced?
- Which results belong in durable history, and in what message form?
- Can direct aliases be registered and reloaded without stale collisions?
- Which completion behavior works consistently across TUI and RPC hosts?

## Possible directions

These are hypotheses, not requirements:

- start with one canonical command over Programs v1 string arguments
- defer aliases and richer picker UX until real usage warrants them
- define invocation-kind capability profiles rather than claiming identical semantics
- reject handoff from unsupported invocation kinds

## Delivery status

Not committed. Historical discussion: GitHub #5 and architecture review #17.
