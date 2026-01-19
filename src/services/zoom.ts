import crypto from "crypto";
import { loadEnv } from "../config.js";

const env = loadEnv();

export function getZoomAuthUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.ZOOM_CLIENT_ID,
    redirect_uri: env.ZOOM_REDIRECT_URI,
    state
  });
  return `https://zoom.us/oauth/authorize?${params.toString()}`;
}

export async function exchangeZoomCode(code: string) {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: env.ZOOM_REDIRECT_URI
  });

  const basic = Buffer.from(`${env.ZOOM_CLIENT_ID}:${env.ZOOM_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`https://zoom.us/oauth/token?${params.toString()}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Zoom token error: ${res.status} ${body}`);
  }

  return res.json();
}

export async function refreshZoomToken(refreshToken: string) {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken
  });

  const basic = Buffer.from(`${env.ZOOM_CLIENT_ID}:${env.ZOOM_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`https://zoom.us/oauth/token?${params.toString()}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Zoom refresh error: ${res.status} ${body}`);
  }

  return res.json();
}

export async function getZoomUserProfile(accessToken: string) {
  const res = await fetch("https://api.zoom.us/v2/users/me", {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Zoom profile error: ${res.status} ${body}`);
  }

  return res.json();
}

export async function downloadZoomRecording(downloadUrl: string, accessToken: string): Promise<ArrayBuffer> {
  const url = new URL(downloadUrl);
  url.searchParams.set("access_token", accessToken);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Zoom download error: ${res.status} ${body}`);
  }
  return res.arrayBuffer();
}

export function verifyZoomWebhook(payload: string, timestamp: string, signature: string, secret: string): boolean {
  const message = `v0:${timestamp}:${payload}`;
  const hash = crypto.createHmac("sha256", secret).update(message).digest("hex");
  const expected = `v0=${hash}`;
  return expected === signature;
}
