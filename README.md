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

Open `http://localhost:3000/v.b1` or `http://localhost:3000/vb1` for V.b1. This page currently mirrors V2 and adds a LINE Login button.

LINE Login in V.b1 uses LINE OAuth when these server environment variables are set:

```sh
LINE_CHANNEL_ID=your_line_login_channel_id
LINE_CHANNEL_SECRET=your_line_login_channel_secret
LINE_CALLBACK_URL=https://your-railway-domain.up.railway.app/api/auth/line/callback
```

Add the same `LINE_CALLBACK_URL` in the LINE Developers Console under the LINE Login channel callback URLs. If you open the app from GitHub Pages instead of Railway, include the backend URL once so the browser can remember it:

```text
https://taithai-tai.github.io/taitalk-v1/vb1/?apiBase=https://your-railway-domain.up.railway.app
```

When LINE Login succeeds, the server creates or reuses a TaiTalk account linked to the real LINE user ID, then returns the user to V.b1.

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

For durable production data, attach a Railway Volume. TaiTalk will automatically use `/data` when that mount exists, or you can set `DATA_DIR` to the mounted path yourself.

Accounts are stored on the server through the auth API, so users can log in again with the same username and password after signing up once. Without a Railway Volume, Railway can still lose file data when the service is redeployed or rebuilt.

You can still open `index.html` directly for offline UI testing, but cross-device sync only works through the Node server.

The app now starts on the registration screen. Create a new account first, then use the friend search or QR scanner to find `mali`, `narin`, or `studyteam` for testing chats.

Test QR codes:

- `TAITALK:@mali:mali`
- `TAITALK:@narin:narin`
- `TAITALK:@studyteam:studyteam`
