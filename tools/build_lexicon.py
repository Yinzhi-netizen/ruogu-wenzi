"""从官方 COW 1.1 包构建本项目的常用词索引。依赖 jieba，仅在构建时使用。

用法：python tools/build_lexicon.py <cow-1.1.tar.xz>
不扩展义项、不合并共享某个词的组、不把上下位/反义关系当近义关系。
"""
import hashlib
import json
import re
import sys
import tarfile
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

import jieba

ROOT = Path(__file__).resolve().parents[1]
EXPECTED_SHA = "93e9357dda50a38ce626904c2229479afa177df74d9c504aebfeba06ff2f241e"


def read_js_json(name):
    text = (ROOT / "data" / name).read_text(encoding="utf-8")
    return json.loads(text.split(" = ", 1)[1].rstrip(";\n\r "))


def main():
    archive = Path(sys.argv[1])
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    if digest != EXPECTED_SHA:
        raise ValueError("COW 包校验失败：仅接受已核对的官方 1.1 发布文件")
    chars = read_js_json("chars.js")
    charset = set(chars["chars"])
    textbook = set(chars["textbook"])
    known = {w for c in chars["chars"].values() for w in c["w"]}
    reviewed = set(read_js_json("synonyms.js")["glosses"])
    frequency, tags = {}, {}
    with (Path(jieba.__file__).parent / "dict.txt").open(encoding="utf-8") as stream:
        for line in stream:
            word, freq, tag = line.split()
            frequency[word], tags[word] = int(freq), tag

    # 这里是本项目的常用词筛选，不是教育部门认定的小学年级词表。
    # 避开专名、术语式长串、裸语法片段及不适合此年龄独立查阅的成人词。
    blocked = re.compile("性交|性爱|色情|淫|强奸|卖淫|嫖|性欲|性器|射精|精液|阴茎|阴道|乳房|手淫|妓|自杀|自残|屠杀|奸杀|吸毒|毒品|海洛因|可卡因")
    excluded_tags = {"nr", "nr1", "nr2", "nrj", "nrf", "nrt", "nrfg", "ns", "nt", "nz", "eng", "x", "m", "q", "uj", "ul", "uz", "yg", "zg"}
    banned_words = {"性的", "性行为", "乳头", "勃起", "裸体", "赤裸", "发情", "色情的"}

    def eligible(word, pos):
        if not re.fullmatch(r"[\u4e00-\u9fff]{1,4}", word):
            return False
        if word in banned_words or blocked.search(word) or not set(word) <= charset:
            return False
        if tags.get(word) in excluded_tags and word not in known and word not in reviewed:
            return False
        if pos in {"a", "r"} and word not in reviewed and tags.get(word, "")[0:1] not in {"a", "b", "d", "i", "l", "z"}:
            return False
        if word in textbook or word in known:
            return True
        threshold = {"n": 1200, "v": 300, "a": 100, "r": 100}.get(pos, 1000000)
        return frequency.get(word, 0) >= threshold

    with tarfile.open(archive) as package:
        # 只按名字读取包成员，绝不把压缩包的路径直接解压到工作区。
        lexicon = ET.parse(package.extractfile("cow/cow-1.1.xml")).getroot().find("Lexicon")
        license_text = package.extractfile("cow/LICENSE").read().decode("utf-8")
    raw_words = set()
    raw_entries = lexicon.findall("LexicalEntry")
    raw_lemmas = {entry.find("Lemma").get("writtenForm") for entry in raw_entries}
    members = defaultdict(list)
    eligible_words = set()
    for entry in raw_entries:
        lemma = entry.find("Lemma")
        word, pos = lemma.get("writtenForm"), lemma.get("partOfSpeech")
        raw_words.add(word)
        # COW 以英语义项对齐，有「温柔的」等形式。只有已存在且有形容词
        # 词性证据的汉语词，才去掉这个语法后缀；不对任意长短语做截断。
        normalized_adjective = False
        if pos == "a" and word.endswith("的") and word[:-1] in raw_lemmas and tags.get(word[:-1], "").startswith(("a", "b")):
            word = word[:-1]
            normalized_adjective = True
        if pos not in {"n", "v", "a", "r"} or not eligible(word, pos):
            continue
        for sense in entry.findall("Sense"):
            if (sense.get("lexicalized") == "false" and not normalized_adjective) or float(sense.get("confidenceScore", "1")) < 1:
                continue
            members[sense.get("synset")].append(word)
            eligible_words.add(word)

    groups = []
    indexed = set()
    for synset in lexicon.findall("Synset"):
        sid = synset.get("id")
        words = sorted(set(members.get(sid, [])), key=lambda w: (w not in textbook, w not in known, -frequency.get(w, 0), w))
        if not words:
            continue
        definition = "；".join(d.text.strip() for d in synset.findall("Definition") if d.text)
        # 无近义词也无中文释义的单词组不构成可用查询结果。
        if len(words) < 2 and not definition:
            continue
        groups.append({"id": sid, "pos": synset.get("partOfSpeech"), "definition": definition, "words": words})
        indexed.update(words)

    synonym_words = {w for group in groups if len(group["words"]) > 1 for w in group["words"]}
    rank = {word: frequency.get(word, 0) + (10000000 if word in textbook else 0) for word in indexed}
    payload = {
        "source": {"name": "汉语开放词网 COW", "version": "1.1", "url": "https://bond-lab.github.io/cow/", "release": "https://github.com/bond-lab/cow/releases/tag/v1.1", "sha256": digest, "license": "WordNet-style permissive license", "filter": "常用词筛选，不代表小学年级认证"},
        "stats": {"sourceEntries": len(raw_entries), "sourceWords": len(raw_words), "queryWords": len(indexed), "synonymWords": len(synonym_words), "groups": len(groups), "synonymGroups": sum(len(g["words"]) > 1 for g in groups)},
        "groups": groups,
        "rank": rank,
    }
    licenses = ROOT / "licenses"
    licenses.mkdir(exist_ok=True)
    (licenses / "COW-LICENSE.txt").write_text("\n".join(line.rstrip() for line in license_text.splitlines()) + "\n", encoding="utf-8")
    (ROOT / "data" / "lexicon.js").write_text("// COW 1.1 常用词索引；生成脚本及筛选规则见 tools/build_lexicon.py；授权见 licenses/COW-LICENSE.txt\nwindow.WENZI_LEXICON = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    print(json.dumps(payload["stats"], ensure_ascii=False))


if __name__ == "__main__":
    main()
