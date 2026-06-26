import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, createReadStream } from "node:fs";
import { extname, join, resolve } from "node:path";

const PORT = Number(process.env.PORT || 3000);
const ROOT = resolve(".");
const DATA_DIR = process.env.DATA_DIR || (existsSync("/data") ? "/data" : join(ROOT, "data"));
const DATA_FILE = process.env.DATA_FILE || join(DATA_DIR, "taitalk-state.json");
const MAX_BODY = 30 * 1024 * 1024;

const DEFAULT_FOLDERS = ["Main","Important","Advertising","Request","Group","Work","Study","Friends","Family"];

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

const clients = new Set();
let db = await loadDb();

function defaultState() {
  return {
    users: [
      { id: "@mali", username: "mali", displayName: "Mali", password: "1234", avatar: "", blocked: [] },
      { id: "@narin", username: "narin", displayName: "Narin", password: "1234", avatar: "", blocked: [] },
      { id: "@studyteam", username: "studyteam", displayName: "Study Team", password: "1234", avatar: "", blocked: [] },
    ],
    friendships: [],
    customFolders: [],
    appSettings: { fontSize: "normal", theme: "light", language: "th" },
    folderSettings: Object.fromEntries(DEFAULT_FOLDERS.map(f => [f, {
      notify: f !== "Advertising", bump: f !== "Advertising", badge: true, highlight: true
    }])),
    chats: [],
  };
}

async function loadDb() {
  try {
    const raw = await readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return { version: parsed.version || 1, state: normalizeState(parsed.state || defaultState()) };
  } catch {
    return { version: 1, state: defaultState() };
  }
}

async function saveDb() {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(DATA_FILE, JSON.stringify(db, null, 2));
}

function handleFromUsername(username) {
  return `@${String(username || "user").trim().toLowerCase().replace(/^@+/, "")}`;
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function normalizeState(state) {
  const base = defaultState();
  return {
    ...base,
    ...state,
    users: state.users || base.users,
    friendships: state.friendships || [],
    customFolders: state.customFolders || [],
    appSettings: { ...base.appSettings, ...(state.appSettings || {}) },
    folderSettings: { ...base.folderSettings, ...(state.folderSettings || {}) },
    chats: state.chats || [],
  };
}

function mergeUsers(current, incoming) {
  const map = new Map();
  for (const user of current) map.set(user.id, user);
  for (const user of incoming) {
    const prev = map.get(user.id) || {};
    map.set(user.id, { ...prev, ...user, blocked: unique([...(prev.blocked || []), ...(user.blocked || [])]) });
  }
  return [...map.values()];
}

function publicAuthState() {
  return { version: db.version, state: db.state };
}

function findUserByUsername(username) {
  const q = String(username || "").trim().toLowerCase().replace(/^@+/, "");
  return db.state.users.find(user => String(user.username || "").toLowerCase() === q || String(user.id || "").toLowerCase().replace(/^@+/, "") === q);
}

function pairKey(pair) {
  return [...pair].sort().join("|");
}

function mergeObjectsByMax(a = {}, b = {}) {
  const out = { ...a };
  for (const [key, value] of Object.entries(b)) out[key] = Math.max(Number(out[key] || 0), Number(value || 0));
  return out;
}

function mergeMessages(current = [], incoming = []) {
  const map = new Map();
  for (const msg of current) map.set(msg.id, msg);
  for (const msg of incoming) {
    const prev = map.get(msg.id) || {};
    map.set(msg.id, {
      ...prev,
      ...msg,
      unsent: Boolean(prev.unsent || msg.unsent),
      hiddenFor: unique([...(prev.hiddenFor || []), ...(msg.hiddenFor || [])]),
      readAt: Math.max(Number(prev.readAt || 0), Number(msg.readAt || 0)) || null,
      deliveredAt: Math.max(Number(prev.deliveredAt || 0), Number(msg.deliveredAt || 0)) || null,
    });
  }
  return [...map.values()].sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
}

function mergeChats(current, incoming) {
  const map = new Map();
  for (const chat of current) map.set(chat.id, chat);
  for (const chat of incoming) {
    const prev = map.get(chat.id);
    if (!prev) {
      map.set(chat.id, chat);
      continue;
    }
    const newer = Number(chat.updatedAt || 0) >= Number(prev.updatedAt || 0) ? chat : prev;
    map.set(chat.id, {
      ...prev,
      ...chat,
      name: newer.name ?? chat.name ?? prev.name,
      photo: newer.photo ?? chat.photo ?? prev.photo,
      members: newer.members || unique([...(prev.members || []), ...(chat.members || [])]),
      tags: unique([...(prev.tags || []), ...(chat.tags || [])]),
      unread: mergeObjectsByMax(prev.unread, chat.unread),
      importantUnread: mergeObjectsByMax(prev.importantUnread, chat.importantUnread),
      hiddenFor: unique([...(prev.hiddenFor || []), ...(chat.hiddenFor || [])]),
      pinnedFor: unique([...(prev.pinnedFor || []), ...(chat.pinnedFor || [])]),
      mutedFor: unique([...(prev.mutedFor || []), ...(chat.mutedFor || [])]),
      messages: mergeMessages(prev.messages, chat.messages),
      updatedAt: Math.max(Number(prev.updatedAt || 0), Number(chat.updatedAt || 0)),
    });
  }
  return [...map.values()];
}

function mergeState(currentState, incomingState) {
  const current = normalizeState(currentState);
  const incoming = normalizeState(incomingState);
  const friendshipMap = new Map();
  for (const pair of [...current.friendships, ...incoming.friendships]) {
    if (Array.isArray(pair) && pair.length === 2) friendshipMap.set(pairKey(pair), pair);
  }
  return normalizeState({
    ...current,
    users: mergeUsers(current.users, incoming.users),
    friendships: [...friendshipMap.values()],
    customFolders: unique([...current.customFolders, ...incoming.customFolders]),
    appSettings: { ...current.appSettings, ...incoming.appSettings },
    folderSettings: { ...current.folderSettings, ...incoming.folderSettings },
    chats: mergeChats(current.chats, incoming.chats),
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,PUT,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > MAX_BODY) {
        reject(new Error("Body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolveBody(body));
    req.on("error", reject);
  });
}

function notifyClients(clientId) {
  const event = JSON.stringify({ version: db.version, clientId, at: Date.now() });
  for (const res of clients) res.write(`data: ${event}\n\n`);
}

function serveFile(res, pathname) {
  const clean = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  const file = resolve(join(ROOT, clean));
  if (!file.startsWith(ROOT) || !existsSync(file)) {
    sendJson(res, 404, { error: "Not found" });
    return;
  }
  res.writeHead(200, {
    "Content-Type": mime[extname(file)] || "application/octet-stream",
    "Cache-Control": "no-cache",
  });
  createReadStream(file).pipe(res);
}

createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }
  if (url.pathname === "/api/health") {
    sendJson(res, 200, { ok: true, version: db.version });
    return;
  }
  if (url.pathname === "/api/state" && req.method === "GET") {
    sendJson(res, 200, db);
    return;
  }
  if (url.pathname === "/api/state" && req.method === "PUT") {
    try {
      const body = JSON.parse(await readBody(req) || "{}");
      db = { version: db.version + 1, state: mergeState(db.state, body.state || {}) };
      await saveDb();
      notifyClients(body.clientId || "");
      sendJson(res, 200, db);
    } catch (error) {
      sendJson(res, 400, { error: error.message || "Bad request" });
    }
    return;
  }
  if (url.pathname === "/api/auth/login" && req.method === "POST") {
    try {
      const body = JSON.parse(await readBody(req) || "{}");
      const user = findUserByUsername(body.username);
      if (!user || user.password !== String(body.password || "")) {
        sendJson(res, 401, { error: "Username หรือ Password ไม่ถูกต้อง" });
        return;
      }
      sendJson(res, 200, { ...publicAuthState(), userId: user.id });
    } catch (error) {
      sendJson(res, 400, { error: error.message || "Bad request" });
    }
    return;
  }
  if (url.pathname === "/api/auth/register" && req.method === "POST") {
    try {
      const body = JSON.parse(await readBody(req) || "{}");
      const username = String(body.username || "").trim().toLowerCase();
      const password = String(body.password || "");
      if (!/^[a-zA-Z0-9._]{3,}$/.test(username)) {
        sendJson(res, 400, { error: "Username ใช้ a-z 0-9 . _ อย่างน้อย 3 ตัว" });
        return;
      }
      if (password.length < 4) {
        sendJson(res, 400, { error: "Password ต้องมีอย่างน้อย 4 ตัวอักษร" });
        return;
      }
      if (findUserByUsername(username)) {
        sendJson(res, 409, { error: "Username นี้ถูกใช้แล้ว" });
        return;
      }
      const user = { id: handleFromUsername(username), username, displayName: username, password, avatar: "", blocked: [] };
      db.state.users.push(user);
      db.version += 1;
      await saveDb();
      notifyClients(body.clientId || "");
      sendJson(res, 200, { ...publicAuthState(), userId: user.id });
    } catch (error) {
      sendJson(res, 400, { error: error.message || "Bad request" });
    }
    return;
  }
  if (url.pathname === "/api/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    res.write(`data: ${JSON.stringify({ version: db.version, clientId: "server", at: Date.now() })}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }
  serveFile(res, url.pathname);
}).listen(PORT, () => {
  console.log(`TaiTalk server running on port ${PORT}`);
});
