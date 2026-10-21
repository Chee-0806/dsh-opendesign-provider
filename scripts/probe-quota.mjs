/**
 * Read-only control-plane probe (ticket 10).
 *
 * Asks the same `OpenDesignControlPlane` the plugin mounts for one quota
 * reading and prints the frozen snapshot as plain text — tier, both windows
 * (used/limit, reset time), wallet balance and the billing `funding`. It is the
 * terminal-visible form of `/opendesign`, and the live evidence a maintainer
 * can re-run without rebuilding `lib/`.
 *
 * The control key comes from the Open Design CLI login state
 * (`~/.amr/config.json`, `profiles.prod.controlKey`). The script NEVER prints,
 * logs or writes that key, and it only issues the three GETs the client owns —
 * nothing that could charge, top up or change a plan.
 *
 * ```sh
 * node scripts/probe-quota.mjs
 * node scripts/probe-quota.mjs --model deepseek-v4.1-flash
 * ```
 *
 * Exit codes: 0 = a snapshot was read, 2 = no control key / control plane
 * unavailable (an environment gap, not a capability failure).
 *
 * @module dsh-opendesign-provider/scripts/probe-quota
 */

import { register } from 'tsx/esm/api'

register()

const { OpenDesignControlPlane } = await import('../src/control-plane.ts')
const { staticGatewayCatalog } = await import('../src/gateway-facts.ts')

const argv = process.argv.slice(2)
const modelIndex = argv.indexOf('--model')
// Same fallback the command uses: the catalog's default entry. Without a model
// the control plane answers no windows at all, which would look like "no quota".
const model = modelIndex >= 0
  ? argv[modelIndex + 1]
  : (staticGatewayCatalog().find((entry) => entry.default) ?? staticGatewayCatalog()[0])?.id

const control = new OpenDesignControlPlane()
const reading = await control.read(model === undefined ? {} : { model })
const snapshot = reading.snapshot

console.log('Open Design 控制面额度（只读）')
console.log(`- controlPlaneAvailable: ${snapshot.controlPlaneAvailable}`)
if (reading.reason !== undefined) console.log(`- 原因: ${reading.reason}`)
if (snapshot.tier !== undefined) console.log(`- 套餐: ${snapshot.tier}`)
if (snapshot.subscriptionStatus !== undefined) console.log(`- 订阅: ${snapshot.subscriptionStatus}`)
if (snapshot.currentPeriodEnd !== undefined) console.log(`- 本期至: ${snapshot.currentPeriodEnd}`)
if (snapshot.balanceUsd !== undefined) console.log(`- 钱包余额: $${snapshot.balanceUsd.toFixed(2)}`)
if (snapshot.funding !== undefined) console.log(`- 计费口径: ${snapshot.funding}`)
for (const window of snapshot.windows) {
  const reset = window.resetsAt === undefined ? '未知' : window.resetsAt
  const mode = window.resetMode === undefined ? '' : `（${window.resetMode}）`
  console.log(`- ${window.kind}（${window.durationSeconds}s）: ${window.usedCredits}/${window.limitCredits} credits，重置 ${reset}${mode}`)
}
console.log(`- 抓取时间: ${snapshot.fetchedAt}${snapshot.stale === true ? '（已过期）' : ''}`)

process.exitCode = snapshot.controlPlaneAvailable ? 0 : 2
