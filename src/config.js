import fs from "fs";
import os from "os";
import path from "path";

const dir = process.platform === "win32"
    ? path.join(process.env.APPDATA || os.homedir(), "rpvlc")
    : path.join(os.homedir(), ".config", "rpvlc");

const file = path.join(dir, "config.json");
const history = path.join(dir, "history.json");

const CONFIG_VERSION = 1;

const defaults = {
    version: CONFIG_VERSION,
    provider: "itunes",
    local_first: true,
    art_lookup: true,
    vlc_password: "rpvlc",
    vlc_port: 8080,
    discord_client_id: "1549846257206558861",
    accent: "mint",
    notify: false,
    lastfm: {
        enabled: false,
        api_key: "",
        api_secret: "",
        username: "",
        password: "",
        session_key: "",
        min_duration: 60,
        min_listened: 60,
        scrobble_percent: 50
    }
};

function load() {
    try {
        const saved = JSON.parse(fs.readFileSync(file, "utf8"));
        const merged = { ...defaults, ...saved, lastfm: { ...defaults.lastfm, ...(saved.lastfm || {}) } };

        merged.version = CONFIG_VERSION;
        return merged;
    } catch {
        return { ...defaults, lastfm: { ...defaults.lastfm } };
    }
}

function save(cfg) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(cfg, null, 4));
}

function loadhistory() {
    try {
        return JSON.parse(fs.readFileSync(history, "utf8"));
    } catch {
        return [];
    }
}

function savehistory(items) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(history, JSON.stringify(items.slice(0, 50), null, 4));
}

const cachedir = process.platform === "win32"
    ? path.join(process.env.LOCALAPPDATA || os.tmpdir(), "rpvlc", "art")
    : path.join(os.homedir(), ".cache", "rpvlc", "art");

function artpath(key) {
    const safe = key.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 80);
    return path.join(cachedir, safe + ".jpg");
}

function artcached(key) {
    try {
        const p = artpath(key);
        if (fs.existsSync(p) && fs.statSync(p).size > 0) return p;
    } catch {  }
    return null;
}

function artsave(key, buffer) {
    try {
        fs.mkdirSync(cachedir, { recursive: true });
        fs.writeFileSync(artpath(key), buffer);
        return artpath(key);
    } catch {
        return null;
    }
}

export { load, save, loadhistory, savehistory, cachedir, artpath, artcached, artsave };

