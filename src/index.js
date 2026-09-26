import { spawn } from "child_process";
import * as config from "./config.js";
import * as vlc from "./vlc.js";
import * as meta from "./meta.js";
import * as rpc from "./rpc.js";
import * as lastfm from "./lastfm.js";
import * as tui from "./tui.js";
import * as settings from "./settings.js";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

if (flag("version")) {
    console.log("rpvlc 0.1.0");
    process.exit(0);
}
if (flag("help")) {
    console.log(`rpvlc — discord rpc for vlc with a tui

usage: rpvlc [options]

options:
  --port <n>        vlc http port (default: from config or 8080)
  --password <s>    vlc http password (default: from config)
  --provider <p>    metadata provider: itunes, deezer, musicbrainz
  --no-rpc          disable discord rpc
  --headless        no tui, just rpc in the terminal
  --debug           verbose logging
  --version         print version
  --help            this message`);
    process.exit(0);
}

const cfg = config.load();
config.save(cfg);

if (opt("port", null)) cfg.vlc_port = Number(opt("port", cfg.vlc_port));
if (opt("password", null)) cfg.vlc_password = opt("password", cfg.vlc_password);
if (opt("provider", null)) cfg.provider = opt("provider", cfg.provider);
const no_rpc = flag("no-rpc");
const headless = flag("headless");
const debug = flag("debug");

let ui = null;
let log;

if (!headless) {
    ui = tui.build(cfg, onkey);
    log = ui.logline;
} else {
    log = (msg) => {
        const stamp = new Date().toTimeString().slice(0, 8);
        console.log(`[${stamp}] ${msg}`);
    };
}

const recent = config.loadhistory();
if (ui) ui.recentlist(recent);

let phase = "searching";
let warned = false;
let current = null;
let last_rpc = 0;
let settings_open = false;
let resolving = false;

log("rpvlc started");
if (debug) log(`config: port=${cfg.vlc_port} provider=${cfg.provider} local_first=${cfg.local_first}`);

if (!no_rpc && cfg.discord_client_id) {
    rpc.connect(cfg.discord_client_id, log);
} else if (no_rpc) {
    log("rpc disabled via --no-rpc");
} else {
    log("no discord client id set, rpc off");
}

function shutdown() {
    log("shutting down");
    rpc.clear();
    rpc.close();
    if (ui) ui.screen.destroy();
    setTimeout(() => process.exit(0), 200);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function fmready() {
    const fm = cfg.lastfm;
    return fm.enabled && fm.session_key && fm.api_key && fm.api_secret;
}

function extra() {
    return { rpc: rpc.isready(), lastfm: fmready(), provider: cfg.provider, resolving };
}

function upd(...args) {
    if (ui && !settings_open) ui.update(...args);
}

async function pushrpc(force) {
    if (no_rpc || !rpc.isready()) return;
    const now = Date.now();
    if (!force && now - last_rpc < 15000) return;
    last_rpc = now;

    if (!current || current.st.state !== "playing") {
        rpc.clear();
        return;
    }

    const st = current.st;
    const m = current.meta;
    const activity = {
        type: 2,
        details: (m.title || "unknown").slice(0, 128),
        timestamps: {}
    };

    if (m.artist) activity.state = m.artist.slice(0, 128);
    if (st.length > 0) {
        activity.timestamps.start = now - st.time * 1000;
        activity.timestamps.end = now + (st.length - st.time) * 1000;
    } else {
        activity.timestamps.start = now;
    }
    if (m.art) activity.assets = { large_image: m.art, large_text: m.album || "" };

    rpc.activity(activity);
}

function notify(m) {
    if (!cfg.notify) return;
    const summary = m.artist ? `${m.artist} — ${m.title}` : m.title;
    if (process.platform === "linux") {
        spawn("notify-send", ["rpvlc", summary], { stdio: "ignore" }).unref();
    } else if (process.platform === "darwin") {
        spawn("osascript", ["-e", `display notification "${summary}" with title "rpvlc"`], { stdio: "ignore" }).unref();
    }
}

async function trackchange(st) {
    resolving = true;
    upd(st, current?.meta, "resolving metadata..", extra());

    const m = await meta.resolve(st, cfg);
    resolving = false;
    current = {
        key: st.uri || st.filename,
        st,
        meta: m,
        played: 0,
        started: Math.floor(Date.now() / 1000),
        scrobbled: false
    };

    log(`now playing: ${m.artist ? m.artist + " - " : ""}${m.title} [${m.source}]`);
    notify(m);

    recent.unshift({
        at: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        title: m.title,
        artist: m.artist
    });
    if (recent.length > 50) recent.pop();
    config.savehistory(recent);
    if (ui) ui.recentlist(recent);

    if (fmready()) {
        lastfm.nowplaying(cfg.lastfm, m.artist || "unknown", m.title, m.album).catch(() => {});
    }

    await pushrpc(true);
}

async function checkscrobble() {
    if (!current || current.scrobbled || !fmready()) return;

    const fm = cfg.lastfm;
    const st = current.st;
    const min_duration = Math.max(30, fm.min_duration || 60);
    const min_listened = Math.max(30, fm.min_listened || 60);
    const percent = Math.max(30, fm.scrobble_percent || 50);

    if (st.length > 0 && st.length < min_duration) return;

    const hit_time = current.played >= min_listened;
    const hit_percent = st.length > 0 && (current.played / st.length) * 100 >= percent;

    if (hit_time || hit_percent) {
        current.scrobbled = true;
        try {
            await lastfm.scrobble(fm, current.meta.artist || "unknown", current.meta.title, current.meta.album, current.started);
            log("scrobbled to last.fm");
        } catch {
            log("last.fm scrobble failed");
        }
    }
}

async function tick() {
    const st = await vlc.status(cfg);

    if (!st) {
        current = null;
        const alive = await vlc.running();

        if (!alive) {
            if (phase !== "launching") {
                log("no vlc found. launching one for you..");
                phase = "launching";
                const ok = await vlc.launch(cfg);
                if (!ok) {
                    log("could not launch vlc, is it installed?");
                    phase = "searching";
                }
            }
            upd(null, null, "launching vlc..", extra());
        } else {

            if (phase !== "scanning") {
                phase = "scanning";
                log("vlc running but not on our port, scanning..");
                const found = await vlc.scan(cfg);
                if (found) {
                    cfg.vlc_port = found;
                    config.save(cfg);
                    log(`found vlc on port ${found}`);
                    phase = "ok";
                } else {
                    if (!warned) {
                        warned = true;
                        log("vlc is running but the http interface is off");
                        log("close vlc and let rpvlc relaunch it, or enable web interface in vlc prefs");
                    }
                    phase = "searching";
                }
            }
            upd(null, null, "vlc found, http interface off", extra());
        }
        return;
    }

    if (phase !== "ok") {
        phase = "ok";
        warned = false;
        log(`vlc connected on port ${cfg.vlc_port}`);
    }

    const key = st.uri || st.filename;

    if (key && (!current || current.key !== key)) {
        await trackchange(st);
    } else if (current) {
        current.st = st;
        if (st.state === "playing") current.played += 1;
    }

    if (!key && st.state === "stopped") {
        current = null;
        upd(st, null, "vlc idle", extra());
    } else if (current) {
        upd(st, current.meta, "", extra());
    }

    await checkscrobble();
    await pushrpc(false);
}

async function onkey(key) {
    if (settings_open) return;

    if (key === "quit") {
        shutdown();
        return;
    }

    if (key === "settings") {
        if (settings_open || !ui) return;
        settings_open = true;
        settings.open(ui.screen, cfg, () => {
            settings_open = false;
            ui.restyle(cfg);
            ui.recentlist(recent);
        });
        return;
    }

    if (key === "launch") {
        log("launching vlc..");
        phase = "launching";
        await vlc.launch(cfg);
        return;
    }

    if (key === "toggle") { await vlc.command(cfg, "pl_pause"); return; }
    if (key === "next") { await vlc.command(cfg, "pl_next"); return; }
    if (key === "prev") { await vlc.command(cfg, "pl_previous"); return; }
    if (key === "shuffle") { await vlc.command(cfg, "pl_random"); log("shuffle toggled"); return; }
    if (key === "repeat") { await vlc.command(cfg, "pl_loop"); log("repeat toggled"); return; }
    if (key === "seekfwd") { await vlc.command(cfg, "seek", "%2B10"); return; }
    if (key === "seekback") { await vlc.command(cfg, "seek", "-10"); return; }

    const st = await vlc.status(cfg);
    if (!st) return;
    if (key === "volup") await vlc.command(cfg, "volume", Math.min(500, st.volume + 26));
    if (key === "voldown") await vlc.command(cfg, "volume", Math.max(0, st.volume - 26));
}

setInterval(tick, 1000);
tick();

