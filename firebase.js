// Replacement for the old Firebase module.
// The pages still import { db, ref, get, set } from "./firebase.js",
// but the data now lives in MongoDB and is read/written through the server API.

export const db = {};

export function ref(_db, path) {
  return { path };
}

export async function get(r) {
  const res = await fetch("/api/" + r.path);

  if (res.status === 404) {
    return { exists: () => false, val: () => null };
  }
  if (!res.ok) {
    throw new Error("Could not load data");
  }

  const data = await res.json();
  const has = data !== null && !(typeof data === "object" && Object.keys(data).length === 0);

  return { exists: () => has, val: () => data };
}

export async function set(r, value) {
  const res = await fetch("/api/" + r.path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value)
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Could not save data");
  }
}
