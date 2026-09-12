/* admin.js
   The editing UI. Projects, experience and the resume are all changed through
   ordinary forms: no JSON, no git. Two rarely-touched section types (diagrams
   and raw HTML) stay as an "advanced" JSON box so they are never lost.

   /api/* does the real authorisation and validation; nothing here is a
   security boundary. All user text reaches the page through textContent or
   input values, never innerHTML. */

'use strict';

(() => {
  const $ = (id) => document.getElementById(id);

  /* ── DOM helper ── */

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    const late = {};
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'value' || key === 'checked') late[key] = value;
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    // set after children so a <select> already has its <option>s
    Object.assign(node, late);
    return node;
  }

  /* ── constants ── */

  const COLLECTIONS = { projects: '/api/cards', experience: '/api/experience' };

  const SECTIONS = [
    ['projects', '§1 Quantitative Research'],
    ['frontier', '§2 Research'],
    ['engineering', '§3 Engineering'],
  ];
  const BADGES = [
    ['', 'No badge'], ['live', 'Live'], ['progress', 'In progress'], ['research', 'Research'],
    ['published', 'Published'], ['freelance', 'Freelance'], ['intern', 'Internship'],
  ];
  const BADGE_TEXT = {
    live: '● Live', progress: 'In Development', research: 'Research',
    published: 'Published', freelance: 'Freelance', intern: 'Internship',
  };
  const EXP_KINDS = [['intern', 'Internship'], ['freelance', 'Freelance'], ['fulltime', 'Full time'], ['research', 'Research']];
  const EXP_TEXT = Object.fromEntries(EXP_KINDS);
  const TONES = [['', 'Normal'], ['pos', 'Positive (green)'], ['neg', 'Negative (red)'], ['flat', 'Muted'], ['amber', 'Emphasis']];

  const BLOCK_LABEL = {
    text: 'Paragraphs', bullets: 'Bullet list', table: 'Results table',
    nulls: 'What did not work', arch: 'Diagram', html: 'Custom HTML',
  };
  const NEW_BLOCKS = [
    ['Paragraphs', () => ({ type: 'text', h: 'What it does', paras: [''] })],
    ['Bullet list', () => ({ type: 'bullets', h: 'Technical depth', items: [''] })],
    ['Results table', () => ({ type: 'table', h: 'Results', cols: ['Configuration', 'Value'], rows: [['', '']] })],
    ['What did not work', () => ({ type: 'nulls', h: 'What did not work', label: 'Negative results', items: [''] })],
    ['Diagram', () => ({ type: 'arch', h: 'Architecture', flow: ['Input|where data comes from', '->', '*Core step|the interesting part', '->', 'Output|what comes out'] })],
  ];
  const ADVANCED_HINT = {
    arch: 'Diagram, written as JSON. Each box is "Label|small text", start a box with * to highlight it, and "->" draws an arrow.',
    html: 'Raw HTML. Only change this if you know what the markup does.',
  };
  const SIDEBAR_LABEL = { tags: 'Tag list', metrics: 'Key numbers', links: 'Links' };

  const PROJECT_KEYS = ['section', 'order', 'id', 'name', 'lede', 'badge', 'tagline', 'tags', 'blocks', 'sidebar'];
  const EXPERIENCE_KEYS = ['order', 'id', 'kind', 'badge', 'period', 'period_note', 'role', 'company', 'link', 'summary', 'bullets'];

  /* ── state ── */

  const state = {
    tab: 'projects',
    lists: { projects: [], experience: [] },
    current: null, // { kind, file, sha, draft }
    dirty: false,
    invalid: new Set(), // advanced JSON sections that do not currently parse
    flash: null,
  };

  /* ── small utilities ── */

  const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '');
  const splitList = (s) => String(s).split(',').map((t) => t.trim()).filter(Boolean);
  const guard = () => !state.dirty || confirm('You have unsaved changes. Discard them?');

  function orderKeys(obj, keys) {
    const out = {};
    for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
    for (const k of Object.keys(obj)) if (!(k in out)) out[k] = obj[k];
    return out;
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: 'same-origin',
      ...options,
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || `Request failed (${response.status})`);
      error.lines = Array.isArray(body.errors) ? body.errors : [];
      error.status = response.status;
      throw error;
    }
    return body;
  }

  /* ── form building blocks ── */

  const field = (label, hint, ...controls) => el('label', { class: 'field' },
    el('span', { class: 'field-label', text: label }),
    hint ? el('span', { class: 'field-hint', text: hint }) : null,
    ...controls);

  const group = (label, hint, ...controls) => el('div', { class: 'field' },
    el('span', { class: 'field-label', text: label }),
    hint ? el('span', { class: 'field-hint', text: hint }) : null,
    ...controls);

  const sectionHeading = (title, hint) => el('div', { class: 'section-h' },
    el('h3', { text: title }),
    hint ? el('p', { class: 'field-hint', text: hint }) : null);

  const bindText = (obj, key, { multiline = false, rows = 3, placeholder } = {}) =>
    el(multiline ? 'textarea' : 'input', {
      type: multiline ? undefined : 'text',
      rows: multiline ? rows : undefined,
      placeholder,
      value: obj[key] ?? '',
      oninput: (e) => { obj[key] = e.target.value; markDirty(); },
    });

  /** Up, down and remove buttons for one row of an array. */
  function rowTools(arr, i, redraw) {
    const move = (to) => { [arr[i], arr[to]] = [arr[to], arr[i]]; markDirty(); redraw(); };
    return el('div', { class: 'row-tools' },
      el('button', { type: 'button', class: 'icon', title: 'Move up', 'aria-label': 'Move up', disabled: i === 0, text: '↑', onclick: () => move(i - 1) }),
      el('button', { type: 'button', class: 'icon', title: 'Move down', 'aria-label': 'Move down', disabled: i === arr.length - 1, text: '↓', onclick: () => move(i + 1) }),
      el('button', { type: 'button', class: 'icon danger', title: 'Remove', 'aria-label': 'Remove', text: '×', onclick: () => { arr.splice(i, 1); markDirty(); redraw(); } }));
  }

  /** A reorderable list of text entries: paragraphs, bullet points. */
  function stringList(arr, { addLabel, rows = 3, placeholder }) {
    const host = el('div', { class: 'slist' });
    const draw = () => host.replaceChildren(
      ...arr.map((value, i) => el('div', { class: 'slist-row' },
        el('textarea', { rows, placeholder, value, oninput: (e) => { arr[i] = e.target.value; markDirty(); } }),
        rowTools(arr, i, draw))),
      el('button', { type: 'button', class: 'btn small', text: addLabel, onclick: () => { arr.push(''); markDirty(); draw(); } }));
    draw();
    return host;
  }

  /** Rows of [label, value] pairs, optionally with a colour choice. */
  function pairRows(items, { placeholders, tone = false, addLabel, blank }) {
    const host = el('div', { class: 'pairs' });
    const draw = () => host.replaceChildren(
      ...items.map((item, i) => el('div', { class: tone ? 'pair-row with-tone' : 'pair-row' },
        el('input', { type: 'text', value: item[0] ?? '', placeholder: placeholders[0], 'aria-label': placeholders[0], oninput: (e) => { item[0] = e.target.value; markDirty(); } }),
        el('input', { type: 'text', value: item[1] ?? '', placeholder: placeholders[1], 'aria-label': placeholders[1], oninput: (e) => { item[1] = e.target.value.trim(); markDirty(); } }),
        tone ? el('select', {
          'aria-label': 'Colour',
          value: item[2] || '',
          onchange: (e) => { if (e.target.value) item[2] = e.target.value; else item.length = 2; markDirty(); },
        }, ...TONES.map(([v, l]) => el('option', { value: v, text: l }))) : null,
        rowTools(items, i, draw))),
      el('button', { type: 'button', class: 'btn small', text: addLabel, onclick: () => { items.push(blank()); markDirty(); draw(); } }));
    draw();
    return host;
  }

  /** The escape hatch: a section edited as JSON, kept only while it parses. */
  function jsonBox(block) {
    state.invalid.delete(block);
    const error = el('p', { class: 'field-error', hidden: true });
    const box = el('textarea', {
      class: 'mono', rows: 10, spellcheck: 'false',
      value: JSON.stringify(block, null, 2),
      oninput: (e) => {
        try {
          const parsed = JSON.parse(e.target.value);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('must be a JSON object');
          for (const k of Object.keys(block)) delete block[k];
          Object.assign(block, parsed);
          error.hidden = true;
          box.classList.remove('bad');
          state.invalid.delete(block);
        } catch (x) {
          error.textContent = `Not saved until fixed: ${x.message}`;
          error.hidden = false;
          box.classList.add('bad');
          state.invalid.add(block);
        }
        markDirty();
      },
    });
    return el('div', {},
      el('p', { class: 'field-hint', text: ADVANCED_HINT[block.type] || 'Advanced section, edited as JSON.' }),
      box, error);
  }

  function pruneInvalid() {
    const draft = state.current && state.current.draft;
    const live = new Set([...((draft && draft.blocks) || []), ...((draft && draft.sidebar) || [])]);
    for (const b of state.invalid) if (!live.has(b)) state.invalid.delete(b);
  }

  /* ── results table grid ── */

  function tableGrid(block) {
    block.cols = block.cols || [];
    block.rows = block.rows || [];
    const host = el('div', { class: 'grid-wrap' });
    const plain = (v) => String(v ?? '').replace(/^\*/, '');

    const draw = () => {
      host.style.setProperty('--cols', Math.max(block.cols.length, 1));
      const head = el('div', { class: 'grid-row grid-head' },
        el('span', { class: 'grid-flag', text: '★', title: 'Tick to highlight a row' }),
        ...block.cols.map((c, j) => el('input', {
          type: 'text', value: c, placeholder: `Column ${j + 1}`, 'aria-label': `Column ${j + 1} heading`,
          oninput: (e) => { block.cols[j] = e.target.value; markDirty(); },
        })),
        el('button', {
          type: 'button', class: 'icon', title: 'Add a column', 'aria-label': 'Add a column', text: '+',
          onclick: () => { block.cols.push(''); block.rows.forEach((r) => r.push('')); markDirty(); draw(); },
        }));

      const rows = block.rows.map((row, i) => {
        while (row.length < block.cols.length) row.push('');
        return el('div', { class: 'grid-row' },
          el('input', {
            type: 'checkbox', title: 'Highlight this row', 'aria-label': 'Highlight this row',
            checked: String(row[0] ?? '').startsWith('*'),
            onchange: (e) => { row[0] = (e.target.checked ? '*' : '') + plain(row[0]); markDirty(); },
          }),
          ...block.cols.map((_, j) => el('input', {
            type: 'text', value: j === 0 ? plain(row[0]) : (row[j] ?? ''),
            'aria-label': `Row ${i + 1}, ${block.cols[j] || `column ${j + 1}`}`,
            oninput: (e) => {
              row[j] = j === 0 && String(row[0] ?? '').startsWith('*') ? `*${e.target.value}` : e.target.value;
              markDirty();
            },
          })),
          el('button', {
            type: 'button', class: 'icon danger', title: 'Remove row', 'aria-label': 'Remove row', text: '×',
            onclick: () => { block.rows.splice(i, 1); markDirty(); draw(); },
          }));
      });

      host.replaceChildren(head, ...rows,
        el('div', { class: 'grid-actions' },
          el('button', { type: 'button', class: 'btn small', text: '+ Row', onclick: () => { block.rows.push(block.cols.map(() => '')); markDirty(); draw(); } }),
          block.cols.length > 1
            ? el('button', { type: 'button', class: 'btn small', text: '− Last column', onclick: () => { block.cols.pop(); block.rows.forEach((r) => r.pop()); markDirty(); draw(); } })
            : null),
        el('p', { class: 'field-hint', text: 'To colour a number, add |pos (green) or |neg (red) after it, for example 1.02|pos' }));
    };
    draw();
    return host;
  }

  /* ── write-up sections ── */

  function blockBody(block) {
    const heading = field('Heading', null, bindText(block, 'h'));
    switch (block.type) {
      case 'text':
        block.paras = block.paras || [];
        return el('div', {}, heading, group('Paragraphs', null, stringList(block.paras, { addLabel: '+ Paragraph', rows: 4 })));
      case 'bullets':
        block.items = block.items || [];
        return el('div', {}, heading, group('Points', null, stringList(block.items, { addLabel: '+ Point', rows: 2 })));
      case 'nulls':
        block.items = block.items || [];
        block.after = block.after || [];
        return el('div', {}, heading,
          field('Label', 'A short line shown in small capitals above the list.', bindText(block, 'label')),
          group('Points', null, stringList(block.items, { addLabel: '+ Point', rows: 2 })),
          group('Closing paragraphs', 'Optional.', stringList(block.after, { addLabel: '+ Paragraph', rows: 3 })));
      case 'table':
        return el('div', {}, heading,
          field('Caption', 'Optional.', bindText(block, 'caption')),
          group('Table', null, tableGrid(block)),
          field('Note under the table', 'Optional.', bindText(block, 'note', { multiline: true, rows: 2 })));
      default:
        // diagrams and raw HTML carry their heading inside the JSON
        return el('div', {}, jsonBox(block));
    }
  }

  function blocksEditor(blocks) {
    const host = el('div', { class: 'stack' });
    const draw = () => {
      pruneInvalid();
      host.replaceChildren(
        ...blocks.map((block, i) => el('div', { class: 'panel' },
          el('div', { class: 'panel-head' },
            el('span', { class: 'panel-kind', text: BLOCK_LABEL[block.type] || block.type }),
            rowTools(blocks, i, draw)),
          blockBody(block))),
        el('div', { class: 'add-row' },
          el('span', { class: 'field-hint', text: 'Add a section:' }),
          ...NEW_BLOCKS.map(([label, make]) => el('button', {
            type: 'button', class: 'btn small', text: `+ ${label}`,
            onclick: () => { blocks.push(make()); markDirty(); draw(); },
          }))));
    };
    draw();
    return host;
  }

  /* ── side panel ── */

  function sidebarBody(box) {
    box.items = box.items || [];
    if (box.type === 'tags') {
      return field('Items', 'Comma separated.', el('input', {
        type: 'text', value: box.items.join(', '),
        oninput: (e) => { box.items = splitList(e.target.value); markDirty(); },
      }));
    }
    if (box.type === 'metrics') {
      return group('Numbers', 'The first three also appear on the closed project.',
        pairRows(box.items, { placeholders: ['Label', 'Value'], tone: true, addLabel: '+ Number', blank: () => ['', ''] }));
    }
    if (box.type === 'links') {
      return group('Links', null,
        pairRows(box.items, { placeholders: ['Text', 'https://…'], addLabel: '+ Link', blank: () => ['GitHub Repository', 'https://github.com/vj0246/'] }));
    }
    return jsonBox(box);
  }

  function sidebarEditor(sidebar) {
    const host = el('div', { class: 'stack' });
    const add = (label, make) => el('button', {
      type: 'button', class: 'btn small', text: `+ ${label}`,
      onclick: () => { sidebar.push(make()); markDirty(); draw(); },
    });
    const draw = () => {
      pruneInvalid();
      host.replaceChildren(
        ...sidebar.map((box, i) => el('div', { class: 'panel' },
          el('div', { class: 'panel-head' },
            el('span', { class: 'panel-kind', text: SIDEBAR_LABEL[box.type] || box.type }),
            rowTools(sidebar, i, draw)),
          field('Box title', null, bindText(box, 'label')),
          sidebarBody(box))),
        el('div', { class: 'add-row' },
          el('span', { class: 'field-hint', text: 'Add a box:' }),
          add('Tag list', () => ({ label: 'Stack', type: 'tags', items: [] })),
          add('Key numbers', () => ({ label: 'Key metrics', type: 'metrics', items: [['', '']] })),
          add('Links', () => ({ label: 'Links', type: 'links', items: [['GitHub Repository', 'https://github.com/vj0246/']] }))));
    };
    draw();
    return host;
  }

  /* ── shared editor pieces ── */

  function orderField(kind, item) {
    const hint = el('span', { class: 'field-hint' });
    const describe = () => {
      const others = state.lists[kind]
        .filter((e) => e.data && e.file !== state.current.file && (kind !== 'projects' || e.data.section === item.section))
        .sort((a, b) => a.data.order - b.data.order)
        .map((e) => `${e.data.order} ${(e.data.name || e.data.role || '').slice(0, 26)}`);
      hint.textContent = others.length
        ? `Lower numbers appear first. Currently: ${others.join('  ·  ')}`
        : 'Lower numbers appear first.';
    };
    describe();
    const input = el('input', {
      type: 'number', step: '1', min: '0', value: item.order ?? '',
      oninput: (e) => { item.order = e.target.value === '' ? '' : Number(e.target.value); markDirty(); },
    });
    return { input, describe, node: el('label', { class: 'field' }, el('span', { class: 'field-label', text: 'Order' }), hint, input) };
  }

  const advancedId = (idInput) => el('details', { class: 'advanced' },
    el('summary', { text: 'Advanced' }),
    field('Link id', 'Set automatically from the name. It cannot change after the first save, because it is part of the page address.', idInput));

  function actionsBar() {
    return el('div', { class: 'footer' },
      el('div', { class: 'errors', id: 'errors', role: 'alert', hidden: true }),
      el('div', { class: 'actions' },
        el('button', { type: 'submit', class: 'btn primary', id: 'save', text: 'Save and publish' }),
        state.current.file ? el('button', { type: 'button', class: 'btn danger', text: 'Delete', onclick: remove }) : null,
        el('span', { class: 'hint', id: 'status', role: 'status' })),
      el('p', { class: 'hint', text: 'Saving records the change on GitHub straight away. The live site rebuilds itself and shows it in about 90 seconds.' }));
  }

  /* ── project editor ── */

  function projectEditor(card) {
    card.tags = card.tags || [];
    card.blocks = card.blocks || [];
    card.sidebar = card.sidebar || [];
    const isNew = !state.current.file;
    let idTouched = !isNew;

    const idInput = el('input', {
      type: 'text', value: card.id || '', disabled: !isNew,
      oninput: (e) => { card.id = e.target.value.trim(); idTouched = true; markDirty(); },
    });

    const order = orderField('projects', card);

    const sectionSelect = el('select', {
      value: card.section,
      onchange: (e) => {
        card.section = e.target.value;
        if (isNew) { card.order = nextOrder('projects', card.section); order.input.value = card.order; }
        order.describe();
        markDirty();
      },
    }, ...SECTIONS.map(([v, l]) => el('option', { value: v, text: l })));

    const nameInput = el('input', {
      type: 'text', value: card.name || '', placeholder: 'Artha · Systematic Equity Trading System',
      oninput: (e) => {
        card.name = e.target.value;
        if (!idTouched) { card.id = slugify(card.name); idInput.value = card.id; }
        markDirty();
      },
    });

    const badgeText = el('input', {
      type: 'text', value: card.badge ? card.badge.text : '', disabled: !card.badge, placeholder: '● Live · Operated',
      oninput: (e) => { if (card.badge) { card.badge.text = e.target.value; markDirty(); } },
    });
    const badgeKind = el('select', {
      value: card.badge ? card.badge.kind : '',
      onchange: (e) => {
        const kind = e.target.value;
        if (!kind) {
          delete card.badge;
          badgeText.value = '';
          badgeText.disabled = true;
        } else {
          const wasDefault = !card.badge || !card.badge.text || card.badge.text === BADGE_TEXT[card.badge.kind];
          card.badge = { kind, text: wasDefault ? BADGE_TEXT[kind] : card.badge.text };
          badgeText.value = card.badge.text;
          badgeText.disabled = false;
        }
        markDirty();
      },
    }, ...BADGES.map(([v, l]) => el('option', { value: v, text: l })));

    const tagsInput = el('input', {
      type: 'text', value: card.tags.join(', '), placeholder: 'Python, LightGBM, NSE',
      oninput: (e) => { card.tags = splitList(e.target.value); markDirty(); },
    });

    const form = el('form', { class: 'editor-form', onsubmit: (e) => { e.preventDefault(); save(); } },
      el('h2', { class: 'editor-title', text: isNew ? 'New project' : (card.name || 'Project') }),
      el('div', { class: 'row two' }, field('Where it appears', null, sectionSelect), order.node),
      field('Project name', null, nameInput),
      field('One-line summary', 'Shown next to the project in the contents list at the top of the site.',
        bindText(card, 'lede', { placeholder: 'net Sharpe 1.02, operated live' })),
      el('div', { class: 'row two' }, field('Status badge', null, badgeKind), field('Badge text', null, badgeText)),
      field('Short description', 'Two or three sentences. This is what people read before they open the project.',
        bindText(card, 'tagline', { multiline: true, rows: 4 })),
      field('Technologies', 'Comma separated.', tagsInput),
      sectionHeading('Write-up', 'What people see when they open the project. Use the arrows to reorder sections.'),
      blocksEditor(card.blocks),
      sectionHeading('Side panel', 'The boxes beside an opened project: technologies, key numbers, links.'),
      sidebarEditor(card.sidebar),
      sectionHeading('Preview', 'How the closed project looks on the site.'),
      el('div', { id: 'preview', class: 'preview' }),
      advancedId(idInput),
      actionsBar());

    queueMicrotask(refreshPreview);
    return form;
  }

  function refreshPreview() {
    const host = $('preview');
    if (!host || !state.current || state.current.kind !== 'projects') return;
    const card = state.current.draft;

    const title = el('div', { class: 'pv-title', text: card.name || 'Untitled project' });
    if (card.badge && card.badge.kind) title.append(el('span', { class: `pv-badge ${card.badge.kind}`, text: card.badge.text || '' }));

    const metrics = (card.sidebar || []).find((b) => b && b.type === 'metrics');
    const shown = metrics && Array.isArray(metrics.items) ? metrics.items.filter((m) => m && (m[0] || m[1])).slice(0, 3) : [];

    host.replaceChildren(el('div', { class: 'pv' },
      title,
      el('p', { class: 'pv-tagline', text: card.tagline || 'Short description goes here.' }),
      shown.length
        ? el('div', { class: 'pv-figs' }, ...shown.map((m) => el('span', { class: `pv-fig ${m[2] || ''}` },
          el('span', { class: 'pv-fig-label', text: m[0] || '' }), ' ', el('span', { text: m[1] || '' }))))
        : null,
      el('div', { class: 'pv-tags' }, ...(card.tags || []).map((t) => el('span', { class: 'pv-tag', text: t })))));
  }

  /* ── experience editor ── */

  function experienceEditor(entry) {
    entry.bullets = entry.bullets || [];
    const isNew = !state.current.file;
    let idTouched = !isNew;

    const idInput = el('input', {
      type: 'text', value: entry.id || '', disabled: !isNew,
      oninput: (e) => { entry.id = e.target.value.trim(); idTouched = true; markDirty(); },
    });

    const badgeInput = el('input', {
      type: 'text', value: entry.badge || '', placeholder: 'Internship',
      oninput: (e) => { entry.badge = e.target.value; markDirty(); },
    });
    const kindSelect = el('select', {
      value: entry.kind,
      onchange: (e) => {
        const wasDefault = !entry.badge || entry.badge === EXP_TEXT[entry.kind];
        entry.kind = e.target.value;
        if (wasDefault) { entry.badge = EXP_TEXT[entry.kind]; badgeInput.value = entry.badge; }
        markDirty();
      },
    }, ...EXP_KINDS.map(([v, l]) => el('option', { value: v, text: l })));

    const companyInput = el('input', {
      type: 'text', value: entry.company || '', placeholder: 'Zeex AI · AI startup · Mumbai',
      oninput: (e) => {
        entry.company = e.target.value;
        if (!idTouched) { entry.id = slugify(entry.company.split('·')[0]); idInput.value = entry.id; }
        markDirty();
      },
    });

    const link = entry.link ? { ...entry.link } : { text: '', url: '' };
    const syncLink = () => {
      if (link.text.trim() || link.url.trim()) entry.link = { text: link.text, url: link.url };
      else delete entry.link;
      markDirty();
    };

    const order = orderField('experience', entry);

    return el('form', { class: 'editor-form', onsubmit: (e) => { e.preventDefault(); save(); } },
      el('h2', { class: 'editor-title', text: isNew ? 'New experience' : (entry.role || 'Experience') }),
      el('div', { class: 'row two' }, field('Type', null, kindSelect), field('Label shown', 'For example Internship.', badgeInput)),
      field('Role or title', null, bindText(entry, 'role', { placeholder: 'Full Stack AI Intern' })),
      field('Organisation', 'Separate parts with a middle dot ·', companyInput),
      el('div', { class: 'row two' },
        field('Dates', null, bindText(entry, 'period', { placeholder: 'Apr 2026 to Present' })),
        field('Line under the dates', 'Optional.', bindText(entry, 'period_note', { placeholder: 'Sole Developer' }))),
      el('div', { class: 'row two' },
        field('Website label', 'Optional.', el('input', {
          type: 'text', value: link.text, placeholder: 'shaktialloys.in ↗',
          oninput: (e) => { link.text = e.target.value; syncLink(); },
        })),
        field('Website address', null, el('input', {
          type: 'text', value: link.url, placeholder: 'https://…',
          oninput: (e) => { link.url = e.target.value.trim(); syncLink(); },
        }))),
      field('Summary', 'A short paragraph on what the role was.', bindText(entry, 'summary', { multiline: true, rows: 4 })),
      group('Key points', 'One achievement per point. Use the arrows to reorder.',
        stringList(entry.bullets, { addLabel: '+ Point', rows: 2 })),
      order.node,
      advancedId(idInput),
      actionsBar());
  }

  /* ── resume ── */

  function resumePanel() {
    const slot = el('select', {},
      el('option', { value: 'quant', text: 'Quantitative Researcher' }),
      el('option', { value: 'aiml', text: 'AI·ML Engineer' }),
      el('option', { value: 'swe', text: 'Software Engineer' }));
    const current = el('a', { class: 'plain-link', href: '/resumes/resume-quant.pdf', target: '_blank', rel: 'noopener', text: 'Open the current PDF ↗' });
    slot.addEventListener('change', () => { current.href = `/resumes/resume-${slot.value}.pdf`; });

    const file = el('input', { type: 'file', accept: 'application/pdf' });
    const status = el('p', { class: 'hint', role: 'status' });

    const toBase64 = (f) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(f);
    });

    const upload = el('button', {
      type: 'button', class: 'btn primary', text: 'Upload and publish',
      onclick: async () => {
        const chosen = file.files && file.files[0];
        const show = (text, kind) => { status.textContent = text; status.className = `hint ${kind || ''}`; };
        if (!chosen) return show('Choose a PDF first.', 'bad');
        if (chosen.size > 3 * 1024 * 1024) return show(`That file is ${(chosen.size / 1e6).toFixed(1)}MB. The limit is 3MB.`, 'bad');
        upload.disabled = true;
        show('Uploading…');
        try {
          const result = await api('/api/resume', {
            method: 'POST',
            body: JSON.stringify({ slot: slot.value, contentBase64: await toBase64(chosen) }),
          });
          show(`Replaced ${result.file}. Visitors get the new file in about a minute.`, 'ok');
          file.value = '';
        } catch (err) {
          show(err.status === 401 ? 'You have been signed out. Reload the page and sign in again.' : err.message, 'bad');
        } finally {
          upload.disabled = false;
        }
      },
    });

    return el('div', { class: 'editor-form' },
      el('h2', { class: 'editor-title', text: 'Resume' }),
      el('p', { class: 'field-hint', text: 'Pick which resume to replace, choose the new PDF, and upload. The download button on the site serves the new file once the site redeploys.' }),
      field('Which resume', null, slot),
      current,
      field('New PDF', 'PDF only, up to 3MB.', file),
      el('div', { class: 'actions' }, upload, status));
  }

  /* ── lists ── */

  function nextOrder(kind, section) {
    const orders = state.lists[kind]
      .filter((e) => e.data && (kind !== 'projects' || e.data.section === section))
      .map((e) => Number(e.data.order) || 0);
    return (orders.length ? Math.max(...orders) : 0) + 10;
  }

  const blankProject = () => ({
    section: 'projects',
    order: nextOrder('projects', 'projects'),
    id: '',
    name: '',
    lede: '',
    tagline: '',
    tags: [],
    blocks: [{ type: 'text', h: 'What it does', paras: [''] }],
    sidebar: [
      { label: 'Stack', type: 'tags', items: [] },
      { label: 'Links', type: 'links', items: [['GitHub Repository', 'https://github.com/vj0246/']] },
    ],
  });

  const blankExperience = () => ({
    order: nextOrder('experience'),
    id: '',
    kind: 'intern',
    badge: 'Internship',
    period: '',
    period_note: '',
    role: '',
    company: '',
    summary: '',
    bullets: [''],
  });

  function listRow(entry, kind, num, label) {
    const active = state.current && state.current.kind === kind && state.current.file === entry.file;
    return el('button', { type: 'button', class: `card-row${active ? ' active' : ''}`, onclick: () => open(kind, entry) },
      el('span', { class: 'row-num', text: num }),
      el('span', { class: 'row-name', text: label }));
  }

  const brokenRows = (kind) => state.lists[kind]
    .filter((e) => !e.data)
    .map((e) => el('div', { class: 'card-row broken', text: `${e.file}: ${e.error}` }));

  function projectRows() {
    const out = [];
    SECTIONS.forEach(([key, label], s) => {
      const items = state.lists.projects
        .filter((e) => e.data && e.data.section === key)
        .sort((a, b) => a.data.order - b.data.order || a.file.localeCompare(b.file));
      if (!items.length) return;
      out.push(el('div', { class: 'group', text: label }));
      items.forEach((entry, i) => out.push(listRow(entry, 'projects', `${s + 1}.${i + 1}`, entry.data.name)));
    });
    return [...out, ...brokenRows('projects')];
  }

  function experienceRows() {
    const items = state.lists.experience
      .filter((e) => e.data)
      .sort((a, b) => a.data.order - b.data.order || a.file.localeCompare(b.file));
    const rows = items.map((entry, i) => listRow(entry, 'experience', String(i + 1),
      `${entry.data.role}, ${String(entry.data.company).split('·')[0].trim()}`));
    if (!rows.length) rows.push(el('p', { class: 'list-note', text: 'No experience entries yet.' }));
    return [...rows, ...brokenRows('experience')];
  }

  function renderSidebar() {
    document.querySelectorAll('.tab').forEach((t) => {
      const on = t.dataset.tab === state.tab;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', String(on));
    });
    const host = $('listBody');
    if (state.tab === 'resume') {
      host.replaceChildren(el('p', { class: 'list-note', text: 'Replace a resume PDF on the right.' }));
      return;
    }
    const kind = state.tab;
    host.replaceChildren(
      el('button', {
        type: 'button', class: 'btn small wide',
        text: kind === 'projects' ? '+ Add a project' : '+ Add experience',
        onclick: () => startNew(kind),
      }),
      ...(kind === 'projects' ? projectRows() : experienceRows()));
  }

  /* ── editor lifecycle ── */

  function renderEditor() {
    const host = $('editor');
    state.invalid = new Set();
    if (state.tab === 'resume') { host.replaceChildren(resumePanel()); return; }
    if (!state.current || state.current.kind !== state.tab) {
      host.replaceChildren(el('div', { class: 'editor-empty' },
        el('p', { text: state.tab === 'projects'
          ? 'Pick a project on the left to edit it, or add a new one.'
          : 'Pick an entry on the left to edit it, or add a new one.' })));
      return;
    }
    host.replaceChildren(state.current.kind === 'projects'
      ? projectEditor(state.current.draft)
      : experienceEditor(state.current.draft));
    if (state.flash) { setStatus(state.flash.text, state.flash.kind); state.flash = null; }
  }

  function open(kind, entry) {
    if (!guard()) return;
    state.current = { kind, file: entry.file, sha: entry.sha, draft: structuredClone(entry.data) };
    state.dirty = false;
    renderSidebar();
    renderEditor();
  }

  function startNew(kind) {
    if (!guard()) return;
    state.current = { kind, file: null, sha: null, draft: kind === 'projects' ? blankProject() : blankExperience() };
    state.dirty = false;
    renderSidebar();
    renderEditor();
  }

  function setStatus(text, kind = '') {
    const status = $('status');
    if (!status) return;
    status.textContent = text;
    status.className = `hint ${kind}`;
  }

  function markDirty() {
    state.dirty = true;
    const status = $('status');
    if (status && !status.classList.contains('busy')) setStatus('Unsaved changes');
    refreshPreview();
  }

  function showErrors(message, lines = []) {
    const box = $('errors');
    if (!box) return;
    box.replaceChildren(el('strong', { text: message }), ...lines.map((line) => el('div', { text: `· ${line}` })));
    box.hidden = false;
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /* ── save and delete ── */

  function tidy(kind, o) {
    const clean = (arr) => (arr || []).map((s) => String(s).trim()).filter(Boolean);
    const dropBlank = (obj, keys) => keys.forEach((k) => { if (typeof obj[k] === 'string' && !obj[k].trim()) delete obj[k]; });

    if (kind === 'experience') {
      o.bullets = clean(o.bullets);
      dropBlank(o, ['period_note', 'summary']);
      if (o.link && !String(o.link.text || '').trim() && !String(o.link.url || '').trim()) delete o.link;
      return orderKeys(o, EXPERIENCE_KEYS);
    }

    o.tags = clean(o.tags);
    dropBlank(o, ['lede']);
    for (const b of o.blocks || []) {
      if (b.type === 'text') b.paras = clean(b.paras);
      if (b.type === 'bullets') b.items = clean(b.items);
      if (b.type === 'nulls') {
        b.items = clean(b.items);
        b.after = clean(b.after);
        if (!b.items.length) delete b.items;
        if (!b.after.length) delete b.after;
      }
      if (b.type === 'table') {
        b.cols = (b.cols || []).map((c) => String(c).trim());
        b.rows = (b.rows || []).filter((r) => r.some((c) => String(c ?? '').replace(/^\*/, '').trim()));
        dropBlank(b, ['caption', 'note']);
      }
    }
    for (const box of o.sidebar || []) {
      if (box.type === 'tags') box.items = clean(box.items);
      if (box.type === 'metrics') box.items = (box.items || []).filter((r) => String(r[0] ?? '').trim() || String(r[1] ?? '').trim());
      if (box.type === 'links') box.items = (box.items || []).filter((r) => String(r[0] ?? '').trim() && String(r[1] ?? '').trim());
    }
    return orderKeys(o, PROJECT_KEYS);
  }

  async function save() {
    const current = state.current;
    if (!current) return;
    $('errors').hidden = true;

    if (state.invalid.size) {
      showErrors('An advanced section has a formatting error. It is outlined in red: fix it, then save again.');
      return;
    }

    const item = tidy(current.kind, structuredClone(current.draft));
    const button = $('save');
    button.disabled = true;
    setStatus('Saving…', 'busy');

    try {
      const result = await api(COLLECTIONS[current.kind], {
        method: 'POST',
        body: JSON.stringify({ item, sha: current.sha, previousFile: current.file }),
      });
      state.dirty = false;
      await loadAll();
      const fresh = state.lists[current.kind].find((e) => e.file === result.file);
      state.current = fresh
        ? { kind: current.kind, file: fresh.file, sha: fresh.sha, draft: structuredClone(fresh.data) }
        : { ...current, file: result.file, sha: null, draft: item };
      state.flash = { text: 'Saved. The live site will show it in about 90 seconds.', kind: 'ok' };
      renderSidebar();
      renderEditor();
    } catch (err) {
      button.disabled = false;
      setStatus('Not saved', 'bad');
      if (err.status === 401) showErrors('You have been signed out. Copy anything you typed, then reload the page and sign in again.');
      else showErrors(err.message, err.lines);
    }
  }

  async function remove() {
    const current = state.current;
    if (!current || !current.file) return;
    const name = current.kind === 'projects' ? current.draft.name : current.draft.role;
    if (!confirm(`Remove "${name}" from the site?\n\nIt disappears from the live site in about 90 seconds. It can be restored from GitHub history, but not from here.`)) return;

    setStatus('Removing…', 'busy');
    try {
      await api(COLLECTIONS[current.kind], { method: 'DELETE', body: JSON.stringify({ file: current.file }) });
      state.dirty = false;
      state.current = null;
      await loadAll();
      renderSidebar();
      renderEditor();
    } catch (err) {
      setStatus('Not removed', 'bad');
      showErrors(err.message, err.lines);
    }
  }

  /* ── boot ── */

  async function loadAll() {
    const [projects, experience] = await Promise.all([api(COLLECTIONS.projects), api(COLLECTIONS.experience)]);
    state.lists.projects = projects.items;
    state.lists.experience = experience.items;
  }

  document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => {
    if (tab.dataset.tab === state.tab || !guard()) return;
    state.tab = tab.dataset.tab;
    state.current = null;
    state.dirty = false;
    renderSidebar();
    renderEditor();
  }));

  $('logout').addEventListener('click', async () => {
    if (!guard()) return;
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    state.dirty = false;
    location.reload();
  });

  window.addEventListener('beforeunload', (e) => {
    if (!state.dirty) return;
    e.preventDefault();
    e.returnValue = '';
  });

  async function boot() {
    const error = new URLSearchParams(location.search).get('error');
    if (error) {
      $('gateError').textContent = error;
      $('gateError').hidden = false;
      history.replaceState(null, '', '/admin/');
    }

    const session = await api('/api/session').catch(() => ({ signedIn: false }));
    $('repoLabel').textContent = session.repo ? `${session.repo} · ${session.branch}` : '';

    if (!session.signedIn) {
      $('gate').hidden = false;
      return;
    }

    $('who').textContent = session.login;
    $('logout').hidden = false;
    $('app').hidden = false;

    try {
      await loadAll();
    } catch (err) {
      $('editor').replaceChildren(el('p', { class: 'errors', text: `Could not load the site content: ${err.message}` }));
      return;
    }
    renderSidebar();
    renderEditor();
  }

  boot();
})();
