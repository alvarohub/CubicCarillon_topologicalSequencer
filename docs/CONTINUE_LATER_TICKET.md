# Continue Later Ticket

## Context

We are refactoring the transport and session model so motion and note emission are independent.

## Goals for the next iteration

1. Separate motion from note emission everywhere.
2. Treat `running` as motion state and `muted` as note-output state.
3. Keep `M` as note mute only.
4. Keep `Play/Stop` as motion only.
5. Preserve `S` only if needed for now; likely remove from the main row later.
6. Add per-group and per-track run/stop controls with the same visual language.
7. Add per-group mute all / open all.
8. Save and load the full runtime state, not just the score:
   - global paused state
   - group paused state
   - per-track running state
   - per-track mute/solo state
   - per-track delay/shift
   - per-track position, velocity, face, and cell state
   - current transport mode and rail/derail state
9. Keep backward compatibility with older JSON files by falling back to defaults when runtime fields are missing.
10. Start paused on open.

## UI intent

- Motion and audio should be visually separated.
- A muted track should keep moving so it stays in sync when unmuted.
- A stopped track should stop moving but keep its mute state.
- Global, group, and track run controls should all use one consistent on/off visual language.

## Deferred topic

We still need to diagnose the silent restart issue independently of the transport refactor.
