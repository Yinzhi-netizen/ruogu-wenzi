"""若谷问字 · 离线词库生成脚本

用法：python -I tools/build_data.py <原始数据目录>

原始数据目录需包含（不进仓库）：
  chars8105.txt   《通用规范汉字表》8105 字，按表序，前 3500 为一级字
  dict.txt        jieba 词频词典（MIT）
  cilin.txt       哈工大同义词词林扩展版（GB18030）
  textbook.json   若谷课本词（由星河书旅 grade1/grade2-words.js 导出）
  hwd/package/    hanzi-writer-data 笔顺数据
  ai_synonyms.json（可选）AI 补充的写作近义词组与孩子版解释

产物：data/chars.js、data/synonyms.js、data/cards.js、strokes/*.json
"""
import json
import os
import shutil
import sys
from collections import defaultdict

from pypinyin import Style, pinyin

RAW = sys.argv[1]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORDS_PER_CHAR = 12
MIN_WORD_FREQ = 20         # 组词的最低词频
MIN_SYN_FREQ = 200         # 近义词的最低词频
BLOCK_POS = {"nr", "nrt", "nrfg", "nz", "nt", "eng", "x", "m"}  # 人名、专名、机构、外文、数量
TAIL_PARTICLES = set("呢吗吧啊呀了着过的地得们")       # 「笑呢」「更红」这类切分残片
HEAD_JUNK = set("更很亿较最")
CILIN_CLASSES = set("EFGI")  # 词林大类：特征、动作、心理、现象与状态——写作文最用得上


def raw(name):
    return os.path.join(RAW, name)


def load_chars():
    with open(raw("chars8105.txt"), encoding="utf-8") as f:
        chars = [line.strip() for line in f if line.strip()]
    return chars[:3500]


def load_jieba(charset):
    freq, pos = {}, {}
    with open(raw("dict.txt"), encoding="utf-8") as f:
        for line in f:
            parts = line.split()
            if len(parts) < 2:
                continue
            word, count = parts[0], int(parts[1])
            tag = parts[2] if len(parts) > 2 else ""
            if 2 <= len(word) <= 4 and all(c in charset for c in word):
                freq[word] = count
                pos[word] = tag
    return freq, pos


def load_textbook():
    with open(raw("textbook.json"), encoding="utf-8") as f:
        return [w for w in json.load(f) if 2 <= len(w) <= 4]


def char_pinyin(ch):
    readings = pinyin(ch, style=Style.TONE, heteronym=True)[0]
    plain = pinyin(ch, style=Style.NORMAL, heteronym=True)[0]
    return readings, sorted(set(plain), key=plain.index)


def build_words(chars, freq, pos, textbook):
    textbook_set = set(textbook)
    by_char = defaultdict(list)
    for word, count in freq.items():
        if pos.get(word) in BLOCK_POS or count < MIN_WORD_FREQ:
            continue
        if word[-1] in TAIL_PARTICLES or word[0] in HEAD_JUNK:
            continue
        for ch in set(word):
            by_char[ch].append(word)
    for word in textbook:
        for ch in set(word):
            if word not in by_char[ch]:
                by_char[ch].append(word)

    ai_path = raw("ai_words.json")
    ai_words = {}
    if os.path.exists(ai_path):
        with open(ai_path, encoding="utf-8") as f:
            ai_words = json.load(f)

    result = {}
    for ch in chars:
        if ch in ai_words:
            # AI 精选已按「写作文常用」排好；其中课本学过的词提到最前（课本里的识字短语不额外补进来）
            picked = ai_words[ch]
            words = [w for w in picked if w in textbook_set] + [w for w in picked if w not in textbook_set]
        else:
            words = sorted(
                by_char.get(ch, []),
                # 课本词置顶；地名（ns）往后放；其余按词频
                key=lambda w: (w not in textbook_set, pos.get(w) == "ns", -freq.get(w, 0), len(w)),
            )
        result[ch] = words[:WORDS_PER_CHAR]
    return result, textbook_set


def char_rank(chars, freq):
    # 字频：所有含该字的词频之和，用于同音候选排序
    score = defaultdict(int)
    for word, count in freq.items():
        for ch in word:
            score[ch] += count
    return {ch: score.get(ch, 0) for ch in chars}


def build_synonyms(freq, charset):
    groups = []
    with open(raw("cilin.txt"), encoding="gb18030") as f:
        for line in f:
            parts = line.split()
            if not parts or not parts[0].endswith("=") or parts[0][0] not in CILIN_CLASSES:
                continue
            words = []
            for w in parts[1:]:
                if 2 <= len(w) <= 4 and all(c in charset for c in w) and freq.get(w, 0) >= MIN_SYN_FREQ and w not in words:
                    words.append(w)
            if len(words) >= 2:
                words.sort(key=lambda w: -freq.get(w, 0))
                groups.append({"code": parts[0][:-1], "words": words[:10]})
    return groups


def merge_ai(groups):
    path = raw("ai_synonyms.json")
    if not os.path.exists(path):
        return groups, {}
    with open(path, encoding="utf-8") as f:
        ai = json.load(f)
    glosses = ai.get("glosses", {})
    keep = {g["code"]: g for g in ai.get("reviewed", [])}
    merged = []
    for g in groups:
        if g["code"] in keep:
            if keep[g["code"]]["words"]:
                merged.append({"code": g["code"], "words": keep[g["code"]]["words"]})
        else:
            merged.append(g)
    writing = []
    for i, extra in enumerate(ai.get("writing_groups", [])):
        words = list(extra["words"])
        if extra["topic"] == "颜色":
            # 「火红、鲜红」这组也是「红色」的近义词：把「X色」接在组头，问「红色」时能找到
            for color in "红黄蓝绿白黑紫灰粉橙金":
                if any(color in w for w in words) and f"{color}色" not in words:
                    words.insert(0, f"{color}色")
                    break
        writing.append({"code": f"W{i:03d}", "topic": extra["topic"], "words": words})
    merged = writing + merged
    return merged, glosses


def write_js(path, var, data):
    with open(path, "w", encoding="utf-8") as f:
        f.write(f"// 由 tools/build_data.py 自动生成，勿手改\nwindow.{var} = ")
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")


def main():
    chars = load_chars()
    charset = set(chars)
    freq, pos = load_jieba(charset)
    textbook = load_textbook()
    words, textbook_set = build_words(chars, freq, pos, textbook)
    rank = char_rank(chars, freq)

    textbook_chars = {c for w in textbook for c in w}
    char_table, homophones = {}, defaultdict(list)
    for ch in chars:
        readings, plain = char_pinyin(ch)
        char_table[ch] = {
            "py": readings[:3],
            "w": words[ch],
            "tb": 1 if ch in textbook_chars else 0,
        }
        for i, p in enumerate(plain):
            homophones[p].append((i > 0, -rank[ch], ch))
    # 主读音在前、次读音在后，同组内按字频
    homophones = {p: [c for _, _, c in sorted(items)] for p, items in homophones.items()}

    groups, glosses = merge_ai(build_synonyms(freq, charset))

    data_dir = os.path.join(ROOT, "data")
    write_js(os.path.join(data_dir, "chars.js"), "WENZI_CHARS", {
        "chars": char_table,
        "homophones": homophones,
        "textbook": sorted(w for w in textbook_set),
    })
    write_js(os.path.join(data_dir, "synonyms.js"), "WENZI_SYNONYMS", {
        "groups": groups,
        "glosses": glosses,
    })

    # 字源识字卡（v5 JSON）打包成一个脚本，离线可用；新卡放进 cards/ 后重跑即可
    cards = {}
    card_dir = os.path.join(ROOT, "cards")
    for name in sorted(os.listdir(card_dir)):
        if name.endswith(".json"):
            with open(os.path.join(card_dir, name), encoding="utf-8") as f:
                card = json.load(f)
            cards[card["char"]] = card
    write_js(os.path.join(data_dir, "cards.js"), "WENZI_CARDS", cards)

    stroke_dir = os.path.join(ROOT, "strokes")
    os.makedirs(stroke_dir, exist_ok=True)
    copied = 0
    for ch in chars:
        src = raw(os.path.join("hwd", "package", f"{ch}.json"))
        if os.path.exists(src):
            shutil.copyfile(src, os.path.join(stroke_dir, f"{ch}.json"))
            copied += 1

    print(f"cards {len(cards)} · chars {len(chars)} · textbook words {len(textbook_set)} · synonym groups {len(groups)} · strokes {copied}")


if __name__ == "__main__":
    main()
