# Program composition

**Status:** Idea / uncommitted  
**Implementation authority:** None

This document MUST NOT be treated as implementation scope. An active Epic or Story is authoritative for implementation.

## Essence

Programs could eventually compose other named Programs while remaining inside Fabric's existing execution foundation.

## Intent

Enable reusable higher-level workflows—such as feature delivery, Program authoring, and workpacket closure—without creating a second workflow engine.

## Things we do not want to forget

- A → B → C composition
- shared authority and capability identity
- shared cancellation and deadline policy
- shared applicable budgets and admission counters
- bounded recursion, depth, active nodes, calls, output, and memory
- ancestry-local cycle detection
- structured JSON-compatible child results
- sequential and parallel child calls
- deterministic failure and partial-result reporting
- one outer handoff boundary
- child Program name and source identity in the trace
- explicit treatment of detached agents and Actors
- supported-kernel behavior without fallback

## Constraints and principles

- no second workflow engine
- no recursive independent root calls to `FabricExecutionService.execute()`
- no widening or resetting authority and budgets
- preserve the configured kernel, registry, approvals, and Fabric governance
- concurrent calls to the same Program are not automatically cycles
- no hidden transactions, retries, compensation, or sibling cancellation
- no implication of synchronous current-Main nesting

## Open questions

- Which state is root-owned and which is node-local?
- Who owns execution capacity while a parent waits?
- Can A → B → C settle when execution capacity is one?
- How are sibling calls admitted and accounted?
- What happens to caught failures and unawaited calls?
- How do multiple descendants requesting handoff conflict?
- Which work is cancelled with the root, and which work is deliberately detached?
- Can both configured kernels support the same safe semantics?

## Possible directions

These are hypotheses, not requirements:

- a host-created root run frame with bounded child-node state
- a guest `programs.run()` adapter that never accepts authority fields
- ancestry tracking for cycle detection
- one aggregate admission ledger with explicitly documented overshoot behavior
- bounded node projections in existing activity and trace formats

## Evidence before promotion

A minimal configured-kernel A → B → C experiment at capacity one should preserve one root authorization path, retained capability identity, cancellation, shared admission limits, and one terminal boundary. Failure to do so would falsify this Fabric-only direction.

## Delivery status

Not committed. Historical discussion: GitHub #4 and architecture review #17.
