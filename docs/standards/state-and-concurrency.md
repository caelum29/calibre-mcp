# Standards: state, concurrency and subprocesses

Applies to `src/semantic/**`, any cache or memo, sqlite access, subprocess or HTTP calls, and
timeouts. Default assumption to review against: **two server processes (Desktop + Claude Code)
share one index file, and the model fires calls in parallel** (#156, #196, #197, #246).

## Shared index

- Multi-row writes for one book run in one transaction started with `BEGIN IMMEDIATE`; a partial
  write must never look fresh (#197).
- A server with fewer capabilities (keyword-only) never marks data fresh for a fuller one (#197).

## Cache keys are complete

- Every cache, memo or freshness key includes every input that changes the result — library and
  `filter` at minimum (#215). Ask what unrelated change invalidates it (#244: metadata edits
  trigger a full re-embed).
- Deletes and merges prune derived rows (#100).

## No cached failure

- A memoized async load (model, binary, module) never caches a rejection for the process lifetime
  (#41, #45).

## Bounded I/O

- Every subprocess and HTTP call has a timeout; subprocess timeouts kill the process group, not
  just the child (#13, #145).
- Long downloads use a stall budget, not a fixed total cap (#103).
- `Promise.race` attaches a handler to the losing promise, or its later rejection kills the server
  (#73).

## Long work

- Long sync loops yield so other workers' I/O and timers run (#167).
- Long-running tools emit progress and stay resumable, since the client may time out while the
  work succeeds (#245).
