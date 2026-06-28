# TaiTalk V1

TaiTalk V1 is a local-first LINE-style chat prototype that implements the final feature requirements:

- Username/password registration with password confirmation
- Immutable @username handle
- Profile photo upload and persistent avatar display
- Friend search by @username or Username
- Friend add by TaiTalk QR Code
- Real QR image generation and camera QR scanning with manual code fallback
- Custom folder creation and separate folder notification settings
- Mobile Home hub with LINE-style service shortcuts
- Bulk chat management for pin, mark read, mute, hide, and delete
- Global search bar for users, usernames, chat names, messages, and files
- Media library for all shared photos and files
- VOOM, Today, and Wallet prototype pages
- Appearance settings for font size and dark theme
- Language setting for Thai or English
- Message Requests for non-friends, promoted to Main after reply
- Group chat creation, member management, group name/photo editing
- File sharing for images, PDF, Word, Excel, and ZIP with preview/name before sending
- Sent, delivered, and read status with time display
- Delete for self and Unsend within 24 hours
- Block behavior for search, profile visibility, and messaging
- No online, last seen, or typing indicators
- Search across chats, messages, images/files, and groups
- LINE-style green, white, and light gray theme
- Normal and Important message handling
- Keyword-based Advertising filter
- Per-folder/tag notification settings
- Voice Call and Video Call buttons that show a safe popup only

Run locally with the realtime server:

```sh
npm start
```

Then open `http://localhost:3000`.

## TaiTalk V2 prototype

Open `http://localhost:3000/v2` for the V2 prototype. V2 keeps the familiar LINE-style flow, but adds account-specific settings and AI-assisted chat tools:

- Per-account folders, theme, language, notification, AI, privacy, reminders, and pinned files
- AI chat categorization with user overrides and per-chat AI privacy toggle
- AI Search across chats, files, photos, and natural-language questions
- File Hub for shared images, PDF, Word, Excel, PowerPoint, ZIP, video, and Canva links
- AI chat summary, daily summary, writing assistant, and one-tap translation
- Smart reminder cards from messages that mention deadlines or appointments
- Priority notification center, onboarding tutorial, backup, and restore

## TaiTalk V.b1 prototype

Open `http://localhost:3000/v.b1` or `http://localhost:3000/vb1` for V.b1. This page currently mirrors V2 and adds a LIFF Login button.

Create a LIFF app in the same LINE Login channel and set the LIFF Endpoint URL to:

```text
https://taithai-tai.github.io/taitalk-v1/vb1/
```

Current LIFF app:

```text
LIFF ID: 2008685502-SecJ7r28
LIFF URL: https://liff.line.me/2008685502-SecJ7r28
```

Open V.b1 with the backend URL:

```text
https://taithai-tai.github.io/taitalk-v1/vb1/?apiBase=https://your-railway-domain.up.railway.app
```

When LIFF Login succeeds, the browser sends the LIFF access token to the TaiTalk server. The server verifies it with LINE, creates or reuses a TaiTalk account linked to the real LINE user ID, and logs the user in. If no backend `apiBase` is configured, V.b1 can still create a local LIFF profile account for UI testing, but cross-device sync needs the backend URL.

Optional OpenRouter AI setup:

```sh
OPENROUTER_API_KEY=your_key_here
OPENROUTER_MODEL=openai/gpt-oss-120b:free
```

Create a `.env` file in the project root with those values, then restart the server. If `OPENROUTER_API_KEY` is missing or the API call fails, TaiTalk automatically uses mock AI responses so the prototype still works.

Deploy on Railway:

1. Create a Railway project from this GitHub repository.
2. Railway will detect the Node app and run `npm start`.
3. Generate a public domain in Railway Networking.
4. Open that Railway URL on every phone. All phones will use the same server state and realtime sync.

For durable production data, configure Firebase Firestore on the server. TaiTalk reads and writes the whole app state to `appState/taitalk` when `FIREBASE_SERVICE_ACCOUNT_BASE64` is set, and falls back to the local JSON file only when Firebase is not configured or unavailable.

Firebase environment variables:

```sh
FIREBASE_SERVICE_ACCOUNT_BASE64=base64_encoded_service_account_json
FIREBASE_PROJECT_ID=your-firebase-project-id
FIREBASE_STATE_COLLECTION=appState
FIREBASE_STATE_DOC=taitalk
```

On Railway, add those values under Variables, then redeploy. Check `/api/health`; it should return `"storage":"firebase"` when Firebase is active.

Accounts are stored on the server through the auth API, so users can log in again with the same username and password after signing up once. With Firebase configured, data survives Railway redeploys without a Railway Volume.

You can still open `index.html` directly for offline UI testing, but cross-device sync only works through the Node server.

The app now starts on the registration screen. Create a new account first, then use the friend search or QR scanner to find `mali`, `narin`, or `studyteam` for testing chats.

Test QR codes:

- `TAITALK:@mali:mali`
- `TAITALK:@narin:narin`
- `TAITALK:@studyteam:studyteam`
