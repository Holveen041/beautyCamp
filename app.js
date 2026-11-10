'use strict';

/* ============================================================================
   AI ARENA — попарные сравнения с рейтингом
   ----------------------------------------------------------------------------
   Главный файл: здесь и список участников, и вся логика.

   Как это работает:
   1. Каждая пара участников встречается ровно один раз (полный турнир).
      Для 12 участников это 66 сравнений в 11 раундах.
   2. Затем идут до двух раундов «доп. проверок»: повторно сравниваются
      самые спорные пары — те, что участвуют в логических циклах
      («A лучше B, B лучше C, но C лучше A») и соседи по рейтингу.
   3. Итог считается по методу Коупленда: победа в паре даёт 1 очко,
      ничья — 0,5. Циклы («A лучше B, B лучше C, но C лучше A») не ломают
      рейтинг: взаимные победы уравновешиваются, а места решают результаты
      против остальных участников.
   ========================================================================== */


/* ============================================================================
   1. СПИСОК УЧАСТНИКОВ
   ----------------------------------------------------------------------------
   Меняйте этот массив — сайт сам подстроится под любое количество (от 2 до ~30).
   Порядок в массиве ни на что не влияет.
   ========================================================================== */

const CONTESTANTS = [
  'Влада',
  'Диана С',
  'Варя',
  'Виолетта',
  'София',
  'Катя',
  'Диана Б',
  'Кристина',
  'Дарина',
  'Даша',
  'Саша',
  'Ксюша',
];


/* ============================================================================
   2. НАСТРОЙКИ
   ========================================================================== */

const MAX_VERIFY_ROUNDS = 2;   // сколько раундов доп. проверок максимум
const VERIFY_ROUND_SIZE = 6;   // сколько пар сравниваем в одном раунде проверок
const MAX_MATCHES_PER_PAIR = 3; // предохранитель: больше 3 раз одну пару не спрашиваем


/* ============================================================================
   3. КОНСТАНТЫ, ПАЛИТРА, УТИЛИТЫ
   ========================================================================== */

const N = CONTESTANTS.length;
const REDUCED_MOTION = typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const GRADIENTS = [
  ['#6366f1', '#a855f7'],
  ['#06b6d4', '#3b82f6'],
  ['#f43f5e', '#f97316'],
  ['#10b981', '#84cc16'],
  ['#eab308', '#f97316'],
  ['#8b5cf6', '#ec4899'],
  ['#14b8a6', '#06b6d4'],
  ['#ef4444', '#a855f7'],
  ['#3b82f6', '#22d3ee'],
  ['#f59e0b', '#ef4444'],
  ['#22c55e', '#14b8a6'],
  ['#d946ef', '#6366f1'],
];

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function pairKey(a, b) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function hashString(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function gradientFor(name) {
  return GRADIENTS[hashString(name) % GRADIENTS.length];
}

function initials(name) {
  const words = String(name).trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function plural(count, forms) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
  return forms[2];
}


/* ============================================================================
   4. РАСПИСАНИЕ ТУРНИРА (чистая логика)
   ========================================================================== */

/**
 * Полный круг (round-robin) по «методу круга»: каждая пара встречается ровно
 * один раз, участники равномерно распределены по раундам.
 * Возвращает массив раундов; раунд — массив пар [a, b] (индексы участников).
 */
function buildRoundRobinRounds(n) {
  const order = [...Array(n).keys()];
  shuffle(order);
  if (n % 2 === 1) order.push(-1); // «пустой» слот для нечётного количества

  const size = order.length;
  const rounds = [];

  for (let round = 0; round < size - 1; round += 1) {
    const matches = [];
    for (let i = 0; i < size / 2; i += 1) {
      const a = order[i];
      const b = order[size - 1 - i];
      if (a !== -1 && b !== -1) matches.push([a, b]);
    }
    shuffle(matches);
    rounds.push(matches);
    order.splice(1, 0, order.pop()); // фиксируем первого, остальных вращаем
  }

  return rounds;
}

/**
 * Сколько всего сравнений нужно на полный круг: n * (n - 1) / 2.
 */
function totalRoundRobinMatches(n) {
  return (n * (n - 1)) / 2;
}


/* ============================================================================
   5. РЕЙТИНГ: МЕТОД КОУПЛЕНДА (чистая логика)
   ========================================================================== */

/**
 * Строит итоговый рейтинг.
 *
 * wins[a][b] — сколько раз участник a побеждал b (напрямую).
 * reps[a][b] — сколько раз пара (a, b) вообще сравнивалась.
 *
 * Каждая пара даёт одно очко: победа — 1, ничья — 0,5, поражение — 0.
 * Поэтому цикл «A > B > C > A» не ломает рейтинг: взаимные победы
 * уравновешиваются, а места решают результаты против остальных.
 * Доп. сравнения уточняют счёт в паре (например, 2:0 вместо 1:0).
 */
function computeStandings(wins, reps, names) {
  const n = names.length;
  const rows = [];

  for (let i = 0; i < n; i += 1) {
    let points = 0;
    let pairWins = 0;
    let pairLosses = 0;
    let pairTies = 0;
    let matchWins = 0;
    let seriesMargin = 0;

    for (let j = 0; j < n; j += 1) {
      if (i === j) continue;

      const won = wins[i][j];
      const lost = wins[j][i];

      seriesMargin += won - lost;
      matchWins += won;

      if (won > lost) {
        points += 1;
        pairWins += 1;
      } else if (won < lost) {
        pairLosses += 1;
      } else if (reps[i][j] > 0) {
        points += 0.5;
        pairTies += 1;
      }
    }

    rows.push({
      index: i,
      name: names[i],
      points,
      pairWins,
      pairLosses,
      pairTies,
      matchWins,
      seriesMargin,
    });
  }

  rows.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.seriesMargin !== a.seriesMargin) return b.seriesMargin - a.seriesMargin;
    if (b.matchWins !== a.matchWins) return b.matchWins - a.matchWins;
    if (b.pairWins !== a.pairWins) return b.pairWins - a.pairWins;
    return a.name.localeCompare(b.name, 'ru');
  });

  return rows;
}

/**
 * Проверка: образуют ли три участника логический цикл
 * (камень–ножницы–бумага).
 */
function isThreeCycle(wins, i, j, k) {
  const edge = (a, b) => {
    const diff = wins[a][b] - wins[b][a];
    if (diff === 0) return 0;
    return diff > 0 ? 1 : -1;
  };

  const ij = edge(i, j);
  const jk = edge(j, k);
  const ik = edge(i, k);

  if (ij === 0 || jk === 0 || ik === 0) return false;

  return ij === 1
    ? jk === 1 && ik === -1
    : jk === -1 && ik === 1;
}

/**
 * Сколько всего логических циклов в текущих результатах.
 */
function countCycles(wins, n) {
  let count = 0;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      for (let k = j + 1; k < n; k += 1) {
        if (isThreeCycle(wins, i, j, k)) count += 1;
      }
    }
  }
  return count;
}

/**
 * Для каждой пары — в скольких циклах она участвует.
 * Чем больше, тем полезнее спросить эту пару ещё раз.
 */
function countCycleParticipation(wins, n) {
  const counts = new Map();

  const bump = (a, b) => {
    const key = pairKey(a, b);
    counts.set(key, (counts.get(key) || 0) + 1);
  };

  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      for (let k = j + 1; k < n; k += 1) {
        if (isThreeCycle(wins, i, j, k)) {
          bump(i, j);
          bump(j, k);
          bump(i, k);
        }
      }
    }
  }

  return counts;
}

/**
 * Выбирает пары для раунда доп. проверок:
 * — участники циклов (чем больше циклов, тем важнее);
 * — соседи по текущему рейтингу (там решается судьба мест);
 * — пары, где ещё мало сравнений и маленький перевес.
 */
function pickVerificationPairs(wins, reps, names, limit) {
  const n = names.length;
  if (n < 3) return [];

  const standings = computeStandings(wins, reps, names);
  const positions = new Map();
  standings.forEach((row, position) => positions.set(row.index, position));

  const involvement = countCycleParticipation(wins, n);
  const candidates = [];

  for (let a = 0; a < n; a += 1) {
    for (let b = a + 1; b < n; b += 1) {
      const matches = reps[a][b];
      if (matches >= MAX_MATCHES_PER_PAIR) continue;

      const cycles = involvement.get(pairKey(a, b)) || 0;
      const neighbours = Math.abs(positions.get(a) - positions.get(b)) === 1;
      const margin = Math.abs(wins[a][b] - wins[b][a]);

      // уже уверенно решённую пару не переспрашиваем
      if (matches >= 2 && margin >= 2) continue;
      if (cycles === 0 && !neighbours) continue;

      const priority =
        cycles * 10 +
        (neighbours ? 6 : 0) -
        matches * 4 -
        margin;

      candidates.push({
        a,
        b,
        priority,
        margin,
        tiebreak: Math.random(),
      });
    }
  }

  candidates.sort((x, y) => {
    if (y.priority !== x.priority) return y.priority - x.priority;
    if (x.margin !== y.margin) return x.margin - y.margin;
    return x.tiebreak - y.tiebreak;
  });

  return candidates
    .slice(0, Math.min(limit, candidates.length))
    .map(({ a, b }) => [a, b]);
}


/* ============================================================================
   6. СОСТОЯНИЕ ТУРНИРА
   ========================================================================== */

const wins = Array.from({ length: N }, () => new Array(N).fill(0));
const reps = Array.from({ length: N }, () => new Array(N).fill(0));
const els = {};

let rounds = [];            // очередь раундов; раунд — массив пар
let roundIdx = 0;
let matchIdx = 0;
let currentPair = null;     // [верхний, нижний]
let completed = 0;
let totalMatches = 0;
let baseRoundCount = 0;
let verificationRounds = 0;
let busy = false;
let finished = false;


/* ============================================================================
   7. ИНТЕРФЕЙС
   ========================================================================== */

function collectElements() {
  els.arena = document.getElementById('arena');
  els.cardTop = document.getElementById('cardTop');
  els.cardBottom = document.getElementById('cardBottom');
  els.avatarTop = document.getElementById('avatarTop');
  els.avatarBottom = document.getElementById('avatarBottom');
  els.nameTop = document.getElementById('nameTop');
  els.nameBottom = document.getElementById('nameBottom');
  els.roundLabel = document.getElementById('roundLabel');
  els.countLabel = document.getElementById('countLabel');
  els.progressBar = document.getElementById('progressBar');
  els.progressTrack = document.getElementById('progressTrack');
  els.result = document.getElementById('result');
  els.resultSub = document.getElementById('resultSub');
  els.resultNote = document.getElementById('resultNote');
  els.ranking = document.getElementById('ranking');
  els.restartBtn = document.getElementById('restartBtn');
  els.footerInfo = document.getElementById('footerInfo');
}

function bindEvents() {
  els.cardTop.addEventListener('click', () => choose(true));
  els.cardBottom.addEventListener('click', () => choose(false));

  els.restartBtn.addEventListener('click', () => {
    window.location.reload();
  });

  document.addEventListener('keydown', (event) => {
    if (finished) return;
    if (event.key === 'ArrowUp' || event.key === '1') {
      event.preventDefault();
      choose(true);
    } else if (event.key === 'ArrowDown' || event.key === '2') {
      event.preventDefault();
      choose(false);
    }
  });
}

function init() {
  collectElements();

  if (N < 2) {
    els.arena.innerHTML =
      '<p class="arena__question">Добавьте в массив CONTESTANTS хотя бы двух участников.</p>';
    els.roundLabel.textContent = '';
    els.countLabel.textContent = '';
    return;
  }

  bindEvents();

  rounds = buildRoundRobinRounds(N);
  baseRoundCount = rounds.length;
  totalMatches = rounds.reduce((sum, round) => sum + round.length, 0);

  showNextPair();
}

/* --------------------------- показ пары ---------------------------------- */

function showNextPair() {
  if (finished) return;

  if (roundIdx >= rounds.length) {
    finish();
    return;
  }

  const round = rounds[roundIdx];

  if (matchIdx >= round.length) {
    roundIdx += 1;
    matchIdx = 0;

    if (roundIdx >= rounds.length && !addVerificationRound()) {
      finish();
      return;
    }

    showNextPair();
    return;
  }

  const pair = round[matchIdx];
  // «сверху и снизу» — каждый раз случайно
  currentPair = Math.random() < 0.5
    ? [pair[0], pair[1]]
    : [pair[1], pair[0]];

  renderPair(currentPair[0], currentPair[1]);
  updateProgress();
}

function renderPair(topIndex, bottomIndex) {
  fillCard(els.cardTop, els.avatarTop, els.nameTop, topIndex);
  fillCard(els.cardBottom, els.avatarBottom, els.nameBottom, bottomIndex);

  els.cardTop.setAttribute('aria-label', `Выбрать ${CONTESTANTS[topIndex]}`);
  els.cardBottom.setAttribute('aria-label', `Выбрать ${CONTESTANTS[bottomIndex]}`);

  animateIn(els.cardTop, 0);
  animateIn(els.cardBottom, 60);
}

function fillCard(card, avatarEl, nameEl, index) {
  const name = CONTESTANTS[index];
  nameEl.textContent = name;
  avatarEl.textContent = initials(name);

  const [from, to] = gradientFor(name);
  avatarEl.style.backgroundImage = `linear-gradient(135deg, ${from}, ${to})`;
}

function animateIn(element, delay) {
  if (REDUCED_MOTION || typeof element.animate !== 'function') return;

  element.animate(
    [
      { opacity: 0, transform: 'translateY(14px) scale(0.985)' },
      { opacity: 1, transform: 'translateY(0) scale(1)' },
    ],
    {
      duration: 340,
      delay,
      easing: 'cubic-bezier(0.22, 0.75, 0.25, 1)',
    }
  );
}

/* --------------------------- выбор победителя ---------------------------- */

function choose(topWins) {
  if (busy || finished || !currentPair) return;
  busy = true;

  const winner = topWins ? currentPair[0] : currentPair[1];
  const loser = topWins ? currentPair[1] : currentPair[0];

  wins[winner][loser] += 1;
  reps[winner][loser] += 1;
  reps[loser][winner] += 1;
  completed += 1;

  const winnerCard = topWins ? els.cardTop : els.cardBottom;
  const loserCard = topWins ? els.cardBottom : els.cardTop;
  winnerCard.classList.add('card--chosen');
  loserCard.classList.add('card--rejected');

  updateProgress();

  window.setTimeout(() => {
    winnerCard.classList.remove('card--chosen');
    loserCard.classList.remove('card--rejected');

    busy = false;
    matchIdx += 1;
    showNextPair();
  }, REDUCED_MOTION ? 0 : 320);
}

/* --------------------------- доп. проверки -------------------------------- */

function addVerificationRound() {
  if (verificationRounds >= MAX_VERIFY_ROUNDS) return false;

  const pairs = pickVerificationPairs(wins, reps, CONTESTANTS, VERIFY_ROUND_SIZE);
  if (pairs.length === 0) return false;

  verificationRounds += 1;
  shuffle(pairs);
  rounds.push(pairs);
  totalMatches += pairs.length;

  return true;
}

/* --------------------------- прогресс ------------------------------------ */

function updateProgress() {
  const total = Math.max(totalMatches, 1);
  const percent = Math.min(100, Math.round((completed / total) * 100));

  els.progressBar.style.width = `${percent}%`;
  els.progressTrack.setAttribute('aria-valuenow', String(percent));
  els.countLabel.textContent = `${completed} / ${totalMatches}`;

  if (finished) {
    els.roundLabel.textContent = 'Готово';
    return;
  }

  if (roundIdx >= baseRoundCount) {
    const verificationNumber = roundIdx - baseRoundCount + 1;
    const verificationTotal = Math.max(1, rounds.length - baseRoundCount);
    els.roundLabel.textContent =
      `Доп. проверка ${verificationNumber} из ${verificationTotal}`;
  } else {
    els.roundLabel.textContent = `Раунд ${roundIdx + 1} из ${baseRoundCount}`;
  }
}

/* --------------------------- финал --------------------------------------- */

function finish() {
  finished = true;
  busy = false;
  currentPair = null;

  els.arena.hidden = true;
  els.result.hidden = false;

  updateProgress();
  renderResults();
}

function renderResults() {
  const standings = computeStandings(wins, reps, CONTESTANTS);
  const denominator = Math.max(1, N - 1);

  els.resultSub.textContent = `${N} участников · ${completed} сравнений`;
  els.ranking.innerHTML = '';

  standings.forEach((row, position) => {
    const item = document.createElement('li');
    item.className = 'rank';
    if (position < 3) item.classList.add(`rank--${position + 1}`);
    item.style.setProperty('--i', String(position));

    const place = document.createElement('span');
    place.className = 'rank__place';
    place.textContent = String(position + 1);

    const avatar = document.createElement('span');
    avatar.className = 'avatar avatar--sm';
    avatar.textContent = initials(row.name);
    const [from, to] = gradientFor(row.name);
    avatar.style.backgroundImage = `linear-gradient(135deg, ${from}, ${to})`;

    const main = document.createElement('span');
    main.className = 'rank__main';

    const nameEl = document.createElement('span');
    nameEl.className = 'rank__name';
    nameEl.textContent = row.name;

    const record = document.createElement('span');
    record.className = 'rank__record';
    const parts = [
      `${row.pairWins} ${plural(row.pairWins, ['победа', 'победы', 'побед'])}`,
      `${row.pairLosses} ${plural(row.pairLosses, ['поражение', 'поражения', 'поражений'])}`,
    ];
    if (row.pairTies > 0) {
      parts.push(`${row.pairTies} ${plural(row.pairTies, ['ничья', 'ничьи', 'ничьих'])}`);
    }
    record.textContent = parts.join(' · ');

    main.append(nameEl, record);

    const bar = document.createElement('span');
    bar.className = 'rank__bar';
    const fill = document.createElement('span');
    fill.style.width = `${Math.round((row.points / denominator) * 100)}%`;
    bar.appendChild(fill);

    item.append(place, avatar, main, bar);
    els.ranking.appendChild(item);
  });

  const cycles = countCycles(wins, N);
  els.resultNote.textContent = cycles > 0
    ? `Найдено логических циклов: ${cycles}. Это не ломает рейтинг: победа в паре даёт 1 очко, ничья — 0,5, поэтому взаимные победы уравновешиваются.`
    : 'Логических циклов не найдено: предпочтения полностью согласованы. Рейтинг построен по методу Коупленда (1 очко за победу, 0,5 — за ничью).';

  els.footerInfo.textContent =
    'Все сравнения проходили в браузере — ничего не сохранялось.';
}


/* ============================================================================
   8. СТАРТ
   ========================================================================== */

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}


/* ============================================================================
   9. ЭКСПОРТ ДЛЯ АВТОТЕСТОВ (в браузере не используется)
   ========================================================================== */

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildRoundRobinRounds,
    totalRoundRobinMatches,
    computeStandings,
    countCycles,
    countCycleParticipation,
    pickVerificationPairs,
    pairKey,
  };
}
