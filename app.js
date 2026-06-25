const IMPORTANT_KEYWORDS = [
  "ด่วน",
  "สำคัญ",
  "ส่งงาน",
  "deadline",
  "ประชุม",
  "สอบ",
  "วันนี้",
  "พรุ่งนี้",
  "นัด",
  "ต้องส่ง",
  "final",
  "project",
  "assignment",
];

const AD_KEYWORDS = [
  "โปรโมชั่น",
  "ลดราคา",
  "sale",
  "discount",
  "flash sale",
  "ซื้อ 1 แถม 1",
  "ฟรี",
  "คูปอง",
  "voucher",
  "โค้ดส่วนลด",
  "shop",
  "shopping",
  "สั่งซื้อ",
  "สมัครวันนี้",
  "รับสิทธิ์",
  "แจกฟรี",
  "คลิกเลย",
];

const DEFAULT_FOLDERS = ["Main", "Important", "Advertising", "Request", "Group", "Work", "Study", "Friends", "Family"];
const STORAGE_KEY = "taitalk:v1:mobile";
const app = document.querySelector("#app");

// ต้อง declare ก่อน loadState() เพื่อให้ migrateIds() อัปเดตได้
let sessionId = localStorage.getItem("taitalk:session");
let state = loadState();
// หลัง migrateIds() ทำงาน localStorage อาจถูกอัปเดต ให้อ่านใหม่
sessionId = localStorage.getItem("taitalk:session");
let view = {
  authMode: "register",
  screen: "home",
  folder: "Main",
  chatId: null,
  detailTab: "people",
  search: "",
  peopleSearch: "",
  addFriendQuery: "",
  addFriendResult: null, // null | "notfound" | user object
  newFolderName: "",
  groupDraft: "",
  groupMemberDraft: "",
  groupPhotoDraft: "",
  qrInput: "",
  pendingFile: null,
  manageMode: false,
  selectedChatIds: [],
  modalTitle: "ฟีเจอร์นี้ยังไม่พร้อมใช้งาน",
  modalBody: "ฟีเจอร์นี้จะแสดง popup เท่านั้นใน V1",
  scannerOpen: false,
  scannerStatus: "กำลังเตรียมกล้อง...",
};

let qrStream = null;
let qrScanTimer = null;

function defaultState() {
  return {
    users: [
      { id: "@mali", username: "mali", password: "1234", avatar: "", blocked: [] },
      { id: "@narin", username: "narin", password: "1234", avatar: "", blocked: [] },
      { id: "@studyteam", username: "studyteam", password: "1234", avatar: "", blocked: [] },
    ],
    friendships: [],
    customFolders: [],
    appSettings: {
      fontSize: "normal",
      theme: "light",
      language: "th",
    },
    folderSettings: Object.fromEntries(
      DEFAULT_FOLDERS.map((folder) => [
        folder,
        {
          notify: folder !== "Advertising",
          bump: folder !== "Advertising",
          badge: true,
          highlight: true,
        },
      ]),
    ),
    chats: [],
  };
}

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return defaultState();
  try {
    const parsed = JSON.parse(saved);
    const base = defaultState();
    const merged = { ...base, ...parsed };
    merged.folderSettings = { ...base.folderSettings, ...(parsed.folderSettings || {}) };
    merged.appSettings = { ...base.appSettings, ...(parsed.appSettings || {}) };
    merged.customFolders = parsed.customFolders || [];
    return migrateIds(merged);
  } catch {
    return defaultState();
  }
}

function normalizeUserId(id, usersMap) {
  const s = String(id || "");
  if (!s) return s;
  // Already @username format
  if (s.startsWith("@")) return s.toLowerCase();
  // Legacy TT- or ADD- format: look up in usersMap to get @username
  const clean = s.replace(/^TT-/, "ADD-");
  if (usersMap && usersMap[clean]) return usersMap[clean];
  // ถ้าหาไม่เจอ แปลงเป็น @add-xxxx ชั่วคราว
  return `@${clean.toLowerCase()}`;
}

function migrateIds(data) {
  // Step 1: แปลง users ที่มี ADD- format ก่อน — ต้องทำก่อนเพื่อสร้าง map
  const usersMap = {}; // "ADD-1002" -> "@mali"
  data.users = data.users.map((user) => {
    if (!user.id.startsWith("@")) {
      const oldId = user.id.replace(/^TT-/, "ADD-");
      const newId = `@${user.username.toLowerCase()}`;
      usersMap[oldId] = newId;
      return { ...user, id: newId, blocked: [] };
    }
    return user;
  });
  // Step 2: แปลง blocked lists
  data.users = data.users.map((user) => ({
    ...user,
    blocked: (user.blocked || []).map((id) => normalizeUserId(id, usersMap)),
  }));
  // Step 3: แปลง friendships, chats
  const conv = (id) => normalizeUserId(id, usersMap);
  data.friendships = (data.friendships || []).map((pair) => pair.map(conv));
  data.chats = (data.chats || []).map((chat) => ({
    ...chat,
    members: chat.members.map(conv),
    unread: Object.fromEntries(Object.entries(chat.unread || {}).map(([k, v]) => [conv(k), v])),
    importantUnread: Object.fromEntries(Object.entries(chat.importantUnread || {}).map(([k, v]) => [conv(k), v])),
    hiddenFor: (chat.hiddenFor || []).map(conv),
    pinnedFor: (chat.pinnedFor || []).map(conv),
    mutedFor: (chat.mutedFor || []).map(conv),
    messages: (chat.messages || []).map((msg) => ({
      ...msg,
      senderId: conv(msg.senderId),
      hiddenFor: (msg.hiddenFor || []).map(conv),
    })),
  }));
  // Step 4: แปลง sessionId ใน localStorage
  const savedSession = localStorage.getItem("taitalk:session");
  if (savedSession && !savedSession.startsWith("@")) {
    const converted = conv(savedSession);
    localStorage.setItem("taitalk:session", converted);
    // อัปเดต sessionId ด้วยถ้ามีอยู่แล้ว
    if (typeof sessionId !== "undefined" && sessionId === savedSession) {
      sessionId = converted;
    }
  }
  return data;
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function afterRender() {
  if (window.lucide) window.lucide.createIcons();
  setupCollapsingHeader();
  if (view.scannerOpen) startQrScanner();
}

function setupCollapsingHeader() {
  const shell = document.querySelector(".app-shell");
  if (!shell) return;
  const topbar = document.querySelector(".topbar");
  if (topbar && !topbar.dataset.peekBound) {
    topbar.dataset.peekBound = "true";
    topbar.addEventListener("click", (event) => {
      if (event.target.closest("[data-action]")) return;
      if (shell.classList.contains("header-compact")) shell.classList.toggle("folder-peek");
    });
  }
  const scrollers = document.querySelectorAll(".home-page, .content-page, .list-body, .panel, .messages");
  scrollers.forEach((scroller) => {
    scroller.addEventListener(
      "scroll",
      () => {
        const compact = scroller.scrollTop > 24;
        shell.classList.toggle("header-compact", compact);
        if (!compact) shell.classList.remove("folder-peek");
      },
      { passive: true },
    );
  });
}

async function startQrScanner() {
  const video = document.querySelector("#qr-video");
  if (!video || qrStream) return;
  if (!("BarcodeDetector" in window)) {
    view.scannerStatus = "เบราว์เซอร์นี้ยังไม่รองรับการสแกน QR ด้วยกล้อง กรุณาวางโค้ด QR แทน";
    const hint = document.querySelector("#qr-scanner .hint");
    if (hint) hint.textContent = view.scannerStatus;
    return;
  }
  try {
    qrStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    video.srcObject = qrStream;
    await video.play();
    view.scannerStatus = "เล็งกล้องไปที่ QR Code ของเพื่อน";
    const detector = new BarcodeDetector({ formats: ["qr_code"] });
    const scan = async () => {
      if (!view.scannerOpen || !qrStream) return;
      try {
        const codes = await detector.detect(video);
        if (codes.length && codes[0].rawValue) {
          view.qrInput = codes[0].rawValue;
          addFriendFromCode(codes[0].rawValue);
          return;
        }
      } catch {
        view.scannerStatus = "กำลังสแกน...";
      }
      qrScanTimer = window.setTimeout(scan, 350);
    };
    scan();
  } catch {
    view.scannerStatus = "เปิดกล้องไม่ได้ กรุณาอนุญาตกล้องหรือวางโค้ด QR แทน";
    const hint = document.querySelector("#qr-scanner .hint");
    if (hint) hint.textContent = view.scannerStatus;
  }
}

function stopQrScanner() {
  if (qrScanTimer) window.clearTimeout(qrScanTimer);
  qrScanTimer = null;
  if (qrStream) {
    qrStream.getTracks().forEach((track) => track.stop());
    qrStream = null;
  }
}

function makeId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`;
}

function currentUser() {
  return state.users.find((user) => user.id === sessionId) || null;
}

function byId(id) {
  return state.users.find((user) => user.id === id);
}

function isBlocked(a, b) {
  const userA = byId(a);
  const userB = byId(b);
  return Boolean(userA?.blocked?.includes(b) || userB?.blocked?.includes(a));
}

function areFriends(a, b) {
  return state.friendships.some((pair) => pair.includes(a) && pair.includes(b));
}

function addFriend(a, b) {
  if (!areFriends(a, b)) state.friendships.push([a, b]);
}

function folderNames() {
  return unique([...DEFAULT_FOLDERS, ...(state.customFolders || [])]);
}

function defaultFolderSetting(folder) {
  return {
    notify: folder !== "Advertising",
    bump: folder !== "Advertising",
    badge: true,
    highlight: true,
  };
}

function ensureFolderSetting(folder) {
  if (!state.folderSettings[folder]) state.folderSettings[folder] = defaultFolderSetting(folder);
  return state.folderSettings[folder];
}

function classifyMessage(text) {
  const normalized = text.toLowerCase();
  if (AD_KEYWORDS.some((keyword) => normalized.includes(keyword.toLowerCase()))) return "advertising";
  if (IMPORTANT_KEYWORDS.some((keyword) => normalized.includes(keyword.toLowerCase()))) return "important";
  return "normal";
}

function userName(user) {
  return (user?.displayName || user?.username || "Unknown");
}

function chatName(chat) {
  if (chat.type === "group") return chat.name;
  const other = chat.members.find((id) => id !== sessionId);
  return userName(byId(other));
}

function chatAvatar(chat) {
  if (chat.type === "group") return chat.photo;
  const other = chat.members.find((id) => id !== sessionId);
  return byId(other)?.avatar || "";
}

function initials(name) {
  return (name || "T").slice(0, 2).toUpperCase();
}

function formatTime(value) {
  return new Intl.DateTimeFormat("th-TH", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

function ui(th, en) {
  return state.appSettings.language === "en" ? en : th;
}

function visibleMessages(chat) {
  return chat.messages.filter((message) => !message.hiddenFor?.includes(sessionId));
}

function latestMessage(chat) {
  return [...visibleMessages(chat)].reverse().find(Boolean);
}

function categoryFolder(category) {
  if (category === "advertising") return "Advertising";
  if (category === "important") return "Important";
  return "Main";
}

function friendCode(user) {
  return user.id; // @username is the friend code now
}

function userFromFriendCode(code) {
  const cleaned = String(code || "").trim().toLowerCase();
  // Support @username directly
  if (cleaned.startsWith("@")) {
    return state.users.find((user) => user.id.toLowerCase() === cleaned || user.username.toLowerCase() === cleaned.slice(1));
  }
  // Legacy TAITALK:ADD-xxx:username or TAITALK:@username:username
  const parts = cleaned.split(":");
  if (parts.length >= 2 && parts[0] === "taitalk") {
    const idPart = parts[1];
    return state.users.find((user) => user.id.toLowerCase() === idPart || user.username.toLowerCase() === idPart.replace(/^@/, ""));
  }
  // Fallback: search by username without @
  return state.users.find((user) => user.username.toLowerCase() === cleaned || user.id.toLowerCase() === cleaned);
}

function renderQr(user) {
  const code = user.id; // @username
  const src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=12&data=${encodeURIComponent(code)}`;
  return `
    <div class="qr-card" aria-label="QR Code">
      <img class="qr-image" src="${src}" alt="${escapeAttr(code)}" />
      <code>${escapeHtml(code)}</code>
    </div>
  `;
}

function addFriendFromCode(code) {
  const other = userFromFriendCode(code);
  if (!other) {
    alert("ไม่พบผู้ใช้จาก QR Code นี้");
    return false;
  }
  if (other.id === sessionId) {
    alert("นี่คือ QR Code ของคุณเอง");
    return false;
  }
  if (isBlocked(sessionId, other.id)) {
    alert("ไม่สามารถเพิ่มผู้ใช้นี้ได้");
    return false;
  }
  addFriend(sessionId, other.id);
  const chat = ensureChatForUser(other.id);
  view.qrInput = "";
  view.folder = "Main";
  view.chatId = chat.id;
  view.screen = "chat";
  view.scannerOpen = false;
  stopQrScanner();
  saveState();
  render();
  return true;
}

function ensureChatForUser(otherId) {
  let chat = state.chats.find((item) => item.type === "direct" && item.members.includes(sessionId) && item.members.includes(otherId));
  if (!chat) {
    chat = {
      id: makeId("chat"),
      type: "direct",
      members: [sessionId, otherId],
      tags: areFriends(sessionId, otherId) ? ["Main"] : ["Request"],
      unread: {},
      importantUnread: {},
      updatedAt: Date.now(),
      messages: [],
    };
    state.chats.push(chat);
  }
  return chat;
}

function filteredChats() {
  const user = currentUser();
  if (!user) return [];
  return state.chats
    .filter((chat) => chat.members.includes(user.id))
    .filter((chat) => !chat.hiddenFor?.includes(user.id))
    .filter((chat) => !chat.members.some((member) => member !== user.id && isBlocked(user.id, member)))
    .filter((chat) => chat.tags.includes(view.folder))
    .filter((chat) => {
      const q = view.search.trim().toLowerCase();
      if (!q) return true;
      const fileText = chat.messages.map((message) => message.file?.name || "").join(" ");
      const messageText = chat.messages.map((message) => message.text).join(" ");
      const members = chat.members.map((id) => `${byId(id)?.username || ""} ${id}`).join(" ");
      return `${chatName(chat)} ${members} ${messageText} ${fileText}`.toLowerCase().includes(q);
    })
    .sort((a, b) => {
      const folder = view.folder;
      const pinnedDelta = Number(b.pinnedFor?.includes(user.id)) - Number(a.pinnedFor?.includes(user.id));
      if (pinnedDelta) return pinnedDelta;
      const setting = ensureFolderSetting(folder);
      if (!setting?.bump) return a.id.localeCompare(b.id);
      return b.updatedAt - a.updatedAt;
    });
}

function folderCounts() {
  const counts = Object.fromEntries(folderNames().map((folder) => [folder, { unread: 0, important: 0 }]));
  for (const chat of state.chats) {
    if (!chat.members.includes(sessionId)) continue;
    if (chat.hiddenFor?.includes(sessionId)) continue;
    for (const folder of chat.tags) {
      if (!counts[folder]) counts[folder] = { unread: 0, important: 0 };
      counts[folder].unread += chat.unread?.[sessionId] || 0;
      counts[folder].important += chat.importantUnread?.[sessionId] || 0;
    }
  }
  return counts;
}

function searchedUsers() {
  const q = view.search.trim().toLowerCase().replace(/^@+/, "");
  if (!q) return [];
  return state.users
    .filter((user) => user.id !== sessionId && !isBlocked(sessionId, user.id))
    .filter((user) => user.username.toLowerCase().includes(q) || user.id.toLowerCase().includes(q));
}

function render() {
  const user = currentUser();
  if (!user) {
    renderAuth();
  } else {
    renderApp(user);
  }
  requestAnimationFrame(afterRender);
}

function renderAuth() {
  const isRegister = view.authMode === "register";
  const savedUsername = escapeAttr(view._authUsername || "");
  const savedPassword = escapeAttr(view._authPassword || "");
  app.innerHTML = `
    <section class="auth-shell">
      <div class="auth-panel">
        <div class="brand">
          <div class="brand-mark">TT</div>
          <div>
            <h1>TaiTalk</h1>
            <p>LINE style chat for friends, groups, and focused messages</p>
          </div>
        </div>
        <div class="tabs">
          <button class="${isRegister ? "active" : ""}" data-action="auth-tab" data-mode="register">สมัครสมาชิก</button>
          <button class="${!isRegister ? "active" : ""}" data-action="auth-tab" data-mode="login">เข้าสู่ระบบ</button>
        </div>
        <form class="form" data-action="${isRegister ? "register" : "login"}">
          <label class="field">Username<input name="username" value="${savedUsername}" autocomplete="username" required /></label>
          <label class="field">Password<input name="password" type="password" value="${savedPassword}" autocomplete="${isRegister ? "new-password" : "current-password"}" required /></label>
          ${
            isRegister
              ? `<label class="field">Confirm Password<input name="confirm" type="password" autocomplete="new-password" required /></label>`
              : ""
          }
          <div class="error" id="auth-error"></div>
          <button class="primary" type="submit"><i data-lucide="${isRegister ? "user-plus" : "log-in"}"></i>${isRegister ? "สมัครสมาชิก" : "เข้าสู่ระบบ"}</button>
          <p class="hint">${isRegister ? "สมัครใหม่เพื่อเริ่มใช้งาน TaiTalk บนเครื่องนี้" : "ใช้บัญชีที่สมัครไว้บนเครื่องนี้"}</p>
        </form>
      </div>
    </section>
  `;
}

function renderApp(user) {
  if (!view.chatId) view.chatId = filteredChats()[0]?.id || state.chats.find((chat) => chat.members.includes(user.id))?.id || null;
  const chats = filteredChats();
  const selected = state.chats.find((chat) => chat.id === view.chatId && chat.members.includes(user.id)) || chats[0] || null;
  if (selected) view.chatId = selected.id;
  app.innerHTML = `
    <section class="app-shell screen-${view.screen} theme-${state.appSettings.theme} font-${state.appSettings.fontSize}">
      ${renderRail(user)}
      ${renderHome()}
      ${renderChatList(chats)}
      ${selected ? renderChat(selected) : renderEmptyChat()}
      ${renderDetail(selected)}
      ${renderContentPage()}
      ${renderBottomNav()}
    </section>
    ${renderModal()}
    ${renderScanner()}
  `;
}

function renderRail(user) {
  const counts = folderCounts();
  return `
    <aside class="rail">
      <div class="topbar">
        <button class="profile profile-button" data-action="detail-tab" data-tab="profile">
          ${avatarHtml(user.avatar, user.displayName || user.username)}
          <div>
            <strong>${escapeHtml(user.displayName || user.username)}</strong>
            <div class="small">${escapeHtml(user.id)}</div>
          </div>
        </button>
        <div class="top-actions">
          <button class="icon-btn mobile-only" title="เพิ่มเพื่อน" data-action="detail-tab" data-tab="people"><i data-lucide="user-plus"></i></button>
          <button class="icon-btn mobile-only" title="แจ้งเตือน" data-action="detail-tab" data-tab="notifications"><i data-lucide="bell"></i></button>
          <button class="icon-btn mobile-only" title="จัดการแชท" data-action="toggle-manage"><i data-lucide="list-checks"></i></button>
          <button class="icon-btn" title="ออกจากระบบ" data-action="logout"><i data-lucide="log-out"></i></button>
        </div>
      </div>
      <div class="search-wrap">
        <div class="global-search">
          <i data-lucide="search"></i>
          <input value="${escapeAttr(view.search)}" data-action="chat-search" placeholder="${ui("ค้นหา @username หรือข้อความ", "Search @username or messages")}" />
          ${
            view.search.trim()
              ? `<button class="search-submit" data-action="submit-search">${ui("ค้นหา", "Search")}</button>`
              : `<button class="icon-btn" title="สแกน QR" data-action="open-scanner"><i data-lucide="scan-line"></i></button>`
          }
        </div>
      </div>
      <nav class="folder-list">
        ${folderNames().map((folder) => {
          const setting = ensureFolderSetting(folder);
          const count = counts[folder];
          const badge = setting?.badge && count.unread ? `<span class="badge">${count.unread}</span>` : "";
          const important = count.important ? `<span class="badge important">สำคัญ +${count.important}</span>` : "";
          return `
            <button class="folder-btn ${view.folder === folder ? "active" : ""}" data-action="folder" data-folder="${folder}">
              <i data-lucide="${folderIcon(folder)}"></i><span>${folder}</span>${important || badge}
            </button>
          `;
        }).join("")}
        <button class="folder-btn folder-add" data-action="detail-tab" data-tab="newFolder"><i data-lucide="folder-plus"></i><span>สร้าง</span></button>
      </nav>
    </aside>
  `;
}

function renderBottomNav() {
  const items = [
    ["home", "", "home", ui("หน้าแรก", "Home")],
    ["list", "chat", "message-circle", ui("แชท", "Chat")],
    ["voom", "", "play-square", "VOOM"],
    ["today", "", "newspaper", "Today"],
    ["wallet", "", "wallet", "Wallet"],
  ];
  return `
    <nav class="bottom-nav">
      ${items.map(([screen, tab, icon, label]) => {
        const active = view.screen === screen;
        return `
          <button class="${active ? "active" : ""}" data-action="bottom-nav" data-screen="${screen}" data-tab="${tab}">
            <i data-lucide="${icon}"></i><span>${label}</span>
          </button>
        `;
      }).join("")}
    </nav>
  `;
}

function renderHome() {
  const actions = [
    ["เพิ่มเพื่อน", "user-plus", "people"],
    ["สร้างกลุ่ม", "users", "groups"],
    ["OpenChat", "messages-square", "coming"],
    ["สร้าง Folder", "folder-plus", "newFolder"],
    ["ตั้งค่า Folder", "folder-cog", "folders"],
    ["Settings", "settings", "settings"],
    ["คลังไฟล์", "folder-open", "library"],
    ["รูปทั้งหมด", "image", "library"],
    ["Profile QR", "qr-code", "profile"],
  ];
  return `
    <section class="home-page">
      <div class="home-hero">
        <p>TaiTalk Home</p>
        <h2>ทุกอย่างของแชทอยู่ที่นี่</h2>
      </div>
      <div class="quick-grid">
        ${actions.map(([label, icon, tab]) => `
          <button data-action="${tab === "coming" ? "coming-soon" : "detail-tab"}" data-tab="${tab}" data-feature="${label}">
            <i data-lucide="${icon}"></i><span>${label}</span>
          </button>
        `).join("")}
      </div>
      <div class="home-card">
        <strong>LINE-style services</strong>
        <p>Stickers, official accounts, games, coupons, mini apps, backup, storage, privacy center</p>
      </div>
    </section>
  `;
}

function renderContentPage() {
  if (view.screen === "voom") {
    return `
      <section class="content-page">
        <div class="section-head"><strong>VOOM</strong></div>
        <div class="feed">
          ${["mali อัปโหลดรูปการบ้าน", "narin แชร์ไอเดีย project", "studyteam ลงโพสต์สรุปสอบ"].map((text) => `
            <article class="feed-card">
              <div class="feed-media"></div>
              <strong>${escapeHtml(text)}</strong>
              <p>โพสต์สั้น ๆ แบบ social feed สำหรับอัปเดตเรื่องราวของเพื่อน</p>
            </article>
          `).join("")}
        </div>
      </section>
    `;
  }
  if (view.screen === "today") {
    return `
      <section class="content-page">
        <div class="section-head"><strong>Today</strong></div>
        <div class="feed">
          ${["ข่าวเด่นวันนี้", "งานและการเรียน", "เทคโนโลยี", "ไลฟ์สไตล์"].map((text) => `
            <article class="news-card">
              <span>Today</span>
              <strong>${escapeHtml(text)}</strong>
              <p>พื้นที่รวมข่าวสารและคอนเทนต์ประจำวัน</p>
            </article>
          `).join("")}
        </div>
      </section>
    `;
  }
  if (view.screen === "wallet") {
    return `
      <section class="content-page">
        <div class="wallet-card">
          <span>TaiPay Wallet</span>
          <strong>฿ 0.00</strong>
          <p>ยอดเงินพร้อมใช้</p>
        </div>
        <div class="quick-grid">
          ${["เติมเงิน", "โอนเงิน", "จ่ายบิล", "คูปอง", "ประวัติ", "บัตร"].map((label) => `
            <button data-action="coming-soon" data-feature="${label}"><i data-lucide="circle-dollar-sign"></i><span>${label}</span></button>
          `).join("")}
        </div>
      </section>
    `;
  }
  return "";
}

function renderChatList(chats) {
  const users = searchedUsers();
  return `
    <aside class="chat-list">
      <div class="section-head">
        <strong>${view.manageMode ? "จัดการแชท" : view.folder}</strong>
        <button class="icon-btn" title="จัดการแชท" data-action="toggle-manage"><i data-lucide="${view.manageMode ? "x" : "list-checks"}"></i></button>
      </div>
      ${view.manageMode ? renderBulkBar() : ""}
      <div class="list-body">
        ${users.length ? `<div class="search-users">${users.map(renderUserResult).join("")}</div>` : ""}
        ${chats.length ? chats.map(renderChatRow).join("") : `<p class="empty">ยังไม่มีแชทในโฟลเดอร์นี้</p>`}
      </div>
    </aside>
  `;
}

function renderBulkBar() {
  return `
    <div class="bulk-bar">
      <span>${view.selectedChatIds.length} selected</span>
      <button class="mini" data-action="bulk-chat" data-bulk="pin">ปักหมุด</button>
      <button class="mini" data-action="bulk-chat" data-bulk="read">อ่านแล้ว</button>
      <button class="mini" data-action="bulk-chat" data-bulk="mute">ปิดแจ้งเตือน</button>
      <button class="mini" data-action="bulk-chat" data-bulk="hide">ซ่อน</button>
      <button class="mini danger" data-action="bulk-chat" data-bulk="delete">ลบ</button>
    </div>
  `;
}

function renderUserResult(user) {
  const friend = areFriends(sessionId, user.id);
  return `
    <div class="user-result">
      ${avatarHtml(user.avatar, user.username)}
      <span><strong>${escapeHtml(user.username)}</strong><small>${user.id}</small></span>
      <button class="mini ${friend ? "" : "add-mini"}" data-action="${friend ? "open-user-chat" : "add-friend"}" data-user="${user.id}">
        ${friend ? ui("แชท", "Chat") : ui("เพิ่ม", "Add")}
      </button>
    </div>
  `;
}

function renderChatRow(chat) {
  const latest = latestMessage(chat);
  const unread = chat.unread?.[sessionId] || 0;
  const important = chat.importantUnread?.[sessionId] || 0;
  const setting = state.folderSettings[view.folder];
  const highlight = setting?.highlight && unread ? "highlight" : "";
  const labels = [
    important ? `<span class="label important">Important</span>` : "",
    chat.tags.includes("Advertising") ? `<span class="label ad">Advertising</span>` : "",
    chat.type === "group" ? `<span class="label">Group</span>` : "",
  ].join("");
  return `
    <button class="chat-row ${view.chatId === chat.id ? "active" : ""} ${highlight}" data-action="${view.manageMode ? "toggle-chat-select" : "select-chat"}" data-chat="${chat.id}">
      ${view.manageMode ? `<span class="check-dot ${view.selectedChatIds.includes(chat.id) ? "checked" : ""}"><i data-lucide="check"></i></span>` : ""}
      ${avatarHtml(chatAvatar(chat), chatName(chat))}
      <span class="preview">
        <strong>${escapeHtml(chatName(chat))}</strong>
        <span class="small">${latest ? escapeHtml(latest.unsent ? "ยกเลิกข้อความแล้ว" : latest.file ? latest.file.name : latest.text) : "เริ่มแชท"}</span>
        <span class="labels">${chat.pinnedFor?.includes(sessionId) ? `<span class="label">Pinned</span>` : ""}${chat.mutedFor?.includes(sessionId) ? `<span class="label">Muted</span>` : ""}${labels}</span>
      </span>
      <span>
        <time>${latest ? formatTime(latest.createdAt) : ""}</time>
        ${unread ? `<span class="badge">${unread}</span>` : ""}
      </span>
    </button>
  `;
}

function renderChat(chat) {
  const messages = visibleMessages(chat);
  return `
    <section class="chat">
      <header class="chat-head">
        <div class="chat-title">
          <button class="icon-btn mobile-only" title="กลับ" data-action="back-list"><i data-lucide="chevron-left"></i></button>
          ${avatarHtml(chatAvatar(chat), chatName(chat))}
          <div>
            <strong>${escapeHtml(chatName(chat))}</strong>
            <div class="small">${chat.type === "group" ? `${chat.members.length} สมาชิก` : byId(chat.members.find((id) => id !== sessionId))?.id || ""}</div>
          </div>
        </div>
        <div class="chat-actions">
          <button class="icon-btn" title="Voice Call" data-action="call"><i data-lucide="phone"></i></button>
          <button class="icon-btn" title="Video Call" data-action="call"><i data-lucide="video"></i></button>
          <button class="icon-btn" title="ข้อมูลแชท" data-action="detail-tab" data-tab="${chat.type === "group" ? "groups" : "people"}"><i data-lucide="panel-right"></i></button>
        </div>
      </header>
      <div class="messages">
        <div class="dayline">วันนี้</div>
        ${messages.length ? messages.map((message) => renderMessage(chat, message)).join("") : `<p class="empty">ยังไม่มีข้อความ</p>`}
      </div>
      ${renderComposer(chat)}
    </section>
  `;
}

function renderMessage(chat, message) {
  const mine = message.senderId === sessionId;
  const sender = byId(message.senderId);
  const ageHours = (Date.now() - message.createdAt) / 36e5;
  const canUnsend = mine && !message.unsent && ageHours <= 24;
  const categoryClass = message.category === "important" ? "important" : message.category === "advertising" ? "ad" : "";
  return `
    <article class="message ${mine ? "mine" : ""}">
      ${chat.type === "group" && !mine ? `<span class="small">${escapeHtml(sender?.username || "Unknown")}</span>` : ""}
      <div class="bubble ${categoryClass}">
        ${message.unsent ? `<span class="small">ยกเลิกข้อความแล้ว</span>` : `${escapeHtml(message.text)}${message.file ? renderFile(message.file) : ""}`}
      </div>
      <div class="status">${statusText(message, mine)}</div>
      ${
        !message.unsent
          ? `<div class="message-menu">
              <button class="mini" data-action="delete-self" data-chat="${chat.id}" data-message="${message.id}">ลบฝั่งฉัน</button>
              ${canUnsend ? `<button class="mini danger" data-action="unsend" data-chat="${chat.id}" data-message="${message.id}">ลบทั้งสองฝั่ง</button>` : ""}
            </div>`
          : ""
      }
    </article>
  `;
}

function statusText(message, mine) {
  if (message.readAt) return `${mine ? "อ่านแล้ว" : "อ่านแล้ว"} ${formatTime(message.readAt)}`;
  if (message.deliveredAt) return `${mine ? "ถึงแล้ว" : "ถึงแล้ว"} ${formatTime(message.deliveredAt)}`;
  return `ส่งแล้ว ${formatTime(message.createdAt)}`;
}

function renderFile(file) {
  const image = file.type?.startsWith("image/") && file.url;
  return `
    <div class="file-chip">
      ${image ? `<img src="${file.url}" alt="${escapeAttr(file.name)}" />` : `<i data-lucide="${fileIcon(file.name)}"></i>`}
      <div>
        <strong>${escapeHtml(file.name)}</strong>
        <div class="small">${escapeHtml(file.type || "file")}</div>
      </div>
    </div>
  `;
}

function renderComposer(chat) {
  const inRequest = chat.tags.includes("Request");
  return `
    <form class="composer" data-action="send-message">
      ${inRequest ? `<p class="hint">ตอบกลับในคำขอนี้เพื่อย้ายแชทเข้า Main และเริ่มคุยตามปกติ</p>` : ""}
      <div class="pending-file ${view.pendingFile ? "show" : ""}">
        <span>${view.pendingFile ? escapeHtml(view.pendingFile.name) : ""}</span>
        <button class="mini" type="button" data-action="clear-file">ล้าง</button>
      </div>
      <div class="composer-row">
        <label class="icon-btn" title="แนบไฟล์">
          <i data-lucide="plus"></i>
          <input type="file" data-action="file-input" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.zip" />
        </label>
        <button class="icon-btn" type="button" title="กล้อง" data-action="coming-soon" data-feature="กล้อง"><i data-lucide="camera"></i></button>
        <input name="message" placeholder="พิมพ์ข้อความ" autocomplete="off" />
        <button class="icon-btn" type="button" title="Emoji" data-action="coming-soon" data-feature="Emoji"><i data-lucide="smile"></i></button>
        <button class="icon-btn" type="button" title="Voice" data-action="coming-soon" data-feature="Voice"><i data-lucide="mic"></i></button>
        <button class="send-btn" type="submit" title="ส่ง"><i data-lucide="send"></i></button>
      </div>
    </form>
  `;
}

function renderEmptyChat() {
  return `
    <section class="chat">
      <div class="messages empty-state">
        <p class="empty">ยังไม่มีแชท</p>
        <button class="primary" data-action="detail-tab" data-tab="people"><i data-lucide="user-plus"></i>ค้นหาเพื่อน</button>
      </div>
    </section>
  `;
}

function renderDetail(selected) {
  const showTabs = ["people", "groups", "profile"].includes(view.detailTab);
  return `
    <aside class="detail">
      <div class="section-head">
        <button class="icon-btn mobile-only" title="กลับ" data-action="back-list"><i data-lucide="chevron-left"></i></button>
        <strong>${detailTitle()}</strong>
      </div>
      ${showTabs ? `
        <div class="detail-tabs">
          <div class="segmented">
            <button class="${view.detailTab === "people" ? "active" : ""}" data-action="detail-tab" data-tab="people">เพื่อน</button>
            <button class="${view.detailTab === "groups" ? "active" : ""}" data-action="detail-tab" data-tab="groups">กลุ่ม</button>
            <button class="${view.detailTab === "profile" ? "active" : ""}" data-action="detail-tab" data-tab="profile">โปรไฟล์</button>
          </div>
        </div>
      ` : ""}
      <div class="panel">${detailPanel(selected)}</div>
    </aside>
  `;
}

function detailTitle() {
  return {
    people: "Friends",
    groups: "Group",
    notifications: "Notifications",
    settings: "Settings",
    profile: "Profile",
    folders: "Folder Settings",
    newFolder: "Create Folder",
    library: "Media Library",
  }[view.detailTab] || "จัดการ";
}

function detailPanel(selected) {
  if (view.detailTab === "groups") return groupPanel(selected);
  if (view.detailTab === "profile") return profilePanel();
  if (view.detailTab === "notifications") return notificationsPanel();
  if (view.detailTab === "settings") return settingsPanel();
  if (view.detailTab === "folders") return folderSettingsPanel();
  if (view.detailTab === "newFolder") return createFolderPanel();
  if (view.detailTab === "library") return libraryPanel();
  return peoplePanel(selected);
}

function peoplePanel(selected) {
  const user = currentUser();
  const currentOther = selected?.type === "direct" ? selected.members.find((id) => id !== sessionId) : null;

  // Build friend search result HTML
  let addResultHtml = "";
  if (view.addFriendResult === "notfound") {
    addResultHtml = `<p class="add-friend-error"><i data-lucide="user-x"></i>ไม่พบผู้ใช้ "${escapeHtml(view.addFriendQuery)}"</p>`;
  } else if (view.addFriendResult && view.addFriendResult !== "notfound") {
    const found = view.addFriendResult;
    const isFriend = areFriends(user.id, found.id);
    const isMe = found.id === sessionId;
    const foundName = found.displayName || found.username;
    addResultHtml = `
      <div class="add-friend-card">
        ${avatarHtml(found.avatar, foundName, "add-friend-avatar")}
        <div class="add-friend-info">
          <strong>${escapeHtml(foundName)}</strong>
          <span class="add-friend-id">${escapeHtml(found.id)}</span>
        </div>
        ${isMe
          ? `<span class="label">นี่คือคุณ</span>`
          : isFriend
          ? `<button class="ghost" data-action="open-user-chat" data-user="${found.id}"><i data-lucide="message-circle"></i>แชท</button>`
          : `<button class="primary add-friend-btn" data-action="add-friend-confirm" data-user="${found.id}"><i data-lucide="user-plus"></i>เพิ่มเพื่อน</button>`
        }
      </div>
    `;
  }

  // Friend list
  const friends = state.users.filter((item) => item.id !== sessionId && areFriends(user.id, item.id));

  return `
    <div class="stack">
      <div class="block">
        <h3>เพิ่มเพื่อน</h3>
        <p class="hint">พิมพ์ username ของเพื่อนแล้วกด Enter หรือกดค้นหา</p>
        <form class="add-friend-search" data-action="submit-add-friend">
          <div class="add-friend-input-row">
            <span class="at-prefix">@</span>
            <input
              class="add-friend-input"
              value="${escapeAttr(view.addFriendQuery.replace(/^@/, ""))}"
              data-action="add-friend-query"
              placeholder="username"
              autocomplete="off"
              autocorrect="off"
              spellcheck="false"
            />
          </div>
          <button class="primary" type="submit">
            <i data-lucide="search"></i>ค้นหา
          </button>
        </form>
        ${addResultHtml}
      </div>

      <div class="block">
        <h3>เพื่อนของฉัน (${friends.length})</h3>
        ${friends.length ? friends.map((person) => `
          <div class="result-row">
            ${avatarHtml(person.avatar, person.displayName || person.username)}
            <div>
              <strong>${escapeHtml(person.displayName || person.username)}</strong>
              <div class="small">${escapeHtml(person.id)}</div>
            </div>
            <button class="ghost" data-action="open-user-chat" data-user="${person.id}">
              <i data-lucide="message-circle"></i>แชท
            </button>
          </div>
        `).join("") : `<p class="empty">ยังไม่มีเพื่อน — ค้นหาด้วย @username ด้านบน</p>`}
      </div>

      ${
        currentOther
          ? `<div class="block">
              <h3>${escapeHtml(byId(currentOther)?.username || "")}</h3>
              <button class="ghost danger" data-action="block-user" data-user="${currentOther}"><i data-lucide="ban"></i>บล็อกผู้ใช้นี้</button>
            </div>`
          : ""
      }

      <div class="block">
        <h3>เพิ่มเพื่อนด้วย QR</h3>
        <div class="qr-tools">
          ${renderQr(user)}
          <div class="stack">
            <button class="ghost" data-action="copy-qr"><i data-lucide="copy"></i>คัดลอก @username</button>
            <button class="ghost" data-action="open-scanner"><i data-lucide="camera"></i>เปิดกล้องสแกน</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function profilePanel() {
  const user = currentUser();
  const displayName = user.displayName || user.username;
  return `
    <div class="stack">
      <div class="profile-cover">
        ${avatarHtml(user.avatar, displayName, "profile-avatar")}
        <h2>${escapeHtml(displayName)}</h2>
        <p class="profile-id">${escapeHtml(user.id)}</p>
      </div>
      <div class="block">
        <h3>รูปโปรไฟล์</h3>
        <label class="profile-upload">
          ${avatarHtml(user.avatar, displayName)}
          <span><i data-lucide="image-plus"></i>เปลี่ยนรูปโปรไฟล์</span>
          <input type="file" data-action="profile-avatar" accept="image/*" />
        </label>
      </div>
      <div class="block">
        <h3>ชื่อที่แสดง</h3>
        <form class="inline" data-action="save-displayname">
          <input name="displayname" value="${escapeAttr(displayName)}" placeholder="ชื่อที่ต้องการแสดง" autocomplete="off" />
          <button class="primary" type="submit"><i data-lucide="save"></i>บันทึก</button>
        </form>
        <p class="hint">ชื่อที่เพื่อนจะเห็น เปลี่ยนได้ตลอด</p>
      </div>
      <div class="block">
        <h3>TaiTalk ID</h3>
        <div class="profile-id-row">
          <code class="id-badge">${escapeHtml(user.id)}</code>
          <button class="ghost" data-action="copy-id"><i data-lucide="copy"></i>คัดลอก</button>
        </div>
        <p class="hint">ID นี้ใช้ให้เพื่อนค้นหาคุณ เปลี่ยนไม่ได้</p>
      </div>
      <div class="block">
        <h3>QR Code</h3>
        ${renderQr(user)}
        <button class="primary full" data-action="copy-qr"><i data-lucide="share-2"></i>แชร์โปรไฟล์</button>
      </div>
    </div>
  `;
}

function searchPanel() {
  const q = view.search.trim().toLowerCase();
  const allMessages = state.chats
    .filter((chat) => chat.members.includes(sessionId))
    .flatMap((chat) => visibleMessages(chat).map((message) => ({ chat, message })))
    .filter(({ chat, message }) => {
      if (!q) return true;
      return `${chatName(chat)} ${message.text} ${message.file?.name || ""}`.toLowerCase().includes(q);
    });
  return `
    <div class="stack">
      <div class="block">
        <h3>ค้นหาทั้งหมด</h3>
        <input value="${escapeAttr(view.search)}" data-action="chat-search" placeholder="ข้อความ รูป ไฟล์ ผู้ใช้ หรือกลุ่ม" />
      </div>
      <div class="search-tabs">
        <span>Messages</span><span>Photos</span><span>Files</span><span>Users</span><span>Groups</span>
      </div>
      <div class="block">
        <h3>ผลการค้นหา</h3>
        ${allMessages.length ? allMessages.map(({ chat, message }) => `
          <button class="result-row result-button" data-action="select-chat" data-chat="${chat.id}">
            <span>
              <strong>${escapeHtml(chatName(chat))}</strong>
              <span class="small">${escapeHtml(message.file?.name || message.text || "ไฟล์")}</span>
            </span>
            <i data-lucide="chevron-right"></i>
          </button>
        `).join("") : `<p class="empty">ยังไม่มีผลลัพธ์</p>`}
      </div>
    </div>
  `;
}

function notificationsPanel() {
  const requests = state.chats.filter((chat) => chat.members.includes(sessionId) && chat.tags.includes("Request"));
  const important = state.chats.filter((chat) => chat.members.includes(sessionId) && (chat.importantUnread?.[sessionId] || 0) > 0);
  return `
    <div class="stack">
      ${requests.length ? requests.map((chat) => notificationCard(chat, "คำขอข้อความ", "มีคนส่งข้อความมาและยังไม่ใช่เพื่อน")) .join("") : ""}
      ${important.length ? important.map((chat) => notificationCard(chat, "Important", "มีข้อความสำคัญรออ่าน")) .join("") : ""}
      ${!requests.length && !important.length ? `<div class="block"><p class="empty">ยังไม่มีแจ้งเตือนใหม่</p></div>` : ""}
    </div>
  `;
}

function notificationCard(chat, title, text) {
  return `
    <button class="notification-card" data-action="select-chat" data-chat="${chat.id}">
      ${avatarHtml(chatAvatar(chat), chatName(chat))}
      <span>
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(chatName(chat))}: ${escapeHtml(text)}</span>
      </span>
      <time>${formatTime(chat.updatedAt)}</time>
    </button>
  `;
}

function groupPanel(selected) {
  const group = selected?.type === "group" ? selected : null;
  const available = state.users.filter((user) => user.id !== sessionId && !group?.members.includes(user.id) && !isBlocked(sessionId, user.id));
  return `
    <div class="stack">
      <div class="block">
        <h3>สร้างกลุ่ม</h3>
        <div class="inline">
          <input value="${escapeAttr(view.groupDraft)}" data-action="group-draft" placeholder="ชื่อกลุ่ม" />
          <button class="ghost" data-action="create-group"><i data-lucide="plus"></i></button>
        </div>
      </div>
      ${
        group
          ? `<div class="block">
              <h3>${escapeHtml(group.name)}</h3>
              <label class="field">เปลี่ยนชื่อกลุ่ม<input value="${escapeAttr(group.name)}" data-action="group-name" /></label>
              <label class="field">URL รูปกลุ่ม<input value="${escapeAttr(group.photo || "")}" data-action="group-photo" placeholder="https://..." /></label>
              <button class="primary" data-action="save-group" data-chat="${group.id}"><i data-lucide="save"></i>บันทึกกลุ่ม</button>
            </div>
            <div class="block">
              <h3>สมาชิก</h3>
              ${group.members.map((memberId) => `
                <div class="result-row">
                  <span>${escapeHtml(byId(memberId)?.username || memberId)} <span class="small">${memberId}</span></span>
                  ${memberId !== sessionId ? `<button class="mini danger" data-action="remove-member" data-chat="${group.id}" data-user="${memberId}">ลบ</button>` : ""}
                </div>
              `).join("")}
              <label class="field">เพิ่มสมาชิก
                <select data-action="group-member-draft">
                  <option value="">เลือกผู้ใช้</option>
                  ${available.map((user) => `<option value="${user.id}">${escapeHtml(user.username)} (${user.id})</option>`).join("")}
                </select>
              </label>
              <button class="ghost" data-action="add-member" data-chat="${group.id}"><i data-lucide="user-plus"></i>เพิ่มสมาชิก</button>
            </div>`
          : `<div class="block"><p class="empty">เลือกกลุ่มเพื่อแก้ไขสมาชิก ชื่อ และรูปกลุ่ม</p></div>`
      }
    </div>
  `;
}

function settingsPanel() {
  return `
    <div class="stack">
      <div class="block">
        <h3>${ui("การแสดงผล", "Appearance")}</h3>
        <label class="field">${ui("ภาษา", "Language")}
          <select data-action="language">
            <option value="th" ${state.appSettings.language === "th" ? "selected" : ""}>ไทย</option>
            <option value="en" ${state.appSettings.language === "en" ? "selected" : ""}>English</option>
          </select>
        </label>
        <label class="field">${ui("ขนาดตัวหนังสือ", "Font size")}
          <select data-action="font-size">
            <option value="small" ${state.appSettings.fontSize === "small" ? "selected" : ""}>${ui("เล็ก", "Small")}</option>
            <option value="normal" ${state.appSettings.fontSize === "normal" ? "selected" : ""}>${ui("ปกติ", "Normal")}</option>
            <option value="large" ${state.appSettings.fontSize === "large" ? "selected" : ""}>${ui("ใหญ่", "Large")}</option>
          </select>
        </label>
        <label class="switch-row">
          <span>${ui("ธีมมืดดำ", "Dark mode")}</span>
          <input type="checkbox" ${state.appSettings.theme === "dark" ? "checked" : ""} data-action="theme-toggle" />
        </label>
      </div>
      <div class="block">
        <h3>Chat</h3>
        <button class="ghost full" data-action="coming-soon" data-feature="Wallpaper"><i data-lucide="image"></i>Wallpaper</button>
        <button class="ghost full" data-action="coming-soon" data-feature="Backup"><i data-lucide="cloud"></i>Backup</button>
      </div>
    </div>
  `;
}

function folderSettingsPanel() {
  return `
    <div class="stack">
      ${folderNames().map((folder) => {
        const setting = ensureFolderSetting(folder);
        return `
          <div class="block">
            <h3>${escapeHtml(folder)}</h3>
            ${settingToggle(folder, "notify", "แจ้งเตือน")}
            ${settingToggle(folder, "bump", "ดันแชทขึ้นบนสุด")}
            ${settingToggle(folder, "badge", "แสดง Badge จำนวนข้อความ")}
            ${settingToggle(folder, "highlight", "Highlight ข้อความใหม่")}
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function createFolderPanel() {
  return `
    <div class="stack">
      <div class="block">
        <h3>สร้าง Folder ใหม่</h3>
        <div class="inline">
          <input value="${escapeAttr(view.newFolderName)}" data-action="new-folder-name" placeholder="เช่น Project, Club, Shopping" />
          <button class="primary" data-action="create-folder"><i data-lucide="folder-plus"></i></button>
        </div>
        <p class="hint">Folder ที่สร้างจะไปอยู่ในแถบโฟลเดอร์บนหน้า Chat</p>
      </div>
      <div class="block">
        <h3>Folder ของฉัน</h3>
        ${folderNames().map((folder) => `
          <div class="result-row">
            <span>${escapeHtml(folder)}</span>
            ${DEFAULT_FOLDERS.includes(folder) ? `<span class="label">Default</span>` : `<button class="mini danger" data-action="delete-folder" data-folder="${escapeAttr(folder)}">ลบ</button>`}
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function libraryPanel() {
  const files = state.chats
    .filter((chat) => chat.members.includes(sessionId))
    .flatMap((chat) => visibleMessages(chat).filter((message) => message.file).map((message) => ({ chat, message })));
  const photos = files.filter(({ message }) => message.file.type?.startsWith("image/"));
  return `
    <div class="stack">
      <div class="media-summary">
        <div><strong>${photos.length}</strong><span>Photos</span></div>
        <div><strong>${files.length}</strong><span>Files</span></div>
      </div>
      <div class="block">
        <h3>รูปทั้งหมด</h3>
        <div class="photo-grid">
          ${photos.length ? photos.map(({ message }) => `<img src="${message.file.url}" alt="${escapeAttr(message.file.name)}" />`).join("") : `<p class="empty">ยังไม่มีรูป</p>`}
        </div>
      </div>
      <div class="block">
        <h3>ไฟล์ทั้งหมด</h3>
        ${files.length ? files.map(({ chat, message }) => `
          <button class="result-row result-button" data-action="select-chat" data-chat="${chat.id}">
            <span><strong>${escapeHtml(message.file.name)}</strong><span class="small">${escapeHtml(chatName(chat))}</span></span>
            <i data-lucide="${fileIcon(message.file.name)}"></i>
          </button>
        `).join("") : `<p class="empty">ยังไม่มีไฟล์</p>`}
      </div>
    </div>
  `;
}

function settingToggle(folder, key, label) {
  return `
    <label class="switch-row">
      <span>${label}</span>
      <input type="checkbox" ${state.folderSettings[folder]?.[key] ? "checked" : ""} data-action="folder-setting" data-folder="${folder}" data-key="${key}" />
    </label>
  `;
}

function renderModal() {
  return `
    <div class="modal-backdrop" id="modal">
      <div class="modal">
        <h2>${escapeHtml(view.modalTitle)}</h2>
        <p class="hint">${escapeHtml(view.modalBody)}</p>
        <div class="modal-actions">
          <button class="primary" data-action="close-modal">ตกลง</button>
        </div>
      </div>
    </div>
  `;
}

function renderScanner() {
  return `
    <div class="modal-backdrop ${view.scannerOpen ? "show" : ""}" id="qr-scanner">
      <div class="modal scanner-modal">
        <h2>สแกน QR Code</h2>
        <div class="scanner-frame">
          <video id="qr-video" playsinline muted></video>
          <div class="scan-corners"></div>
        </div>
        <p class="hint">${escapeHtml(view.scannerStatus)}</p>
        <label class="field">หรือวางโค้ด QR
          <input value="${escapeAttr(view.qrInput)}" data-action="qr-input" placeholder="@username" />
        </label>
        <div class="modal-actions">
          <button class="ghost" data-action="close-scanner">ปิด</button>
          <button class="primary" data-action="add-by-qr">เพิ่มจาก QR</button>
        </div>
      </div>
    </div>
  `;
}

function avatarHtml(src, name, extraClass = "") {
  return `<span class="avatar ${extraClass}">${src ? `<img src="${escapeAttr(src)}" alt="${escapeAttr(name)}" />` : initials(name)}</span>`;
}

function folderIcon(folder) {
  return {
    Main: "message-circle",
    Important: "star",
    Advertising: "megaphone",
    Request: "inbox",
    Group: "users",
    Work: "briefcase-business",
    Study: "book-open",
    Friends: "smile",
    Family: "home",
  }[folder] || "tag";
}

function fileIcon(name) {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return "file-text";
  if (["doc", "docx"].includes(ext)) return "file-type";
  if (["xls", "xlsx"].includes(ext)) return "sheet";
  if (ext === "zip") return "archive";
  return "file";
}

function showAuthError(text) {
  const error = document.querySelector("#auth-error");
  if (!error) return;
  error.textContent = text;
  error.classList.add("show");
}

function handleAuth(form, mode) {
  const data = new FormData(form);
  const username = String(data.get("username") || "").trim();
  const password = String(data.get("password") || "");
  if (!username) return showAuthError("กรุณากรอก Username");
  if (!password) return showAuthError("กรุณากรอก Password");
  if (mode === "login") {
    // login: case-insensitive username match
    const user = state.users.find(
      (item) => item.username.toLowerCase() === username.toLowerCase() && item.password === password
    );
    if (!user) return showAuthError("Username หรือ Password ไม่ถูกต้อง");
    sessionId = user.id;
    view.screen = "home";
    view._authUsername = "";
    view._authPassword = "";
    localStorage.setItem("taitalk:session", sessionId);
    render();
    return;
  }
  // register
  if (!/^[a-zA-Z0-9._]+$/.test(username)) return showAuthError("Username ใช้ได้เฉพาะ a-z, 0-9, . และ _");
  if (username.length < 3) return showAuthError("Username ต้องมีอย่างน้อย 3 ตัวอักษร");
  const confirm = String(data.get("confirm") || "");
  if (password !== confirm) return showAuthError("Password และ Confirm Password ต้องตรงกัน");
  if (password.length < 4) return showAuthError("Password ต้องมีอย่างน้อย 4 ตัวอักษร");
  if (state.users.some((item) => item.username.toLowerCase() === username.toLowerCase())) {
    return showAuthError("Username นี้ถูกใช้แล้ว");
  }
  const user = { id: `@${username.toLowerCase()}`, username, password, avatar: "", blocked: [] };
  state.users.push(user);
  saveState();
  sessionId = user.id;
  view.screen = "home";
  view._authUsername = "";
  view._authPassword = "";
  localStorage.setItem("taitalk:session", sessionId);
  render();
}

function applyBulkAction(type) {
  if (!view.selectedChatIds.length) return;
  for (const chat of state.chats.filter((item) => view.selectedChatIds.includes(item.id))) {
    if (type === "pin") chat.pinnedFor = unique([...(chat.pinnedFor || []), sessionId]);
    if (type === "mute") chat.mutedFor = unique([...(chat.mutedFor || []), sessionId]);
    if (type === "hide") chat.hiddenFor = unique([...(chat.hiddenFor || []), sessionId]);
    if (type === "read") {
      chat.unread[sessionId] = 0;
      chat.importantUnread[sessionId] = 0;
      chat.messages.forEach((message) => {
        if (message.senderId !== sessionId && !message.readAt) message.readAt = Date.now();
      });
    }
  }
  if (type === "delete") {
    state.chats.forEach((chat) => {
      if (view.selectedChatIds.includes(chat.id)) chat.hiddenFor = unique([...(chat.hiddenFor || []), sessionId]);
    });
  }
  view.selectedChatIds = [];
  view.manageMode = false;
  saveState();
  render();
}

function sendMessage(text, file) {
  const chat = state.chats.find((item) => item.id === view.chatId);
  if (!chat || (!text.trim() && !file)) return;
  const recipients = chat.members.filter((member) => member !== sessionId);
  if (recipients.some((member) => isBlocked(sessionId, member))) {
    alert("ไม่สามารถส่งข้อความได้ เนื่องจากมีการบล็อกผู้ใช้");
    return;
  }
  const category = classifyMessage(`${text} ${file?.name || ""}`);
  const now = Date.now();
  chat.messages.push({
    id: makeId("msg"),
    senderId: sessionId,
    text: text.trim(),
    file,
    createdAt: now,
    deliveredAt: now + 1000,
    readAt: null,
    hiddenFor: [],
    unsent: false,
    category,
  });
  chat.updatedAt = now;
  if (chat.tags.includes("Request")) {
    chat.tags = ["Main"];
    recipients.forEach((member) => addFriend(sessionId, member));
  }
  if (category === "advertising") chat.tags = unique(["Advertising", ...chat.tags.filter((tag) => tag !== "Important")]);
  if (category === "important" && !chat.tags.includes("Advertising")) chat.tags = unique(["Important", ...chat.tags]);
  if (chat.type === "group") chat.tags = unique(["Group", ...chat.tags]);
  for (const member of recipients) {
    chat.unread[member] = (chat.unread[member] || 0) + 1;
    if (category === "important" && !chat.tags.includes("Advertising")) chat.importantUnread[member] = (chat.importantUnread[member] || 0) + 1;
  }
  view.pendingFile = null;
  saveState();
  render();
}

function unique(items) {
  return [...new Set(items)];
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

app.addEventListener("submit", (event) => {
  event.preventDefault();
  const action = event.target.dataset.action;
  if (action === "login" || action === "register") handleAuth(event.target, action);
  if (action === "send-message") {
    const input = event.target.elements.message;
    sendMessage(input.value, view.pendingFile);
  }
  if (action === "submit-add-friend") {
    const input = event.target.querySelector("[data-action='add-friend-query']");
    if (input) view.addFriendQuery = input.value;
    const raw = view.addFriendQuery.trim().toLowerCase().replace(/^@+/, "");
    console.log("[search] raw:", raw);
    console.log("[search] all users:", state.users.map(u => u.username + " / " + u.id));
    console.log("[search] sessionId:", sessionId);
    if (!raw) return;
    const found = state.users.find(
      (u) => u.username.toLowerCase() === raw
    );
    console.log("[search] found:", found);
    if (!found) {
      view.addFriendResult = "notfound";
    } else if (found.id === sessionId) {
      view.addFriendResult = found;
    } else if (isBlocked(sessionId, found.id)) {
      view.addFriendResult = "notfound";
    } else {
      view.addFriendResult = found;
    }
    render();
  }
  if (action === "save-displayname") {
    const input = event.target.elements.displayname;
    const next = input?.value.trim();
    if (!next) return;
    currentUser().displayName = next;
    saveState();
    render();
  }
});

app.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  const action = event.target.dataset.action;
  if (action === "chat-search") {
    event.preventDefault();
    view.screen = "list";
    view.manageMode = false;
    render();
  }
});

app.addEventListener("input", (event) => {
  const action = event.target.dataset.action;
  if (action === "chat-search") {
    // เก็บค่าไว้เฉยๆ ไม่ render — รอกด Enter หรือปุ่มค้นหา
    view.search = event.target.value;
  }
  if (action === "add-friend-query") {
    // เก็บค่าไว้ แต่ไม่ render ทุก keystroke — รอกด "ค้นหา" ก่อน
    view.addFriendQuery = event.target.value;
    view.addFriendResult = null;
  }
  if (action === "people-search") {
    view.peopleSearch = event.target.value;
    // ไม่ render ทุก keystroke
  }
  if (action === "new-folder-name") view.newFolderName = event.target.value;
  if (action === "group-draft") view.groupDraft = event.target.value;
  if (action === "group-member-draft") view.groupMemberDraft = event.target.value;
  if (action === "qr-input") view.qrInput = event.target.value;
});

app.addEventListener("change", (event) => {
  const action = event.target.dataset.action;
  if (action === "profile-avatar") {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      alert("กรุณาเลือกรูปภาพ");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      currentUser().avatar = reader.result;
      saveState();
      render();
    };
    reader.readAsDataURL(file);
  }
  if (action === "file-input") {
    const file = event.target.files?.[0];
    if (!file) return;
    const allowed = ["image/", "application/pdf", "application/zip", "application/x-zip-compressed"];
    const extOk = /\.(docx?|xlsx?|zip|pdf)$/i.test(file.name);
    if (!allowed.some((type) => file.type.startsWith(type)) && !extOk) {
      alert("รองรับเฉพาะรูปภาพ, PDF, Word, Excel และ ZIP");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      view.pendingFile = { name: file.name, type: file.type || "file", url: reader.result };
      render();
    };
    reader.readAsDataURL(file);
  }
  if (action === "folder-setting") {
    const folder = event.target.dataset.folder;
    const key = event.target.dataset.key;
    ensureFolderSetting(folder)[key] = event.target.checked;
    saveState();
    render();
  }
  if (action === "font-size") {
    state.appSettings.fontSize = event.target.value;
    saveState();
    render();
  }
  if (action === "language") {
    state.appSettings.language = event.target.value;
    saveState();
    render();
  }
  if (action === "theme-toggle") {
    state.appSettings.theme = event.target.checked ? "dark" : "light";
    saveState();
    render();
  }
});

app.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;

  if (action === "auth-tab") {
    // อ่านค่า input ปัจจุบันก่อน render ใหม่
    const usernameInput = document.querySelector(".form [name='username']");
    const passwordInput = document.querySelector(".form [name='password']");
    view._authUsername = usernameInput?.value || "";
    view._authPassword = passwordInput?.value || "";
    view.authMode = target.dataset.mode;
    render();
  }
  if (action === "logout") {
    sessionId = null;
    localStorage.removeItem("taitalk:session");
    view.screen = "home";
    view.authMode = "register";
    render();
  }
  if (action === "folder") {
    view.folder = target.dataset.folder;
    view.chatId = null;
    view.screen = "list";
    view.manageMode = false;
    render();
  }
  if (action === "bottom-nav") {
    view.screen = target.dataset.screen;
    if (target.dataset.tab) view.detailTab = target.dataset.tab;
    view.manageMode = false;
    render();
  }
  if (action === "toggle-manage") {
    view.screen = "list";
    view.manageMode = !view.manageMode;
    view.selectedChatIds = [];
    render();
  }
  if (action === "submit-search") {
    view.screen = "list";
    view.manageMode = false;
    render();
  }
  if (action === "toggle-chat-select") {
    const chatId = target.dataset.chat;
    view.selectedChatIds = view.selectedChatIds.includes(chatId)
      ? view.selectedChatIds.filter((id) => id !== chatId)
      : [...view.selectedChatIds, chatId];
    render();
  }
  if (action === "bulk-chat") {
    applyBulkAction(target.dataset.bulk);
  }
  if (action === "select-chat") {
    view.chatId = target.dataset.chat;
    view.screen = "chat";
    const chat = state.chats.find((item) => item.id === view.chatId);
    if (chat) {
      chat.unread[sessionId] = 0;
      chat.importantUnread[sessionId] = 0;
      chat.messages.forEach((message) => {
        if (message.senderId !== sessionId && !message.readAt) message.readAt = Date.now();
      });
      saveState();
    }
    render();
  }
  if (action === "detail-tab") {
    if (target.classList.contains("profile-button") && document.querySelector(".app-shell")?.classList.contains("header-compact")) {
      document.querySelector(".app-shell")?.classList.toggle("folder-peek");
      return;
    }
    view.detailTab = target.dataset.tab;
    view.screen = "tools";
    view.manageMode = false;
    render();
  }
  if (action === "back-list") {
    view.screen = "list";
    render();
  }
  if (action === "call") {
    view.modalTitle = "ฟีเจอร์นี้ยังไม่พร้อมใช้งาน";
    view.modalBody = "Voice Call และ Video Call จะแสดง popup เท่านั้นใน V1";
    render();
    document.querySelector("#modal")?.classList.add("show");
  }
  if (action === "coming-soon") {
    view.modalTitle = "ฟีเจอร์นี้ยังไม่พร้อมใช้งาน";
    view.modalBody = `${target.dataset.feature || "ฟีเจอร์นี้"} จะเปิดใช้งานในเวอร์ชันถัดไป`;
    render();
    document.querySelector("#modal")?.classList.add("show");
  }
  if (action === "close-modal") {
    document.querySelector("#modal")?.classList.remove("show");
  }
  if (action === "open-scanner") {
    view.scannerOpen = true;
    view.scannerStatus = "กำลังเตรียมกล้อง...";
    render();
  }
  if (action === "close-scanner") {
    view.scannerOpen = false;
    stopQrScanner();
    render();
  }
  if (action === "clear-file") {
    view.pendingFile = null;
    render();
  }
  if (action === "delete-self") {
    const chat = state.chats.find((item) => item.id === target.dataset.chat);
    const message = chat?.messages.find((item) => item.id === target.dataset.message);
    if (message) {
      message.hiddenFor = unique([...(message.hiddenFor || []), sessionId]);
      saveState();
      render();
    }
  }
  if (action === "unsend") {
    const chat = state.chats.find((item) => item.id === target.dataset.chat);
    const message = chat?.messages.find((item) => item.id === target.dataset.message);
    if (message && (Date.now() - message.createdAt) / 36e5 <= 24) {
      message.unsent = true;
      message.text = "";
      message.file = null;
      saveState();
      render();
    }
  }
  if (action === "search-add-friend") {
    const raw = view.addFriendQuery.trim().toLowerCase().replace(/^@+/, "");
    if (!raw) { render(); return; }
    const found = state.users.find(
      (u) => u.username.toLowerCase() === raw
    );
    if (!found) {
      view.addFriendResult = "notfound";
    } else if (isBlocked(sessionId, found.id)) {
      view.addFriendResult = "notfound";
    } else {
      view.addFriendResult = found;
    }
    render();
  }
  if (action === "add-friend-confirm") {
    const otherId = target.dataset.user;
    addFriend(sessionId, otherId);
    const chat = ensureChatForUser(otherId);
    // Update chat tags to Main since they're now friends
    if (chat.tags.includes("Request")) chat.tags = ["Main"];
    view.addFriendResult = null;
    view.addFriendQuery = "";
    view.folder = "Main";
    view.chatId = chat.id;
    view.screen = "chat";
    saveState();
    render();
  }
  if (action === "add-friend" || action === "open-user-chat") {
    const otherId = target.dataset.user;
    if (action === "add-friend") addFriend(sessionId, otherId);
    const chat = ensureChatForUser(otherId);
    view.folder = chat.tags.includes("Request") ? "Request" : "Main";
    view.chatId = chat.id;
    view.screen = "chat";
    view.manageMode = false;
    saveState();
    render();
  }
  if (action === "create-folder") {
    const name = view.newFolderName.trim();
    if (!name) return;
    if (folderNames().some((folder) => folder.toLowerCase() === name.toLowerCase())) {
      alert("มี Folder นี้แล้ว");
      return;
    }
    state.customFolders = unique([...(state.customFolders || []), name]);
    state.folderSettings[name] = defaultFolderSetting(name);
    view.newFolderName = "";
    view.folder = name;
    saveState();
    render();
  }
  if (action === "delete-folder") {
    const folder = target.dataset.folder;
    state.customFolders = (state.customFolders || []).filter((item) => item !== folder);
    delete state.folderSettings[folder];
    state.chats.forEach((chat) => {
      chat.tags = chat.tags.filter((tag) => tag !== folder);
      if (!chat.tags.length) chat.tags = ["Main"];
    });
    if (view.folder === folder) view.folder = "Main";
    saveState();
    render();
  }
  if (action === "add-by-qr") {
    addFriendFromCode(view.qrInput);
  }
  if (action === "copy-id") {
    const code = currentUser().id;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(code).then(() => alert("คัดลอก ID แล้ว"));
    } else {
      window.prompt("คัดลอก TaiTalk ID", code);
    }
  }
  if (action === "copy-qr") {
    const code = friendCode(currentUser());
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(code).then(() => alert("คัดลอก QR Code แล้ว"));
    } else {
      window.prompt("คัดลอก QR Code", code);
    }
  }
  if (action === "block-user") {
    const user = currentUser();
    user.blocked = unique([...(user.blocked || []), target.dataset.user]);
    state.chats = state.chats.filter((chat) => !(chat.type === "direct" && chat.members.includes(sessionId) && chat.members.includes(target.dataset.user)));
    view.chatId = null;
    saveState();
    render();
  }
  if (action === "save-username") {
    const input = document.querySelector("[data-action='username-input']");
    const next = input?.value.trim();
    if (!next) return;
    if (state.users.some((user) => user.id !== sessionId && user.username.toLowerCase() === next.toLowerCase())) {
      alert("Username นี้ถูกใช้แล้ว");
      return;
    }
    currentUser().username = next;
    saveState();
    render();
  }
  if (action === "create-group") {
    const name = view.groupDraft.trim();
    if (!name) return;
    const chat = {
      id: makeId("group"),
      type: "group",
      name,
      photo: "",
      members: [sessionId],
      tags: ["Group"],
      unread: {},
      importantUnread: {},
      updatedAt: Date.now(),
      messages: [],
    };
    state.chats.push(chat);
    view.groupDraft = "";
    view.folder = "Group";
    view.chatId = chat.id;
    view.screen = "chat";
    saveState();
    render();
  }
  if (action === "save-group") {
    const chat = state.chats.find((item) => item.id === target.dataset.chat);
    const nameInput = document.querySelector("[data-action='group-name']");
    const photoInput = document.querySelector("[data-action='group-photo']");
    if (chat) {
      chat.name = nameInput?.value.trim() || chat.name;
      chat.photo = photoInput?.value.trim() || "";
      saveState();
      render();
    }
  }
  if (action === "add-member") {
    const chat = state.chats.find((item) => item.id === target.dataset.chat);
    if (chat && view.groupMemberDraft) {
      chat.members = unique([...chat.members, view.groupMemberDraft]);
      view.groupMemberDraft = "";
      saveState();
      render();
    }
  }
  if (action === "remove-member") {
    const chat = state.chats.find((item) => item.id === target.dataset.chat);
    if (chat) {
      chat.members = chat.members.filter((id) => id !== target.dataset.user);
      saveState();
      render();
    }
  }
});

render();
