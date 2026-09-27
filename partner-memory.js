'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const NOTES = {
  summary: { file: 'summary.md', label: 'Summary' },
  decisions: { file: 'story-decisions.md', label: 'Story decisions' },
  questions: { file: 'open-questions.md', label: 'Open questions' },
};
const revision = text => createHash('sha256').update(text).digest('hex');
function atomicWrite(file, text) {
  const temp = file + '.' + randomUUID() + '.tmp';
  try { fs.writeFileSync(temp, text, { mode: 0o600 }); fs.renameSync(temp, file); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
function fenced(text) {
  const runs = String(text).match(/`+/g) || [];
  const fence = '`'.repeat(Math.max(3, ...runs.map(run => run.length + 1)));
  return `${fence}text\n${text}\n${fence}`;
}

class PartnerMemory {
  constructor(bookFile) { this.bookFile = bookFile; }
  dir(bookId) {
    const dir = path.join(path.dirname(this.bookFile(bookId)), 'partner');
    fs.mkdirSync(dir, { recursive: true });
    for (const { file } of Object.values(NOTES)) {
      try { fs.writeFileSync(path.join(dir, file), '', { flag: 'wx', mode: 0o600 }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    return dir;
  }
  read(bookId) {
    const dir = this.dir(bookId);
    const notes = {}, revisions = {};
    for (const [key, { file }] of Object.entries(NOTES)) {
      notes[key] = fs.readFileSync(path.join(dir, file), 'utf8');
      revisions[key] = revision(notes[key]);
    }
    const draftPath = path.join(dir, 'summary-draft.md');
    const draft = fs.existsSync(draftPath) ? fs.readFileSync(draftPath, 'utf8') : null;
    return { notes, revisions, draft, draftRevision: draft === null ? null : revision(draft) };
  }
  write(bookId, notes, revisions, acceptedDraftRevision) {
    const current = this.read(bookId);
    if (acceptedDraftRevision && acceptedDraftRevision !== current.draftRevision) throw new Error('The summary draft changed. Reopen Book memory to review the latest draft.');
    for (const key of Object.keys(NOTES)) {
      if (typeof notes?.[key] !== 'string' || notes[key].length > 16000) throw new Error('Each book-memory note must be at most 16,000 characters.');
      if (revisions?.[key] !== current.revisions[key]) throw new Error('Book memory changed outside this window. Copy your edits, reopen Book memory, and try again.');
    }
    const dir = this.dir(bookId);
    const changed = Object.keys(NOTES).filter(key => notes[key] !== current.notes[key]);
    if (changed.length) {
      const backup = path.join(dir, 'history', new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
      fs.mkdirSync(backup, { recursive: true });
      for (const key of changed) atomicWrite(path.join(backup, NOTES[key].file), current.notes[key]);
      for (const key of changed) atomicWrite(path.join(dir, NOTES[key].file), notes[key]);
    }
    if (acceptedDraftRevision) {
      const backup = path.join(dir, 'history', 'accepted-draft-' + randomUUID() + '.md');
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      atomicWrite(backup, current.draft);
      fs.unlinkSync(path.join(dir, 'summary-draft.md'));
    }
    return this.read(bookId);
  }
  context(bookId) {
    const { notes } = this.read(bookId);
    const sources = Object.keys(NOTES).filter(key => notes[key].trim());
    if (sources.some(key => notes[key].length > 16000)) throw new Error('A book-memory file exceeds 16,000 characters. Shorten it before sending.');
    return {
      sources: sources.map(key => NOTES[key].label),
      text: sources.map(key => `## ${NOTES[key].label}\n${notes[key]}`).join('\n\n'),
    };
  }
  draft(bookId, text) {
    const dir = this.dir(bookId);
    const file = path.join(dir, 'summary-draft.md');
    if (fs.existsSync(file)) {
      const backup = path.join(dir, 'history', 'draft-' + randomUUID() + '.md');
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      atomicWrite(backup, fs.readFileSync(file, 'utf8'));
    }
    atomicWrite(file, text);
  }
  export(bookId, messages) {
    const file = path.join(this.dir(bookId), 'conversation.md');
    const parts = ['# Partner conversation', '', '> Generated from partner.json. This transcript is replaced when the conversation is saved. Keep editable notes in summary.md, story-decisions.md, or open-questions.md.', ''];
    for (const message of messages) {
      parts.push(`## ${message.role === 'user' ? 'You' : 'Partner'} — ${message.at || ''}`, '');
      if (message.kind === 'summary') parts.push('*Summary draft request*', '');
      parts.push(message.text || '*No response text.*', '');
      if (message.status && message.status !== 'complete') parts.push(`*Response status: ${message.status}*`, '');
      if (message.error) parts.push(fenced(message.error), '');
      if (message.context) parts.push('### Shared context', '', fenced(message.context), '');
    }
    atomicWrite(file, parts.join('\n'));
  }
}
module.exports = { PartnerMemory, NOTES };
