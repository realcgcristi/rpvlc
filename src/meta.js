import { parseFile } from "music-metadata";
import fs from "fs";
import { execFileSync } from "child_process";

import * as itunes from "./providers/itunes.js";
import * as deezer from "./providers/deezer.js";
import * as musicbrainz from "./providers/musicbrainz.js";
import { artcached, artsave } from "./config.js";

function resize(p) {
    if (!p) return null;
    const small = p.replace(/\.(jpe?g|png|webp)$/i, "_sm.png");
    if (fs.existsSync(small)) return small;
    try {
        execFileSync("ffmpeg", [
            "-y", "-loglevel", "error", "-i", p,
            "-vf", "scale=320:320,split[a][b];[a]palettegen[p];[b][p]paletteuse=dither=bayer",
            "-frames:v", "1", small
        ], { timeout: 8000 });
        return fs.existsSync(small) ? small : null;
    } catch { return null; }
}

const providers = { itunes, deezer, musicbrainz };
const cache = new Map();

function splitname(filename) {
    const base = filename.replace(/\.[a-z0-9]+$/i, "").replace(/[\[\(].*?[\]\)]/g, "").trim();
    const parts = base.split(" - ");
    if (parts.length >= 2) {
        const left = parts[0].trim();
        const raw = parts.slice(1).join(" - ").trim();
        const numbered = /^\d{1,3}[\s.\-_]+/.test(raw);
        const title = raw.replace(/^\d{1,3}[\s.\-_]+/, "").trim();
        return { hint: left, title, numbered };
    }
    return { hint: "", title: base.replace(/^\d{1,3}[\s.\-_]+/, "").trim(), numbered: false };
}

function topath(uri) {
    try {
        if (!uri.startsWith("file://")) return null;
        let p = decodeURIComponent(new URL(uri).pathname);
        if (/^\/[a-zA-Z]:/.test(p)) p = p.slice(1);
        return p;
    } catch {
        return null;
    }
}

async function local(st) {
    const file = topath(st.uri);
    if (!file) return null;
    try {
        const meta = await parseFile(file);
        const title = meta.common.title ?? "";
        const artist = meta.common.artist ?? "";
        const album = meta.common.album ?? "";
        if (!title && !artist) return null;
        return { title, artist, album, art: "" };
    } catch {
        return null;
    }
}

function badartist(a) {
    if (!a) return true;
    const t = a.trim();
    if (!t) return true;
    if (/^\d+$/.test(t)) return true;
    if (!/\s/.test(t) && /^[a-z0-9]+$/.test(t) && t.length >= 6) return true;
    return false;
}

async function candidates(q, name) {
    const provider = providers[name] ?? providers.itunes;
    try {
        return await provider.search(q);
    } catch {
        return [];
    }
}

function norm(s) {
    return (s || "").toLowerCase()
        .replace(/[\(\[].*?[\)\)]/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

function tscore(a, b) {
    const x = norm(a), y = norm(b);
    if (!x || !y) return 0;
    if (x === y) return 1;
    if (x.includes(y) || y.includes(x)) return 0.85;
    const tx = new Set(x.split(" ").filter(Boolean));
    const ty = new Set(y.split(" ").filter(Boolean));
    let inter = 0;
    for (const t of tx) if (ty.has(t)) inter++;
    const union = new Set([...tx, ...ty]).size;
    return union ? inter / union : 0;
}

function hintscore(cand, hint, title) {
    if (!hint) return 0;
    if (tscore(hint, title) >= 0.9) return 0;
    return Math.max(
        tscore(hint, cand.album),
        tscore(hint, cand.artist),
        tscore(hint, cand.title) * 0.8
    );
}

function dscore(candDur, seconds) {
    if (!seconds || seconds <= 0 || !candDur) return 0;
    const diff = Math.abs(candDur - seconds);
    if (diff <= 5) return 0.35;
    if (diff <= 10) return 0.25;
    if (diff <= 20) return 0.15;
    const ratio = diff / Math.max(seconds, 1);
    if (ratio <= 0.15) return 0.08;
    if (ratio <= 0.3) return 0.03;
    return 0;
}

function pick(list, title, artist, seconds, hint) {
    if (!list.length) return { best: null, tscore: 0, album_hit: false };
    const scored = list.map((c, i) => {
        const ts = tscore(title, c.title);
        const as = artist ? tscore(artist, c.artist) : 0;
        const hs = hintscore(c, hint, title);
        const ds = dscore(c.duration, seconds);

        const htb = (hint && tscore(hint, title) < 0.9 && tscore(hint, c.title) >= 0.9) ? 0.2 : 0;
        return { c, i, ts, as, hs, ds, htb };
    });

    const matches = scored.filter(x => x.ts >= 0.8);
    const pool = matches.length ? matches : scored;

    const eff = x => x.ts + x.htb + x.hs * 0.15 + x.as * 0.1 + x.ds - x.i * 0.005;
    pool.sort((a, b) => eff(b) - eff(a));

    const top = pool[0];
    return { best: top.c, tscore: top.ts, album_hit: (top.hs + top.htb) >= 0.3 };
}

async function artof(c) {
    if (!c) return "";
    if (c.art) return c.art;
    if (c.release_group) return await musicbrainz.art(c.release_group);
    return "";
}

async function findart(q, title, artist, seconds, preferred) {
    const order = [preferred, ...Object.keys(providers).filter(p => p !== preferred)];
    for (const name of order) {
        const list = await candidates(q, name);
        if (!list.length) continue;

        const { best } = pick(list, title, artist, seconds, "");
        const tries = [best, ...list.filter(c => c !== best).slice(0, 2)];
        for (const c of tries) {
            const art = await artof(c);
            if (art) return art;
        }
    }
    return "";
}

async function resolve(st, cfg) {
    const key = st.uri || st.filename;
    if (cache.has(key)) return cache.get(key);

    const name = splitname(st.filename || "");

    const guessed_artist = name.numbered ? "" : name.hint;
    const album_hint = name.numbered ? name.hint : "";

    const vlc_artist = badartist(st.artist) ? "" : (st.artist || "");
    const vlc_title = st.title || "";

    let result = {
        title: vlc_title || name.title,
        artist: vlc_artist || (badartist(guessed_artist) ? "" : guessed_artist),
        album: st.album || album_hint,
        art: st.art || "",
        source: "vlc"
    };

    let have_local = false;
    if (cfg.local_first) {
        const tags = await local(st);
        if (tags) {
            result = { ...result, ...tags, art: st.art || "", source: "local" };
            have_local = true;
        }
    }

    const seconds = st.length || 0;
    const artist_bad = badartist(result.artist);

    const q_artist = artist_bad ? album_hint : result.artist;
    const q = `${q_artist} ${result.title}`.trim() || st.filename;
    const hint = album_hint || "";

    const list = await candidates(q, cfg.provider);
    const { best, tscore: ts, album_hit } = pick(list, result.title, artist_bad ? "" : result.artist, seconds, hint);

    let adopt = null;

    if (best && ts >= 0.8 && album_hit) {

        adopt = best;
    } else if (best && ts >= 0.8 && artist_bad) {

        adopt = best;
    } else if (best && ts >= 0.8) {

        const other = Object.keys(providers).find(p => p !== cfg.provider);
        const list2 = await candidates(q, other);
        const { best: best2 } = pick(list2, result.title, artist_bad ? "" : result.artist, seconds, hint);
        if (best2 && norm(best2.artist) === norm(best.artist)) {
            adopt = best;
        }
    } else if (best && ts >= 0.5 && (artist_bad || !result.artist)) {

        adopt = best;
    }

    if (adopt) {
        if (!have_local) {
            if (adopt.title) result.title = adopt.title;
            if (adopt.artist) result.artist = adopt.artist;
            if (adopt.album) result.album = adopt.album;
            result.source = cfg.provider;
        } else {

            if (!result.album && adopt.album) result.album = adopt.album;
        }
        const art = await artof(adopt);
        if (art) result.art = art;
    }

    if (!result.art && cfg.art_lookup) {
        const aq = `${result.artist} ${result.title}`.trim() || st.filename;
        result.art = await findart(aq, result.title, result.artist, seconds, cfg.provider);
    }

    if (result.art && result.art.startsWith("http")) {
        const cached = artcached(key);
        if (cached) {
            result.art_local = cached;
        } else {
            try {
                const res = await fetch(result.art, { signal: AbortSignal.timeout(5000) });
                if (res.ok) {
                    const buf = Buffer.from(await res.arrayBuffer());
                    const p = artsave(key, buf);
                    if (p) result.art_local = p;
                }
            } catch {  }
        }
    }

    if (result.art_local) result.art_small = resize(result.art_local);

    if (!result.title) result.title = st.filename || "unknown";
    cache.set(key, result);
    return result;
}

export { resolve };

