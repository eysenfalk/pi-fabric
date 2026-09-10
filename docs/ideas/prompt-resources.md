# Prompt resources in Programs

**Status:** Idea / uncommitted  
**Implementation authority:** None

This document MUST NOT be treated as implementation scope. An active Epic or Story is authoritative for implementation.

## Essence

Programs could discover and render prompt templates that Pi has already made available, then use the rendered text as ordinary data.

## Intent

Reuse existing Pi prompt resources without introducing another template format or implicitly starting Main.

## Things we do not want to forget

- list, describe, and render operations
- effective names, provenance, collision winners, and trust
- quoting and empty arguments
- positional parameters, `$@`, and `$ARGUMENTS`
- defaults and slices
- Unicode and missing-resource behavior
- bounded rendered output
- resource identity and freshness
- compatibility fixtures against supported Pi versions

## Constraints and principles

- rendering does not dispatch commands or invoke a model
- project templates remain subject to Pi trust
- do not silently rescan directories
- do not import private Pi internals
- prefer a public Pi renderer if one becomes available
- any Fabric compatibility adapter must be deliberately narrow and version-tested

## Open questions

- Does Pi's public Extension API expose loaded prompt content or only metadata and provenance?
- Can the effective collision winner be identified without recreating loading semantics?
- What happens when the backing file changes after discovery?
- Which renderer semantics are stable across Pi-Fabric's supported Pi range?

## Possible directions

These are hypotheses, not requirements:

- begin with a feasibility probe of public resource identity and content
- return rendered text plus source identity/freshness metadata
- keep prompt rendering independently testable from Program composition

## Delivery status

Not committed. Historical discussion: GitHub #7 and architecture review #17.
