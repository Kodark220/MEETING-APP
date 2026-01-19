import type { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import { getGoogleAuthUrl, exchangeGoogleCode } from "../services/google.js";
import { createOAuthState, consumeOAuthState, saveOAuthTokens, upsertUserByEmail } from "../services/store.js";

export async function authGoogleRoutes(app: FastifyInstance) {
  app.get("/start", async (_req, reply) => {
    const state = randomUUID();
    await createOAuthState("google", state);
    const url = getGoogleAuthUrl(state);
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

    const { tokens, profile } = await exchangeGoogleCode(code);
    const user = await upsertUserByEmail(profile.email, profile.name);

    await saveOAuthTokens(user.id, "google", {
      access_token: tokens.access_token || "",
      refresh_token: tokens.refresh_token || null,
      scope: tokens.scope || null,
      token_type: tokens.token_type || null,
      expires_at: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null
    });

    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Google Connected</title>
</head>
<body>
  <h1>Google connected</h1>
  <p>You can close this tab.</p>
</body>
</html>`;
    reply.type("text/html").send(html);
  });
}
