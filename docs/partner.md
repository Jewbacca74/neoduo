# Creative partner prototype

NeoDuo is an independent fork of Hugh Howey’s MIT-licensed NEO. This first
milestone adds a conversational partner to Manuscript and Outline. It does not
apply AI edits. Brainstorming is useful even with a blank book.

## Run locally

Requirements: Node.js, dependencies from `npm ci`, and Codex CLI on PATH.
The protocol was checked against Codex CLI 0.157.1. On Arch, `npm start` uses
system Electron matching the installed npm Electron major when available.
Otherwise it uses the npm Electron runtime.

```sh
npm ci
npm start
```

Create or open a book, click **Partner**, then **Sign in with ChatGPT**. Complete
the browser sign-in and return to the app. Subscription model access and limits
apply. If Codex isn't on the desktop's PATH, launch with
`NEODUO_CODEX_BIN=/absolute/path/to/codex npm start`.

One saved conversation accompanies each book across Manuscript and Outline.
Messages use a Send button; Enter remains a newline. Stop interrupts a reply.
The panel can be closed without cancelling a response. Switching books keeps
histories separate; this prototype permits one active response at a time.

Outline and current-chapter context are opt-in. Preview the snapshot before
sending. The current chapter is the one selected in the manuscript. Messages
and selected context go to OpenAI. Unchecking a box stops including new
snapshots; it does not erase previously shared conversation context. A 64,000
character context limit is enforced without silently truncating the book.

## Storage and boundaries

- Default library: `~/Documents/NeoDuo Library`, separate from NEO.
- Each book stores its readable conversation in `partner.json`.
- Codex sessions and browser-login credentials live under NeoDuo's Electron
  user-data directory in `partner-codex`. The credential cache is Codex-managed
  `auth.json`, protected by a user-only directory; it is not part of library backups.
- NeoDuo does not read or copy another Codex client's authentication file.
- Codex starts in an empty working directory with a dedicated `CODEX_HOME`,
  read-only sandbox, no escalation, and shell, apps, plugins, browser, computer,
  image-generation and multi-agent features disabled. Server requests for tools
  or approvals are rejected. There are no manuscript-editing tools in the panel.
- Manuscripts remain in the editor's existing storage format. During development,
  import a copy of a NEO manuscript rather than pointing both apps at one library.

For isolated desktop tests, set `NEODUO_DATA_DIR` to an existing temporary
directory and put a `settings.json` there with a `libraryDir` pointing at a
temporary sample library.

## Validation and limits

`npm test` covers persistence, book isolation, resume, interruption, malformed
input/history and authentication URL validation. A real local app-server
handshake and a short fictional ChatGPT conversation were also exercised.
Electron UI checks covered both views, context preview and signed-out controls.

This is a development prototype, not a packaged release. Linux AppImage update
configuration points at Jewbacca74/neoduo; a native package repository is not
configured. The inherited macOS workflow needs the fork maintainer's signing
secrets before it can produce signed releases.

Next: user testing with an actual story, pinned decisions/story notes, managing
multiple conversations, model selection, and later explicit edit proposals.
Conversation recovery currently requires the local Codex session as well as
`partner.json`; copying only the library preserves readable history but not the
Codex session. Expired/missing sessions surface an error rather than silently
starting over.

References: [App Server](https://learn.chatgpt.com/docs/app-server),
[authentication](https://learn.chatgpt.com/docs/auth).
