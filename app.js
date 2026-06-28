// ─── Keywords ───────────────────────────────────────────────
const IMPORTANT_KEYWORDS = ["ด่วน","สำคัญ","ส่งงาน","deadline","ประชุม","สอบ","วันนี้","พรุ่งนี้","นัด","ต้องส่ง","final","project","assignment"];
const AD_KEYWORDS = ["โปรโมชั่น","ลดราคา","sale","discount","flash sale","ซื้อ 1 แถม 1","ฟรี","คูปอง","voucher","โค้ดส่วนลด","shop","shopping","สั่งซื้อ","สมัครวันนี้","รับสิทธิ์","แจกฟรี","คลิกเลย"];
const DEFAULT_FOLDERS = ["Main","Important","Advertising","Request","Group","Work","Study","Friends","Family"];
const STORAGE_KEY = "taitalk:v2";
const SESSION_KEY = "taitalk:v2:session";
const SYNC_CHANNEL = "taitalk:v2:sync";
const TAB_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const API_BASE_KEY = "taitalk:api-base";
const urlParams = new URLSearchParams(location.search);
const queryApiBase = urlParams.get("apiBase") || "";
if (queryApiBase) localStorage.setItem(API_BASE_KEY, queryApiBase.replace(/\/+$/, ""));
const API_BASE = (window.TAITALK_API_BASE || queryApiBase || localStorage.getItem(API_BASE_KEY) || "").replace(/\/+$/, "");
const IS_VB1 = location.pathname.includes("/vb1") || location.pathname.includes("/v.b1");
const IS_V2 = location.pathname.includes("/v2") || IS_VB1;
const LINE_PROFILE_KEY = "taitalk:vb1:line-profile";
const app = document.querySelector("#app");
let didMigrateState = false;
let syncChannel = null;
let remoteStateVersion = 0;
let remoteAvailable = false;
let remoteSaveTimer = null;
let pendingRemoteSave = false;
let remoteSaving = false;

// ─── State ───────────────────────────────────────────────────
function defaultState() {
  return {
    users: [
      { id: "@mali",      username: "mali",      displayName: "Mali",       password: "1234", avatar: "", blocked: [] },
      { id: "@narin",     username: "narin",     displayName: "Narin",      password: "1234", avatar: "", blocked: [] },
      { id: "@studyteam", username: "studyteam", displayName: "Study Team", password: "1234", avatar: "", blocked: [] },
    ],
    friendships: [],
    customFolders: [],
    deletedFolders: [],
    userSettings: {},
    aiMemory: {},
    appSettings: { fontSize: "normal", theme: "light", language: "th" },
    folderSettings: Object.fromEntries(DEFAULT_FOLDERS.map(f => [f, {
      notify: f !== "Advertising", bump: f !== "Advertising", badge: true, highlight: true,
      order: DEFAULT_FOLDERS.indexOf(f) + 1,
      keywords: f === "Important" ? IMPORTANT_KEYWORDS.join(", ") : f === "Advertising" ? AD_KEYWORDS.join(", ") : ""
    }])),
    chats: [],
  };
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return defaultState();
    const parsed = JSON.parse(saved);
    const base = defaultState();
    return migrateStateIds({
      ...base, ...parsed,
      folderSettings: { ...base.folderSettings, ...(parsed.folderSettings || {}) },
      appSettings:    { ...base.appSettings,    ...(parsed.appSettings    || {}) },
      customFolders:  parsed.customFolders || [],
      deletedFolders: parsed.deletedFolders || [],
      userSettings:   parsed.userSettings || {},
      aiMemory:       parsed.aiMemory || {},
    });
  } catch { return defaultState(); }
}

function storedSession() {
  return sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY) || null;
}

function setStoredSession(id) {
  sessionStorage.setItem(SESSION_KEY, id);
  localStorage.setItem(SESSION_KEY, id);
}

function clearStoredSession() {
  sessionStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(SESSION_KEY);
}

function broadcastStateChange() {
  syncChannel?.postMessage({ type: "state-updated", source: TAB_ID, at: Date.now() });
  localStorage.setItem(`${STORAGE_KEY}:pulse`, `${TAB_ID}:${Date.now()}`);
}

function saveState({ silent = false, remote = true } = {}) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (!silent) broadcastStateChange();
  if (remote) queueRemoteSave();
}

let state = loadState();
let sessionId = storedSession();
if (sessionId && !sessionStorage.getItem(SESSION_KEY)) setStoredSession(sessionId);
if (didMigrateState) saveState({ silent: true });

let view = {
  authMode: "register",
  screen: "home",
  folder: "Main",
  chatId: null,
  detailTab: "people",
  search: "",
  addFriendQuery: "",
  addFriendResult: null,   // null | "notfound" | user object
  newFolderName: "",
  groupDraft: "",
  groupMemberDraft: "",
  qrInput: "",
  pendingFile: null,
  manageMode: false,
  selectedChatIds: [],
  scannerOpen: false,
  scannerStatus: "กำลังเตรียมกล้อง...",
  chatSettingsOpen: false,
  chatSearch: "",
  folderSettingTarget: "Main",
  _authUser: "", _authPass: "",
  openSwipeChatId: null,
  openSwipeDir: null,
  editingFolder: null,
  showNewFolderInput: false,
  aiComposeOpen: false,
  composerDraft: "",
};

let qrStream = null, qrScanTimer = null;

// ─── Helpers ──────────────────────────────────────────────────
function esc(v) {
  return String(v||"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
}
function unique(arr) { return [...new Set(arr)]; }
function makeId(p) { return `${p}-${Math.random().toString(36).slice(2,8)}-${Date.now().toString(36)}`; }
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
function lineMockProfile() {
  try {
    const saved = JSON.parse(localStorage.getItem(LINE_PROFILE_KEY) || "null");
    if (saved?.lineId) return saved;
  } catch {}
  const randomPart = (globalThis.crypto?.randomUUID?.() || makeId("line")).replace(/[^a-z0-9]/gi, "").slice(0, 12).toLowerCase();
  const profile = { lineId: `line-${randomPart}`, displayName: "LINE User" };
  localStorage.setItem(LINE_PROFILE_KEY, JSON.stringify(profile));
  return profile;
}
function legacyIdToHandle(id, username = "") {
  const raw = String(id || "").trim();
  if (username) return handleFromUsername(username);
  if (raw.startsWith("@")) return handleFromUsername(raw);
  if (/^(ADD|TT)-1002$/i.test(raw)) return "@mali";
  if (/^(ADD|TT)-1003$/i.test(raw)) return "@narin";
  if (/^(ADD|TT)-1004$/i.test(raw)) return "@studyteam";
  return handleFromUsername(raw);
}
function parseFriendQuery(raw) {
  const cleaned = String(raw || "").trim();
  const parts = cleaned.split(":");
  const value = parts.length >= 2 && parts[0].toUpperCase() === "TAITALK" ? parts[1] : cleaned;
  return value.trim().toLowerCase().replace(/^@+/, "");
}
function findUserByFriendQuery(raw) {
  const q = parseFriendQuery(raw);
  if (!q) return null;
  return state.users.find((user) => {
    const id = String(user.id || "").toLowerCase();
    const handle = legacyIdToHandle(user.id, user.username).toLowerCase().replace(/^@+/, "");
    const legacyAdd = user.username === "mali" ? "add-1002" : user.username === "narin" ? "add-1003" : user.username === "studyteam" ? "add-1004" : "";
    return id.replace(/^@+/, "") === q || handle === q || legacyAdd === q || String(user.username || "").toLowerCase() === q || String(user.displayName || "").toLowerCase() === q;
  }) || null;
}
function contactFromQuery(raw) {
  const q = parseFriendQuery(raw);
  if (!q) return null;
  const existing = findUserByFriendQuery(q);
  if (existing) return existing;
  let username = q.replace(/[^a-z0-9._]/g, "").slice(0, 24);
  if (username.length < 3) username = `friend${Math.floor(1000 + Math.random() * 9000)}`;
  let handle = handleFromUsername(username);
  while (state.users.some((user) => user.id === handle || user.username === username)) {
    username = `${username.replace(/\d+$/, "")}${Math.floor(1000 + Math.random() * 9000)}`.slice(0, 24);
    handle = handleFromUsername(username);
  }
  const user = { id: handle, username, displayName: username, password: "1234", avatar: "", blocked: [], localContact: true };
  state.users.push(user);
  saveState();
  return user;
}
function addAndOpenFriend(otherId) {
  if (!otherId || otherId === sessionId || isBlocked(sessionId, otherId)) return false;
  addFriendPair(sessionId, otherId);
  const chat = ensureChatForUser(otherId);
  if (chat.tags.includes("Request")) chat.tags = ["Main"];
  view.addFriendResult = null;
  view.addFriendQuery = "";
  view.folder = "Main";
  view.chatId = chat.id;
  view.screen = "chat";
  saveState();
  render();
  return true;
}
function switchToChatMember(chatId, userId) {
  const chat = state.chats.find(c => c.id === chatId && c.members.includes(userId));
  if (!chat || !byId(userId)) return;
  sessionId = userId;
  setStoredSession(sessionId);
  view.chatId = chat.id;
  view.folder = chat.tags.includes("Request") ? "Request" : chat.tags.includes("Main") ? "Main" : chat.tags[0] || "Main";
  view.screen = "chat";
  view.manageMode = false;
  chat.unread[sessionId] = 0;
  chat.importantUnread[sessionId] = 0;
  chat.messages.forEach(m => {
    if (m.senderId !== sessionId && !m.readAt) m.readAt = Date.now();
  });
  saveState();
  render();
}
function activeChat() {
  return state.chats.find(c => c.id === view.chatId && c.members.includes(sessionId)) || null;
}
function chatFiles(chat) {
  return visibleMessages(chat).filter(m => m.file);
}
function chatPhotos(chat) {
  return chatFiles(chat).filter(m => m.file.type?.startsWith("image/"));
}
function allFiles() {
  return state.chats
    .filter(c => c.members.includes(sessionId))
    .flatMap(c => visibleMessages(c).filter(m => m.file).map(m => ({ chat: c, message: m, file: m.file })));
}
function fileTypeLabel(file) {
  const name = file?.name || "";
  const type = file?.type || "";
  if (type.startsWith("image/")) return "รูปภาพ";
  if (type.startsWith("video/")) return "วิดีโอ";
  if (/canva|www\.canva/i.test(name)) return "Canva Link";
  if (/\.pdf$/i.test(name)) return "PDF";
  if (/\.pptx?$/i.test(name)) return "PowerPoint";
  if (/\.docx?$/i.test(name)) return "Word";
  if (/\.xlsx?$/i.test(name)) return "Excel";
  if (/\.zip$/i.test(name)) return "ZIP";
  return "File";
}
function chatAiDisabled(chat) { return !!userSettings().chatAiDisabled?.[chat.id]; }
function aiCategoryForChat(chat) {
  const settings = userSettings();
  if (chatAiDisabled(chat)) return { category: "Private Chat", reason: "AI ถูกปิดสำหรับแชทนี้" };
  if (settings.chatCategories?.[chat.id]) return { category: settings.chatCategories[chat.id], reason: settings.chatAiReasons?.[chat.id] || "ผู้ใช้แก้หมวดเอง AI mock จดจำไว้" };
  const latest = latestMessage(chat);
  const text = `${chatName(chat)} ${latest?.text || ""} ${latest?.file?.name || ""}`.toLowerCase();
  if (AD_KEYWORDS.some(k => text.includes(k.toLowerCase()))) return { category: "Advertising", reason: "พบคำแนวโฆษณาหรือโปรโมชัน" };
  if (IMPORTANT_KEYWORDS.some(k => text.includes(k.toLowerCase()))) return { category: "Important", reason: "พบคำสำคัญ เช่น deadline, วันนี้, ส่งงาน" };
  if (/งาน|project|meeting|deadline|work|ประชุม/.test(text)) return { category: "Work", reason: "บริบทเกี่ยวกับงานหรือประชุม" };
  if (/สอบ|เรียน|assignment|homework|study|การบ้าน|วิชา/.test(text)) return { category: "Study", reason: "บริบทเกี่ยวกับเรียน งานส่ง หรือสอบ" };
  if (/family|แม่|พ่อ|บ้าน/.test(text)) return { category: "Family", reason: "บริบทส่วนตัวหรือครอบครัว" };
  return { category: "Friends", reason: "แชททั่วไป ไม่มีสัญญาณสำคัญพิเศษ" };
}
function detectReminderText(text) {
  return /(พรุ่งนี้|วันนี้|วันศุกร์|deadline|ส่งงาน|ประชุม|นัด|เจอกัน|\d{1,2}\s?โมง|\d{1,2}:\d{2})/i.test(text || "");
}
function containsThai(text) {
  return /[\u0E00-\u0E7F]/.test(text || "");
}
function translateTargetForText(text) {
  return containsThai(text) ? "English" : "Thai";
}
function aiModeLabel(mode) {
  return ({ polish: "ดูดีขึ้น", formal: "ทางการ", shorten: "สั้นลง", translate: "แปล" })[mode] || mode;
}
async function aiRequest(task, input) {
  try {
    const res = await fetch(`${API_BASE}/api/ai`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task, input }),
    });
    return await res.json();
  } catch {
    return { mode: "mock", text: "AI mock: ยังไม่ได้เชื่อมต่อ API" };
  }
}
function migrateStateIds(data) {
  const idMap = new Map();
  for (const user of data.users || []) {
    idMap.set(user.id, legacyIdToHandle(user.id, user.username));
  }
  data.users = (data.users || []).map((user) => {
    const nextId = legacyIdToHandle(user.id, user.username);
    if (nextId !== user.id) didMigrateState = true;
    return { ...user, id: nextId, blocked: (user.blocked || []).map((id) => idMap.get(id) || legacyIdToHandle(id)) };
  });
  const convert = (id) => idMap.get(id) || legacyIdToHandle(id);
  data.friendships = (data.friendships || []).map((pair) => pair.map(convert));
  data.chats = (data.chats || []).map((chat) => ({
    ...chat,
    members: (chat.members || []).map(convert),
    unread: Object.fromEntries(Object.entries(chat.unread || {}).map(([key, value]) => [convert(key), value])),
    importantUnread: Object.fromEntries(Object.entries(chat.importantUnread || {}).map(([key, value]) => [convert(key), value])),
    hiddenFor: (chat.hiddenFor || []).map(convert),
    pinnedFor: (chat.pinnedFor || []).map(convert),
    mutedFor: (chat.mutedFor || []).map(convert),
    messages: (chat.messages || []).map((message) => ({
      ...message,
      senderId: convert(message.senderId),
      hiddenFor: (message.hiddenFor || []).map(convert),
    })),
  }));
  for (const seed of defaultState().users) {
    const exists = data.users.some((user) => user.id === seed.id || user.username === seed.username);
    if (!exists) {
      data.users.push(seed);
      didMigrateState = true;
    }
  }
  const savedSession = localStorage.getItem(SESSION_KEY);
  if (savedSession && convert(savedSession) !== savedSession) {
    setStoredSession(convert(savedSession));
    didMigrateState = true;
  }
  return data;
}
function formatTime(v) {
  return new Intl.DateTimeFormat("th-TH",{hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(v));
}
function defaultFolderSettings() {
  return Object.fromEntries(DEFAULT_FOLDERS.map(f => [f, {
    notify: f !== "Advertising", bump: f !== "Advertising", badge: true, highlight: true,
    order: DEFAULT_FOLDERS.indexOf(f) + 1,
    keywords: f === "Important" ? IMPORTANT_KEYWORDS.join(", ") : f === "Advertising" ? AD_KEYWORDS.join(", ") : ""
  }]));
}
function defaultUserSettings() {
  return {
    appSettings: { fontSize: "normal", theme: "light", language: "th" },
    folderSettings: defaultFolderSettings(),
    customFolders: [],
    deletedFolders: [],
    notificationSettings: { priorityOnly: false, quietAds: true },
    aiSettings: { enabled: true, autoCategorize: true, autoSearch: true, autoTranslate: false, tutorialSeen: false },
    chatAiDisabled: {},
    chatAutoTranslate: {},
    chatPriority: {},
    chatCategories: {},
    chatAiReasons: {},
    pinnedFiles: [],
    reminders: [],
    savedFiles: [],
  };
}
function userSettings(userId = sessionId) {
  if (!state.userSettings) state.userSettings = {};
  const key = userId || "__guest";
  if (!state.userSettings[key]) state.userSettings[key] = defaultUserSettings();
  const base = defaultUserSettings();
  state.userSettings[key] = {
    ...base,
    ...state.userSettings[key],
    appSettings: { ...base.appSettings, ...(state.userSettings[key].appSettings || {}) },
    folderSettings: { ...base.folderSettings, ...(state.userSettings[key].folderSettings || {}) },
    notificationSettings: { ...base.notificationSettings, ...(state.userSettings[key].notificationSettings || {}) },
    aiSettings: { ...base.aiSettings, ...(state.userSettings[key].aiSettings || {}) },
  };
  return state.userSettings[key];
}
function activeAppSettings() {
  return IS_V2 && sessionId ? userSettings().appSettings : state.appSettings;
}
function ui(th, en) { return activeAppSettings().language === "en" ? en : th; }

function currentUser() { return state.users.find(u => u.id === sessionId) || null; }
function byId(id) { return state.users.find(u => u.id === id); }
function userName(user) { return user ? (user.displayName || user.username || user.id) : "Unknown"; }
function isBlocked(a, b) {
  const ua = byId(a), ub = byId(b);
  return !!(ua?.blocked?.includes(b) || ub?.blocked?.includes(a));
}
function areFriends(a, b) { return state.friendships.some(p => p.includes(a) && p.includes(b)); }
function addFriendPair(a, b) { if (!areFriends(a, b)) state.friendships.push([a, b]); }
function removeFriendPair(a, b) { state.friendships = state.friendships.filter(p => !(p.includes(a) && p.includes(b))); }
function rawFolderNames() {
  const settings = IS_V2 && sessionId ? userSettings() : state;
  const deleted = new Set((settings.deletedFolders || []).filter(f => !DEFAULT_FOLDERS.includes(f)));
  return unique([...DEFAULT_FOLDERS, ...(settings.customFolders||[])]).filter(f => !deleted.has(f));
}
function folderNames() {
  return rawFolderNames()
    .sort((a, b) => (ensureFolderSetting(a).order ?? 999) - (ensureFolderSetting(b).order ?? 999) || a.localeCompare(b));
}
function ensureFolderSetting(f) {
  const settings = IS_V2 && sessionId ? userSettings() : state;
  if (!settings.folderSettings) settings.folderSettings = {};
  if (!settings.folderSettings[f]) settings.folderSettings[f] = {notify:true,bump:true,badge:true,highlight:true,order:rawFolderNames().indexOf(f)+1,keywords:""};
  settings.folderSettings[f] = {
    notify: true,
    bump: true,
    badge: true,
    highlight: true,
    order: rawFolderNames().indexOf(f) + 1,
    keywords: "",
    ...settings.folderSettings[f],
  };
  return settings.folderSettings[f];
}
function keywordList(value) {
  return String(value || "").split(/[,|\n]/).map(k => k.trim().toLowerCase()).filter(Boolean);
}
function classifyMessage(text) {
  const t = text.toLowerCase();
  if (keywordList(ensureFolderSetting("Advertising").keywords || AD_KEYWORDS.join(",")).some(k => t.includes(k))) return "advertising";
  if (keywordList(ensureFolderSetting("Important").keywords || IMPORTANT_KEYWORDS.join(",")).some(k => t.includes(k))) return "important";
  return "normal";
}
function foldersForMessage(text) {
  const t = text.toLowerCase();
  return folderNames().filter((folder) => {
    const keys = keywordList(ensureFolderSetting(folder).keywords);
    return keys.length && keys.some(k => t.includes(k));
  });
}
function chatName(chat) {
  if (chat.type === "group") return chat.name;
  const other = chat.members.find(id => id !== sessionId);
  return userName(byId(other));
}
function chatAvatar(chat) {
  if (chat.type === "group") return chat.photo;
  const other = chat.members.find(id => id !== sessionId);
  return byId(other)?.avatar || "";
}
function initials(name) { return (name||"T").slice(0,2).toUpperCase(); }
function visibleMessages(chat) { return chat.messages.filter(m => !m.hiddenFor?.includes(sessionId)); }
function latestMessage(chat) { return [...visibleMessages(chat)].reverse()[0] || null; }

function avatarHtml(src, name, extra="") {
  return `<span class="avatar ${extra}">${src?`<img src="${esc(src)}" alt="${esc(name)}" />`:(initials(name))}</span>`;
}
function fileIcon(name) {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext==="pdf") return "file-text";
  if (["doc","docx"].includes(ext)) return "file-type";
  if (["xls","xlsx"].includes(ext)) return "sheet";
  if (ext==="zip") return "archive";
  return "file";
}
function folderIcon(f) {
  return {Main:"message-circle",Important:"star",Advertising:"megaphone",Request:"inbox",Group:"users",Work:"briefcase-business",Study:"book-open",Friends:"smile",Family:"home"}[f]||"tag";
}
function statusText(msg, mine) {
  if (msg.readAt) return `${mine?"อ่านแล้ว":"อ่านแล้ว"} ${formatTime(msg.readAt)}`;
  if (msg.deliveredAt) return `ถึงแล้ว ${formatTime(msg.deliveredAt)}`;
  return `ส่งแล้ว ${formatTime(msg.createdAt)}`;
}

function ensureChatForUser(otherId) {
  let chat = state.chats.find(c => c.type==="direct" && c.members.includes(sessionId) && c.members.includes(otherId));
  if (!chat) {
    chat = { id:makeId("chat"), type:"direct", members:[sessionId,otherId],
      tags: areFriends(sessionId,otherId)?["Main"]:["Request"],
      unread:{}, importantUnread:{}, updatedAt:Date.now(), messages:[] };
    state.chats.push(chat);
  }
  return chat;
}

function filteredChats() {
  const user = currentUser(); if (!user) return [];
  return state.chats
    .filter(c => c.members.includes(user.id))
    .filter(c => !c.hiddenFor?.includes(user.id))
    .filter(c => !c.members.some(m => m!==user.id && isBlocked(user.id,m)))
    .filter(c => c.tags.includes(view.folder))
    .filter(c => {
      const q = view.search.trim().toLowerCase(); if (!q) return true;
      const txt = [chatName(c),...c.members.map(id=>byId(id)?.username||""),...c.messages.map(m=>m.text+(" "+( m.file?.name||"" )))].join(" ");
      return txt.toLowerCase().includes(q);
    })
    .sort((a,b) => {
      const pd = Number(b.pinnedFor?.includes(user.id)) - Number(a.pinnedFor?.includes(user.id));
      if (pd) return pd;
      return ensureFolderSetting(view.folder)?.bump ? b.updatedAt-a.updatedAt : a.id.localeCompare(b.id);
    });
}

function folderCounts() {
  const counts = Object.fromEntries(folderNames().map(f=>[f,{unread:0,important:0}]));
  for (const chat of state.chats) {
    if (!chat.members.includes(sessionId)||chat.hiddenFor?.includes(sessionId)) continue;
    for (const f of chat.tags) {
      if (!counts[f]) counts[f]={unread:0,important:0};
      counts[f].unread += chat.unread?.[sessionId]||0;
      counts[f].important += chat.importantUnread?.[sessionId]||0;
    }
  }
  return counts;
}

function canUseRemoteSync() {
  return location.protocol === "http:" || location.protocol === "https:";
}

async function pullRemoteState() {
  if (!canUseRemoteSync()) return false;
  if (pendingRemoteSave || remoteSaving) return false;
  try {
    const res = await fetch(`${API_BASE}/api/state`, { cache: "no-store" });
    if (!res.ok) throw new Error("remote unavailable");
    const data = await res.json();
    remoteAvailable = true;
    remoteStateVersion = data.version || remoteStateVersion;
    state = migrateStateIds(data.state || defaultState());
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    remoteAvailable = false;
    return false;
  }
}

function queueRemoteSave() {
  if (!canUseRemoteSync()) return;
  pendingRemoteSave = true;
  clearTimeout(remoteSaveTimer);
  remoteSaveTimer = setTimeout(pushRemoteState, 120);
}

async function pushRemoteState() {
  if (!canUseRemoteSync()) return;
  pendingRemoteSave = false;
  remoteSaving = true;
  try {
    const res = await fetch(`${API_BASE}/api/state`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: TAB_ID, state }),
    });
    if (!res.ok) throw new Error("remote save failed");
    const data = await res.json();
    remoteAvailable = true;
    remoteStateVersion = data.version || remoteStateVersion;
    state = migrateStateIds(data.state || state);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    broadcastStateChange();
    render();
  } catch {
    remoteAvailable = false;
  } finally {
    remoteSaving = false;
  }
}

async function remoteAuth(path, payload) {
  if (!canUseRemoteSync()) return null;
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, clientId: TAB_ID }),
    });
  } catch {
    remoteAvailable = false;
    return null;
  }
  remoteAvailable = true;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "ไม่สามารถเชื่อมต่อบัญชีได้");
  remoteStateVersion = data.version || remoteStateVersion;
  state = migrateStateIds(data.state || state);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  broadcastStateChange();
  return data.userId;
}

async function consumeLineSessionFromUrl() {
  const token = urlParams.get("lineSession");
  if (!token || !canUseRemoteSync()) return false;
  try {
    const res = await fetch(`${API_BASE}/api/auth/line/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, clientId: TAB_ID }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "LINE Login ไม่สำเร็จ");
    remoteAvailable = true;
    remoteStateVersion = data.version || remoteStateVersion;
    state = migrateStateIds(data.state || state);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    sessionId = data.userId;
    setStoredSession(sessionId);
    view._authUser=""; view._authPass="";
    view.screen="home";
    const clean = new URL(location.href);
    clean.searchParams.delete("lineSession");
    clean.searchParams.delete("apiBase");
    history.replaceState(null, "", clean.pathname + clean.search + clean.hash);
    broadcastStateChange();
    render();
    return true;
  } catch (error) {
    showAuthError(error.message || "LINE Login ไม่สำเร็จ");
    return false;
  }
}

function showLineErrorFromUrl() {
  const error = urlParams.get("lineError");
  if (!error) return;
  const clean = new URL(location.href);
  clean.searchParams.delete("lineError");
  history.replaceState(null, "", clean.pathname + clean.search + clean.hash);
  requestAnimationFrame(() => showAuthError(decodeURIComponent(error)));
}

function startRemoteRealtime() {
  if (!canUseRemoteSync()) return;
  if ("EventSource" in window) {
    const events = new EventSource(`${API_BASE}/api/events?clientId=${encodeURIComponent(TAB_ID)}`);
    events.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data || "{}");
        if (data.clientId !== TAB_ID && (!remoteStateVersion || data.version > remoteStateVersion)) {
          await pullRemoteState();
          syncFromSharedState({ fromRemote: true });
        }
      } catch {}
    };
  }
  setInterval(async () => {
    const before = remoteStateVersion;
    if (await pullRemoteState() && remoteStateVersion !== before) syncFromSharedState({ fromRemote: true });
  }, 3000);
}

// ─── Auth ─────────────────────────────────────────────────────
async function handleAuth(form, mode) {
  const data = new FormData(form);
  const username = String(data.get("username")||"").trim();
  const password = String(data.get("password")||"");
  if (!username) { showAuthError("กรุณากรอก Username"); return; }
  if (!password) { showAuthError("กรุณากรอก Password"); return; }
  if (mode === "login") {
    try {
      const remoteUserId = await remoteAuth("/api/auth/login", { username, password });
      if (remoteUserId) {
        sessionId = remoteUserId;
        setStoredSession(sessionId);
        view._authUser=""; view._authPass="";
        view.screen="home"; render(); return;
      }
    } catch (error) {
      if (remoteAvailable) { showAuthError(error.message); return; }
    }
    const user = state.users.find(u => u.username.toLowerCase()===username.toLowerCase() && u.password===password);
    if (!user) { showAuthError("Username หรือ Password ไม่ถูกต้อง"); return; }
    sessionId = user.id;
    setStoredSession(sessionId);
    view._authUser=""; view._authPass="";
    view.screen="home"; render(); return;
  }
  if (!/^[a-zA-Z0-9._]{3,}$/.test(username)) { showAuthError("Username ใช้ a-z 0-9 . _ อย่างน้อย 3 ตัว"); return; }
  if (password.length < 4) { showAuthError("Password ต้องมีอย่างน้อย 4 ตัวอักษร"); return; }
  const confirm = String(data.get("confirm")||"");
  if (password!==confirm) { showAuthError("Password ไม่ตรงกัน"); return; }
  if (state.users.some(u => u.username.toLowerCase()===username.toLowerCase())) { showAuthError("Username นี้ถูกใช้แล้ว"); return; }
  try {
    const remoteUserId = await remoteAuth("/api/auth/register", { username, password });
    if (remoteUserId) {
      sessionId = remoteUserId;
      setStoredSession(sessionId);
      view._authUser=""; view._authPass="";
      view.screen="home"; render(); return;
    }
  } catch (error) {
    if (remoteAvailable) { showAuthError(error.message); return; }
  }
  const newId = handleFromUsername(username);
  const user = { id:newId, username:username.toLowerCase(), displayName:username, password, avatar:"", blocked:[] };
  state.users.push(user);
  saveState();
  sessionId = newId;
  setStoredSession(sessionId);
  view._authUser=""; view._authPass="";
  view.screen="home"; render();
}

function showAuthError(msg) {
  const el = document.querySelector("#auth-error");
  if (el) { el.textContent=msg; el.classList.add("show"); }
}

async function handleLineLogin() {
  if (canUseRemoteSync()) {
    const returnTo = location.href;
    location.href = `${API_BASE}/api/auth/line/start?returnTo=${encodeURIComponent(returnTo)}`;
    return;
  }
  const profile = lineMockProfile();
  try {
    const remoteUserId = await remoteAuth("/api/auth/line", profile);
    if (remoteUserId) {
      sessionId = remoteUserId;
      setStoredSession(sessionId);
      view._authUser=""; view._authPass="";
      view.screen="home"; render(); return;
    }
  } catch (error) {
    if (remoteAvailable) { showAuthError(error.message); return; }
  }

  const username = lineUsernameFromId(profile.lineId);
  const userId = handleFromUsername(username);
  let user = state.users.find(u => u.lineId === profile.lineId || u.id === userId || u.username === username);
  if (!user) {
    user = { id:userId, username, displayName:profile.displayName || "LINE User", password:"line-login", avatar:"", blocked:[], lineId:profile.lineId, authProvider:"line" };
    state.users.push(user);
    saveState();
  }
  sessionId = user.id;
  setStoredSession(sessionId);
  view._authUser=""; view._authPass="";
  view.screen="home"; render();
}

// ─── Friend search ────────────────────────────────────────────
function doFriendSearch(raw) {
  const q = parseFriendQuery(raw);
  if (!q) return;
  const found = contactFromQuery(raw);
  if (!found) { view.addFriendResult="notfound"; return; }
  if (isBlocked(sessionId, found.id)) { view.addFriendResult="notfound"; return; }
  view.addFriendResult = found;
}

// ─── Message ──────────────────────────────────────────────────
function sendMessage(text, file) {
  const chat = state.chats.find(c=>c.id===view.chatId);
  if (!chat||(!text.trim()&&!file)) return;
  const recipients = chat.members.filter(m=>m!==sessionId);
  if (recipients.some(m=>isBlocked(sessionId,m))) { alert("ไม่สามารถส่งข้อความได้"); return; }
  const category = classifyMessage(`${text} ${file?.name||""}`);
  const now = Date.now();
  chat.messages.push({ id:makeId("msg"), senderId:sessionId, text:text.trim(), file,
    createdAt:now, deliveredAt:now+1000, readAt:null, hiddenFor:[], unsent:false, category,
    reminderSuggestion: IS_V2 && detectReminderText(`${text} ${file?.name||""}`) });
  chat.updatedAt = now;
  if (chat.tags.includes("Request")) { chat.tags=["Main"]; recipients.forEach(m=>addFriendPair(sessionId,m)); }
  if (category==="advertising") chat.tags=unique(["Advertising",...chat.tags.filter(t=>t!=="Important")]);
  if (category==="important"&&!chat.tags.includes("Advertising")) chat.tags=unique(["Important",...chat.tags]);
  chat.tags = unique([...foldersForMessage(`${text} ${file?.name||""}`), ...chat.tags]);
  if (chat.type==="group") chat.tags=unique(["Group",...chat.tags]);
  for (const m of recipients) {
    chat.unread[m]=(chat.unread[m]||0)+1;
    if (category==="important") chat.importantUnread[m]=(chat.importantUnread[m]||0)+1;
  }
  view.pendingFile=null; saveState(); render();
}

// ─── QR scanner ───────────────────────────────────────────────
async function startQrScanner() {
  const video = document.querySelector("#qr-video");
  if (!video||qrStream) return;
  if (!("BarcodeDetector" in window)) {
    const h = document.querySelector("#qr-scanner .hint");
    if (h) h.textContent="เบราว์เซอร์นี้ไม่รองรับ QR กล้อง กรุณาพิมพ์โค้ดแทน"; return;
  }
  try {
    qrStream = await navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"},audio:false});
    video.srcObject=qrStream; await video.play();
    const detector = new BarcodeDetector({formats:["qr_code"]});
    const scan = async () => {
      if (!view.scannerOpen||!qrStream) return;
      try {
        const codes = await detector.detect(video);
        if (codes.length&&codes[0].rawValue) { addFriendFromQr(codes[0].rawValue); return; }
      } catch {}
      qrScanTimer = setTimeout(scan,350);
    };
    scan();
  } catch {
    const h = document.querySelector("#qr-scanner .hint");
    if (h) h.textContent="ไม่สามารถเปิดกล้องได้";
  }
}
function stopQrScanner() {
  if (qrScanTimer) clearTimeout(qrScanTimer); qrScanTimer=null;
  if (qrStream) { qrStream.getTracks().forEach(t=>t.stop()); qrStream=null; }
}
function addFriendFromQr(code) {
  const other = contactFromQuery(code);
  if (!other||other.id===sessionId||isBlocked(sessionId,other.id)) { alert("ไม่พบผู้ใช้จาก QR นี้"); return; }
  view.qrInput=""; view.scannerOpen=false;
  stopQrScanner();
  addAndOpenFriend(other.id);
}

// ─── Render ───────────────────────────────────────────────────
function render() {
  const user = currentUser();
  if (!user) renderAuth(); else renderApp(user);
  requestAnimationFrame(() => {
    if (window.lucide) window.lucide.createIcons();
    setupCollapsingHeader();
    setupJumpLatestButton();
    if (view.scannerOpen) startQrScanner();
  });
}

function renderAuth() {
  const isReg = view.authMode==="register";
  app.innerHTML = `
<section class="auth-shell">
  <div class="auth-panel">
    <div class="brand"><div class="brand-mark">TT</div><div><h1>TaiTalk</h1><p>LINE style chat สำหรับเพื่อน กลุ่ม และข้อความสำคัญ</p></div></div>
    <div class="tabs">
      <button class="${isReg?"active":""}" data-action="auth-tab" data-mode="register">สมัครสมาชิก</button>
      <button class="${!isReg?"active":""}" data-action="auth-tab" data-mode="login">เข้าสู่ระบบ</button>
    </div>
    <form class="form" data-action="${isReg?"register":"login"}">
      <label class="field">Username<input name="username" value="${esc(view._authUser)}" autocomplete="username" required /></label>
      <label class="field">Password<input name="password" type="password" value="${esc(view._authPass)}" autocomplete="${isReg?"new-password":"current-password"}" required /></label>
      ${isReg?`<label class="field">ยืนยัน Password<input name="confirm" type="password" autocomplete="new-password" required /></label>`:""}
      <div class="error" id="auth-error"></div>
      <button class="primary" type="submit"><i data-lucide="${isReg?"user-plus":"log-in"}"></i>${isReg?"สมัครสมาชิก":"เข้าสู่ระบบ"}</button>
      <p class="hint">${isReg?"สมัครใหม่เพื่อเริ่มใช้งาน TaiTalk":"ใช้บัญชีที่สมัครไว้บนเครื่องนี้"}</p>
    </form>
    ${IS_VB1 ? `
    <div class="auth-divider"><span>หรือ</span></div>
    <button class="line-login" type="button" data-action="line-login"><i data-lucide="message-circle"></i>Login with LINE</button>
    <p class="hint">V.b1 ใช้ LINE Login จริงเมื่อ server ตั้งค่า LINE Channel แล้ว</p>
    ` : ""}
  </div>
</section>`;
}

function renderApp(user) {
  const chats = filteredChats();
  let selected = state.chats.find(c=>c.id===view.chatId&&c.members.includes(user.id)) || chats[0] || null;
  if (selected) view.chatId=selected.id;
  const appSettings = activeAppSettings();
  app.innerHTML = `
<section class="app-shell screen-${view.screen} theme-${appSettings.theme} font-${appSettings.fontSize} ${IS_V2 ? "app-v2" : ""}">
  ${renderRail(user)}
  ${renderHome()}
  ${renderChatList(chats)}
  ${selected?renderChat(selected):renderEmptyChat()}
  ${renderDetail(selected)}
  ${renderContentPage()}
  ${renderBottomNav()}
</section>
${renderModal()}
${renderScanner()}
${renderChatSettings(selected)}`;
}

function renderRail(user) {
  const counts = folderCounts();
  const showFolderList = view.screen === "list";
  return `
<aside class="rail">
  <div class="topbar">
    <button class="profile profile-button" data-action="detail-tab" data-tab="profile">
      ${avatarHtml(user.avatar, userName(user))}
      <div><strong>${esc(userName(user))}</strong><div class="small">${esc(user.id)}</div></div>
    </button>
    <div class="top-actions">
      <button class="icon-btn mobile-only" data-action="detail-tab" data-tab="people"><i data-lucide="user-plus"></i></button>
      <button class="icon-btn mobile-only" data-action="detail-tab" data-tab="notifications"><i data-lucide="bell"></i></button>
      <button class="icon-btn mobile-only" data-action="toggle-manage"><i data-lucide="list-checks"></i></button>
      <button class="icon-btn" data-action="logout"><i data-lucide="log-out"></i></button>
    </div>
  </div>
  <div class="search-wrap">
    <form class="global-search" data-action="do-chat-search">
      <i data-lucide="search"></i>
      <input name="q" value="${esc(view.search)}" placeholder="${ui("ค้นหาแชทหรือข้อความ","Search chats or messages")}" autocomplete="off" />
      <button type="submit" class="search-submit">${ui("ค้นหา","Search")}</button>
    </form>
  </div>
  ${showFolderList ? `
  <nav class="folder-list">
    ${folderNames().map(f => {
      const s=ensureFolderSetting(f), cnt=counts[f];
      const badge = s?.badge&&cnt.unread?`<span class="badge">${cnt.unread}</span>`:"";
      const imp = cnt.important?`<span class="badge important">!${cnt.important}</span>`:"";
      return `<button class="folder-btn${view.folder===f?" active":""}" data-action="folder" data-folder="${f}">
        <i data-lucide="${folderIcon(f)}"></i><span>${f}</span>${imp||badge}
      </button>`;
    }).join("")}
    <button class="folder-btn folder-add" data-action="detail-tab" data-tab="newFolder"><i data-lucide="folder-plus"></i><span>สร้าง</span></button>
  </nav>
  ` : ""}
</aside>`;
}

function renderBottomNav() {
  const items = IS_V2
    ? [["home","","home",ui("หน้าแรก","Home")],["list","chat","message-circle",ui("แชท","Chat")],["tools","aiSearch","sparkles","AI"],["tools","library","folder-open","Files"],["tools","settings","settings",ui("ตั้งค่า","Settings")]]
    : [["home","","home",ui("หน้าแรก","Home")],["list","chat","message-circle",ui("แชท","Chat")],["voom","","play-square","VOOM"],["today","","newspaper","Today"],["wallet","","wallet","Wallet"]];
  return `<nav class="bottom-nav">${items.map(([sc,tab,icon,label])=> {
    const isActive = view.screen === sc && (!tab || view.detailTab === tab);
    return `
    <button class="${isActive?"active":""}" data-action="bottom-nav" data-screen="${sc}" data-tab="${tab}">
      <i data-lucide="${icon}"></i><span>${label}</span>
    </button>`;
  }).join("")}</nav>`;
}

function renderHome() {
  const actions = IS_V2
    ? [["เพิ่มเพื่อน","user-plus","people"],["AI Search","sparkles","aiSearch"],["File Hub","folder-open","library"],["สรุปข่าววันนี้","newspaper","todaySummary"],["Reminder","alarm-clock","reminders"],["Priority","bell-ring","notifications"],["Privacy AI","shield","privacy"],["Settings","settings","settings"]]
    : [["เพิ่มเพื่อน","user-plus","people"],["สร้างกลุ่ม","users","groups"],["OpenChat","messages-square","coming"],["สร้าง Folder","folder-plus","newFolder"],["ตั้งค่า Folder","folder-cog","folders"],["Settings","settings","settings"],["คลังไฟล์","folder-open","library"],["Profile QR","qr-code","profile"]];
  const versionLabel = IS_VB1 ? "TaiTalk V.b1" : "TaiTalk V2";
  return `<section class="home-page">
  <div class="home-hero"><p>${IS_V2 ? versionLabel : "TaiTalk Home"}</p><h2>${IS_V2 ? "AI ช่วยจัดแชท ไฟล์ และแจ้งเตือน" : "ทุกอย่างของแชทอยู่ที่นี่"}</h2></div>
  ${IS_V2 ? renderOnboardingCard() : ""}
  <div class="quick-grid">${actions.map(([label,icon,tab])=>`
    <button data-action="${tab==="coming"?"coming-soon":"detail-tab"}" data-tab="${tab}" data-feature="${label}">
      <i data-lucide="${icon}"></i><span>${label}</span>
    </button>`).join("")}</div>
  <div class="home-card"><strong>${IS_V2 ? `ทำไมควรลอง ${versionLabel.replace("TaiTalk ","")}` : "LINE-style services"}</strong><p>${IS_V2 ? "เก็บไฟล์ไม่หมดอายุ, ค้นหาด้วย AI, สรุปแชท, privacy ต่อแชท และตั้งค่าส่วนตัวต่อบัญชี" : "Stickers, official accounts, games, coupons, mini apps"}</p></div>
</section>`;
}

function renderOnboardingCard() {
  if (!IS_V2 || userSettings().aiSettings.tutorialSeen) return "";
  const versionLabel = IS_VB1 ? "V.b1" : "V2";
  return `<div class="home-card onboarding-card">
    <strong>เริ่มต้น TaiTalk ${versionLabel}</strong>
    <p>${versionLabel} เพิ่ม Folder ส่วนตัว, File Hub, AI Search, AI Summary, Reminder และ Privacy Control</p>
    <div class="inline"><button class="primary" data-action="detail-tab" data-tab="tutorial">ดู Tutorial</button><button class="ghost" data-action="skip-tutorial">Skip</button></div>
  </div>`;
}

function renderContentPage() {
  if (view.screen==="voom") return `<section class="content-page"><div class="section-head"><strong>VOOM</strong></div><div class="feed">${["mali อัปโหลดรูปการบ้าน","narin แชร์ไอเดีย project","studyteam ลงโพสต์สรุปสอบ"].map(t=>`<article class="feed-card"><div class="feed-media"></div><strong>${esc(t)}</strong><p>โพสต์สั้นๆ แบบ social feed</p></article>`).join("")}</div></section>`;
  if (view.screen==="today") return `<section class="content-page"><div class="section-head"><strong>Today</strong></div><div class="feed">${["ข่าวเด่นวันนี้","งานและการเรียน","เทคโนโลยี","ไลฟ์สไตล์"].map(t=>`<article class="news-card"><span>Today</span><strong>${esc(t)}</strong><p>คอนเทนต์ประจำวัน</p></article>`).join("")}</div></section>`;
  if (view.screen==="wallet") return `<section class="content-page"><div class="wallet-card"><span>TaiPay Wallet</span><strong>฿ 0.00</strong><p>ยอดเงินพร้อมใช้</p></div><div class="quick-grid">${["เติมเงิน","โอนเงิน","จ่ายบิล","คูปอง","ประวัติ","บัตร"].map(l=>`<button data-action="coming-soon" data-feature="${l}"><i data-lucide="circle-dollar-sign"></i><span>${l}</span></button>`).join("")}</div></section>`;
  return "";
}

function renderChatList(chats) {
  return `<aside class="chat-list">
  <div class="section-head">
    <strong>${view.manageMode?"จัดการแชท":view.folder}</strong>
    <button class="icon-btn" data-action="toggle-manage"><i data-lucide="${view.manageMode?"x":"list-checks"}"></i></button>
  </div>
  ${view.manageMode?`<div class="bulk-bar">
    <span>${view.selectedChatIds.length} selected</span>
    <button class="mini" data-action="bulk-chat" data-bulk="pin">ปักหมุด</button>
    <button class="mini" data-action="bulk-chat" data-bulk="read">อ่านแล้ว</button>
    <button class="mini" data-action="bulk-chat" data-bulk="mute">ปิดแจ้งเตือน</button>
    <button class="mini" data-action="bulk-chat" data-bulk="hide">ซ่อน</button>
    <button class="mini danger" data-action="bulk-chat" data-bulk="delete">ลบ</button>
  </div>`:""}
  <div class="list-body">
    ${chats.length?chats.map(renderChatRow).join(""):`<p class="empty">ยังไม่มีแชทในโฟลเดอร์นี้</p>`}
  </div>
</aside>`;
}

function renderChatRow(chat) {
  const user = currentUser();
  const latest = latestMessage(chat);
  const unread = chat.unread?.[sessionId]||0;
  const important = chat.importantUnread?.[sessionId]||0;
  const highlight = ensureFolderSetting(view.folder)?.highlight&&unread?"highlight":"";
  const labels = [
    important?`<span class="label important">Important</span>`:"",
    chat.tags.includes("Advertising")?`<span class="label ad">Advertising</span>`:"",
    chat.type==="group"?`<span class="label">Group</span>`:"",
  ].join("");
  const ai = IS_V2 ? aiCategoryForChat(chat) : null;

  const isOpen = view.openSwipeChatId === chat.id;
  const openClass = isOpen ? (view.openSwipeDir === "left" ? "open-left" : "open-right") : "";
  const isPinned = chat.pinnedFor?.includes(user.id);
  const isMuted = chat.mutedFor?.includes(user.id);

  return `<div class="chat-swipe" data-chat-id="${chat.id}">
  <div class="swipe-actions left">
    <button class="btn-pin" data-action="chat-quick" data-quick="pin" data-chat="${chat.id}">
      <i data-lucide="${isPinned ? "pin-off" : "pin"}"></i>
      <span>${isPinned ? "ถอนหมุด" : "ปักหมุด"}</span>
    </button>
    <button class="btn-read" data-action="chat-quick" data-quick="read" data-chat="${chat.id}">
      <i data-lucide="check"></i>
      <span>อ่านแล้ว</span>
    </button>
  </div>
  <button class="chat-row${view.chatId===chat.id?" active":""} ${highlight} ${openClass}" data-action="${view.manageMode?"toggle-chat-select":"select-chat"}" data-chat="${chat.id}">
    ${view.manageMode?`<span class="check-dot${view.selectedChatIds.includes(chat.id)?" checked":""}"><i data-lucide="check"></i></span>`:""}
    ${avatarHtml(chatAvatar(chat),chatName(chat))}
    <span class="preview">
      <strong>${esc(chatName(chat))}</strong>
      <span class="small">${latest?esc(latest.unsent?"ยกเลิกข้อความแล้ว":latest.file?latest.file.name:latest.text):"เริ่มแชท"}</span>
      <span class="labels">${chat.pinnedFor?.includes(user.id)?`<span class="label">Pinned</span>`:""}${chat.mutedFor?.includes(user.id)?`<span class="label">Muted</span>`:""}${labels}${IS_V2?`<span class="label ${ai.category==="Private Chat"?"private":""}">${esc(ai.category)}</span>`:""}</span>
      ${IS_V2 ? `<span class="small ai-reason">${esc(ai.reason)}</span>` : ""}
    </span>
    <span><time>${latest?formatTime(latest.createdAt):""}</time>${unread?`<span class="badge">${unread}</span>`:""}</span>
  </button>
  <div class="swipe-actions right">
    <button class="btn-mute" data-action="chat-quick" data-quick="mute" data-chat="${chat.id}">
      <i data-lucide="${isMuted ? "bell" : "bell-off"}"></i>
      <span>${isMuted ? "เปิดเสียง" : "ปิดเสียง"}</span>
    </button>
    <button class="btn-hide" data-action="chat-quick" data-quick="hide" data-chat="${chat.id}">
      <i data-lucide="eye-off"></i>
      <span>ซ่อน</span>
    </button>
    <button class="btn-delete" data-action="chat-quick" data-quick="delete" data-chat="${chat.id}">
      <i data-lucide="trash-2"></i>
      <span>ลบ</span>
    </button>
  </div>
</div>`;
}

function renderChat(chat) {
  const messages = visibleMessages(chat);
  const otherId = chat.type === "direct" ? chat.members.find(id => id !== sessionId) : "";
  const aiActions = [["polish","sparkles"],["formal","briefcase-business"],["shorten","text-cursor-input"],["translate","languages"]];
  return `<section class="chat">
  <header class="chat-head">
    <div class="chat-title">
      <button class="icon-btn mobile-only" data-action="back-list"><i data-lucide="chevron-left"></i></button>
      ${avatarHtml(chatAvatar(chat),chatName(chat))}
      <div><strong>${esc(chatName(chat))}</strong><div class="small">${chat.type==="group"?`${chat.members.length} สมาชิก`:esc(byId(chat.members.find(id=>id!==sessionId))?.id||"")}</div></div>
    </div>
    <div class="chat-actions">
      ${otherId ? `<button class="mini" data-action="switch-side" data-chat="${chat.id}" data-user="${otherId}">สลับฝั่ง</button>` : ""}
      ${IS_V2 ? `<button class="mini" data-action="summarize-chat" data-chat="${chat.id}"><i data-lucide="sparkles"></i>สรุป</button>` : ""}
      <button class="icon-btn" data-action="call"><i data-lucide="phone"></i></button>
      <button class="icon-btn" data-action="call"><i data-lucide="video"></i></button>
      <button class="icon-btn" data-action="open-chat-settings"><i data-lucide="menu"></i></button>
    </div>
  </header>
  <div class="messages">
    <div class="dayline">วันนี้</div>
    ${IS_V2 && chat.summary ? `<div class="ai-summary-card"><strong>AI Summary</strong><pre>${esc(chat.summary)}</pre></div>` : ""}
    ${messages.length?messages.map(m=>renderMessage(chat,m)).join(""):`<p class="empty">ยังไม่มีข้อความ</p>`}
    ${IS_V2 && messages.length ? `<button class="jump-latest" data-action="jump-latest">กลับไปข้อความล่าสุด</button>` : ""}
  </div>
  <form class="composer" data-action="send-message">
    ${chat.tags.includes("Request")?`<p class="hint">ตอบกลับเพื่อย้ายแชทเข้า Main</p>`:""}
    <div class="pending-file${view.pendingFile?" show":""}">
      <span>${view.pendingFile?esc(view.pendingFile.name):""}</span>
      <button class="mini" type="button" data-action="clear-file">ล้าง</button>
    </div>
    <div class="composer-row">
      <label class="icon-btn"><i data-lucide="plus"></i><input type="file" data-action="file-input" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.zip" /></label>
      <button class="icon-btn" type="button" data-action="coming-soon" data-feature="กล้อง"><i data-lucide="camera"></i></button>
      <input name="message" data-action="composer-message" value="${esc(view.composerDraft)}" placeholder="พิมพ์ข้อความ" autocomplete="off" />
      <button class="icon-btn" type="button" data-action="${IS_V2?"ai-compose":"coming-soon"}" data-feature="Emoji"><i data-lucide="${IS_V2?"wand-sparkles":"smile"}"></i></button>
      <button class="send-btn" type="submit"><i data-lucide="send"></i></button>
    </div>
    ${IS_V2 && view.aiComposeOpen ? `<div class="ai-compose-popover">${aiActions.map(([mode,icon])=>`
      <button type="button" data-action="ai-compose-mode" data-mode="${mode}"><i data-lucide="${icon}"></i><span>${aiModeLabel(mode)}</span></button>
    `).join("")}</div>` : ""}
  </form>
</section>`;
}

function renderMessage(chat, msg) {
  const mine = msg.senderId===sessionId;
  const sender = byId(msg.senderId);
  const canUnsend = mine&&!msg.unsent&&(Date.now()-msg.createdAt)/36e5<=24;
  const cls = msg.category==="important"?"important":msg.category==="advertising"?"ad":"";
  return `<article class="message${mine?" mine":""}">
  ${chat.type==="group"&&!mine?`<span class="small">${esc(userName(sender))}</span>`:""}
  <div class="bubble${cls?" "+cls:""}">
    ${msg.unsent?`<span class="small">ยกเลิกข้อความแล้ว`:(esc(msg.text)+(msg.file?`<div class="file-chip">${msg.file.type?.startsWith("image/")&&msg.file.url?`<img src="${esc(msg.file.url)}" alt="${esc(msg.file.name)}" />`:`<i data-lucide="${fileIcon(msg.file.name)}"></i>`}<div><strong>${esc(msg.file.name)}</strong><div class="small">${esc(msg.file.type||"file")}</div></div></div>`:"")+`</span>`)}
    ${IS_V2 && (msg.translation || msg.translationLoading) ? `<div class="translation">${msg.translationLoading ? "กำลังแปล..." : `แปล: ${esc(msg.translation)}`}</div>` : ""}
  </div>
  ${IS_V2 && msg.reminderSuggestion ? `<div class="reminder-card"><strong>ตรวจพบนัดหมาย</strong><span>${esc(msg.text || msg.file?.name || "")}</span><button class="mini" data-action="create-reminder" data-chat="${chat.id}" data-message="${msg.id}">Create Reminder</button><button class="mini" data-action="ignore-reminder" data-chat="${chat.id}" data-message="${msg.id}">Ignore</button></div>` : ""}
  <div class="status">${statusText(msg,mine)}</div>
  ${!msg.unsent?`<div class="message-menu">
    <button class="mini" data-action="delete-self" data-chat="${chat.id}" data-message="${msg.id}">ลบฝั่งฉัน</button>
    ${IS_V2 ? `<button class="mini" data-action="translate-message" data-chat="${chat.id}" data-message="${msg.id}" ${msg.translationLoading?"disabled":""}>${msg.translationLoading?"กำลังแปล":"แปล"}</button>` : ""}
    ${canUnsend?`<button class="mini danger" data-action="unsend" data-chat="${chat.id}" data-message="${msg.id}">ลบทั้งสองฝั่ง</button>`:""}
  </div>`:""}
</article>`;
}

function renderEmptyChat() {
  return `<section class="chat"><div class="messages empty-state"><p class="empty">ยังไม่มีแชท</p><button class="primary" data-action="detail-tab" data-tab="people"><i data-lucide="user-plus"></i>ค้นหาเพื่อน</button></div></section>`;
}

function renderDetail(selected) {
  const showTabs = ["people","groups","profile"].includes(view.detailTab);
  return `<aside class="detail">
  <div class="section-head">
    <button class="icon-btn mobile-only" data-action="back-list"><i data-lucide="chevron-left"></i></button>
    <strong>${{people:"Friends",groups:"Group",notifications:"Priority Center",settings:"Settings",profile:"Profile",folders:"Folder Settings",newFolder:"Create Folder",library:"File Hub",aiSearch:"AI Search",reminders:"Reminders",privacy:"AI Privacy",tutorial:"Tutorial",todaySummary:"AI Summary"}[view.detailTab]||"จัดการ"}</strong>
  </div>
  ${showTabs?`<div class="detail-tabs"><div class="segmented">
    <button class="${view.detailTab==="people"?"active":""}" data-action="detail-tab" data-tab="people">เพื่อน</button>
    <button class="${view.detailTab==="groups"?"active":""}" data-action="detail-tab" data-tab="groups">กลุ่ม</button>
    <button class="${view.detailTab==="profile"?"active":""}" data-action="detail-tab" data-tab="profile">โปรไฟล์</button>
  </div></div>`:""}
  <div class="panel">${detailPanel(selected)}</div>
</aside>`;
}

function detailPanel(selected) {
  if (view.detailTab==="groups")        return groupPanel(selected);
  if (view.detailTab==="profile")       return profilePanel();
  if (view.detailTab==="notifications") return notificationsPanel();
  if (view.detailTab==="settings")      return settingsPanel();
  if (view.detailTab==="folders")       return folderSettingsPanel();
  if (view.detailTab==="newFolder")     return createFolderPanel();
  if (view.detailTab==="library")       return libraryPanel();
  if (view.detailTab==="aiSearch")      return aiSearchPanel();
  if (view.detailTab==="reminders")     return remindersPanel();
  if (view.detailTab==="privacy")       return privacyPanel();
  if (view.detailTab==="tutorial")      return tutorialPanel();
  if (view.detailTab==="todaySummary")  return todaySummaryPanel();
  return peoplePanel(selected);
}

// ─── People panel ─────────────────────────────────────────────
function peoplePanel(selected) {
  const user = currentUser();
  const currentOther = selected?.type==="direct"?selected.members.find(id=>id!==sessionId):null;
  const friends = state.users.filter(u => u.id!==sessionId && areFriends(user.id, u.id));
  const suggested = state.users.filter(u => u.id!==sessionId && !areFriends(user.id, u.id) && !isBlocked(user.id, u.id));

  // ผล search
  let resultHtml = "";
  if (view.addFriendResult==="notfound") {
    resultHtml = `<div class="add-friend-notfound"><i data-lucide="user-x"></i> ไม่พบผู้ใช้ "${esc(view.addFriendQuery)}"</div>`;
  } else if (view.addFriendResult && typeof view.addFriendResult==="object") {
    const f = view.addFriendResult;
    const isMe = f.id===sessionId;
    const alreadyFriend = areFriends(user.id, f.id);
    resultHtml = `<div class="add-friend-card">
      ${avatarHtml(f.avatar, userName(f), "add-friend-avatar")}
      <div class="add-friend-info"><strong>${esc(userName(f))}</strong><span>${esc(f.id)}</span></div>
      ${isMe
        ? `<span class="label">นี่คือคุณ</span>`
        : alreadyFriend
        ? `<button class="ghost" data-action="open-user-chat" data-user="${f.id}"><i data-lucide="message-circle"></i>แชท</button>`
        : `<button class="primary add-friend-btn" data-action="do-add-friend" data-user="${f.id}"><i data-lucide="user-plus"></i>เพิ่มเพื่อน</button>`}
    </div>`;
  }

  return `<div class="stack">
  <div class="block">
    <h3>เพื่อนทั้งหมด (${friends.length})</h3>
    ${friends.length ? friends.map(f=>`
    <div class="friend-card">
      ${avatarHtml(f.avatar,userName(f))}
      <div><strong>${esc(userName(f))}</strong><div class="small">${esc(f.id)}</div></div>
      <button class="ghost" data-action="open-user-chat" data-user="${f.id}"><i data-lucide="message-circle"></i>แชท</button>
      <button class="mini danger" data-action="remove-friend" data-user="${f.id}">ลบ</button>
    </div>`).join("") : `<p class="empty">ยังไม่มีเพื่อน เพิ่มด้วย @username หรือรายชื่อแนะนำด้านล่าง</p>`}
  </div>
  <div class="block">
    <h3>เพิ่มเพื่อนด้วย @username</h3>
    <p class="hint">พิมพ์ @mali หรือ username แล้วกดค้นหา</p>
    <form class="add-friend-search" data-action="do-search-friend">
      <div class="add-friend-input-row">
        <span class="at-prefix">@</span>
        <input class="add-friend-input" name="q" placeholder="@username" autocomplete="off" spellcheck="false" />
      </div>
      <button class="primary" type="submit"><i data-lucide="search"></i>ค้นหา</button>
    </form>
    ${resultHtml}
  </div>
  <div class="block">
    <h3>รายการเพื่อนแบบย่อ</h3>
    ${friends.length ? friends.map(f=>`
    <div class="result-row">
      ${avatarHtml(f.avatar,userName(f))}
      <div><strong>${esc(userName(f))}</strong><div class="small">${esc(f.id)}</div></div>
      <button class="mini danger" data-action="remove-friend" data-user="${f.id}">ลบ</button>
    </div>`).join("") : `<p class="empty">ยังไม่มีเพื่อน</p>`}
  </div>
  <div class="block">
    <h3>เพิ่มจากรายชื่อแนะนำ</h3>
    ${suggested.length ? suggested.map(f=>`
    <div class="result-row">
      ${avatarHtml(f.avatar,userName(f))}
      <div><strong>${esc(userName(f))}</strong><div class="small">${esc(f.id)}</div></div>
      <button class="primary" data-action="do-add-friend" data-user="${f.id}"><i data-lucide="user-plus"></i>เพิ่ม</button>
    </div>`).join("") : `<p class="empty">ไม่มีรายชื่อแนะนำ</p>`}
  </div>
  ${currentOther?`<div class="block"><h3>${esc(userName(byId(currentOther)))}</h3>
    <button class="ghost danger" data-action="block-user" data-user="${currentOther}"><i data-lucide="ban"></i>บล็อกผู้ใช้นี้</button>
  </div>`:""}
  <div class="block">
    <h3>เพิ่มด้วย QR Code</h3>
    <div class="qr-tools">
      ${renderQr(user)}
      <div class="stack">
        <button class="ghost" data-action="copy-id"><i data-lucide="copy"></i>คัดลอก @username</button>
        <button class="ghost" data-action="open-scanner"><i data-lucide="camera"></i>สแกน QR</button>
      </div>
    </div>
  </div>
</div>`;
}

function renderQr(user) {
  const code = `TAITALK:${user.id}:${user.username}`;
  return `<div class="qr-card"><img class="qr-image" src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=10&data=${encodeURIComponent(code)}" alt="${esc(code)}" /><code>${esc(code)}</code></div>`;
}

// ─── Profile panel ────────────────────────────────────────────
function profilePanel() {
  const user = currentUser();
  const dn = userName(user);
  return `<div class="stack">
  <div class="profile-cover">${avatarHtml(user.avatar,dn,"profile-avatar")}<h2>${esc(dn)}</h2><p class="profile-id">${esc(user.id)}</p></div>
  <div class="block">
    <h3>รูปโปรไฟล์</h3>
    <label class="profile-upload">${avatarHtml(user.avatar,dn)}<span><i data-lucide="image-plus"></i>เปลี่ยนรูป</span><input type="file" data-action="profile-avatar" accept="image/*" /></label>
  </div>
  <div class="block">
    <h3>ชื่อที่แสดง</h3>
    <form class="inline" data-action="save-displayname">
      <input name="displayname" value="${esc(dn)}" placeholder="ชื่อที่แสดง" autocomplete="off" />
      <button class="primary" type="submit"><i data-lucide="save"></i>บันทึก</button>
    </form>
    <p class="hint">ชื่อที่เพื่อนเห็น เปลี่ยนได้ตลอดเวลา</p>
  </div>
  <div class="block">
    <h3>TaiTalk Username</h3>
    <div class="profile-id-row"><code class="id-badge">${esc(user.id)}</code><button class="ghost" data-action="copy-id"><i data-lucide="copy"></i>คัดลอก</button></div>
    <p class="hint">@username นี้ใช้ให้เพื่อนค้นหาคุณ เปลี่ยนไม่ได้</p>
  </div>
  <div class="block"><h3>QR Code</h3>${renderQr(user)}<button class="primary full" data-action="copy-id"><i data-lucide="share-2"></i>แชร์ @username</button></div>
</div>`;
}

function notificationsPanel() {
  const requests = state.chats.filter(c=>c.members.includes(sessionId)&&c.tags.includes("Request"));
  const important = state.chats.filter(c=>c.members.includes(sessionId)&&(c.importantUnread?.[sessionId]||0)>0);
  const priority = IS_V2 ? state.chats.filter(c=>c.members.includes(sessionId) && (userSettings().chatPriority?.[c.id]==="high" || c.tags.includes("Important"))) : [];
  return `<div class="stack">
  ${IS_V2 ? `<div class="block"><h3>Priority Center</h3><p class="hint">รวม deadline, ประกาศ, ข้อความสำคัญ และแชท priority สูง</p></div>${priority.map(c=>`<button class="notification-card" data-action="select-chat" data-chat="${c.id}">${avatarHtml(chatAvatar(c),chatName(c))}<span><strong>Priority</strong><span>${esc(chatName(c))} · ${esc(aiCategoryForChat(c).reason)}</span></span><time>${formatTime(c.updatedAt)}</time></button>`).join("")}` : ""}
  ${requests.map(c=>`<button class="notification-card" data-action="select-chat" data-chat="${c.id}">${avatarHtml(chatAvatar(c),chatName(c))}<span><strong>คำขอข้อความ</strong><span>${esc(chatName(c))}</span></span><time>${formatTime(c.updatedAt)}</time></button>`).join("")}
  ${important.map(c=>`<button class="notification-card" data-action="select-chat" data-chat="${c.id}">${avatarHtml(chatAvatar(c),chatName(c))}<span><strong>Important</strong><span>${esc(chatName(c))}</span></span><time>${formatTime(c.updatedAt)}</time></button>`).join("")}
  ${!requests.length&&!important.length&&!priority.length?`<div class="block"><p class="empty">ยังไม่มีแจ้งเตือน</p></div>`:""}
</div>`;
}

function groupPanel(selected) {
  const group = selected?.type==="group"?selected:null;
  const available = state.users.filter(u=>u.id!==sessionId&&!group?.members.includes(u.id)&&!isBlocked(sessionId,u.id));
  return `<div class="stack">
  <div class="block"><h3>สร้างกลุ่ม</h3>
    <div class="inline">
      <input value="${esc(view.groupDraft)}" data-action="group-draft" placeholder="ชื่อกลุ่ม" />
      <button class="ghost" data-action="create-group"><i data-lucide="plus"></i></button>
    </div>
  </div>
  ${group?`<div class="block"><h3>${esc(group.name)}</h3>
    <label class="field">ชื่อกลุ่ม<input value="${esc(group.name)}" data-action="group-name" /></label>
    <label class="field">URL รูปกลุ่ม<input value="${esc(group.photo||"")}" data-action="group-photo" placeholder="https://..." /></label>
    <button class="primary" data-action="save-group" data-chat="${group.id}"><i data-lucide="save"></i>บันทึก</button>
    </div>
    <div class="block"><h3>สมาชิก</h3>
    ${group.members.map(mid=>`<div class="result-row"><span>${esc(userName(byId(mid)))} <span class="small">${mid}</span></span>${mid!==sessionId?`<button class="mini danger" data-action="remove-member" data-chat="${group.id}" data-user="${mid}">ลบ</button>`:""}</div>`).join("")}
    <label class="field">เพิ่มสมาชิก<select data-action="group-member-draft"><option value="">เลือกผู้ใช้</option>${available.map(u=>`<option value="${u.id}">${esc(userName(u))} (${u.id})</option>`).join("")}</select></label>
    <button class="ghost" data-action="add-member" data-chat="${group.id}"><i data-lucide="user-plus"></i>เพิ่ม</button>
    </div>`:`<div class="block"><p class="empty">เลือกกลุ่มเพื่อแก้ไข</p></div>`}
</div>`;
}

function settingsPanel() {
  const appSettings = activeAppSettings();
  const settings = IS_V2 ? userSettings() : null;
  return `<div class="stack"><div class="block"><h3>${ui("การแสดงผล","Appearance")}</h3>
  <label class="field">${ui("ภาษา","Language")}<select data-action="language"><option value="th" ${appSettings.language==="th"?"selected":""}>ไทย</option><option value="en" ${appSettings.language==="en"?"selected":""}>English</option></select></label>
  <label class="field">${ui("ขนาดตัวหนังสือ","Font size")}<select data-action="font-size"><option value="small" ${appSettings.fontSize==="small"?"selected":""}>เล็ก</option><option value="normal" ${appSettings.fontSize==="normal"?"selected":""}>ปกติ</option><option value="large" ${appSettings.fontSize==="large"?"selected":""}>ใหญ่</option></select></label>
  <label class="switch-row"><span>${ui("ธีมมืด","Dark mode")}</span><input type="checkbox" ${appSettings.theme==="dark"?"checked":""} data-action="theme-toggle" /></label>
</div><div class="block"><h3>โฟลเดอร์</h3><button class="primary full" data-action="detail-tab" data-tab="folders"><i data-lucide="folder-cog"></i>ตั้งค่าโฟลเดอร์</button></div>
${IS_V2 ? `<div class="block"><h3>AI Settings</h3>
  <label class="switch-row"><span>เปิด AI Features</span><input type="checkbox" ${settings.aiSettings.enabled?"checked":""} data-action="ai-setting" data-key="enabled" /></label>
  <label class="switch-row"><span>AI จัดหมวดอัตโนมัติ</span><input type="checkbox" ${settings.aiSettings.autoCategorize?"checked":""} data-action="ai-setting" data-key="autoCategorize" /></label>
  <button class="ghost full" data-action="detail-tab" data-tab="privacy"><i data-lucide="shield"></i>Privacy Settings</button>
  <button class="ghost full" data-action="detail-tab" data-tab="tutorial"><i data-lucide="circle-help"></i>ดู Tutorial อีกครั้ง</button>
</div><div class="block"><h3>Backup / Restore</h3><button class="ghost full" data-action="export-backup"><i data-lucide="download"></i>Export Backup</button><label class="ghost full"><i data-lucide="upload"></i>Import Backup<input type="file" data-action="import-backup" accept="application/json" /></label><p class="hint">Backup mock จะ export state ทั้งหมดเป็น JSON</p></div>` : ""}</div>`;
}

function folderSettingsPanel() {
  const folders = folderNames();
  return `<div class="stack">
  <div class="block">
    <div class="folders-header-row">
      <h3>โฟลเดอร์ทั้งหมด</h3>
      <button class="icon-btn mini-add-btn" data-action="toggle-folder-create-inline" title="สร้างโฟลเดอร์">
        <i data-lucide="folder-plus"></i>
      </button>
    </div>
    
    ${view.showNewFolderInput ? `
    <div class="inline folder-create-inline">
      <input value="${esc(view.newFolderName || "")}" data-action="new-folder-name" placeholder="ชื่อ Folder" autofocus />
      <button class="primary" data-action="create-folder"><i data-lucide="check"></i></button>
    </div>
    ` : ""}

    <div class="folder-sort-list" id="folder-sort-container">
      ${folders.map(name => {
        return `
        <div class="folder-sort-item" data-folder="${esc(name)}">
          <div class="folder-sort-handle">
            <i data-lucide="grip-vertical"></i>
            <span class="folder-sort-name">${esc(name)}</span>
          </div>
          <div class="folder-sort-actions">
            <button class="icon-btn mini-settings-btn" data-action="edit-folder-settings" data-folder="${esc(name)}">
              <i data-lucide="settings"></i>
            </button>
          </div>
        </div>
        `;
      }).join("")}
    </div>
  </div>
  
  ${view.editingFolder ? renderFolderEditModal(view.editingFolder) : ""}
</div>`;
}

function renderFolderEditModal(f) {
  const s = ensureFolderSetting(f);
  return `
  <div class="modal-backdrop show" id="folder-edit-modal">
    <div class="modal folder-edit-modal">
      <div class="section-head modal-head">
        <strong>ตั้งค่าโฟลเดอร์: ${esc(f)}</strong>
        <button class="icon-btn" data-action="close-folder-edit"><i data-lucide="x"></i></button>
      </div>
      <div class="stack modal-body" style="text-align: left; margin-top: 14px; gap: 8px;">
        <label class="switch-row">
          <span>แจ้งเตือนโฟลเดอร์นี้</span>
          <input type="checkbox" ${s.notify?"checked":""} data-action="folder-setting" data-folder="${esc(f)}" data-key="notify" />
        </label>
        <label class="switch-row">
          <span>ดันแชทขึ้นบนเมื่อมีข้อความใหม่</span>
          <input type="checkbox" ${s.bump?"checked":""} data-action="folder-setting" data-folder="${esc(f)}" data-key="bump" />
        </label>
        <label class="switch-row">
          <span>แสดง Badge จำนวนข้อความ</span>
          <input type="checkbox" ${s.badge?"checked":""} data-action="folder-setting" data-folder="${esc(f)}" data-key="badge" />
        </label>
        <label class="switch-row">
          <span>Highlight ข้อความใหม่</span>
          <input type="checkbox" ${s.highlight?"checked":""} data-action="folder-setting" data-folder="${esc(f)}" data-key="highlight" />
        </label>
        <label class="field" style="display: flex; flex-direction: column; gap: 6px; margin-top: 10px;">
          <span>Detect keywords เพื่อเข้าโฟลเดอร์นี้อัตโนมัติ</span>
          <textarea data-action="folder-keywords" data-folder="${esc(f)}" placeholder="เช่น homework, งาน, นัด" style="min-height: 80px; padding: 8px; border: 1px solid var(--line); border-radius: 6px; resize: vertical;">${esc(s.keywords||"")}</textarea>
        </label>
        <p class="hint" style="margin-top: -4px;">คั่นคำด้วย comma หรือขึ้นบรรทัดใหม่ เช่น Important และ Advertising</p>
        
        <div class="modal-actions" style="margin-top: 16px; display: flex; justify-content: space-between; align-items: center;">
          ${DEFAULT_FOLDERS.includes(f) 
            ? `<span class="label">Default folder</span>` 
            : `<button class="ghost danger" data-action="delete-folder" data-folder="${esc(f)}"><i data-lucide="trash-2"></i>ลบโฟลเดอร์นี้</button>`}
          <button class="primary" data-action="close-folder-edit" style="min-width: 80px;">ตกลง</button>
        </div>
      </div>
    </div>
  </div>`;
}

function createFolderPanel() {
  return `<div class="stack"><div class="block"><h3>สร้าง Folder ใหม่</h3>
  <div class="inline"><input value="${esc(view.newFolderName)}" data-action="new-folder-name" placeholder="ชื่อ Folder" /><button class="primary" data-action="create-folder"><i data-lucide="folder-plus"></i></button></div>
  </div><div class="block"><h3>Folder ของฉัน</h3>
  ${folderNames().map(f=>`<div class="result-row"><span>${esc(f)}</span>${DEFAULT_FOLDERS.includes(f)?`<span class="label">Default</span>`:`<button class="mini danger" data-action="delete-folder" data-folder="${f}">ลบ</button>`}</div>`).join("")}
  </div></div>`;
}

function libraryPanel() {
  const files = state.chats.filter(c=>c.members.includes(sessionId)).flatMap(c=>visibleMessages(c).filter(m=>m.file).map(m=>({c,m})));
  const photos = files.filter(({m})=>m.file.type?.startsWith("image/"));
  if (IS_V2) {
    const all = allFiles();
    const pinned = new Set(userSettings().pinnedFiles || []);
    return `<div class="stack">
      <div class="media-summary"><div><strong>${all.length}</strong><span>All Files</span></div><div><strong>${[...pinned].length}</strong><span>Pinned</span></div></div>
      <div class="block"><h3>File Hub</h3><input data-action="file-search" placeholder="ค้นหาไฟล์ ชื่อแชท วิชา วันที่" /><p class="hint">ไฟล์ใน mock นี้ไม่หมดอายุ และรวมจากทุกแชท</p></div>
      <div class="block"><h3>ไฟล์ทั้งหมด</h3>${all.length ? all.map(({chat,message,file})=>`<div class="file-hub-row"><i data-lucide="${fileIcon(file.name)}"></i><span><strong>${esc(file.name)}</strong><span class="small">${esc(chatName(chat))} · ${formatTime(message.createdAt)} · ${fileTypeLabel(file)}</span></span><button class="mini" data-action="pin-file" data-file="${esc(message.id)}">${pinned.has(message.id)?"Unpin":"Pin"}</button></div>`).join("") : `<div class="empty-state"><i data-lucide="folder-open"></i><p class="empty">ยังไม่มีไฟล์ ส่งไฟล์ในแชทแล้วจะมาอยู่ที่นี่</p></div>`}</div>
    </div>`;
  }
  return `<div class="stack">
  <div class="media-summary"><div><strong>${photos.length}</strong><span>Photos</span></div><div><strong>${files.length}</strong><span>Files</span></div></div>
  <div class="block"><h3>รูปทั้งหมด</h3><div class="photo-grid">${photos.length?photos.map(({m})=>`<img src="${esc(m.file.url)}" alt="${esc(m.file.name)}" />`).join(""):`<p class="empty">ยังไม่มีรูป</p>`}</div></div>
  <div class="block"><h3>ไฟล์ทั้งหมด</h3>${files.length?files.map(({c,m})=>`<button class="result-row result-button" data-action="select-chat" data-chat="${c.id}"><span><strong>${esc(m.file.name)}</strong><span class="small">${esc(chatName(c))}</span></span><i data-lucide="${fileIcon(m.file.name)}"></i></button>`).join(""):`<p class="empty">ยังไม่มีไฟล์</p>`}</div>
</div>`;
}

function aiSearchPanel() {
  const q = view.search.trim().toLowerCase();
  const chatResults = q ? state.chats.filter(c=>c.members.includes(sessionId) && `${chatName(c)} ${visibleMessages(c).map(m=>m.text+" "+(m.file?.name||"")).join(" ")}`.toLowerCase().includes(q)) : [];
  const fileResults = q ? allFiles().filter(({chat,file})=>`${chatName(chat)} ${file.name} ${fileTypeLabel(file)}`.toLowerCase().includes(q)) : [];
  return `<div class="stack">
    <div class="block"><h3>AI Search</h3><form class="inline" data-action="do-chat-search"><input name="q" value="${esc(view.search)}" placeholder="เช่น ไฟล์งาน marketing อยู่ไหน" /><button class="primary"><i data-lucide="search"></i></button></form><p class="hint">รองรับ keyword และคำถามธรรมชาติแบบ mock</p></div>
    <div class="block"><h3>ผลลัพธ์แชท</h3>${chatResults.length?chatResults.map(c=>`<button class="result-row result-button" data-action="select-chat" data-chat="${c.id}"><span><strong>${esc(chatName(c))}</strong><span class="small">${esc(aiCategoryForChat(c).reason)}</span></span><i data-lucide="message-circle"></i></button>`).join(""):`<p class="empty">พิมพ์คำค้นหาเพื่อหาแชท</p>`}</div>
    <div class="block"><h3>ผลลัพธ์ไฟล์</h3>${fileResults.length?fileResults.map(({chat,message,file})=>`<button class="result-row result-button" data-action="select-chat" data-chat="${chat.id}"><span><strong>${esc(file.name)}</strong><span class="small">${esc(chatName(chat))} · ${formatTime(message.createdAt)} · ${fileTypeLabel(file)}</span></span><i data-lucide="${fileIcon(file.name)}"></i></button>`).join(""):`<p class="empty">ยังไม่พบไฟล์ที่ตรงคำค้นหา</p>`}</div>
  </div>`;
}

function remindersPanel() {
  const reminders = userSettings().reminders || [];
  return `<div class="stack"><div class="block"><h3>Smart Reminder</h3><p class="hint">AI mock จะตรวจคำอย่าง พรุ่งนี้, ส่งงาน, deadline, นัด, เวลา</p></div>
  <div class="block">${reminders.length?reminders.map(r=>`<div class="result-row"><span><strong>${esc(r.text)}</strong><span class="small">${esc(r.chatName)} · ${formatTime(r.createdAt)}</span></span><span class="label">Reminder</span></div>`).join(""):`<p class="empty">ยังไม่มี Reminder</p>`}</div></div>`;
}

function privacyPanel() {
  const settings = userSettings();
  const chats = state.chats.filter(c=>c.members.includes(sessionId));
  return `<div class="stack"><div class="block"><h3>AI Privacy</h3><p class="hint">AI วิเคราะห์ชื่อแชท ข้อความล่าสุด ชื่อไฟล์ และ keyword เพื่อช่วยจัดหมวด ค้นหา สรุป และแปล ผู้ใช้ปิดแยกต่อแชทได้</p>
  <label class="switch-row"><span>เปิด AI Features</span><input type="checkbox" ${settings.aiSettings.enabled?"checked":""} data-action="ai-setting" data-key="enabled" /></label>
  <label class="switch-row"><span>Auto Translation ค่าเริ่มต้น</span><input type="checkbox" ${settings.aiSettings.autoTranslate?"checked":""} data-action="ai-setting" data-key="autoTranslate" /></label></div>
  <div class="block"><h3>ปิด AI รายแชท</h3>${chats.length?chats.map(c=>`<label class="switch-row"><span>${esc(chatName(c))}<span class="small">${chatAiDisabled(c)?"Private Chat":"AI วิเคราะห์ได้"}</span></span><input type="checkbox" ${chatAiDisabled(c)?"checked":""} data-action="chat-ai-disabled" data-chat="${c.id}" /></label>`).join(""):`<p class="empty">ยังไม่มีแชท</p>`}</div></div>`;
}

function tutorialPanel() {
  return `<div class="stack"><div class="block"><h3>TaiTalk V2 Tutorial</h3><p class="hint">คู่มือสั้นสำหรับฟีเจอร์ใหม่</p></div>
  ${["Folder ส่วนตัวต่อบัญชี","File Hub รวมไฟล์ไม่หมดอายุ","AI Search ค้นหาด้วยคำถาม","AI Summary สรุปแชทและข่าว","Reminder จับ deadline จากข้อความ","Privacy ปิด AI รายแชท"].map((t,i)=>`<div class="block tutorial-step"><span class="label">${i+1}</span><strong>${t}</strong><p class="hint">แตะปุ่มใน Home หรือ Settings เพื่อใช้งานซ้ำได้ทุกเมื่อ</p></div>`).join("")}
  <button class="primary full" data-action="skip-tutorial">เข้าใจแล้ว</button></div>`;
}

function todaySummaryPanel() {
  const important = state.chats.filter(c=>c.members.includes(sessionId)).flatMap(c=>visibleMessages(c).filter(m=>m.category==="important").map(m=>({c,m}))).slice(-8);
  return `<div class="stack"><div class="block"><h3>สรุปข่าววันนี้</h3><p class="hint">Mock AI Summary จาก important messages และไฟล์ล่าสุด</p></div>
  <div class="ai-summary-card"><strong>Today Summary</strong><pre>• Important: ${important.length} รายการ\n• Deadline: ตรวจจากคำว่า วันนี้/พรุ่งนี้/ส่งงาน\n• File: มีไฟล์ใน File Hub ${allFiles().length} ไฟล์\n• To-do: เช็ก Priority Center และ Reminder</pre></div></div>`;
}

function renderModal() {
  return `<div class="modal-backdrop" id="modal"><div class="modal"><h2>ฟีเจอร์นี้ยังไม่พร้อม</h2><p class="hint">จะเปิดใช้งานในเวอร์ชันถัดไป</p><div class="modal-actions"><button class="primary" data-action="close-modal">ตกลง</button></div></div></div>`;
}
function renderScanner() {
  return `<div class="modal-backdrop${view.scannerOpen?" show":""}" id="qr-scanner"><div class="modal scanner-modal"><h2>สแกน QR Code</h2><div class="scanner-frame"><video id="qr-video" playsinline muted></video><div class="scan-corners"></div></div><p class="hint">${esc(view.scannerStatus)}</p><label class="field">หรือพิมพ์ @username<input value="${esc(view.qrInput)}" data-action="qr-input" placeholder="@mali" /></label><div class="modal-actions"><button class="ghost" data-action="close-scanner">ปิด</button><button class="primary" data-action="add-by-qr">เพิ่มเพื่อน</button></div></div></div>`;
}
function renderChatSettings(chat) {
  if (!chat || !view.chatSettingsOpen) return "";
  const otherId = chat.type === "direct" ? chat.members.find(id => id !== sessionId) : "";
  const q = view.chatSearch.trim().toLowerCase();
  const results = q ? visibleMessages(chat).filter(m => `${m.text || ""} ${m.file?.name || ""}`.toLowerCase().includes(q)) : [];
  const photos = chatPhotos(chat);
  const files = chatFiles(chat);
  const muted = chat.mutedFor?.includes(sessionId);
  return `<div class="modal-backdrop show"><div class="modal chat-settings-modal">
    <div class="section-head modal-head">
      <strong>ตั้งค่าแชท</strong>
      <button class="icon-btn" data-action="close-chat-settings"><i data-lucide="x"></i></button>
    </div>
    <div class="stack">
      <div class="block">
        <h3>${esc(chatName(chat))}</h3>
        <div class="inline">
          <button class="ghost" data-action="toggle-mute-chat" data-chat="${chat.id}"><i data-lucide="${muted ? "bell" : "bell-off"}"></i>${muted ? "เปิดเสียง" : "ปิดเสียง"}</button>
          <button class="ghost" data-action="open-invite" data-chat="${chat.id}"><i data-lucide="user-plus"></i>เชิญ</button>
          ${otherId ? `<button class="ghost danger" data-action="block-user" data-user="${otherId}"><i data-lucide="ban"></i>บล็อก</button>` : ""}
        </div>
      </div>
      ${IS_V2 ? `<div class="block">
        <h3>AI Controls</h3>
        <p class="hint">${esc(aiCategoryForChat(chat).reason)}</p>
        <label class="switch-row"><span>ปิด AI สำหรับแชทนี้</span><input type="checkbox" ${chatAiDisabled(chat)?"checked":""} data-action="chat-ai-disabled" data-chat="${chat.id}" /></label>
        <label class="switch-row"><span>Auto Translation</span><input type="checkbox" ${userSettings().chatAutoTranslate?.[chat.id]?"checked":""} data-action="chat-auto-translate" data-chat="${chat.id}" /></label>
        <label class="field">Priority<select data-action="chat-priority" data-chat="${chat.id}">${["normal","low","high"].map(v=>`<option value="${v}" ${userSettings().chatPriority?.[chat.id]===v?"selected":""}>${v}</option>`).join("")}</select></label>
        <label class="field">แก้หมวดเอง<select data-action="chat-category" data-chat="${chat.id}">${["Friends","Family","Study","Work","Important","Advertising","Private Chat"].map(v=>`<option value="${v}" ${aiCategoryForChat(chat).category===v?"selected":""}>${v}</option>`).join("")}</select></label>
      </div>` : ""}
      <div class="block">
        <h3>ค้นหาในแชท</h3>
        <input value="${esc(view.chatSearch)}" data-action="chat-settings-search" placeholder="ค้นหาข้อความหรือชื่อไฟล์" />
        ${q ? (results.length ? results.map(m => `<button class="result-row result-button" data-action="jump-message" data-message="${m.id}"><span><strong>${esc(m.file?.name || m.text || "ข้อความ")}</strong><span class="small">${formatTime(m.createdAt)}</span></span><i data-lucide="search"></i></button>`).join("") : `<p class="empty">ไม่พบข้อความ</p>`) : `<p class="hint">พิมพ์คำที่ต้องการค้นหา</p>`}
      </div>
      <div class="block">
        <h3>รูปที่เคยส่ง</h3>
        <div class="photo-grid">${photos.length ? photos.map(m => `<img src="${esc(m.file.url)}" alt="${esc(m.file.name)}" />`).join("") : `<p class="empty">ยังไม่มีรูป</p>`}</div>
      </div>
      <div class="block">
        <h3>ไฟล์ที่เคยส่ง</h3>
        ${files.length ? files.map(m => `<div class="result-row"><span><strong>${esc(m.file.name)}</strong><span class="small">${formatTime(m.createdAt)}</span></span><i data-lucide="${fileIcon(m.file.name)}"></i></div>`).join("") : `<p class="empty">ยังไม่มีไฟล์</p>`}
      </div>
    </div>
  </div></div>`;
}

// ─── Collapsing header ────────────────────────────────────────
function setupCollapsingHeader() {
  const shell = document.querySelector(".app-shell"); if (!shell) return;
  const topbar = document.querySelector(".topbar");
  if (topbar&&!topbar.dataset.peekBound) {
    topbar.dataset.peekBound="true";
    topbar.addEventListener("click", e=>{
      if (e.target.closest("[data-action]")) return;
      if (shell.classList.contains("header-compact")) shell.classList.toggle("folder-peek");
    });
  }
  document.querySelectorAll(".home-page,.content-page,.list-body,.panel,.messages").forEach(el=>{
    el.addEventListener("scroll",()=>{
      const compact=el.scrollTop>24;
      shell.classList.toggle("header-compact",compact);
      if (!compact) shell.classList.remove("folder-peek");
    },{passive:true});
  });
}

function setupJumpLatestButton() {
  const messages = document.querySelector(".chat .messages");
  const button = document.querySelector(".jump-latest");
  if (!messages || !button) return;
  const update = () => {
    const distanceFromBottom = messages.scrollHeight - messages.clientHeight - messages.scrollTop;
    button.classList.toggle("show", distanceFromBottom > 96);
  };
  update();
  messages.addEventListener("scroll", update, { passive: true });
  requestAnimationFrame(update);
}

// ─── Event listeners ──────────────────────────────────────────
app.addEventListener("submit", e => {
  e.preventDefault();
  const action = e.target.dataset.action;

  if (action==="register"||action==="login") {
    handleAuth(e.target, action);
  }
  if (action==="send-message") {
    const input = e.target.elements.message;
    sendMessage(input.value, view.pendingFile);
    view.aiComposeOpen = false;
    view.composerDraft = "";
    input.value = "";
  }
  if (action==="do-search-friend") {
    const input = e.target.querySelector(".add-friend-input");
    const q = (input?.value || "").trim();
    view.addFriendQuery = q;
    doFriendSearch(q);
    render();
  }
  if (action==="save-displayname") {
    const next = e.target.elements.displayname?.value.trim();
    if (!next) return;
    currentUser().displayName = next;
    saveState(); render();
  }
  if (action==="do-chat-search") {
    view.search = e.target.elements.q?.value || "";
    view.screen = "list"; view.manageMode = false;
    render();
  }
});

app.addEventListener("input", e => {
  const action = e.target.dataset.action;
  // เก็บค่าไว้แต่ไม่ render — ทุก field ที่ไม่ต้อง live update
  if (action==="new-folder-name") view.newFolderName = e.target.value;
  if (action==="group-draft")     view.groupDraft     = e.target.value;
  if (action==="group-member-draft") view.groupMemberDraft = e.target.value;
  if (action==="qr-input")        view.qrInput        = e.target.value;
  if (action==="composer-message") view.composerDraft = e.target.value;
  if (action==="chat-settings-search") { view.chatSearch = e.target.value; render(); }
  if (action==="folder-order") {
    ensureFolderSetting(e.target.dataset.folder).order = Math.max(1, Number(e.target.value || 1));
    saveState();
  }
  if (action==="folder-keywords") {
    ensureFolderSetting(e.target.dataset.folder).keywords = e.target.value;
    saveState();
  }
  if (action==="auth-tab-user")   view._authUser      = e.target.value;
  if (action==="auth-tab-pass")   view._authPass      = e.target.value;
});

app.addEventListener("change", e => {
  const action = e.target.dataset.action;
  if (action==="profile-avatar") {
    const file = e.target.files?.[0]; if (!file||!file.type.startsWith("image/")) return;
    const r = new FileReader(); r.onload=()=>{ currentUser().avatar=r.result; saveState(); render(); }; r.readAsDataURL(file);
  }
  if (action==="file-input") {
    const file = e.target.files?.[0]; if (!file) return;
    const ok = file.type.startsWith("image/")||/\.(pdf|docx?|xlsx?|zip)$/i.test(file.name);
    if (!ok) { alert("รองรับ รูปภาพ PDF Word Excel ZIP"); return; }
    const r = new FileReader(); r.onload=()=>{ view.pendingFile={name:file.name,type:file.type||"file",url:r.result}; render(); }; r.readAsDataURL(file);
  }
  if (action==="folder-setting") {
    ensureFolderSetting(e.target.dataset.folder)[e.target.dataset.key]=e.target.checked;
    saveState(); render();
  }
  if (action==="folder-setting-target") {
    view.folderSettingTarget = e.target.value;
    render();
  }
  if (action==="font-size")    { activeAppSettings().fontSize=e.target.value; saveState(); render(); }
  if (action==="language")     { activeAppSettings().language=e.target.value; saveState(); render(); }
  if (action==="theme-toggle") { activeAppSettings().theme=e.target.checked?"dark":"light"; saveState(); render(); }
  if (action==="group-member-draft") { view.groupMemberDraft=e.target.value; }
  if (action==="ai-setting") { userSettings().aiSettings[e.target.dataset.key]=e.target.checked; saveState(); render(); }
  if (action==="chat-ai-disabled") { userSettings().chatAiDisabled[e.target.dataset.chat]=e.target.checked; saveState(); render(); }
  if (action==="chat-auto-translate") { userSettings().chatAutoTranslate[e.target.dataset.chat]=e.target.checked; saveState(); render(); }
  if (action==="chat-priority") { userSettings().chatPriority[e.target.dataset.chat]=e.target.value; saveState(); render(); }
  if (action==="chat-category") {
    userSettings().chatCategories[e.target.dataset.chat]=e.target.value;
    userSettings().chatAiReasons[e.target.dataset.chat]="ผู้ใช้แก้หมวดเอง AI mock จดจำการแก้ไขนี้";
    const chat=state.chats.find(c=>c.id===e.target.dataset.chat);
    if (chat && !chat.tags.includes(e.target.value)) chat.tags=unique([e.target.value,...chat.tags]);
    saveState(); render();
  }
  if (action==="import-backup") {
    const file=e.target.files?.[0]; if (!file) return;
    const r=new FileReader(); r.onload=()=>{ try { state=JSON.parse(r.result); saveState(); render(); } catch { alert("ไฟล์ backup ไม่ถูกต้อง"); } }; r.readAsText(file);
  }
});

app.addEventListener("click", e => {
  if (window.isDraggingEvent) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  const t = e.target.closest("[data-action]"); if (!t) return;
  const action = t.dataset.action;

  if (action==="auth-tab") {
    const uEl = document.querySelector(".form [name='username']");
    const pEl = document.querySelector(".form [name='password']");
    view._authUser = uEl?.value||""; view._authPass = pEl?.value||"";
    view.authMode = t.dataset.mode; render();
  }
  if (action==="line-login") {
    handleLineLogin();
  }
  if (action==="logout") {
    sessionId=null; clearStoredSession();
    view.screen="home"; view.authMode="register"; render();
  }
  if (action==="folder") {
    view.folder=t.dataset.folder; view.chatId=null; view.screen="list"; view.manageMode=false; render();
  }
  if (action==="bottom-nav") {
    view.screen=t.dataset.screen; if (t.dataset.tab) view.detailTab=t.dataset.tab; view.manageMode=false; render();
  }
  if (action==="toggle-manage") { view.screen="list"; view.manageMode=!view.manageMode; view.selectedChatIds=[]; render(); }
  if (action==="toggle-chat-select") {
    const id=t.dataset.chat;
    view.selectedChatIds=view.selectedChatIds.includes(id)?view.selectedChatIds.filter(x=>x!==id):[...view.selectedChatIds,id];
    render();
  }
  if (action==="bulk-chat") {
    const type=t.dataset.bulk;
    for (const chat of state.chats.filter(c=>view.selectedChatIds.includes(c.id))) {
      if (type==="pin")  chat.pinnedFor=unique([...(chat.pinnedFor||[]),sessionId]);
      if (type==="mute") chat.mutedFor=unique([...(chat.mutedFor||[]),sessionId]);
      if (type==="hide"||type==="delete") chat.hiddenFor=unique([...(chat.hiddenFor||[]),sessionId]);
      if (type==="read") { chat.unread[sessionId]=0; chat.importantUnread[sessionId]=0; chat.messages.forEach(m=>{if(m.senderId!==sessionId&&!m.readAt)m.readAt=Date.now();}); }
    }
    view.selectedChatIds=[]; view.manageMode=false; saveState(); render();
  }
  if (action==="chat-quick") {
    const chat=state.chats.find(c=>c.id===t.dataset.chat&&c.members.includes(sessionId));
    const type=t.dataset.quick;
    if (chat) {
      if (type==="pin") {
        const pinned=chat.pinnedFor?.includes(sessionId);
        chat.pinnedFor=pinned ? (chat.pinnedFor||[]).filter(id=>id!==sessionId) : unique([...(chat.pinnedFor||[]),sessionId]);
      }
      if (type==="mute") {
        const muted=chat.mutedFor?.includes(sessionId);
        chat.mutedFor=muted ? (chat.mutedFor||[]).filter(id=>id!==sessionId) : unique([...(chat.mutedFor||[]),sessionId]);
      }
      if (type==="hide"||type==="delete") chat.hiddenFor=unique([...(chat.hiddenFor||[]),sessionId]);
      if (type==="read") { chat.unread[sessionId]=0; chat.importantUnread[sessionId]=0; chat.messages.forEach(m=>{if(m.senderId!==sessionId&&!m.readAt)m.readAt=Date.now();}); }
      view.openSwipeChatId = null;
      view.openSwipeDir = null;
      saveState(); render();
    }
  }
  if (action==="select-chat") {
    view.chatId=t.dataset.chat; view.screen="chat";
    view.openSwipeChatId = null;
    view.openSwipeDir = null;
    const chat=state.chats.find(c=>c.id===view.chatId);
    if (chat) { chat.unread[sessionId]=0; chat.importantUnread[sessionId]=0; chat.messages.forEach(m=>{if(m.senderId!==sessionId&&!m.readAt)m.readAt=Date.now();}); saveState(); }
    render();
  }
  if (action==="open-chat-settings") { view.chatSettingsOpen=true; view.chatSearch=""; render(); }
  if (action==="close-chat-settings") { view.chatSettingsOpen=false; view.chatSearch=""; render(); }
  if (action==="summarize-chat") {
    const chat=state.chats.find(c=>c.id===t.dataset.chat);
    if (chat) {
      const input={ title: chatName(chat), messages: visibleMessages(chat).slice(-30).map(m=>m.text||m.file?.name||"").join("\n") };
      aiRequest("summary", input).then(result=>{ chat.summary=result.text; saveState(); render(); });
    }
  }
  if (action==="ai-compose-mode") {
    const form=t.closest("form");
    const input=form?.elements?.message;
    if (input) {
      const mode=t.dataset.mode;
      const payload = mode === "translate"
        ? { mode, text: input.value, target: translateTargetForText(input.value) }
        : { mode, text: input.value };
      t.disabled = true;
      t.classList.add("loading");
      aiRequest(mode==="translate"?"translate":"rewrite", payload).then(result=>{
        input.value=result.text;
        view.composerDraft=result.text;
        view.aiComposeOpen=false;
        document.querySelector(".ai-compose-popover")?.remove();
        input.focus();
      });
    }
  }
  if (action==="toggle-mute-chat") {
    const chat=state.chats.find(c=>c.id===t.dataset.chat);
    if (chat) {
      const muted=chat.mutedFor?.includes(sessionId);
      chat.mutedFor=muted ? (chat.mutedFor||[]).filter(id=>id!==sessionId) : unique([...(chat.mutedFor||[]),sessionId]);
      saveState(); render();
    }
  }
  if (action==="open-invite") {
    const chat=state.chats.find(c=>c.id===t.dataset.chat);
    if (chat?.type==="direct") {
      const otherId=chat.members.find(id=>id!==sessionId);
      const other=byId(otherId);
      const group={id:makeId("group"),type:"group",name:`${userName(currentUser())}, ${userName(other)}`,photo:"",members:unique([sessionId,otherId]),tags:["Group"],unread:{},importantUnread:{},updatedAt:Date.now(),messages:[]};
      state.chats.push(group); view.chatSettingsOpen=false; view.folder="Group"; view.chatId=group.id; view.screen="chat"; saveState(); render();
    } else if (chat?.type==="group") {
      view.chatSettingsOpen=false; view.detailTab="groups"; view.screen="tools"; render();
    }
  }
  if (action==="jump-message") {
    view.chatSettingsOpen=false; view.chatSearch=""; render();
  }
  if (action==="jump-latest") {
    document.querySelector(".messages")?.scrollTo({ top: document.querySelector(".messages")?.scrollHeight || 0, behavior: "smooth" });
  }
  if (action==="detail-tab") {
    if (t.classList.contains("profile-button")&&document.querySelector(".app-shell")?.classList.contains("header-compact")) {
      document.querySelector(".app-shell")?.classList.toggle("folder-peek"); return;
    }
    view.detailTab=t.dataset.tab; view.screen="tools"; view.manageMode=false; render();
  }
  if (action==="back-list") { view.screen="list"; render(); }
  if (action==="call"||action==="coming-soon") { document.querySelector("#modal")?.classList.add("show"); }
  if (action==="ai-compose") {
    view.composerDraft = t.closest("form")?.elements?.message?.value || view.composerDraft;
    view.aiComposeOpen=!view.aiComposeOpen;
    render();
  }
  if (action==="close-modal") { document.querySelector("#modal")?.classList.remove("show"); }
  if (action==="skip-tutorial") { userSettings().aiSettings.tutorialSeen=true; saveState(); render(); }
  if (action==="open-scanner") { view.scannerOpen=true; view.scannerStatus="กำลังเตรียมกล้อง..."; render(); }
  if (action==="close-scanner") { view.scannerOpen=false; stopQrScanner(); render(); }
  if (action==="add-by-qr") { addFriendFromQr(view.qrInput); }
  if (action==="clear-file") { view.pendingFile=null; render(); }
  if (action==="copy-id") {
    const code=currentUser()?.id||"";
    navigator.clipboard?.writeText(code).then(()=>alert("คัดลอก @username แล้ว: "+code))||window.prompt("TaiTalk Username",code);
  }
  if (action==="switch-side") {
    switchToChatMember(t.dataset.chat, t.dataset.user);
  }
  if (action==="do-add-friend") {
    addAndOpenFriend(t.dataset.user);
  }
  if (action==="open-user-chat") {
    const chat=ensureChatForUser(t.dataset.user);
    view.folder=chat.tags.includes("Request")?"Request":"Main";
    view.chatId=chat.id; view.screen="chat"; view.manageMode=false;
    saveState(); render();
  }
  if (action==="block-user") {
    const user=currentUser(); user.blocked=unique([...(user.blocked||[]),t.dataset.user]);
    state.chats=state.chats.filter(c=>!(c.type==="direct"&&c.members.includes(sessionId)&&c.members.includes(t.dataset.user)));
    view.chatSettingsOpen=false; view.chatId=null; saveState(); render();
  }
  if (action==="remove-friend") {
    removeFriendPair(sessionId, t.dataset.user);
    render();
    saveState();
  }
  if (action==="delete-self") {
    const chat=state.chats.find(c=>c.id===t.dataset.chat);
    const msg=chat?.messages.find(m=>m.id===t.dataset.message);
    if (msg) { msg.hiddenFor=unique([...(msg.hiddenFor||[]),sessionId]); saveState(); render(); }
  }
  if (action==="unsend") {
    const chat=state.chats.find(c=>c.id===t.dataset.chat);
    const msg=chat?.messages.find(m=>m.id===t.dataset.message);
    if (msg&&(Date.now()-msg.createdAt)/36e5<=24) { msg.unsent=true; msg.text=""; msg.file=null; saveState(); render(); }
  }
  if (action==="translate-message") {
    const chat=state.chats.find(c=>c.id===t.dataset.chat);
    const msg=chat?.messages.find(m=>m.id===t.dataset.message);
    const text = msg?.text || msg?.file?.name || "";
    if (msg) {
      msg.translationLoading = true;
      saveState(); render();
      aiRequest("translate", { text, target: translateTargetForText(text) }).then(result=>{
        const latestChat=state.chats.find(c=>c.id===t.dataset.chat);
        const latestMsg=latestChat?.messages.find(m=>m.id===t.dataset.message);
        if (!latestMsg) return;
        latestMsg.translation=result.text;
        latestMsg.translationLoading=false;
        saveState(); render();
      });
    }
  }
  if (action==="create-reminder" || action==="ignore-reminder") {
    const chat=state.chats.find(c=>c.id===t.dataset.chat);
    const msg=chat?.messages.find(m=>m.id===t.dataset.message);
    if (msg) {
      if (action==="create-reminder") userSettings().reminders=unique([...(userSettings().reminders||[]), { id: makeId("rem"), text: msg.text || msg.file?.name || "Reminder", chatId: chat.id, chatName: chatName(chat), createdAt: Date.now() }]);
      msg.reminderSuggestion=false; saveState(); render();
    }
  }
  if (action==="pin-file") {
    const settings=userSettings();
    const id=t.dataset.file;
    settings.pinnedFiles=(settings.pinnedFiles||[]).includes(id) ? settings.pinnedFiles.filter(x=>x!==id) : unique([...(settings.pinnedFiles||[]),id]);
    saveState(); render();
  }
  if (action==="export-backup") {
    const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a"); a.href=url; a.download=`taitalk-backup-${Date.now()}.json`; a.click(); URL.revokeObjectURL(url);
  }
  if (action==="create-folder") {
    const name=view.newFolderName.trim(); if (!name) return;
    if (folderNames().some(f=>f.toLowerCase()===name.toLowerCase())) { alert("มี Folder นี้แล้ว"); return; }
    const settings = IS_V2 && sessionId ? userSettings() : state;
    settings.customFolders=unique([...(settings.customFolders||[]),name]);
    settings.deletedFolders=(settings.deletedFolders||[]).filter(x=>x!==name);
    settings.folderSettings[name]={notify:true,bump:true,badge:true,highlight:true,order:rawFolderNames().length,keywords:""};
    view.newFolderName=""; view.folder=name; view.folderSettingTarget=name;
    view.showNewFolderInput = false;
    saveState(); render();
  }
  if (action==="delete-folder") {
    const f=t.dataset.folder;
    if (DEFAULT_FOLDERS.includes(f)) return;
    const settings = IS_V2 && sessionId ? userSettings() : state;
    settings.customFolders=(settings.customFolders||[]).filter(x=>x!==f);
    settings.deletedFolders=unique([...(settings.deletedFolders||[]),f]);
    delete settings.folderSettings[f];
    state.chats.forEach(c=>{ c.tags=c.tags.filter(x=>x!==f); if(!c.tags.length)c.tags=["Main"]; });
    if (view.folder===f) view.folder="Main";
    if (view.folderSettingTarget===f) view.folderSettingTarget="Main";
    view.editingFolder = null;
    saveState(); render();
  }
  if (action==="edit-folder-settings") {
    view.editingFolder = t.dataset.folder;
    render();
  }
  if (action==="close-folder-edit") {
    view.editingFolder = null;
    render();
  }
  if (action==="toggle-folder-create-inline") {
    view.showNewFolderInput = !view.showNewFolderInput;
    view.newFolderName = "";
    render();
  }
  if (action==="create-group") {
    const name=view.groupDraft.trim(); if (!name) return;
    const chat={id:makeId("group"),type:"group",name,photo:"",members:[sessionId],tags:["Group"],unread:{},importantUnread:{},updatedAt:Date.now(),messages:[]};
    state.chats.push(chat); view.groupDraft=""; view.folder="Group"; view.chatId=chat.id; view.screen="chat"; saveState(); render();
  }
  if (action==="save-group") {
    const chat=state.chats.find(c=>c.id===t.dataset.chat);
    const nameEl=document.querySelector("[data-action='group-name']");
    const photoEl=document.querySelector("[data-action='group-photo']");
    if (chat) { chat.name=nameEl?.value.trim()||chat.name; chat.photo=photoEl?.value.trim()||""; saveState(); render(); }
  }
  if (action==="add-member") {
    const chat=state.chats.find(c=>c.id===t.dataset.chat);
    if (chat&&view.groupMemberDraft) { chat.members=unique([...chat.members,view.groupMemberDraft]); view.groupMemberDraft=""; saveState(); render(); }
  }
  if (action==="remove-member") {
    const chat=state.chats.find(c=>c.id===t.dataset.chat);
    if (chat) { chat.members=chat.members.filter(id=>id!==t.dataset.user); saveState(); render(); }
  }
  if (action==="group-draft") { /* input handled above */ }
  if (action==="language") { state.appSettings.language=t.dataset.value||state.appSettings.language; saveState(); render(); }
});

function syncFromSharedState({ fromRemote = false } = {}) {
  if (!fromRemote) state = loadState();
  if (sessionId && !currentUser()) {
    sessionId = null;
    clearStoredSession();
  }
  if (view.chatId && !state.chats.some(c => c.id === view.chatId && c.members.includes(sessionId))) {
    view.chatId = null;
  }
  render();
}

let syncTimer = null;
function scheduleSharedSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncFromSharedState, 30);
}

if ("BroadcastChannel" in window) {
  syncChannel = new BroadcastChannel(SYNC_CHANNEL);
  syncChannel.onmessage = (event) => {
    if (event.data?.type === "state-updated" && event.data.source !== TAB_ID) scheduleSharedSync();
  };
}

// --- Swipe-to-reveal click-and-drag logic ---
let dragStart = null;
let activeRow = null;
let dragLimitLeft = 140; // width of left actions
let dragLimitRight = 210; // width of right actions
let dragThreshold = 5;
let isDraggingRow = false;
let currentTransformX = 0;

function handleDragStart(e) {
  if (view.manageMode) return;

  // Clear existing open state if clicking outside the open row or its container
  if (view.openSwipeChatId) {
    const clickedSwipe = e.target.closest('.chat-swipe');
    if (!clickedSwipe || clickedSwipe.dataset.chatId !== view.openSwipeChatId) {
      view.openSwipeChatId = null;
      view.openSwipeDir = null;
      render();

      window.isDraggingEvent = true;
      setTimeout(() => {
        window.isDraggingEvent = false;
      }, 50);

      dragStart = null;
      activeRow = null;
      return;
    } else {
      // Clicking on the same swiped open row's chat-row body
      if (e.target.closest('.chat-row') && !e.target.closest('.swipe-actions')) {
        view.openSwipeChatId = null;
        view.openSwipeDir = null;
        render();

        window.isDraggingEvent = true;
        setTimeout(() => {
          window.isDraggingEvent = false;
        }, 50);

        dragStart = null;
        activeRow = null;
        return;
      }
    }
  }

  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;

  const row = e.target.closest('.chat-row');
  if (!row) return;

  if (e.target.closest('.swipe-actions')) return;

  const chatSwipe = row.closest('.chat-swipe');
  if (!chatSwipe) return;

  activeRow = row;
  dragStart = { x: clientX, y: clientY };
  isDraggingRow = false;

  currentTransformX = 0;
  if (row.classList.contains('open-left')) {
    currentTransformX = dragLimitLeft;
  } else if (row.classList.contains('open-right')) {
    currentTransformX = -dragLimitRight;
  }
}

function handleDragMove(e) {
  if (!dragStart || !activeRow) return;

  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;

  const dx = clientX - dragStart.x;
  const dy = clientY - dragStart.y;

  if (!isDraggingRow) {
    if (Math.abs(dx) > dragThreshold && Math.abs(dx) > Math.abs(dy)) {
      isDraggingRow = true;
      window.isDraggingEvent = true;
      activeRow.classList.add('dragging');
    }
  }

  if (isDraggingRow) {
    let targetX = currentTransformX + dx;

    if (targetX > dragLimitLeft) {
      targetX = dragLimitLeft + (targetX - dragLimitLeft) * 0.25;
    } else if (targetX < -dragLimitRight) {
      targetX = -dragLimitRight + (targetX + dragLimitRight) * 0.25;
    }

    activeRow.style.transform = `translateX(${targetX}px)`;

    if (e.cancelable) e.preventDefault();
  }
}

function handleDragEnd(e) {
  if (!dragStart || !activeRow) {
    dragStart = null;
    activeRow = null;
    return;
  }

  const clientX = e.changedTouches ? e.changedTouches[0].clientX : e.clientX;
  const dx = clientX - dragStart.x;
  const finalX = currentTransformX + dx;
  const chatSwipe = activeRow.closest('.chat-swipe');
  const chatId = chatSwipe ? chatSwipe.dataset.chatId : null;

  activeRow.classList.remove('dragging');

  if (isDraggingRow) {
    let targetState = 'closed';

    if (finalX > 70) {
      targetState = 'left';
    } else if (finalX < -70) {
      targetState = 'right';
    }

    if (targetState === 'left') {
      view.openSwipeChatId = chatId;
      view.openSwipeDir = 'left';
    } else if (targetState === 'right') {
      view.openSwipeChatId = chatId;
      view.openSwipeDir = 'right';
    } else {
      view.openSwipeChatId = null;
      view.openSwipeDir = null;
    }

    render();

    setTimeout(() => {
      window.isDraggingEvent = false;
    }, 50);
  }

  dragStart = null;
  activeRow = null;
}

document.addEventListener('mousedown', handleDragStart, { passive: false });
document.addEventListener('mousemove', handleDragMove, { passive: false });
document.addEventListener('mouseup', handleDragEnd);

document.addEventListener('touchstart', handleDragStart, { passive: false });
document.addEventListener('touchmove', handleDragMove, { passive: false });
document.addEventListener('touchend', handleDragEnd);
document.addEventListener('touchcancel', handleDragEnd);

// --- Folder Reordering Drag & Drop ---
let activeSortItem = null;
let sortContainer = null;
let sortStartY = 0;
let sortStartClientY = 0;

function handleSortStart(e) {
  if (e.target.closest('.mini-settings-btn') || e.target.closest('button')) return;

  const item = e.target.closest('.folder-sort-item');
  if (!item) return;

  const container = item.closest('#folder-sort-container');
  if (!container) return;

  activeSortItem = item;
  sortContainer = container;
  sortStartY = item.offsetTop;
  sortStartClientY = e.clientY;

  activeSortItem.classList.add('sorting');
  
  if (e.pointerId !== undefined) {
    activeSortItem.setPointerCapture(e.pointerId);
  }
}

function handleSortMove(e) {
  if (!activeSortItem || !sortContainer) return;

  const clientY = e.clientY;
  const dy = clientY - sortStartClientY;

  activeSortItem.style.transform = `translateY(${dy}px)`;

  const prev = activeSortItem.previousElementSibling;
  if (prev && prev.classList.contains('folder-sort-item')) {
    const prevRect = prev.getBoundingClientRect();
    const prevMiddle = prevRect.top + prevRect.height / 2;
    if (clientY < prevMiddle) {
      sortContainer.insertBefore(activeSortItem, prev);
      sortStartClientY -= prevRect.height;
      activeSortItem.style.transform = `translateY(${clientY - sortStartClientY}px)`;
      return;
    }
  }

  const next = activeSortItem.nextElementSibling;
  if (next && next.classList.contains('folder-sort-item')) {
    const nextRect = next.getBoundingClientRect();
    const nextMiddle = nextRect.top + nextRect.height / 2;
    if (clientY > nextMiddle) {
      sortContainer.insertBefore(activeSortItem, next.nextSibling);
      sortStartClientY += nextRect.height;
      activeSortItem.style.transform = `translateY(${clientY - sortStartClientY}px)`;
      return;
    }
  }
}

function handleSortEnd(e) {
  if (!activeSortItem) return;

  if (e.pointerId !== undefined) {
    try {
      activeSortItem.releasePointerCapture(e.pointerId);
    } catch (err) {}
  }

  activeSortItem.classList.remove('sorting');
  activeSortItem.style.transform = '';

  const finalItems = [...sortContainer.querySelectorAll('.folder-sort-item')];
  const newOrder = finalItems.map(el => el.dataset.folder);

  newOrder.forEach((name, index) => {
    ensureFolderSetting(name).order = index + 1;
  });

  saveState();
  render();

  activeSortItem = null;
  sortContainer = null;
}

document.addEventListener('pointerdown', e => {
  const handle = e.target.closest('.folder-sort-handle') || e.target.closest('.folder-sort-item');
  if (handle && e.target.closest('#folder-sort-container')) {
    handleSortStart(e);
  }
});

document.addEventListener('pointermove', e => {
  if (activeSortItem) {
    handleSortMove(e);
  }
});

document.addEventListener('pointerup', e => {
  if (activeSortItem) {
    handleSortEnd(e);
  }
});

document.addEventListener('dragstart', e => {
  if (e.target.closest('.folder-sort-item')) {
    e.preventDefault();
  }
});

window.addEventListener("storage", (event) => {
  if (event.key === `${STORAGE_KEY}:pulse` && event.newValue?.startsWith(`${TAB_ID}:`)) return;
  if (event.key === STORAGE_KEY || event.key === `${STORAGE_KEY}:pulse`) scheduleSharedSync();
});

async function initApp() {
  await pullRemoteState();
  startRemoteRealtime();
  if (!(await consumeLineSessionFromUrl())) {
    render();
    showLineErrorFromUrl();
  }
}

initApp();
