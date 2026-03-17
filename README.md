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

### 1. Clone the repo (needed for auth)

```bash
git clone https://github.com/donkitchen/milk-mcp.git
cd milk-mcp
npm install
```

### 2. Authenticate with RTM

Run the auth script to connect to your Remember The Milk account:

```bash
npm run auth
```

This will:
1. Prompt for your API key and shared secret
2. Open a browser URL for you to authorize the app
3. Save credentials to `~/.config/milk-mcp/config`

You can also pass credentials as environment variables:

```bash
RTM_API_KEY=xxx RTM_SHARED_SECRET=yyy npm run auth
```

### 3. Add to Claude Code

```bash
claude mcp add milk-mcp -- npx milk-mcp
```

Restart Claude Code to load the MCP server.

> **Note**: The auth step requires cloning the repo, but once authenticated, Claude Code runs milk-mcp via npx from npm.

## Project Structure in RTM

For each project, milk-mcp creates 5 lists in RTM (prefixed with `CC:` for Claude Code):

| List | Purpose |
|------|---------|
| `CC:ProjectName/TODO` | Active tasks for the current session |
| `CC:ProjectName/Backlog` | Deferred or future work |
| `CC:ProjectName/Bugs` | Bug reports with reproduction steps |
| `CC:ProjectName/Decisions` | Architectural decisions with rationale |
| `CC:ProjectName/Context` | Session handoff notes (single task with rotating notes) |

## Available Tools

### Project Management

| Tool | Description |
|------|-------------|
| `rtm_list_projects` | List all projects set up in RTM |
| `rtm_setup_project` | Create the 5 standard lists for a new project |

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

### Queries

| Tool | Description |
|------|-------------|
| `rtm_get_todos` | List open TODO tasks |
| `rtm_get_bugs` | List open bugs |
| `rtm_get_decisions` | List all logged decisions |

## Usage Example

**First time setup:**
```
You: Set up milk-mcp for my ReadyPath project
Claude: [calls rtm_setup_project with project="ReadyPath"]
        ✅ Created 5 lists for ReadyPath
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
