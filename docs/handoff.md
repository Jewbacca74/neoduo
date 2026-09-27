# NeoDuo development handoff

Last updated: 2026-09-26. Read this alongside `docs/partner.md` and inspect the
current branch before making changes. This is project context, not a record of
the author's private book content.

## Where work lives

- Fork: https://github.com/Jewbacca74/neoduo
- Upstream: https://github.com/hughhowey/neo
- Active branch: `feat/creative-partner`
- Draft PR: https://github.com/Jewbacca74/neoduo/pull/1
- Latest application change at this handoff: `d493b6d`, independent Partner scrolling.
- Linux checkout: `/home/lee/Work/neoduo`. Other computers can use any directory.

## Product intent and implemented behavior

The author wants a creative partner for incubating a novel, available in both
Outline and Manuscript. Prefer ChatGPT sign-in over requiring an API key.
Conversational support comes first; future edits must be proposed and explicitly
approved. The current agent cannot edit the book.

Implemented: Codex App Server integration with an isolated per-app login/session
directory, per-book conversation, opt-in outline/chapter context, editable Markdown
memory automatically included each turn, reviewed summary drafts, note revision
backups, optional new-book title, Ctrl+Enter/Command+Enter sending, a remembered
resizable sidebar, and independent sidebar scrolling.

## Continue on another desktop

Install Git, Node.js/npm, and Codex CLI. Authenticate GitHub separately for pushes;
use NeoDuo's own ChatGPT sign-in for its Partner. Do not copy credential caches.

```sh
git clone --branch feat/creative-partner https://github.com/Jewbacca74/neoduo.git
cd neoduo
npm ci
npm test
npm start
```

For an existing checkout, inspect `git status` first, switch to the feature branch,
and use `git pull --ff-only` with a clean working tree. Commit and push completed
work before moving computers; install dependencies on each machine instead of
copying `node_modules`. Avoid simultaneous edits to the same branch on two machines.

Suggested opening message for a fresh coding session:

> Read docs/handoff.md and docs/partner.md, inspect the current branch and PR #1,
> and continue NeoDuo. Preserve the conversational-first design and review before
> applying AI edits. Our next priorities are desktop portability and portable
> book/Partner continuity, with iPhone/iPad support as a later possibility.

## Verification status

Linux: 11 service/persistence tests passed. Isolated Electron UI checks exercised
book creation, memory editing, shortcut behavior, sidebar resize/persistence, and
independent scrolling. ChatGPT sign-in and a real fictional conversation/summary
were tested. The temporary UI scripts were outside the repo; make repeatable,
checked-in platform tests before relying on them as CI coverage.

Windows and macOS: package targets exist, but the new Partner integration has not
been tested on either. Verify Codex executable discovery/process startup, login,
streaming/cancel, restart recovery, file paths, shortcuts, and packaged launches.
Inherited `.github/workflows/build.yml` needs adaptation: the Windows smoke test
still expects `NEO Library`, and the macOS job assumes signing secrets. It runs
on version tags or manual dispatch, not every PR. Do not claim cross-platform
validation based only on the existing build configuration.

## Data and portability gap

Application code is in GitHub. Private manuscripts and Partner data are in the
user's separate NeoDuo Library, not the source repository.

Copying a book preserves `partner.json` and Markdown transcript/memory, but live
conversation resume currently also requires a local Codex session under the app's
`partner-codex` directory. Missing sessions currently produce an error. Implement
an explicit continuation path using portable book memory and selected history on
a newly authenticated machine; explain when a fresh provider session is created.
Do not treat a thread ID as portable or synchronize authentication tokens.

Library syncing still needs a chosen transport, conflict handling, and recovery
testing. Until then, use copies for cross-platform tests and avoid concurrently
editing the same library on multiple devices.

## Possible mobile direction

The inherited `pocket/` is an Android Capacitor companion, not a completed iOS
port and not an implementation of Partner. Evaluate shared UI/storage components
and an iOS Capacitor target on a Mac with Xcode. The desktop Electron/Node process
that launches Codex cannot simply be reused inside the mobile app. A paired
desktop agent service or another supported backend/authentication architecture
must be designed and verified before promising mobile ChatGPT sign-in parity.
