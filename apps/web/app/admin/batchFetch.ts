/**
 * Network layer for the admin website's API client (not used by the desktop app).
 *
 * A screen asks for several things at once (the dashboard alone makes about ten reads). Each separate request costs a
 * round trip to the server plus a session check, so this layer:
 *  - sends the read-only admin GET requests made in the same moment as ONE `POST /api/v1/admin/batch` (the server
 *    checks the session once and runs them in parallel);
 *  - shares one request between identical GETs that are already on their way (e.g. two `/fx` calls).
 * Every caller still receives its own ordinary Response with the original status and body, so the API client and
 * the screens behave exactly as before. If the server does not know the batch endpoint (an older deployment),
 * the requests are sent separately.
 */
export const BATCH_LIMIT = 20;

interface Result {
  status: number;
  body: string;
}

interface Queued {
  path: string;
  init: RequestInit | undefined;
  resolve: (r: Result) => void;
  reject: (e: unknown) => void;
}

export function batchingFetch(base: typeof fetch, origin: string, opts: { windowMs?: number } = {}): typeof fetch {
  const api = `${origin.replace(/\/$/, "")}/api/v1`;
  const inFlight = new Map<string, Promise<Result>>();
  let queue: Queued[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let batchSupported = true;

  const toResponse = (r: Result) => new Response(r.body, { status: r.status, headers: { "Content-Type": "application/json; charset=utf-8" } });

  const single = async (url: string, init: RequestInit | undefined): Promise<Result> => {
    const res = await base(url, init);
    return { status: res.status, body: await res.text() };
  };

  const sendSeparately = (items: Queued[]) => {
    for (const q of items) single(api + q.path, q.init).then(q.resolve, q.reject);
  };

  const flush = async () => {
    timer = null;
    const items = queue;
    queue = [];
    for (let i = 0; i < items.length; i += BATCH_LIMIT) void sendBatch(items.slice(i, i + BATCH_LIMIT));
  };

  const sendBatch = async (items: Queued[]) => {
    if (items.length === 1 || !batchSupported) return sendSeparately(items);
    const first = items[0].init ?? {};
    let res: Response;
    try {
      res = await base(`${api}/admin/batch`, {
        method: "POST",
        credentials: first.credentials,
        headers: { ...(first.headers as Record<string, string> | undefined), "Content-Type": "application/json" },
        body: JSON.stringify({ requests: items.map((q) => q.path) }),
        signal: first.signal,
      });
    } catch (e) {
      items.forEach((q) => q.reject(e));
      return;
    }
    if (res.status === 404 || res.status === 405) {
      // Older server without the batch endpoint: fall back for the rest of this session.
      batchSupported = false;
      return sendSeparately(items);
    }
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      // Signed out, rate limited, server unavailable… — every request gets the answer it would have had on its own.
      items.forEach((q) => q.resolve({ status: res.status, body: text }));
      return;
    }
    let parsed: { responses?: Result[] } | null = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    const responses = parsed?.responses;
    if (!Array.isArray(responses) || responses.length !== items.length) {
      items.forEach((q) => q.resolve({ status: 502, body: "" }));
      return;
    }
    items.forEach((q, i) => q.resolve(responses[i]));
  };

  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    if (method !== "GET") {
      // A write: reads started before it must not be handed to callers that ask again after it.
      inFlight.clear();
      return base(input, init);
    }
    if (!url.startsWith(api + "/")) return base(input, init);
    const path = url.slice(api.length);
    const shared = inFlight.get(url);
    if (shared) return toResponse(await shared);
    const p: Promise<Result> = path.startsWith("/admin/")
      ? new Promise<Result>((resolve, reject) => {
          queue.push({ path, init, resolve, reject });
          timer ??= setTimeout(flush, opts.windowMs ?? 0);
        })
      : single(url, init); // e.g. /fx: cached by the CDN, so it stays a plain GET (only shared while in flight)
    inFlight.set(url, p);
    const done = () => inFlight.delete(url);
    p.then(done, done);
    return toResponse(await p);
  }) as typeof fetch;
}
