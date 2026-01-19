import type { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import { getZoomAuthUrl, exchangeZoomCode, getZoomUserProfile } from "../services/zoom.js";
import { createOAuthState, consumeOAuthState, saveOAuthTokens, upsertUserByEmail } from "../services/store.js";

export async function authZoomRoutes(app: FastifyInstance) {
  app.get("/start", async (_req, reply) => {
    const state = randomUUID();
    await createOAuthState("zoom", state);
    const url = getZoomAuthUrl(state);
    return reply.redirect(url);
  });

  app.get("/callback", async (req, reply) => {
    const { code, state } = req.query as { code?: string; state?: string };
    if (!code || !state) {
      return reply.status(400).send("Missing code or state");
    }

    const provider = await consumeOAuthState(state);
    if (!provider) {
      return reply.status(400).send("Invalid state");
    }

    const tokens = await exchangeZoomCode(code);
    const profile = await getZoomUserProfile(tokens.access_token);

    const user = await upsertUserByEmail(profile.email, profile.first_name ? `${profile.first_name} ${profile.last_name || ""}`.trim() : null);

    await saveOAuthTokens(user.id, "zoom", {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || null,
      scope: tokens.scope || null,
      token_type: tokens.token_type || null,
      expires_at: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null
    });

    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Zoom Connected</title>
</head>
<body>
  <h1>Zoom connected</h1>
  <p>You can close this tab.</p>
</body>
</html>`;
    reply.type("text/html").send(html);
  });
}
