# milk-mcp Development

## Session Management

- At the **start** of each session, call `rtm_session_start` with project="milk-mcp" to load context and see open tasks
- At the **end** of each session (when user says "wrap up", "done", "let's stop", etc.), call `rtm_session_end` with project="milk-mcp" and a summary of what was accomplished, what's in progress, and suggested next steps

## When Adding or Updating Tools

Keep these files in sync:
- `project-meta.json` — update `toolCount` and add tool to appropriate category in `toolCategories`
- `README.md` — update the Available Tools tables
