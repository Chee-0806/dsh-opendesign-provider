/**
 * The Open Design LLM adapter skeleton.
 *
 * Ticket 01 deliberately ships no wire protocol here: the class keeps the
 * public `LlmAdapter` contract (provider metadata, the stream entry point) so
 * the plugin can be loaded and inspected, while the Chat Completions transport
 * arrives with ticket 02. Anything specific to the previous provider scaffold — the CLI
 * `/alpha/generate` transport, the Messages fallback, identity headers and
 * protocol downgrades — is deliberately absent.
 *
 * The adapter stays free of cordis and schemastery: the entry point hands it a
 * per-request options thunk and a credential resolver, so a settings write
 * reaches the next request without a restart.
 *
 * @module dsh-opendesign-provider/adapter
 */

import { LlmAdapter, LlmError, type GenerateOptions, type LlmProviderInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'

import { DEFAULT_API_BASE, PROVIDER_DISPLAY_NAME } from './identity.ts'

/** Default budget for the first byte of a response. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 300_000

/** Default budget for a stream that stalls after connecting. */
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300_000

/** The request facts one call is assembled from. All values are already resolved. */
export interface OpenDesignConnectionOptions {
  apiBase: string
  modelsCachePath: string
  requestTimeoutMs: number
  streamIdleTimeoutMs: number
  visibleModels?: readonly string[] | undefined
  modelVisibility?: Readonly<Record<string, boolean>> | undefined
  contextWindow?: number | undefined
  contextWindowOverrides?: Readonly<Record<string, number>> | undefined
  maxOutputTokens?: number | undefined
}

/** Everything the adapter needs from its owning plugin instance. */
export interface OpenDesignAdapterDeps {
  /** Read the live connection facts for one call. */
  options: () => OpenDesignConnectionOptions
  /** Resolve the bearer key for one call (literal → credential ref). */
  resolveApiKey: (connection: OpenDesignConnectionOptions) => Promise<string>
  /** Test seam for the later transport; unused by the skeleton. */
  fetchImpl?: typeof fetch
}

/** The skeleton adapter: metadata and a stream entry point, no wire logic yet. */
export class OpenDesignAdapter extends LlmAdapter {
  constructor(private readonly deps: OpenDesignAdapterDeps) {
    super()
  }

  /** Report the route under the product name, preserving the engine's id. */
  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: PROVIDER_DISPLAY_NAME }
  }

  /**
   * The Chat Completions stream lands in ticket 02. Until then a call fails
   * loudly instead of returning an empty success the user would mistake for a
   * model reply.
   */
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    void options
    const connection = this.deps.options()
    throw new LlmError(
      'llm-opendesign: the Open Design adapter is a ticket-01 skeleton and has no chat transport yet'
      + ` (apiBase ${connection.apiBase || DEFAULT_API_BASE}); ticket 02 adds the Chat Completions stream`,
      'NOT_IMPLEMENTED',
    )
  }
}
