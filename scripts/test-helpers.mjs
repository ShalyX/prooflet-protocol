import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

export function tempDatabase(name) {
  const path = resolve(`data/${name}.sqlite`);
  cleanupDatabase(path);
  process.env.UWP_DB_PATH = path;
  return path;
}
export function cleanupDatabase(path) { for (const suffix of ["", "-shm", "-wal"]) if (existsSync(`${path}${suffix}`)) rmSync(`${path}${suffix}`); }
export async function startTestApi(name) {
  const path = tempDatabase(name);
  const { createApp } = await import(`../server/api.mjs?test=${name}-${Date.now()}`);
  const { app, db } = createApp();
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  return { path, db, server, baseUrl: `http://127.0.0.1:${server.address().port}`, async close() { await new Promise((resolve) => server.close(resolve)); db.close(); cleanupDatabase(path); } };
}
export async function api(baseUrl, method, route, body, apiKey) {
  const response = await fetch(`${baseUrl}${route}`, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json() };
}
