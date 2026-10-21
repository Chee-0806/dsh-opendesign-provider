/**
 * Slot declarations for the quota panel (ticket 11).
 *
 * `main` is the layout's keyed center-column cell (`activePanelId` selects the
 * entry key), and `sidebar.footer.action` is the sidebar shell's ordered list
 * directly above the Settings seat. Both are declared locally, exactly like the
 * Models-card merge in `card.tsx`: the shell's own packages are not peers of
 * this bundle, so these declarations are the only ones in this program.
 *
 * @module dsh-opendesign-provider/client/panel-slots
 */

import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'

import type { QuotaPanelInjected } from './panel.ts'
import type { PanelCopyKey } from './panel-locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** The layout's keyed center-column cell; our entry key is `PANEL_ID`. */
    main: { kind: 'keyed'; scope: 'root' }
    /** The sidebar shell's footer action list (directly above Settings). */
    'sidebar.footer.action': { kind: 'list'; scope: 'root'; owner: SidebarFooterOwnerProps }
  }
}

/** Owner share the sidebar shell hands each footer action. */
export interface SidebarFooterOwnerProps {
  /** False while the sidebar is collapsed to its icon rail. */
  readonly wide?: boolean
}

/** Props composed by the `sidebar.footer.action` registration. */
export interface QuotaCardProps extends QuotaPanelInjected, SidebarFooterOwnerProps {
  t: Translate<PanelCopyKey>
}

/** Props composed by the `main` registration. */
export interface QuotaDashboardProps extends QuotaPanelInjected {
  t: Translate<PanelCopyKey>
}
