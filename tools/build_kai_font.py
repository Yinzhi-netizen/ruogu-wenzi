"""把官方霞鹜文楷 GB 1.530 压缩为网页专用楷体；不再分发安装用 TTF。
用法：python tools/build_kai_font.py <LXGWWenKaiGB-Regular.ttf> <OFL.txt>
依赖 fonttools[woff]。保留 GB2312 字符和项目所有词语用字。
"""
import hashlib
import json
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
SOURCE_SHA = "5561d48097d92e5ab99fe7b1459d381bbcdff533bfc479207b089c6860c3990e"
font_path = Path(sys.argv[1])
if hashlib.sha256(font_path.read_bytes()).hexdigest() != SOURCE_SHA:
    raise ValueError("字体校验失败：仅接受官方 1.530 Regular 文件")
font = TTFont(font_path)
codepoints = set(range(0x20, 0x7F)) | set(range(0x3000, 0x3040)) | set(range(0xFF01, 0xFF61))
for point in font.getBestCmap():
    try:
        chr(point).encode("gb2312")
        codepoints.add(point)
    except UnicodeEncodeError:
        pass
for filename in ["chars.js", "lexicon.js", "writing.js", "writing-usage.js"]:
    codepoints.update(ord(ch) for ch in (ROOT / "data" / filename).read_text(encoding="utf-8") if 0x3400 <= ord(ch) <= 0x9FFF)
options = subset.Options()
options.flavor = "woff2"
options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
subsetter = subset.Subsetter(options=options)
subsetter.populate(unicodes=codepoints)
subsetter.subset(font)
for record in font["name"].names:
    if record.nameID in {1, 3, 4, 6}:
        record.string = ("RuoguKaiWeb-Regular" if record.nameID == 6 else "Ruogu Kai Web").encode(record.getEncoding())
font.flavor = "woff2"
target = ROOT / "assets" / "fonts" / "ruogu-kai.woff2"
target.parent.mkdir(parents=True, exist_ok=True)
font.save(target)
(ROOT / "licenses" / "WenKai-OFL.txt").write_text("\n".join(line.rstrip() for line in Path(sys.argv[2]).read_text(encoding="utf-8").splitlines()) + "\n", encoding="utf-8")
print(json.dumps({"glyphs": len(font.getBestCmap()), "bytes": target.stat().st_size, "sourceSha256": SOURCE_SHA}))
