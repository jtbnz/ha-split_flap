/*
  Split-Flap Departure Board
  Type: custom:split-flap-card

  A traditional split-flap (Solari) departure / arrivals board for the
  Auckland Transport integration (https://github.com/SeitzDaniel/auckland_transport).

  It reads the numbered `departure_N_*` attributes from an Auckland Transport
  sensor and splits services into two boards using the GTFS pickup_type:

    DEPARTURES (boardable here)   -> destination station | scheduled | actual
    ARRIVALS   (terminating here) -> origin station      | ETA

  Configuration options:
    - entity (required)        sensor entity provided by the integration
    - title                    custom board title (default: stop name + code)
    - board                    'both' | 'departures' | 'arrivals'  (default 'both')
    - max_rows                 max rows per section (default: all available)
    - time_format              '24' | '12'  (default '24')
    - filter                   include/exclude by route or destination (e.g. "70; !STA")
    - animate                  flip animation on change (default true)
    - hide_empty               hide a section when it has no services (default true)
    - show_clock               show a live clock in the header (default true)
    - destination_chars        flap width of the destination/origin column (default 16)
    - departures_label         section label (default 'Departures')
    - arrivals_label           section label (default 'Arrivals')
    - text_color               flap character colour       (default '#f4f3ee')
    - accent_color             label / header accent colour (default '#ffb400')
    - tile_color               flap tile colour            (default '#1b1b1f')
*/

/* global customElements, HTMLElement, setInterval, clearInterval, setTimeout */

const CARD_VERSION = 'v1.0.0';

const DEFAULTS = {
  title: undefined,
  board: 'both',
  max_rows: undefined,
  time_format: '24',
  filter: undefined,
  animate: true,
  hide_empty: true,
  show_clock: true,
  destination_chars: 16,
  departures_label: 'Departures',
  arrivals_label: 'Arrivals',
  text_color: '#f4f3ee',
  accent_color: '#ffb400',
  tile_color: '#1b1b1f',
};

class SplitFlapCard extends HTMLElement {
  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    this._render();
  }

  static getConfigElement() {
    return document.createElement('split-flap-card-editor');
  }

  static getStubConfig(hass, entities) {
    let sensor = (entities || []).find((e) => e.startsWith('sensor.auckland_transport'));
    if (!sensor && hass) {
      sensor = Object.keys(hass.states).find((e) => e.startsWith('sensor.auckland_transport'));
    }
    return { entity: sensor || '' };
  }

  setConfig(config) {
    if (!config || !config.entity) {
      throw new Error('Entity is required');
    }
    this._config = { ...DEFAULTS, ...config };
    // A config change can alter the layout; force a clean rebuild.
    this._layoutSig = null;
    this._lastSig = null;
    this._render();
  }

  connectedCallback() {
    if (this._config && this._config.show_clock && !this._clockTimer) {
      this._clockTimer = setInterval(() => this._tickClock(), 1000);
    }
  }

  disconnectedCallback() {
    if (this._clockTimer) {
      clearInterval(this._clockTimer);
      this._clockTimer = null;
    }
  }

  getCardSize() {
    const { departures, arrivals } = this._split();
    return Math.min((departures.length + arrivals.length) + 2, 12);
  }

  /* ---------------------------------------------------------------- data -- */

  _entityState() {
    if (!this._hass || !this._config) return undefined;
    return this._hass.states[this._config.entity];
  }

  _extractRows() {
    const stateObj = this._entityState();
    if (!stateObj) return [];
    const attrs = stateObj.attributes || {};
    const stopName = attrs.stop_name || attrs.stop || '';

    const rows = [];
    let index = 1;
    while (true) {
      const p = `departure_${index}`;
      const sched = attrs[`${p}_scheduled_time`];
      const actual = attrs[`${p}_actual_time`];
      const headsign = attrs[`${p}_headsign`];
      const route = attrs[`${p}_route`];
      if (!sched && !actual && !headsign && !route) break;

      const delay = attrs[`${p}_delay_in_seconds`];
      rows.push({
        scheduled: sched || null,
        actual: actual || sched || null,
        headsign: headsign || '',
        route: route || '',
        delaySeconds: typeof delay === 'number' ? delay : undefined,
        direction: this._computeDirection(attrs[`${p}_pickup_type`], headsign, stopName),
        origin: this._headsignOrigin(headsign),
        destination: this._headsignDestination(headsign),
      });
      index += 1;
    }

    const filterRaw = (this._config.filter || '').toString().trim();
    return filterRaw ? this._applyFilter(rows, filterRaw) : rows;
  }

  _split() {
    const rows = this._extractRows();
    const max = Number(this._config.max_rows);
    const limit = (arr) => (max && max > 0 ? arr.slice(0, max) : arr);

    const departures = [];
    const arrivals = [];
    rows.forEach((r) => {
      // Unknown direction is treated as a departure (the common case for a stop).
      if (r.direction === 'arriving') arrivals.push(r);
      else departures.push(r);
    });

    const mode = this._config.board;
    return {
      departures: mode === 'arrivals' ? [] : limit(departures),
      arrivals: mode === 'departures' ? [] : limit(arrivals),
    };
  }

  _applyFilter(rows, filterString) {
    const patterns = filterString.split(';').map((p) => p.trim()).filter(Boolean);
    if (!patterns.length) return rows;

    const filters = patterns.map((pattern) => {
      let include = true;
      let str = pattern;
      if (str.startsWith('!')) { include = false; str = str.slice(1); }
      let tester;
      if (str.startsWith('/') && str.lastIndexOf('/') > 0) {
        const last = str.lastIndexOf('/');
        try {
          const re = new RegExp(str.slice(1, last), str.slice(last + 1) || 'i');
          tester = (v) => re.test(v || '');
        } catch (e) {
          const needle = str.toLowerCase();
          tester = (v) => (v || '').toLowerCase().includes(needle);
        }
      } else {
        const needle = str.toLowerCase();
        tester = (v) => (v || '').toLowerCase().includes(needle);
      }
      return { include, tester };
    });

    const inc = filters.filter((f) => f.include);
    const exc = filters.filter((f) => !f.include);
    return rows.filter((row) => {
      const match = (f) => f.tester(row.route) || f.tester(row.headsign);
      const incOk = inc.length === 0 || inc.some(match);
      const excOk = exc.length === 0 || !exc.some(match);
      return incOk && excOk;
    });
  }

  _computeDirection(pickupType, headsign, stopName) {
    if (pickupType === 1 || pickupType === '1') return 'arriving';
    if (pickupType === 0 || pickupType === '0') return 'departing';
    // Fallback heuristic: a trip terminating at this stop is arriving here.
    const dest = this._headsignDestination(headsign);
    const core = this._stopCoreName(stopName);
    if (!dest || !core) return undefined;
    return dest.toLowerCase().includes(core.toLowerCase()) ? 'arriving' : 'departing';
  }

  _headsignDestination(headsign) {
    // "Pukekohe 1 To Brit 4 Via NKT 2" -> destination is after the last " To ".
    if (!headsign) return '';
    let s = headsign;
    const toIdx = s.toLowerCase().lastIndexOf(' to ');
    if (toIdx >= 0) s = s.slice(toIdx + 4);
    const viaIdx = s.toLowerCase().indexOf(' via ');
    if (viaIdx >= 0) s = s.slice(0, viaIdx);
    return s.replace(/\s+\d+\s*$/, '').trim();
  }

  _headsignOrigin(headsign) {
    // "Britomart 1 To Pukekohe 2" -> origin is the text before the first " To ".
    if (!headsign) return '';
    let s = headsign;
    const toIdx = s.toLowerCase().indexOf(' to ');
    if (toIdx >= 0) s = s.slice(0, toIdx);
    return s.replace(/\s+\d+\s*$/, '').trim();
  }

  _stopCoreName(stopName) {
    if (!stopName) return '';
    return stopName
      .replace(/\b(train|bus|ferry|station|stop|terminal|interchange|wharf|platform|depot)\b/gi, '')
      .replace(/\s+\d+\s*$/, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  _formatTime(timeStr) {
    if (!timeStr) return '--:--';
    const parts = timeStr.split(':');
    if (parts.length < 2) return timeStr;
    const hour = parseInt(parts[0], 10);
    const minute = parseInt(parts[1], 10);
    if (isNaN(hour) || isNaN(minute)) return timeStr;
    const mm = minute.toString().padStart(2, '0');
    if (this._config.time_format === '12') {
      const period = hour >= 12 ? 'PM' : 'AM';
      const h = hour === 0 ? 12 : (hour > 12 ? hour - 12 : hour);
      return `${h.toString().padStart(2, '0')}:${mm} ${period}`;
    }
    return `${hour.toString().padStart(2, '0')}:${mm}`;
  }

  /* -------------------------------------------------------------- render -- */

  _render() {
    if (!this._hass || !this._config) return;

    const stateObj = this._entityState();
    const { departures, arrivals } = this._split();

    // Skip work entirely when nothing relevant changed (avoids animation thrash
    // from unrelated hass updates, which fire on every HA state change).
    const sig = JSON.stringify({ s: !!stateObj, d: departures, a: arrivals });
    const layoutSig = this._computeLayoutSig(departures, arrivals);
    if (this._card && sig === this._lastSig && layoutSig === this._layoutSig) return;
    this._lastSig = sig;

    if (!this._card) this._buildShell();

    // Header title + clock.
    const attrs = stateObj?.attributes || {};
    const stopName = attrs.stop_name || attrs.stop || '';
    const stopCode = attrs.stop_code || '';
    const title = this._config.title ?? `${stopName}${stopCode ? ` ${stopCode}` : ''}`;
    this._titleEl.textContent = (title || 'Departure Board').toUpperCase();

    if (!stateObj) {
      this._emptyEl.textContent = 'Entity not found';
      this._emptyEl.style.display = 'block';
      this._sectionsEl.style.display = 'none';
      return;
    }

    // Rebuild the flap grid structure only when the layout changes.
    if (layoutSig !== this._layoutSig) {
      this._layoutSig = layoutSig;
      this._buildSections(departures, arrivals);
    }

    const hideEmpty = this._config.hide_empty;
    const total = departures.length + arrivals.length;
    if (total === 0) {
      this._emptyEl.textContent = 'No upcoming services';
      this._emptyEl.style.display = 'block';
      this._sectionsEl.style.display = 'none';
      return;
    }
    this._emptyEl.style.display = 'none';
    this._sectionsEl.style.display = 'flex';

    this._fillSection(this._depCells, departures, 'departure', hideEmpty);
    this._fillSection(this._arrCells, arrivals, 'arrival', hideEmpty);
  }

  _computeLayoutSig(departures, arrivals) {
    const mode = this._config.board;
    const depCount = mode === 'arrivals' ? 0 : departures.length;
    const arrCount = mode === 'departures' ? 0 : arrivals.length;
    const showDep = depCount > 0 || (mode !== 'arrivals' && !this._config.hide_empty);
    const showArr = arrCount > 0 || (mode !== 'departures' && !this._config.hide_empty);
    return [
      mode,
      showDep ? depCount : 'x',
      showArr ? arrCount : 'x',
      this._config.destination_chars,
    ].join('|');
  }

  _buildShell() {
    this._card = document.createElement('ha-card');

    const style = document.createElement('style');
    style.textContent = this._css();
    this._card.appendChild(style);

    const board = document.createElement('div');
    board.className = 'sf-board';

    const header = document.createElement('div');
    header.className = 'sf-header';

    this._titleEl = document.createElement('div');
    this._titleEl.className = 'sf-title';
    header.appendChild(this._titleEl);

    this._clockEl = document.createElement('div');
    this._clockEl.className = 'sf-clock';
    if (this._config.show_clock) header.appendChild(this._clockEl);

    board.appendChild(header);

    this._sectionsEl = document.createElement('div');
    this._sectionsEl.className = 'sf-sections';
    board.appendChild(this._sectionsEl);

    this._emptyEl = document.createElement('div');
    this._emptyEl.className = 'sf-empty';
    this._emptyEl.style.display = 'none';
    board.appendChild(this._emptyEl);

    this._card.appendChild(board);
    this.innerHTML = '';
    this.appendChild(this._card);

    if (this._config.show_clock) {
      this._tickClock();
      if (!this._clockTimer) this._clockTimer = setInterval(() => this._tickClock(), 1000);
    }
  }

  _tickClock() {
    if (!this._clockEl) return;
    const d = new Date();
    const pad = (n) => n.toString().padStart(2, '0');
    let h = d.getHours();
    let suffix = '';
    if (this._config.time_format === '12') {
      suffix = h >= 12 ? ' PM' : ' AM';
      h = h === 0 ? 12 : (h > 12 ? h - 12 : h);
    }
    this._clockEl.textContent = `${pad(h)}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${suffix}`;
  }

  _buildSections(departures, arrivals) {
    this._sectionsEl.innerHTML = '';
    this._depCells = null;
    this._arrCells = null;

    const mode = this._config.board;
    const destChars = Math.max(4, Number(this._config.destination_chars) || 16);

    if (mode !== 'arrivals' && (departures.length > 0 || !this._config.hide_empty)) {
      this._depCells = this._buildSection(
        this._config.departures_label,
        ['Destination', 'Sched', 'Actual'],
        [destChars, 5, 5],
        Math.max(departures.length, 1),
      );
    }
    if (mode !== 'departures' && (arrivals.length > 0 || !this._config.hide_empty)) {
      this._arrCells = this._buildSection(
        this._config.arrivals_label,
        ['From', 'ETA'],
        [destChars, 5],
        Math.max(arrivals.length, 1),
      );
    }
  }

  // Returns the array of per-row cell records so _fillSection can update them.
  _buildSection(label, headers, charWidths, rowCount) {
    const section = document.createElement('div');
    section.className = 'sf-section';

    const head = document.createElement('div');
    head.className = 'sf-section-head';
    const bar = document.createElement('span');
    bar.className = 'sf-bar';
    head.appendChild(bar);
    const lbl = document.createElement('span');
    lbl.className = 'sf-section-label';
    lbl.textContent = label.toUpperCase();
    head.appendChild(lbl);
    section.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'sf-grid';
    // Each column sizes to its flaps; rows pad to a fixed char count so every
    // column is uniform width and aligns down the board.
    grid.style.gridTemplateColumns = charWidths.map(() => 'max-content').join(' ');

    // Column header labels.
    headers.forEach((h, i) => {
      const hc = document.createElement('div');
      hc.className = 'sf-col-head';
      if (i > 0) hc.classList.add('sf-col-time');
      hc.textContent = h.toUpperCase();
      grid.appendChild(hc);
    });

    const rows = [];
    for (let r = 0; r < rowCount; r += 1) {
      const cells = [];
      charWidths.forEach((chars, i) => {
        const cell = document.createElement('div');
        cell.className = 'sf-cell';
        if (i > 0) cell.classList.add('sf-cell-time');
        this._ensureFlaps(cell, chars);
        grid.appendChild(cell);
        cells.push({ el: cell, chars });
      });
      rows.push(cells);
    }

    section.appendChild(grid);
    this._sectionsEl.appendChild(section);
    return { section, rows };
  }

  _fillSection(sectionRef, items, kind, hideEmpty) {
    if (!sectionRef) return;
    const hasItems = items.length > 0;
    sectionRef.section.style.display = hasItems || !hideEmpty ? 'block' : 'none';

    sectionRef.rows.forEach((cells, idx) => {
      const item = items[idx];
      if (!item) {
        cells.forEach((c) => this._setFlaps(c.el, '', c.chars));
        return;
      }
      if (kind === 'departure') {
        const dest = item.destination || item.headsign || item.route || '';
        this._setFlaps(cells[0].el, dest, cells[0].chars);
        this._setFlaps(cells[1].el, this._formatTime(item.scheduled), cells[1].chars);
        this._setFlaps(cells[2].el, this._formatTime(item.actual), cells[2].chars, this._delayClass(item));
      } else {
        const from = item.origin || item.route || item.headsign || '';
        this._setFlaps(cells[0].el, from, cells[0].chars);
        this._setFlaps(cells[1].el, this._formatTime(item.actual), cells[1].chars, this._delayClass(item));
      }
    });
  }

  _delayClass(item) {
    const d = item.delaySeconds;
    if (d === undefined || d === null || isNaN(d)) return 'sf-ontime';
    if (d > 59) return 'sf-late';
    if (d < -59) return 'sf-early';
    return 'sf-ontime';
  }

  _ensureFlaps(cell, chars) {
    while (cell.children.length > chars) cell.removeChild(cell.lastChild);
    while (cell.children.length < chars) {
      const flap = document.createElement('span');
      flap.className = 'sf-flap';
      const ch = document.createElement('span');
      ch.className = 'sf-char';
      ch.textContent = ' ';
      flap.appendChild(ch);
      cell.appendChild(flap);
    }
  }

  _setFlaps(cell, text, chars, statusClass) {
    this._ensureFlaps(cell, chars);
    const upper = (text || '').toUpperCase();
    const animate = this._config.animate;
    for (let i = 0; i < chars; i += 1) {
      const flap = cell.children[i];
      const ch = flap.firstChild;
      const target = i < upper.length ? upper[i] : ' ';
      const display = target === ' ' ? ' ' : target;

      if (statusClass) {
        flap.classList.remove('sf-late', 'sf-early', 'sf-ontime');
        flap.classList.add(statusClass);
      } else {
        flap.classList.remove('sf-late', 'sf-early', 'sf-ontime');
      }

      const current = ch.textContent === ' ' ? ' ' : ch.textContent;
      if (current === target) continue;

      if (!animate) {
        ch.textContent = display;
        continue;
      }
      this._flip(flap, ch, display, i);
    }
  }

  _flip(flap, ch, display, idx) {
    flap._next = display;
    const delay = Math.min(idx, 10) * 28;
    ch.style.animation = 'none';
    // Force reflow so the animation restarts even on rapid successive changes.
    void flap.offsetWidth;
    ch.style.animation = `sf-flip 0.34s ease-in-out ${delay}ms`;
    setTimeout(() => {
      if (flap.isConnected) ch.textContent = flap._next;
    }, delay + 150);
    const onEnd = () => {
      ch.style.animation = 'none';
      ch.removeEventListener('animationend', onEnd);
    };
    ch.addEventListener('animationend', onEnd);
  }

  _css() {
    return `
      ha-card {
        background: transparent;
        border: none;
        box-shadow: none;
      }
      .sf-board {
        --sf-text: ${this._config.text_color};
        --sf-accent: ${this._config.accent_color};
        --sf-tile: ${this._config.tile_color};
        --sf-tile-w: 1.05em;
        --sf-late: #ff5a4d;
        --sf-early: #ffb400;
        --sf-ontime: #57d977;
        background: #0a0a0b;
        border: 1px solid #000;
        border-radius: 10px;
        padding: 14px 16px 18px;
        box-shadow: inset 0 0 40px rgba(0,0,0,0.7), 0 4px 18px rgba(0,0,0,0.5);
        font-family: "Helvetica Neue", Arial, sans-serif;
        overflow-x: auto;
      }
      .sf-header {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 12px;
        padding-bottom: 12px;
        margin-bottom: 12px;
        border-bottom: 1px solid rgba(255,255,255,0.08);
      }
      .sf-title {
        color: var(--sf-accent);
        font-weight: 800;
        font-size: 1.15rem;
        letter-spacing: 0.14em;
      }
      .sf-clock {
        color: var(--sf-text);
        font-family: "Courier New", monospace;
        font-weight: 700;
        font-size: 1rem;
        letter-spacing: 0.06em;
        opacity: 0.85;
        white-space: nowrap;
      }
      .sf-sections { display: flex; flex-direction: column; gap: 18px; }
      .sf-section-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
      .sf-bar { width: 4px; height: 14px; background: var(--sf-accent); border-radius: 2px; }
      .sf-section-label {
        color: var(--sf-accent);
        font-weight: 700;
        font-size: 0.78rem;
        letter-spacing: 0.22em;
      }
      .sf-grid {
        display: grid;
        gap: 6px 22px;
        align-items: center;
        width: max-content;
      }
      .sf-col-head {
        color: rgba(255,255,255,0.45);
        font-size: 0.6rem;
        font-weight: 700;
        letter-spacing: 0.18em;
        padding-bottom: 2px;
      }
      .sf-col-time { text-align: left; }
      .sf-cell { display: inline-flex; gap: 2px; white-space: nowrap; }
      .sf-cell-time { justify-self: start; }
      .sf-flap {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: var(--sf-tile-w);
        height: 1.5em;
        background-color: var(--sf-tile);
        background-image: linear-gradient(180deg, rgba(255,255,255,0.07), rgba(0,0,0,0.32));
        border-radius: 3px;
        box-shadow: inset 0 0 2px rgba(0,0,0,0.9), 0 1px 1px rgba(0,0,0,0.6);
        font-family: "Courier New", monospace;
        font-weight: 700;
        font-size: 1.18rem;
        line-height: 1;
        color: var(--sf-text);
        perspective: 240px;
        overflow: hidden;
      }
      .sf-flap::after {
        content: "";
        position: absolute;
        left: 0; right: 0; top: 50%;
        height: 1px;
        background: rgba(0,0,0,0.65);
        transform: translateY(-50%);
        z-index: 2;
      }
      .sf-flap.sf-late { color: var(--sf-late); }
      .sf-flap.sf-early { color: var(--sf-early); }
      .sf-flap.sf-ontime { color: var(--sf-ontime); }
      .sf-char {
        display: inline-block;
        transform-origin: center center;
        backface-visibility: hidden;
      }
      .sf-empty {
        color: rgba(255,255,255,0.6);
        font-size: 0.9rem;
        padding: 18px 4px;
        text-align: center;
      }
      @keyframes sf-flip {
        0%   { transform: rotateX(0deg); }
        50%  { transform: rotateX(90deg); }
        100% { transform: rotateX(0deg); }
      }
    `;
  }
}

customElements.define('split-flap-card', SplitFlapCard);

/* ============================================================= editor ==== */

const EDITOR_SCHEMA = [
  { name: 'entity', required: true, selector: { entity: { domain: 'sensor' } } },
  { name: 'title', selector: { text: {} } },
  {
    name: 'board',
    selector: {
      select: {
        mode: 'dropdown',
        options: [
          { value: 'both', label: 'Both (departures + arrivals)' },
          { value: 'departures', label: 'Departures only' },
          { value: 'arrivals', label: 'Arrivals only' },
        ],
      },
    },
  },
  {
    name: '',
    type: 'grid',
    schema: [
      { name: 'max_rows', selector: { number: { min: 1, max: 30, mode: 'box' } } },
      { name: 'destination_chars', selector: { number: { min: 4, max: 40, mode: 'box' } } },
    ],
  },
  {
    name: '',
    type: 'grid',
    schema: [
      {
        name: 'time_format',
        selector: {
          select: {
            mode: 'dropdown',
            options: [
              { value: '24', label: '24 hour' },
              { value: '12', label: '12 hour' },
            ],
          },
        },
      },
      { name: 'filter', selector: { text: {} } },
    ],
  },
  {
    name: '',
    type: 'grid',
    schema: [
      { name: 'animate', selector: { boolean: {} } },
      { name: 'show_clock', selector: { boolean: {} } },
      { name: 'hide_empty', selector: { boolean: {} } },
    ],
  },
  {
    name: '',
    type: 'grid',
    schema: [
      { name: 'departures_label', selector: { text: {} } },
      { name: 'arrivals_label', selector: { text: {} } },
    ],
  },
  {
    name: '',
    type: 'grid',
    schema: [
      { name: 'text_color', selector: { text: {} } },
      { name: 'accent_color', selector: { text: {} } },
      { name: 'tile_color', selector: { text: {} } },
    ],
  },
];

const EDITOR_LABELS = {
  entity: 'Entity (Auckland Transport sensor)',
  title: 'Title (optional)',
  board: 'Board',
  max_rows: 'Max rows per section',
  destination_chars: 'Destination width (chars)',
  time_format: 'Time format',
  filter: 'Filter (e.g. "70; !STA")',
  animate: 'Flip animation',
  show_clock: 'Show clock',
  hide_empty: 'Hide empty section',
  departures_label: 'Departures label',
  arrivals_label: 'Arrivals label',
  text_color: 'Character colour',
  accent_color: 'Accent colour',
  tile_color: 'Tile colour',
};

class SplitFlapCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = { ...DEFAULTS, ...config };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  _render() {
    if (!this._config) return;
    if (!this._form) {
      this._form = document.createElement('ha-form');
      this._form.computeLabel = (schema) => EDITOR_LABELS[schema.name] || schema.name;
      this._form.addEventListener('value-changed', (ev) => {
        ev.stopPropagation();
        this.dispatchEvent(new CustomEvent('config-changed', {
          detail: { config: ev.detail.value },
          bubbles: true,
          composed: true,
        }));
      });
      this.appendChild(this._form);
    }
    this._form.hass = this._hass;
    this._form.schema = EDITOR_SCHEMA;
    this._form.data = this._config;
  }
}

customElements.define('split-flap-card-editor', SplitFlapCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'split-flap-card',
  name: 'Split-Flap Departure Board',
  description: 'A traditional split-flap arrivals/departures board for the Auckland Transport integration',
  preview: true,
  documentationURL: 'https://github.com/jtbnz/ha-split_flap',
});

console.info(
  `%c Split-Flap Card %c ${CARD_VERSION} `,
  'background: #1b1b1f; color: #ffb400; border-radius: 3px 0 0 3px; padding: 2px 6px; font-weight: 700;',
  'background: #ffb400; color: #1b1b1f; border-radius: 0 3px 3px 0; padding: 2px 6px; font-weight: 700;',
);
