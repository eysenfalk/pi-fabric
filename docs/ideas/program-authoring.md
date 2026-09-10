# Safe Program authoring

**Status:** Idea / uncommitted  
**Implementation authority:** None

This document MUST NOT be treated as implementation scope. An active Epic or Story is authoritative for implementation.

## Essence

Humans and Programs could eventually inspect, scaffold, validate, and—under stronger authority—save reusable Programs.

## Intent

Make Program creation maintainable without bypassing manifest validation, trust boundaries, or host authority.

## Things we do not want to forget

- inspect and scaffold-as-data
- bounded validation with machine-readable diagnostics
- explicit checked, unresolved-dynamic, and unsupported categories
- manifest/source type and security checks
- no-overwrite defaults
- project versus global scope authority
- revision identity distinct from the existing source digest
- compare-and-swap updates
- crash-consistent pair visibility
- cross-process races and recovery
- human-readable and machine-readable results

## Constraints and principles

- validation never proves arbitrary Program behavior safe
- do not execute candidate code during static validation
- do not auto-install dependencies
- do not promote generated code into a trusted Pi extension
- arbitrary control flow prevents complete dependency-graph claims
- two separate files do not become one atomic revision through independent renames
- global installation is a distinct approval boundary

## Open questions

- What constitutes one Program revision: manifest, source, transformed source, runtime, or all of them?
- What is the commit point for a manifest/source pair?
- How do concurrent processes observe and update revisions?
- Which dynamic references can be declared, and which remain unresolved?
- What rollback is truthful after uncertain external effects?

## Possible directions

These are hypotheses, not requirements:

- first expose read-only inspect, scaffold, and bounded validate operations
- defer save/update until revision, CAS, authority, and crash semantics are approved
- report incomplete static knowledge instead of rejecting all dynamic Programs
- build a later Program-authoring workflow on top of those primitives

## Delivery status

Not committed. Historical discussion: GitHub #9 and architecture review #17.
