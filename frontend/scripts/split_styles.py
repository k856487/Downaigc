from pathlib import Path

src = Path(__file__).resolve().parent.parent / "src" / "styles.css"
text = src.read_text(encoding="utf-8")
lines = text.splitlines(keepends=True)


def join(ranges):
    out = []
    for a, b in ranges:
        out.extend(lines[a - 1 : b])
    return "".join(out)


tokens = join([(1, 106)])
auth_ranges = [(318, 396), (397, 804), (805, 1309), (1310, 2628)]
workbench_ranges = [(2986, 3428)]
admin_ranges = [(3821, 3958)]

auth = join(auth_ranges)
workbench = join(workbench_ranges)
admin = join(admin_ranges)

used = set()
for ranges in [auth_ranges, workbench_ranges, admin_ranges]:
    for a, b in ranges:
        for i in range(a - 1, b):
            used.add(i)
base = "".join(line for i, line in enumerate(lines) if i not in used)

styles_dir = Path(__file__).resolve().parent.parent / "src" / "styles"
styles_dir.mkdir(exist_ok=True)
(styles_dir / "tokens.css").write_text(tokens, encoding="utf-8")
(styles_dir / "base.css").write_text(base, encoding="utf-8")
(styles_dir / "auth.css").write_text(auth, encoding="utf-8")
(styles_dir / "workbench.css").write_text(workbench, encoding="utf-8")
(styles_dir / "admin.css").write_text(admin, encoding="utf-8")

src.write_text('@import "./styles/tokens.css";\n@import "./styles/base.css";\n', encoding="utf-8")
print(
    "tokens",
    len(tokens),
    "base",
    len(base),
    "auth",
    len(auth),
    "workbench",
    len(workbench),
    "admin",
    len(admin),
)
