"""若谷问字 · AI 词库把关（构建时一次性运行，结果缓存，不在 App 运行时调用）

用法：python -I tools/ai_curate.py <原始数据目录> [words|cilin|writing|all]

走 hfsyapi.cn 中转（配置读 ~/.gpt-image/.env），产物写回原始数据目录：
  ai_words.json     每字精选组词（覆盖词频排序结果）
  ai_synonyms.json  词林组复核 + 写作近义词组 + 孩子版解释
每批结果缓存在 ai_cache/，中断后重跑只补未完成的批次。
"""
import json
import os
import re
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_data as bd  # noqa: E402

RAW = sys.argv[1]
TASK = sys.argv[2] if len(sys.argv) > 2 else "all"
MODEL = "claude-sonnet-5"
CACHE = os.path.join(RAW, "ai_cache")
os.makedirs(CACHE, exist_ok=True)
bd.RAW = RAW

ENV = {}
with open(os.path.expanduser("~/.gpt-image/.env"), encoding="utf-8") as f:
    for line in f:
        if "=" in line and not line.startswith("#"):
            k, v = line.strip().split("=", 1)
            ENV[k] = v.strip().strip('"')

AUDIENCE = (
    "使用者是一个 7 岁半、读小学二年级的中国男孩，在 iPad 上查字，用来写作文。"
    "所有词必须是这个年龄的孩子在作文、课文、日常生活里会用到或该学的，"
    "坚决去掉：男女情爱/性暗示（如艳遇、艳福、妖艳）、暴力血腥、政治军事、人名地名机构名、网络流行语、"
    "生僻文言、专业术语、贬损他人的词。"
)


def chat(prompt, retries=4):
    body = json.dumps({
        "model": MODEL,
        "temperature": 0.2,
        "messages": [
            {"role": "system", "content": "你是小学语文老师兼词典编辑。只输出 JSON，不要任何解释或代码块标记。"},
            {"role": "user", "content": prompt},
        ],
    }).encode("utf-8")
    req = urllib.request.Request(
        ENV["OPENAI_BASE_URL"].rstrip("/") + "/chat/completions",
        data=body,
        headers={"Authorization": "Bearer " + ENV["OPENAI_API_KEY"], "Content-Type": "application/json"},
    )
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=240) as resp:
                text = json.load(resp)["choices"][0]["message"]["content"]
            text = re.sub(r"^```(?:json)?|```$", "", text.strip()).strip()
            return json.loads(text)
        except Exception as exc:  # 网络抖动或 JSON 不完整：退避重试
            if attempt == retries - 1:
                raise
            print("  retry:", exc)
            time.sleep(5 * (attempt + 1))


def cached(name, fn):
    path = os.path.join(CACHE, name + ".json")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    result = fn()
    with open(path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)
    return result


def run_batches(jobs, workers=6):
    with ThreadPoolExecutor(workers) as pool:
        done = 0
        results = []
        for result in pool.map(lambda job: cached(job[0], job[1]), jobs):
            results.append(result)
            done += 1
            if done % 10 == 0 or done == len(jobs):
                print(f"  {done}/{len(jobs)}")
        return results


# ---------- 1. 每字组词 ----------
def curate_words(chars, charset, freq, pos, textbook):
    bd.WORDS_PER_CHAR = 25
    candidates, _ = bd.build_words(chars, freq, pos, textbook)
    batches = [chars[i:i + 40] for i in range(0, len(chars), 40)]

    def job(index, batch):
        lines = "\n".join(f"{ch}：{'、'.join(candidates[ch]) or '（无候选）'}" for ch in batch)
        prompt = (
            AUDIENCE + "\n\n下面每行是一个汉字和它的候选组词（按词频）。请为每个字选出最多 10 个最适合这个孩子的常用词，"
            "按「写作文最常用」排序。候选里没有但非常常用的词可以补上（必须含这个字、2~4 个字）。"
            "如果这个字本身很少用（文言字、姓氏字等），给 2~4 个最常见的即可。\n"
            '输出 JSON 对象：{"字": ["词1", "词2", ...], ...}，每个字都要有。\n\n' + lines
        )
        return (f"words_{index:03d}", lambda: chat(prompt))

    results = run_batches([job(i, b) for i, b in enumerate(batches)])
    picked, rejected = {}, 0
    for result in results:
        for ch, words in result.items():
            if ch not in charset:
                continue
            clean = []
            for w in words:
                if ch in w and 2 <= len(w) <= 4 and all(c in charset for c in w) and w not in clean:
                    clean.append(w)
                else:
                    rejected += 1
            picked[ch] = clean[:10]
    missing = [ch for ch in chars if ch not in picked]
    print(f"words: {len(picked)} chars curated, {rejected} words rejected by validation, missing {len(missing)}")
    with open(os.path.join(RAW, "ai_words.json"), "w", encoding="utf-8") as f:
        json.dump(picked, f, ensure_ascii=False)


# ---------- 2. 词林复核 ----------
def review_cilin(charset, freq):
    groups = bd.build_synonyms(freq, charset)
    batches = [groups[i:i + 40] for i in range(0, len(groups), 40)]

    def job(index, batch):
        lines = "\n".join(f"{g['code']}：{'、'.join(g['words'])}" for g in batch)
        prompt = (
            AUDIENCE + "\n\n下面是同义词词林里的同义词组（编号：词）。请逐组复核：去掉不适合孩子的词、"
            "去掉意思其实不相近的词，按孩子写作文最常用排序。整组都不适合或去完少于 2 个词，就给空数组。\n"
            '输出 JSON 对象：{"编号": ["词1", ...], ...}，每个编号都要有。\n\n' + lines
        )
        return (f"cilin_{index:03d}", lambda: chat(prompt))

    reviewed = []
    for result in run_batches([job(i, b) for i, b in enumerate(batches)]):
        for code, words in result.items():
            clean = [w for w in words if all(c in charset for c in w)]
            reviewed.append({"code": code, "words": clean if len(clean) >= 2 else []})
    kept = sum(1 for g in reviewed if g["words"])
    print(f"cilin: {len(reviewed)} groups reviewed, {kept} kept")
    return reviewed


# ---------- 3. 写作近义词组 + 孩子版解释 ----------
TOPICS = [
    "颜色（红、绿、蓝、黄、白、黑、五颜六色、鲜艳、淡雅）", "光亮与明暗（明亮、闪亮、昏暗）",
    "高兴、快乐", "难过、伤心", "生气、愤怒", "害怕、紧张", "惊讶、吃惊", "着急、担心", "喜欢、爱", "后悔、不好意思、害羞",
    "晴天与阳光", "下雨", "刮风", "下雪与寒冷", "炎热", "四季景色（春夏秋冬）",
    "大的声音与安静", "人的声音（说话、喊、笑声、哭声）", "自然和动物的声音",
    "看", "说", "走、跑、跳", "拿、放、扔、抓", "吃、喝", "想、思考、记得", "笑", "哭",
    "美丽、好看", "大与小", "多与少", "快与慢", "高与矮、长与短", "干净、整齐", "热闹与冷清",
    "勇敢", "认真、专心", "聪明、机灵", "友好、善良、热情", "努力、坚持", "累与轻松",
    "花草树木的样子", "小动物的样子", "时间（很久、马上、忽然、终于）", "程度（非常、特别、十分）",
]


def writing_groups(charset):
    def job(index, topic):
        prompt = (
            AUDIENCE + f"\n\n主题：{topic}\n"
            "请给出 4~8 组这个主题下写作文常用的近义词组。每组以一个最常用的词开头，"
            "再列 3~7 个意思相近、二年级到四年级孩子能用的词。每个词配一句不超过 18 个字的孩子版解释，"
            "要点出它和同组其他词的细微区别（例如「绚丽：颜色多又亮，很耀眼」）。\n"
            '输出 JSON：{"groups": [{"head": "鲜艳", "words": ["鲜艳", "艳丽", ...], '
            '"glosses": {"鲜艳": "……", "艳丽": "……"}}]}'
        )
        return (f"writing_{index:03d}", lambda: chat(prompt))

    groups, glosses, rejected = [], {}, 0
    for topic, result in zip(TOPICS, run_batches([job(i, t) for i, t in enumerate(TOPICS)])):
        short = topic.split("（")[0]
        for g in result.get("groups", []):
            words = []
            for w in g.get("words", []):
                if 1 <= len(w) <= 4 and all(c in charset for c in w) and w not in words:
                    words.append(w)
                else:
                    rejected += 1
            if len(words) < 2:
                continue
            groups.append({"topic": short, "words": words})
            for w, gloss in g.get("glosses", {}).items():
                if w in words and w not in glosses:
                    glosses[w] = gloss
    print(f"writing: {len(groups)} groups, {len(glosses)} glosses, {rejected} words rejected")
    return groups, glosses


def main():
    chars = bd.load_chars()
    charset = set(chars)
    freq, pos = bd.load_jieba(charset)
    textbook = bd.load_textbook()
    if TASK in ("words", "all"):
        curate_words(chars, charset, freq, pos, textbook)
    if TASK in ("cilin", "writing", "all"):
        reviewed = review_cilin(charset, freq) if TASK in ("cilin", "all") else []
        writing, glosses = writing_groups(charset) if TASK in ("writing", "all") else ([], {})
        path = os.path.join(RAW, "ai_synonyms.json")
        current = json.load(open(path, encoding="utf-8")) if os.path.exists(path) else {}
        if reviewed:
            current["reviewed"] = reviewed
        if writing:
            current["writing_groups"] = writing
            current["glosses"] = glosses
        with open(path, "w", encoding="utf-8") as f:
            json.dump(current, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
