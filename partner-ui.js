/* The writing partner shares one per-book conversation across editor tabs. */
(() => {
  const $ = id => document.getElementById(id);
  let bookId = null;
  let opened = false;
  let signedIn = false;
  let busy = false;
  let sending = false;
  let loading = false;
  let otherBusy = false;
  let tab = 'manuscript';
  const drafts = new Map();
  const contextChoices = new Map();

  async function call(method, payload) {
    const reply = await window.partner[method](payload);
    if (reply.error) throw new Error(reply.error);
    return reply.result;
  }
  function status(text = '') { $('partner-status').textContent = text; }
  function controls() {
    const available = ['manuscript', 'outline'].includes(tab);
    $('partner-toggle').hidden = !available;
    $('partner-panel').hidden = !opened || !available;
    $('editor-view').classList.toggle('partner-open', opened && available);
    $('partner-toggle').setAttribute('aria-expanded', String(opened && available));
    $('partner-send').disabled = !signedIn || busy || sending || loading || otherBusy || !$('partner-input').value.trim();
    $('partner-stop').hidden = !busy && !sending;
    $('partner-login').hidden = signedIn;
    $('partner-logout').hidden = !signedIn;
    $('partner-logout').disabled = busy || sending || otherBusy;
  }
  function render(state) {
    busy = !!state.busy;
    otherBusy = !!state.otherBusy;
    const list = $('partner-messages');
    const follow = list.scrollHeight - list.scrollTop - list.clientHeight < 100;
    list.replaceChildren();
    if (!state.messages.length) {
      const intro = document.createElement('div');
      intro.className = 'partner-empty';
      const title = document.createElement('h3');
      title.textContent = 'Every story starts somewhere.';
      const text = document.createElement('p');
      text.textContent = 'Bring an unfinished thought. Explore a character. Try out a world. You don’t need a chapter—or even a plot—to begin.';
      intro.append(title, text);
      for (const prompt of ['I have a seed of an idea. Help me explore it.', 'Help me get to know my protagonist.', 'I’m torn between two possibilities.']) {
        const button = document.createElement('button');
        button.type = 'button'; button.textContent = prompt;
        button.onclick = () => { $('partner-input').value = prompt; controls(); $('partner-input').focus(); };
        intro.append(button);
      }
      list.append(intro);
    }
    for (const message of state.messages) {
      const article = document.createElement('article');
      article.className = 'partner-message ' + (message.role === 'user' ? 'from-author' : 'from-partner');
      const label = document.createElement('h3');
      label.textContent = message.role === 'user' ? 'You' : 'Partner';
      const text = document.createElement('div');
      text.className = 'partner-message-text';
      text.textContent = message.text || (message.status === 'streaming' ? 'Thinking with you…' : 'No response text.');
      article.append(label, text);
      if (message.context) {
        const details = document.createElement('details');
        const summary = document.createElement('summary'); summary.textContent = 'Shared context';
        const pre = document.createElement('pre'); pre.textContent = message.context;
        details.append(summary, pre); article.append(details);
      }
      if (message.error || ['interrupted', 'failed'].includes(message.status)) {
        const note = document.createElement('p'); note.className = 'partner-message-note';
        note.textContent = message.error || 'Response stopped. You can continue the conversation.';
        article.append(note);
      }
      list.append(article);
    }
    if (follow) list.scrollTop = list.scrollHeight;
    controls();
  }
  async function refreshAccount() {
    try {
      const account = await call('account');
      signedIn = account.signedIn;
      $('partner-account-label').textContent = signedIn ? (account.email || 'Connected to ChatGPT') : 'Use your ChatGPT account';
      $('partner-login').textContent = account.pending ? 'Reopen sign-in' : 'Sign in with ChatGPT';
      controls();
    } catch (error) { signedIn = false; status(error.message); controls(); }
  }
  async function openPanel() {
    opened = true; controls();
    await refreshAccount();
  }
  $('partner-toggle').onclick = () => { if (opened) { opened = false; controls(); } else openPanel(); };
  $('partner-close').onclick = () => { opened = false; controls(); $('partner-toggle').focus(); };
  $('partner-login').onclick = async () => {
    $('partner-login').disabled = true;
    try { await call('login'); status('Complete sign-in in your browser, then return here.'); }
    catch (error) { status(error.message); }
    finally { $('partner-login').disabled = false; }
  };
  $('partner-logout').onclick = async () => {
    try { await call('logout'); signedIn = false; status('Signed out. Your conversations are saved.'); await refreshAccount(); }
    catch (error) { status(error.message); }
  };
  $('partner-input').addEventListener('input', controls);
  // Keep editor shortcuts from interpreting conversation typing as manuscript commands.
  $('partner-panel').addEventListener('keydown', event => { event.stopPropagation(); });
  $('partner-preview').onclick = () => {
    const pre = $('partner-context-preview');
    pre.hidden = !pre.hidden;
    pre.textContent = getContext() || 'Only your conversation message will be sent.';
  };
  function getContext() {
    if (!$('partner-outline').checked && !$('partner-chapter').checked) return '';
    return window.neoPartnerContext($('partner-outline').checked, $('partner-chapter').checked);
  }
  $('partner-form').onsubmit = async event => {
    event.preventDefault();
    if (!bookId || !signedIn || busy || sending || loading || otherBusy) return;
    const text = $('partner-input').value.trim();
    if (!text) return;
    const context = getContext();
    if (context.length > 64000) { status('This context is too large. Uncheck the chapter or outline to share less.'); return; }
    const target = bookId;
    sending = true; controls(); status('');
    $('partner-input').value = '';
    drafts.set(target, '');
    try { await call('send', { bookId: target, text, context }); }
    catch (error) {
      if (bookId === target) status(error.message);
      // The main process persists accepted messages, including failed responses.
      const state = await call('history', target).catch(() => null);
      if (!state?.messages.some(m => m.role === 'user' && m.text === text)) {
        drafts.set(target, text);
        if (bookId === target && !$('partner-input').value) $('partner-input').value = text;
      }
    } finally {
      sending = false;
      if (bookId) {
        const current = bookId;
        call('history', current).then(state => { if (bookId === current) render(state); }).catch(error => status(error.message));
      }
      controls();
    }
  };
  $('partner-stop').onclick = async () => {
    try { await call('cancel', bookId); status('Stopping…'); }
    catch (error) { status(error.message); }
  };
  window.addEventListener('partner:book', async event => {
    if (bookId) {
      drafts.set(bookId, $('partner-input').value);
      contextChoices.set(bookId, [$('partner-outline').checked, $('partner-chapter').checked]);
    }
    bookId = event.detail.bookId;
    busy = false; otherBusy = false; loading = !!bookId;
    $('partner-input').value = drafts.get(bookId) || '';
    const choices = contextChoices.get(bookId) || [false, false];
    [$('partner-outline').checked, $('partner-chapter').checked] = choices;
    $('partner-context-preview').hidden = true;
    $('partner-messages').replaceChildren(); status(''); controls();
    if (!bookId) return;
    const target = bookId;
    try { const state = await call('history', target); if (bookId === target) render(state); }
    catch (error) { if (bookId === target) status(error.message); }
    finally { if (bookId === target) { loading = false; controls(); } }
  });
  window.addEventListener('partner:tab', event => { tab = event.detail.tab; controls(); });
  window.partner.onEvent(event => {
    if (event.type === 'conversation' && event.bookId === bookId) render(event);
    else if (event.type === 'conversation' && bookId) {
      const target = bookId;
      call('history', target).then(state => { if (target === bookId) render(state); }).catch(() => {});
    }
    if (event.type === 'account') {
      status(event.error || '');
      if (!event.error) refreshAccount();
      else { signedIn = false; controls(); }
    }
  });
})();
