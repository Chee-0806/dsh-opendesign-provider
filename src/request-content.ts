/**
 * 请求内容的共用投影（ticket 07 的图片通路，ticket 13 起两条传输共用）。
 *
 * Chat Completions 与 Anthropic Messages 的消息形态不同，但「一张托管图片怎么变成
 * 上线字节」「哪些附件本插件根本不接」这两件事与传输无关：图片一律按路由目标
 * （`./image-request.ts` 的长边与字节预算）编码成 base64，file/audio/video 一律
 * 以 `UNSUPPORTED_CONTENT` 拒绝。把这些规则放在一处，两条传输才不会对同一张图
 * 给出两种解释。
 *
 * 本模块只被 Host 半侧引用，不导入 cordis / schemastery。
 *
 * @module dsh-opendesign-provider/request-content
 */

import {
  LlmError,
  offloadedImageText,
  textOnlyImageText,
} from '@deepseek-ai/dsh-llm'
import type {
  FileAttachmentRef,
  ImageAttachmentRef,
  ImageRequestTarget,
  RequestImageAttachment,
} from '@deepseek-ai/dsh-attachment'

import { requestImageTarget } from './image-request.ts'

/**
 * 宿主附件服务里本插件用到的那一片：把一张托管图片编码成请求版本。
 *
 * 故意只声明用到的能力，`ctx.attachments` 天然满足它。
 */
export interface OpenDesignImageEncoder {
  /** Encode one normalized attachment to the request target (dimensions + byte budget). */
  readImageRequest(
    ref: ImageAttachmentRef,
    target: ImageRequestTarget,
    signal?: AbortSignal,
  ): Promise<RequestImageAttachment>
}

/** How one call may carry images: the catalog's capability plus the host encoder. */
export interface ImagePlan {
  /** Exact model id, named in a capability refusal. */
  readonly model: string
  /** The gateway/snapshot's declared input modalities, undefined when unknown. */
  readonly declaredModalities: readonly string[] | undefined
  /** The host attachment service, when mounted. */
  readonly encoder: OpenDesignImageEncoder | undefined
  /** The caller's cancellation, forwarded to encoding. */
  readonly signal: AbortSignal | undefined
}

/** One request image in wire form: the encoded media type plus base64 bytes. */
export interface EncodedImage {
  readonly mediaType: string
  readonly data: string
}

/** Whether the catalog declares image input for this exact model. */
export function modelAcceptsImages(plan: ImagePlan): boolean {
  return plan.declaredModalities?.includes('image') === true
}

/**
 * Turn one durable image into wire bytes.
 *
 * The encoder is asked for the ROUTE target (long edge and byte budget from
 * `./image-request.ts`), not the normalized original, so a Retina screenshot
 * travels as the size the model would downscale to anyway. Encoding returns
 * `undefined` when no attachment service is mounted: the image cannot become
 * pixels, so the caller degrades it to its placeholder text instead of
 * pretending the model saw it.
 */
export async function encodeImage(plan: ImagePlan, ref: ImageAttachmentRef): Promise<EncodedImage | undefined> {
  if (!modelAcceptsImages(plan)) throw imageCapabilityFailure(plan)
  if (plan.encoder === undefined) return undefined
  const request = await plan.encoder.readImageRequest(ref, requestImageTarget(ref), plan.signal)
  return { mediaType: request.mediaType, data: Buffer.from(request.data).toString('base64') }
}

/** A refusal for one image on a model the catalog does not call image-capable. */
export function imageCapabilityFailure(plan: ImagePlan): LlmError {
  const capability = plan.declaredModalities === undefined
    ? 'Open Design 目录也没有为这个模型声明输入模态'
    : `目录声明的输入模态是 ${plan.declaredModalities.join('/') || '空'}`
  return new LlmError(
    `llm-opendesign: 模型 "${plan.model}" 不支持图片输入（${capability}）。`
    + 'Open Design 本插件只支持文本与图片；请换用目录声明支持 image 的模型，或移除图片附件。',
    'UNSUPPORTED_CONTENT',
  )
}

/** Attachment kinds this route refuses by filename, and the word its message uses. */
const REJECTED_ATTACHMENT_KINDS: ReadonlyArray<{ kind: string; extensions: readonly string[] }> = [
  { kind: '音频', extensions: ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.opus'] },
  { kind: '视频', extensions: ['.mp4', '.mov', '.webm', '.mkv', '.avi', '.m4v'] },
]

/**
 * A `file` block: the gateway may declare file/audio/video modality, but this
 * plugin carries no such content natively, so the refusal names what arrived
 * and what is actually supported instead of failing as a generic error.
 */
export function unsupportedFileFailure(ref: FileAttachmentRef): LlmError {
  const lower = ref.name.toLowerCase()
  const kind = REJECTED_ATTACHMENT_KINDS.find(
    (candidate) => candidate.extensions.some((extension) => lower.endsWith(extension)),
  )?.kind
  const subject = kind === undefined ? `file 附件「${ref.name}」` : `${kind}附件「${ref.name}」（以 file 形态送来）`
  const remedy = kind === undefined
    ? '请把需要的文件内容转成文本再发。'
    : `请把${kind}转成文字描述或截图（图片）再发。`
  return new LlmError(
    `llm-opendesign: 不支持${subject}。Open Design 本插件只支持文本与图片；${remedy}`,
    'UNSUPPORTED_CONTENT',
  )
}

/** A content block this plugin has no wire slot for (e.g. a plugin-extended audio/video block). */
export function unsupportedBlockFailure(type: string): LlmError {
  return new LlmError(
    `llm-opendesign: 不支持 content 块类型 "${type}"。Open Design 本插件只支持文本与图片。`,
    'UNSUPPORTED_CONTENT',
  )
}

/**
 * Model-facing placeholder for an image the host has no way to encode: the
 * model is told the pixels did not travel, rather than being handed a turn that
 * looks like it saw the picture.
 */
export function unencodedImageText(ref: ImageAttachmentRef, model: string): string {
  const digest = String(ref.attachmentId).slice(7, 15)
  return `[Image sha256:${digest} was not sent: this host has no attachment encoding service, so ${model} `
    + 'received no pixels for it. Ask the user to send the image again once attachments are available.]'
}

/** An evicted image: the pixels never travel again, the model keeps its placeholder text. */
export function offloadedPlaceholder(ref: ImageAttachmentRef): string {
  return offloadedImageText(ref)
}

/** An image on a text-only route: placeholder text instead of pixels (used by the token meter too). */
export function textOnlyPlaceholder(ref: ImageAttachmentRef): string {
  return textOnlyImageText(ref)
}
