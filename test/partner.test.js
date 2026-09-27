const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PartnerService } = require('../partner-service');

class MockCodex extends EventEmitter {
  constructor() { super(); this.calls = []; this.cwd = '/empty-workspace'; this.signedIn = true; this.next = 0; }
  async start() {}
  stop() {}
  async request(method, params) {
    this.calls.push({ method, params });
    if (method === 'account/read') return { account: this.signedIn ? { type: 'chatgpt', email: 'writer@example.com' } : null };
    if (method === 'account/login/start') return { loginId: 'login', authUrl: 'https://auth.openai.com/authorize?test=1' };
    if (method === 'thread/start') return { thread: { id: 'thread-' + ++this.next } };
    if (method === 'thread/resume') return { thread: { id: params.threadId } };
    if (method === 'turn/start') return { turn: { id: 'turn-1' } };
    return {};
  }
}
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neoduo-test-'));
  for (const id of ['book-one', 'book-two']) {
    fs.mkdirSync(path.join(root, id));
    fs.writeFileSync(path.join(root, id, 'book.json'), '{}');
    fs.writeFileSync(path.join(root, id, 'manuscript.html'), 'Original prose');
  }
  const client = new MockCodex(); const opened = [];
  const options = { home: root, libraryDir: () => root, client, openExternal: async url => opened.push(url) };
  const service = new PartnerService(options);
  t.after(() => { service.stop(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, client, service, options, opened };
}
test('streams and persists separate book conversations without changing manuscript', async t => {
  const { root, client, service, options } = setup(t);
  await service.send({ bookId: 'book-one', text: 'What if the lighthouse moves?', context: 'A coastal town' });
  client.emit('notification', 'item/agentMessage/delta', { threadId: 'thread-1', delta: 'Who notices first?' });
  client.emit('notification', 'turn/completed', { threadId: 'thread-1', turn: { status: 'completed' } });
  assert.equal(service.snapshot('book-one').messages[1].text, 'Who notices first?');
  assert.equal(service.snapshot('book-two').messages.length, 0);
  const restored = new PartnerService({ ...options, client: new MockCodex() });
  assert.equal(restored.snapshot('book-one').messages.length, 2);
  await restored.send({ bookId: 'book-one', text: 'The keeper’s daughter.' });
  assert.ok(restored.client.calls.some(c => c.method === 'thread/resume'));
  restored.stop();
  assert.equal(fs.readFileSync(path.join(root, 'book-one', 'manuscript.html'), 'utf8'), 'Original prose');
});
test('enforces conversation boundaries and blocks simultaneous turns', async t => {
  const { client, service } = setup(t);
  await service.send({ bookId: 'book-one', text: 'Help me brainstorm.' });
  const start = client.calls.find(c => c.method === 'thread/start').params;
  assert.equal(start.sandbox, 'read-only');
  assert.equal(start.approvalPolicy, 'never');
  assert.equal(start.config['features.shell_tool'], false);
  assert.equal(start.config['features.apps'], false);
  await assert.rejects(service.send({ bookId: 'book-two', text: 'Another book' }), /already in progress/);
  assert.equal(service.snapshot('book-two').otherBusy, true);
  await service.cancel('book-two');
  assert.equal(client.calls.filter(c => c.method === 'turn/interrupt').length, 0);
  await service.cancel('book-one');
  assert.deepEqual(client.calls.at(-1), { method: 'turn/interrupt', params: { threadId: 'thread-1', turnId: 'turn-1' } });
});
test('rejects traversal, invalid context, and unsigned-in requests', async t => {
  const { client, service } = setup(t);
  assert.throws(() => service.snapshot('../book-one'), /Invalid book/);
  await assert.rejects(service.send({ bookId: 'book-one', text: 'hello', context: 'x'.repeat(64001) }), /too large/);
  client.signedIn = false;
  await assert.rejects(service.send({ bookId: 'book-one', text: 'hello' }), /Sign in/);
  assert.equal(service.snapshot('book-one').messages.length, 0);
});
test('login opens official browser URL and rejects arbitrary URLs', async t => {
  const { client, service, opened } = setup(t);
  await service.login();
  assert.match(opened[0], /^https:\/\/auth.openai.com\//);
  client.request = async () => ({ authUrl: 'https://example.org/phishing', loginId: 'bad' });
  await assert.rejects(service.login(), /unexpected sign-in/);
  assert.equal(opened.length, 1);
});
test('connection loss preserves partial text and releases busy state', async t => {
  const { client, service } = setup(t);
  await service.send({ bookId: 'book-one', text: 'A new premise' });
  client.emit('notification', 'item/agentMessage/delta', { threadId: 'thread-1', delta: 'One possibility' });
  client.emit('disconnected', 'Lost connection');
  const state = service.snapshot('book-one');
  assert.equal(state.busy, false);
  assert.equal(state.messages[1].status, 'interrupted');
  assert.equal(state.messages[1].text, 'One possibility');
});
test('corrupt conversation history is preserved instead of overwritten', t => {
  const { root, service } = setup(t);
  const file = path.join(root, 'book-two', 'partner.json');
  fs.writeFileSync(file, '{broken');
  assert.throws(() => service.snapshot('book-two'), /preserved/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
});

test('exports existing history as Markdown and preserves edited notes on reopen', async t => {
  const { root, service, options } = setup(t);
  const history = { version: 1, threadId: 'original-thread', messages: [{ role: 'user', text: 'A lighthouse premise', at: '2026-09-27' }] };
  const file = path.join(root, 'book-one', 'partner.json');
  fs.writeFileSync(file, JSON.stringify(history));
  const original = fs.readFileSync(file, 'utf8');
  service.snapshot('book-one');
  const dir = path.join(root, 'book-one', 'partner');
  assert.match(fs.readFileSync(path.join(dir, 'conversation.md'), 'utf8'), /A lighthouse premise/);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
  fs.writeFileSync(path.join(dir, 'story-decisions.md'), '# Canon\nThe island has no trees.');
  const restored = new PartnerService({ ...options, client: new MockCodex() });
  restored.snapshot('book-one');
  assert.match(restored.readMemory('book-one').notes.decisions, /no trees/);
  restored.stop();
});

test('loads fresh local memory every turn without sharing another book’s notes', async t => {
  const { root, client, service } = setup(t);
  const original = service.readMemory('book-one');
  service.writeMemory({ bookId: 'book-one', notes: { ...original.notes, decisions: 'The keeper is Mara.' }, revisions: original.revisions });
  await service.send({ bookId: 'book-one', text: 'Help me explore.' });
  assert.match(client.calls.find(c => c.method === 'turn/start').params.input[0].text, /keeper is Mara/);
  client.emit('notification', 'turn/completed', { threadId: 'thread-1', turn: { status: 'completed' } });
  fs.writeFileSync(path.join(root, 'book-one', 'partner', 'story-decisions.md'), 'The keeper is Rowan.');
  await service.send({ bookId: 'book-one', text: 'Who is the keeper?' });
  assert.match(client.calls.at(-1).params.input[0].text, /keeper is Rowan/);
  assert.doesNotMatch(client.calls.at(-1).params.input[0].text, /keeper is Mara/);
  client.emit('notification', 'turn/completed', { threadId: 'thread-1', turn: { status: 'completed' } });
  await service.send({ bookId: 'book-two', text: 'New idea' });
  assert.doesNotMatch(client.calls.at(-1).params.input[0].text, /Rowan/);
});

test('summary generation writes a review draft without replacing author memory', async t => {
  const { client, service } = setup(t);
  const original = service.readMemory('book-one');
  service.writeMemory({ bookId: 'book-one', notes: { summary: 'My original recap', decisions: 'Only one island.', questions: 'Who built it?' }, revisions: original.revisions });
  await service.summarize('book-one');
  client.emit('notification', 'item/agentMessage/delta', { threadId: 'thread-1', delta: '# Where we are\nA possible island mystery.' });
  client.emit('notification', 'turn/completed', { threadId: 'thread-1', turn: { status: 'completed' } });
  const memory = service.readMemory('book-one');
  assert.match(memory.draft, /possible island/);
  assert.equal(memory.notes.summary, 'My original recap');
  assert.equal(memory.notes.decisions, 'Only one island.');
  assert.equal(memory.notes.questions, 'Who built it?');
  const accepted = service.writeMemory({ bookId: 'book-one', notes: { ...memory.notes, summary: memory.draft + '\nReviewed by the author.' }, revisions: memory.revisions, acceptedDraftRevision: memory.draftRevision });
  assert.equal(accepted.draft, null);
  assert.match(accepted.notes.summary, /Reviewed by the author/);
  assert.equal(accepted.notes.decisions, 'Only one island.');
});

test('external edits cause a conflict, and approved note updates preserve prior versions', t => {
  const { root, service } = setup(t);
  const old = service.readMemory('book-one');
  const file = path.join(root, 'book-one', 'partner', 'summary.md');
  fs.writeFileSync(file, 'Edited outside NeoDuo');
  assert.throws(() => service.writeMemory({ bookId: 'book-one', notes: old.notes, revisions: old.revisions }), /changed outside/);
  const fresh = service.readMemory('book-one');
  service.writeMemory({ bookId: 'book-one', notes: { ...fresh.notes, summary: 'Approved new recap' }, revisions: fresh.revisions });
  const backups = fs.readdirSync(path.join(root, 'book-one', 'partner', 'history'));
  assert.equal(fs.readFileSync(path.join(root, 'book-one', 'partner', 'history', backups[0], 'summary.md'), 'utf8'), 'Edited outside NeoDuo');
});

test('interrupted summary never promotes partial text into memory or a completed draft', async t => {
  const { client, service } = setup(t);
  await service.summarize('book-one');
  client.emit('notification', 'item/agentMessage/delta', { threadId: 'thread-1', delta: 'Half a recap' });
  client.emit('notification', 'turn/completed', { threadId: 'thread-1', turn: { status: 'interrupted' } });
  assert.equal(service.readMemory('book-one').draft, null);
  assert.equal(service.readMemory('book-one').notes.summary, '');
  assert.equal(service.snapshot('book-one').messages.at(-1).text, 'Half a recap');
});
