[Back](2.INDEX.MD)

# ADR 003 · Generation State and Events

## Context

The application needs one generation lifecycle that UI delivery, checkpointing and persistence can observe independently.

## Decision

A generation uses explicit domain states and the pure `transitionGenerationState` function, which throws on invalid transitions. The application publishes discriminated, serializable events through `GenerationEventSink`. UI delivery, checkpointing and persistence subscribe through adapters. Checkpoint state and UI protocol DTOs are separate from private DeepSeek transport models.

VS Code handlers validate and dispatch commands, invoke use cases and translate results. Generation invariants belong to the domain, and provider transport logic belongs to the DeepSeek adapter.

## Consequences

Each accepted generation emits exactly one terminal outcome after persistence reconciliation. The outcomes are `completed`, `cancelled`, `interrupted` and `error`. Explicit Stop preserves the current turn as `cancelled`. Steering and recoverable lifecycle interruption use `interrupted`. Repeated or stale cancellation is idempotent.

Steering carries a verified source-generation link. Only a matching persisted `steered` terminal outcome lets the next provider request continue the previous generation with the new guidance. The UI hides that boundary and shows other interruptions. See the [runtime flow](../../../chat-and-models/runtime-flow.md#queue-steering-and-cancellation) for how steering and cancellation work.

[Back](2.INDEX.MD)

