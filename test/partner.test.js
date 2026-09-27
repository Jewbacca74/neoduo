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
