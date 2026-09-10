# Shared Program runner boundary

**Status:** Idea / uncommitted
**Implementation authority:** None

## Essence

A shared host-side Program runner could become useful if more than one concrete invocation path must execute a reusable Program under the same Fabric governance.

Today, Programs v1 already follow a small direct path: the `fabric_exec` adapter resolves a named Program and invokes the existing `FabricExecutionService` once. Extracting another runtime boundary for that single caller would add architecture for anticipated work rather than present user value.

## Intent

Retain the possible seam without assuming it should exist. If a future user-facing capability such as bounded Program composition or direct invocation proves that the current adapter boundary is insufficient, evaluate the smallest additive change then.

## Why this matters

The idea may eventually help multiple invocation surfaces share Program identity and resolution while preserving one execution engine. Premature extraction would instead create another ownership vocabulary, more lifecycle state, and a migration burden without changing what users can do.

## Things we do not want to forget

- `FabricExecutionService` and `ActionRegistry` remain the owners of execution policy, approval, provider mediation, and cleanup.
- Program source must be resolved and pinned before execution.
- Authority, capability views, cancellation, deadlines, accounting, and host context remain host-owned and invocation-local.
- Inline `fabric_exec({ code })` must not depend on Program discovery.
- A top-level Program currently has one execution-service invocation and one outer handoff boundary.
- Program identity must state exactly what its digest covers.
- Concurrent roots must not exchange authority, counters, state, or cancellation.
- Independent recursive execution-service lifecycles would reset or duplicate governance.
- Persisted display identity is not execution replay or resume.

## Constraints and principles

- Preserve one programmable Fabric tool and one execution foundation.
- Do not add a second workflow engine, policy layer, scheduler, retry system, or transaction abstraction.
- Keep the model-facing schema flat unless a demonstrated user outcome requires otherwise.
- Prefer a local adapter change over a named framework abstraction when there is only one caller.
- Characterize only behavior affected by a promoted change; do not freeze the whole runtime speculatively.
- Do not widen Programs v1 authority or imply stronger filesystem, accounting, rollback, or privacy guarantees.

## Signals that could justify promotion

These are hypotheses, not acceptance criteria:

- a named second caller has a concrete user-visible outcome;
- the existing direct adapter cannot support that caller without duplicated policy or observable divergence;
- a bounded spike identifies shared ownership that is not already represented by `FabricExecutionService`;
- compatibility and rollback can be tested against the affected public boundary; and
- the change remains useful even if no other Program ideas are implemented.

## Open questions

- Can bounded A → B composition reuse the current root execution state without a new top-level runner abstraction?
- Which object already owns capacity, cancellation, approval, and handoff for a nested call?
- Is Program resolution the only shared operation a second invocation surface actually needs?
- Would a direct command require execution parity, or merely adapt into the existing `fabric_exec` boundary?
- What is the smallest user-facing experiment that can falsify the need for this layer?

## Possible directions

These are options to evaluate later, not requirements:

- keep Program resolution in each host adapter while sharing only the catalog;
- introduce a narrow resolution helper rather than a lifecycle-owning runner;
- extend the existing execution service only when nested ownership is proven;
- introduce a host-side runner after two real callers demonstrate the common contract.

## Delivery status

Not committed. This document MUST NOT be treated as implementation scope.

Historical planning remains visible in closed Epic [#3](https://github.com/eysenfalk/pi-fabric/issues/3), Stories #11–#16 and #19, and architecture review [#17](https://github.com/eysenfalk/pi-fabric/issues/17). They record useful concerns but no longer authorize implementation.
