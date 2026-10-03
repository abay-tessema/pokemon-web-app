// ===== Config =====
const API = 'https://pokeapi.co/api/v2';
const PAGE_SIZE = 24;

const TYPE_COLORS = {
  normal: '#A8A77A', fire: '#EE8130', water: '#6390F0', electric: '#F7D02C',
  grass: '#7AC74C', ice: '#96D9D6', fighting: '#C22E28', poison: '#A33EA1',
  ground: '#E2BF65', flying: '#A98FF3', psychic: '#F95587', bug: '#A6B91A',
  rock: '#B6A136', ghost: '#735797', dragon: '#6F35FC', dark: '#705746',
  steel: '#B7B7CE', fairy: '#D685AD'
};

// ===== DOM =====
const els = {
  grid: document.getElementById('grid'),
  status: document.getElementById('status'),
  search: document.getElementById('search'),
  count: document.getElementById('count'),
  prev: document.getElementById('prev'),
  next: document.getElementById('next'),
  pageInfo: document.getElementById('page-info'),
  dialog: document.getElementById('dialog'),
  dialogContent: document.getElementById('dialog-content')
};

// ===== State =====
const state = {
  all: [],          // every { name, url } from the API
  filtered: [],     // list after search
  page: 0,
  cache: new Map(), // name -> Promise<pokemon details>
  renderId: 0       // ignores stale renders when the user types / pages quickly
};

// ===== Helpers =====
async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

function simplify(data) {
  const art = data.sprites.other && data.sprites.other['official-artwork'];
  return {
    id: data.id,
    name: data.name,
    image: (art && art.front_default) || data.sprites.front_default,
    types: data.types.map(t => t.type.name),
    abilities: data.abilities.map(a => ({ name: a.ability.name, hidden: a.is_hidden })),
    height: data.height / 10, // decimetres -> metres
    weight: data.weight / 10, // hectograms -> kilograms
    stats: data.stats.map(s => ({ name: s.stat.name, value: s.base_stat }))
  };
}

// Fetch details once per Pokémon, then reuse from cache
function getPokemon(entry) {
  if (!state.cache.has(entry.name)) {
    const promise = getJSON(entry.url)
      .then(simplify)
      .catch(err => { state.cache.delete(entry.name); throw err; });
    state.cache.set(entry.name, promise);
  }
  return state.cache.get(entry.name);
}

const pretty = str => str.replace(/-/g, ' ');
const padId = id => '#' + String(id).padStart(3, '0');

const STAT_LABELS = {
  'hp': 'HP', 'attack': 'ATK', 'defense': 'DEF',
  'special-attack': 'SP.ATK', 'special-defense': 'SP.DEF', 'speed': 'SPD'
};

function setTypeColors(el, types) {
  const [t1, t2 = t1] = types;
  el.style.setProperty('--c1', TYPE_COLORS[t1] || '#888');
  el.style.setProperty('--c2', TYPE_COLORS[t2] || '#888');
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function typeBadges(types) {
  const wrap = el('div', 'types');
  types.forEach(t => wrap.append(el('span', 'type', t)));
  return wrap;
}

function pokemonImage(p, alt) {
  if (!p.image) return el('div', 'no-img', '?');
  const img = document.createElement('img');
  img.src = p.image;
  img.alt = alt;
  img.loading = 'lazy';
  return img;
}

// ===== Status messages =====
function showStatus(message, { loading = false, retry = null } = {}) {
  els.status.replaceChildren();
  if (loading) els.status.append(el('span', 'spinner'));
  els.status.append(el('span', '', message));
  if (retry) {
    const btn = el('button', 'retry', 'Try again');
    btn.type = 'button';
    btn.addEventListener('click', retry);
    els.status.append(btn);
  }
  els.status.classList.add('show');
}

function hideStatus() {
  els.status.classList.remove('show');
}

// ===== Cards =====
function skeletonCard() {
  return el('div', 'card skeleton');
}

function failedCard(name) {
  const card = el('article', 'card failed');
  card.append(el('p', 'name', pretty(name)), el('p', '', 'Could not load'));
  return card;
}

function createCard(p, index) {
  const card = el('article', 'card');
  setTypeColors(card, p.types);
  card.style.setProperty('--i', index);

  const button = el('button', 'reveal', 'Who am I?');
  button.type = 'button';
  button.setAttribute('aria-label', `Show abilities of ${pretty(p.name)}`);
  button.addEventListener('click', () => openDetails(p));

  card.append(
    el('span', 'poke-id', padId(p.id)),
    pokemonImage(p, pretty(p.name)),
    el('h2', 'name', pretty(p.name)),
    typeBadges(p.types),
    button
  );
  return card;
}

// ===== Rendering =====
async function render() {
  const id = ++state.renderId;
  const total = state.filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  state.page = Math.min(state.page, totalPages - 1);

  updateCount();
  updatePager(totalPages);

  const start = state.page * PAGE_SIZE;
  const slice = state.filtered.slice(start, start + PAGE_SIZE);

  if (slice.length === 0) {
    els.grid.replaceChildren();
    showStatus(`No Pokémon match “${els.search.value.trim()}”.`);
    return;
  }

  // Loading state: message + shimmering placeholder cards
  showStatus('Catching Pokémon…', { loading: true });
  els.grid.setAttribute('aria-busy', 'true');
  els.grid.replaceChildren(...slice.map(skeletonCard));

  const results = await Promise.allSettled(slice.map(getPokemon));
  if (id !== state.renderId) return; // a newer render started meanwhile

  els.grid.replaceChildren(...results.map((r, i) =>
    r.status === 'fulfilled' ? createCard(r.value, i) : failedCard(slice[i].name)
  ));
  els.grid.setAttribute('aria-busy', 'false');

  if (results.every(r => r.status === 'rejected')) {
    showStatus('Could not load this page.', { retry: render });
  } else {
    hideStatus();
  }
}

function updateCount() {
  const n = state.filtered.length.toLocaleString();
  els.count.textContent = els.search.value.trim()
    ? `${n} match${state.filtered.length === 1 ? '' : 'es'}`
    : `${n} Pokémon`;
}

function updatePager(totalPages) {
  els.prev.disabled = state.page === 0;
  els.next.disabled = state.page >= totalPages - 1;
  els.pageInfo.textContent = `Page ${state.page + 1} of ${totalPages}`;
}

function goToPage(page) {
  state.page = page;
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ===== Details dialog =====
function openDetails(p) {
  const firstAbility = p.abilities[0] ? pretty(p.abilities[0].name) : 'no ability';
  const content = el('div');
  setTypeColors(els.dialog, p.types);

  // Hero
  const hero = el('div', 'dialog-hero');
  const close = el('button', 'close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  close.addEventListener('click', () => els.dialog.close());
  hero.append(
    close,
    pokemonImage(p, pretty(p.name)),
    el('span', 'poke-id', padId(p.id)),
    el('h2', '', pretty(p.name)),
    typeBadges(p.types)
  );

  // Body
  const body = el('div', 'dialog-body');

  const speech = el('p', 'speech');
  speech.append('I am ', el('strong', '', pretty(p.name)), ' and I have ', el('strong', '', firstAbility), '.');

  const abilities = el('div');
  const chips = el('div', 'chips');
  p.abilities.forEach(a => {
    const chip = el('span', 'chip' + (a.hidden ? ' hidden-ability' : ''), pretty(a.name));
    if (a.hidden) chip.title = 'Hidden ability';
    chips.append(chip);
  });
  abilities.append(el('h3', 'section-title', 'Abilities'), chips);

  const facts = el('div', 'facts');
  [[`${p.height} m`, 'Height'], [`${p.weight} kg`, 'Weight']].forEach(([value, label]) => {
    const fact = el('div', 'fact');
    fact.append(el('b', '', value), el('span', '', label));
    facts.append(fact);
  });

  const stats = el('div');
  stats.append(el('h3', 'section-title', 'Base stats'));
  p.stats.forEach(s => {
    const row = el('div', 'stat');
    const bar = el('div', 'stat-bar');
    const fill = el('i');
    fill.style.width = `${Math.min(100, (s.value / 200) * 100)}%`;
    bar.append(fill);
    row.append(el('span', 'stat-name', STAT_LABELS[s.name] || s.name), el('b', '', s.value), bar);
    stats.append(row);
  });

  body.append(speech, abilities, facts, stats);
  content.append(hero, body);
  els.dialogContent.replaceChildren(content);
  els.dialog.showModal();
}

// Close when clicking the backdrop
els.dialog.addEventListener('click', e => {
  if (e.target === els.dialog) els.dialog.close();
});

// ===== Search =====
let searchTimer;
els.search.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const term = els.search.value.trim().toLowerCase().replace(/\s+/g, '-');
    state.filtered = term
      ? state.all.filter(p => p.name.includes(term))
      : state.all;
    state.page = 0;
    render();
  }, 250);
});

// Press "/" anywhere to jump to search
document.addEventListener('keydown', e => {
  if (e.key === '/' && document.activeElement !== els.search && !els.dialog.open) {
    e.preventDefault();
    els.search.focus();
  }
});

// ===== Pagination =====
els.prev.addEventListener('click', () => goToPage(state.page - 1));
els.next.addEventListener('click', () => goToPage(state.page + 1));

// ===== Start =====
async function init() {
  showStatus('Loading the Pokédex…', { loading: true });
  els.prev.disabled = els.next.disabled = true;
  try {
    // One small request for every name; details are fetched per page
    const data = await getJSON(`${API}/pokemon?limit=100000&offset=0`);
    state.all = data.results;
    state.filtered = state.all;
    render();
  } catch (err) {
    showStatus('Could not reach PokéAPI. Check your connection.', { retry: init });
  }
}

init();
