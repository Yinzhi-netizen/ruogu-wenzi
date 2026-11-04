// 构建时需要 Python + pypinyin。页面运行时没有第三方网络依赖。
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
global.window = {};
for (const file of ["chars", "lexicon", "writing", "writing-usage"]) require(path.join(root, "data", `${file}.js`));
const texts = new Set();
const curated = new Set();
Object.values(window.WENZI_CHARS.chars).forEach(c => c.w.forEach(w => texts.add(w)));
window.WENZI_LEXICON.groups.forEach(g => g.words.forEach(w => texts.add(w)));
window.WENZI_WRITING_DATA.entries.forEach(e => {
  texts.add(e.word);
  e.items.forEach(i => [i.word, i.pair, i.example].filter(Boolean).forEach(t => { texts.add(t); curated.add(t); }));
});
window.WENZI_USAGE.words.forEach(item => {
  texts.add(item.word);
  [...item.pairs, item.example].forEach(text => { texts.add(text); curated.add(text); });
});
const code = `
import sys, json
from pypinyin import lazy_pinyin, Style, load_phrases_dict
load_phrases_dict({
  '暖和': [['nuǎn'], ['huo']], '和蔼': [['hé'], ['ǎi']],
  '着急': [['zháo'], ['jí']], '快乐': [['kuài'], ['lè']],
  '好看': [['hǎo'], ['kàn']], '爱好': [['ài'], ['hào']],
  '曲折': [['qū'], ['zhé']], '澄澈': [['chéng'], ['chè']],
  '干净': [['gān'], ['jìng']], '重新': [['chóng'], ['xīn']],
  '长高': [['zhǎng'], ['gāo']], '长大': [['zhǎng'], ['dà']],
  '喜欢': [['xǐ'], ['huan']], '漂亮': [['piào'], ['liang']],
  '俏皮': [['qiào'], ['pi']], '老实': [['lǎo'], ['shi']],
  '舒服': [['shū'], ['fu']], '委屈': [['wěi'], ['qu']],
  '机灵': [['jī'], ['ling']], '亮堂': [['liàng'], ['tang']],
  '妈妈': [['mā'], ['ma']], '爸爸': [['bà'], ['ba']],
  '爷爷': [['yé'], ['ye']], '奶奶': [['nǎi'], ['nai']],
  '姐姐': [['jiě'], ['jie']], '妹妹': [['mèi'], ['mei']],
  '弟弟': [['dì'], ['di']], '消息': [['xiāo'], ['xi']],
  '低下头': [['dī'], ['xià'], ['tóu']], '铺开': [['pū'], ['kāi']],
  '结实': [['jiē'], ['shi']], '要倒': [['yào'], ['dǎo']],
  '背上书包': [['bēi'], ['shàng'], ['shū'], ['bāo']],
  '背起书包': [['bēi'], ['qǐ'], ['shū'], ['bāo']],
  '裁成长方形': [['cái'], ['chéng'], ['cháng'], ['fāng'], ['xíng']],
  '硕果累累': [['shuò'], ['guǒ'], ['léi'], ['léi']]
})
data = {}
source = json.loads(sys.stdin.buffer.read().decode('utf-8'))
curated = set(source['curated'])
for text in source['texts']:
  syllables = lazy_pinyin(text, style=Style.TONE, neutral_tone_with_five=False, errors=lambda x:list(x))
  # 助词只在已编写的语境中订正，不能把「取得」「大地」「知了」改成轻声。
  for i, ch in enumerate(text):
    if ch == '一': syllables[i] = 'yī'
    if ch == '不': syllables[i] = 'bù'
    if text not in curated: continue
    if ch == '地' and text[max(0,i-1):i+1] not in ['大地', '土地', '草地', '当地', '场地', '营地', '田地', '陆地', '泥地', '雪地', '地地'] and i + 1 < len(text) and text[i + 1] not in '面球板图址铁方下上带': syllables[i] = 'de'
    if ch == '着' and i > 0 and not (text[i:i+2] in ['着急', '着火', '着凉', '着陆']): syllables[i] = 'zhe'
    if ch == '得' and text[max(0,i-1):i+1] not in ['取得', '获得', '赢得', '难得'] and text[i:i+2] not in ['得到', '得奖', '得分', '得胜', '得知', '得意'] and syllables[i] != 'děi': syllables[i] = 'de'
    if ch == '了' and text[max(0,i-1):i+1] != '知了' and text[i:i+2] not in ['了解', '了结']: syllables[i] = 'le'
  data[text] = syllables
sys.stdout.buffer.write(json.dumps(data, ensure_ascii=False, separators=(',', ':')).encode('utf-8'))
`;
const result = spawnSync(process.env.PYTHON_BIN || "python", ["-c", code], {
  input: JSON.stringify({ texts: [...texts].sort(), curated: [...curated] }), encoding: "utf8", maxBuffer: 16 * 1024 * 1024
});
if (result.status !== 0) throw new Error(result.stderr || "拼音生成失败");
const data = JSON.parse(result.stdout);
// 指定熟语轻声，其他词按词组词典的常规标调。
Object.assign(data, { "亮堂": ["liàng", "tang"], "老实": ["lǎo", "shi"], "暖和": ["nuǎn", "huo"] });
fs.writeFileSync(path.join(root, "data", "word-pinyin.js"), `// 词组拼音静态索引，由 tools/build_writing_pinyin.cjs 生成。\nwindow.WENZI_WORD_PINYIN=${JSON.stringify(data)};\n`);
console.log(`已生成 ${texts.size} 条词语、搭配与例句的拼音。`);
