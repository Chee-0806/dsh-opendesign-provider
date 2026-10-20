/**
 * 凭据链的外部行为（ticket 08）：显式密钥 → 凭据引用 → CLI 登录态，以及
 * 由凭据来源决定的网关地址。这里只驱动解析结果，不碰任何真实文件或密钥：
 * 读文件与凭据引用都是注入的假实现。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  formatCredentialDiagnostic,
  missingCredentialMessage,
  readCliLoginState,
  resolveCredentialChain,
} from '../src/credentials.ts'
import { DEFAULT_API_BASE, DEFAULT_API_KEY_ENV } from '../src/identity.ts'

const LOGIN_FILE = '/home/user/.amr/config.json'

/** 一份真实形状的登录态：只用于断言字段映射与来源，不打印任何值。 */
const LOGIN_STATE = JSON.stringify({
  profiles: {
    prod: {
      runtimeKey: 'sk-amr-runtime-value',
      controlKey: 'vela_ctrl-control-value',
      linkUrl: 'https://runtime.example/v1',
      apiUrl: 'https://control.example/api/v1',
      user: 'xuqi',
    },
  },
})

function readerFor(text: string | Error) {
  return async (): Promise<string> => {
    if (text instanceof Error) throw text
    return text
  }
}

test('readCliLoginState 只读取 profiles.prod 的五个字段', async () => {
  const reading = await readCliLoginState(LOGIN_FILE, readerFor(LOGIN_STATE))
  assert.equal(reading.status, 'ok')
  assert.equal(reading.state?.runtimeKey, 'sk-amr-runtime-value')
  assert.equal(reading.state?.controlKey, 'vela_ctrl-control-value')
  assert.equal(reading.state?.linkUrl, 'https://runtime.example/v1')
  assert.equal(reading.state?.apiUrl, 'https://control.example/api/v1')
  assert.equal(reading.state?.user, 'xuqi')
})

test('登录态文件缺失、坏 JSON、缺 profiles.prod 都优雅降级', async () => {
  const missing = Object.assign(new Error('no such file'), { code: 'ENOENT' })
  assert.equal((await readCliLoginState(LOGIN_FILE, readerFor(missing))).status, 'missing')
  assert.equal((await readCliLoginState(LOGIN_FILE, readerFor('{not json'))).status, 'malformed')
  assert.equal((await readCliLoginState(LOGIN_FILE, readerFor('{"profiles":{}}'))).status, 'malformed')
  assert.equal((await readCliLoginState(LOGIN_FILE, readerFor('{"profiles":{"prod":"nope"}}'))).status, 'malformed')
  assert.equal((await readCliLoginState(LOGIN_FILE, readerFor(new Error('EACCES')))).status, 'unreadable')
})

test('profiles.prod 里字段缺失只丢该字段，不把整份登录态判坏', async () => {
  const reading = await readCliLoginState(
    LOGIN_FILE,
    readerFor('{"profiles":{"prod":{"controlKey":"vela_ctrl-only"}}}'),
  )
  assert.equal(reading.status, 'ok')
  assert.equal(reading.state?.runtimeKey, undefined)
  assert.equal(reading.state?.controlKey, 'vela_ctrl-only')
  assert.equal(reading.state?.linkUrl, undefined)
})

test('显式 apiKey 优先于凭据引用与 CLI 登录态，并保留显式 apiBase', async () => {
  let referenceAsked = false
  const result = await resolveCredentialChain(
    { apiKey: 'sk-amr-literal', apiKeyEnv: 'TEAM_KEY', apiBase: 'https://explicit.example/v1' },
    {
      readFile: readerFor(LOGIN_STATE),
      resolveReference: () => { referenceAsked = true; return 'sk-amr-from-ref' },
    },
  )
  assert.equal(result.source, 'literal')
  assert.equal(result.apiKey, 'sk-amr-literal')
  assert.equal(result.apiBase, 'https://explicit.example/v1')
  assert.equal(result.apiBaseSource, 'config')
  assert.equal(referenceAsked, false, '字面量密钥存在时不应再问凭据引用')
})

test('没有字面量时用凭据引用，并且不走 CLI 登录态的 linkUrl', async () => {
  const result = await resolveCredentialChain(
    { apiKeyEnv: 'TEAM_KEY' },
    { readFile: readerFor(LOGIN_STATE), resolveReference: (ref) => ref === 'TEAM_KEY' ? 'sk-amr-from-ref' : undefined },
  )
  assert.equal(result.source, 'reference')
  assert.equal(result.apiKey, 'sk-amr-from-ref')
  assert.equal(result.apiBase, DEFAULT_API_BASE)
  assert.equal(result.apiBaseSource, 'default')
  assert.equal(result.login.status, 'ok')
  assert.equal(result.login.hasRuntimeKey, true)
  assert.equal(result.login.hasControlKey, true)
})

test('前两层都缺时复用 CLI 登录态的 runtimeKey，并使用其 linkUrl', async () => {
  const result = await resolveCredentialChain(
    { apiKeyEnv: DEFAULT_API_KEY_ENV },
    { readFile: readerFor(LOGIN_STATE), resolveReference: () => undefined },
  )
  assert.equal(result.source, 'cli-login')
  assert.equal(result.apiKey, 'sk-amr-runtime-value')
  assert.equal(result.apiBase, 'https://runtime.example/v1')
  assert.equal(result.apiBaseSource, 'cli-login')
  assert.equal(result.login.hasControlKey, true)
})

test('真实的 linkUrl 是主机名（没有 /v1）：补 /v1；自带路径的原样使用', async () => {
  const reader = (linkUrl: string): (() => Promise<string>) => readerFor(JSON.stringify({
    profiles: { prod: { runtimeKey: 'sk-amr-runtime-value', linkUrl } },
  }))

  // 2026-10-20 本机实测：vela login 写的是主机名，模型面路由在 /v1 之下。
  const hostOnly = await resolveCredentialChain(
    {},
    { readFile: reader('https://runtime.example'), resolveReference: () => undefined },
  )
  assert.equal(hostOnly.apiBase, 'https://runtime.example/v1')
  assert.equal(hostOnly.apiBaseSource, 'cli-login')

  const trailingSlash = await resolveCredentialChain(
    {},
    { readFile: reader('https://runtime.example/'), resolveReference: () => undefined },
  )
  assert.equal(trailingSlash.apiBase, 'https://runtime.example/v1')

  // 服务端下发带路径的地址时不自作主张再拼一层。
  const withPath = await resolveCredentialChain(
    {},
    { readFile: reader('https://gateway.example/openai'), resolveReference: () => undefined },
  )
  assert.equal(withPath.apiBase, 'https://gateway.example/openai')
})

test('显式 apiBase 覆盖 CLI 登录态下发的地址', async () => {
  const result = await resolveCredentialChain(
    { apiBase: 'https://self-hosted.example/v1' },
    { readFile: readerFor(LOGIN_STATE), resolveReference: () => undefined },
  )
  assert.equal(result.source, 'cli-login')
  assert.equal(result.apiBase, 'https://self-hosted.example/v1')
  assert.equal(result.apiBaseSource, 'config')
})

test('两条路径都缺时返回 none，并给出两条可照做的指引', async () => {
  const missing = Object.assign(new Error('no such file'), { code: 'ENOENT' })
  const result = await resolveCredentialChain(
    {},
    { readFile: readerFor(missing), resolveReference: () => undefined },
  )
  assert.equal(result.source, 'none')
  assert.equal(result.apiKey, undefined)
  assert.equal(result.reference, DEFAULT_API_KEY_ENV)
  assert.equal(result.login.status, 'missing')
  assert.equal(result.login.hasControlKey, false)

  const message = missingCredentialMessage(DEFAULT_API_KEY_ENV)
  assert.match(message, /设置 → Open Design/)
  assert.match(message, /vela login/)
  assert.match(message, new RegExp(DEFAULT_API_KEY_ENV))
  assert.match(message, /https:\/\/open-design\.ai\/cloud\/api-keys/)
})

test('只有控制密钥、没有 runtimeKey 的半配置如实报告额度不可用但不影响推理', async () => {
  const result = await resolveCredentialChain(
    {},
    {
      readFile: readerFor('{"profiles":{"prod":{"controlKey":"vela_ctrl-only"}}}'),
      resolveReference: () => undefined,
    },
  )
  assert.equal(result.source, 'none')
  assert.equal(result.login.status, 'ok')
  assert.equal(result.login.hasRuntimeKey, false)
  assert.equal(result.login.hasControlKey, true)
})

test('凭据引用解析失败不能把整个链判死，仍可落到 CLI 登录态', async () => {
  const result = await resolveCredentialChain(
    {},
    {
      readFile: readerFor(LOGIN_STATE),
      resolveReference: () => { throw new Error('credential service offline') },
    },
  )
  assert.equal(result.source, 'cli-login')
  assert.equal(result.apiKey, 'sk-amr-runtime-value')
})

test('诊断文本只报引用、存在性与来源，绝不包含任何密钥', async () => {
  const result = await resolveCredentialChain(
    { apiKey: 'sk-amr-literal-secret', apiBase: 'https://user:pass@example/v1' },
    { readFile: readerFor(LOGIN_STATE), resolveReference: () => undefined },
  )
  const text = formatCredentialDiagnostic(result)
  assert.doesNotMatch(text, /sk-amr-literal-secret/)
  assert.doesNotMatch(text, /sk-amr-runtime-value/)
  assert.doesNotMatch(text, /vela_ctrl-control-value/)
  assert.doesNotMatch(text, /user:pass/)
  assert.match(text, new RegExp(DEFAULT_API_KEY_ENV))
  assert.match(text, /literal/)
  assert.match(text, /controlKey/)
})
