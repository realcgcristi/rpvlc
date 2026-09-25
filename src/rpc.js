import net from "net";
import os from "os";
import fs from "fs";
import path from "path";
import crypto from "crypto";

let socket = null;
let alive = false;
let ready = false;
let client_id = "";
let log = () => {};
let retry = null;
let index = 0;
let warned = false;

let proto = null;
let frame_op = 1;

function sockets() {
    const list = [];

    if (process.platform === "win32") {
        for (let i = 0; i < 10; i++) list.push(`\\\\.\\pipe\\discord-ipc-${i}`);
        return list;
    }

    const runtime = process.env.XDG_RUNTIME_DIR;
    const dirs = [
        runtime,
        os.tmpdir(),
        "/tmp",
        runtime && path.join(runtime, "snap.discord"),
        runtime && path.join(runtime, "app/com.discordapp.Discord")
    ].filter(Boolean);

    const seen = new Set();
    for (const dir of dirs) {
        for (let i = 0; i < 10; i++) {
            const p = path.join(dir, `discord-ipc-${i}`);
            if (!seen.has(p)) {
                seen.add(p);
                list.push(p);
            }
        }
    }
    return list;
}

function frame(opcode, data) {
    const json = Buffer.from(JSON.stringify(data));
    const head = Buffer.alloc(8);
    head.writeInt32LE(opcode, 0);
    head.writeInt32LE(json.length, 4);
    return Buffer.concat([head, json]);
}

function send(data) {
    if (!ready || !socket) return;
    socket.write(frame(frame_op, data));
}

function handle(opcode, body) {
    let data;
    try {
        data = JSON.parse(body.toString());
    } catch {
        return;
    }

    if (!ready) {

        if (opcode === 0 && data.config) {
            proto = "discord";
            frame_op = 0;
            ready = true;
            warned = false;
            log("discord rpc connected");
            return;
        }

        if (opcode === 1 && (data.evt === "READY" || data.config || data.data?.config)) {
            proto = "arrpc";
            frame_op = 1;
            ready = true;
            warned = false;
            log("discord rpc connected (vesktop)");
            return;
        }
        return;
    }

    if (opcode === 3) {
        socket.write(frame(4, data ?? {}));
        return;
    }

    if (opcode === 2 && proto === "discord") {
        socket.write(frame(2, data ?? {}));
        return;
    }

    if ((opcode === 2 && proto === "arrpc") || (opcode === 1 && proto === "discord")) {
        socket.destroy();
        return;
    }

    if (data.cmd === "SET_ACTIVITY" && data.evt === "ERROR") {
        log(`discord rpc error: ${data.data?.message ?? "unknown"}`);
    }
}

function cleanup() {
    alive = false;
    ready = false;
    socket = null;
    proto = null;
    frame_op = 1;
}

function connect(id, logger) {
    client_id = id;
    if (logger) log = logger;
    attempt();
}

function attempt() {
    if (alive) return;

    const targets = sockets();

    while (index < targets.length && process.platform !== "win32" && !fs.existsSync(targets[index])) {
        index++;
    }

    if (index >= targets.length) {
        index = 0;
        if (!warned) {
            warned = true;
            log("discord ipc not found, is discord open?");
        }
        retry = setTimeout(attempt, 10000);
        return;
    }

    const target = targets[index];
    socket = net.connect(target);
    alive = true;
    let buffer = Buffer.alloc(0);

    socket.on("connect", () => {
        socket.write(frame(0, { v: 1, client_id }));
    });

    socket.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= 8) {
            const opcode = buffer.readInt32LE(0);
            const length = buffer.readInt32LE(4);
            if (length <= 0 || buffer.length < 8 + length) break;
            const body = buffer.slice(8, 8 + length);
            buffer = buffer.slice(8 + length);
            handle(opcode, body);
        }
    });

    socket.on("error", () => {
        socket.destroy();
    });

    socket.on("close", () => {
        const was_ready = ready;
        cleanup();
        if (!was_ready) index++;
        if (was_ready) log("discord connection lost, reconnecting");
        retry = setTimeout(attempt, was_ready ? 5000 : 300);
    });
}

function activity(a) {
    send({ cmd: "SET_ACTIVITY", args: { pid: process.pid, activity: a }, nonce: crypto.randomUUID() });
}

function clear() {
    send({ cmd: "SET_ACTIVITY", args: { pid: process.pid, activity: null }, nonce: crypto.randomUUID() });
}

function isready() {
    return ready;
}

function close() {
    clearTimeout(retry);
    if (socket) socket.destroy();
    cleanup();
}

export { connect, activity, clear, isready, close };

