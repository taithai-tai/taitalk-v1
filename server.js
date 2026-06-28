import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, createReadStream, readFileSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";

const PORT = Number(process.env.PORT || 3000);
const ROOT = resolve(".");
const DATA_DIR = process.env.DATA_DIR || (existsSync("/data") ? "/data" : join(ROOT, "data"));
const DATA_FILE = process.env.DATA_FILE || join(DATA_DIR, "taitalk-state.json");
const MAX_BODY = 30 * 1024 * 1024;
loadEnv();
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "openai/gpt-oss-120b:free";
const LINE_CHANNEL_ID = process.env.LINE_CHANNEL_ID || "";
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || "";
const LINE_CALLBACK_URL = process.env.LINE_CALLBACK_URL || "";
const LINE_AUTH_ENDPOINT = "https://access.line.me/oauth2/v2.1/authorize";
const LINE_TOKEN_ENDPOINT = "https://api.line.me/oauth2/v2.1/token";
const LINE_PROFILE_ENDPOINT = "https://api.line.me/v2/profile";
const lineLoginStates = new Map();
const lineSessions = new Map();

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
    deletedFolders: [],
    userSettings: {},
    aiMemory: {},
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

function lineUsernameFromId(lineId) {
  const safe = String(lineId || "")
    .toLowerCase()
    .replace(/^line[:_-]?/, "")
    .replace(/[^a-z0-9._]/g, "")
    .slice(0, 18) || Math.random().toString(36).slice(2, 10);
  return `line_${safe}`;
}

function randomToken(bytes = 24) {
  return randomBytes(bytes).toString("hex");
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
    deletedFolders: state.deletedFolders || [],
    userSettings: state.userSettings || {},
    aiMemory: state.aiMemory || {},
    appSettings: { ...base.appSettings, ...(state.appSettings || {}) },
    folderSettings: { ...base.folderSettings, ...(state.folderSettings || {}) },
    chats: state.chats || [],
  };
}

function loadEnv() {
  if (!existsSync(join(ROOT, ".env"))) return;
  try {
    const lines = awaitReadEnv();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const [key, ...rest] = trimmed.split("=");
      if (!process.env[key]) process.env[key] = rest.join("=").trim().replace(/^['"]|['"]$/g, "");
    }
  } catch {}
}

function awaitReadEnv() {
  return existsSync(join(ROOT, ".env"))
    ? String(readFileSync(join(ROOT, ".env"), "utf8")).split(/\r?\n/)
    : [];
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
  const deletedFolders = unique([...(current.deletedFolders || []), ...(incoming.deletedFolders || [])])
    .filter(folder => !DEFAULT_FOLDERS.includes(folder));
  const deletedFolderSet = new Set(deletedFolders);
  const customFolders = unique([...current.customFolders, ...incoming.customFolders])
    .filter(folder => !deletedFolderSet.has(folder));
  const folderSettings = { ...current.folderSettings, ...incoming.folderSettings };
  for (const folder of deletedFolderSet) delete folderSettings[folder];
  const friendshipMap = new Map();
  for (const pair of [...current.friendships, ...incoming.friendships]) {
    if (Array.isArray(pair) && pair.length === 2) friendshipMap.set(pairKey(pair), pair);
  }
  return normalizeState({
    ...current,
    users: mergeUsers(current.users, incoming.users),
    friendships: [...friendshipMap.values()],
    customFolders,
    deletedFolders,
    userSettings: { ...(current.userSettings || {}), ...(incoming.userSettings || {}) },
    aiMemory: { ...(current.aiMemory || {}), ...(incoming.aiMemory || {}) },
    appSettings: { ...current.appSettings, ...incoming.appSettings },
    folderSettings,
    chats: mergeChats(current.chats, incoming.chats),
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(data));
}

function redirect(res, location, status = 302) {
  res.writeHead(status, { Location: location, "Cache-Control": "no-cache" });
  res.end();
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

function requestBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || (req.socket.encrypted ? "https" : "http");
  const host = req.headers["x-forwarded-host"] || req.headers.host || `localhost:${PORT}`;
  return `${String(proto).split(",")[0]}://${String(host).split(",")[0]}`;
}

function callbackUrl(req) {
  return LINE_CALLBACK_URL || `${requestBaseUrl(req)}/api/auth/line/callback`;
}

function safeReturnTo(value, req) {
  const fallback = `${requestBaseUrl(req)}/vb1`;
  if (!value) return fallback;
  try {
    const parsed = new URL(value, requestBaseUrl(req));
    if (!["http:", "https:"].includes(parsed.protocol)) return fallback;
    return parsed.href;
  } catch {
    return fallback;
  }
}

function createLineAuthUrl(req, returnTo) {
  const state = randomToken(18);
  const nonce = randomToken(18);
  lineLoginStates.set(state, { returnTo, nonce, createdAt: Date.now() });
  const authUrl = new URL(LINE_AUTH_ENDPOINT);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", LINE_CHANNEL_ID);
  authUrl.searchParams.set("redirect_uri", callbackUrl(req));
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("scope", "profile openid");
  authUrl.searchParams.set("nonce", nonce);
  return authUrl.href;
}

function pruneLineMaps() {
  const now = Date.now();
  for (const [key, item] of lineLoginStates) {
    if (now - item.createdAt > 10 * 60 * 1000) lineLoginStates.delete(key);
  }
  for (const [key, item] of lineSessions) {
    if (now - item.createdAt > 5 * 60 * 1000) lineSessions.delete(key);
  }
}

function upsertLineUser(profile) {
  const lineId = String(profile.userId || profile.sub || "").trim();
  if (!lineId) throw new Error("LINE profile missing userId");
  const username = lineUsernameFromId(lineId);
  const displayName = String(profile.displayName || profile.name || "LINE User").trim() || "LINE User";
  const pictureUrl = String(profile.pictureUrl || profile.picture || "").trim();
  let user = db.state.users.find(u => u.lineId === lineId || u.username === username || u.id === handleFromUsername(username));
  if (!user) {
    user = { id: handleFromUsername(username), username, displayName, password: "line-login", avatar: pictureUrl, blocked: [], lineId, authProvider: "line" };
    db.state.users.push(user);
    return { user, changed: true };
  }
  let changed = false;
  if (!user.lineId) { user.lineId = lineId; changed = true; }
  if (user.authProvider !== "line") { user.authProvider = "line"; changed = true; }
  if (displayName && user.displayName !== displayName) { user.displayName = displayName; changed = true; }
  if (pictureUrl && user.avatar !== pictureUrl) { user.avatar = pictureUrl; changed = true; }
  return { user, changed };
}

async function exchangeLineCode(req, code) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: callbackUrl(req),
    client_id: LINE_CHANNEL_ID,
    client_secret: LINE_CHANNEL_SECRET,
  });
  const tokenResponse = await fetch(LINE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const tokenData = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok) throw new Error(tokenData.error_description || tokenData.error || "LINE token exchange failed");
  const profileResponse = await fetch(LINE_PROFILE_ENDPOINT, {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const profile = await profileResponse.json().catch(() => ({}));
  if (!profileResponse.ok) throw new Error(profile.message || "LINE profile fetch failed");
  return profile;
}

function notifyClients(clientId) {
  const event = JSON.stringify({ version: db.version, clientId, at: Date.now() });
  for (const res of clients) res.write(`data: ${event}\n\n`);
}

function mockAiResult(task, input = {}) {
  const text = String(input.text || input.prompt || "");
  if (task === "rewrite") {
    const mode = input.mode || "rewrite";
    if (mode === "formal") return { mode: "mock", text: text ? formalizeThai(text) : "เรียนแจ้งให้ทราบครับ/ค่ะ" };
    if (mode === "polish" || mode === "rewrite") return { mode: "mock", text: text ? polishText(text) : "พิมพ์ข้อความที่ต้องการปรับให้อ่านง่ายขึ้น" };
    if (mode === "friendly") return { mode: "mock", text: text ? `${text.trim()} นะ ขอบคุณมาก!` : "ได้เลย ขอบคุณมากนะ!" };
    if (mode === "shorten") return { mode: "mock", text: text ? text.trim().split(/\s+/).slice(0, 14).join(" ") : "รับทราบ" };
    return { mode: "mock", text: polishText(text) };
  }
  if (task === "translate") return { mode: "mock", text: mockTranslate(text, input.target) };
  if (task === "summary") return { mode: "mock", text: "• Important: มีข้อความที่ควรติดตาม\n• Deadline: ตรวจคำว่า วันนี้/พรุ่งนี้/ส่งงาน\n• File: รวมไฟล์จากแชทนี้\n• To-do: ตอบกลับหรือสร้าง reminder หากจำเป็น" };
  if (task === "search") return { mode: "mock", text: "ผลลัพธ์ mock: พบข้อมูลที่เกี่ยวข้องจากชื่อแชท ข้อความล่าสุด และชื่อไฟล์" };
  return { mode: "mock", text: "AI mock พร้อมใช้งาน" };
}

function polishText(text) {
  return String(text || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/ผมเจอว่า/g, "ผมพบว่า")
    .replace(/มัน/g, "ส่วนนี้")
    .replace(/อะ/g, "")
    .replace(/นะครับนะ/g, "นะครับ")
    .replace(/ค่ะค่ะ/g, "ค่ะ")
    .replace(/ครับครับ/g, "ครับ")
    .replace(/([.!?]){2,}/g, "$1")
    .trim();
}

function formalizeThai(text) {
  const polished = polishText(text);
  if (!polished) return "เรียนแจ้งให้ทราบครับ/ค่ะ";
  if (/^(เรียน|ขอเรียน|เนื่องจาก|รบกวน|โปรด)/.test(polished)) return polished;
  return `เรียนแจ้งให้ทราบว่า ${polished} จึงขอความกรุณาดำเนินการตามความเหมาะสม ขอบคุณครับ/ค่ะ`;
}

function mockTranslate(text, target = "") {
  const source = String(text || "").trim();
  if (!source) return "";
  const thai = /[\u0E00-\u0E7F]/.test(source);
  const toEnglish = /^en|english$/i.test(target) || (!target && thai);
  const toThai = /^th|thai$/i.test(target) || (!target && !thai);
  if (toEnglish && thai) return translateThaiTextToEnglish(source);
  if (toThai && !thai) {
    return replacePhrases(source, [
      ["hello", "สวัสดี"],
      ["thank you", "ขอบคุณ"],
      ["sorry", "ขอโทษ"],
      ["please send me the work file", "ช่วยส่งไฟล์งานให้หน่อย"],
      ["please send me the file", "ช่วยส่งไฟล์ให้หน่อย"],
      ["please take a look", "ช่วยดูให้หน่อย"],
      ["submit the assignment", "ส่งงาน"],
      ["send the work file", "ส่งไฟล์งาน"],
      ["send the file", "ส่งไฟล์"],
      ["work file", "ไฟล์งาน"],
      ["tomorrow", "พรุ่งนี้"],
      ["today", "วันนี้"],
      ["meeting", "ประชุม"],
      ["exam", "สอบ"],
      ["urgent", "ด่วน"],
      ["please", "ช่วย"],
    ], true);
  }
  return source;
}

const THAI_TO_EN_PHRASES = [
  ["ช่วยส่งไฟล์งานให้หน่อย", "please send me the work file"],
  ["ช่วยส่งไฟล์ให้หน่อย", "please send me the file"],
  ["ช่วยดูให้หน่อย", "please take a look"],
  ["อ่านไม่เข้าใจ", "hard to understand"],
  ["อ่านยาก", "hard to read"],
  ["ไม่ว่าง", "not available"],
  ["เจอกัน", "see you"],
  ["กี่โมง", "what time"],
  ["ส่งไฟล์งาน", "send the work file"],
  ["ส่งไฟล์", "send the file"],
  ["ส่งงาน", "submit the assignment"],
  ["ไฟล์งาน", "work file"],
  ["ให้หน่อย", "for me"],
  ["ขอบคุณมาก", "thank you very much"],
  ["ขอโทษ", "sorry"],
  ["สวัสดี", "hello"],
  ["ขอบคุณ", "thank you"],
  ["พรุ่งนี้", "tomorrow"],
  ["วันนี้", "today"],
  ["ประชุม", "meeting"],
  ["สอบ", "exam"],
  ["ด่วน", "urgent"],
];

const THAI_TO_EN_WORDS = {
  "ผม": "I",
  "ฉัน": "I",
  "เรา": "we",
  "คุณ": "you",
  "เขา": "they",
  "ช่วย": "please",
  "ส่ง": "send",
  "ไฟล์": "file",
  "งาน": "work",
  "การบ้าน": "homework",
  "โปรเจกต์": "project",
  "project": "project",
  "ประชุม": "meeting",
  "เรียน": "study",
  "สอบ": "exam",
  "อ่าน": "read",
  "เข้าใจ": "understand",
  "ดู": "look",
  "คิด": "think",
  "เช็ค": "check",
  "แก้": "fix",
  "ทำ": "do",
  "ไป": "go",
  "มา": "come",
  "กิน": "eat",
  "ข้าว": "meal",
  "เจอ": "meet",
  "นัด": "appointment",
  "เวลา": "time",
  "โมง": "o'clock",
  "ที่": "at",
  "บ้าน": "home",
  "โรงเรียน": "school",
  "มหาลัย": "university",
  "วันนี้": "today",
  "พรุ่งนี้": "tomorrow",
  "เมื่อวาน": "yesterday",
  "ตอนนี้": "now",
  "เดี๋ยว": "later",
  "แล้ว": "already",
  "ยัง": "still",
  "ต้อง": "must",
  "และ": "and",
  "แต่": "but",
  "หรือ": "or",
  "ไม่": "not",
  "ว่าง": "available",
  "ได้": "can",
  "ไหม": "?",
  "มั้ย": "?",
  "นะ": "",
  "ครับ": "",
  "ค่ะ": "",
  "คะ": "",
  "หน่อย": "please",
  "มาก": "very",
  "ยาก": "difficult",
  "ง่าย": "easy",
  "ดี": "good",
  "สำคัญ": "important",
  "ด่วน": "urgent",
};

function translateThaiTextToEnglish(source) {
  return splitSentences(source)
    .map(sentence => translateThaiSentenceToEnglish(sentence))
    .filter(Boolean)
    .join(" ")
    .replace(/\s+([?.!,])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function splitSentences(source) {
  return String(source || "")
    .split(/(?<=[.!?。！？\n])\s*|\s*(?=(?:วันนี้|พรุ่งนี้|เดี๋ยว|แล้ว|แต่|และ)\b)/)
    .map(s => s.trim())
    .filter(Boolean);
}

function translateThaiSentenceToEnglish(sentence) {
  let output = protectEnglishPhrases(sentence, THAI_TO_EN_PHRASES);
  output = output.replace(/[\u0E00-\u0E7F]+/g, run => segmentThai(run).map(word => THAI_TO_EN_WORDS[word] ?? "message").join(" "));
  return cleanupTranslatedText(output);
}

function protectEnglishPhrases(source, pairs) {
  let output = source;
  const placeholders = [];
  for (const [from, to] of pairs.sort((a, b) => b[0].length - a[0].length)) {
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    output = output.replace(new RegExp(escaped, "g"), () => {
      const token = `__TT${placeholders.length}__`;
      placeholders.push([token, to]);
      return ` ${token} `;
    });
  }
  for (const [token, value] of placeholders) output = output.replaceAll(token, value);
  return output;
}

function segmentThai(text) {
  try {
    return [...new Intl.Segmenter("th", { granularity: "word" }).segment(text)]
      .map(part => part.segment.trim())
      .filter(Boolean);
  } catch {
    return text.match(/[\u0E00-\u0E7F]+/g) || [];
  }
}

function cleanupTranslatedText(text) {
  return String(text || "")
    .replace(/\bmessage\b(?:\s+\bmessage\b)+/g, "message")
    .replace(/\bplease\s+please\b/g, "please")
    .replace(/\s+([?.!,])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function replacePhrases(source, pairs, wordMode = false) {
  let output = String(source || "");
  for (const [from, to] of pairs.sort((a, b) => b[0].length - a[0].length)) {
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = wordMode ? new RegExp(`\\b${escaped}\\b`, "gi") : new RegExp(escaped, "g");
    output = output.replace(pattern, ` ${to} `);
  }
  return output.replace(/\s+/g, " ").trim();
}

function aiInstruction(task, input = {}) {
  if (task === "summary") {
    return "Summarize the chat into concise Thai bullet points. Use exactly these section labels when relevant: Important, Deadline, Link, File, To-do. Do not invent facts.";
  }
  if (task === "translate") {
    return `Translate the provided text into ${input.target || "Thai"}. Return only the translated text, no prefix, no explanation, no quotation marks.`;
  }
  if (task === "rewrite") {
    const mode = input.mode || "rewrite";
    const modes = {
      formal: "Rewrite the message into clearly formal Thai. Make it suitable for work, school, or official communication. It may change tone significantly, but keep the original meaning. Return only the rewritten message.",
      polish: "Polish the message for grammar, clarity, readability, and natural wording. Do not make it more formal, do not add new meaning, and keep the original tone. Return only the improved message.",
      friendly: "Rewrite the message in friendly natural Thai.",
      shorten: "Shorten the message while keeping the main meaning.",
      translate: "Translate the message into natural Thai unless the text is already Thai, then translate it into English.",
      rewrite: "Polish the message for grammar, clarity, readability, and natural wording. Do not make it more formal, do not add new meaning, and keep the original tone. Return only the improved message.",
    };
    return modes[mode] || modes.rewrite;
  }
  if (task === "search") {
    return "Answer the user's search question using only the provided chat/file context. Include source names, dates, and file types when available.";
  }
  return "Help the user with this TaiTalk chat task concisely.";
}

async function runAi(task, input) {
  if (!OPENROUTER_API_KEY) return mockAiResult(task, input);
  const prompt = JSON.stringify(input || {}, null, 2);
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "HTTP-Referer": "https://taitalk.local",
      "X-Title": "TaiTalk V2",
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [
        { role: "system", content: `You are TaiTalk AI. ${aiInstruction(task, input)} Reply concisely and naturally.` },
        { role: "user", content: prompt },
      ],
      temperature: task === "rewrite" ? 0.5 : 0.2,
    }),
  });
  if (!response.ok) return mockAiResult(task, input);
  const data = await response.json();
  const text = cleanAiText(data.choices?.[0]?.message?.content || "");
  return { mode: "api", text: text || mockAiResult(task, input).text };
}

function cleanAiText(text) {
  return String(text || "")
    .trim()
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/^(translation|translated text|คำแปล)\s*[:：]\s*/i, "")
    .trim();
}

function serveFile(res, pathname) {
  const clean = pathname === "/"
    ? "/index.html"
    : pathname === "/v2"
      ? "/v2.html"
      : pathname === "/vb1" || pathname === "/v.b1"
        ? "/vb1.html"
        : decodeURIComponent(pathname);
  let file = resolve(join(ROOT, clean));
  if (existsSync(file) && statSync(file).isDirectory()) file = resolve(join(file, "index.html"));
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
  if (url.pathname === "/api/auth/line/start" && req.method === "GET") {
    pruneLineMaps();
    const returnTo = safeReturnTo(url.searchParams.get("returnTo"), req);
    if (!LINE_CHANNEL_ID || !LINE_CHANNEL_SECRET) {
      const back = new URL(returnTo);
      back.searchParams.set("lineError", "LINE_CONFIG_MISSING");
      redirect(res, back.href);
      return;
    }
    redirect(res, createLineAuthUrl(req, returnTo));
    return;
  }
  if (url.pathname === "/api/auth/line/callback" && req.method === "GET") {
    pruneLineMaps();
    const state = url.searchParams.get("state") || "";
    const saved = lineLoginStates.get(state);
    const returnTo = saved?.returnTo || `${requestBaseUrl(req)}/vb1`;
    lineLoginStates.delete(state);
    const back = new URL(returnTo);
    try {
      if (url.searchParams.get("error")) throw new Error(url.searchParams.get("error_description") || "LINE Login ถูกยกเลิก");
      if (!saved) throw new Error("LINE Login session หมดอายุ กรุณาลองใหม่");
      const code = url.searchParams.get("code") || "";
      if (!code) throw new Error("ไม่พบ LINE authorization code");
      const profile = await exchangeLineCode(req, code);
      const { user, changed } = upsertLineUser(profile);
      if (changed) {
        db.version += 1;
        await saveDb();
        notifyClients("line-login");
      }
      const token = randomToken(24);
      lineSessions.set(token, { userId: user.id, createdAt: Date.now() });
      back.searchParams.set("lineSession", token);
      back.searchParams.set("apiBase", requestBaseUrl(req));
    } catch (error) {
      back.searchParams.set("lineError", error.message || "LINE Login ไม่สำเร็จ");
    }
    redirect(res, back.href);
    return;
  }
  if (url.pathname === "/api/auth/line/session" && req.method === "POST") {
    try {
      pruneLineMaps();
      const body = JSON.parse(await readBody(req) || "{}");
      const token = String(body.token || "").trim();
      const session = lineSessions.get(token);
      lineSessions.delete(token);
      if (!session) {
        sendJson(res, 401, { error: "LINE session หมดอายุ กรุณาลองใหม่" });
        return;
      }
      sendJson(res, 200, { ...publicAuthState(), userId: session.userId });
    } catch (error) {
      sendJson(res, 400, { error: error.message || "Bad request" });
    }
    return;
  }
  if (url.pathname === "/api/auth/line" && req.method === "POST") {
    try {
      const body = JSON.parse(await readBody(req) || "{}");
      const lineId = String(body.lineId || "").trim();
      if (!lineId) {
        sendJson(res, 400, { error: "ไม่พบ LINE ID" });
        return;
      }
      const username = lineUsernameFromId(lineId);
      const displayName = String(body.displayName || "LINE User").trim() || "LINE User";
      let user = db.state.users.find(u => u.lineId === lineId || u.username === username || u.id === handleFromUsername(username));
      if (!user) {
        user = { id: handleFromUsername(username), username, displayName, password: "line-login", avatar: "", blocked: [], lineId, authProvider: "line" };
        db.state.users.push(user);
        db.version += 1;
        await saveDb();
        notifyClients(body.clientId || "");
      } else {
        let changed = false;
        if (!user.lineId) { user.lineId = lineId; changed = true; }
        if (!user.authProvider) { user.authProvider = "line"; changed = true; }
        if (displayName && user.displayName !== displayName && user.displayName === user.username) {
          user.displayName = displayName;
          changed = true;
        }
        if (changed) {
          db.version += 1;
          await saveDb();
          notifyClients(body.clientId || "");
        }
      }
      sendJson(res, 200, { ...publicAuthState(), userId: user.id });
    } catch (error) {
      sendJson(res, 400, { error: error.message || "Bad request" });
    }
    return;
  }
  if (url.pathname === "/api/ai" && req.method === "POST") {
    try {
      const body = JSON.parse(await readBody(req) || "{}");
      sendJson(res, 200, await runAi(body.task || "general", body.input || {}));
    } catch (error) {
      sendJson(res, 200, mockAiResult("error", { text: error.message || "AI unavailable" }));
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
