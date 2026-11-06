// Общий HTTP-слой для обоих API: таймауты, понятные ошибки, JSON и NDJSON.

const TIMEOUT_MS = 15_000;

export class ApiError extends Error {
  constructor(message, { status = 0, kind = 'error' } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.kind = kind;
  }
}

async function request(url, { signal, headers } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const forwardAbort = () => controller.abort();
  signal?.addEventListener('abort', forwardAbort, { once: true });

  let response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
      headers,
    });
  } catch (error) {
    if (signal?.aborted) throw new ApiError('Запрос отменён', { kind: 'aborted' });
    if (error?.name === 'AbortError') throw new ApiError('Сервер не ответил вовремя', { kind: 'timeout' });
    throw new ApiError('Нет связи с сервисом. Проверьте интернет.', { kind: 'network' });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }

  if (response.status === 404) {
    throw new ApiError('Пользователь не найден', { status: 404, kind: 'notfound' });
  }
  if (response.status === 429) {
    throw new ApiError('Слишком много запросов. Подождите минуту.', { status: 429, kind: 'ratelimit' });
  }
  if (!response.ok) {
    throw new ApiError(`Сервис ответил ошибкой ${response.status}`, { status: response.status, kind: 'http' });
  }

  return response;
}

export async function fetchJson(url, options = {}) {
  const headers = { Accept: 'application/json', ...(options.headers ?? {}) };
  const response = await request(url, { ...options, headers });
  try {
    return await response.json();
  } catch {
    throw new ApiError('Сервис вернул некорректный ответ', { kind: 'parse' });
  }
}

export async function fetchText(url, options = {}) {
  const headers = { Accept: 'text/plain', ...(options.headers ?? {}) };
  const response = await request(url, { ...options, headers });
  return response.text();
}

/** NDJSON (по строке на объект) — формат выгрузки партий Lichess. */
export async function fetchNdjson(url, options = {}) {
  const text = await fetchText(url, {
    ...options,
    headers: { Accept: 'application/x-ndjson', ...(options.headers ?? {}) },
  });

  const items = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      items.push(JSON.parse(trimmed));
    } catch {
      /* обрезанная строка в конце потока — не повод падать */
    }
  }
  return items;
}
