(function () {
  const DATA = window.WENZI_CHARS || { chars: {}, homophones: {}, textbook: [] };
  const SYN = window.WENZI_SYNONYMS || { groups: [], glosses: {} };
  const CARDS = window.WENZI_CARDS || {};
  const STORE_KEY = "ruogu-wenzi-v1";
  const textbook = new Set(DATA.textbook);

  const els = {
    mic: document.getElementById("micButton"),
    micLabel: document.getElementById("micLabel"),
    form: document.getElementById("askForm"),
    input: document.getElementById("askInput"),
    tip: document.getElementById("askTip"),
    result: document.getElementById("result"),
    welcome: document.getElementById("welcome"),
    recentRow: document.getElementById("recentRow"),
    historyButton: document.getElementById("historyButton"),
    sheet: document.getElementById("sheet"),
    sheetBody: document.getElementById("sheetBody")
  };

  // 词 → 所在近义词组（写作组在前）
  const synIndex = new Map();
  SYN.groups.forEach((group) => {
    group.words.forEach((word) => {
      if (!synIndex.has(word)) synIndex.set(word, []);
      synIndex.get(word).push(group);
    });
  });

  let writer = null;
  let current = null;

  // ---------- 小工具 ----------
  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
  }

  function plainPinyin(py) {
    return py.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ü/g, "v");
  }

  function readingsOf(ch) {
    const info = DATA.chars[ch];
    return info ? info.py : [];
  }

  function sameSound(a, b) {
    const pa = readingsOf(a).map(plainPinyin);
    return readingsOf(b).map(plainPinyin).some((p) => pa.includes(p));
  }

  function markChar(word, ch) {
    return escapeHtml(word).split(escapeHtml(ch)).join(`<mark>${escapeHtml(ch)}</mark>`);
  }

  function speak(text) {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-CN";
    utterance.rate = .8;
    window.speechSynthesis.speak(utterance);
  }

  // ---------- 记录 ----------
  function loadStore() {
    try {
      const data = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      if (data && Array.isArray(data.history)) return { wish: {}, ...data };
    } catch (_) {}
    return { history: [], wish: {} };
  }

  function saveStore(store) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (_) {}
  }

  function remember(ch, ctx) {
    const store = loadStore();
    store.history.push({ ch, ctx: ctx || "", at: new Date().toISOString() });
    if (store.history.length > 2000) store.history = store.history.slice(-2000);
    saveStore(store);
    renderRecent();
  }

  // ---------- 解析一句话 ----------
  function parseQuery(raw) {
    let text = String(raw || "").replace(/[\s，。！？、,.!?“”"'「」《》：:；;]/g, "");
    if (!text) return null;
    if (/^[a-zü]+$/i.test(text)) {
      const key = text.toLowerCase().replace(/ü/g, "v");
      const choices = DATA.homophones[key] || DATA.homophones[key.replace(/v/g, "u")] || [];
      return { mode: "choose", choices: choices.slice(0, 24), ctx: "", heading: `读 ${key} 的字` };
    }
    text = text.replace(/^(我要找|我想找|找一下|找|查一下|查)/, "").replace(/字$/, "");
    const match = text.match(/^(.+?)(?:里面|里|中)?的(?:那个)?(.)$/);
    if (match) {
      const ctx = match[1];
      let target = match[2];
      let heard = "";
      if (!ctx.includes(target)) {
        // 语音常把「鲜艳的艳」听成「鲜艳的燕」：语境词里有同音字，就用语境词里的那个
        const fix = [...ctx].find((c) => sameSound(c, target));
        if (fix) { heard = target; target = fix; }
      }
      return { mode: "char", ch: target, ctx, heard };
    }
    if (text.length === 1) return { mode: "char", ch: text, ctx: "" };
    const choices = [...new Set([...text])].filter((c) => /\p{Script=Han}/u.test(c));
    if (choices.length === 1) return { mode: "char", ch: choices[0], ctx: text };
    return { mode: "choose", choices, ctx: text, heading: `你要找「${text}」里的哪个字？` };
  }

  function ask(raw) {
    const query = parseQuery(raw);
    if (!query) return;
    if (query.mode === "choose") return renderChoose(query);
    showChar(query.ch, query.ctx, query.heard);
  }

  // ---------- 渲染 ----------
  function renderChoose(query) {
    els.welcome.hidden = true;
    if (!query.choices.length) {
      els.result.innerHTML = `<section class="card"><p class="empty">没找到这个读音的字，换个说法试试？</p></section>`;
      return;
    }
    els.result.innerHTML = `
      <section class="card">
        <h2 class="section-title">${escapeHtml(query.heading)}</h2>
        <div class="choose-row">${query.choices.map((c) => {
          const word = query.ctx || (DATA.chars[c] && DATA.chars[c].w[0]) || "";
          return `<button class="pick" type="button" data-ch="${escapeHtml(c)}">${escapeHtml(c)}<small>${escapeHtml(word)}</small></button>`;
        }).join("")}</div>
      </section>`;
    els.result.querySelectorAll(".pick").forEach((button) => {
      button.addEventListener("click", () => showChar(button.dataset.ch, query.ctx));
    });
  }

  function wordsFor(ch) {
    const info = DATA.chars[ch];
    const words = info ? [...info.w] : [];
    const card = CARDS[ch];
    if (card && card.character_relations) {
      (card.character_relations.word_family || []).forEach((item) => {
        if (!words.includes(item.word)) words.push(item.word);
      });
    }
    return words;
  }

  function showChar(ch, ctx, heard) {
    els.welcome.hidden = true;
    const info = DATA.chars[ch];
    const card = CARDS[ch];
    const words = wordsFor(ch);
    const contextWord = ctx && ctx.includes(ch) && ctx.length >= 2 ? ctx : "";
    if (contextWord && !words.includes(contextWord)) words.unshift(contextWord);
    const firstWithSyn = words.find((w) => synIndex.has(w));
    const activeWord = contextWord || firstWithSyn || words[0] || "";
    current = { ch, ctx: contextWord, activeWord };

    const reading = info ? info.py[0] : "";
    const confusable = card && card.character_relations && card.character_relations.confusable_chars || [];
    const store = loadStore();
    const wished = Boolean(store.wish[ch]);
    const sound = info ? plainPinyin(info.py[0]) : "";
    // 只列主读音相同的字（「核」「喝」的冷僻读音也是 kai，不算）
    const homophones = (DATA.homophones[sound] || [])
      .filter((c) => c !== ch && plainPinyin(DATA.chars[c].py[0]) === sound)
      .slice(0, 8);

    els.result.innerHTML = `
      <section class="card hero">
        <div class="grid-box" id="gridBox"></div>
        <div class="hero-info">
          <div class="py">${reading ? `<span>${escapeHtml(reading)}</span>` : ""}</div>
          ${contextWord ? `<p class="said"><span class="label">你说的</span>${markChar(contextWord, ch)}</p>` : ""}
          ${heard ? `<p class="note">我听到的是「${escapeHtml(heard)}」，你要的应该是「${escapeHtml(contextWord)}」里的 <b>${escapeHtml(ch)}</b>。</p>` : ""}
          ${!info ? `<p class="note">这个字不太常用，字典里还没收它的词。</p>` : ""}
          <div class="hero-actions">
            <button class="btn solid" type="button" data-act="animate">▶ 看怎么写</button>
            <button class="btn" type="button" data-act="quiz">✍️ 跟着描</button>
            <button class="btn" type="button" data-act="speak">🔊 读一读</button>
            ${card
              ? `<button class="btn stamp" type="button" data-act="card">字源</button>`
              : `<button class="btn quiet" type="button" data-act="wish">${wished ? "已记下，等妈妈做字源卡" : `想听「${escapeHtml(ch)}」的故事`}</button>`}
          </div>
          ${confusable.length ? `<div class="confuse">${confusable.map((item) => `别写成 <b>${escapeHtml(item.char)}</b>：${escapeHtml(item.difference)}`).join("<br>")}</div>` : ""}
          ${homophones.length ? `<p class="note">不是这个字？同音的还有：</p><div class="chip-row" style="margin-top:6px">${homophones.map((c) => `<button class="word-chip" type="button" data-ch="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join("")}</div>` : ""}
        </div>
      </section>

      <section class="card">
        <h2 class="section-title">组词 <small>📖 是课本里学过的 · 点一个词看它的近义词</small></h2>
        <div class="chip-row" id="wordRow">${words.length
          ? words.map((w) => `<button class="word-chip${textbook.has(w) ? " is-book" : ""}${w === activeWord ? " is-active" : ""}" type="button" data-word="${escapeHtml(w)}">${markChar(w, ch)}</button>`).join("")
          : `<p class="empty">这个字还没有收常用词。</p>`}</div>
      </section>

      <section class="card" id="synCard"></section>`;

    els.result.querySelectorAll("[data-act]").forEach((button) => button.addEventListener("click", () => heroAction(button.dataset.act, button)));
    els.result.querySelectorAll(".hero [data-ch]").forEach((button) => button.addEventListener("click", () => showChar(button.dataset.ch, ctx)));
    els.result.querySelectorAll("#wordRow [data-word]").forEach((button) => {
      button.addEventListener("click", () => {
        speak(button.dataset.word);
        selectWord(button.dataset.word);
      });
    });

    renderSynonyms(activeWord);
    drawChar(ch);
    remember(ch, contextWord);
    els.result.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function selectWord(word) {
    current.activeWord = word;
    els.result.querySelectorAll("#wordRow [data-word]").forEach((button) => button.classList.toggle("is-active", button.dataset.word === word));
    renderSynonyms(word);
  }

  function renderSynonyms(word) {
    const box = document.getElementById("synCard");
    if (!box) return;
    const groups = word ? synIndex.get(word) || [] : [];
    if (!groups.length) {
      const others = wordsFor(current.ch).filter((w) => w !== word && synIndex.has(w)).slice(0, 6);
      box.innerHTML = `
        <h2 class="section-title">近义词</h2>
        <p class="empty">${word ? `「${escapeHtml(word)}」还没有收录近义词。` : "先选一个词。"}${others.length ? "可以看看这几个词：" : ""}</p>
        ${others.length ? `<div class="chip-row">${others.map((w) => `<button class="word-chip" type="button" data-word="${escapeHtml(w)}">${escapeHtml(w)}</button>`).join("")}</div>` : ""}`;
      box.querySelectorAll("[data-word]").forEach((button) => button.addEventListener("click", () => selectWord(button.dataset.word)));
      return;
    }
    // 不同主题里常有几乎一样的组：大半词已经出现过的组就跳过
    const shown = new Set([word]);
    const picked = [];
    groups.forEach((group) => {
      if (picked.length >= 3) return;
      const fresh = group.words.filter((w) => !shown.has(w));
      if (fresh.length < Math.max(1, Math.ceil(group.words.length * .4))) return;
      group.words.forEach((w) => shown.add(w));
      picked.push(group);
    });
    box.innerHTML = `
      <h2 class="section-title">近义词 <small>写作文时，除了「${escapeHtml(word)}」还可以用</small></h2>
      ${picked.map((group) => {
        const glossed = group.words.some((w) => SYN.glosses[w]);
        const head = group.topic ? `写「${escapeHtml(group.topic)}」的词` : "意思差不多的词";
        const items = group.words.map((w) => glossed
          ? `<button class="syn-item${w === word ? " is-self" : ""}" type="button" data-say="${escapeHtml(w)}"><strong>${escapeHtml(w)}</strong>${SYN.glosses[w] ? `<small>${escapeHtml(SYN.glosses[w])}</small>` : ""}</button>`
          : `<button class="word-chip${w === word ? " is-active" : ""}" type="button" data-say="${escapeHtml(w)}">${escapeHtml(w)}</button>`).join("");
        return `<div class="syn-group"><p class="syn-head">${head}</p><div class="${glossed ? "syn-list" : "syn-plain"}">${items}</div></div>`;
      }).join("")}`;
    box.querySelectorAll("[data-say]").forEach((button) => button.addEventListener("click", () => speak(button.dataset.say)));
  }

  function drawChar(ch) {
    const box = document.getElementById("gridBox");
    if (!box) return;
    writer = null;
    if (!window.HanziWriter) {
      box.innerHTML = `<div class="fallback-char">${escapeHtml(ch)}</div>`;
      return;
    }
    const size = box.clientWidth;
    writer = window.HanziWriter.create(box, ch, {
      width: size,
      height: size,
      padding: 14,
      strokeColor: "#3a3226",
      radicalColor: "#c0392b",
      outlineColor: "#eadfca",
      drawingColor: "#c0392b",
      highlightColor: "#e8b4a8",
      strokeAnimationSpeed: 1,
      delayBetweenStrokes: 260,
      charDataLoader: (c, onLoad, onError) => {
        fetch(`./strokes/${encodeURIComponent(c)}.json`)
          .then((res) => (res.ok ? res.json() : Promise.reject(new Error("no stroke data"))))
          .then(onLoad)
          .catch(onError);
      },
      onLoadCharDataError: () => {
        writer = null;
        box.innerHTML = `<div class="fallback-char">${escapeHtml(ch)}</div>`;
      }
    });
    writer.animateCharacter();
  }

  function heroAction(act, button) {
    const { ch, ctx } = current;
    if (act === "animate" && writer) { writer.cancelQuiz(); writer.showCharacter(); writer.animateCharacter(); }
    if (act === "quiz" && writer) {
      writer.showOutline();
      writer.hideCharacter();
      writer.quiz({
        onComplete: () => { speak("写对啦"); window.setTimeout(() => writer && writer.animateCharacter(), 600); }
      });
    }
    if (act === "speak") speak(ctx ? `${ctx}的${ch}` : ch);
    if (act === "card") openCard(ch);
    if (act === "wish") {
      const store = loadStore();
      store.wish[ch] = (store.wish[ch] || 0) + 1;
      saveStore(store);
      button.textContent = "已记下，等妈妈做字源卡";
    }
  }

  // ---------- 字源卡 ----------
  function openCard(ch) {
    const c = CARDS[ch];
    if (!c) return;
    const rel = c.character_relations || {};
    const chips = (items, fn) => (items || []).map((item) => `<span class="mini-chip">${fn(item)}</span>`).join("");
    const reading = c.reading_context || {};
    const ladder = [
      ["字", c.char],
      ["词", (reading.words || []).join(" · ")],
      ...(reading.sentences || []).map((s) => ["句", s])
    ];
    els.sheetBody.innerHTML = `
      <div class="zy-hero">
        <div class="big">${escapeHtml(c.char)}</div>
        <div class="py">${escapeHtml(c.pinyin || "")}</div>
        <div class="tags">
          ${c.character_type ? `<span class="tag">${escapeHtml(c.character_type)}字</span>` : ""}
          ${c.stroke_count ? `<span class="tag">${c.stroke_count} 画</span>` : ""}
          ${c.radical ? `<span class="tag">部首：${escapeHtml(c.radical)}</span>` : ""}
          ${c.structure ? `<span class="tag">${escapeHtml(c.structure)}结构</span>` : ""}
        </div>
      </div>
      <section class="zy-card"><h3>字源故事</h3><p>${escapeHtml(c.child_story || c.core_origin || "")}</p></section>
      ${(c.glyph_stages || []).length ? `<section class="zy-card"><h3>字形演变</h3>${c.glyph_stages.map((s) => `<div class="stage"><b>${escapeHtml(s.stage)}</b><span>${escapeHtml(s.description)}</span></div>`).join("")}</section>` : ""}
      ${(c.meaning_journey || []).length ? `<section class="zy-card"><h3>意思的旅行</h3>${c.meaning_journey.map((j) => `<p class="chain-label">${escapeHtml(j.label)}</p><div class="nodes">${j.nodes.map((n) => `<span class="node">${escapeHtml(n)}</span>`).join('<span class="arrow">→</span>')}</div>`).join("")}</section>` : ""}
      <section class="zy-card"><h3>「${escapeHtml(c.char)}」的一家人</h3>
        ${(rel.word_family || []).length ? `<div class="fam"><h4>常用词</h4>${chips(rel.word_family, (i) => `<b>${escapeHtml(i.word)}</b> ${escapeHtml(i.gloss)}`)}</div>` : ""}
        ${rel.radical_family ? `<div class="fam"><h4>偏旁家族</h4><div class="hint">${escapeHtml(rel.radical_family.meaning_hint || "")}</div>${chips(rel.radical_family.examples, (i) => escapeHtml(i))}</div>` : ""}
        ${rel.phonetic_family ? `<div class="fam"><h4>读音家族</h4><div class="hint">${escapeHtml(rel.phonetic_family.sound_hint || "")}</div>${chips(rel.phonetic_family.examples, (i) => escapeHtml(i))}</div>` : ""}
        ${(rel.confusable_chars || []).length ? `<div class="fam"><h4>别认错啦</h4>${chips(rel.confusable_chars, (i) => `<b>${escapeHtml(i.char)}</b>：${escapeHtml(i.difference)}`)}</div>` : ""}
      </section>
      <section class="zy-card"><h3>读一读</h3>${ladder.filter(([, t]) => t).map(([lv, t]) => `<div class="ladder"><span class="lv">${lv}</span><span>${escapeHtml(t)}</span><button type="button" data-say="${escapeHtml(t)}">听</button></div>`).join("")}</section>`;
    els.sheetBody.querySelectorAll("[data-say]").forEach((b) => b.addEventListener("click", () => speak(b.dataset.say)));
    openSheet();
  }

  // ---------- 我问过的字 ----------
  function aggregate() {
    const store = loadStore();
    const map = new Map();
    store.history.forEach((item) => {
      const entry = map.get(item.ch) || { ch: item.ch, count: 0, ctx: new Set(), last: item.at };
      entry.count += 1;
      if (item.ctx) entry.ctx.add(item.ctx);
      entry.last = item.at;
      map.set(item.ch, entry);
    });
    return { store, list: [...map.values()] };
  }

  function renderRecent() {
    const { list } = aggregate();
    const recent = [...list].sort((a, b) => (a.last < b.last ? 1 : -1)).slice(0, 14);
    els.recentRow.innerHTML = recent.length
      ? recent.map((e) => `<button class="word-chip" type="button" data-ch="${escapeHtml(e.ch)}" data-ctx="${escapeHtml([...e.ctx].pop() || "")}">${e.ctx.size ? markChar([...e.ctx].pop(), e.ch) : escapeHtml(e.ch)}</button>`).join("")
      : `<p class="empty">还没有问过字。按上面的红色按钮，说「鲜艳的艳」试试。</p>`;
    els.recentRow.querySelectorAll("[data-ch]").forEach((b) => b.addEventListener("click", () => showChar(b.dataset.ch, b.dataset.ctx)));
  }

  function openHistory() {
    const { store, list } = aggregate();
    const sorted = [...list].sort((a, b) => b.count - a.count || (a.last < b.last ? 1 : -1));
    const wishList = Object.keys(store.wish).filter((ch) => !CARDS[ch]);
    els.sheetBody.innerHTML = `
      <h2 class="section-title">我问过的字 <small>问得越多的排越前，常问的字值得多练几遍</small></h2>
      ${sorted.length ? sorted.map((e) => `
        <div class="history-row">
          <button class="h-char" type="button" data-ch="${escapeHtml(e.ch)}">${escapeHtml(e.ch)}</button>
          <div class="h-meta"><b>问了 ${e.count} 次</b>${store.wish[e.ch] && !CARDS[e.ch] ? ' <span class="wish-badge">想听故事</span>' : ""}<br>${[...e.ctx].map(escapeHtml).join("、") || "直接查的字"}</div>
        </div>`).join("") : '<p class="empty">还没有记录。</p>'}
      <div class="hero-actions">
        <button class="btn" type="button" id="copyHistory">复制给妈妈（问过的字）</button>
        ${wishList.length ? `<button class="btn stamp" type="button" id="copyWish">复制「想听故事」${wishList.length} 个字</button>` : ""}
      </div>
      <p class="note" id="copyNote"></p>`;
    els.sheetBody.querySelectorAll("[data-ch]").forEach((b) => b.addEventListener("click", () => { closeSheet(); showChar(b.dataset.ch, ""); }));
    const copy = (text) => {
      const note = document.getElementById("copyNote");
      const done = () => { note.textContent = "已复制，可以粘贴到微信发给妈妈。"; };
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(done).catch(() => { note.textContent = text; });
      else note.textContent = text;
    };
    document.getElementById("copyHistory").addEventListener("click", () => {
      copy("若谷问过的字：\n" + sorted.map((e) => `${e.ch}（${[...e.ctx].join("、") || "单字"}）×${e.count}`).join("\n"));
    });
    const wishButton = document.getElementById("copyWish");
    if (wishButton) wishButton.addEventListener("click", () => copy("若谷想听字源故事的字：" + wishList.join("、")));
    openSheet();
  }

  function openSheet() { els.sheet.hidden = false; document.body.style.overflow = "hidden"; }
  function closeSheet() { els.sheet.hidden = true; document.body.style.overflow = ""; }

  // ---------- 语音 ----------
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognizer = null;
  let listening = false;

  function setTip(text, hot) {
    els.tip.textContent = text;
    els.tip.classList.toggle("is-hot", Boolean(hot));
  }

  function startListening() {
    if (!Recognition) {
      els.input.focus();
      setTip("这里不能直接听。请点键盘上的 🎤 说话，说完点「查」。", true);
      return;
    }
    if (listening) { recognizer.stop(); return; }
    recognizer = new Recognition();
    recognizer.lang = "zh-CN";
    recognizer.interimResults = true;
    recognizer.continuous = false;
    recognizer.onstart = () => {
      listening = true;
      els.mic.classList.add("is-listening");
      els.micLabel.textContent = "我在听…";
      setTip("说吧，比如「鲜艳的艳」。", true);
    };
    recognizer.onresult = (event) => {
      const text = [...event.results].map((r) => r[0].transcript).join("");
      els.input.value = text;
      if (event.results[event.results.length - 1].isFinal) ask(text);
    };
    recognizer.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") setTip("需要允许使用麦克风。也可以点键盘上的 🎤 说话。", true);
      else if (event.error === "no-speech") setTip("没听清，再按一下说一次吧。", true);
      else setTip("没听清，再试一次，或者点键盘上的 🎤 说话。", true);
    };
    recognizer.onend = () => {
      listening = false;
      els.mic.classList.remove("is-listening");
      els.micLabel.textContent = "按一下，说话";
    };
    try { recognizer.start(); } catch (_) { setTip("没启动成功，再按一下试试。", true); }
  }

  // ---------- 事件 ----------
  els.mic.addEventListener("click", startListening);
  els.form.addEventListener("submit", (event) => {
    event.preventDefault();
    ask(els.input.value);
    els.input.blur();
  });
  els.historyButton.addEventListener("click", openHistory);
  els.sheet.addEventListener("click", (event) => { if (event.target.closest("[data-close]")) closeSheet(); });

  // 课本里的字，空闲时把笔顺数据预先拉一遍（Service Worker 会缓存），断网也能看
  function warmStrokes() {
    const FLAG = "ruogu-wenzi-strokes-warm-v1";
    if (location.protocol === "file:" || localStorage.getItem(FLAG) || !navigator.serviceWorker) return;
    const chars = Object.keys(DATA.chars).filter((c) => DATA.chars[c].tb);
    let index = 0;
    const next = () => {
      if (!navigator.onLine) { window.setTimeout(next, 30000); return; }
      const batch = chars.slice(index, index + 12);
      index += batch.length;
      if (!batch.length) { localStorage.setItem(FLAG, "1"); return; }
      Promise.all(batch.map((c) => fetch(`./strokes/${encodeURIComponent(c)}.json`).catch(() => {}))).then(() => window.setTimeout(next, 400));
    };
    navigator.serviceWorker.ready.then(() => window.setTimeout(next, 3000));
  }

  renderRecent();
  warmStrokes();
  window.WENZI_DEBUG = { parseQuery, ask };
})();
