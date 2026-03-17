/**
 * RTM API Client
 *
 * Handles authentication token loading, HMAC-MD5 request signing,
 * timeline management, and all raw API calls to api.rememberthemilk.com.
 *
 * RTM's signing scheme:
 *   1. Sort all params (including api_key + auth_token) alphabetically by key
 *   2. Concatenate shared_secret + key1value1key2value2...
 *   3. MD5 hash that string → api_sig
 */

import { createHash } from "crypto";
import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const RTM_API_BASE = "https://api.rememberthemilk.com/services/rest/";
const RTM_AUTH_URL = "https://www.rememberthemilk.com/services/auth/";

export interface RtmConfig {
  apiKey: string;
  sharedSecret: string;
  authToken: string;
}

export interface RtmTask {
  id: string;
  taskseriesId: string;
  listId: string;
  name: string;
  priority: string;
  due: string;
  completed: string;
  deleted: string;
  tags: string[];
  notes: RtmNote[];
  url: string;
  estimate: string;
}

export interface RtmNote {
  id: string;
  title: string;
  body: string;
  created: string;
  modified: string;
}

export interface RtmList {
  id: string;
  name: string;
  archived: string;
  deleted: string;
  smart: string;
}

/**
 * Load RTM credentials from environment variables or config file.
 * Priority: env vars > ~/.config/milk-mcp/config
 */
export function loadConfig(): RtmConfig {
  const apiKey = process.env.RTM_API_KEY;
  const sharedSecret = process.env.RTM_SHARED_SECRET;
  const authToken = process.env.RTM_AUTH_TOKEN;

  if (apiKey && sharedSecret && authToken) {
    return { apiKey, sharedSecret, authToken };
  }

  const configPath = join(homedir(), ".config", "milk-mcp", "config");
  if (!existsSync(configPath)) {
    throw new Error(
      `No RTM credentials found. Set RTM_API_KEY, RTM_SHARED_SECRET, RTM_AUTH_TOKEN env vars, ` +
        `or run: npm run auth\n` +
        `Config file location: ${configPath}`
    );
  }

  const raw = readFileSync(configPath, "utf-8");
  const parsed: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [key, ...rest] = trimmed.split("=");
    parsed[key.trim()] = rest.join("=").trim();
  }

  const cfg: RtmConfig = {
    apiKey: parsed["RTM_API_KEY"] ?? "",
    sharedSecret: parsed["RTM_SHARED_SECRET"] ?? "",
    authToken: parsed["RTM_AUTH_TOKEN"] ?? "",
  };

  if (!cfg.apiKey || !cfg.sharedSecret || !cfg.authToken) {
    throw new Error(
      `Config file at ${configPath} is missing required fields. ` +
        `Run: npm run auth`
    );
  }

  return cfg;
}

/**
 * Generate RTM API signature (HMAC-MD5 style but plain MD5).
 * Sort params by key, concat as sharedSecret + key1val1key2val2..., MD5 hash.
 */
export function signParams(
  params: Record<string, string>,
  sharedSecret: string
): string {
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}${params[k]}`)
    .join("");
  return createHash("md5")
    .update(sharedSecret + sorted)
    .digest("hex");
}

export class RtmClient {
  private config: RtmConfig;
  private timeline: string | null = null;

  constructor(config: RtmConfig) {
    this.config = config;
  }

  /**
   * Make a signed GET request to the RTM API.
   * Returns the parsed rsp object or throws on API error.
   */
  async call(
    method: string,
    params: Record<string, string> = {}
  ): Promise<Record<string, unknown>> {
    const allParams: Record<string, string> = {
      method,
      api_key: this.config.apiKey,
      auth_token: this.config.authToken,
      format: "json",
      v: "2",
      ...params,
    };

    allParams["api_sig"] = signParams(allParams, this.config.sharedSecret);

    const url =
      RTM_API_BASE +
      "?" +
      new URLSearchParams(allParams as Record<string, string>).toString();

    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} from RTM API`);
    }

    const data = (await resp.json()) as Record<string, unknown>;
    const rsp = data["rsp"] as Record<string, unknown>;

    if (rsp["stat"] !== "ok") {
      const err = rsp["err"] as Record<string, string>;
      throw new Error(`RTM API error ${err["code"]}: ${err["msg"]}`);
    }

    return rsp;
  }

  /**
   * Get (or reuse cached) a timeline for write operations.
   * RTM requires a timeline for any mutating call.
   */
  async getTimeline(): Promise<string> {
    if (this.timeline) return this.timeline;
    const rsp = await this.call("rtm.timelines.create");
    this.timeline = rsp["timeline"] as string;
    return this.timeline;
  }

  /**
   * Fetch all lists (non-archived, non-deleted).
   */
  async getLists(): Promise<RtmList[]> {
    const rsp = await this.call("rtm.lists.getList");
    const lists = rsp["lists"] as { list: RtmList | RtmList[] };
    const arr = Array.isArray(lists.list) ? lists.list : [lists.list];
    return arr.filter((l) => l.deleted !== "1" && l.archived !== "1");
  }

  /**
   * Create a new list with the given name.
   */
  async createList(name: string): Promise<RtmList> {
    const timeline = await this.getTimeline();
    const rsp = await this.call("rtm.lists.add", { timeline, name });
    return (rsp["list"] as RtmList);
  }

  /**
   * Fetch tasks from a list (optionally filtered).
   * Returns a flat array of RtmTask objects.
   */
  async getTasks(listId: string, filter?: string): Promise<RtmTask[]> {
    const params: Record<string, string> = { list_id: listId };
    if (filter) params["filter"] = filter;

    const rsp = await this.call("rtm.tasks.getList", params);
    const tasksData = rsp["tasks"] as { list?: unknown } | undefined;
    if (!tasksData || !tasksData.list) return [];

    const lists = Array.isArray(tasksData.list)
      ? tasksData.list
      : [tasksData.list];

    const tasks: RtmTask[] = [];
    for (const list of lists as Record<string, unknown>[]) {
      const series = list["taskseries"];
      if (!series) continue;
      const seriesArr = Array.isArray(series) ? series : [series];
      for (const s of seriesArr as Record<string, unknown>[]) {
        const taskData = s["task"];
        const taskArr = Array.isArray(taskData) ? taskData : [taskData];
        const latestTask = taskArr[taskArr.length - 1] as Record<
          string,
          string
        >;

        // Skip completed/deleted tasks
        if (latestTask["completed"] || latestTask["deleted"]) continue;

        const tagsData = s["tags"] as { tag?: string | string[] } | "";
        const tags =
          tagsData && typeof tagsData === "object" && tagsData.tag
            ? Array.isArray(tagsData.tag)
              ? tagsData.tag
              : [tagsData.tag]
            : [];

        const notesData = s["notes"] as { note?: unknown } | "";
        let notes: RtmNote[] = [];
        if (notesData && typeof notesData === "object" && notesData.note) {
          const noteArr = Array.isArray(notesData.note)
            ? notesData.note
            : [notesData.note];
          notes = noteArr.map((n) => {
            const note = n as Record<string, string>;
            return {
              id: note["id"],
              title: note["title"] ?? "",
              body: note["$t"] ?? "",
              created: note["created"],
              modified: note["modified"],
            };
          });
        }

        tasks.push({
          id: latestTask["id"],
          taskseriesId: s["id"] as string,
          listId: list["id"] as string,
          name: s["name"] as string,
          priority: latestTask["priority"] ?? "N",
          due: latestTask["due"] ?? "",
          completed: latestTask["completed"] ?? "",
          deleted: latestTask["deleted"] ?? "",
          tags,
          notes,
          url: (s["url"] as string) ?? "",
          estimate: latestTask["estimate"] ?? "",
        });
      }
    }

    return tasks;
  }

  /**
   * Add a task to a list. Supports RTM Smart Add syntax.
   */
  async addTask(
    listId: string,
    name: string,
    parse = false
  ): Promise<RtmTask> {
    const timeline = await this.getTimeline();
    const rsp = await this.call("rtm.tasks.add", {
      timeline,
      list_id: listId,
      name,
      parse: parse ? "1" : "0",
    });

    const list = rsp["list"] as Record<string, unknown>;
    const seriesData = list["taskseries"];
    const series = (Array.isArray(seriesData) ? seriesData[0] : seriesData) as Record<string, unknown>;
    const taskData = series["task"];
    const task = (Array.isArray(taskData) ? taskData[0] : taskData) as Record<string, string>;

    return {
      id: task["id"],
      taskseriesId: series["id"] as string,
      listId: list["id"] as string,
      name: series["name"] as string,
      priority: task["priority"] ?? "N",
      due: task["due"] ?? "",
      completed: "",
      deleted: "",
      tags: [],
      notes: [],
      url: "",
      estimate: "",
    };
  }

  /**
   * Complete a task.
   */
  async completeTask(
    listId: string,
    taskseriesId: string,
    taskId: string
  ): Promise<void> {
    const timeline = await this.getTimeline();
    await this.call("rtm.tasks.complete", {
      timeline,
      list_id: listId,
      taskseries_id: taskseriesId,
      task_id: taskId,
    });
  }

  /**
   * Add a note to a task.
   */
  async addNote(
    listId: string,
    taskseriesId: string,
    taskId: string,
    title: string,
    body: string
  ): Promise<RtmNote> {
    const timeline = await this.getTimeline();
    const rsp = await this.call("rtm.tasks.notes.add", {
      timeline,
      list_id: listId,
      taskseries_id: taskseriesId,
      task_id: taskId,
      note_title: title,
      note_text: body,
    });

    const note = rsp["note"] as Record<string, string>;
    return {
      id: note["id"],
      title: note["title"] ?? "",
      body: note["$t"] ?? "",
      created: note["created"],
      modified: note["modified"],
    };
  }

  /**
   * Edit an existing note.
   */
  async editNote(
    noteId: string,
    title: string,
    body: string
  ): Promise<void> {
    const timeline = await this.getTimeline();
    await this.call("rtm.tasks.notes.edit", {
      timeline,
      note_id: noteId,
      note_title: title,
      note_text: body,
    });
  }

  /**
   * Add tags to a task.
   */
  async addTags(
    listId: string,
    taskseriesId: string,
    taskId: string,
    tags: string[]
  ): Promise<void> {
    const timeline = await this.getTimeline();
    await this.call("rtm.tasks.addTags", {
      timeline,
      list_id: listId,
      taskseries_id: taskseriesId,
      task_id: taskId,
      tags: tags.join(","),
    });
  }

  /**
   * Set priority on a task. priority: "1" (high), "2" (med), "3" (low), "N" (none)
   */
  async setPriority(
    listId: string,
    taskseriesId: string,
    taskId: string,
    priority: "1" | "2" | "3" | "N"
  ): Promise<void> {
    const timeline = await this.getTimeline();
    await this.call("rtm.tasks.setPriority", {
      timeline,
      list_id: listId,
      taskseries_id: taskseriesId,
      task_id: taskId,
      priority,
    });
  }

  /**
   * Move a task to a different list.
   */
  async moveTask(
    fromListId: string,
    toListId: string,
    taskseriesId: string,
    taskId: string
  ): Promise<void> {
    const timeline = await this.getTimeline();
    await this.call("rtm.tasks.moveTo", {
      timeline,
      from_list_id: fromListId,
      to_list_id: toListId,
      taskseries_id: taskseriesId,
      task_id: taskId,
    });
  }

  /**
   * Set due date on a task. Use empty string to clear.
   * Format: ISO date (YYYY-MM-DD) or natural language ("tomorrow", "next week")
   */
  async setDueDate(
    listId: string,
    taskseriesId: string,
    taskId: string,
    due: string
  ): Promise<void> {
    const timeline = await this.getTimeline();
    await this.call("rtm.tasks.setDueDate", {
      timeline,
      list_id: listId,
      taskseries_id: taskseriesId,
      task_id: taskId,
      due,
      parse: "1", // Allow natural language parsing
    });
  }

  /**
   * Rename a task.
   */
  async setName(
    listId: string,
    taskseriesId: string,
    taskId: string,
    name: string
  ): Promise<void> {
    const timeline = await this.getTimeline();
    await this.call("rtm.tasks.setName", {
      timeline,
      list_id: listId,
      taskseries_id: taskseriesId,
      task_id: taskId,
      name,
    });
  }

  // ─── Auth helpers (used by the auth setup script only) ───────────────────

  static getAuthUrl(apiKey: string, sharedSecret: string, frob: string): string {
    const params: Record<string, string> = {
      api_key: apiKey,
      frob,
      perms: "delete",
    };
    params["api_sig"] = signParams(params, sharedSecret);
    return RTM_AUTH_URL + "?" + new URLSearchParams(params).toString();
  }

  static async getFrob(apiKey: string, sharedSecret: string): Promise<string> {
    const params: Record<string, string> = {
      method: "rtm.auth.getFrob",
      api_key: apiKey,
      format: "json",
    };
    params["api_sig"] = signParams(params, sharedSecret);
    const url = RTM_API_BASE + "?" + new URLSearchParams(params).toString();
    const resp = await fetch(url);
    const data = (await resp.json()) as Record<string, unknown>;
    const rsp = data["rsp"] as Record<string, unknown>;
    if (rsp["stat"] !== "ok") {
      const err = rsp["err"] as Record<string, string>;
      throw new Error(`RTM error: ${err["msg"]}`);
    }
    return rsp["frob"] as string;
  }

  static async getToken(
    apiKey: string,
    sharedSecret: string,
    frob: string
  ): Promise<string> {
    const params: Record<string, string> = {
      method: "rtm.auth.getToken",
      api_key: apiKey,
      format: "json",
      frob,
    };
    params["api_sig"] = signParams(params, sharedSecret);
    const url = RTM_API_BASE + "?" + new URLSearchParams(params).toString();
    const resp = await fetch(url);
    const data = (await resp.json()) as Record<string, unknown>;
    const rsp = data["rsp"] as Record<string, unknown>;
    if (rsp["stat"] !== "ok") {
      const err = rsp["err"] as Record<string, string>;
      throw new Error(`RTM error: ${err["msg"]}`);
    }
    const auth = rsp["auth"] as Record<string, unknown>;
    return auth["token"] as string;
  }
}
