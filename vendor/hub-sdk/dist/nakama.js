import { HubSdkError } from './errors';
import { base64UrlToBytes } from './ticket';
/** Local compose origin. The game authenticates with the session token from custom auth. */
export const LOCAL_NAKAMA = {
    serverUrl: 'http://127.0.0.1:7350',
};
export function userIdFromToken(token) {
    const part = token.split('.')[1];
    if (!part)
        throw new HubSdkError('bad_token', 'Session token is missing a payload');
    try {
        const json = JSON.parse(new TextDecoder().decode(base64UrlToBytes(part)));
        if (!json.uid)
            throw new HubSdkError('bad_token', 'Session token has no user id');
        return json.uid;
    }
    catch (error) {
        if (error instanceof HubSdkError)
            throw error;
        throw new HubSdkError('bad_token', 'Session token payload is not valid');
    }
}
export function createNakamaClient(options) {
    const serverUrl = options.serverUrl.replace(/\/$/, '');
    const fetchImpl = options.fetchImpl ?? fetch;
    async function postAccount(path, query, body) {
        const response = await fetchImpl(`${serverUrl}${path}?${query}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const text = await response.text();
        if (!response.ok)
            throw new HubSdkError('auth_failed', text || `HTTP ${response.status}`);
        const parsed = JSON.parse(text);
        if (!parsed.token)
            throw new HubSdkError('auth_failed', 'Auth did not return a session token');
        return { token: parsed.token, userId: userIdFromToken(parsed.token) };
    }
    return {
        async authenticateDevice(deviceId, vars) {
            return postAccount('/v2/account/authenticate/device', new URLSearchParams({ create: 'true' }), vars ? { id: deviceId, vars } : { id: deviceId });
        },
        /**
         * Exchange a portal ticket (`t:` + ticket) for a Nakama session.
         * `create` stays false. Vars carry the game id. No server credential is sent.
         */
        async authenticateCustom(id, vars) {
            return postAccount('/v2/account/authenticate/custom', new URLSearchParams({ create: 'false' }), { id, vars: vars ?? {} });
        },
        async rpc(id, body, opts) {
            const params = new URLSearchParams({ unwrap: 'true' });
            if (!opts?.token)
                throw new HubSdkError('unauthorized', 'Missing session');
            const headers = {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${opts.token}`,
            };
            const response = await fetchImpl(`${serverUrl}/v2/rpc/${encodeURIComponent(id)}?${params}`, {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
                keepalive: opts?.keepalive,
            });
            const text = await response.text();
            if (!response.ok)
                throw new HubSdkError('rpc_failed', text || `HTTP ${response.status}`, response.status);
            const parsed = (text ? JSON.parse(text) : {});
            if (parsed.error) {
                const num = (value) => (typeof value === 'number' ? value : undefined);
                const sessionCapLeft = num(parsed.sessionCapLeft);
                const dailyCapLeft = num(parsed.dailyCapLeft);
                const capLeft = num(parsed.capLeft) ?? sessionCapLeft ?? dailyCapLeft;
                throw new HubSdkError(parsed.error, parsed.message || parsed.error, undefined, capLeft, sessionCapLeft, dailyCapLeft);
            }
            return parsed;
        },
    };
}
