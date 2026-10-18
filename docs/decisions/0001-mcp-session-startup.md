# 0001: Start the local API when the MCP session connects

Status: Accepted

## Context

The MCP adapter forwards requests to a separate local HTTP service. An agent
can run the adapter in a restricted process that cannot write the user's notes.
Starting the HTTP service as that adapter's child can preserve the restriction.
Multiple agents may connect at the same time.

## Decision

The adapter registers its tools, connects to the MCP client, and starts checking
the HTTP service immediately. Tool calls share that startup attempt and wait
for the service to become ready. A healthy existing service is reused.

On Windows, the default launch method is a user-owned Task Scheduler task
registered once with `memorydock service install`. The task has no scheduled
trigger, uses the interactive user with limited privileges, and ignores duplicate
starts. This lets independent MCP adapters request the same service. Other
platforms retain direct child-process startup. Users can select `off` or
`direct` with `MEMORYDOCK_LAUNCH_MODE`.

The tool catalog is available while the HTTP service starts. A tool call can
send an MCP progress notification when the client supplies a progress token;
the adapter also writes status to standard error.

## Limits

The Windows task has its own environment, so custom paths, ports, and embedding
environment overrides require a separately launched service. Some clients may
not display MCP progress or adapter standard error. A restricted environment
may also prevent triggering Task Scheduler; the adapter reports how to start
the service from a normal user shell in that case. Task registration and
launch must be checked on a normal Windows user session because the development
sandbox prevents Task Scheduler access.
