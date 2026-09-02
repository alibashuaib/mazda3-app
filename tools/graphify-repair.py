"""Post-extraction repair pass for graphify on this repo.

Run between the AST/semantic extract and the graph build:
    python tools/graphify-repair.py

It rewrites graphify-out/.graphify_extract.json in place; graphify-out/ is
gitignored, so this script is the only durable part of the repair.

Fixes two extractor gaps:

1. Imports of external modules (node:test, path, @playwright/test, ...) produce
   edges whose target is never a corpus file, so they dangle. Materialise them
   as explicit "(external)" nodes.

2. graphify's JS extractor emits `function foo()` declarations but never
   `const X = ...` — neither arrow functions nor data objects, at any nesting
   depth. Every UMD module here exports via `return { ... }`, so that export
   list is the ground truth: any exported name with no node is re-added, with
   its real declaration line, verified against source before insertion.

3. The same gap in non-UMD app files, which have no export list to bound it.
   Only column-0 declarations count there — module-level state and tuning
   constants — so locals inside functions are never promoted to nodes. Tests
   and configs are left out: their top-level consts are fixtures, not design.
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'graphify-out'

EXTERNAL = {
    'ref_node_test': 'node:test', 'ref_node_assert': 'node:assert',
    'ref_node_assert_strict': 'node:assert/strict', 'ref_path': 'path',
    'ref_fs': 'fs', 'ref_os': 'os', 'ref_http': 'http', 'ref_url': 'url',
    'ref_vm': 'vm', 'ref_playwright_test': '@playwright/test',
    'ref_fake_indexeddb': 'fake-indexeddb', 'ref_linkedom': 'linkedom',
}

UMD_MODULES = [
    'src/core/async-click.js', 'src/core/helpers.js', 'src/core/schedule.js',
    'src/data/account.js', 'src/data/catalog.js', 'src/data/normalize.js',
    'src/data/session.js', 'src/data/status.js', 'src/data/storage.js',
    'src/i18n/strings.ar.js', 'src/ui/color.js', 'src/ui/html.js',
]


APP_GLOBS = ['main.js', 'src/**/*.js']

TOP_LEVEL_DECL = re.compile(r'^(const|let|var)\s+([A-Za-z_$][\w$]*)')


def norm(name):
    return re.sub(r'[^a-z0-9]', '_', name.lower())


def blank(**kw):
    node = dict(source_location=None, source_url=None, captured_at=None,
                author=None, contributor=None)
    node.update(kw)
    return node


def exported_names(text):
    """Names in the module's `return { ... }` export object.

    The UMD factory's return is the last one in the file, so take the final
    match: an earlier nested `return { id: v.id, data: split.data }` is a
    result object, not an export list.
    """
    matches = re.findall(r'\breturn\s*\{([^{}]*)\}\s*;?\s*\n?\s*\}\s*\)', text)
    if not matches:
        return []
    names = []
    for part in matches[-1].split(','):
        name = part.strip().split(':')[0].strip()
        if re.fullmatch(r'[A-Za-z_$][\w$]*', name):
            names.append(name)
    return names


def declaration_line(lines, name):
    """1-based line of `name`'s declaration in the factory body, or None.

    Indentation is capped at one level so a same-named local inside a nested
    function (`const id = ...` deep in storage.js) is never mistaken for the
    exported binding.
    """
    pat = re.compile(r'^[ \t]{0,4}(?:const|let|var|function)\s+' +
                     (rf'{re.escape(name)}\b' if name[0].isalpha() else re.escape(name)))
    for i, line in enumerate(lines, 1):
        if pat.match(line):
            return i
    return None


def main():
    ast = json.loads((OUT / '.graphify_ast.json').read_text(encoding='utf-8'))
    sem = json.loads((OUT / '.graphify_semantic.json').read_text(encoding='utf-8'))

    ast_ids = {n['id'] for n in ast['nodes']}
    nodes = list(ast['nodes']) + [n for n in sem['nodes']
                                  if not n['id'].startswith('vendor_') and n['id'] not in ast_ids]
    edges = [e for e in ast['edges'] + sem['edges']
             if not e['source'].startswith('vendor_') and not e['target'].startswith('vendor_')]
    ids = {n['id'] for n in nodes}

    added_ext = 0
    for nid, label in EXTERNAL.items():
        if nid not in ids:
            nodes.append(blank(id=nid, label=f'{label} (external)', file_type='code',
                               source_file='external'))
            ids.add(nid)
            added_ext += 1

    added_sym, skipped = 0, []
    for rel in UMD_MODULES:
        lines = (ROOT / rel).read_text(encoding='utf-8').splitlines()
        stem = re.sub(r'[^a-z0-9]', '_', rel[:-3].lower())
        for name in exported_names('\n'.join(lines)):
            nid = f'{stem}_{norm(name)}'
            if nid in ids:
                continue
            line = declaration_line(lines, name)
            if line is None:
                skipped.append(f'{rel}:{name}')
                continue
            nodes.append(blank(id=nid, label=f'{name}()', file_type='code',
                               source_file=str(ROOT / rel), source_location=f'L{line}'))
            ids.add(nid)
            added_sym += 1
            edges.append(dict(source=stem, target=nid, relation='contains',
                              confidence='EXTRACTED', confidence_score=1.0,
                              source_file=str(ROOT / rel), source_location=f'L{line}',
                              weight=1.0))

    added_app = 0
    umd = set(UMD_MODULES)
    app_files = sorted({p for g in APP_GLOBS for p in ROOT.glob(g)})
    for path in app_files:
        rel = str(path.relative_to(ROOT))
        if rel in umd:
            continue
        stem = re.sub(r'[^a-z0-9]', '_', rel[:-3].lower())
        if stem not in ids:
            continue
        for line, text in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
            m = TOP_LEVEL_DECL.match(text)
            if not m:
                continue
            name = m.group(2)
            nid = f'{stem}_{norm(name)}'
            if nid in ids:
                continue
            nodes.append(blank(id=nid, label=f'{name}()', file_type='code',
                               source_file=str(path), source_location=f'L{line}'))
            ids.add(nid)
            added_app += 1
            edges.append(dict(source=stem, target=nid, relation='contains',
                              confidence='EXTRACTED', confidence_score=1.0,
                              source_file=str(path), source_location=f'L{line}',
                              weight=1.0))

    dangling = sum(1 for e in edges for side in ('source', 'target') if e[side] not in ids)
    hyperedges = [h for h in sem.get('hyperedges', [])
                  if not any(x.startswith('vendor_') for x in h.get('nodes', []))]
    (OUT / '.graphify_extract.json').write_text(
        json.dumps(dict(nodes=nodes, edges=edges, hyperedges=hyperedges,
                        input_tokens=0, output_tokens=0), indent=2, ensure_ascii=False),
        encoding='utf-8')

    print(f'+{added_ext} external nodes, +{added_sym} missed export nodes, '
          f'+{added_app} module-level app symbols')
    if skipped:
        print(f'  no declaration found (re-exported or aliased): {", ".join(skipped)}')
    print(f'total: {len(nodes)} nodes, {len(edges)} edges | dangling: {dangling}')


if __name__ == '__main__':
    main()
