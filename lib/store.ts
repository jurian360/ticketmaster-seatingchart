import { promises as fs } from "fs";
import path from "path";
import { buildArenaLayout, buildTheatreLayout } from "./sample";
import { DEFAULT_RULES } from "./rules";
import type { VenueLayout } from "./types";

// Dot-prefixed so the dev server's file watcher ignores our writes.
const DATA_DIR = path.join(process.cwd(), ".seatmap-data");
const DATA_FILE = path.join(DATA_DIR, "layouts.json");

async function seed(): Promise<VenueLayout[]> {
  const layouts = [buildArenaLayout(), buildTheatreLayout()].map((l) => ({
    ...l,
    updatedAt: new Date().toISOString(),
  }));
  await writeAll(layouts);
  return layouts;
}

async function writeAll(layouts: VenueLayout[]) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(layouts, null, 2), "utf8");
}

export async function listLayouts(): Promise<VenueLayout[]> {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw) as VenueLayout[];
    if (!Array.isArray(parsed) || parsed.length === 0) return seed();
    return parsed.map((l) => ({ ...l, rules: { ...DEFAULT_RULES, ...l.rules } }));
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
