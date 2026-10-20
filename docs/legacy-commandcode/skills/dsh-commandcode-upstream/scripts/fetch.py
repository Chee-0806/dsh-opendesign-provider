#!/usr/bin/env python3
"""Fetch public evidence into a NEW directory; no credentials or package execution."""
import argparse
import base64
import concurrent.futures
import datetime as dt
import hashlib
import io
import json
from pathlib import Path
import re
import tarfile
import time
import urllib.request

URLS = {
    'npm': 'https://registry.npmjs.org/command-code/latest',
    # The default view is the OpenAI-shaped model list the plugin routes on.
    'catalog': 'https://api.commandcode.ai/provider/v1/models',
    # `?view=client` is the richer view the CLI itself consumes from
    # command-code@1.82.4: it adds `reasoningEfforts`, `zdr`, `inputModalities`,
    # `minimumPlan`, `pricing`, `aliases` and `hidden`, and it is the only
    # authoritative source for effort/ZDR/vision once the CLI stops bundling
    # those tables. Both views are fetched because they disagree (100 vs 92
    # models, and the extra rows are the hidden ones).
    'catalog-client': 'https://api.commandcode.ai/provider/v1/models?view=client',
    'models': 'https://commandcode.ai/docs/reference/cli/models',
    'pricing': 'https://commandcode.ai/docs/resources/pricing-limits',
    **{p: f'https://commandcode.ai/docs/plans/{p}' for p in ('go', 'goat', 'pro', 'max')},
    'provider': 'https://commandcode.ai/docs/provider',
    'zdr': 'https://commandcode.ai/docs/resources/zdr',
    'changelog': 'https://commandcode.ai/changelog',
    'whats-new': 'https://commandcode.ai/docs/whats-new',
}


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def download(url):
    last = None
    for attempt in range(3):
        try:
            request = urllib.request.Request(url, headers={'User-Agent': 'CommandCode-upstream-audit/1', 'Cache-Control': 'no-cache'})
            with urllib.request.urlopen(request, timeout=30) as response:
                body = response.read(25_000_001)
                if len(body) > 25_000_000:
                    raise ValueError('Response exceeds 25 MB limit')
                return body, {'url': url, 'finalUrl': response.url, 'status': response.status,
                              'fetchedAt': now(), 'contentType': response.headers.get('Content-Type'),
                              'etag': response.headers.get('ETag'), 'lastModified': response.headers.get('Last-Modified'),
                              'sha256': hashlib.sha256(body).hexdigest(), 'bytes': len(body)}
        except Exception as error:
            last = error
            if attempt < 2:
                time.sleep(attempt + 1)
    raise RuntimeError(str(last))


def fetch_source(item, output):
    key, url = item
    try:
        body, record = download(url)
        filename = key + ('.json' if key in ('npm', 'catalog', 'catalog-client') else '.html')
        (output / filename).write_bytes(body)
        return key, {**record, 'file': filename, 'ok': True}
    except Exception as error:
        return key, {'url': url, 'fetchedAt': now(), 'ok': False, 'error': str(error)}


def fetch_cli(metadata, output, prefix):
    url = metadata['dist']['tarball']
    if not url.startswith('https://registry.npmjs.org/command-code/-/'):
        raise ValueError('Unexpected tarball origin/path')
    body, record = download(url)
    expected = metadata['dist']['integrity']
    actual = 'sha512-' + base64.b64encode(hashlib.sha512(body).digest()).decode()
    if expected != actual:
        raise ValueError('Tarball SHA-512 integrity mismatch or unsupported integrity format')
    with tarfile.open(fileobj=io.BytesIO(body), mode='r:gz') as archive:
        member = archive.getmember('package/dist/cli.mjs')
        if not member.isfile() or member.size > 25_000_000:
            raise ValueError('Invalid CLI archive member')
        cli = archive.extractfile(member).read()
    filename = prefix + '.mjs'
    (output / filename).write_bytes(cli)
    return {**record, 'file': filename, 'sha256': hashlib.sha256(cli).hexdigest(),
            'archiveSha256': record['sha256'], 'archiveBytes': record['bytes'], 'bytes': len(cli),
            'integrity': expected, 'version': metadata['version'], 'ok': True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', required=True, type=Path, help='New evidence directory (must not exist)')
    parser.add_argument('--repo', type=Path, default=Path.cwd())
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=False)
    manifest = {'schemaVersion': 1, 'startedAt': now(), 'sources': {}}
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
        for key, record in executor.map(lambda item: fetch_source(item, args.out), URLS.items()):
            manifest['sources'][key] = record
            print(f'{key}: {"ok" if record["ok"] else record["error"]}', flush=True)
    try:
        metadata = json.loads((args.out / 'npm.json').read_text())
        manifest['sources']['cli'] = fetch_cli(metadata, args.out, 'cli')
        local = re.search(r"COMMAND_CODE_CLI_VERSION\s*=\s*['\"]([^'\"]+)", (args.repo / 'src/adapter.ts').read_text())
        if not local:
            raise ValueError('Local version constant not found')
        manifest['localVersion'] = local[1]
        if local[1] != metadata['version']:
            if not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?', local[1]):
                raise ValueError('Unexpected local version syntax')
            old, record = download('https://registry.npmjs.org/command-code/' + local[1])
            (args.out / 'baseline-npm.json').write_bytes(old)
            manifest['sources']['baseline-npm'] = {**record, 'file': 'baseline-npm.json', 'ok': True}
            manifest['sources']['baseline-cli'] = fetch_cli(json.loads(old), args.out, 'baseline-cli')
    except Exception as error:
        manifest['errors'] = [str(error)]
    manifest['finishedAt'] = now()
    (args.out / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    raise SystemExit(2 if manifest.get('errors') or any(not r['ok'] for r in manifest['sources'].values()) else 0)


if __name__ == '__main__':
    main()
