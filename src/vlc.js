import { spawn, execFile } from "child_process";
import fs from "fs";
import path from "path";

function base(cfg) {
    return `http://127.0.0.1:${cfg.vlc_port}`;
}

function auth(cfg) {
    return "Basic " + Buffer.from(`:${cfg.vlc_password}`).toString("base64");
}

function shape(data) {
    const meta = data.information?.category?.meta ?? {};
    return {
        state: data.state ?? "stopped",
        time: data.time ?? 0,
        length: data.length ?? 0,
        volume: data.volume ?? 0,
        title: meta.title ?? "",
        artist: meta.artist ?? "",
        album: meta.album ?? "",
        filename: meta.filename ?? "",
        uri: meta.uri ?? "",
        art: meta.artwork_url ?? ""
    };
}

async function status(cfg) {
    try {
        const res = await fetch(`${base(cfg)}/requests/status.json`, {
            headers: { authorization: auth(cfg) },
            signal: AbortSignal.timeout(2000)
        });
        if (!res.ok) throw new Error("bad status");
        return shape(await res.json());
    } catch {
        return await xmlstatus(cfg);
    }
}

async function xmlstatus(cfg) {
    try {
        const res = await fetch(`${base(cfg)}/requests/status.xml`, {
            headers: { authorization: auth(cfg) },
            signal: AbortSignal.timeout(2000)
        });
        if (!res.ok) return null;
        const text = await res.text();
        const grab = (tag) => text.match(new RegExp(`<${tag}>(.*?)</${tag}>`))?.[1] ?? "";
        const meta = (name) => text.match(new RegExp(`<meta name="${name}">(.*?)</meta>`))?.[1] ?? "";
        return {
            state: grab("state"),
            time: Number(grab("time")) || 0,
            length: Number(grab("length")) || 0,
            volume: Number(grab("volume")) || 0,
            title: meta("title"),
            artist: meta("artist"),
            album: meta("album"),
            filename: meta("filename"),
            uri: meta("uri"),
            art: ""
        };
    } catch {
        return null;
    }
}

async function command(cfg, cmd, val) {
    let url = `${base(cfg)}/requests/status.json?command=${cmd}`;
    if (val !== undefined) url += `&val=${encodeURIComponent(val)}`;
    try {
        await fetch(url, { headers: { authorization: auth(cfg) }, signal: AbortSignal.timeout(2000) });
        return true;
    } catch {
        return false;
    }
}

async function running() {
    if (process.platform === "win32") {
        return new Promise((resolve) => {
            execFile("tasklist", ["/FI", "IMAGENAME eq vlc.exe"], (err, out) => resolve(!err && out.includes("vlc.exe")));
        });
    }
    return new Promise((resolve) => {
        execFile("pgrep", ["-xi", "vlc"], (err) => resolve(!err));
    });
}

function windowsbinary() {
    const roots = [process.env["ProgramFiles"], process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA].filter(Boolean);
    for (const root of roots) {
        const exe = path.join(root, "VideoLAN", "VLC", "vlc.exe");
        if (fs.existsSync(exe)) return exe;
    }
    return null;
}

async function launch(cfg) {
    const args = ["--extraintf", "http", "--http-password", cfg.vlc_password, "--http-port", String(cfg.vlc_port)];

    if (process.platform === "darwin") {
        spawn("open", ["-a", "VLC", "--args", ...args], { detached: true, stdio: "ignore" }).unref();
        return true;
    }

    if (process.platform === "win32") {
        const exe = windowsbinary();
        if (!exe) return false;
        spawn(exe, args, { detached: true, stdio: "ignore" }).unref();
        return true;
    }

    const found = await new Promise((resolve) => {
        execFile("which", ["vlc"], (err, out) => resolve(err ? null : out.trim().split("\n")[0]));
    });
    if (!found) return false;
    spawn(found, args, { detached: true, stdio: "ignore" }).unref();
    return true;
}

async function scan(cfg) {
    for (let port = 8080; port <= 8090; port++) {
        if (port === cfg.vlc_port) continue;
        try {
            const res = await fetch(`http://127.0.0.1:${port}/requests/status.json`, {
                headers: { authorization: "Basic " + Buffer.from(`:${cfg.vlc_password}`).toString("base64") },
                signal: AbortSignal.timeout(800)
            });
            if (res.ok) return port;
        } catch {  }
    }

    for (let port = 8080; port <= 8090; port++) {
        if (port === cfg.vlc_port) continue;
        try {
            const res = await fetch(`http://127.0.0.1:${port}/requests/status.json`, {
                signal: AbortSignal.timeout(800)
            });
            if (res.ok) return port;
        } catch {  }
    }
    return null;
}

export { status, command, running, launch, scan };

