import { randomBytes } from "node:crypto";

const SESSION_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_SESSIONS = 20_000;
const sessions = new Map();
const metrics = new Map();
const COOKIE_NAME = "sonsisearch_browser_sid";

export function parseSessionCookie(header = "") {
  const match = String(header).match(/(?:^|;\s*)sonsisearch_browser_sid=([A-Za-z0-9_-]{32})/);
  return match?.[1] || "";
}

export function getOrCreateSession(id = "") {
  const now = Date.now();
  for (const [key, value] of sessions) {
    if (value.expiresAt <= now) { sessions.delete(key); metrics.delete(key); }
  }
  let session = sessions.get(id);
  if (!session || session.expiresAt <= now) {
    id = randomBytes(24).toString("base64url");
    session = { target: "", history: [], index: -1, expiresAt: now + SESSION_TTL_MS };
    sessions.set(id, session);
  } else {
    session.expiresAt = now + SESSION_TTL_MS;
    sessions.delete(id);
    sessions.set(id, session);
  }
  if (sessions.size > MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;
    sessions.delete(oldest); metrics.delete(oldest);
  }
  while (metrics.size > MAX_SESSIONS) metrics.delete(metrics.keys().next().value);
  return { id, session };
}

export function findSession(id) {
  const session = sessions.get(id);
  if (!session || session.expiresAt <= Date.now()) { sessions.delete(id); return null; }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return session;
}

export function validateTarget(value) {
  if (typeof value !== "string" || value.length > 8192) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

export function setTarget(session, value, action = "navigate") {
  const target = validateTarget(value);
  if (!target) return false;
  session.target = target;
  if (action === "replace" && session.index >= 0) session.history[session.index] = target;
  else if (action === "pop") {
    const found = session.history.lastIndexOf(target);
    if (found >= 0) session.index = found;
    else { session.history = [...session.history.slice(0, session.index + 1), target].slice(-100); session.index = session.history.length - 1; }
  } else if (session.history[session.index] !== target) {
    session.history = [...session.history.slice(0, session.index + 1), target].slice(-100);
    session.index = session.history.length - 1;
  }
  return true;
}

export function moveHistory(session, direction) {
  const next = session.index + (direction === "back" ? -1 : 1);
  if (next < 0 || next >= session.history.length) return null;
  session.index = next;
  session.target = session.history[next];
  return session.target;
}

function metricFor(id) {
  let metric = metrics.get(id);
  if (!metric) {
    metric = { startedAt: 0, receivedBytes: 0, activeStreams: 0, chunks: [], lastDataAt: 0, error: false };
    metrics.set(id, metric);
  }
  return metric;
}

export function startTransfer(id) {
  if (!id || !findSession(id)) return;
  const metric = metricFor(id);
  if (metric.activeStreams++ === 0) {
    metric.startedAt = Date.now(); metric.receivedBytes = 0; metric.chunks = []; metric.error = false;
  }
}
export function recordIngress(id, bytes) {
  if (!id || !bytes) return;
  const metric = metricFor(id); const now = Date.now();
  metric.receivedBytes += bytes; metric.lastDataAt = now; metric.chunks.push({ at: now, bytes });
  while (metric.chunks.length && metric.chunks[0].at < now - 2000) metric.chunks.shift();
}
export function endTransfer(id, errored = false) {
  const metric = id && metrics.get(id);
  if (!metric) return;
  metric.error ||= errored;
  metric.activeStreams = Math.max(0, metric.activeStreams - 1);
  metric.endedAt = Date.now();
}
export function getSpeedSnapshot(id) {
  const metric = id && metrics.get(id);
  if (!metric) return { status: "idle", currentBytesPerSecond: 0, averageBytesPerSecond: 0, receivedBytes: 0, elapsedMs: 0, activeStreams: 0 };
  const now = Date.now();
  while (metric.chunks.length && metric.chunks[0].at < now - 2000) metric.chunks.shift();
  const windowMs = metric.chunks.length ? Math.max(250, Math.min(2000, now - metric.chunks[0].at)) : 0;
  const recentBytes = metric.chunks.reduce((sum, chunk) => sum + chunk.bytes, 0);
  const elapsedMs = metric.startedAt ? (metric.activeStreams ? now : metric.endedAt || now) - metric.startedAt : 0;
  const recentlyEnded = metric.endedAt && now - metric.endedAt <= 8000;
  const status = metric.activeStreams ? (metric.receivedBytes ? "streaming" : "connecting") : metric.error ? "error" : recentlyEnded && metric.receivedBytes ? "completed" : "idle";
  return {
    status,
    currentBytesPerSecond: windowMs ? recentBytes * 1000 / windowMs : 0,
    averageBytesPerSecond: elapsedMs ? metric.receivedBytes * 1000 / elapsedMs : 0,
    receivedBytes: metric.receivedBytes,
    elapsedMs,
    activeStreams: metric.activeStreams,
  };
}

export function browserCookie(id, secure) {
  return `${COOKIE_NAME}=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${secure ? "; Secure" : ""}`;
}

