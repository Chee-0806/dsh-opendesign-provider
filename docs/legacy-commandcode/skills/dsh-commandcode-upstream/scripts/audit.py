#!/usr/bin/env python3
"""Offline extraction and reconciliation. Outputs evidence, never edits plugin snapshots."""
import argparse
from collections import defaultdict
import datetime as dt
import hashlib
import html as html_module
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import subprocess


class Page(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_script = False
        self.scripts = []
        self.row = None
        self.code = False
        self.vision_rows = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'script':
            self.in_script = True
        if tag == 'tr':
            self.row = {'ids': [], 'labels': []}
        if self.row is not None:
            if tag == 'code':
                self.code = True
            if attrs.get('aria-label', '').startswith('Capabilities:'):
                self.row['labels'].append(attrs['aria-label'])

    def handle_endtag(self, tag):
        if tag == 'script':
            self.in_script = False
        if tag == 'code':
            self.code = False
        if tag == 'tr' and self.row is not None:
            if self.row['labels']:
                self.vision_rows.append(self.row)
            self.row = None

    def handle_data(self, data):
        if self.in_script:
            self.scripts.append(data)
        elif self.row is not None and self.code and data.strip():
            self.row['ids'].append(data.strip())


def walk(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from walk(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk(child)


def flight_chunks(html):
    """The decoded text of one page's Next.js Flight script chunks."""
    page = Page()
    page.feed(html)
    chunks = []
    for script in page.scripts:
        if script.startswith('self.__next_f.push('):
            payload = script[len('self.__next_f.push('):].rstrip().removesuffix(';').removesuffix(')')
            envelope = json.loads(payload)
            if len(envelope) > 1 and isinstance(envelope[1], str):
                chunks.append(envelope[1])
        elif script.lstrip().startswith(('{', '[')):
            chunks.append(script)
    return ''.join(chunks)


def page_models(html):
    """A page's model rows: `{id: row}` plus the merge conflicts found.

    Two shapes carry model rows and they changed over: the pricing/limits page
    still embeds an `availability` map of booleans, while the per-plan pages
    (`/docs/plans/go|goat|pro`) replaced it with a RENDERED row carrying
    `minPlanName` and `slug`/`vendor` (2026-09-30 reformat). Both are accepted
    here so a page rewrite is a loud failure instead of reading as "this plan
    serves no models" — which would otherwise be indistinguishable from a real
    empty plan.
    """
    # Flight records may span multiple script chunks. Decode JSON containers,
    # not regex object boundaries; unresolved references remain visible to validation.
    data = flight_chunks(html)
    decoder = json.JSONDecoder()
    objects = []
    i = 0
    while i < len(data):
        if data[i] in '[{':
            try:
                obj, size = decoder.raw_decode(data[i:])
                objects.extend(walk(obj))
                i += size
                continue
            except ValueError:
                pass
        i += 1
    rows = defaultdict(list)
    for obj in objects:
        availability = isinstance(obj.get('id'), str) and isinstance(obj.get('availability'), dict)
        rendered = isinstance(obj.get('id'), str) and isinstance(obj.get('minPlanName'), str) and 'contextWindow' in obj
        if availability or rendered:
            rows[obj['id']].append(obj)
    merged, conflicts = {}, []
    for model_id, entries in rows.items():
        row = {}
        for entry in entries:
            for key, value in entry.items():
                if key in row and row[key] != value:
                    conflicts.append({'id': model_id, 'field': key, 'values': [row[key], value]})
                row[key] = value
        merged[model_id] = row
    if not merged:
        raise ValueError('No model rows extracted; page format may have changed')
    return merged, conflicts


ZDR_DOCS_MARKERS = ('x-cmd-zdr', 'cmd_zdr_no_providers', 'CMD_ZDR')

# Plan/doc pages that embed NO model rows. `/docs/plans/max` dropped its table
# and `/docs/plans/provider` became the Provider API reference in the
# 2026-09-30 reformat; both still 200. They are recorded here so silence is not
# mistaken for "this plan serves nothing" nor failed as a parse error, and so the
# check SHOUTS if either starts carrying rows again (the plan cross-check would
# then be stale).
NO_MODEL_ROWS = ('max', 'provider')


def zdr_docs_evidence(html):
    """The ZDR docs page must still document the mechanism the plugin sends.

    The per-model exception list comes from the CLI (a static table), but the
    ROUTING RULE — what the header does, and that a request without a
    ZDR-capable upstream fails instead of falling back — is prose only. If the
    page is restructured or the markers move, this fails loudly instead of
    reporting "checked".
    """
    data = flight_chunks(html)
    missing = [marker for marker in ZDR_DOCS_MARKERS if marker not in data]
    if missing:
        raise ValueError('ZDR docs missing mechanism evidence: ' + ', '.join(missing))
    return {'header': 'x-cmd-zdr: 1', 'failureCode': 'cmd_zdr_no_providers', 'cliSwitch': 'CMD_ZDR=1'}


def registry_vision(html):
    page = Page()
    page.feed(html)
    result = {}
    for row in page.vision_rows:
        if len(row['ids']) != 1 or len(row['labels']) != 1:
            raise ValueError('Ambiguous capability registry row')
        model_id = row['ids'][0]
        if model_id in result:
            raise ValueError('Duplicate capability registry ID: ' + model_id)
        result[model_id] = 'Vision' in row['labels'][0]
    if not result:
        raise ValueError('No capability registry rows extracted')
    return result


def stripped_text(html):
    """Visible text of a server-rendered page, with scripts and tags removed."""
    text = re.sub(r'<(script|style)\b.*?</\1>', ' ', html, flags=re.S | re.I)
    return html_module.unescape(re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', text))).strip()


def changelog_entries(html):
    """Version → its bullet lines, read straight out of the rendered HTML.

    The changelog is NOT a Flight page: its content is server-rendered, so
    `flight_chunks()` yields an empty shell while the plain markup carries every
    release. Strip tags and parse instead of assuming a Markdown/JSON endpoint.

    Shape is `[ Sep 30 ] // v 1.72.0 CLI FEAT ...` — a date marker, then a
    version marker, then the entries until the next version marker. The version
    comparison (npm latest vs pinned) is what says WHETHER to read this; these
    entries say WHAT shipped. A is-required check reads it even when the version
    has not moved, because the catalog and docs move independently of the CLI.
    """
    text = stripped_text(html)
    pattern = re.compile(r'\[ ([A-Z][a-z]{2} \d{1,2}) \] // (v?\s*[\d.]+\w*)\s+(CLI|Desktop|Pre-release)?\s*(.*?)(?=\[ [A-Z][a-z]{2} \d{1,2} \] // v?\s*[\d.]|\Z)')
    entries = []
    for match_result in pattern.finditer(text):
        entries.append({
            'date': match_result.group(1),
            # Version carries the page's own "v " prefix; normalize at the source
            # so every consumer compares against npm's bare form.
            'version': match_result.group(2).strip().lstrip('v').strip(),
            'product': match_result.group(3) or '',
            'items': [line.strip() for line in re.split(r'(?<=[a-z\)])\s+(?=FEAT\b|FIX\b)', match_result.group(4)) if line.strip()][:40],
        })
    if not entries:
        raise ValueError('No changelog entries extracted; page format may have changed')
    return entries


def match(model, docs, aliases):
    model_id = model['id']
    if model_id in aliases:
        target = aliases[model_id]
        return ([target] if target in docs else []), 'explicit-alias'
    if model_id in docs:
        return [model_id], 'exact-id'
    candidates = [key for key, row in docs.items() if key == model_id.split('/')[-1]
                  or (row.get('name') and row['name'].casefold() == model['name'].casefold())]
    return sorted(set(candidates)), 'candidate-needs-review'


def minimum_plan(availability):
    """The lowest tier that serves the model, or None when no tier does.

    The ladder grew twice: `individual-ultra` appeared above max (2026-09-30),
    and `-v1` variants (`individual-go-v1`, `individual-pro-v1`) beside their
    base tier without replacing it. Both are listed so the check fails loudly
    on a NEW key rather than silently reading it as "false" — availability absent
    and availability false are different statements, and only the first is "unknown".

    Variant keys rank with their base: they are billing variants of one plan
    (command-code@1.69.0 moved Go to per-model credits), so a model available on
    only ONE of `individual-go` / `individual-go-v1` is reported rather than
    averaged into either answer.
    """
    ladder = ('go', 'go-v1', 'goat', 'pro', 'pro-v1', 'provider', 'max', 'ultra')
    keys = ['individual-' + tier for tier in ladder]
    # Key-groups whose members all mean "this plan": a base tier and its -v1.
    for tier in keys:
        value = availability.get(tier)
        if type(value) is not bool:
            raise ValueError(f'Missing/non-boolean tier availability: {tier}')
    order = ['go', 'go-v1', 'goat', 'pro', 'pro-v1', 'provider', 'max', 'ultra']
    flags = [availability['individual-' + tier] for tier in order]
    if any(flags[i] and not flags[i + 1] for i in range(len(flags) - 1)):
        raise ValueError('Non-monotonic availability; cannot represent as minimum tier')
    tier_names = ['go', 'go', 'goat', 'pro', 'pro', 'provider', 'max', 'ultra']
    return next((tier for tier, flag in zip(tier_names, flags) if flag), None)


def diff(before, after):
    return {key: {'before': before.get(key), 'after': after.get(key)}
            for key in sorted(before.keys() | after.keys()) if before.get(key) != after.get(key)}


def unresolved_references(value, at=''):
    if isinstance(value, str) and value.startswith('$') and value != '$undefined':
        yield {'path': at, 'reference': value}
    elif isinstance(value, dict):
        for key, child in value.items():
            yield from unresolved_references(child, at + '/' + key)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from unresolved_references(child, at + '/' + str(index))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--repo', type=Path, default=Path.cwd())
    parser.add_argument('--aliases', type=Path, help='Reviewed JSON mapping: catalog ID -> pricing-page ID')
    args = parser.parse_args()
    report = {'schemaVersion': 1, 'auditedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
              'errors': [], 'review': [], 'sources': {}, 'protocol': 'not-verified', 'readyToApply': False}
    data = {}
    try:
        manifest = json.loads((args.input / 'manifest.json').read_text())
        report['sources'] = manifest['sources']
        report['errors'].extend(manifest.get('errors', []))
        # `catalog-client` is OPTIONAL: evidence directories collected before
        # 2026-10-16 have only the default view, and audit still runs on them
        # (the capability columns then come from the CLI artifact alone). It is
        # read last because its absence is reported as a review item, not an error.
        for key in ['npm', 'catalog', 'models', 'pricing', 'go', 'goat', 'pro', 'max', 'provider', 'zdr', 'changelog', 'whats-new', 'cli', 'catalog-client']:
            record = manifest['sources'].get(key, {})
            if not record.get('ok'):
                if key == 'catalog-client':
                    continue
                report['errors'].append(f'{key}: fetch missing/failed')
                continue
            file = (args.input / record['file']).resolve()
            if not file.is_relative_to(args.input.resolve()):
                raise ValueError('Evidence file escapes input directory')
            body = file.read_bytes()
            if hashlib.sha256(body).hexdigest() != record['sha256']:
                report['errors'].append(f'{key}: evidence checksum mismatch')
                continue
            data[key] = body.decode('utf-8')
        if 'npm' in data:
            report['latestVersion'] = json.loads(data['npm'])['version']
        local = re.search(r"COMMAND_CODE_CLI_VERSION\s*=\s*['\"]([^'\"]+)", (args.repo / 'src/adapter.ts').read_text())
        report['localVersion'] = local[1] if local else None
        aliases = json.loads(args.aliases.read_text()) if args.aliases else {}
        if not isinstance(aliases, dict) or any(not isinstance(k, str) or not isinstance(v, str) for k, v in aliases.items()):
            raise ValueError('Aliases must be an object of string pairs')
        docs, conflicts = page_models(data['pricing'])
        report['review'].extend({'pricingConflict': c} for c in conflicts)
        report['zdrDocs'] = zdr_docs_evidence(data['zdr'])
        # The per-plan pages cross-check the pricing page's availability. Since
        # the 2026-09-30 reformat the Max page and the Provider page (now titled
        # "Provider API") embed no model rows at all, so their silence is
        # recorded rather than parsed — see NO_MODEL_ROWS.
        if 'go' in data:
            go, go_conflicts = page_models(data['go'])
            report['review'].extend({'goConflict': c} for c in go_conflicts)
            cross = diff(docs, go)
            if cross:
                report['review'].append({'pricingVsGo': cross})
        page_shapes = {}
        for key in NO_MODEL_ROWS:
            if key not in data:
                continue
            try:
                rows = page_models(data[key])
            except ValueError:
                page_shapes[key] = 'no-model-rows'  # expected: see NO_MODEL_ROWS
            else:
                page_shapes[key] = f'rows:{len(rows)}'
                report['review'].append({'id': key, 'pageShapeChanged': 'now carries model rows; reinstate the plan cross-check'})
        report['planPages'] = page_shapes
        # Changelog is read INDEPENDENTLY of the version comparison: the catalog
        # and plan pages move without a CLI release, so "version unchanged" never
        # means "nothing to review". A broken parse is an error, not an absent
        # field. What's New carries its own (changeless) shape, so it is kept as
        # raw prose for the reviewer rather than forced through this parser.
        for key in ['changelog', 'whats-new']:
            if key not in data:
                continue
            try:
                report[key] = changelog_entries(data[key])
            except ValueError as error:
                if key == 'changelog':
                    report['errors'].append(f'{key}: {error}')
                else:
                    report['review'].append({
                        'id': key,
                        'note': f'{error}; kept as raw prose below — read it for FEAT lines the changelog omits',
                        'text': stripped_text(data[key])[:4000],
                    })
        if 'changelog' in report and report.get('latestVersion'):
            newest = report['changelog'][0]
            if newest['version'].lstrip('v') != report['latestVersion']:
                report['review'].append({
                    'id': 'changelog',
                    'newestListed': newest['version'],
                    'npmLatest': report['latestVersion'],
                    'reason': 'The newest changelog entry differs from npm latest; confirm which the pinned artifact comes from',
                })
        vision = registry_vision(data['models'])

        def catalog_rows(key):
            """Validate one catalog view and return its model rows."""
            raw = json.loads(data[key])
            rows = raw['data'] if isinstance(raw, dict) else raw
            if not isinstance(rows, list) or not rows or any(
                not isinstance(m.get('id'), str)
                or not isinstance(m.get('name'), str)
                or not isinstance(m.get('context_length'), (int, float))
                or m['context_length'] <= 0
                for m in rows
            ):
                raise ValueError(f'Invalid/empty catalog ({key})')
            if len({m['id'] for m in rows}) != len(rows):
                raise ValueError(f'Duplicate catalog IDs ({key})')
            return raw, rows

        # From command-code@1.82.4 the capability fields the plugin's snapshots
        # mirror (`reasoningEfforts`, `zdr`, `inputModalities`, `minimumPlan`) live
        # ONLY in the `?view=client` view; the default view is the OpenAI-shaped
        # routing list. So the client view is authoritative for capabilities and
        # the default one still supplies the routed model list. Both are read and
        # their disagreement is reported, because neither is a superset by design:
        # the client view carries hidden rows the default one omits, and a release
        # could add a routed model before the client view serves it.
        catalog_raw, catalog = catalog_rows('catalog')
        if 'catalog-client' in data:
            client_raw, client_rows = catalog_rows('catalog-client')
            default_ids, client_ids = {m['id'] for m in catalog}, {m['id'] for m in client_rows}
            report['catalogViews'] = {
                'default': {'modelCount': len(catalog), 'catalogVersion': catalog_raw.get('catalogVersion')},
                'client': {'modelCount': len(client_rows), 'catalogVersion': client_raw.get('catalogVersion')},
                'onlyDefault': sorted(default_ids - client_ids),
                'onlyClient': sorted(client_ids - default_ids),
            }
            if report['catalogViews']['onlyDefault'] or report['catalogViews']['onlyClient']:
                report['review'].append({
                    'catalogViewDrift': {
                        'onlyDefault': report['catalogViews']['onlyDefault'],
                        'onlyClient': report['catalogViews']['onlyClient'],
                        'note': 'The two catalog views disagree; confirm which rows are served before changing a snapshot',
                    },
                })
            # `catalog` stays the DEFAULT view on purpose: it is the routed model
            # list the pricing tables and the plugin's plan snapshot are keyed by,
            # so widening it would report "missing pricing mapping" for every
            # hidden row. The client view is consulted only for capabilities
            # (`catalog_capabilities`), where its extra hidden rows are wanted.
            catalog_capabilities = {}
            for m in catalog:
                catalog_capabilities[m['id']] = m
            for m in client_rows:
                catalog_capabilities[m['id']] = {**catalog_capabilities.get(m['id'], {}), **m}
        else:
            catalog_capabilities = {m['id']: m for m in catalog}
            report['review'].append({
                'catalogClientMissing': 'fetched without ?view=client, so effort/zdr/inputModalities/minimumPlan have no authoritative source; rerun fetch.py to collect it',
            })
        extractor = Path(__file__).with_name('extract-cli.mjs')
        command = ['node', str(extractor), str((args.input / manifest['sources']['cli']['file']).resolve()), str(args.repo.resolve())]
        cli = json.loads(subprocess.check_output(command, text=True))
        report['cli'] = cli
        for model in cli['models']:
            if 'hiddenExpression' in model:
                report['review'].append({'id': model['id'], 'dynamicVisibility': model['hiddenExpression']})
        if manifest['sources']['cli'].get('version') != report.get('latestVersion'):
            raise ValueError('CLI version differs from npm metadata')
        if 'baseline-cli' in manifest['sources']:
            baseline = manifest['sources']['baseline-cli']
            old_file = (args.input / baseline['file']).resolve()
            if not old_file.is_relative_to(args.input.resolve()) or hashlib.sha256(old_file.read_bytes()).hexdigest() != baseline['sha256']:
                raise ValueError('Baseline evidence checksum/path mismatch')
            old = json.loads(subprocess.check_output(['node', str(extractor), str(old_file), str(args.repo.resolve())], text=True))
            report['cliDiff'] = {key: diff(old[key], cli[key]) for key in ['efforts', 'subscriptions']}
            report['cliDiff']['zdrExceptions'] = diff({v: True for v in old['zdrExceptions']}, {v: True for v in cli['zdrExceptions']})
            report['cliDiff']['models'] = diff({m['id']: m for m in old['models']}, {m['id']: m for m in cli['models']})
        cli_models = {m['id']: m for m in cli['models']}
        # Artifact-side anomalies the extractor now reports instead of failing on.
        if cli.get('effortSource') == 'registry-rows':
            report['review'].append({
                'effortSource': 'registry-rows',
                'note': f"the CLI artifact bundles no effort Map ({cli.get('effortError')}); efforts come from the registry rows and must be confirmed against the ?view=client catalog",
            })
        for conflict in cli.get('effortConflict') or []:
            report['review'].append({'id': conflict['id'], 'effortArtifactConflict': conflict})
        # From command-code@1.82.4 the ZDR answer is a catalog lookup
        # (`resolveKnownCatalogModel(...)?.zdr ?? false`), so the artifact's own
        # exclusion sets are only part of the answer: union them with the client
        # catalog's `zdr:false` rows. Neither side is a superset — the artifact
        # keeps rows the catalog no longer serves, and the catalog serves rows the
        # embedded snapshot predates — so the union is the snapshot's membership,
        # exactly as the two CLI anchors were unioned before the migration.
        catalog_zdr = sorted(i for i, m in catalog_capabilities.items() if m.get('zdr') is False)
        if cli.get('zdrMigrated') or cli.get('zdrSource') == 'catalog':
            merged_zdr = sorted(set(cli['zdrExceptions']) | set(catalog_zdr))
            report['zdrResolution'] = {
                'artifactExceptions': cli['zdrExceptions'],
                'artifactMigratedAnchors': cli.get('zdrMigrated', []),
                'catalogZdrFalse': catalog_zdr,
                'union': merged_zdr,
            }
            for model_id in sorted(set(catalog_zdr) - set(cli['zdrExceptions'])):
                report['review'].append({
                    'id': model_id,
                    'zdrFromCatalogOnly': True,
                    'reason': 'the artifact exclusion sets do not name it but the ?view=client catalog serves zdr:false',
                })
        mapped, used = [], set()
        for model in catalog:
            model_id = model['id']
            candidates, method = match(model, docs, aliases)
            row = {'id': model_id, 'contextWindow': model['context_length'], 'mapping': method, 'candidates': candidates}
            if len(candidates) != 1:
                report['errors'].append(f'{model_id}: missing/ambiguous pricing mapping')
                mapped.append(row)
                continue
            doc_id = candidates[0]
            if doc_id in used:
                report['errors'].append(f'{model_id}: multiple catalog IDs map to {doc_id}')
            used.add(doc_id)
            doc = docs[doc_id]
            refs = list(unresolved_references(doc))
            if refs:
                report['review'].append({'id': model_id, 'unresolvedFlightReferences': refs})
            for optional in ['deal', 'timeOfDay']:
                if optional in doc and doc[optional] not in (None, '$undefined') and not isinstance(doc[optional], dict):
                    report['errors'].append(f'{model_id}: unresolved/invalid {optional}')
            if method == 'candidate-needs-review':
                report['review'].append({'id': model_id, 'aliasCandidate': doc_id})
            row['pricing'] = doc
            try:
                row['minimumPlan'] = minimum_plan(doc['availability'])
                if row['minimumPlan'] is None or row['minimumPlan'] == 'max':
                    report['review'].append({'id': model_id, 'unrepresentedPlan': row['minimumPlan']})
            except ValueError as error:
                report['errors'].append(f'{model_id}: {error}')
            registry_id = model_id if model_id in vision else doc_id if doc_id in vision else None
            if registry_id is None or type(doc.get('caps', {}).get('vision')) is not bool:
                report['errors'].append(f'{model_id}: missing vision evidence')
            else:
                row['vision'] = vision[registry_id]
                if row['vision'] != doc['caps']['vision']:
                    report['review'].append({'id': model_id, 'visionConflict': True})
            if model_id not in cli_models:
                report['errors'].append(f'{model_id}: absent from CLI registry')
            else:
                cm = cli_models[model_id]
                served = catalog_capabilities.get(model_id, {})
                # The catalog view is authoritative from 1.82.4 (it is what the
                # CLI's own `getSupportedEfforts` resolves); the artifact's
                # registry row is the cross-check.
                row['efforts'] = served.get('reasoningEfforts') if served.get('reasoningEfforts') is not None else cli['efforts'].get(model_id)
                row['automaticReasoning'] = (served.get('reasoning') is True or cm.get('reasoning') is True) and row['efforts'] is None
                artifact_efforts = cm.get('reasoningEfforts')
                catalog_efforts = served.get('reasoningEfforts')
                if catalog_efforts is not None and artifact_efforts is not None and sorted(catalog_efforts) != sorted(artifact_efforts):
                    report['review'].append({'id': model_id, 'effortConflict': {'catalog': catalog_efforts, 'registry': artifact_efforts}})
                if artifact_efforts != row['efforts'] and catalog_efforts is None:
                    report['review'].append({'id': model_id, 'effortConflict': {'registry': artifact_efforts, 'helper': row['efforts']}})
                if 'vision' in row and row['vision'] != ('image' in cm['inputModalities']):
                    report['review'].append({'id': model_id, 'cliVisionConflict': True})
            deal = doc.get('deal')
            if isinstance(deal, dict):
                report['review'].append({'id': model_id, 'dealTerms': deal, 'reason': 'Review date timezone, expiry and conditional availability before snapshot edits'})
            if isinstance(doc.get('timeOfDay'), dict):
                report['review'].append({'id': model_id, 'peakSchedule': doc['timeOfDay'], 'reason': 'Review effective date, weekday windows and price ratio'})
            if doc.get('deprecated') is True:
                report['review'].append({'id': model_id, 'deprecatedButInCatalog': True})
            mapped.append(row)
        report['models'] = mapped
        local = json.loads(subprocess.check_output(['node', str(extractor), str((args.repo / 'src/capabilities.ts').resolve()), str(args.repo.resolve()), '--local'], text=True))
        report['localSnapshots'] = local
        candidates = {
            'KNOWN_EFFORTS': {m['id']: m['efforts'] for m in mapped if m.get('efforts')},
            'KNOWN_PLANS': {m['id']: m['minimumPlan'] for m in mapped if m.get('minimumPlan')},
            'KNOWN_IMAGE_MODELS': {m['id']: True for m in mapped if m.get('vision') is True},
            'KNOWN_THINKING_MODELS': {m['id']: True for m in mapped if m.get('automaticReasoning') is True},
            'KNOWN_PEAK_PRICING': {m['id']: True for m in mapped if isinstance(m.get('pricing', {}).get('timeOfDay'), dict)},
            'KNOWN_NON_ZDR_MODELS': {v: True for v in cli['zdrExceptions']},
        }
        report['candidateDiffs'] = {key: diff({m: True for m in local[key]} if isinstance(local[key], list) else local[key], value) for key, value in candidates.items()}
        report['candidateDiffs']['KNOWN_SUBSCRIPTION_PLANS'] = diff({key: {k: v for k, v in value.items() if k != 'tierWeight'} for key, value in local['KNOWN_SUBSCRIPTION_PLANS'].items()}, cli['subscriptions'])
        report['dealEvidence'] = {m['id']: {'local': local['KNOWN_DEALS'].get(m['id']), 'upstream': m.get('pricing', {}).get('deal')} for m in mapped if m['id'] in local['KNOWN_DEALS'] or isinstance(m.get('pricing', {}).get('deal'), dict)}
        report['zdr'] = {'exceptions': cli['zdrExceptions'], 'anchorSets': cli['zdrSets'], 'anchors': cli['zdrAnchors'], 'docs': report['zdrDocs']}
        if len(cli['zdrSets']) > 1 and any(set(cli['zdrSets'][a]) != set(cli['zdrSets'][b]) for a, b in zip(cli['zdrAnchors'], cli['zdrAnchors'][1:])):
            report['review'].append({'zdrAnchorDivergence': cli['zdrSets'], 'reason': 'The CLI ZDR predicates disagree; the union is reported, review before snapshot edits'})
        report['docsOnly'] = sorted(set(docs) - used)
        report['cliOnly'] = sorted(set(cli_models) - {m['id'] for m in catalog})
        if report['docsOnly'] or report['cliOnly']:
            report['review'].append({'catalogDifferences': 'Absence is not proof of retirement; review docsOnly and cliOnly'})
        report['counts'] = {'catalog': len(catalog), 'pricing': len(docs), 'registry': len(vision), 'cli': len(cli_models), 'mapped': len(used), 'zdrExceptions': len(cli['zdrExceptions'])}
        report['coverage'] = {
            'version': 'extracted', 'catalog': 'extracted', 'efforts': 'extracted-and-compared',
            'automaticReasoning': 'extracted-and-compared', 'vision': 'cross-checked',
            'plans': 'availability-extracted; rendered-plan-review-required',
            'subscriptions': 'extracted-and-compared; tierWeight-review-required',
            'deals': 'raw-terms-extracted; expiry-review-required',
            'peakPricing': 'membership-compared; schedule-review-required',
            'zdr': 'exceptions-extracted-and-compared; docs-mechanism-checked',
            'protocol': 'manual-review-required',
        }
        report['review'].append({'manualChecks': ['Read changelog and whats-new even at same CLI version', 'Review goat/pro/max/provider rendered plan semantics', 'Review candidateDiffs; missing fields and catalog absence are NOT deletion instructions', 'Review dealEvidence and local PEAK_HOUR_RANGES against upstream terms', 'Review candidateDiffs KNOWN_NON_ZDR_MODELS against the ZDR docs page (which models lack a ZDR upstream is prose-guided: only a small handful should be affected)', 'Review protocol and browser login per references/protocol.md']})
    except Exception as error:
        report['errors'].append(f'{type(error).__name__}: {error}')
    report['status'] = 'incomplete' if report['errors'] else 'review-required'
    (args.input / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    lines = [f"Status: {report['status']}", f"Version: {report.get('localVersion')} -> {report.get('latestVersion')}",
             f"Counts: {json.dumps(report.get('counts', {}))}", f"Errors: {len(report['errors'])}; review items: {len(report['review'])}",
             'No plugin files modified; readyToApply=false; protocol not verified.', '', *report['errors']]
    (args.input / 'report.txt').write_text('\n'.join(lines) + '\n')
    print('\n'.join(lines))
    raise SystemExit(2 if report['errors'] else 0)


if __name__ == '__main__':
    main()
