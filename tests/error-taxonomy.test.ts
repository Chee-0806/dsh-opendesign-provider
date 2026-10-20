/**
 * 错误分类（ticket 06）—— 只测分类模块对外给出的错误码、文案与可重试性。
 *
 * 夹具来自协议实测（`docs/grill/20261020-opendesign-protocol-probe.md` §5）与
 * 设计件 §4.6：401 的顶层 `error.code`、400 的 `[code=upstream_error]` 前缀与
 * request_id、404 纯文本、nginx HTML 404、空消息/角色拒绝、502 包 400。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { readFileSync } from 'node:fs'

import { LlmError } from '@deepseek-ai/dsh-llm'

import {
  classifyHttpFailure,
  retryableFailureCodes,
  type HttpFailureInput,
} from '../src/error-taxonomy.ts'

const fixture = (name: string): string => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

/** 实测 401：错误码在顶层 `error.code`。 */
const INVALID_KEY = fixture('error-invalid-key.json')

/** 400 空消息：网关把上游 400 包成 `code=upstream_error`，真因在 message 的前缀后。 */
const EMPTY_INPUT = JSON.stringify({
  error: {
    message: '[code=upstream_error] Empty input messages (request_id: 874c0840-1111-2222-3333-444455556666)',
    type: 'invalid_request_error',
    code: 'upstream_error',
  },
})

/** 400 developer 角色被 glm 拒绝。 */
const ROLE_REJECTED = JSON.stringify({
  error: {
    message: '[code=upstream_error] Incorrect role information',
    type: 'upstream_error',
    code: 'upstream_error',
  },
})

function classify(input: HttpFailureInput): LlmError {
  return classifyHttpFailure(input)
}

test('401 归为 AUTH：文案指向控制台创建/检查 Key，且不可重试', () => {
  const error = classify({ status: 401, body: INVALID_KEY, contentType: 'application/json' })
  assert.equal(error.code, 'AUTH')
  assert.equal(error.failure.status, 401)
  assert.match(error.message, /设置 → Open Design/)
  assert.match(error.message, /api-keys/)
  assert.match(error.message, /api key not found/, '上游原话要保留，便于报障')
  assert.equal(retryableFailureCodes().includes(error.code), false)
})

test('402 归为 QUOTA_EXHAUSTED：文案指向额度页或 BYOK，且不可重试', () => {
  const error = classify({
    status: 402,
    body: JSON.stringify({ error: { code: 'quota_exhausted', message: 'insufficient credits', type: 'quota' } }),
    contentType: 'application/json',
  })
  assert.equal(error.code, 'QUOTA_EXHAUSTED')
  assert.equal(error.failure.status, 402)
  assert.match(error.message, /额度/)
  assert.match(error.message, /BYOK/)
  assert.equal(retryableFailureCodes().includes(error.code), false)
})

test('400 包 upstream_error：把真因与 request_id 读出来，归为 BAD_REQUEST 且不重试', () => {
  const error = classify({ status: 400, body: EMPTY_INPUT, contentType: 'application/json' })
  assert.equal(error.code, 'BAD_REQUEST')
  assert.equal(error.failure.status, 400)
  assert.match(error.message, /Empty input messages/, '真因在 message 的 [code=…] 前缀之后')
  assert.match(error.message, /874c0840-1111-2222-3333-444455556666/, 'request_id 要保留，报障才有凭据')
  assert.doesNotMatch(error.message, /\[code=upstream_error\]/, '前缀是网关的包装，不是原因本身')
  assert.match(error.message, /不会有任何重试|不会重试/, '文案要说清确定性错误不重试')
  assert.equal(retryableFailureCodes().includes(error.code), false)
})

test('400 角色不被支持同样是确定性错误：文案点名原因并指向可改的请求', () => {
  const error = classify({ status: 400, body: ROLE_REJECTED, contentType: 'application/json' })
  assert.equal(error.code, 'BAD_REQUEST')
  assert.match(error.message, /Incorrect role information/)
  assert.equal(retryableFailureCodes().includes(error.code), false)
})

test('404 纯文本不是 JSON：归为协议错误，文案指向 apiBase 而不是说「请求被拒」', () => {
  const error = classify({ status: 404, body: '404 page not found\n', contentType: 'text/plain; charset=utf-8' })
  assert.equal(error.code, 'PROTOCOL_ERROR')
  assert.equal(error.failure.status, 404)
  assert.match(error.message, /apiBase/u)
  assert.match(error.message, /404/u)
  assert.match(error.message, /page not found/u, 'Go 的原始 404 文本要引用，便于确认是入口层而不是上游')
  assert.equal(retryableFailureCodes().includes(error.code), false)
})

test('nginx HTML 404 页：不解析 JSON、不崩溃，按协议错误说明收到的是 HTML', () => {
  const html = '<html>\r\n<head><title>404 Not Found</title></head>\r\n<body>\r\n'
    + '<center><h1>404 Not Found</h1></center>\r\n<hr><center>nginx</center>\r\n</body>\r\n</html>\r\n'
  const error = classify({ status: 404, body: html, contentType: 'text/html' })
  assert.equal(error.code, 'PROTOCOL_ERROR')
  assert.match(error.message, /HTML/u)
  assert.match(error.message, /nginx/u)
  assert.doesNotMatch(error.message, /JSON 解析失败|Unexpected token/u)
})

test('502 包住上游 400 的确定性原因：读出真因、归为 BAD_REQUEST、不重试', () => {
  const error = classify({ status: 502, body: ROLE_REJECTED, contentType: 'application/json' })
  assert.equal(error.code, 'BAD_REQUEST')
  assert.equal(error.failure.status, 502)
  assert.match(error.message, /Incorrect role information/u)
  assert.match(error.message, /网关/u, '文案要点明网关把上游的请求错误包成了 5xx')
  assert.equal(retryableFailureCodes().includes(error.code), false)
})

test('502 包住非确定性的上游故障：按可重试的临时故障处理', () => {
  const body = JSON.stringify({
    error: {
      message: '[code=upstream_error] upstream connect timeout (request_id: abc-123)',
      type: 'upstream_error',
      code: 'upstream_error',
    },
  })
  const error = classify({ status: 502, body, contentType: 'application/json' })
  assert.equal(error.code, 'TRANSIENT')
  assert.equal(retryableFailureCodes().includes(error.code), true)
  assert.match(error.message, /重试/u)
  assert.match(error.message, /connect timeout/u)
})

test('5xx 的 HTML 错误页：按可重试的服务端故障处理，不解析 JSON', () => {
  const error = classify({
    status: 503,
    body: '<html><body><h1>503 Service Unavailable</h1></body></html>',
    contentType: 'text/html',
  })
  assert.equal(error.code, 'TRANSIENT')
  assert.equal(error.failure.status, 503)
  assert.match(error.message, /503/u)
  assert.equal(retryableFailureCodes().includes(error.code), true)
})

test('429：有 Retry-After 用上游给的时间，没有就交给退避，两者都可重试', () => {
  const withHeader = classify({ status: 429, body: '', contentType: 'text/plain', retryAfter: '7' })
  assert.equal(withHeader.code, 'RATE_LIMIT')
  assert.equal(withHeader.failure.status, 429)
  assert.equal(withHeader.failure.providerRetryAfterMs, 7000, 'Retry-After 秒数要转成毫秒交给引擎')
  assert.equal(retryableFailureCodes().includes('RATE_LIMIT'), true)

  const withoutHeader = classify({ status: 429, body: 'slow down', contentType: 'text/plain' })
  assert.equal(withoutHeader.code, 'RATE_LIMIT')
  assert.equal(withoutHeader.failure.providerRetryAfterMs, undefined)
  assert.match(withoutHeader.message, /重试/u)
  assert.match(withoutHeader.message, /slow down/u)
})

test('403 归为 AUTH：文案指向 Key/工作区权限，而不是让用户改请求', () => {
  const error = classify({ status: 403, body: '<html><body>Access denied</body></html>', contentType: 'text/html' })
  assert.equal(error.code, 'AUTH')
  assert.match(error.message, /权限|Key/u)
  assert.equal(retryableFailureCodes().includes(error.code), false)
})

test('404 且体是 JSON 错误（实测模型不存在）：归为 BAD_REQUEST，而不是「apiBase 配错」', () => {
  const body = JSON.stringify({
    error: {
      code: 'model_not_found',
      message: '[code=model_not_found] model "no-such-model-ticket06" not found',
      type: 'model_not_found',
    },
  })
  const error = classify({ status: 404, body, contentType: 'application/json' })
  assert.equal(error.code, 'BAD_REQUEST')
  assert.match(error.message, /no-such-model-ticket06/u)
  assert.match(error.message, /模型/u, '文案要指向模型 id，而不是 apiBase')
  assert.doesNotMatch(error.message, /apiBase/u)
  assert.equal(retryableFailureCodes().includes(error.code), false)
})
