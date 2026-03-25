# Custom Tools

Place custom tool definitions here (for example `*.tool.ts`).

These are runtime files, not declarative AgentSpec resources.

If you declare a local tool in `agentspec/tools/*.yaml` with `spec.source: local`,
`spec.modulePath` must point to one of these files (for example `tools/my-tool.tool.ts`).
