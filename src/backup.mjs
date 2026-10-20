import { validateState } from './storage.mjs';
import { decodeAndroidBackup } from './android-backup.mjs';
export const MAX_BYTES = 8 * 1024 * 1024;
const format = 'vocavoca-web-progress';
const hash = async (text) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
export async function encodeBackup(state, catalogVersion, now = Date.now()) {
  const payload = JSON.stringify(validateState(structuredClone(state)));
  const text = JSON.stringify({
    format,
    version: 1,
    createdAt: now,
    catalogVersion,
    sha256: await hash(payload),
    payload,
  });
  if (new TextEncoder().encode(text).length > MAX_BYTES) throw Error('Копия больше допустимых 8 МБ.');
  return text;
}
export async function decodeBackup(text) {
  if (typeof text !== 'string') {
    const bytes = new Uint8Array(text);
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) return decodeAndroidBackup(bytes);
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }
  if (new TextEncoder().encode(text).length > MAX_BYTES) throw Error('Файл больше допустимых 8 МБ.');
  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch {
    throw Error('Не удалось прочитать файл копии VocaVoca Web.');
  }
  if (envelope.format !== format || envelope.version !== 1)
    throw Error('Нужна копия VocaVoca Web версии 1 или gzip-копия Android версии 1–3.');
  if (
    typeof envelope.payload !== 'string' ||
    typeof envelope.sha256 !== 'string' ||
    !Number.isFinite(envelope.createdAt) ||
    (await hash(envelope.payload)) !== envelope.sha256
  )
    throw Error('Копия повреждена: контрольная сумма не совпала.');
  let state;
  try {
    state = validateState(JSON.parse(envelope.payload));
  } catch (error) {
    throw Error(`Копия не принята. ${error.message}`);
  }
  return { state, createdAt: envelope.createdAt, catalogVersion: envelope.catalogVersion };
}
