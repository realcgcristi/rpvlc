import crypto from "crypto";

const api_url = "https://" + ["ws", "audioscrobbler", "com"].join(".") + "/2.0/";

function sign(params, secret) {
    const str = Object.keys(params).sort().map(k => k + params[k]).join("") + secret;
    return crypto.createHash("md5").update(str, "utf8").digest("hex");
}

async function call(params, secret) {
    params.api_sig = sign(params, secret);
    params.format = "json";
    const res = await fetch(api_url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(params).toString(),
        signal: AbortSignal.timeout(8000)
    });
    return await res.json();
}

async function login(fm) {
    const data = await call({
        method: "auth.getMobileSession",
        api_key: fm.api_key,
        username: fm.username,
        password: fm.password
    }, fm.api_secret);

    if (data.error) throw new Error(data.message || `lastfm error ${data.error}`);
    return data.session?.key ?? "";
}

async function nowplaying(fm, artist, track, album) {
    const params = { method: "track.updateNowPlaying", api_key: fm.api_key, sk: fm.session_key, artist, track };
    if (album) params.album = album;
    await call(params, fm.api_secret);
}

async function scrobble(fm, artist, track, album, timestamp) {
    const params = { method: "track.scrobble", api_key: fm.api_key, sk: fm.session_key, artist, track, timestamp: String(timestamp) };
    if (album) params.album = album;
    if (track.length > 0) params.duration = String(track.length);
    await call(params, fm.api_secret);
}

export { login, nowplaying, scrobble };

