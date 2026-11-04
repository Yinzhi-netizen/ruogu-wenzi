/* 使用合成语音事件和隔离的浏览器存储，绝不读取真实麦克风或个人浏览器资料。 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { chromium, webkit } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const root = path.resolve(__dirname, "..");
const qaDir = process.env.QA_DIR || path.join(root, ".qa");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".jpg": "image/jpeg", ".png": "image/png", ".woff2": "font/woff2", ".txt": "text/plain" };
const server = http.createServer((req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const file = path.resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    res.setHeader("Content-Type", `${types[path.extname(file)] || "application/octet-stream"}; charset=utf-8`);
    fs.createReadStream(file).on("error", () => res.writeHead(404).end()).pipe(res);
  } catch (_) { res.writeHead(400).end(); }
});
const oldDictionary = JSON.stringify({ history: [{ ch: "谷", ctx: "山谷", at: "2026-10-01T00:00:00Z" }], wish: { 谷: 1 } });
const oldProfile = JSON.stringify({ profiles: { child: { stars: 1336 } } }); // 仅测试夹具，非真实星星记录
let browser;
(async () => {
  fs.mkdirSync(qaDir, { recursive: true });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", headless: true });
  const context = await browser.newContext({ viewport: { width: 1180, height: 900 }, reducedMotion: "reduce" });
  await context.addInitScript(({ oldDictionary, oldProfile }) => {
    if (!sessionStorage.getItem("seeded")) {
      localStorage.setItem("ruogu-wenzi-v1", oldDictionary);
      localStorage.setItem("ruogu-literacy-profiles-v1", oldProfile);
      sessionStorage.setItem("seeded", "1");
    }
    window.__spoken = [];
    window.SpeechSynthesisUtterance = function (text) { this.text = text; };
    Object.defineProperty(window, "speechSynthesis", { value: { cancel() {}, getVoices() { return []; }, speak(u) { window.__spoken.push(u.text); } } });
    class FakeRecognition {
      start() { window.__recognizer = this; this.onstart(); }
      stop() { if (this.onend) this.onend(); }
      abort() { this.stop(); }
    }
    window.SpeechRecognition = FakeRecognition;
  }, { oldDictionary, oldProfile });
  const page = await context.newPage();
  const textOf = selector => page.locator(selector).evaluate(node => { const copy = node.cloneNode(true); copy.querySelectorAll("rt,rp").forEach(el => el.remove()); return copy.textContent; });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(url);
  await page.locator(".word-slip").first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.evaluate(() => document.fonts.check('28px "Ruogu Kai Web"', "可爱明白清晰")), true);
  const fonts = await page.evaluate(() => ({ input: getComputedStyle(document.getElementById("askInput")).fontFamily, word: getComputedStyle(document.querySelector(".word-sound")).fontFamily, title: getComputedStyle(document.getElementById("coverTitle")).fontFamily, pinyin: getComputedStyle(document.querySelector("rt")).fontFamily }));
  assert.match(fonts.input, /Ruogu Kai Web/);
  assert.match(fonts.word, /Ruogu Kai Web/);
  assert.doesNotMatch(fonts.title, /Ruogu Kai Web/);
  assert.doesNotMatch(fonts.pinyin, /Ruogu Kai Web/);
  assert.equal(await page.locator("#charWorkspace").isHidden(), true);
  assert.ok(await page.locator("#writingResult rt").count() > 40);
  assert.equal(await page.evaluate(() => localStorage.getItem("ruogu-wenzi-v1")), oldDictionary);
  await page.screenshot({ path: path.join(qaDir, "写作小书房-全景.png"), fullPage: true });
  const query = async text => {
    await page.locator("#askInput").fill(text);
    await page.locator("#askForm").evaluate(form => form.requestSubmit());
  };
  await query("高兴的近义词有哪些");
  assert.match(await page.locator("#writingResult").innerText(), /开心/);
  await page.getByRole("button", { name: "听读音：快乐", exact: true }).click();
  assert.equal(await page.evaluate(() => window.__spoken.at(-1)), "快乐");
  await page.locator("[data-save='快乐']").first().click();
  await page.locator("[data-view='wordbag']").first().click();
  assert.match(await textOf("#wordbagWorkspace"), /快乐的一天/);
  await page.reload();
  assert.match(await textOf("#wordbagWorkspace"), /快乐的一天/);
  await page.screenshot({ path: path.join(qaDir, "写作小书房-我的词袋.png"), fullPage: true });
  await page.locator("[data-save='快乐']").click();
  assert.match(await page.locator("#wordbagWorkspace").innerText(), /还没有装进词语/);
  await page.locator("[data-view='synonyms']").first().click();
  await page.locator("#micButton").click();
  await page.evaluate(() => {
    const result = [{ transcript: "可爱的近义词有哪些" }]; result.isFinal = true;
    window.__recognizer.onresult({ results: [result] });
  });
  assert.match(await textOf("#writingResult"), /惹人喜爱/);
  assert.equal(await page.locator("#micButton").getAttribute("aria-pressed"), "false");
  await page.locator("#micButton").click();
  await page.evaluate(() => { window.__recognizer.onerror({ error: "not-allowed" }); window.__recognizer.onend(); });
  assert.match(await page.locator("#askTip").innerText(), /麦克风/);
  await query("火星小泡泡的近义词");
  assert.match(await page.locator("#writingResult").innerText(), /暂时没有收录/);
  await query('<img src=x onerror=alert(1)>的近义词');
  assert.equal(await page.locator("#writingResult img").count(), 0);
  // 查询原 55 个示例以外的词，确实走 COW 索引，并检查原词义组没有展平。
  for (const word of ["清晰", "丰富", "陪伴", "珍贵", "犹豫", "闪烁"]) {
    await query(`${word}的近义词有哪些`);
    assert.ok(await page.locator(".dictionary-group").count() > 0, `${word} should come from the dictionary`);
    assert.ok(await page.locator(".dictionary-word rt").count() > 0);
  }
  await query("陪伴");
  assert.match(await textOf("#writingResult"), /陪同/);
  await page.getByRole("button", { name: "听读音：陪同", exact: true }).first().click();
  assert.equal(await page.evaluate(() => window.__spoken.at(-1)), "陪同");
  await page.locator("[data-save='陪同']").first().click();
  await page.locator("[data-view='wordbag']").first().click();
  assert.match(await textOf("#wordbagWorkspace"), /陪同/);
  await page.locator("[data-view='synonyms']").first().click();
  await page.locator("[data-theme='翻词典']").click();
  assert.match(await page.locator(".browse-note").innerText(), /7,701/);
  const beforeMore = await page.locator("#topicBar [data-query]").count();
  await page.locator("#moreDictionaryWords").click();
  assert.equal(await page.locator("#topicBar [data-query]").count(), beforeMore + 24);
  await page.locator("[data-letter='q']").click();
  const browseWords = await page.locator("#topicBar [data-query]").evaluateAll(buttons => buttons.map(b => b.dataset.query));
  assert.ok(browseWords.length > 0);
  assert.equal(await page.evaluate(words => words.every(word => WENZI_WORD_PINYIN[word][0].startsWith("q")), browseWords), true);
  await query("清晰");
  await page.locator("[data-theme='常用']").click();
  assert.equal(await page.locator(".usage-focus .usage-pairs button").count(), 2);
  assert.match(await textOf(".usage-focus"), /清晰的脚印/);
  assert.match(await textOf(".usage-focus"), /朦胧/);
  await page.getByRole("button", { name: "看清楚的搭配例句", exact: true }).first().click();
  assert.equal(await page.locator("#askInput").inputValue(), "清楚");
  assert.match(await textOf(".usage-focus"), /清楚地说明/);
  await query("花苞的近义词有哪些");
  assert.match(await textOf(".usage-focus"), /还没完全开放/);
  assert.equal(await page.locator(".usage-focus .usage-pairs button").count(), 2);
  assert.match(await page.locator(".usage-family > summary").innerText(), /同一主题/);
  assert.equal(await page.locator(".no-word").count(), 0);
  await page.locator(".usage-focus .read-example").first().click();
  assert.match(await page.evaluate(() => window.__spoken.at(-1)), /花苞/);
  await query("清晰");
  await page.locator(".usage-focus [data-save='清晰']").click();
  await page.locator("[data-view='wordbag']").first().click();
  assert.match(await textOf("#wordbagWorkspace"), /清晰的声音/);
  await page.reload();
  assert.match(await textOf("#wordbagWorkspace"), /清晰的脚印/);
  assert.ok(await page.locator("#wordbagWorkspace .word-contrast").count() > 0);
  await page.locator("[data-view='synonyms']").first().click();
  await page.locator("[data-theme='写动作']").click();
  assert.equal(await page.locator("#topicBar [data-query]").count(), 18);
  await page.locator("#moreTopicWords").click();
  assert.equal(await page.locator("#topicBar [data-query]").count(), 36);
  await page.locator("[data-theme='常用']").click();
  for (const word of ["观察", "讲述", "丰收", "全神贯注", "陪同", "找到", "请教", "红色"]) {
    await query(`${word}的近义词有哪些`);
    assert.equal(await page.locator(".usage-focus .usage-pairs button").count(), 2);
    assert.match(await textOf(".usage-focus"), /辨一辨/);
  }
  await query("清晰");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(qaDir, "词典扩展-楷体-清晰.png"), fullPage: true });
  await page.locator(".usage-focus").screenshot({ path: path.join(qaDir, "常用词-搭配例句辨析.png") });
  await query("鲜艳的艳");
  assert.equal(await page.locator("#charWorkspace").isVisible(), true);
  await page.locator("#gridBox svg").waitFor();
  assert.match(await textOf("#wordRow"), /鲜艳/);
  assert.ok(await page.locator("#wordRow rt").count() > 0);
  await page.locator("#openWordDesk").click();
  assert.match(await textOf("#writingResult"), /绚丽/);
  await page.locator("#historyButton").click();
  assert.match(await page.locator("#sheetBody").innerText(), /谷/);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#sheet").isHidden(), true);
  await query("可爱");
  for (const [width, height, name] of [[1024, 768, "iPad横屏"], [768, 1024, "iPad竖屏"], [390, 844, "手机窄屏"]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo(0, 0));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} has horizontal overflow`);
    await page.screenshot({ path: path.join(qaDir, `写作小书房-${name}.png`), fullPage: true });
  }
  assert.equal(await page.evaluate(() => localStorage.getItem("ruogu-literacy-profiles-v1")), oldProfile);
  // 语音不支持 / 存储拒绝时，查词仍可使用。
  await page.addInitScript(() => { window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined; });
  await page.reload();
  await page.locator("#micButton").click();
  assert.match(await page.locator("#askTip").innerText(), /键盘/);
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException("quota", "QuotaExceededError"); }; });
  await query("高兴");
  await page.locator("[data-save='快乐']").first().click();
  assert.match(await page.locator("#askTip").innerText(), /没能保存/);
  assert.equal(await page.locator("[data-save='快乐']").first().getAttribute("aria-pressed"), "false");
  // 词条数据的每个字都有注音；固定检查易读错的多音字。
  const dataResult = await page.evaluate(() => {
    const missing = [];
    for (const e of WENZI_WRITING_DATA.entries) for (const text of [e.word, ...e.items.flatMap(i => [i.word, i.pair, i.example])]) {
      const py = WENZI_WORD_PINYIN[text];
      if (!py || py.length !== [...text].length) missing.push(text);
    }
    return { missing, samples: ["快乐", "暖和", "曲折", "爱好", "着急"].map(w => WENZI_WORD_PINYIN[w].join(" ")) };
  });
  assert.deepEqual(dataResult.missing, []);
  assert.deepEqual(dataResult.samples, ["kuài lè", "nuǎn huo", "qū zhé", "ài hào", "zháo jí"]);
  const grammar = await page.evaluate(() => [
    WENZI_WORD_PINYIN["火热的太阳晒着大地。"].slice(-3),
    WENZI_WORD_PINYIN["我们把地面擦得十分洁净。"].slice(3, 7),
    WENZI_WORD_PINYIN["他老实地说出了事情的经过。"].slice(4, 7)
  ]);
  assert.deepEqual(grammar, [["dà", "dì", "。"], ["dì", "miàn", "cā", "de"], ["shuō", "chū", "le"]]);
  const parses = await page.evaluate(() => ["可爱的近义词有哪些？", "帮我查一下高兴的近义词", "漂亮有哪些近义词"].map(WENZI_WRITING.normalize));
  assert.deepEqual(parses, ["可爱", "高兴", "漂亮"]);
  const usageAudit = await page.evaluate(() => {
    const bad = [], queryFailures = [], legacyMissing = [];
    const words = WENZI_USAGE.words, indexed = new Set(words.map(w => w.word));
    for (const item of words) {
      if (!item.meaning || !item.contrast || !item.example.includes(item.word) || item.pairs.length < 2 || new Set(item.pairs).size !== item.pairs.length) bad.push(item.word);
      for (const text of [item.word, ...item.pairs, item.example]) {
        const py = WENZI_WORD_PINYIN[text];
        if (!py || py.length !== [...text].length) bad.push(text);
      }
      if (WENZI_WRITING.normalize(`${item.word}的近义词有哪些`) !== item.word) queryFailures.push(item.word);
    }
    for (const group of WENZI_WRITING_DATA.entries) for (const word of [group.word, ...group.items.map(i => i.word)]) if (!indexed.has(word)) legacyMissing.push(word);
    return { count: words.length, unique: indexed.size, bad, queryFailures, legacyMissing, polyphones: [WENZI_WORD_PINYIN["结实"], WENZI_WORD_PINYIN["硕果累累"], WENZI_WORD_PINYIN["天刚亮，我们就背上书包出发了。"].slice(7, 11), WENZI_WORD_PINYIN["爸爸帮我把纸张裁成长方形。"].slice(7, 12)] };
  });
  assert.ok(usageAudit.count >= 700);
  assert.equal(usageAudit.unique, usageAudit.count);
  assert.deepEqual(usageAudit.bad, []);
  assert.deepEqual(usageAudit.queryFailures, []);
  assert.deepEqual(usageAudit.legacyMissing, []);
  assert.deepEqual(usageAudit.polyphones, [["jiē", "shi"], ["shuò", "guǒ", "léi", "léi"], ["bēi", "shàng", "shū", "bāo"], ["cái", "chéng", "cháng", "fāng", "xíng"]]);
  const corpus = await page.evaluate(() => ({ stats: WENZI_LEXICON.stats, missing: WENZI_LEXICON.groups.flatMap(g => g.words).filter(word => !WENZI_WORD_PINYIN[word]), unsafe: WENZI_LEXICON.groups.some(g => g.words.some(w => /性交|色情|精液|自杀/.test(w))), loadedOldSource: [...document.scripts].some(s => s.src.includes("data/synonyms.js")) }));
  assert.ok(corpus.stats.queryWords > 7000);
  assert.ok(corpus.stats.synonymWords > 6000);
  assert.deepEqual(corpus.missing, []);
  assert.equal(corpus.unsafe, false);
  assert.equal(corpus.loadedOldSource, false);
  assert.deepEqual(errors, []);
  await context.close();
  // 真正的离线检查：安装本应用的缓存后断网重载。
  const offlineContext = await browser.newContext({ serviceWorkers: "allow" });
  const offlinePage = await offlineContext.newPage();
  await offlinePage.goto(url);
  await offlinePage.evaluate(async () => { await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true })); });
  await offlineContext.setOffline(true);
  await offlinePage.reload();
  await offlinePage.locator(".word-slip").first().waitFor();
  assert.ok(await offlinePage.locator("#writingResult rt").count() > 40);
  await offlinePage.evaluate(() => WENZI_WRITING.route("丰富的近义词"));
  assert.ok(await offlinePage.locator(".dictionary-group").count() > 0);
  assert.equal(await offlinePage.locator(".usage-focus .usage-pairs button").count(), 2);
  assert.match(await offlinePage.locator(".usage-focus").innerText(), /辨一辨/);
  await offlinePage.evaluate(() => document.fonts.ready);
  assert.equal(await offlinePage.evaluate(() => document.fonts.check('28px "Ruogu Kai Web"', "丰富清晰")), true);
  await offlineContext.close();
  console.log(JSON.stringify({ ok: true, tested: "词典查询与浏览、楷体实际加载、语音路由、朗读、拼音、词袋重载、查字笔顺、旧记录保留、存储异常、离线、三种屏幕", qaDir }));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { if (browser) await browser.close(); server.close(); });
