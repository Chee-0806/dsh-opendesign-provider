// Static data extraction only: never import/eval the downloaded CLI.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

export function extract(file, repo, local = false) {
  const require = createRequire(path.join(path.resolve(repo), 'package.json'));
  const ts = require('typescript');
  const program = ts.createProgram([file], { allowJs: true, noResolve: true, target: ts.ScriptTarget.Latest });
  const source = program.getSourceFile(file);
  if (!source || source.parseDiagnostics.length) throw Error('CLI syntax parse failed');
  const checker = program.getTypeChecker();
  const bindings = new Map(), functions = new Map();
  const visit = (node, fn) => { fn(node); ts.forEachChild(node, child => visit(child, fn)); };
  const add = (name, value) => {
    const symbol = checker.getSymbolAtLocation(name);
    if (symbol && value) bindings.set(symbol, [...(bindings.get(symbol) ?? []), value]);
  };
  const named = new Map();
  const nameWrappers = [];
  visit(source, n => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) add(n.name, n.initializer);
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(n.left)) add(n.left, n.right);
    if (ts.isFunctionDeclaration(n) && n.name) functions.set(n.name.text, [...(functions.get(n.name.text) ?? []), n]);
    // `__name(fn, "semanticName")` — the bundler's name-preservation wrapper.
    // Recorded here, resolved AFTER the walk: the wrapper call sits before the
    // declaration it names, so resolving it inline would always miss.
    if (ts.isCallExpression(n) && n.expression.getText(source) === '__name' && n.arguments.length === 2) {
      const target = n.arguments[0], label = n.arguments[1];
      if (ts.isIdentifier(target) && ts.isStringLiteral(label)) nameWrappers.push({ target: target.text, label: label.text });
    }
  });
  for (const wrapper of nameWrappers) {
    // Resolve by DECLARATION, not by the binding table: a function declaration is
    // also recorded as a variable binding, so checking `bindings` first would
    // always skip this branch. Exactly one declaration with that name is the only
    // unambiguous case.
    const decls = functions.get(wrapper.target);
    if (decls?.length === 1) named.set(wrapper.label, [...(named.get(wrapper.label) ?? []), decls[0]]);
  }
  function deref(n, seen = new Set()) {
    if (ts.isAsExpression(n) || ts.isParenthesizedExpression(n) || ts.isSatisfiesExpression(n)) return deref(n.expression, seen);
    if (!ts.isIdentifier(n)) return n;
    const symbol = checker.getSymbolAtLocation(n), values = bindings.get(symbol);
    if (!values || values.length !== 1 || seen.has(symbol)) throw Error(`Unresolved/ambiguous binding: ${n.text}`);
    return deref(values[0], new Set([...seen, symbol]));
  }
  /**
   * The NODE a member access denotes (`Enum.MEMBER` / `Enum.MEMBER.id`),
   * resolved through bound object literals. Returns the member's initializer
   * node rather than its value, so a sibling field the extractor cannot
   * statically evaluate (`provider: SomeRef`) never blocks reading `id`.
   */
  function memberNode(n) {
    if (ts.isPropertyAccessExpression(n)) {
      const container = ts.isIdentifier(n.expression) ? deref(n.expression) : memberNode(n.expression);
      if (!ts.isObjectLiteralExpression(container)) throw Error(`Unsupported static member access: ${n.getText(source).slice(0, 100)}`);
      const property = container.properties.find(p => ts.isPropertyAssignment(p) && p.name?.text === n.name.text);
      if (!property) throw Error(`Missing object member: ${n.name.text}`);
      return property.initializer;
    }
    return deref(n);
  }
  function value(n) {
    n = deref(n);
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
    if (ts.isNumericLiteral(n)) return Number(n.text);
    if (n.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (n.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.ExclamationToken) return !value(n.operand);
    if (ts.isArrayLiteralExpression(n)) return n.elements.map(value);
    if (ts.isObjectLiteralExpression(n)) return Object.fromEntries(n.properties.map(p => {
      if (!ts.isPropertyAssignment(p) || !p.name.text) throw Error('Unsupported object property');
      return [p.name.text, value(p.initializer)];
    }));
    if (ts.isNewExpression(n) && n.expression.getText(source) === 'Map' && n.arguments?.length === 1) {
      const pairs = value(n.arguments[0]);
      if (pairs.some(p => !Array.isArray(p) || p.length !== 2) || new Set(pairs.map(p => p[0])).size !== pairs.length) throw Error('Invalid or duplicate Map entries');
      return Object.fromEntries(pairs);
    }
    if (ts.isNewExpression(n) && n.expression.getText(source) === 'Set' && n.arguments?.length === 1) return value(n.arguments[0]);
    if (ts.isPropertyAccessExpression(n)) return value(memberNode(n));
    throw Error(`Unsupported static expression: ${n.getText(source).slice(0, 100)}`);
  }
  /**
   * Resolve an anchor by its SEMANTIC name.
   *
   * Minified releases stop shipping the semantic name as the declaration name:
   * from command-code@1.82.4 the bundler wraps the real declaration as
   * `__name(function getSupportedEfforts2(e){…}, "getSupportedEfforts")`, so the
   * declaration is `getSupportedEfforts2` and only the wrapper's second argument
   * carries the name the rest of the bundle calls it by. Looking up the
   * declaration name alone therefore fails with a misleading
   * `Missing/ambiguous function anchor` even though the function is present.
   *
   * Three lookups, in order: the declaration name (pre-1.82.4 shape), the
   * `__name(fn, "name")` wrapper (1.82.4+ shape), then a loud failure. Both
   * shapes are kept so one extractor reads both release trains — the older one
   * is not a fallback for the newer, they are two encodings of the same fact.
   */
  function resolveAnchor(name) {
    const direct = functions.get(name);
    if (direct?.length === 1) return { node: direct[0], via: 'declaration' };
    if (direct?.length > 1) throw Error(`Ambiguous function anchor (declaration): ${name}`);
    const wrapped = named.get(name);
    if (wrapped?.length === 1) return { node: wrapped[0], via: 'name-wrapper' };
    if (wrapped?.length > 1) throw Error(`Ambiguous function anchor (name wrapper): ${name}`);
    throw Error(`Missing/ambiguous function anchor: ${name}`);
  }
  function anchor(name) {
    return resolveAnchor(name).node;
  }
  function unique(nodes, label) {
    const distinct = [...new Set(nodes.map(derefNode => deref(derefNode)))];
    if (distinct.length !== 1) throw Error(`Missing/ambiguous ${label}`);
    return distinct[0];
  }
  /**
   * The Set a predicate negates with `!SOME_SET.has(...)`, read from a named
   * function anchor. The ZDR capability predicates are exactly this shape
   * (`modelSupportsZdr(e){return !iD.has(getCanonicalModelId(e))}`), so the
   * set identity comes from the receiver of `.has` — never from a variable
   * name, which minification changes per release. The receiver may itself be
   * built from enum members (`new Set([eD.MEMBER.id, ...])`), resolved by the
   * property-access branch of `value()`.
   */
  function negatedSet(name, label) {
    const receivers = [];
    visit(anchor(name), n => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'has') receivers.push(n.expression.expression);
    });
    const distinct = [...new Set(receivers.map(r => JSON.stringify(value(deref(r)))))];
    if (distinct.length !== 1) throw Error(`Missing/ambiguous ${label}`);
    const set = JSON.parse(distinct[0]);
    if (!Array.isArray(set) || !set.length || set.some(x => typeof x !== 'string')) throw Error(`Invalid ${label}`);
    return set;
  }
  if (local) {
    const wanted = ['KNOWN_EFFORTS', 'KNOWN_IMAGE_MODELS', 'KNOWN_THINKING_MODELS', 'KNOWN_PLANS', 'KNOWN_SUBSCRIPTION_PLANS', 'KNOWN_DEALS', 'KNOWN_PEAK_PRICING', 'PEAK_HOUR_RANGES', 'KNOWN_NON_ZDR_MODELS'];
    const snapshots = {};
    visit(source, n => {
      if (ts.isVariableDeclaration(n) && wanted.includes(n.name.text)) snapshots[n.name.text] = value(n.initializer);
    });
    if (Object.keys(snapshots).length !== wanted.length) throw Error('Missing local snapshot');
    return snapshots;
  }
  // Effort data. Two encodings exist and BOTH must be tolerated by one
  // extractor, because the release that switched them is the release this check
  // runs against:
  //
  //   pre-1.82.4  `getSupportedEfforts(e){return xn.get(n) ?? null}` — a bundled
  //               Map inside the anchor. The registry rows ALSO carry a
  //               `reasoningEfforts` field, so the two are compared.
  //   1.82.4+     `getSupportedEfforts(e,n){…resolveKnownCatalogModel({model,catalog})
  //               ?.reasoningEfforts…}` — no Map at all, no `.get()` call, and
  //               no `.has()` either. The bundle only carries the registry rows
  //               plus a bootstrap catalog snapshot; the live answer comes from
  //               the `?view=client` catalog, which audit.py merges in.
  //
  // The registry rows are therefore the authoritative artifact-side source; the
  // bundled Map is compared against them when it is still there. A disagreement
  // is reported rather than resolved, because silently preferring either side is
  // how a release that changes one of them goes unnoticed.
  // The anchor must still RESOLVE: 1.82.4 kept the function, it only renamed the
  // declaration behind a `__name` wrapper, so `resolveAnchor` finds it either
  // way. A release that genuinely drops the function is a loud failure, not a
  // silent fall-back to the registry rows.
  const effortAnchor = resolveAnchor('getSupportedEfforts');
  let bundledEfforts = null;
  let effortError = null;
  try {
    const mapRefs = [];
    visit(effortAnchor.node, n => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'get') mapRefs.push(n.expression.expression);
    });
    const map = value(unique(mapRefs, 'effort map'));
    if (!Object.keys(map).length || Object.values(map).some(x => !Array.isArray(x) || !x.length || x.some(y => typeof y !== 'string'))) throw Error('Invalid effort map');
    bundledEfforts = map;
  } catch (error) {
    // ONLY the catalog migration is tolerated here: a `Missing/ambiguous effort
    // map` means the anchor has no bundled Map left because the data moved to the
    // catalog. Every other failure — duplicate Map entries, an unresolvable
    // expression, an invalid map — is a real artifact defect and must propagate.
    const message = error instanceof Error ? error.message : String(error);
    if (!message.startsWith('Missing/ambiguous effort map')) throw error;
    effortError = message;
  }
  const tableRefs = [];
  visit(anchor('buildModelGroups'), n => {
    if (ts.isCallExpression(n) && n.expression.getText(source) === 'Object.values' && n.arguments.length === 1) {
      const table = deref(n.arguments[0]);
      if (ts.isObjectLiteralExpression(table) && table.properties.some(p => ts.isPropertyAssignment(p) && ts.isObjectLiteralExpression(p.initializer) && p.initializer.properties.some(q => q.name?.text === 'inputModalities'))) tableRefs.push(n.arguments[0]);
    }
  });
  const models = [];
  for (const p of unique(tableRefs, 'model registry').properties) {
    if (!ts.isPropertyAssignment(p)) throw Error('Unsupported registry spread');
    const row = deref(p.initializer);
    if (!ts.isObjectLiteralExpression(row)) throw Error('Invalid registry row');
    const model = {};
    for (const field of row.properties) {
      if (ts.isGetAccessorDeclaration(field) && field.name.text === 'hidden') {
        model.hiddenExpression = field.getText(source);
        continue;
      }
      if (!ts.isPropertyAssignment(field)) throw Error(`Unsupported model property: ${field.getText(source).slice(0, 160)}`);
      if (['id', 'name', 'inputModalities', 'reasoning', 'reasoningEfforts', 'contextWindow', 'hidden', 'provider', 'spec'].includes(field.name.text)) model[field.name.text] = value(field.initializer);
    }
    if (typeof model.id !== 'string' || !Array.isArray(model.inputModalities)) throw Error('Invalid model');
    models.push(model);
  }
  if (!models.length || new Set(models.map(m => m.id)).size !== models.length) throw Error('Empty/duplicate model registry');

  // Artifact-side effort table: prefer the bundled Map when the release still
  // ships one (it is the exact table the CLI consults), otherwise derive it from
  // the registry rows. Report any disagreement between the two rather than
  // picking a winner — a release that changes one and not the other is a signal,
  // not a tie to break.
  const registryEfforts = {};
  for (const model of models) {
    if (Array.isArray(model.reasoningEfforts) && model.reasoningEfforts.length) registryEfforts[model.id] = model.reasoningEfforts;
  }
  const efforts = bundledEfforts ?? registryEfforts;
  const effortSource = bundledEfforts ? 'bundled-map' : 'registry-rows';
  const effortConflict = [];
  if (bundledEfforts) {
    for (const id of new Set([...Object.keys(bundledEfforts), ...Object.keys(registryEfforts)])) {
      const a = bundledEfforts[id], b = registryEfforts[id];
      if (JSON.stringify(a) !== JSON.stringify(b)) effortConflict.push({ id, bundled: a ?? null, registry: b ?? null });
    }
  }
  if (!Object.keys(efforts).length) throw Error('Invalid effort map');

  const plans = [];
  visit(anchor('getPlanInfo'), n => {
    if (ts.isElementAccessExpression(n)) {
      try { const v = value(n.expression); if (v && !Array.isArray(v) && Object.hasOwn(v, 'individual-go')) plans.push(v); } catch {}
    }
  });
  const candidates = [...new Map(plans.map(p => [JSON.stringify(p), p])).values()];
  const creditMaps = candidates.filter(p => Object.values(p).every(x => typeof x === 'number' && Number.isFinite(x)));
  const nameMaps = candidates.filter(p => Object.values(p).every(x => typeof x === 'string'));
  if (creditMaps.length !== 1 || nameMaps.length !== 1) throw Error('Missing/ambiguous subscription maps');
  const credits = creditMaps[0], names = nameMaps[0];
  if (JSON.stringify(Object.keys(credits).sort()) !== JSON.stringify(Object.keys(names).sort())) throw Error('Subscription key mismatch');
  // Zero data retention: the provider's `x-cmd-zdr: 1` opt-in is model-scoped
  // — a model with no ZDR-capable upstream is REFUSED (422
  // cmd_zdr_no_providers), and the CLI's own picker hides it under the same
  // flag. The authoritative per-model answer is the exclusion set behind the
  // CLI's `modelSupportsZdr` predicate; `knownModelSupportsZdr` carries the
  // sibling route table's membership. Both anchors are read when present and
  // unioned, and a release that drops either keeps the remaining one.
  //
  // From command-code@1.82.4 the ANSWER MOVED: both predicates became
  // `resolveKnownCatalogModel({model,catalog})?.zdr ?? false`, so neither body
  // contains a `.has()` call any more and there is no set left in the artifact
  // to read. That is a migration, not a missing anchor — `zdrMigrated` names the
  // predicates that moved, and the caller is expected to fall back to the
  // `?view=client` catalog's per-model `zdr` field (audit.py does). A release
  // that drops BOTH NAMES entirely is still a loud failure, and so is one where
  // an anchor exists but yields no readable set for a reason other than the
  // catalog migration — silently returning "every model is covered" would let
  // the plugin's ZDR switch fail live requests.
  const zdrAnchors = ['modelSupportsZdr', 'knownModelSupportsZdr'].filter(name => functions.has(name) || named.has(name));
  if (!zdrAnchors.length) throw Error('Missing ZDR anchor');
  const zdrSets = {}, zdrMigrated = [];
  for (const name of zdrAnchors) {
    try {
      zdrSets[name] = negatedSet(name, `ZDR exception set (${name})`);
    } catch (error) {
      // `Missing/ambiguous` here means the predicate has no `.has()` receiver:
      // with a catalog-backed body that is the documented migration. Anything
      // else (an unreadable set literal, a duplicate anchor) stays fatal.
      const message = error instanceof Error ? error.message : String(error);
      if (!message.startsWith('Missing/ambiguous')) throw error;
      zdrMigrated.push(name);
    }
  }
  const zdrExceptions = [...new Set(Object.values(zdrSets).flat())].sort();
  const zdrSource = zdrMigrated.length === zdrAnchors.length ? 'catalog' : zdrMigrated.length ? 'mixed' : 'artifact-sets';
  return {
    efforts,
    models,
    subscriptions: Object.fromEntries(Object.keys(credits).map(id => [id, { name: names[id], monthlyCredits: credits[id] }])),
    zdrAnchors,
    zdrSets,
    zdrExceptions,
    // Added 2026-10-16; the fields above keep their pre-existing meaning.
    effortSource,
    effortError,
    effortConflict,
    zdrMigrated,
    zdrSource,
    anchors: ['getSupportedEfforts', 'buildModelGroups', 'getPlanInfo', ...zdrAnchors],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  try { console.log(JSON.stringify(extract(path.resolve(process.argv[2]), process.argv[3] ?? process.cwd(), process.argv.includes('--local')), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 2; }
}
