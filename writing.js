(function () {
  "use strict";
  const entries = window.WENZI_WRITING_DATA.entries;
  const usage = new Map(window.WENZI_USAGE.words.map(item => [item.word, item]));
  const pinyin = window.WENZI_WORD_PINYIN || {};
  const lexicon = window.WENZI_LEXICON;
  const BAG_KEY = "ruogu-wenzi-wordbag-v1";
  const HISTORY_KEY = "ruogu-wenzi-words-v1";
  const $ = id => document.getElementById(id);
  const escape = text => String(text).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const headwords = new Map(entries.map(e => [e.word, e]));
  const itemIndex = new Map();
  entries.forEach(e => e.items.forEach(item => { if (!itemIndex.has(item.word)) itemIndex.set(item.word, e); }));
  const dictionary = new Map();
  lexicon.groups.forEach(group => group.words.forEach(word => {
    if (!dictionary.has(word)) dictionary.set(word, []);
    dictionary.get(word).push(group);
  }));
  const dictionaryWords = [...dictionary.keys()];
  const dictionaryPinyin = new Map();
  [...new Set([...dictionaryWords, ...usage.keys()])].forEach(word => {
    const key = plain((pinyin[word] || []).join(""));
    if (!dictionaryPinyin.has(key)) dictionaryPinyin.set(key, []);
    dictionaryPinyin.get(key).push(word);
  });
  const aliases = { 开心: "高兴", 快乐: "高兴", 好看: "漂亮", 伤心: "难过", 快: "快速", 慢: "缓慢", 暖和: "温暖", 冷: "寒冷", 热: "炎热", 累: "疲倦", 蓝色: "蓝", 红色: "红", 绿色: "绿", 白色: "白" };
  let view = "synonyms";
  let activeWord = "可爱";
  let activeTheme = "常用";
  let visibleItems = new Map();
  let dictionaryLetter = "";
  let dictionaryLimit = 24;
  let topicLimit = 18;

  function load(key, fallback) {
    try { const value = JSON.parse(localStorage.getItem(key)); return Array.isArray(value) ? value : fallback; } catch (_) { return fallback; }
  }
  let bag = load(BAG_KEY, []).filter(item => item && typeof item.word === "string" && typeof item.source === "string");
  function save(key, data) {
    try { localStorage.setItem(key, JSON.stringify(data)); return true; } catch (_) { return false; }
  }
  function ruby(text) {
    // 词组拼音优先，避免把「快乐」读成 kuài yuè。标点不注音。
    const syllables = pinyin[text];
    if (!syllables) return `<span>${escape(text)}</span>`;
    return [...text].map((ch, i) => /\p{Script=Han}/u.test(ch)
      ? `<ruby>${escape(ch)}<rp>(</rp><rt>${escape(syllables[i] || "")}</rt><rp>)</rp></ruby>`
      : escape(ch)).join("");
  }
  function speak(text) {
    if (!("speechSynthesis" in window)) { $("askTip").textContent = "这个浏览器暂时不能读出声音，可以看上面的拼音。"; return; }
    const synth = window.speechSynthesis;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-CN";
    utterance.rate = .8;
    const voices = synth.getVoices();
    const voice = voices.find(v => /^zh[-_]CN/i.test(v.lang)) || voices.find(v => /^zh/i.test(v.lang));
    if (voice) utterance.voice = voice;
    synth.speak(utterance);
  }
  function normalize(raw) {
    let text = String(raw || "").trim().replace(/[\s，。！？、,.!?“”"'「」《》：:；;]/g, "").slice(0, 80);
    text = text.replace(/(?:有哪些|有什么|有啥)(?:近义词|同义词)$/, "");
    text = text.replace(/(?:的)?(?:近义词|同义词|近意词|近义字|同意词|相近的词)(?:语)?(?:都)?(?:有哪些|有什么|是什么|有啥|是啥|是什么词|怎么说|是什么呢|呢|吗)?$/, "");
    text = text.replace(/(?:还可以怎么说|还可以换成什么词|可以换成什么词|还能怎么说|换个说法)$/, "").replace(/的$/, "");
    // 「找」「找到」「请教」本身也是词；先保留完整词，再移除提问的礼貌前缀。
    while (text && !usage.has(text) && !dictionary.has(text) && !headwords.has(text)) {
      const stripped = text.replace(/^(?:请问|请|帮我|我想知道|我想查|我要查|查一下|找一下|查查|查|找)/, "");
      if (stripped === text) break;
      text = stripped;
    }
    return text;
  }
  function hasIntent(raw) { return /近义|同义|近意|同意词|相近的词|换个说法|还能怎么说|还可以怎么说|换成什么词/.test(raw); }
  function plain(text) { return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-zv]/g, ""); }
  function resolveWord(raw) {
    const text = normalize(raw);
    if (/^[a-zü\s]+$/i.test(text)) {
      const match = dictionaryPinyin.get(plain(text));
      if (match && match.length) return match[0];
    }
    return text;
  }
  function updateCount() { $("bagCount").textContent = bag.length; }
  function setView(next, updateHash = true) {
    if (!["synonyms", "characters", "wordbag"].includes(next)) next = "synonyms";
    view = next;
    document.body.dataset.view = view;
    $("writingWorkspace").hidden = view !== "synonyms";
    $("charWorkspace").hidden = view !== "characters";
    $("wordbagWorkspace").hidden = view !== "wordbag";
    $("askDesk").hidden = view === "wordbag";
    document.querySelectorAll("[data-view]").forEach(button => {
      if (button.dataset.view === view) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
    });
    const charMode = view === "characters";
    $("askHeading").textContent = charMode ? "哪个字还不太会写？" : "想找哪个词的近义词？";
    $("askInput").placeholder = charMode ? "比如：鲜艳的艳" : "比如：可爱的近义词有哪些";
    $("askTip").textContent = charMode ? "像这样说：「鲜艳的艳」「蓝天的蓝」。也可以直接打一个词。" : "可以直接说「可爱的近义词有哪些」，也可以打字。";
    $("askTip").classList.remove("is-hot");
    if (view === "wordbag") renderBag();
    if (updateHash && location.hash !== `#${view}`) history.replaceState(null, "", `#${view}`);
    window.dispatchEvent(new CustomEvent("wenzi:viewchange"));
  }
  function findEntry(word) {
    return headwords.get(word) || headwords.get(aliases[word]) || (!dictionary.has(word) && itemIndex.get(word));
  }
  function withUsage(item) {
    const detail = usage.get(item.word);
    return {
      ...item,
      pairs: detail ? detail.pairs : item.pairs || (item.pair ? [item.pair] : []),
      example: detail ? detail.example : item.example,
      when: item.when || (detail && detail.meaning) || "",
      contrast: detail ? detail.contrast : item.contrast || ""
    };
  }
  function pairButtons(pairs) {
    return pairs.map(pair => `<button type="button" data-say="${escape(pair)}" aria-label="读搭配：${escape(pair)}">${ruby(pair)}</button>`).join("");
  }
  function usageFocus(word) {
    const detail = usage.get(word);
    if (!detail) return "";
    visibleItems.set(word, { ...withUsage({ word }), source: word });
    const saved = bag.some(item => item.word === word);
    return `<section class="usage-focus" aria-label="${escape(word)}的搭配例句辨析">
      <div class="usage-focus-top"><div><p class="eyebrow">这个词，先这样用</p><p class="usage-meaning">${escape(detail.meaning)}</p></div><button class="save-word${saved ? " is-saved" : ""}" type="button" data-save="${escape(word)}" aria-pressed="${saved}" aria-label="${saved ? "移出词袋：" : "放进词袋："}${escape(word)}">${saved ? "已收藏 ✓" : "收藏 ＋"}</button></div>
      <div class="usage-detail-grid"><div class="usage-pair-block"><h3>常用搭配</h3><div class="usage-pairs">${pairButtons(detail.pairs)}</div></div><div class="usage-example-block"><h3>短例句</h3><p class="usage-example">${ruby(detail.example)}</p><button class="read-example" type="button" data-say="${escape(detail.example)}">听例句 ↗</button></div></div>
      <div class="usage-contrast"><h3>辨一辨</h3><p>${escape(detail.contrast)}</p><button class="read-example" type="button" data-say="${escape(detail.contrast)}">听辨析 ↗</button></div>
    </section>`;
  }
  function familySection(word) {
    const detail = usage.get(word);
    if (!detail) return "";
    const siblings = detail.family.words.filter(w => w !== word && usage.has(w));
    if (!siblings.length) return "";
    // 同一主题可能包含部位、反义词等，不能自动当成近义词。
    return `<details class="usage-family"><summary>同一主题里的词 · ${escape(detail.family.title)}</summary><p class="note">这些词各有自己的意思，看看搭配和例句，学着分清它们。</p><div class="word-slips">${cards(siblings.map(word => ({ word })), word)}</div></details>`;
  }
  function dictionarySection(word, supplemental = false) {
    // 相同词表、相同释义的重复展示合并成一行；不增加任何词际关系。
    const seen = new Set();
    const groups = [...(dictionary.get(word) || [])].sort((a, b) => Number(b.words.length > 1) - Number(a.words.length > 1) || Number(Boolean(b.definition)) - Number(Boolean(a.definition)) || Number(["a", "v"].includes(b.pos)) - Number(["a", "v"].includes(a.pos)) || b.words.length - a.words.length).filter(group => {
      const signature = JSON.stringify([group.definition, [...group.words].sort()]);
      if (seen.has(signature)) return false;
      seen.add(signature); return true;
    });
    if (!groups.length) return "";
    const content = groups.map((group, i) => {
      const words = group.words.filter(w => w !== word);
      const chips = words.map(w => {
        const saved = bag.some(item => item.word === w);
        if (!visibleItems.has(w)) visibleItems.set(w, { ...withUsage({ word: w, when: group.definition }), source: word });
        return `<div class="dictionary-word-wrap"><div class="dictionary-token"><button type="button" class="dictionary-word" data-say="${escape(w)}" aria-label="听读音：${escape(w)}">${ruby(w)}</button><button type="button" class="save-word${saved ? " is-saved" : ""}" data-save="${escape(w)}" aria-pressed="${saved}" aria-label="${saved ? "移出词袋：" : "放进词袋："}${escape(w)}">${saved ? "✓" : "＋"}</button></div>${usage.has(w) ? `<button type="button" class="word-use-link" data-query="${escape(w)}" aria-label="看${escape(w)}的搭配例句">搭配 · 例句 →</button>` : ""}</div>`;
      }).join("");
      return `<section class="dictionary-group"><div class="dictionary-meaning"><span>${String(i + 1).padStart(2, "0")}</span><p>${escape(group.definition || "一组相近表达，结合原句选一选。")}</p></div>${words.length ? `<div class="dictionary-tokens">${chips}</div>` : '<p class="empty">这个意思暂时没有收录其他常用说法。</p>'}</section>`;
    });
    const body = content.slice(0, 4).join("") + (groups.length > 4 ? `<details class="more-meanings"><summary>还有 ${groups.length - 4} 组意思，展开看看</summary>${content.slice(4).join("")}</details>` : "");
    const source = `<p class="dictionary-source">词库：<a href="https://github.com/bond-lab/cow/releases/tag/v1.1" target="_blank" rel="noopener">汉语开放词网 COW 1.1</a> · 常用词优先</p>`;
    return supplemental ? `<details class="dictionary-extra"><summary>词典里的其他表达 <span>${groups.length} 组意思</span></summary>${body}${source}</details>` : `<div class="dictionary-results">${body}${source}</div>`;
  }
  function cards(items, source) {
    items = items.map(withUsage);
    items.forEach(item => visibleItems.set(item.word, { ...item, source: source || item.source || "" }));
    return items.map((item, i) => {
      const saved = bag.some(w => w.word === item.word);
      return `<article class="word-slip">
        <div class="slip-top"><span class="slip-number">${String(i + 1).padStart(2, "0")}</span><button class="save-word${saved ? " is-saved" : ""}" type="button" data-save="${escape(item.word)}" aria-pressed="${saved}" aria-label="${saved ? "移出词袋：" : "放进词袋："}${escape(item.word)}">${saved ? "已收藏 ✓" : "收藏 ＋"}</button></div>
        <button class="word-sound" type="button" data-say="${escape(item.word)}" aria-label="听读音：${escape(item.word)}">${ruby(item.word)} <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m11 5-6 5H2v4h3l6 5V5ZM15 8a6 6 0 0 1 0 8M18 4a11 11 0 0 1 0 16"/></svg></button>
        <p class="word-when">${escape(item.when || "意思相近，先想想它是否适合你的句子。")}</p>
        ${item.pairs.length ? `<div class="word-pair"><span>搭配</span><div class="usage-pairs">${pairButtons(item.pairs)}</div></div>` : ""}
        ${item.example ? `<div class="word-example"><span>试着用</span><p>${ruby(item.example)}</p><button type="button" class="read-example" data-say="${escape(item.example)}">听例句 ↗</button></div>` : ""}
        ${item.contrast ? `<details class="word-contrast"><summary>辨一辨</summary><p>${escape(item.contrast)}</p><button class="read-example" type="button" data-say="${escape(item.contrast)}">听辨析 ↗</button></details>` : ""}
      </article>`;
    }).join("");
  }
  function header(word, note, label) {
    return `<header class="word-heading"><div><p class="eyebrow">${label || "换个词，说得更贴切"}</p><h2><button type="button" data-say="${escape(word)}" aria-label="听读音：${escape(word)}">${ruby(word)}</button><span>还可以怎么说？</span></h2></div><p class="choice-note">${escape(note)}</p></header>`;
  }
  function renderWord(word, remember = true) {
    if (!word) { $("askTip").textContent = "先说一个词，比如「可爱」。"; return; }
    activeWord = word;
    setView("synonyms");
    const entry = findEntry(word);
    visibleItems = new Map();
    const box = $("writingResult");
    if (entry) {
      // 从相关词查入时，展示它自己的用法，不把原组的其他词误称为它的近义词。
      const direct = entry.word === word || aliases[word] === entry.word;
      const items = entry.items.filter(item => item.word !== word);
      const near = direct ? items.filter(item => !item.related) : [];
      const related = direct ? items.filter(item => item.related) : items;
      if (!direct && entry.word !== word) related.unshift({ word: entry.word, when: `「${entry.word}」这一组里的相关表达，意思不完全相同。` });
      box.innerHTML = header(word, direct ? entry.note : `你找到了「${entry.word}」这一组。下面是相关表达，选词时要看看各自的意思。`)
        + usageFocus(word)
        + (near.length ? `<div class="result-section-head"><h3>意思相近，可以比较着用</h3><span>点词语听读音</span></div><div class="word-slips">${cards(near, word)}</div>` : "")
        + (related.length ? `<div class="result-section-head related-head"><h3>换个角度描写</h3><span>意思有区别，看看再选</span></div><div class="word-slips related-slips">${cards(related, word)}</div>` : "")
        + (entry.tip ? `<aside class="writing-seed"><span class="seed-mark" aria-hidden="true">✳</span><div><h3>再多写一点点</h3><p>${escape(entry.tip)}</p></div><button type="button" data-say="${escape(entry.tip)}" aria-label="听写作小提示">听一听 ↗</button></aside>` : "");
      box.insertAdjacentHTML("beforeend", dictionarySection(word, true));
    } else if (usage.has(word)) {
      box.innerHTML = header(word, "先看搭配和例句，再看看这个词与相关表达的区别。", "常用写作词，放进自己的句子") + usageFocus(word) + dictionarySection(word) + familySection(word);
    } else {
      const found = dictionarySection(word);
      if (found) {
        box.innerHTML = header(word, "同一个词可能有几种意思。先看意思，再选适合原句的词。", "在词典里找到这些") + found;
      } else {
        box.innerHTML = `<section class="no-word"><p class="eyebrow">词语还在慢慢收集</p><h2>「<span class="lookup-word">${escape(word)}</span>」暂时没有收录</h2><p>可以换一个常用词，或点「翻词典」找找相近的表达。</p><div class="suggested-words">${["可爱", "高兴", "漂亮", "安静", "认真"].map(w => `<button type="button" data-query="${w}">${ruby(w)} →</button>`).join("")}</div></section>`;
      }
    }
    if (remember) {
      const recent = load(HISTORY_KEY, []).filter(w => typeof w === "string" && w !== word);
      save(HISTORY_KEY, [word, ...recent].slice(0, 12));
    }
    renderTopics();
  }
  function renderTopics() {
    const themes = ["常用", "写人", "写心情", "写风景", "写动物", "写动作", "写事情", "翻词典", "最近查过"];
    const featured = ["可爱", "高兴", "漂亮", "安静", "认真", "鲜艳", "有趣", "勇敢"];
    let words = activeTheme === "最近查过" ? load(HISTORY_KEY, []).filter(w => typeof w === "string") : activeTheme === "常用" ? featured : [...usage.values()].filter(e => e.theme === activeTheme).map(e => e.word);
    let browse = "", more = "";
    if (activeTheme === "翻词典") {
      const letters = [...new Set(dictionaryWords.map(word => plain((pinyin[word] || [""])[0]).slice(0, 1)))].filter(Boolean).sort();
      words = dictionaryWords.filter(word => !dictionaryLetter || plain((pinyin[word] || [""])[0]).startsWith(dictionaryLetter)).sort((a, b) => (lexicon.rank[b] || 0) - (lexicon.rank[a] || 0));
      browse = `<p class="browse-note">${dictionaryWords.length.toLocaleString("zh-CN")} 个常用词，按拼音首字母翻一翻。</p><div class="dictionary-alphabet"><button type="button" data-letter="" aria-pressed="${!dictionaryLetter}">常用</button>${letters.map(letter => `<button type="button" data-letter="${letter}" aria-pressed="${dictionaryLetter === letter}">${letter.toUpperCase()}</button>`).join("")}</div>`;
      more = words.length > dictionaryLimit ? `<button type="button" class="browse-more" id="moreDictionaryWords">再看 24 个词 ↓</button>` : "";
      words = words.slice(0, dictionaryLimit);
    } else if (!["常用", "最近查过"].includes(activeTheme)) {
      browse = `<p class="browse-note">这一类有 ${words.length} 个词，点词语看搭配、例句和辨析。</p>`;
      more = words.length > topicLimit ? '<button type="button" class="browse-more" id="moreTopicWords">再看 18 个词 ↓</button>' : "";
      words = words.slice(0, topicLimit);
    }
    $("topicBar").innerHTML = `<div class="theme-tabs">${themes.map(theme => `<button type="button" data-theme="${theme}" aria-pressed="${activeTheme === theme}">${theme}</button>`).join("")}</div>${browse}<div class="suggested-words">${words.length ? words.map(word => `<button type="button" data-query="${escape(word)}" class="${word === activeWord ? "is-active" : ""}">${ruby(word)}</button>`).join("") : '<p class="empty">查过的词会留在这里。</p>'}</div>${more}`;
  }
  function renderBag() {
    visibleItems = new Map();
    $("wordbagWorkspace").innerHTML = `<header class="bag-heading"><p class="eyebrow">把喜欢的词，留在手边</p><h2>我的词袋 <span>${bag.length} 个词</span></h2><p>写作文时来翻一翻，挑一个适合自己的词。</p></header>`
      + (bag.length ? `<div class="word-slips">${cards(bag)}</div>` : `<div class="bag-empty"><span aria-hidden="true">藏</span><h3>还没有装进词语</h3><p>看到想用的词，点「收藏 ＋」就能放进来。</p><button class="btn solid" type="button" data-view="synonyms">去找一个好词 →</button></div>`)
      + `<p class="storage-note" id="bagStatus" role="status">词袋保存在这台设备的浏览器中。</p>`;
  }
  function toggleSave(word, button) {
    const found = bag.some(item => item.word === word);
    const item = visibleItems.get(word);
    const next = found ? bag.filter(item => item.word !== word) : item ? [...bag, item] : bag;
    if (!save(BAG_KEY, next)) {
      const status = view === "wordbag" ? $("bagStatus") : $("askTip");
      status.textContent = "这次没能保存词袋，可能是浏览器存储空间不足。可以先把词记到纸上。";
      return;
    }
    bag = next;
    updateCount();
    if (view === "wordbag") renderBag();
    else {
      document.querySelectorAll("[data-save]").forEach(control => {
        if (control.dataset.save !== word) return;
        control.textContent = control.closest(".dictionary-token") ? (found ? "＋" : "✓") : (found ? "收藏 ＋" : "已收藏 ✓");
        control.classList.toggle("is-saved", !found);
        control.setAttribute("aria-pressed", String(!found));
        control.setAttribute("aria-label", `${found ? "放进词袋：" : "移出词袋："}${word}`);
      });
    }
  }
  function route(raw) {
    if (!hasIntent(raw) && /(?:的(?:那个)?[\p{Script=Han}]|怎么写|笔顺|怎么读)$/u.test(String(raw))) {
      setView("characters"); return false;
    }
    if (view === "characters" && !hasIntent(raw)) return false;
    const word = resolveWord(raw);
    if (!word) { $("askTip").textContent = "先说一个词，比如「可爱」。"; return true; }
    renderWord(word);
    $("writingResult").scrollIntoView({ behavior: "smooth", block: "start" });
    return true;
  }
  document.addEventListener("click", event => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.view) { $("askInput").value = ""; setView(button.dataset.view); }
    else if (button.dataset.query) { $("askInput").value = button.dataset.query; renderWord(button.dataset.query); $("writingResult").scrollIntoView({ behavior: "smooth", block: "start" }); }
    else if (button.dataset.theme) { activeTheme = button.dataset.theme; dictionaryLimit = 24; topicLimit = 18; renderTopics(); }
    else if (Object.hasOwn(button.dataset, "letter")) { dictionaryLetter = button.dataset.letter; dictionaryLimit = 24; renderTopics(); }
    else if (button.id === "moreDictionaryWords") { dictionaryLimit += 24; renderTopics(); }
    else if (button.id === "moreTopicWords") { topicLimit += 18; renderTopics(); }
    else if (button.dataset.save) toggleSave(button.dataset.save, button);
    // 查字模块保留原有的朗读事件，避免一次点击朗读两次。
    else if (button.dataset.say && (button.closest("#writingWorkspace") || button.closest("#wordbagWorkspace"))) speak(button.dataset.say);
  });
  window.addEventListener("hashchange", () => setView(location.hash.slice(1), false));
  window.WENZI_WRITING = { route, setView, getView: () => view, ruby, speak, normalize, resolveWord };
  const initialView = location.hash.slice(1) || "synonyms";
  renderWord(activeWord, false);
  setView(initialView);
  updateCount();
})();
