# Product vision

**Status:** Vision / directional  
**Implementation authority:** None by itself

Pi-Fabric gives Pi one programmable, governed runtime for composing tools, agents, providers, and durable coordination. It should make complex control flow explicit in checked code without turning every capability into a separate model-facing tool or introducing a second workflow engine.

This document describes durable intent. It is not an implementation specification, acceptance contract, roadmap commitment, or authorization to build future capabilities.

## Essence

- **One programmable surface.** Branching, loops, fan-out, data flow, and bounded orchestration live in one checked program.
- **One execution foundation.** Inline code, stored programs, tools, agents, and providers remain governed by Fabric's existing runtime and policy boundaries.
- **Host-mediated authority.** Guest code receives only explicit capabilities. Sandboxing, trust, approvals, Schema enforcement, cancellation, deadlines, and budgets remain host concerns.
- **Exact capability use.** Programs discover or bind concrete tools, providers, models, and Skills rather than relying on broad prompt inference.
- **Progressive complexity.** Simple work stays simple; agents, Actors, mesh, committed capability views, and advanced workflows are opt-in.
- **Truthful operation.** Activity, results, partial effects, failures, and lifecycle boundaries are represented without implying guarantees the host does not provide.
- **Additive evolution.** New programmable subsets extend Pi-Fabric without redefining it, weakening existing behavior, or forcing speculative abstractions into current work.

## Product boundary

Pi-Fabric is a programmable tool and agent runtime for Pi. It is not, by default:

- a universal workflow DSL,
- a package marketplace,
- a replacement for Pi's session runtime,
- an ambient authority broker,
- or a promise that every future idea will be implemented.

Potential extensions are retained in [`../ideas/`](../ideas/README.md). Only active delivery artifacts can authorize their implementation.

## Fork posture

This fork intentionally explores additive Pi-Fabric capabilities that may not exist upstream. Divergence is a means for testing concrete user value, not evidence that the fork is inherently better.

We preserve the upstream project's defining taste:

- one flat, model-facing programmable tool;
- one checked execution foundation and one authoritative provider-policy path;
- explicit host-mediated trust, effects, approvals, cancellation, and budgets;
- progressive, user-chosen complexity rather than ambient orchestration;
- generic data-driven UI instead of workflow-specific chrome; and
- precise documentation of implemented behavior, boundaries, and failure semantics.

We diverge deliberately only when a concrete user-facing outcome cannot be delivered coherently through the existing mechanisms. The preferred change is the smallest additive seam that preserves ordinary behavior, can be removed or rolled back, and remains valuable without speculative follow-on work. Where practical, such slices should remain independently understandable and upstreamable; local utility does not depend on upstream acceptance.

This posture guides product judgment. It does not authorize any particular implementation.
