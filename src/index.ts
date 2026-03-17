#!/usr/bin/env node
/**
 * milk-mcp — Remember The Milk MCP server for Claude Code
 *
 * Exposes project-scoped task management tools designed for developer
 * workflows: session context, todos, backlog, bugs, and decisions.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig, RtmClient } from "./rtm-client.js";
import { ProjectManager } from "./project-manager.js";

// ─── Initialise ──────────────────────────────────────────────────────────────

let client: RtmClient;
let pm: ProjectManager;

try {
  const config = loadConfig();
  client = new RtmClient(config);
  pm = new ProjectManager(client);
} catch (err) {
  process.stderr.write(`[milk-mcp] Failed to load config: ${err}\n`);
  process.exit(1);
}

const server = new McpServer({
  name: "milk-mcp",
  version: "0.1.0",
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTask(task: {
  id: string;
  taskseriesId: string;
  listId: string;
  name: string;
  priority: string;
  due: string;
  tags: string[];
  notes: { title: string; body: string }[];
}): string {
  const priorityLabel: Record<string, string> = {
    "1": "🔴 High",
    "2": "🟡 Medium",
    "3": "🔵 Low",
    N: "⚪ None",
  };
  const lines = [
    `• ${task.name}`,
    `  ID: ${task.taskseriesId}/${task.id} (list: ${task.listId})`,
    `  Priority: ${priorityLabel[task.priority] ?? task.priority}`,
    task.due ? `  Due: ${task.due}` : null,
    task.tags.length ? `  Tags: ${task.tags.join(", ")}` : null,
    task.notes.length
      ? `  Notes: ${task.notes.map((n) => n.title || "(untitled)").join(", ")}`
      : null,
  ];
  return lines.filter(Boolean).join("\n");
}

// ─── Tools ───────────────────────────────────────────────────────────────────

/**
 * List all projects that have CC: lists set up.
 */
server.registerTool(
  "rtm_list_projects",
  {
    title: "List RTM Projects",
    description:
      "Returns all Claude Code projects that have been set up in Remember The Milk (lists prefixed with 'CC:').",
    inputSchema: {},
  },
  async () => {
    const projects = await pm.listProjects();
    if (projects.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "No projects found. Use rtm_setup_project to create one.",
          },
        ],
      };
    }
    return {
      content: [
        {
          type: "text",
          text: `Found ${projects.length} project(s):\n${projects.map((p) => `  • ${p}`).join("\n")}`,
        },
      ],
    };
  }
);

/**
 * Bootstrap all 5 lists for a new project.
 */
server.registerTool(
  "rtm_setup_project",
  {
    title: "Setup RTM Project",
    description:
      "Creates the 5 standard lists for a new Claude Code project in RTM: TODO, Backlog, Bugs, Decisions, and Context. Safe to run multiple times — skips lists that already exist.",
    inputSchema: {
      project: z.string().describe("Project name, e.g. 'ReadyPath' or 'StellaCharters'"),
    },
  },
  async ({ project }) => {
    const { created, skipped } = await pm.setupProject(project);
    const lines = [];
    if (created.length) lines.push(`✅ Created:\n${created.map((l) => `  • ${l}`).join("\n")}`);
    if (skipped.length) lines.push(`⏭️  Already existed:\n${skipped.map((l) => `  • ${l}`).join("\n")}`);
    return { content: [{ type: "text", text: lines.join("\n\n") }] };
  }
);

/**
 * Session start — load context + open todos for a project.
 */
server.registerTool(
  "rtm_session_start",
  {
    title: "Start RTM Session",
    description:
      "Load context for a Claude Code session: reads the latest handoff note from the project's Context task, then lists all open TODO items. Call this at the start of every session.",
    inputSchema: {
      project: z.string().describe("Project name"),
    },
  },
  async ({ project }) => {
    const [context, todos] = await Promise.all([
      pm.readContext(project),
      pm.getTodos(project),
    ]);

    const lines: string[] = [`## Session Start: ${project}\n`];

    lines.push("### Last Session Context");
    lines.push(context ?? "_No previous context found._");

    lines.push("\n### Open TODOs");
    if (todos.length === 0) {
      lines.push("_No open tasks._");
    } else {
      lines.push(...todos.map(formatTask));
    }

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

/**
 * Session end — write handoff note.
 */
server.registerTool(
  "rtm_session_end",
  {
    title: "End RTM Session",
    description:
      "Write a session handoff note to the project's Context task. Include what was accomplished, what's in progress, key decisions made, and suggested next steps. Call this at the end of every session.",
    inputSchema: {
      project: z.string().describe("Project name"),
      summary: z
        .string()
        .describe(
          "Handoff summary: what was done, what's in progress, next steps, any gotchas"
        ),
    },
  },
  async ({ project, summary }) => {
    await pm.writeContext(project, summary);
    return {
      content: [
        {
          type: "text",
          text: `✅ Session context saved for "${project}". See it next time with rtm_session_start.`,
        },
      ],
    };
  }
);

/**
 * Read just the context note (without full session init).
 */
server.registerTool(
  "rtm_get_context",
  {
    title: "Get Project Context",
    description: "Read the latest session handoff note for a project without loading the full TODO list.",
    inputSchema: {
      project: z.string().describe("Project name"),
    },
  },
  async ({ project }) => {
    const context = await pm.readContext(project);
    return {
      content: [
        {
          type: "text",
          text: context ?? `No context found for "${project}".`,
        },
      ],
    };
  }
);

/**
 * Add a TODO task.
 */
server.registerTool(
  "rtm_add_task",
  {
    title: "Add Task to Project",
    description: "Add a task to a project's TODO list.",
    inputSchema: {
      project: z.string().describe("Project name"),
      name: z.string().describe("Task name"),
      priority: z
        .enum(["1", "2", "3"])
        .optional()
        .describe("Priority: 1=High, 2=Medium, 3=Low"),
    },
  },
  async ({ project, name, priority }) => {
    const task = await pm.addTodo(project, name, priority as "1" | "2" | "3" | undefined);
    return {
      content: [
        {
          type: "text",
          text: `✅ Added to ${project}/TODO:\n${formatTask(task)}`,
        },
      ],
    };
  }
);

/**
 * Add a backlog item.
 */
server.registerTool(
  "rtm_add_backlog",
  {
    title: "Add Backlog Item",
    description: "Add a deferred or future task to a project's Backlog list.",
    inputSchema: {
      project: z.string().describe("Project name"),
      name: z.string().describe("Backlog item description"),
    },
  },
  async ({ project, name }) => {
    const task = await pm.addBacklogItem(project, name);
    return {
      content: [
        {
          type: "text",
          text: `✅ Added to ${project}/Backlog:\n${formatTask(task)}`,
        },
      ],
    };
  }
);

/**
 * Log an architectural decision.
 */
server.registerTool(
  "rtm_log_decision",
  {
    title: "Log Architectural Decision",
    description:
      "Record an architectural or technical decision in the project's Decisions list. The decision goes in the task name; the rationale goes in a note.",
    inputSchema: {
      project: z.string().describe("Project name"),
      decision: z
        .string()
        .describe("Short decision summary, e.g. 'Use Supabase RLS instead of custom auth'"),
      rationale: z
        .string()
        .describe("Full rationale, tradeoffs considered, alternatives rejected"),
    },
  },
  async ({ project, decision, rationale }) => {
    const task = await pm.logDecision(project, decision, rationale);
    return {
      content: [
        {
          type: "text",
          text: `✅ Decision logged in ${project}/Decisions:\n"${task.name}"\n\nRationale saved as note.`,
        },
      ],
    };
  }
);

/**
 * Add a bug.
 */
server.registerTool(
  "rtm_add_bug",
  {
    title: "Add Bug",
    description: "Add a bug to the project's Bugs list with repro steps in a note.",
    inputSchema: {
      project: z.string().describe("Project name"),
      title: z.string().describe("Bug title"),
      reproSteps: z
        .string()
        .describe("Reproduction steps, expected vs actual behavior, error messages"),
      severity: z
        .enum(["1", "2", "3"])
        .optional()
        .describe("Severity: 1=Critical, 2=Major, 3=Minor"),
    },
  },
  async ({ project, title, reproSteps, severity }) => {
    const task = await pm.addBug(
      project,
      title,
      reproSteps,
      severity as "1" | "2" | "3" | undefined
    );
    return {
      content: [
        {
          type: "text",
          text: `🐛 Bug logged in ${project}/Bugs:\n${formatTask(task)}`,
        },
      ],
    };
  }
);

/**
 * Complete a task by its IDs.
 */
server.registerTool(
  "rtm_complete_task",
  {
    title: "Complete Task",
    description:
      "Mark a task as complete. Get the IDs from rtm_session_start or rtm_get_todos — format is 'listId/taskseriesId/taskId'.",
    inputSchema: {
      listId: z.string().describe("RTM list ID"),
      taskseriesId: z.string().describe("RTM taskseries ID"),
      taskId: z.string().describe("RTM task ID"),
    },
  },
  async ({ listId, taskseriesId, taskId }) => {
    await client.completeTask(listId, taskseriesId, taskId);
    return {
      content: [{ type: "text", text: `✅ Task marked complete.` }],
    };
  }
);

/**
 * Get open TODOs for a project.
 */
server.registerTool(
  "rtm_get_todos",
  {
    title: "Get Project TODOs",
    description: "List all open TODO tasks for a project.",
    inputSchema: {
      project: z.string().describe("Project name"),
    },
  },
  async ({ project }) => {
    const todos = await pm.getTodos(project);
    if (todos.length === 0) {
      return {
        content: [{ type: "text", text: `No open tasks in ${project}/TODO.` }],
      };
    }
    return {
      content: [
        {
          type: "text",
          text: `## ${project} — Open TODOs (${todos.length})\n\n${todos.map(formatTask).join("\n\n")}`,
        },
      ],
    };
  }
);

/**
 * Get open bugs for a project.
 */
server.registerTool(
  "rtm_get_bugs",
  {
    title: "Get Project Bugs",
    description: "List all open bugs for a project.",
    inputSchema: {
      project: z.string().describe("Project name"),
    },
  },
  async ({ project }) => {
    const bugs = await pm.getBugs(project);
    if (bugs.length === 0) {
      return {
        content: [{ type: "text", text: `No open bugs in ${project}/Bugs. 🎉` }],
      };
    }
    return {
      content: [
        {
          type: "text",
          text: `## ${project} — Open Bugs (${bugs.length})\n\n${bugs.map(formatTask).join("\n\n")}`,
        },
      ],
    };
  }
);

/**
 * Get decisions for a project.
 */
server.registerTool(
  "rtm_get_decisions",
  {
    title: "Get Project Decisions",
    description: "List all architectural decisions logged for a project.",
    inputSchema: {
      project: z.string().describe("Project name"),
    },
  },
  async ({ project }) => {
    const decisions = await pm.getDecisions(project);
    if (decisions.length === 0) {
      return {
        content: [
          { type: "text", text: `No decisions logged for ${project} yet.` },
        ],
      };
    }
    return {
      content: [
        {
          type: "text",
          text: `## ${project} — Decisions (${decisions.length})\n\n${decisions.map(formatTask).join("\n\n")}`,
        },
      ],
    };
  }
);

// ─── Connect ─────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write("[milk-mcp] Server running on stdio\n");
