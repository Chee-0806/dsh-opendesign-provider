import { test } from 'node:test'
import assert from 'node:assert/strict'

// 直接调用脚本实际使用的候选生成入口，导入不会联网或改写项目文件。
const scriptUrl = new URL('../scripts/sync-model-prices.mjs', import.meta.url).href
const { buildPriceSnapshot, renderedRates } = await import(scriptUrl)
const source = 'const MODEL_PRICE_ROWS: readonly ModelPriceRow[] = [\n  { id: "old", rates: [1, 2, 0.5], allowance: { goat: 20, pro: 30 } },\n]\n'
const row = { id: 'model', name: 'Model', inputCost: 1, outputCost: 2, cacheReadCost: 0.5 }
// 渲染表按显示名分组：同一个显示名可能对应多行（付费行 + 限时免费同款），
// 由脚本按「免费 / 数值」形态取唯一一行，见 sync-model-prices.mjs 的 pickRenderedRow。
const rendered = new Map([['model', [{ rates: [1, 2, 0.5] }]]])

// 保留官网网格的列顺序；第四个数字不能补到缺失的前三个价格格里。
function htmlRow(name: string, prices: string[] = ['$1', '$2', '$0.5'], cacheWrite = '$4'): string {
  return '<div class="flex min-w-0 items-center gap-2 px-4 py-3">'
    + `<a class="text-[13px] font-medium" title="a > b">${name}</a></div>`
    + ['256K', ...prices, cacheWrite].map((text) => `<div class="px-2 py-3 text-right">${text}</div>`).join('')
}

test('价格同步遇到新套餐维度时拒绝生成删额度的候选', () => {
  assert.throws(() => buildPriceSnapshot([
    { ...row, planAllowanceUsd: { go: 10, goat: 20, pro: 30, future: 40 } },
  ], rendered, new Map(), source), /拒绝生成或写入快照/)
})

test('Go 额度保留零值，旧来源缺失时不借用其他套餐额度', () => {
  const result = buildPriceSnapshot([
    { ...row, planAllowanceUsd: { go: 0, goat: 20, pro: 30 } },
  ], rendered, new Map(), source)
  assert.match(result.next, /allowance: \{ go: 0, goat: 20, pro: 30 \}/)
  const old = buildPriceSnapshot([
    { ...row, planAllowanceUsd: { goat: 20, pro: 30 } },
  ], rendered, new Map(), source)
  assert.doesNotMatch(old.next, /go:/)
  for (const go of [-1, Infinity, NaN, '6']) {
    assert.throws(() => buildPriceSnapshot([
      { ...row, planAllowanceUsd: { go, goat: 20, pro: 30 } },
    ], rendered, new Map(), source), /not numeric/)
  }
})

test('价格同步对额度类型错误和双来源价格冲突都阻止覆盖', () => {
  assert.throws(() => buildPriceSnapshot([
    { ...row, planAllowanceUsd: { goat: '20', pro: 30 } },
  ], rendered, new Map(), source), /not numeric/)
  assert.throws(() => buildPriceSnapshot([row], new Map([['model', [{ rates: [9, 2, 0.5] }]]]), new Map(), source), /rendered table/)
})

test('通过校验的价格候选保留额度和手写内容', () => {
  const result = buildPriceSnapshot([
    { ...row, planAllowanceUsd: { goat: 20, pro: 30 } },
  ], rendered, new Map(), `// 手写说明\n${source}// 其他定义\n`)
  assert.equal(result.rowCount, 1)
  assert.match(result.next, /allowance: \{ goat: 20, pro: 30 \}/)
  assert.match(result.next, /^\/\/ 手写说明/)
  assert.match(result.next, /\/\/ 其他定义\n$/)
})

test('模型名称从 HTML 文本读取，正确处理嵌套标签、注释、实体与属性中的大于号', () => {
  const table = renderedRates(htmlRow('Model &amp; <b>Co</b><!-- discarded -->'
    + '<script>ignored()</script><style>ignored</style>'))
  assert.deepEqual(table.get('model & co'), [{ rates: [1, 2, 0.5] }])
  assert.equal(buildPriceSnapshot([{ ...row, name: ' Model & Co ' }], table, new Map(), source).rowCount, 1)
})

test('未闭合标签或注释不能被当成已经校验的模型名称', () => {
  for (const name of ['Model <script', 'Model <!--open']) {
    const table = renderedRates(htmlRow(name))
    assert.throws(() => buildPriceSnapshot([row], table, new Map(), source), /缺少可校验/)
  }
})

test('价格交叉校验不会把 span 当成删除线，也不会读取注释中的金额', () => {
  const table = renderedRates(htmlRow('Model', [
    '<s>$9</s><span>$1</span><!-- $99 -->', '<s>$8</s><span>$2</span>', '<s>$7</s><span>$0.5</span>',
  ]))
  assert.deepEqual(table.get('model'), [{ rates: [1, 2, 0.5], listRates: [9, 8, 7] }])
  assert.deepEqual(renderedRates(htmlRow('Model', ['<span>$1</span>', '$2', '$0.5'])).get('model'), [{ rates: [1, 2, 0.5] }])
})

test('同一显示名下的付费行与免费行按形态唯一配对，不牺牲数值交叉校验', () => {
  // 2026-10-19 起定价页把 MiniMax M3.1 Flash 的付费行与限时免费行用同一个
  // 显示名发布：两行都在，但「数值 / Free」形态不同，脚本必须据此配对。
  const duplicate = renderedRates(htmlRow('Model') + htmlRow('Model', ['Free', 'Free', 'Free']))
  assert.equal(duplicate.get('model')?.length, 2)
  assert.equal(buildPriceSnapshot([{ ...row, id: 'model-free', name: 'Model' }], duplicate, new Map(), source).rowCount, 1)
  // 免费记录只认 Free 那一行。
  const free = { ...row, id: 'model-free', name: 'Model', inputCost: 0, outputCost: 0, cacheReadCost: 0 }
  assert.equal(buildPriceSnapshot([free], duplicate, new Map(), source).rowCount, 1)
  // 配对之后仍会比较数值：把数值行改错必须照旧失败，不能因为「选中了」就放过。
  const wrong = renderedRates(htmlRow('Model', ['$9', '$2', '$0.5']) + htmlRow('Model', ['Free', 'Free', 'Free']))
  assert.throws(() => buildPriceSnapshot([{ ...row, name: 'Model' }], wrong, new Map(), source), /rendered table/)
})

test('同名且形态相同的行仍然拒绝生成含歧义的交叉校验表', () => {
  const ambiguous = renderedRates(htmlRow('Model') + htmlRow('MODEL'))
  assert.equal(ambiguous.get('model')?.length, 2)
  assert.throws(() => buildPriceSnapshot([row], ambiguous, new Map(), source), /无法确定对应行/)
})

test('即使总数足够，六十条数值记录中缺少一条网页行也必须拒绝快照', () => {
  const records = Array.from({ length: 60 }, (_, index) => ({ ...row, id: `model-${index}`, name: `Model ${index}` }))
  const table = new Map(records.slice(1).map((record) => [record.name.toLowerCase(), [{ rates: [1, 2, 0.5] }]]))
  table.set('unrelated model', [{ rates: [1, 2, 0.5] }])
  assert.throws(() => buildPriceSnapshot(records, table, new Map(), source), /model-0: 缺少可校验/)
})

test('免费行明确核对零价，不能放过非零嵌入价格或整行缺失', () => {
  const free = { ...row, inputCost: 0, outputCost: 0, cacheReadCost: 0 }
  const table = renderedRates(htmlRow('Model', ['Free', 'Free', 'Free']))
  assert.deepEqual(table.get('model'), [{ status: 'free' }])
  assert.equal(buildPriceSnapshot([free], table, new Map(), source).rowCount, 1)
  assert.throws(() => buildPriceSnapshot([row], table, new Map(), source), /不是零价/)
  assert.throws(() => buildPriceSnapshot([free], new Map(), new Map(), source), /缺少可校验/)
})

test('未公开或不可解析的价格不能挪用缓存写列补齐，更不能覆盖旧快照', () => {
  for (const missing of ['—', 'unknown', 'Free']) {
    const table = renderedRates(htmlRow('Model', [missing, '$2', '$0.5']))
    if (missing === '—') assert.deepEqual(table.get('model'), [{ status: 'unpublished' }])
    else assert.equal(table.has('model'), false)
    assert.throws(() => buildPriceSnapshot([row], table, new Map(), source), /未公开完整数值价格|缺少可校验/)
  }
})
