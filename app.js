(() => {
  'use strict';

  const API = 'https://api.opendota.com/api';
  const CDN = 'https://cdn.cloudflare.steamstatic.com';
  const STEAM64_BASE = 76561197960265728n;
  const EXAMPLE_MATCH = '9049094334';

  // Вес каждого показателя в итоговой оценке (сумма = 1).
  const WEIGHTS = {
    deaths_per_min: 0.25,
    gold_per_min: 0.15,
    hero_damage_per_min: 0.15,
    xp_per_min: 0.10,
    kills_per_min: 0.10,
    assists_per_min: 0.10,
    last_hits_per_min: 0.10,
    tower_damage: 0.05,
  };

  const METRIC_LABELS = {
    deaths_per_min: 'Смерти',
    gold_per_min: 'Золото в минуту',
    hero_damage_per_min: 'Урон по героям',
    xp_per_min: 'Опыт в минуту',
    kills_per_min: 'Убийства',
    assists_per_min: 'Помощь',
    last_hits_per_min: 'Добивания',
    tower_damage: 'Урон по строениям',
  };

  // null — показателя нет в данных матча (бывает в старых играх).
  const perMin = (v, p) => (typeof v === 'number' ? v / mins(p) : null);
  const num = v => (typeof v === 'number' ? v : null);
  const RAW_FIELDS = {
    deaths_per_min: p => perMin(p.deaths, p),
    gold_per_min: p => num(p.gold_per_min),
    hero_damage_per_min: p => perMin(p.hero_damage, p),
    xp_per_min: p => num(p.xp_per_min),
    kills_per_min: p => perMin(p.kills, p),
    assists_per_min: p => perMin(p.assists, p),
    last_hits_per_min: p => perMin(p.last_hits, p),
    tower_damage: p => num(p.tower_damage),
  };

  const GAME_MODES = {
    1: 'All Pick', 2: 'Captains Mode', 3: 'Random Draft', 4: 'Single Draft', 5: 'All Random',
    12: 'Least Played', 16: 'Captains Draft', 18: 'Ability Draft', 20: 'All Random Deathmatch',
    21: '1v1 Mid', 22: 'All Pick', 23: 'Turbo',
  };

  const ICONS = {
    crown: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m2 7 5 5 5-8 5 8 5-5-2 12H4Z"/></svg>',
    chev: '<svg class="chev icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
    skull: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><path d="M8 20v2h8v-2"/><path d="M16 20a2 2 0 0 0 1.56-3.25 8 8 0 1 0-11.12 0A2 2 0 0 0 8 20"/></svg>',
    door: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg>',
    down: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m22 17-8.5-8.5-5 5L2 7"/><path d="M16 17h6v-6"/></svg>',
    up: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/></svg>',
    shield: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/></svg>',
    swords: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 17.5 3 6V3h3l11.5 11.5"/><path d="m13 19 6-6"/><path d="m16 16 4 4"/><path d="m19 21 2-2"/></svg>',
    alert: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>',
    link: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
  };

  const $ = sel => document.querySelector(sel);
  const results = $('#results');
  const matchForm = $('#panel-match');
  const playerForm = $('#panel-player');
  const matchInput = $('#match-input');
  const playerInput = $('#player-input');

  let heroes = null;
  let currentRequest = 0;

  // ---------- helpers ----------

  function mins(p) { return Math.max((p.duration || 0) / 60, 1); }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function fmtDuration(sec) {
    const m = Math.floor(sec / 60), s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function fmtNum(n) {
    if (n >= 10000) return (n / 1000).toFixed(1).replace('.0', '') + 'k';
    return String(Math.round(n));
  }

  function timeAgo(unix) {
    const diff = Date.now() / 1000 - unix;
    if (diff < 3600) return `${Math.max(1, Math.round(diff / 60))} мин назад`;
    if (diff < 86400) return `${Math.round(diff / 3600)} ч назад`;
    if (diff < 86400 * 7) return `${Math.round(diff / 86400)} дн назад`;
    return new Date(unix * 1000).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function pctText(pct) { return `${Math.round(pct * 100)}%`; }

  function level(score) {
    if (score >= 75) return { cls: 'lvl-ruin', label: 'Руинер' };
    if (score >= 55) return { cls: 'lvl-sus', label: 'Подозрительно' };
    if (score >= 35) return { cls: 'lvl-ok', label: 'Норм' };
    return { cls: 'lvl-carry', label: 'Тащил' };
  }

  async function getJSON(url) {
    let res;
    try {
      res = await fetch(url);
    } catch {
      throw new Error('network');
    }
    if (res.status === 404) throw new Error('notfound');
    if (res.status === 429) throw new Error('ratelimit');
    if (!res.ok) throw new Error('server');
    return res.json();
  }

  async function loadHeroes() {
    if (heroes) return heroes;
    try {
      const cached = JSON.parse(localStorage.getItem('rf-heroes') || 'null');
      if (cached && Date.now() - cached.t < 7 * 86400e3) return (heroes = cached.data);
    } catch { /* storage unavailable */ }
    const raw = await getJSON(`${API}/constants/heroes`);
    const data = {};
    for (const h of Object.values(raw)) {
      data[h.id] = { name: h.localized_name, img: CDN + String(h.img || '').split('?')[0] };
    }
    try { localStorage.setItem('rf-heroes', JSON.stringify({ t: Date.now(), data })); } catch { /* ignore */ }
    return (heroes = data);
  }

  function hero(id) {
    return (heroes && heroes[id]) || { name: 'Неизвестный герой', img: '' };
  }

  // ---------- input parsing ----------

  function parseMatchId(input) {
    const s = input.trim();
    if (!s) return null;
    const fromUrl = s.match(/matches?\/(\d{6,})/i);
    if (fromUrl) return fromUrl[1];
    if (/^\d{6,}$/.test(s)) return s;
    const any = s.match(/\d{8,}/);
    return any ? any[0] : null;
  }

  function parseAccountId(input) {
    const s = input.trim();
    if (!s) return { error: 'Введите Steam ID или ссылку на профиль.' };
    if (/steamcommunity\.com\/id\//i.test(s)) {
      return { error: 'Короткие ссылки вида /id/имя не поддерживаются. Откройте профиль Steam → «Скопировать адрес страницы» в режиме /profiles/… или введите Friend ID из клиента Dota.' };
    }
    const fromUrl = s.match(/(?:profiles|players)\/(\d+)/i);
    const digits = fromUrl ? fromUrl[1] : (s.match(/^\d+$/) ? s : null);
    if (!digits) return { error: 'Не похоже на Steam ID. Нужны только цифры или ссылка на профиль.' };
    const n = BigInt(digits);
    if (n > STEAM64_BASE) return { id: String(n - STEAM64_BASE) };
    if (n > 0n && n < 4294967296n) return { id: digits };
    return { error: 'Не похоже на Steam ID. Проверьте цифры.' };
  }

  // ---------- scoring ----------

  function scorePlayers(match) {
    const players = match.players.map(p => ({ ...p, duration: p.duration || match.duration }));

    // Если у OpenDota нет бенчмарков, считаем перцентиль внутри матча.
    const fallback = {};
    for (const key of Object.keys(WEIGHTS)) {
      const vals = players.map(RAW_FIELDS[key]);
      const known = vals.filter(v => v !== null && isFinite(v));
      // Если все значения одинаковые (например, нули), показатель ничего не различает.
      const informative = known.length >= 2 && new Set(known).size > 1;
      fallback[key] = vals.map(v => {
        if (!informative || v === null || !isFinite(v)) return null;
        const better = known.filter(x => (key === 'deaths_per_min' ? x > v : x < v)).length;
        const equal = known.filter(x => x === v).length - 1;
        return (better + equal / 2) / (known.length - 1);
      });
    }

    const teamKills = { true: 0, false: 0 };
    for (const p of players) teamKills[isRadiant(p)] += p.kills;

    return players.map((p, i) => {
      const pcts = {};
      let usedBench = false;
      for (const key of Object.keys(WEIGHTS)) {
        const b = p.benchmarks && p.benchmarks[key];
        const raw = RAW_FIELDS[key](p);
        if (raw !== null && b && typeof b.pct === 'number' && isFinite(b.pct)) {
          pcts[key] = Math.min(1, Math.max(0, b.pct));
          usedBench = true;
        } else {
          pcts[key] = fallback[key][i];
        }
      }

      let perf = 0, wSum = 0;
      for (const [key, w] of Object.entries(WEIGHTS)) {
        if (pcts[key] === null) continue;
        perf += w * pcts[key];
        wSum += w;
      }
      let score = wSum > 0 ? Math.round((1 - perf / wSum) * 100) : 50;

      const left = p.leaver_status >= 2;
      if (left) score = Math.max(score, 95);

      const tk = teamKills[isRadiant(p)];
      const kp = tk > 0 ? (p.kills + p.assists) / tk : null;

      return { ...p, pcts, score, left, kp, usedBench, tags: tagsFor(p, pcts, left, kp, tk) };
    });
  }

  function isRadiant(p) { return p.player_slot < 128; }

  function tagsFor(p, pcts, left, kp, teamKills) {
    const bad = [], good = [];
    const below = (k, x) => pcts[k] !== null && pcts[k] < x;
    const above = (k, x) => pcts[k] !== null && pcts[k] > x;
    if (left) bad.push({ icon: ICONS.door, text: 'Покинул игру' });
    if (p.deaths >= 8 && below('deaths_per_min', 0.25)) bad.push({ icon: ICONS.skull, text: `Фидер · ${p.deaths} смертей` });
    if (below('gold_per_min', 0.2)) bad.push({ icon: ICONS.down, text: 'Слабый фарм' });
    if (below('hero_damage_per_min', 0.2)) bad.push({ icon: ICONS.down, text: 'Мало урона' });
    if (kp !== null && teamKills >= 10 && kp < 0.3) bad.push({ icon: ICONS.alert, text: `Мимо драк · ${Math.round(kp * 100)}% участия` });

    if (above('gold_per_min', 0.8)) good.push({ icon: ICONS.up, text: 'Отличный фарм' });
    if (kp !== null && teamKills >= 10 && kp > 0.7) good.push({ icon: ICONS.swords, text: `Во всех драках · ${Math.round(kp * 100)}%` });
    if (p.deaths <= 3 && above('deaths_per_min', 0.85)) good.push({ icon: ICONS.shield, text: 'Почти не умирал' });

    return [...bad.map(t => ({ ...t, good: false })), ...good.map(t => ({ ...t, good: true }))].slice(0, 3);
  }

  function worstReasons(p, n = 2) {
    if (p.left) return 'Покинул игру — команда доигрывала вчетвером.';
    const heroName = hero(p.hero_id).name;
    const worst = Object.entries(p.pcts).filter(e => e[1] !== null).sort((a, b) => a[1] - b[1]).slice(0, n);
    return worst.map(([k, v]) => `${METRIC_LABELS[k]} хуже, чем у ${Math.round((1 - v) * 100)}% игроков на ${heroName}`).join('; ') + '.';
  }

  function bestReasons(p, n = 2) {
    const heroName = hero(p.hero_id).name;
    const best = Object.entries(p.pcts).filter(e => e[1] !== null).sort((a, b) => b[1] - a[1]).slice(0, n);
    return best.map(([k, v]) => `${METRIC_LABELS[k]} лучше, чем у ${Math.round(v * 100)}% игроков на ${heroName}`).join('; ') + '.';
  }

  // ---------- rendering ----------

  function setBusy(busy) {
    results.setAttribute('aria-busy', String(busy));
    for (const b of document.querySelectorAll('.search-form button[type="submit"]')) b.disabled = busy;
  }

  function renderLoading(text) {
    results.innerHTML = `
      <div class="status-card"><div class="spinner" aria-hidden="true"></div>
        <div><h2>${esc(text)}</h2><p>Тянем данные из OpenDota…</p></div></div>
      <div class="skeleton-row"></div><div class="skeleton-row"></div><div class="skeleton-row"></div>`;
  }

  function renderError(title, text) {
    results.innerHTML = `
      <div class="status-card error">${ICONS.alert}
        <div><h2>${esc(title)}</h2><p>${text}</p></div></div>`;
  }

  function errorText(err, kind, id) {
    switch (err.message) {
      case 'notfound':
        return kind === 'match'
          ? ['Матч не найден', `Проверьте ID. Если игра закончилась только что, OpenDota может ещё её не знать — подождите пару минут. <a href="https://www.opendota.com/matches/${esc(id)}" target="_blank" rel="noopener">Открыть на OpenDota</a>`]
          : ['Игрок не найден', 'Проверьте Steam ID. Профиль может быть скрыт — откройте «Общедоступную историю матчей» в настройках Dota 2.'];
      case 'ratelimit':
        return ['Слишком много запросов', 'OpenDota просит подождать минуту. Попробуйте ещё раз чуть позже.'];
      case 'network':
        return ['Нет связи с OpenDota', 'Проверьте интернет или попробуйте позже — сервис мог временно прилечь.'];
      default:
        return ['OpenDota ответил ошибкой', 'Попробуйте ещё раз через минуту.'];
    }
  }

  function renderMatch(match) {
    const scored = scorePlayers(match);
    const radiant = scored.filter(isRadiant);
    const dire = scored.filter(p => !isRadiant(p));
    const ruiner = scored.reduce((a, b) => (b.score > a.score ? b : a));
    const mvp = scored.reduce((a, b) => (b.score < a.score ? b : a));
    const hasRuiner = ruiner.score >= 55;
    const mode = GAME_MODES[match.game_mode] || 'Матч';
    const ranked = match.lobby_type === 7 ? ' · Рейтинговый' : '';
    const benchMissing = scored.every(p => !p.usedBench);
    // В старых матчах счёта нет — берём сумму убийств команды.
    const kills = rad => scored.filter(p => isRadiant(p) === rad).reduce((s, p) => s + p.kills, 0);
    const radScore = match.radiant_score || kills(true);
    const direScore = match.dire_score || kills(false);

    const sideName = (rad) => {
      const n = rad ? match.radiant_name : match.dire_name;
      return n ? esc(n) : (rad ? 'Силы Света' : 'Силы Тьмы');
    };
    const winBadge = `<span class="win-badge">${ICONS.crown}Победа</span>`;

    const ruinerCard = hasRuiner
      ? verdictCard(ruiner, 'ruin', 'Главный руинер', worstReasons(ruiner))
      : `<div class="verdict-card mvp" style="--c: var(--lvl-ok)">
           <div><div class="verdict-label">Руинера нет</div>
           <div class="verdict-name">Все в пределах нормы</div>
           <p class="verdict-why">Ни у кого руин-метр не дотянул до 55. Проиграли честно.</p></div></div>`;

    results.innerHTML = `
      <div class="match-head">
        <div class="side radiant">
          <span class="side-name">${sideName(true)}</span>
          ${match.radiant_win ? winBadge : ''}
        </div>
        <div class="score">
          <div class="score-num" aria-label="Счёт ${radScore} : ${direScore}">${radScore}<span class="sep">:</span>${direScore}</div>
          <div class="meta">${esc(mode)}${ranked} · ${fmtDuration(match.duration)} · ${timeAgo(match.start_time)}<br>
            Матч <a href="https://www.opendota.com/matches/${match.match_id}" target="_blank" rel="noopener">${match.match_id}</a></div>
        </div>
        <div class="side dire">
          <span class="side-name">${sideName(false)}</span>
          ${!match.radiant_win ? winBadge : ''}
        </div>
      </div>

      ${match.duration < 600 ? `<p class="notice">Матч длился меньше 10 минут — статистика почти ничего не говорит, оценки ненадёжны.</p>` : ''}
      ${benchMissing ? `<p class="notice">OpenDota не дал сравнение с другими игроками на этих героях, поэтому игроки сравниваются только между собой в этом матче.</p>` : ''}

      <div class="verdict">
        ${ruinerCard}
        ${verdictCard(mvp, 'mvp', 'MVP катки', bestReasons(mvp))}
      </div>

      <div class="share-row">
        <button type="button" class="btn btn-ghost" id="copy-link">${ICONS.link}Скопировать ссылку</button>
      </div>

      <div class="teams">
        ${teamBlock('radiant', sideName(true), match.radiant_win, radiant, hasRuiner ? ruiner : null)}
        ${teamBlock('dire', sideName(false), !match.radiant_win, dire, hasRuiner ? ruiner : null)}
      </div>`;

    $('#copy-link').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      try {
        await navigator.clipboard.writeText(location.href);
        btn.lastChild.textContent = 'Ссылка скопирована';
      } catch {
        btn.lastChild.textContent = 'Скопируйте адрес из строки браузера';
      }
      setTimeout(() => { btn.lastChild.textContent = 'Скопировать ссылку'; }, 2500);
    });
  }

  function playerName(p) {
    if (p.name) return p.name;
    if (p.personaname) return p.personaname;
    return 'Аноним';
  }

  function verdictCard(p, cls, label, why) {
    const h = hero(p.hero_id);
    return `
      <div class="verdict-card ${cls}">
        <img src="${esc(h.img)}" alt="" width="96" height="54" loading="lazy">
        <div>
          <div class="verdict-label">${esc(label)}</div>
          <div class="verdict-name">${esc(playerName(p))}</div>
          <p class="verdict-why">${esc(h.name)} · ${p.kills}/${p.deaths}/${p.assists}. ${esc(why)}</p>
        </div>
        <div class="verdict-score" aria-label="Руин-метр ${p.score}">${p.score}</div>
      </div>`;
  }

  function teamBlock(side, name, won, players, ruiner) {
    return `
      <section class="team ${side}" aria-label="${name}">
        <h2>${name} <span class="result">${won ? 'Победа' : 'Поражение'}</span></h2>
        <ul class="player-list">${players.map(p => playerItem(p, ruiner)).join('')}</ul>
      </section>`;
  }

  function playerItem(p, ruiner) {
    const h = hero(p.hero_id);
    const lvl = level(p.score);
    const isRuiner = ruiner && ruiner.player_slot === p.player_slot;
    const tags = p.tags.map(t => `<span class="tag${t.good ? ' good' : ''}">${t.icon}${esc(t.text)}</span>`).join('');
    const bench = Object.keys(WEIGHTS).map(k => {
      const v = p.pcts[k];
      if (v === null) return `<div><dt>${METRIC_LABELS[k]}</dt><dd>нет данных</dd></div>`;
      const c =v >= 0.66 ? 'var(--lvl-carry)' : v >= 0.33 ? 'var(--lvl-sus)' : 'var(--lvl-ruin)';
      return `<div><dt>${METRIC_LABELS[k]} <small>(вес ${Math.round(WEIGHTS[k] * 100)}%)</small></dt><dd>${pctText(v)}</dd>
        <div class="bar" aria-hidden="true"><span style="--w:${Math.round(v * 100)}%; --c:${c}"></span></div></div>`;
    }).join('');
    const profile = p.account_id
      ? `<a href="https://www.opendota.com/players/${p.account_id}" target="_blank" rel="noopener">Профиль на OpenDota</a> · <button type="button" class="link-btn" data-player="${p.account_id}">Последние игры</button>`
      : 'Профиль скрыт';

    return `
      <li class="player${isRuiner ? ' is-ruiner' : ''}">
        <details>
          <summary class="player-row">
            <img class="hero-img" src="${esc(h.img)}" alt="" width="72" height="40" loading="lazy">
            <div class="who">
              <div class="who-name">${esc(playerName(p))}</div>
              <div class="who-hero">${esc(h.name)} · ур. ${p.level}</div>
            </div>
            <div class="stat kda"><span class="stat-label">K/D/A</span><span class="stat-value">${p.kills}/${p.deaths}/${p.assists}</span></div>
            <div class="stat"><span class="stat-label">GPM</span><span class="stat-value">${p.gold_per_min}</span></div>
            <div class="stat"><span class="stat-label">Урон</span><span class="stat-value">${fmtNum(p.hero_damage)}</span></div>
            <div class="meter ${lvl.cls}">
              <div class="meter-top"><span class="meter-label">${lvl.label}</span><span class="meter-num">${p.score}</span></div>
              <div class="meter-bar" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p.score}" aria-label="Руин-метр"><div class="meter-fill" style="--w:${p.score}%"></div></div>
            </div>
            ${ICONS.chev}
          </summary>
          <div class="breakdown">
            <p class="breakdown-note">${p.usedBench ? `Лучше, чем у такой доли игроков на ${esc(h.name)}:` : 'Место среди 10 игроков этого матча:'}</p>
            <dl class="bench">${bench}</dl>
            <p class="breakdown-links">${profile}</p>
          </div>
        </details>
        <div class="tags">${tags}</div>
      </li>`;
  }

  function renderRecent(accountId, profile, matches) {
    const name = profile && profile.profile ? profile.profile.personaname : null;
    if (!matches.length) {
      renderError('Игр не найдено', 'У этого игрока нет публичных матчей. Включите «Общедоступную историю матчей» в настройках Dota 2.');
      return;
    }
    results.innerHTML = `
      <section class="recent">
        <h2>${name ? `Последние игры ${esc(name)}` : 'Последние игры'}</h2>
        <ul class="recent-list">
          ${matches.map(m => {
            const h = hero(m.hero_id);
            const won = (m.player_slot < 128) === m.radiant_win;
            return `<li class="recent-item"><button type="button" data-match="${m.match_id}">
              <img src="${esc(h.img)}" alt="" width="64" height="36" loading="lazy">
              <span><span class="recent-hero">${esc(h.name)}</span><br>
                <span class="recent-sub">${timeAgo(m.start_time)} · ${fmtDuration(m.duration)}</span></span>
              <span class="recent-kda">${m.kills}/${m.deaths}/${m.assists}</span>
              <span class="${won ? 'res-win' : 'res-loss'}">${won ? 'Победа' : 'Поражение'}</span>
            </button></li>`;
          }).join('')}
        </ul>
      </section>`;
  }

  // ---------- flows ----------

  async function loadMatch(id, { push = true } = {}) {
    const req = ++currentRequest;
    if (push) history.pushState({ match: id }, '', `?match=${id}`);
    document.title = `Матч ${id} — Ruiner Finder`;
    setBusy(true);
    renderLoading('Ищем руинера');
    results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    try {
      const [match] = await Promise.all([getJSON(`${API}/matches/${id}`), loadHeroes()]);
      if (req !== currentRequest) return;
      if (!match.players || match.players.length !== 10) throw new Error('notfound');
      renderMatch(match);
    } catch (err) {
      if (req !== currentRequest) return;
      renderError(...errorText(err, 'match', id));
    } finally {
      if (req === currentRequest) setBusy(false);
    }
  }

  async function loadPlayer(accountId, { push = true } = {}) {
    const req = ++currentRequest;
    if (push) history.pushState({ player: accountId }, '', `?player=${accountId}`);
    document.title = 'Последние игры — Ruiner Finder';
    setBusy(true);
    renderLoading('Загружаем последние игры');
    results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    try {
      const [profile, matches] = await Promise.all([
        getJSON(`${API}/players/${accountId}`).catch(() => null),
        getJSON(`${API}/players/${accountId}/recentMatches`),
        loadHeroes(),
      ]);
      if (req !== currentRequest) return;
      renderRecent(accountId, profile, matches.slice(0, 20));
    } catch (err) {
      if (req !== currentRequest) return;
      renderError(...errorText(err, 'player', accountId));
    } finally {
      if (req === currentRequest) setBusy(false);
    }
  }

  function showFieldError(input, el, msg) {
    if (msg) {
      el.textContent = msg;
      el.hidden = false;
      input.setAttribute('aria-invalid', 'true');
      input.focus();
    } else {
      el.hidden = true;
      input.removeAttribute('aria-invalid');
    }
  }

  // ---------- tabs ----------

  const tabs = [$('#tab-match'), $('#tab-player')];
  function selectTab(tab, focus = true) {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    }
    if (focus) tab.focus();
  }
  for (const t of tabs) {
    t.addEventListener('click', () => selectTab(t));
    t.addEventListener('keydown', e => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      selectTab(tabs[(tabs.indexOf(t) + 1) % tabs.length]);
    });
  }

  // ---------- events ----------

  matchForm.addEventListener('submit', e => {
    e.preventDefault();
    const id = parseMatchId(matchInput.value);
    const err = $('#match-error');
    if (!id) {
      showFieldError(matchInput, err, matchInput.value.trim() ? 'Не нашли ID матча. Нужно число вроде 9049094334 или ссылка на матч.' : 'Вставьте ID матча или ссылку.');
      return;
    }
    showFieldError(matchInput, err, null);
    loadMatch(id);
  });

  playerForm.addEventListener('submit', e => {
    e.preventDefault();
    const r = parseAccountId(playerInput.value);
    const err = $('#player-error');
    if (r.error) { showFieldError(playerInput, err, r.error); return; }
    showFieldError(playerInput, err, null);
    loadPlayer(r.id);
  });

  matchInput.addEventListener('input', () => showFieldError(matchInput, $('#match-error'), null));
  playerInput.addEventListener('input', () => showFieldError(playerInput, $('#player-error'), null));

  $('#example-btn').addEventListener('click', () => {
    matchInput.value = EXAMPLE_MATCH;
    showFieldError(matchInput, $('#match-error'), null);
    loadMatch(EXAMPLE_MATCH);
  });

  results.addEventListener('click', e => {
    const m = e.target.closest('[data-match]');
    if (m) {
      matchInput.value = m.dataset.match;
      selectTab(tabs[0], false);
      loadMatch(m.dataset.match);
      return;
    }
    const p = e.target.closest('[data-player]');
    if (p) {
      playerInput.value = p.dataset.player;
      selectTab(tabs[1], false);
      loadPlayer(p.dataset.player);
    }
  });

  function routeFromUrl() {
    const q = new URLSearchParams(location.search);
    const match = q.get('match');
    const player = q.get('player');
    if (match && /^\d+$/.test(match)) {
      matchInput.value = match;
      selectTab(tabs[0], false);
      loadMatch(match, { push: false });
    } else if (player && /^\d+$/.test(player)) {
      playerInput.value = player;
      selectTab(tabs[1], false);
      loadPlayer(player, { push: false });
    } else {
      currentRequest++;
      results.innerHTML = '';
      document.title = 'Ruiner Finder — найди руинера в катке Dota 2';
    }
  }

  window.addEventListener('popstate', routeFromUrl);
  routeFromUrl();
  loadHeroes().catch(() => { /* загрузим при запросе */ });
})();
