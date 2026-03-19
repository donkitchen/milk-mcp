/**
 * Project Manager
 *
 * Encapsulates the "CC:" list naming convention and all project-scoped
 * operations. A "project" in milk-mcp is a group of RTM lists prefixed
 * with "CC: <ProjectName> - <ListType>".
 *
 * List types:
 *   TODO      — active tasks for this project
 *   Backlog   — deferred / future work
 *   Bugs      — known issues with repro steps in notes
 *   Decisions — architectural decisions with rationale in notes
 *   Context   — single task whose latest note = session handoff
 *   Learnings — hard-won lessons that persist as reference (never completed)
 */

import { RtmClient, RtmList, RtmTask } from "./rtm-client.js";

export const LIST_TYPES = ["TODO", "Backlog", "Bugs", "Decisions", "Context", "Learnings"] as const;
export type ListType = (typeof LIST_TYPES)[number];

export interface ProjectLists {
  [key: string]: RtmList | undefined;
  TODO?: RtmList;
  Backlog?: RtmList;
  Bugs?: RtmList;
  Decisions?: RtmList;
  Context?: RtmList;
  Learnings?: RtmList;
}

export function listName(project: string, type: ListType): string {
  return `CC: ${project} - ${type}`;
}

export class ProjectManager {
  constructor(private client: RtmClient) {}

  /**
   * Return all unique project names from CC: prefixed lists.
   */
  async listProjects(): Promise<string[]> {
    const lists = await this.client.getLists();
    const projects = new Set<string>();
    for (const list of lists) {
      const match = list.name.match(/^CC:\s+(.+?)\s+-\s+(?:TODO|Backlog|Bugs|Decisions|Context|Learnings)$/);
      if (match) projects.add(match[1]);
    }
    return Array.from(projects).sort();
  }

  /**
   * Get the RTM lists for a project, keyed by type.
   * Only returns lists that exist.
   */
  async getProjectLists(project: string): Promise<ProjectLists> {
    const lists = await this.client.getLists();
    const result: ProjectLists = {};
    for (const type of LIST_TYPES) {
      const name = listName(project, type);
      const found = lists.find((l) => l.name === name);
      if (found) result[type] = found;
    }
    return result;
  }

  /**
   * Bootstrap all 5 lists for a new project.
   * Skips lists that already exist.
   * Returns a summary of what was created.
   */
  async setupProject(project: string): Promise<{ created: string[]; skipped: string[] }> {
    const existing = await this.getProjectLists(project);
    const created: string[] = [];
    const skipped: string[] = [];

    for (const type of LIST_TYPES) {
      if (existing[type]) {
        skipped.push(listName(project, type));
      } else {
        await this.client.createList(listName(project, type));
        created.push(listName(project, type));
      }
    }

    // Seed the Context list with a placeholder task if just created
    if (created.includes(listName(project, "Context"))) {
      const lists = await this.getProjectLists(project);
      if (lists.Context) {
        await this.client.addTask(
          lists.Context.id,
          `[${project}] Session Context`
        );
      }
    }

    return { created, skipped };
  }

  /**
   * Get the Context task for a project (the "brain" of the session).
   * Returns the first non-completed task in the Context list, or null.
   */
  async getContextTask(project: string): Promise<RtmTask | null> {
    const lists = await this.getProjectLists(project);
    if (!lists.Context) return null;
    const tasks = await this.client.getTasks(lists.Context.id);
    return tasks[0] ?? null;
  }

  /**
   * Read the latest session handoff note from the Context task.
   */
  async readContext(project: string): Promise<string | null> {
    const task = await this.getContextTask(project);
    if (!task || task.notes.length === 0) return null;

    // Sort by modified date descending, take the most recent
    const sorted = [...task.notes].sort(
      (a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime()
    );
    return sorted[0].body;
  }

  /**
   * Write a session handoff note to the Context task.
   * If there's already a note from today, updates it. Otherwise adds a new one.
   */
  async writeContext(project: string, content: string): Promise<void> {
    const task = await this.getContextTask(project);
    if (!task) {
      throw new Error(
        `No Context task found for project "${project}". Run rtm_setup_project first.`
      );
    }

    const todayPrefix = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const title = `Session handoff — ${todayPrefix}`;

    // Look for an existing note from today to update rather than pile up notes
    const todayNote = task.notes.find((n) => n.title.startsWith(title));
    if (todayNote) {
      await this.client.editNote(todayNote.id, title, content);
    } else {
      await this.client.addNote(
        task.listId,
        task.taskseriesId,
        task.id,
        title,
        content
      );
    }
  }

  /**
   * Get open TODO tasks for a project.
   */
  async getTodos(project: string): Promise<RtmTask[]> {
    const lists = await this.getProjectLists(project);
    if (!lists.TODO) return [];
    return this.client.getTasks(lists.TODO.id);
  }

  /**
   * Get open Backlog tasks for a project.
   */
  async getBacklog(project: string): Promise<RtmTask[]> {
    const lists = await this.getProjectLists(project);
    if (!lists.Backlog) return [];
    return this.client.getTasks(lists.Backlog.id);
  }

  /**
   * Get open Bugs for a project.
   */
  async getBugs(project: string): Promise<RtmTask[]> {
    const lists = await this.getProjectLists(project);
    if (!lists.Bugs) return [];
    return this.client.getTasks(lists.Bugs.id);
  }

  /**
   * Get Decisions for a project.
   */
  async getDecisions(project: string): Promise<RtmTask[]> {
    const lists = await this.getProjectLists(project);
    if (!lists.Decisions) return [];
    return this.client.getTasks(lists.Decisions.id);
  }

  /**
   * Get Learnings for a project.
   */
  async getLearnings(project: string): Promise<RtmTask[]> {
    const lists = await this.getProjectLists(project);
    if (!lists.Learnings) return [];
    return this.client.getTasks(lists.Learnings.id);
  }

  /**
   * Add a learning to the Learnings list.
   * Learnings are persistent reference items — they should never be completed.
   */
  async addLearning(
    project: string,
    learning: string,
    context?: string
  ): Promise<RtmTask> {
    const lists = await this.getProjectLists(project);
    if (!lists.Learnings) {
      throw new Error(`No Learnings list found for "${project}". Run rtm_setup_project first.`);
    }
    const task = await this.client.addTask(lists.Learnings.id, learning);
    if (context) {
      await this.client.addNote(
        task.listId,
        task.taskseriesId,
        task.id,
        "Context",
        context
      );
    }
    return task;
  }

  /**
   * Add a task to a project's TODO list.
   */
  async addTodo(
    project: string,
    name: string,
    priority?: "1" | "2" | "3"
  ): Promise<RtmTask> {
    const lists = await this.getProjectLists(project);
    if (!lists.TODO) {
      throw new Error(`No TODO list found for "${project}". Run rtm_setup_project first.`);
    }
    const task = await this.client.addTask(lists.TODO.id, name);
    if (priority) {
      await this.client.setPriority(task.listId, task.taskseriesId, task.id, priority);
      task.priority = priority;
    }
    return task;
  }

  /**
   * Add a task to a project's Backlog.
   */
  async addBacklogItem(project: string, name: string): Promise<RtmTask> {
    const lists = await this.getProjectLists(project);
    if (!lists.Backlog) {
      throw new Error(`No Backlog list found for "${project}". Run rtm_setup_project first.`);
    }
    return this.client.addTask(lists.Backlog.id, name);
  }

  /**
   * Log an architectural decision to the Decisions list.
   * The rationale goes into a note on the task.
   */
  async logDecision(
    project: string,
    decision: string,
    rationale: string
  ): Promise<RtmTask> {
    const lists = await this.getProjectLists(project);
    if (!lists.Decisions) {
      throw new Error(`No Decisions list found for "${project}". Run rtm_setup_project first.`);
    }
    const task = await this.client.addTask(lists.Decisions.id, decision);
    await this.client.addNote(
      task.listId,
      task.taskseriesId,
      task.id,
      "Rationale",
      rationale
    );
    return task;
  }

  /**
   * Add a bug to the Bugs list with repro steps in a note.
   */
  async addBug(
    project: string,
    title: string,
    reproSteps: string,
    severity?: "1" | "2" | "3"
  ): Promise<RtmTask> {
    const lists = await this.getProjectLists(project);
    if (!lists.Bugs) {
      throw new Error(`No Bugs list found for "${project}". Run rtm_setup_project first.`);
    }
    const task = await this.client.addTask(lists.Bugs.id, title);
    await this.client.addNote(
      task.listId,
      task.taskseriesId,
      task.id,
      "Repro Steps",
      reproSteps
    );
    if (severity) {
      await this.client.setPriority(task.listId, task.taskseriesId, task.id, severity);
    }
    return task;
  }

  /**
   * Move a task from Backlog to TODO (promote it to active work).
   */
  async promoteToTodo(
    project: string,
    taskseriesId: string,
    taskId: string
  ): Promise<void> {
    const lists = await this.getProjectLists(project);
    if (!lists.Backlog) {
      throw new Error(`No Backlog list found for "${project}". Run rtm_setup_project first.`);
    }
    if (!lists.TODO) {
      throw new Error(`No TODO list found for "${project}". Run rtm_setup_project first.`);
    }
    await this.client.moveTask(lists.Backlog.id, lists.TODO.id, taskseriesId, taskId);
  }

  /**
   * Declare a blocker in the Bugs list.
   * Auto-applies: s:blocked tag, priority 1, extracts @assignee if present.
   */
  async addBlocker(
    project: string,
    description: string,
    context?: string
  ): Promise<{ task: RtmTask; assignee?: string }> {
    const lists = await this.getProjectLists(project);
    if (!lists.Bugs) {
      throw new Error(`No Bugs list found for "${project}". Run rtm_setup_project first.`);
    }

    // Extract @assignee from description if present
    const assigneeMatch = description.match(/@(\w+)/);
    const assignee = assigneeMatch ? assigneeMatch[1] : undefined;

    // Create the task (Smart Add will parse any inline syntax)
    const task = await this.client.addTask(lists.Bugs.id, description);

    // Apply blocker tags and priority
    const tags = ["s:blocked"];
    if (assignee) tags.push(`@${assignee}`);
    await this.client.addTags(task.listId, task.taskseriesId, task.id, tags);
    await this.client.setPriority(task.listId, task.taskseriesId, task.id, "1");

    // Add context note if provided
    if (context) {
      await this.client.addNote(
        task.listId,
        task.taskseriesId,
        task.id,
        "Blocker Context",
        context
      );
    }

    task.priority = "1";
    task.tags = [...task.tags, ...tags];

    return { task, assignee };
  }

  /**
   * Ship a feature — fuzzy-match tasks by name, complete them, log to changelog.
   * Returns the matched tasks that were completed.
   */
  async ship(
    project: string,
    query: string
  ): Promise<{ completed: RtmTask[]; changelog: string }> {
    // Get all open tasks across TODO, Backlog, Bugs
    const lists = await this.getProjectLists(project);
    const allTasks: RtmTask[] = [];

    if (lists.TODO) {
      allTasks.push(...(await this.client.getTasks(lists.TODO.id)));
    }
    if (lists.Backlog) {
      allTasks.push(...(await this.client.getTasks(lists.Backlog.id)));
    }
    if (lists.Bugs) {
      allTasks.push(...(await this.client.getTasks(lists.Bugs.id)));
    }

    // Fuzzy match: case-insensitive substring match
    const queryLower = query.toLowerCase();
    const matched = allTasks.filter((t) =>
      t.name.toLowerCase().includes(queryLower)
    );

    // Complete all matched tasks
    const completed: RtmTask[] = [];
    for (const task of matched) {
      await this.client.completeTask(task.listId, task.taskseriesId, task.id);
      completed.push(task);
    }

    // Generate changelog entry
    const date = new Date().toISOString().slice(0, 10);
    const changelog = [
      `## Shipped: ${query}`,
      `Date: ${date}`,
      `Tasks completed: ${completed.length}`,
      "",
      ...completed.map((t) => `- ${t.name}`),
    ].join("\n");

    // Write changelog to Context
    if (lists.Context && completed.length > 0) {
      const contextTask = await this.getContextTask(project);
      if (contextTask) {
        await this.client.addNote(
          contextTask.listId,
          contextTask.taskseriesId,
          contextTask.id,
          `🚀 Shipped: ${query} — ${date}`,
          changelog
        );
      }
    }

    return { completed, changelog };
  }
}
