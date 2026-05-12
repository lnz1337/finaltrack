import type { Env } from '../types';
import { buildConsentUrl } from '../lib/google-ads/oauth';
import { signState } from '../lib/google-ads/oauth-state';

export async function handleOAuthStart(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const workspaceId = url.searchParams.get('workspace_id');
  if (!workspaceId) return new Response('missing workspace_id', { status: 400 });

  const state = await signState({ workspace_id: workspaceId }, env.ENCRYPTION_KEY, 600);
  const consentUrl = buildConsentUrl({
    clientId: env.GOOGLE_ADS_CLIENT_ID,
    redirectUri: env.GOOGLE_ADS_OAUTH_REDIRECT_URI,
    state,
  });
  return new Response(null, {
    status: 302,
    headers: {
      Location: consentUrl,
      'Set-Cookie': `lt_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Max-Age=600; Path=/oauth/google-ads`,
    },
  });
}
