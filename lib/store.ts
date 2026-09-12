import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { buildArenaLayout, buildTheatreLayout } from "./sample";
import { DEFAULT_RULES } from "./rules";
import type { VenueLayout } from "./types";

/**
 * Where the demo inventory lives.
 *
 * Locally that is a dot-prefixed folder in the project (dot-prefixed so the dev
 * server's file watcher ignores our writes). On a serverless host the bundle is
 * read-only and only the temp directory can be written, so we go there instead
 * — see `MEMORY_ONLY` below for what happens when even that fails.
 */
function dataDir() {
  const override = process.env.SEATMAP_DATA_DIR;
  if (override) return override;
  const serverless = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME;
  return path.join(serverless ? os.tmpdir() : process.cwd(), ".seatmap-data");
}

const DATA_FILE = () => path.join(dataDir(), "layouts.json");

/**
 * Last-resort copy of the inventory, used when nothing on disk is writable.
 * It lives as long as the server instance does, which is enough to keep the
 * demo working, but it is not shared between instances — see the README.
 */
let memory: VenueLayout[] | null = null;
let diskWritable = true;

function freshLayouts(): VenueLayout[] {
  return [buildArenaLayout(), buildTheatreLayout()].map((l) => ({
    ...l,
    updatedAt: new Date().toISOString(),
  }));
}

async function seed(): Promise<VenueLayout[]> {
  const layouts = freshLayouts();
  await writeAll(layouts);
  return layouts;
}

async function writeAll(layouts: VenueLayout[]) {
  memory = layouts;
  if (!diskWritable) return;
  try {
    const dir = dataDir();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "layouts.json"), JSON.stringify(layouts, null, 2), "utf8");
  } catch (err) {
    diskWritable = false;
    console.warn(
      `[seatmap] ${dataDir()} is not writable (${
        (err as NodeJS.ErrnoException).code ?? "unknown"
      }); keeping the demo inventory in memory for this instance only.`,
    );
  }
}

const withDefaults = (l: VenueLayout) => ({ ...l, rules: { ...DEFAULT_RULES, ...l.rules } });

export async function listLayouts(): Promise<VenueLayout[]> {
  if (!diskWritable) {
    if (!memory) memory = freshLayouts();
    return memory.map(withDefaults);
  }
  try {
    const raw = await fs.readFile(DATA_FILE(), "utf8");
    const parsed = JSON.parse(raw) as VenueLayout[];
    if (!Array.isArray(parsed) || parsed.length === 0) return seed();
    return parsed.map(withDefaults);
  } catch {
    return seed();
  }
}

export async function getLayout(id: string): Promise<VenueLayout | null> {
  const all = await listLayouts();
  return all.find((l) => l.id === id) ?? null;
}

export async function saveLayout(layout: VenueLayout): Promise<VenueLayout> {
  const all = await listLayouts();
  const next = { ...layout, updatedAt: new Date().toISOString() };
  const i = all.findIndex((l) => l.id === layout.id);
  if (i === -1) all.push(next);
  else all[i] = next;
  await writeAll(all);
  return next;
}

export async function deleteLayout(id: string): Promise<void> {
  const all = await listLayouts();
  await writeAll(all.filter((l) => l.id !== id));
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
