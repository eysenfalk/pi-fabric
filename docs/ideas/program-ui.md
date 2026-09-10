# Main-session and UI integration

**Status:** Idea / uncommitted  
**Implementation authority:** None

This document MUST NOT be treated as implementation scope. An active Epic or Story is authoritative for implementation.

## Essence

Fabric Programs could use a bounded subset of existing Pi Extension APIs for session inspection, queued guidance, and human interaction.

## Intent

Expose useful host capabilities without pretending that the currently running Main agent can be called synchronously from its own `fabric_exec` invocation.

## Things we do not want to forget

- allowlisted read-only session metadata
- current model, thinking level, and active-tool metadata
- explicit steering and follow-up queue operations
- select, confirm, input, notify, and status interactions
- bounded text widgets
- TUI, RPC, JSON, print, unavailable, and disconnected behavior
- owner-qualified UI keys and cleanup
- cancellation and competing-dialog behavior
- literal, attributed, bounded queued messages

## Constraints and principles

- never expose raw `ExtensionContext`, credentials, session history, or system-prompt contents
- queued guidance is pending work, not a completed Main result
- disable command and prompt expansion for queued text
- UI confirmation is not Fabric authorization
- session mutations require explicit policy and approval classification
- new/fork/switch/reload remain outside ordinary guest APIs
- arbitrary TUI callbacks do not cross the sandbox boundary

## Open questions

- Which metadata is safe and stable across supported Pi versions?
- Which UI methods have meaningful non-TUI behavior?
- How are status and widget ownership scoped across concurrent runs?
- Should queued guidance and UI interactions be separate providers?
- Which model/tool mutations are useful enough to justify their authority risk?

## Possible directions

These are hypotheses, not requirements:

- treat metadata, queue effects, and UI interaction as separate increments
- return explicit `queued`, `unavailable`, or `cancelled` outcomes
- serialize or reject competing modal interactions
- clean up run-owned UI effects on every terminal path

## Delivery status

Not committed. Historical discussion: GitHub #8 and architecture review #17.
