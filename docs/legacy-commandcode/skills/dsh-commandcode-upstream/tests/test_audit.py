import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
import audit
import fetch


def flight(value, split=False):
    raw = 'a:' + json.dumps(value)
    chunks = [raw[:len(raw)//2], raw[len(raw)//2:]] if split else [raw]
    return ''.join('<script>self.__next_f.push(' + json.dumps([1, c]) + ')</script>' for c in chunks)


def model(**extra):
    return {'id': 'sample', 'name': 'Sample', 'availability': {'individual-go': True}, **extra}


# The full tier ladder as the pricing page embeds it since the 2026-09-30
# reformat: `individual-ultra` above max, and the `-v1` variants beside their base.
FULL_TIERS = dict.fromkeys(
    ['individual-go', 'individual-go-v1', 'individual-goat', 'individual-pro',
     'individual-pro-v1', 'individual-provider', 'individual-max', 'individual-ultra'],
    True,
)


class AuditTests(unittest.TestCase):
    def test_split_flight_and_braces_in_strings(self):
        rows, conflicts = audit.page_models(flight({'models': [model(note='a } [ " quoted')]}, split=True))
        self.assertEqual(rows['sample']['note'], 'a } [ " quoted')
        self.assertEqual(conflicts, [])

    def test_duplicate_fields_reported_without_losing_extra_fields(self):
        rows, conflicts = audit.page_models(flight([model(caps={'vision': True}), model(caps={'vision': False}, deprecated=True)]))
        self.assertTrue(rows['sample']['deprecated'])
        self.assertEqual(conflicts[0]['field'], 'caps')

    def test_empty_or_challenge_html_is_not_success(self):
        with self.assertRaises(ValueError):
            audit.page_models('<html>Please enable JavaScript</html>')

    def test_undefined_is_preserved_not_truthy_flag(self):
        rows, _ = audit.page_models(flight([model(timeOfDay='$undefined')]))
        self.assertNotIsInstance(rows['sample']['timeOfDay'], dict)

    def test_unresolved_references_are_visible(self):
        refs = list(audit.unresolved_references({'deal': '$abc:props:deal', 'timeOfDay': '$undefined'}))
        self.assertEqual(refs, [{'path': '/deal', 'reference': '$abc:props:deal'}])

    def test_registry_reads_own_row_label(self):
        html = '<table><tr><td><code>a</code></td><td><button aria-label="Capabilities: Text input, Vision"></button></td></tr><tr><td><code>b</code></td><td><button aria-label="Capabilities: Text input"></button></td></tr></table>'
        self.assertEqual(audit.registry_vision(html), {'a': True, 'b': False})

    def test_zdr_docs_mechanism_evidence(self):
        evidence = audit.zdr_docs_evidence(flight({'note': 'send x-cmd-zdr: 1; a refusal is 422 (cmd_zdr_no_providers); the CLI switch is CMD_ZDR=1'}))
        self.assertEqual(evidence['header'], 'x-cmd-zdr: 1')
        self.assertEqual(evidence['failureCode'], 'cmd_zdr_no_providers')

    def test_zdr_docs_restructured_page_is_not_success(self):
        with self.assertRaisesRegex(ValueError, 'mechanism evidence'):
            audit.zdr_docs_evidence(flight({'note': 'retention moved to a new page'}))

    def test_missing_registry_labels_fail(self):
        with self.assertRaises(ValueError):
            audit.registry_vision('<table><tr><code>a</code></tr></table>')

    def test_ambiguous_names_remain_candidates(self):
        docs = {'first': {'name': 'Shared'}, 'second': {'name': 'Shared'}}
        candidates, method = audit.match({'id': 'provider/new', 'name': 'Shared'}, docs, {})
        self.assertEqual(candidates, ['first', 'second'])
        self.assertEqual(method, 'candidate-needs-review')

    def test_explicit_alias_must_exist(self):
        candidates, _ = audit.match({'id': 'x', 'name': 'X'}, {'y': {}}, {'x': 'missing'})
        self.assertEqual(candidates, [])

    def test_suffix_is_not_approved_identity(self):
        self.assertEqual(audit.match({'id': 'a/x', 'name': 'X'}, {'x': {}}, {}), (['x'], 'candidate-needs-review'))

    def test_missing_plan_is_not_provider(self):
        with self.assertRaisesRegex(ValueError, 'Missing/non-boolean'):
            audit.minimum_plan({'individual-go': False})

    def test_ultra_and_v1_keys_are_required_not_silently_false(self):
        # The ladder gained `individual-ultra` (2026-09-30) and the `-v1`
        # variants (command-code@1.69.0). A page missing them must fail here
        # rather than read as "unavailable", which would fabricate a tier.
        for missing in ['individual-ultra', 'individual-go-v1', 'individual-pro-v1']:
            incomplete = FULL_TIERS.copy()
            del incomplete[missing]
            with self.assertRaisesRegex(ValueError, missing):
                audit.minimum_plan(incomplete)

    def test_max_required_before_ultra(self):
        availability = {'individual-go': False, 'individual-go-v1': False, 'individual-goat': False,
                        'individual-pro': False, 'individual-pro-v1': False, 'individual-provider': False,
                        'individual-max': True, 'individual-ultra': True}
        self.assertEqual(audit.minimum_plan(availability), 'max')

    def test_v1_variant_alone_reports_the_plan(self):
        # A model served only through a plan's `-v1` variant still belongs to
        # that plan, so its minimum tier is reported, not lost.
        availability = {'individual-go': False, 'individual-go-v1': True, 'individual-goat': True,
                        'individual-pro': True, 'individual-pro-v1': True, 'individual-provider': True,
                        'individual-max': True, 'individual-ultra': True}
        self.assertEqual(audit.minimum_plan(availability), 'go')

    def test_every_tier_false_is_no_plan(self):
        availability = {k: False for k in ['individual-go', 'individual-go-v1', 'individual-goat',
                                           'individual-pro', 'individual-pro-v1', 'individual-provider',
                                           'individual-max', 'individual-ultra']}
        self.assertIsNone(audit.minimum_plan(availability))

    def test_non_monotonic_plan_is_rejected(self):
        availability = dict.fromkeys(['individual-go', 'individual-goat', 'individual-pro', 'individual-provider', 'individual-max'], True)
        availability['individual-pro'] = False
        with self.assertRaises(ValueError):
            audit.minimum_plan(availability)

    def test_real_boolean_required(self):
        availability = dict.fromkeys(['individual-go', 'individual-goat', 'individual-pro', 'individual-provider', 'individual-max'], '$undefined')
        with self.assertRaises(ValueError):
            audit.minimum_plan(availability)

    def test_explicit_provider_tier(self):
        availability = FULL_TIERS.copy()
        availability.update({'individual-go': False, 'individual-go-v1': False, 'individual-goat': False,
                             'individual-pro': False, 'individual-pro-v1': False})
        self.assertEqual(audit.minimum_plan(availability), 'provider')

    def test_diff_includes_changes_to_existing_model(self):
        self.assertEqual(audit.diff({'x': ['high']}, {'x': ['low', 'high']}), {'x': {'before': ['high'], 'after': ['low', 'high']}})

    def test_tarball_integrity_failure_before_extraction(self):
        metadata = {'dist': {'tarball': 'https://registry.npmjs.org/command-code/-/fake.tgz', 'integrity': 'sha512-wrong'}}
        with patch.object(fetch, 'download', return_value=(b'not-a-tarball', {})):
            with self.assertRaisesRegex(ValueError, 'integrity'):
                fetch.fetch_cli(metadata, Path('/nonexistent'), 'cli')

    def test_tarball_other_origin_rejected(self):
        with self.assertRaisesRegex(ValueError, 'origin'):
            fetch.fetch_cli({'dist': {'tarball': 'https://example.com/code.tgz'}}, Path('/nonexistent'), 'cli')
    def test_changelog_reads_server_rendered_html(self):
        # The changelog is NOT a Flight page, so `flight_chunks` yields an empty
        # shell; the entries live in plain markup. A parser that assumed a
        # Markdown or JSON endpoint would silently report no releases.
        html = (
            '<html><body><div>Search</div>'
            '[ Sep 30 ] // v 1.72.0 CLI FEAT Add `cmd mods enable &amp;lt;name&amp;gt;` '
            'FEAT Add `/rc` to remote-control the session '
            '[ Sep 29 ] // v 1.71.0 CLI FEAT Add GPT-6.1 Sol '
            '[ Sep 29 ] // v 0.1.44 Desktop FEAT Add Ling 3.1 Flash'
            '</body></html>'
        )
        entries = audit.changelog_entries(html)
        self.assertEqual([e['version'] for e in entries], ['1.72.0', '1.71.0', '0.1.44'])
        self.assertEqual(entries[1]['items'], ['FEAT Add GPT-6.1 Sol'])
        self.assertEqual(entries[2]['product'], 'Desktop')

    def test_changelog_restructured_page_is_not_success(self):
        with self.assertRaisesRegex(ValueError, 'No changelog entries'):
            audit.changelog_entries('<html>Follow us on X</html>')

    def test_rendered_plan_page_rows_are_read(self):
        # Per-plan pages moved from an `availability` map to a rendered row
        # (2026-09-30); silence there used to read as "no models on this plan".
        rows, _ = audit.page_models(flight([{
            'slug': 'space-bunny-alpha', 'id': 'stealth/space-bunny-alpha', 'name': 'Space Bunny Alpha',
            'minPlanName': 'Go', 'contextWindow': 1000000,
        }]))
        self.assertEqual(rows['stealth/space-bunny-alpha']['minPlanName'], 'Go')

    def test_plan_page_without_model_rows_fails(self):
        with self.assertRaisesRegex(ValueError, 'No model rows'):
            audit.page_models('<html>Max Plans | Command Code</html>')



if __name__ == '__main__':
    unittest.main()
