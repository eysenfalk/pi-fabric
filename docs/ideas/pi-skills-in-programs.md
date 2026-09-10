# Pi Skills in Programs

**Status:** Idea / uncommitted  
**Implementation authority:** None

This document MUST NOT be treated as implementation scope. An active Epic or Story is authoritative for implementation.

## Essence

Program stages could discover and explicitly bind the effective Skills already loaded by Pi.

## Intent

Let Programs select exact expertise for child-agent work without keyword routing or a second Skill format.

## Things we do not want to forget

- list, describe, and bounded read operations
- exact Skill names and source provenance
- global and trusted-project resources
- deterministic collision winners
- missing and conflicting binding errors
- omitted Skills versus an explicit empty list
- single- and multi-Skill binding
- invocation isolation
- reload and session invalidation
- model-invocation visibility versus command visibility
- bounded catalog-derived source reads

## Constraints and principles

- reuse the existing `resolveSkillBinding` path
- keep activation scoped to explicit agent requests
- do not infer Skills from task keywords
- do not build a second directory scanner or Skill loader
- project resources remain subject to Pi trust
- host resource identity and freshness must be truthful

## Open questions

- Which public Pi snapshot is available before the first Main turn?
- How is that snapshot invalidated on reload or session replacement?
- What should Programs see when a Skill command is disabled but the Skill remains model-invocable?
- Does disabled model invocation hide a Skill or require explicit human selection?
- Which metadata can be exposed without reading resource files again?

## Possible directions

These are hypotheses, not requirements:

- expose discovery as a thin view over the same catalog used by agent binding
- preflight exact bindings before child-agent admission
- return provenance and freshness alongside bounded content

## Delivery status

Not committed. Historical discussion: GitHub #6 and architecture review #17.
