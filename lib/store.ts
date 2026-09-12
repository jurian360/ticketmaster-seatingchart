import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { buildArenaLayout, buildTheatreLayout } from "./sample";
import { DEFAULT_RULES } from "./rules";
import type { VenueLayout } from "./types";

const withDefaults = (l: VenueLayout): VenueLayout => ({
  ...l,
  rules: { ...DEFAULT_RULES, ...l.rules },
});

function freshLayouts(): VenueLayout[] {
  return [buildArenaLayout(), buildTheatreLayout()].map((l) => ({
    ...l,
    updatedAt: new Date().toISOString(),
  }));
}

/**
 * A backend only has to move whole layouts in and out. Nothing else in the app
 * knows which one is in use, so swapping in Postgres is a change to this file
 * alone.
 */
interface Backend {
  /** Surfaced in the admin dashboard, so it is obvious whether edits survive. */
  readonly label: string;
  readonly durable: boolean;
  loadAll(): Promise<VenueLayout[] | null>;
  load(id: string): Promise<VenueLayout | null>;
  save(layout: VenueLayout): Promise<void>;
  remove(id: string): Promise<void>;
  replaceAll(layouts: VenueLayout[]): Promise<void>;
}

/* ------------------------------------------------------------------ *
 * Redis over REST — Vercel's Redis/KV integrations and plain Upstash
 * ------------------------------------------------------------------ */

const LAYOUT_KEY = (id: string) => `seatmap:layout:${encodeURIComponent(id)}`;
const INDEX_KEY = "seatmap:index";

function redisBackend(url: string, token: string): Backend {
  const call = async (command: string, body?: string) => {
    const res = await fetch(`${url}/${command}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${token}` },
      body,
      // Next patches fetch, and a cached read would serve a stale inventory.
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`Redis ${command.split("/")[0]} failed: ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as { result: unknown };
  };

  const get = async (key: string) => ((await call(`get/${key}`)).result as string | null) ?? null;
  const set = async (key: string, value: string) => {
    await call(`set/${key}`, value);
  };
  const del = async (key: string) => {
    await call(`del/${key}`);
  };

  const readIndex = async (): Promise<string[]> => {
    const raw = await get(INDEX_KEY);
    const ids = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(ids) ? (ids as string[]) : [];
  };

  const load = async (id: string) => {
    const raw = await get(LAYOUT_KEY(id));
    return raw ? (JSON.parse(raw) as VenueLayout) : null;
  };

  return {
    label: "Redis (durable)",
    durable: true,
    load,
    async loadAll() {
      const ids = await readIndex();
      if (!ids.length) return null;
      const found = (await Promise.all(ids.map(load))).filter((l): l is VenueLayout => l !== null);
      return found.length ? found : null;
    },
    async save(layout) {
      // One key per layout keeps each request small — the arena alone is ~320KB.
      await set(LAYOUT_KEY(layout.id), JSON.stringify(layout));
      const ids = await readIndex();
      if (!ids.includes(layout.id)) await set(INDEX_KEY, JSON.stringify([...ids, layout.id]));
    },
    async remove(id) {
      await del(LAYOUT_KEY(id));
      const ids = await readIndex();
      await set(INDEX_KEY, JSON.stringify(ids.filter((x) => x !== id)));
    },
    async replaceAll(layouts) {
      const keep = layouts.map((l) => l.id);
      const stale = (await readIndex()).filter((id) => !keep.includes(id));
      await Promise.all(stale.map((id) => del(LAYOUT_KEY(id))));
      await Promise.all(layouts.map((l) => set(LAYOUT_KEY(l.id), JSON.stringify(l))));
      await set(INDEX_KEY, JSON.stringify(keep));
    },
  };
}

/* ------------------------------------------------------------------ *
 * JSON file, with an in-memory last resort
 * ------------------------------------------------------------------ */

/**
 * Locally this is a dot-prefixed folder in the project (dot-prefixed so the dev
 * server's file watcher ignores our writes). On a serverless host the bundle is
 * read-only and only the temp directory can be written — and that is private to
 * one instance and wiped on a cold start, hence `durable: false`.
 */
function dataDir() {
  const override = process.env.SEATMAP_DATA_DIR;
  if (override) return override;
  const serverless = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME;
  return path.join(serverless ? os.tmpdir() : process.cwd(), ".seatmap-data");
}

function fileBackend(): Backend {
  let memory: VenueLayout[] | null = null;
  let writable = true;
  const ephemeral = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

  const read = async (): Promise<VenueLayout[] | null> => {
    if (!writable) return memory;
    try {
      const raw = await fs.readFile(path.join(dataDir(), "layouts.json"), "utf8");
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? (parsed as VenueLayout[]) : null;
    } catch {
      return null;
    }
  };

  const write = async (layouts: VenueLayout[]) => {
    memory = layouts;
    if (!writable) return;
    try {
      const dir = dataDir();
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "layouts.json"), JSON.stringify(layouts, null, 2), "utf8");
    } catch (err) {
      writable = false;
      console.warn(
        `[seatmap] ${dataDir()} is not writable (${
          (err as NodeJS.ErrnoException).code ?? "unknown"
        }); keeping the demo inventory in memory for this instance only.`,
      );
    }
  };

  return {
    label: ephemeral ? "Temporary storage — edits will not survive" : "Local JSON file",
    durable: !ephemeral,
    async loadAll() {
      const all = await read();
      return all?.length ? all : null;
    },
    async load(id) {
      return (await read())?.find((l) => l.id === id) ?? null;
    },
    async save(layout) {
      const all = (await read()) ?? [];
      const i = all.findIndex((l) => l.id === layout.id);
      if (i === -1) all.push(layout);
      else all[i] = layout;
      await write(all);
    },
    async remove(id) {
      await write(((await read()) ?? []).filter((l) => l.id !== id));
    },
    async replaceAll(layouts) {
      await write(layouts);
    },
  };
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

let backendRef: Backend | null = null;

function backend(): Backend {
  if (backendRef) return backendRef;
  // Vercel's Redis/KV integrations and a plain Upstash database speak the same
  // REST protocol under different variable names.
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  backendRef = url && token ? redisBackend(url.replace(/\/+$/, ""), token) : fileBackend();
  return backendRef;
}

/** How the inventory is stored right now, for the admin dashboard to show. */
export function storageStatus() {
  const { label, durable } = backend();
  return { label, durable };
}

async function seed(): Promise<VenueLayout[]> {
  const layouts = freshLayouts();
  await backend().replaceAll(layouts);
  return layouts;
}

export async function listLayouts(): Promise<VenueLayout[]> {
  const all = await backend().loadAll();
  if (!all?.length) return seed();
  return all.map(withDefaults);
}

export async function getLayout(id: string): Promise<VenueLayout | null> {
  const one = await backend().load(id);
  if (one) return withDefaults(one);
  // Nothing stored yet: seeding settles whether this id is one of ours.
  return (await listLayouts()).find((l) => l.id === id) ?? null;
}

export async function saveLayout(layout: VenueLayout): Promise<VenueLayout> {
  const next = { ...layout, updatedAt: new Date().toISOString() };
  await backend().save(next);
  return next;
}

export async function deleteLayout(id: string): Promise<void> {
  await backend().remove(id);
}

export async function resetLayouts(): Promise<VenueLayout[]> {
  return seed();
}

export function emptyLayout(id: string, name: string): VenueLayout {
  return {
    id,
    name,
    eventName: "Untitled event",
    eventDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
    updatedAt: new Date().toISOString(),
    stage: { x: 0, y: -220, width: 360, height: 100, rotation: 0, label: "STAGE" },
    sections: [],
    rules: { ...DEFAULT_RULES },
  };
}
