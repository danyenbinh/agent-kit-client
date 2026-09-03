/**
 * PKE Phase 9.1 — metrics store (SQLite when available, JSON fallback).
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
import { manifestPath } from "./project-knowledge.mjs";
import { episodesPath } from "./episode-log.mjs";

const STORE_DIR = "store";
const JSON_EXPORT = "pke-metrics-export.json";

function storeDir(projectRoot) {
  return path.join(projectRoot, ".cursor", "project-knowledge", STORE_DIR);
}

function jsonBackendPath(projectRoot) {
  return path.join(storeDir(projectRoot), "metrics.json");
}

function sqlitePath(projectRoot) {
  return path.join(storeDir(projectRoot), "pke-metrics.db");
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function loadSqlite(dbPath) {
  try {
    // Node 22.5+ experimental — optional
    const mod = require("node:sqlite");
    const db = new mod.DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS manifest_snapshots (
        ts TEXT PRIMARY KEY,
        fresh INTEGER,
        csharp_files INTEGER,
        types INTEGER,
        payload TEXT
      );
      CREATE TABLE IF NOT EXISTS turn_metrics (
        ts TEXT PRIMARY KEY,
        task_type TEXT,
        pke_queries INTEGER,
        grep_count INTEGER,
        read_count INTEGER,
        total_tokens_est INTEGER,
        payload TEXT
      );
      CREATE TABLE IF NOT EXISTS episodes (
        ts TEXT PRIMARY KEY,
        task_type TEXT,
        skill_id TEXT,
        insight TEXT,
        payload TEXT
      );
    `);
    return db;
  } catch {
    return null;
  }
}

/** Collect metrics from existing PKE artifacts. */
export function collectMetricsSnapshot(projectRoot) {
  const bridgeRoot = path.join(projectRoot, ".cursor", "unity-bridge");
  const turns = readJsonl(path.join(bridgeRoot, "usage", "agent-turns.jsonl"));
  const episodes = readJsonl(episodesPath(projectRoot));
  const runtime = readJsonl(path.join(projectRoot, ".cursor", "project-knowledge", "runtime", "playmode-errors.jsonl"));

  let manifest = null;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath(projectRoot), "utf8"));
  } catch {
    /* optional */
  }

  return {
    exportedAt: new Date().toISOString(),
    manifest: manifest
      ? {
          fresh: manifest.fresh,
          lastSyncAt: manifest.lastSyncAt,
          csharpFiles: manifest.counts?.csharpFiles ?? 0,
          types: manifest.counts?.types ?? 0,
        }
      : null,
    turns: turns.slice(-200),
    episodes: episodes.slice(-100),
    playmodeErrors: runtime.slice(-100),
    counts: {
      turns: turns.length,
      episodes: episodes.length,
      playmodeErrors: runtime.length,
    },
  };
}

/** Sync snapshot to store backend + write JSON export. */
export function syncMetricsStore(projectRoot) {
  const snapshot = collectMetricsSnapshot(projectRoot);
  const dir = storeDir(projectRoot);
  fs.mkdirSync(dir, { recursive: true });

  const jsonBackend = {
    updatedAt: snapshot.exportedAt,
    backend: "json",
    ...snapshot,
  };
  fs.writeFileSync(jsonBackendPath(projectRoot), JSON.stringify(jsonBackend, null, 2) + "\n", "utf8");

  const db = loadSqlite(sqlitePath(projectRoot));
  if (db) {
    const insManifest = db.prepare(
      `INSERT OR REPLACE INTO manifest_snapshots (ts, fresh, csharp_files, types, payload) VALUES (?, ?, ?, ?, ?)`
    );
    if (snapshot.manifest) {
      insManifest.run(
        snapshot.exportedAt,
        snapshot.manifest.fresh ? 1 : 0,
        snapshot.manifest.csharpFiles ?? 0,
        snapshot.manifest.types ?? 0,
        JSON.stringify(snapshot.manifest)
      );
    }
    const insTurn = db.prepare(
      `INSERT OR REPLACE INTO turn_metrics (ts, task_type, pke_queries, grep_count, read_count, total_tokens_est, payload) VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const t of snapshot.turns) {
      insTurn.run(
        t.ts ?? snapshot.exportedAt,
        t.taskType ?? "other",
        t.pkeQueries ?? 0,
        t.grepCount ?? 0,
        t.readCount ?? 0,
        t.totalTokensEst ?? 0,
        JSON.stringify(t)
      );
    }
    const insEp = db.prepare(
      `INSERT OR REPLACE INTO episodes (ts, task_type, skill_id, insight, payload) VALUES (?, ?, ?, ?, ?)`
    );
    for (const e of snapshot.episodes) {
      insEp.run(
        e.ts ?? snapshot.exportedAt,
        e.taskType ?? "unknown",
        e.skillId ?? null,
        e.insight ?? "",
        JSON.stringify(e)
      );
    }
    jsonBackend.backend = "sqlite+json";
    db.close();
  }

  const exportPath = path.join(dir, JSON_EXPORT);
  fs.writeFileSync(exportPath, JSON.stringify(jsonBackend, null, 2) + "\n", "utf8");
  return { ok: true, exportPath, backend: jsonBackend.backend, counts: snapshot.counts };
}

export function exportMetricsPath(projectRoot) {
  return path.join(storeDir(projectRoot), JSON_EXPORT);
}
