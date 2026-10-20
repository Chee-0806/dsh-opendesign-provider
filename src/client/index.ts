/**
 * Browser half of the dsh-opendesign-provider bundle.
 *
 * Ticket 01 keeps this half as a loadable skeleton: the module must export an
 * `apply` the client loader can call, and the package manifest keeps declaring
 * `dsh.client`, but no slot is registered yet. Ticket 08 adds the settings page
 * (`settings.section`, id `opendesign`) and the Models-page provider card
 * (`settings.models.provider-card`, key `llm-opendesign`); P1 adds the quota
 * panel. Registering a slot before its React implementation exists would mount
 * a blank surface, so the skeleton deliberately mounts nothing.
 *
 * @module dsh-opendesign-provider/client
 */

import type { Context } from '@deepseek-ai/cordis'

/** Client plugin body. Intentionally empty until ticket 08. */
export function apply(_ctx: Context): void {
  // No surfaces in the pre-refactor skeleton. The export itself is the
  // contract: the web client loader scans every bundle that declares
  // `dsh.client` and calls this function once the plugin mounts.
}
