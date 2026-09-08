/* admin.js
   The editing UI. Talks only to /api/*, which does the real authorisation and
   validation; nothing here is a security boundary, it is only a convenience so
   the round trip to GitHub is not wasted on an obvious mistake.

   Cards are edited as fields for the parts with a fixed shape, and as JSON for
   blocks and sidebar, whose shapes vary per card. The JSON is parsed and
   reported on locally before anything is sent. */

'use strict';

(() => {
  const $ = (id) => document.getElementById(id);

  const state = { cards: [], current: null };

  const api = async (path, options = {}) => {
    const response = await fetch(path, {
      credentials: 'same-origin',
      headers: options.body ? { 'Content-Type': 'application/json' } : {},
      ...options,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = Array.isArray(body.errors) ? `\n· ${body.errors.join('\n· ')}` : '';
      throw new Error((body.error || `request failed (${response.status})`) + detail);
    }
    return body;
  };

  const setStatus = (el, message, kind = '') => {
    el.textContent = message;
    el.className = `hint ${kind}`;
  };

  /* ── sign-in gate ── */

  async function boot() {
    const params = new URLSearchParams(location.search);
    const error = params.get('error');
    if (error) {
      $('gateError').textContent = error;
      $('gateError').hidden = false;
      history.replaceState(null, '', '/admin/');
    }

    const session = await api('/api/session').catch(() => ({ signedIn: false }));
    $('repoLabel').textContent = session.repo ? `${session.repo}@${session.branch}` : '';

    if (!session.signedIn) {
      $('gate').hidden = false;
      return;
    }

    $('who').textContent = `signed in as ${session.login}`;
    $('logout').hidden = false;
    $('app').hidden = false;
    await loadCards();
  }

  $('logout').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    location.reload();
  });

  /* ── card list ── */

  const SECTION_LABEL = { projects: '§1 Quantitative Research', frontier: '§2 Research', engineering: '§3 Engineering' };

  async function loadCards() {
    const data = await api('/api/cards');
    state.cards = data.cards;
    renderList();
  }

  function renderList() {
    const host = $('cardList');
    host.replaceChildren();

    for (const section of ['projects', 'frontier', 'engineering']) {
      const inSection = state.cards.filter((c) => c.card && c.card.section === section);
      if (!inSection.length) continue;

      const heading = document.createElement('div');
      heading.className = 'group';
      heading.textContent = SECTION_LABEL[section];
      host.appendChild(heading);

      inSection.forEach((entry, i) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'card-row' + (state.current && state.current.file === entry.file ? ' active' : '');
        button.innerHTML = '';

        const num = document.createElement('span');
        num.className = 'row-num';
        num.textContent = `${['projects', 'frontier', 'engineering'].indexOf(section) + 1}.${i + 1}`;

        const name = document.createElement('span');
        name.className = 'row-name';
        name.textContent = entry.card.name;

        button.append(num, name);
        button.addEventListener('click', () => select(entry));
        host.appendChild(button);
      });
    }

    const broken = state.cards.filter((c) => !c.card);
    for (const entry of broken) {
      const row = document.createElement('div');
      row.className = 'card-row broken';
      row.textContent = `${entry.file} — ${entry.error}`;
      host.appendChild(row);
    }
  }

  /* ── editor ── */

  const BLANK = {
    section: 'projects',
    order: 100,
    id: '',
    name: '',
    lede: '',
    tagline: '',
    tags: [],
    blocks: [{ type: 'text', h: 'What it does', paras: ['...'] }],
    sidebar: [
      { label: 'Stack', type: 'tags', items: ['Python'] },
      { label: 'Links', type: 'links', items: [['GitHub Repository', 'https://github.com/vj0246/']] },
    ],
  };

  function select(entry) {
    state.current = entry;
    fill(entry.card);
    renderList();
  }

  $('newCard').addEventListener('click', () => {
    state.current = { file: null, sha: null, card: null };
    fill(structuredClone(BLANK));
    renderList();
  });

  function fill(card) {
    $('editorEmpty').hidden = true;
    $('editorForm').hidden = false;
    $('delete').hidden = !state.current.file;

    $('fSection').value = card.section || 'projects';
    $('fOrder').value = card.order ?? 100;
    $('fId').value = card.id || '';
    $('fName').value = card.name || '';
    $('fLede').value = card.lede || '';
    $('fBadgeKind').value = card.badge ? card.badge.kind : '';
    $('fBadgeText').value = card.badge ? card.badge.text : '';
    $('fTagline').value = card.tagline || '';
    $('fTags').value = (card.tags || []).join(', ');
    $('fBlocks').value = JSON.stringify(card.blocks || [], null, 2);
    $('fSidebar').value = JSON.stringify(card.sidebar || [], null, 2);

    setStatus($('status'), '');
    $('errors').hidden = true;
    renderPreview();
  }

  function collect() {
    const parseJson = (id, label) => {
      const raw = $(id).value.trim();
      if (!raw) return [];
      try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) throw new Error('must be a JSON array');
        return parsed;
      } catch (e) {
        throw new Error(`${label}: ${e.message}`);
      }
    };

    const card = {
      section: $('fSection').value,
      order: Number($('fOrder').value),
      id: $('fId').value.trim(),
      name: $('fName').value.trim(),
      tagline: $('fTagline').value.trim(),
      tags: $('fTags').value.split(',').map((t) => t.trim()).filter(Boolean),
      blocks: parseJson('fBlocks', 'blocks'),
      sidebar: parseJson('fSidebar', 'sidebar'),
    };

    const lede = $('fLede').value.trim();
    if (lede) card.lede = lede;

    const kind = $('fBadgeKind').value;
    if (kind) card.badge = { kind, text: $('fBadgeText').value.trim() || kind };

    // Field order matters only for how the committed file reads
    const ordered = {};
    for (const key of ['section', 'order', 'id', 'name', 'lede', 'badge', 'tagline', 'tags', 'blocks', 'sidebar']) {
      if (card[key] !== undefined) ordered[key] = card[key];
    }
    return ordered;
  }

  /* ── preview of the closed card ── */

  function renderPreview() {
    const host = $('preview');
    host.replaceChildren();
    let card;
    try { card = collect(); } catch { return; }

    const wrap = document.createElement('div');
    wrap.className = 'pv';

    const title = document.createElement('div');
    title.className = 'pv-title';
    title.textContent = card.name || 'Untitled';
    wrap.appendChild(title);

    if (card.badge) {
      const badge = document.createElement('span');
      badge.className = `pv-badge ${card.badge.kind}`;
      badge.textContent = card.badge.text;
      title.appendChild(badge);
    }

    const tagline = document.createElement('p');
    tagline.className = 'pv-tagline';
    tagline.textContent = card.tagline || '';
    wrap.appendChild(tagline);

    const metrics = (card.sidebar || []).find((b) => b && b.type === 'metrics');
    if (metrics && Array.isArray(metrics.items)) {
      const figs = document.createElement('div');
      figs.className = 'pv-figs';
      metrics.items.slice(0, 3).forEach((item) => {
        const fig = document.createElement('span');
        fig.className = 'pv-fig';
        fig.textContent = `${item[0]} ${item[1]}`;
        figs.appendChild(fig);
      });
      wrap.appendChild(figs);
    }

    const tags = document.createElement('div');
    tags.className = 'pv-tags';
    (card.tags || []).forEach((t) => {
      const chip = document.createElement('span');
      chip.className = 'pv-tag';
      chip.textContent = t;
      tags.appendChild(chip);
    });
    wrap.appendChild(tags);

    host.appendChild(wrap);
  }

  ['fName', 'fTagline', 'fTags', 'fBadgeKind', 'fBadgeText', 'fSidebar']
    .forEach((id) => $(id).addEventListener('input', renderPreview));

  /* ── save and delete ── */

  $('editorForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('errors').hidden = true;

    let card;
    try {
      card = collect();
    } catch (err) {
      $('errors').textContent = err.message;
      $('errors').hidden = false;
      return;
    }

    setStatus($('status'), 'saving…');
    try {
      const result = await api('/api/cards', {
        method: 'POST',
        body: JSON.stringify({
          card,
          sha: state.current.sha,
          previousFile: state.current.file,
        }),
      });
      setStatus($('status'), `committed ${result.file}. Live in about 90 seconds.`, 'ok');
      state.current = { file: result.file.split('/').pop(), sha: null, card };
      await loadCards();
      const fresh = state.cards.find((c) => c.card && c.card.id === card.id);
      if (fresh) state.current = fresh;
      renderList();
    } catch (err) {
      $('errors').textContent = err.message;
      $('errors').hidden = false;
      setStatus($('status'), 'not saved', 'bad');
    }
  });

  $('delete').addEventListener('click', async () => {
    if (!state.current.file) return;
    if (!confirm(`Delete ${state.current.file}? This commits a deletion to the repository.`)) return;

    setStatus($('status'), 'deleting…');
    try {
      await api('/api/cards', { method: 'DELETE', body: JSON.stringify({ file: state.current.file }) });
      state.current = null;
      $('editorForm').hidden = true;
      $('editorEmpty').hidden = false;
      await loadCards();
    } catch (err) {
      $('errors').textContent = err.message;
      $('errors').hidden = false;
      setStatus($('status'), 'not deleted', 'bad');
    }
  });

  /* ── resume upload ── */

  $('resumeUpload').addEventListener('click', async () => {
    const input = $('resumeFile');
    const file = input.files && input.files[0];
    if (!file) { setStatus($('resumeStatus'), 'choose a PDF first', 'bad'); return; }

    setStatus($('resumeStatus'), 'uploading…');
    try {
      const buffer = await file.arrayBuffer();
      let binary = '';
      const bytes = new Uint8Array(buffer);
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      }
      const result = await api('/api/resume', {
        method: 'POST',
        body: JSON.stringify({ slot: $('resumeSlot').value, contentBase64: btoa(binary) }),
      });
      setStatus($('resumeStatus'), `replaced ${result.file}`, 'ok');
      input.value = '';
    } catch (err) {
      setStatus($('resumeStatus'), err.message, 'bad');
    }
  });

  boot();
})();
