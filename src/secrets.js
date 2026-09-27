import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";

const dir = process.platform === "win32"
    ? path.join(process.env.APPDATA || os.homedir(), "rpvlc")
    : path.join(os.homedir(), ".config", "rpvlc");

const SALT = "rpvlc-v1";

function machineid() {
    try {
        if (process.platform === "linux") {
            for (const p of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
                try {
                    const id = fs.readFileSync(p, "utf8").trim();
                    if (id) return id;
                } catch { }
            }
            return null;
        }
        if (process.platform === "win32") {
            const out = execFileSync("reg", ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"], { timeout: 4000 }).toString();
            const m = out.match(/MachineGuid\s+REG_SZ\s+([a-fA-F0-9-]+)/);
            return m ? m[1] : null;
        }
        if (process.platform === "darwin") {
            const out = execFileSync("ioreg", ["-d2", "-c", "IOPlatformExpertDevice"], { timeout: 4000 }).toString();
            const m = out.match(/IOPlatformUUID"\s*=\s*"([A-F0-9-]+)"/i);
            return m ? m[1] : null;
        }
    } catch { }
    return null;
}

function keyfile() {
    const p = path.join(dir, ".key");
    try {
        return fs.readFileSync(p);
    } catch { }
    try {
        fs.mkdirSync(dir, { recursive: true });
        const k = crypto.randomBytes(32);
        fs.writeFileSync(p, k, { mode: 0o600 });
        try { fs.chmodSync(p, 0o600); } catch { }
        return k;
    } catch {
        return null;
    }
}

let cached_key = null;
function getkey() {
    if (cached_key) return cached_key;
    const id = machineid();
    if (id) {
        let uid = "";
        try { uid = String(os.userInfo().uid); } catch { }
        cached_key = crypto.scryptSync(id + ":" + uid, SALT, 32, { N: 16384, r: 8, p: 1 });
        return cached_key;
    }
    cached_key = keyfile();
    return cached_key;
}

function encrypt(plain) {
    try {
        const key = getkey();
        if (!key) return plain;
        const iv = crypto.randomBytes(12);
        const c = crypto.createCipheriv("aes-256-gcm", key, iv);
        const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
        const tag = c.getAuthTag();
        return "enc:v1:" + Buffer.concat([iv, tag, enc]).toString("base64");
    } catch {
        return plain;
    }
}

function decrypt(blob) {
    try {
        if (typeof blob !== "string" || !blob.startsWith("enc:v1:")) return blob;
        const key = getkey();
        if (!key) return "";
        const raw = Buffer.from(blob.slice(7), "base64");
        const iv = raw.subarray(0, 12);
        const tag = raw.subarray(12, 28);
        const enc = raw.subarray(28);
        const d = crypto.createDecipheriv("aes-256-gcm", key, iv);
        d.setAuthTag(tag);
        return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
    } catch {
        return "";
    }
}

export { encrypt, decrypt };