#!/usr/bin/env python3
"""Stage only reviewed application source for the local HA preview add-on."""
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
import tarfile


ROOT = Path(__file__).resolve().parent.parent
FILES = (
    '.dockerignore', 'Dockerfile', 'config.yaml',
    'backend/__init__.py', 'backend/app.py', 'backend/database.py',
    'backend/demo.py', 'backend/models.py', 'backend/requirements.txt',
    'backend/income.py', 'backend/annual_income.py', 'backend/categories.py', 'backend/item_details.py',
    'backend/simplefin.py', 'backend/accounts.py', 'backend/categorization.py',
    'backend/student_loans.py',
    'backend/bank_handlers.py',
    'frontend/index.html', 'frontend/package.json', 'frontend/package-lock.json',
    'frontend/vite.config.js',
    'scripts/run.sh', 'scripts/launch.py',
    'README.md', 'home-assistant/README.md', 'home-assistant/rest-sensors.yaml',
)


def main():
    files = set(FILES) | {
        str(path.relative_to(ROOT)) for path in (ROOT / 'frontend' / 'src').rglob('*')
        if path.is_file() and path.suffix in {'.js', '.jsx', '.css'}
    }
    destination = ROOT / 'artifacts' / 'ha-preview'
    destination.mkdir(parents=True, exist_ok=True)
    unexpected = {str(path.relative_to(destination)) for path in destination.rglob('*') if path.is_file()} - files
    if unexpected:
        raise SystemExit('Refusing to stage over unexpected files: ' + ', '.join(sorted(unexpected)))
    records = []
    for name in sorted(files):
        source = ROOT / name
        if not source.is_file() or source.is_symlink():
            raise SystemExit('Missing or symlinked source: ' + name)
        content = source.read_bytes()
        if name == 'config.yaml':
            content = content.replace(b'name: Budget Assistant\n', b'name: Budget Assistant (Preview)\n', 1)
            content = content.replace(b'panel_title: Budget Assistant\n', b'panel_title: Budget Preview\n', 1)
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
        target.chmod(0o755 if name == 'scripts/run.sh' else 0o644)
        records.append({'path': name, 'sha256': hashlib.sha256(content).hexdigest(), 'size': len(content)})
    import_count = 0
    patterns = (r'''\bfrom\s*['"](\.{1,2}/[^'"]+)['"]''',
                r'''\bimport\s*['"](\.{1,2}/[^'"]+)['"]''',
                r'''\bimport\s*\(\s*['"](\.{1,2}/[^'"]+)['"]''')
    for record in records:
        if Path(record['path']).suffix not in {'.js', '.jsx'}:
            continue
        staged = destination / record['path']
        references = {match for pattern in patterns for match in re.findall(pattern, staged.read_text())}
        for reference in references:
            candidate = (staged.parent / reference).resolve()
            options = [candidate] + [Path(str(candidate) + suffix) for suffix in ('.js', '.jsx', '.css')] + [candidate / 'index.js', candidate / 'index.jsx']
            if not any(option.is_relative_to(destination.resolve()) and option.is_file() for option in options):
                raise SystemExit(f"Unresolved relative import: {record['path']} -> {reference}")
            import_count += 1
    source_hash = hashlib.sha256(''.join(f"{record['sha256']}  {record['path']}\n" for record in records).encode()).hexdigest()
    archive = ROOT / 'artifacts' / 'budget-assistant-ha-preview.tar.gz'
    with archive.open('wb') as raw, gzip.GzipFile(fileobj=raw, mode='wb', filename='', mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode='w') as output:
            for record in records:
                content = (destination / record['path']).read_bytes()
                info = tarfile.TarInfo(record['path'])
                info.size = len(content)
                info.mode = 0o755 if record['path'] == 'scripts/run.sh' else 0o644
                info.mtime = info.uid = info.gid = 0
                output.addfile(info, io.BytesIO(content))
    manifest = {
        'name': 'Budget Assistant (Preview)', 'panel_title': 'Budget Preview',
        'version': re.search(r'^version: [\"\']?([^\"\'\n]+)', (destination / 'config.yaml').read_text(), re.M).group(1),
        'slug': 'budget_assistant', 'installed_slug': 'local_budget_assistant',
        'source_sha256': source_hash,
        'source_hash_format': 'SHA256 of sorted lines: <file SHA256> two spaces <relative path> newline',
        'archive': archive.name,
        'archive_sha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
        'file_count': len(records), 'validated_relative_imports': import_count, 'files': records,
    }
    (ROOT / 'artifacts' / 'ha-preview-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps({key: value for key, value in manifest.items() if key != 'files'}, indent=2))


if __name__ == '__main__':
    main()
