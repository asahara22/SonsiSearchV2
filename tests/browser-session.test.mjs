import test from "node:test";
import assert from "node:assert/strict";
import {
  browserCookie, endTransfer, findSession, getOrCreateSession, getSpeedSnapshot,
  moveHistory, parseSessionCookie, recordIngress, setTarget, startTransfer,
} from "../proxy/upstream/browser-session.js";

test("browser target history is stored against an opaque session id", () => {
  const { id, session } = getOrCreateSession();
  assert.equal(id.length, 32);
  assert.equal(setTarget(session, "https://example.com/one"), true);
  assert.equal(setTarget(session, "https://example.com/two"), true);
  assert.equal(moveHistory(session, "back"), "https://example.com/one");
  assert.equal(moveHistory(session, "forward"), "https://example.com/two");
  assert.equal(setTarget(session, "http://user:pass@example.com"), false);
  assert.equal(setTarget(session, "javascript:alert(1)"), false);
  assert.equal(findSession(id), session);
});

test("session cookie contains only opaque identifier and is HttpOnly", () => {
  const { id } = getOrCreateSession();
  const cookie = browserCookie(id, true);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, new RegExp(`sonsisearch_browser_sid=${id}`));
  assert.equal(parseSessionCookie(cookie), id);
  assert.equal(cookie.includes("example.com"), false);
});

test("speed snapshot counts ingress chunks without buffering and tracks completion", () => {
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
    const { id } = getOrCreateSession();
    startTransfer(id);
    now += 1000;
    recordIngress(id, 1024);
    let speed = getSpeedSnapshot(id);
    assert.equal(speed.status, "streaming");
    assert.equal(speed.receivedBytes, 1024);
    assert.ok(speed.currentBytesPerSecond >= 1024);
    endTransfer(id);
    assert.equal(getSpeedSnapshot(id).status, "completed");
  } finally { Date.now = realNow; }
});
