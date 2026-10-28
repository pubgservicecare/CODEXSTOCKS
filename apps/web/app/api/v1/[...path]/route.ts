import { getApi } from "../../../../lib/server";

// The same authenticated API serves the desktop app, the admin website and the storefront.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(req: Request): Promise<Response> {
  try {
    const api = await getApi();
    return await api(req);
  } catch {
    return Response.json({ error: { code: "unavailable", message: "Service temporarily unavailable" } }, { status: 503 });
  }
}

export { handle as GET, handle as POST, handle as PUT, handle as DELETE, handle as OPTIONS };
