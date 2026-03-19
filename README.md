# milk-mcp

A TypeScript MCP server that uses [Remember The Milk](https://www.rememberthemilk.com/) as persistent memory and task management for Claude Code sessions.

## Why milk-mcp?

Claude Code sessions are ephemeral — when you close a session, the context is gone. milk-mcp solves this by giving Claude persistent memory through RTM:

- **Session handoffs** — Claude writes what it accomplished and what's next, then picks up where it left off next session
- **Task tracking** — TODOs, backlog items, and bugs persist across sessions
- **Decision log** — Architectural decisions are recorded with rationale so Claude remembers *why* choices were made
- **Project-scoped** — Each project gets its own set of lists, keeping things organized

## Prerequisites

1. A [Remember The Milk](https://www.rememberthemilk.com/) account (free tier works)
2. RTM API credentials — get them at https://www.rememberthemilk.com/services/api/keys.rtm
3. Node.js 18+

## Setup

### 1. Authenticate with RTM

```bash
npx milk-mcp auth
```

This will:
1. Prompt for your API key and shared secret
2. Give you a URL to authorize the app in your browser
3. Save credentials to `~/.config/milk-mcp/config`

You can also pass credentials directly:

```bash
npx milk-mcp auth <api_key> <shared_secret>
```

### 2. Add to Claude Code

```bash
claude mcp add milk-mcp -- npx milk-mcp
```

Restart Claude Code to load the MCP server.

### 3. (Optional) Enable automatic sessions

You can instruct Claude to automatically load context at session start and save it when you wrap up. Add the following to your `~/.claude/CLAUDE.md` for all projects:

```markdown
## RTM Session Management

Use the milk-mcp tools for persistent memory across sessions:

- **Session start**: Call `rtm_session_start` with the project name derived from the
  current working directory name (e.g., if in `/Users/me/code/my-project`, use
  project="my-project")
- **Session end**: When the user says "wrap up", "done for now", "let's stop",
  "save context", or similar, call `rtm_session_end` with the directory-based
  project name and a summary of what was accomplished, what's in progress, and
  suggested next steps

If `rtm_session_start` fails because the project doesn't exist, offer to run
`rtm_setup_project` to create it.
```

Or add to a specific project's `.claude/CLAUDE.md` with a hardcoded project name.

## Project Structure in RTM

For each project, milk-mcp creates 6 lists in RTM (prefixed with `CC:` for Claude Code):

| List | Purpose |
|------|---------|
| `CC:ProjectName/TODO` | Active tasks for the current session |
| `CC:ProjectName/Backlog` | Deferred or future work |
| `CC:ProjectName/Bugs` | Bug reports with reproduction steps |
| `CC:ProjectName/Decisions` | Architectural decisions with rationale |
| `CC:ProjectName/Context` | Session handoff notes (single task with rotating notes) |
| `CC:ProjectName/Learnings` | Hard-won lessons that persist as reference |

## Available Tools

### Project Management

| Tool | Description |
|------|-------------|
| `rtm_list_projects` | List all projects set up in RTM |
| `rtm_setup_project` | Create the 6 standard lists for a new project |

### Session Lifecycle

| Tool | Description |
|------|-------------|
| `rtm_session_start` | Load context and open TODOs at session start |
| `rtm_session_end` | Write handoff summary at session end |
| `rtm_get_context` | Read just the latest context note |

### Task Management

| Tool | Description |
|------|-------------|
| `rtm_add_task` | Add a task to the TODO list |
| `rtm_add_backlog` | Add an item to the Backlog |
| `rtm_add_bug` | Log a bug with reproduction steps |
| `rtm_log_decision` | Record an architectural decision |
| `rtm_complete_task` | Mark a task complete |
| `rtm_update_task` | Update priority, due date, name, tags, or add a note |
| `rtm_promote_to_todo` | Move a backlog item to TODO |

### Queries

| Tool | Description |
|------|-------------|
| `rtm_get_todos` | List open TODO tasks |
| `rtm_get_backlog` | List backlog items |
| `rtm_get_bugs` | List open bugs |
| `rtm_get_decisions` | List all logged decisions |
| `rtm_get_learnings` | List all recorded learnings |

### Learnings

| Tool | Description |
|------|-------------|
| `rtm_add_learning` | Record a hard-won lesson (API quirks, gotchas, patterns) |
| `rtm_get_learnings` | List all learnings for a project |

## Usage Example

**First time setup:**
```
You: Set up milk-mcp for my ReadyPath project
Claude: [calls rtm_setup_project with project="ReadyPath"]
        ✅ Created 6 lists for ReadyPath
```

**Starting a session:**
```
You: Let's work on ReadyPath
Claude: [calls rtm_session_start with project="ReadyPath"]
        Here's where we left off: ...
        Open TODOs: ...
```

**Ending a session:**
```
You: Let's wrap up
Claude: [calls rtm_session_end with summary of what was done]
        ✅ Context saved for next time
```

## Upgrading

Check your current version:

```bash
npx milk-mcp --version
```

To get the latest version:

```bash
# Clear the npx cache
npx clear-npx-cache

# Or use @latest explicitly
npx milk-mcp@latest --version
```

For automatic updates, configure Claude Code with `@latest`:

```bash
claude mcp remove milk-mcp
claude mcp add milk-mcp -- npx milk-mcp@latest
```

## The milk.tools Universe

milk-mcp is part of [milk.tools](https://milk.tools) — a collection of productivity tools built on RTM.

| Product | Description |
|---------|-------------|
| **[milk-mcp](https://github.com/donkitchen/milk-mcp)** | This. You're reading it. |
| **[milk-pm](https://github.com/donkitchen/milk-pm)** | Terminal-native project management. |

Same credentials. Zero extra setup.

## Development

```bash
# Run in development mode (auto-reload)
npm run dev

# Run smoke tests
npm run test:smoke

# Build for production
npm run build
```

## License

MIT
