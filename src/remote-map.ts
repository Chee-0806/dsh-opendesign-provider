/**
 * The merged `opendesign` Remote face (tickets 08 + 10).
 *
 * Typert's module augmentation cannot be split across files for the same
 * namespace: two `TypertRemoteNamespaceMap` declarations of `opendesign` must
 * have identical types, so every endpoint this bundle mounts is listed in ONE
 * place. Each endpoint stays optional — a Host older or newer than the browser
 * bundle simply lacks that member, and the calling surface degrades instead of
 * throwing.
 *
 * Type-only: importing this module emits nothing on either half.
 *
 * @module dsh-opendesign-provider/remote-map
 */

import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

import type { QuotaSnapshot } from './control-plane.ts'
import type { OpenDesignModelsReport } from './models-wire.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteMap {
    'opendesign/models': () => Promise<RemoteResult<OpenDesignModelsReport>>
    'opendesign/usage': () => Promise<RemoteResult<QuotaSnapshot>>
  }

  interface TypertRemoteNamespaceMap {
    opendesign: {
      models?: () => Promise<RemoteResult<OpenDesignModelsReport>>
      usage?: () => Promise<RemoteResult<QuotaSnapshot>>
    }
  }
}

export {}
