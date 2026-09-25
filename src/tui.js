import blessed from "blessed";
import fs from "fs";

const accents = {
    mint: "#56b87f",
    ocean: "#4a9eda",
    violet: "#9b6eda",
    ember: "#da7e4a",
    rose: "#da4a6e"
};

function imageproto() {
    const term = process.env.TERM || "";
    if (term.includes("kitty") || process.env.KITTY_WINDOW_ID) return "kitty";
    if (term.includes("sixel") || process.env.VTE_VERSION) return "sixel";
    return null;
}

function clock(seconds) {
    seconds = Math.max(0, Math.floor(seconds || 0));
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
}

function build(cfg, onkey) {
    let color = accents[cfg.accent] ?? accents.mint;
    const dim = "#7a8288";
    const screen = blessed.screen({ smartCSR: true, title: "rpvlc", dockBorders: true });

    const root = blessed.box({
        parent: screen,
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        border: { type: "line" },
        style: { border: { fg: color } },
        label: `{bold}{${color}-fg} rpvlc {/}{/}`,
        tags: true
    });

    const header = blessed.box({
        parent: root,
        top: 0,
        left: 1,
        right: 1,
        height: 1,
        tags: true
    });

    const now = blessed.box({
        parent: root,
        top: 1,
        left: 0,
        width: "62%",
        bottom: 10,
        border: { type: "line" },
        style: { border: { fg: color } },
        label: " now playing ",
        tags: true
    });

    const title = blessed.box({ parent: now, top: 0, left: 1, right: 1, height: 1, tags: true, style: { bold: true } });
    const artist = blessed.box({ parent: now, top: 1, left: 1, right: 1, height: 1, tags: true });
    const album = blessed.box({ parent: now, top: 2, left: 1, right: 1, height: 1, tags: true, style: { fg: dim } });
    const progressline = blessed.box({ parent: now, top: 4, left: 1, right: 1, height: 1, tags: true });
    const volline = blessed.box({ parent: now, top: 6, left: 1, right: 1, height: 1, tags: true });
    const stateline = blessed.box({ parent: now, top: 8, left: 1, right: 1, height: 1, tags: true, style: { fg: dim } });

    const proto = imageproto();
    let art_file = "";
    let art_id = 0;
    let art_transmitted = false;

    function kitty_write(seq) {

        try { process.stdout.write(seq); } catch {}
    }

    function kitty_transmit(buf, id) {

        const b64 = buf.toString("base64");
        const CHUNK = 4096;
        let i = 0;
        while (i < b64.length) {
            const chunk = b64.slice(i, i + CHUNK);
            const last = i + CHUNK >= b64.length;
            const hdr = i === 0 ? `f=100,a=t,q=2,i=${id}` : `i=${id}`;
            kitty_write(`\x1b_G${hdr},m=${last ? 0 : 1};${chunk}\x1b\\`);
            i += CHUNK;
        }
    }

    function kitty_place(id, row, col, cols, rows) {

        kitty_write(`\x1b[${row};${col}H\x1b_Ga=p,q=2,i=${id},c=${cols},r=${rows}\x1b\\`);
    }

    function kitty_delete(id) {
        kitty_write(`\x1b_Ga=d,q=2,i=${id}\x1b\\`);
    }

    const origRender = screen.render.bind(screen);
    screen.render = function (...args) {
        origRender(...args);
        if (proto === "kitty" && art_transmitted && art_id) {
            const avail_rows = Math.max(0, (now.height ?? 0) - 11);
            const cols = Math.min(32, Math.max(4, (now.width ?? 30) - 3));

            const rows = Math.min(avail_rows, Math.max(2, Math.round(cols / 2)));
            if (rows > 2) {
                const row = (now.atop ?? 0) + 11;

                const col = (now.aleft ?? 0) + 3;
                kitty_place(art_id, row, col, cols, rows);
            }
        }
    };

    function drawart(meta) {
        if (proto !== "kitty") return;

        let file = meta?.art_small || "";
        if (!file && meta?.art_local && /\.png$/i.test(meta.art_local)) file = meta.art_local;
        if (!file || file === art_file) return;

        if (art_id) kitty_delete(art_id);
        art_file = file;
        art_transmitted = false;
        try {
            const buf = fs.readFileSync(file);

            if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
                art_id = (art_id % 100) + 1;
                kitty_transmit(buf, art_id);
                art_transmitted = true;
            } else {
                art_id = 0;
            }
        } catch {
            art_id = 0;
            art_transmitted = false;
        }
    }

    const recent = blessed.list({
        parent: root,
        top: 1,
        left: "62%",
        right: 0,
        bottom: 10,
        border: { type: "line" },
        style: { border: { fg: color } },
        label: " recent ",
        tags: true,
        keys: false,
        mouse: false,
        scrollbar: { ch: " ", style: { bg: color } }
    });

    const logs = blessed.log({
        parent: root,
        bottom: 1,
        left: 0,
        right: 0,
        height: 9,
        border: { type: "line" },
        style: { border: { fg: color } },
        label: " logs ",
        tags: true,
        keys: false,
        mouse: false,
        scrollbar: { ch: " ", style: { bg: color } }
    });

    const footer = blessed.box({
        parent: root,
        bottom: 0,
        left: 0,
        right: 0,
        height: 1,
        tags: true
    });

    function drawfooter() {
        const k = (c, label) => `{${color}-fg}{bold}${c}{/} {${dim}-fg}${label}{/}`;
        footer.setContent(` ${k("p", "play/pause")}  ${k("n", "next")}  ${k("b", "back")}  ${k("←→", "seek")}  ${k("↑↓ [ ]", "vol")}  ${k("r", "shuffle")}  ${k("t", "repeat")}  ${k("s", "settings")}  ${k("q", "quit")} `);
    }
    drawfooter();

    function bar(pct, width) {
        width = Math.max(4, Math.floor(width));
        pct = Math.max(0, Math.min(100, pct));
        const filled = Math.round((pct / 100) * width);
        return `{${color}-fg}${"█".repeat(filled)}{/}{${dim}-fg}${"░".repeat(width - filled)}{/}`;
    }

    function dot(on, label) {
        return on
            ? `{${color}-fg}●{/} {${dim}-fg}${label}{/}`
            : `{${dim}-fg}○ ${label}{/}`;
    }

    screen.key(["q", "C-c"], () => onkey("quit"));
    screen.key(["p", "space"], () => onkey("toggle"));
    screen.key(["n"], () => onkey("next"));
    screen.key(["b"], () => onkey("prev"));
    screen.key(["]"], () => onkey("volup"));
    screen.key(["["], () => onkey("voldown"));
    screen.key(["up"], () => onkey("volup"));
    screen.key(["down"], () => onkey("voldown"));
    screen.key(["left"], () => onkey("seekback"));
    screen.key(["right"], () => onkey("seekfwd"));
    screen.key(["r"], () => onkey("shuffle"));
    screen.key(["t"], () => onkey("repeat"));
    screen.key(["s"], () => onkey("settings"));
    screen.key(["l"], () => onkey("launch"));

    function update(st, meta, status_line, extra = {}) {

        const vlc_on = !!st;
        const rpc_on = !!extra.rpc;
        const fm_on = !!extra.lastfm;
        const spin = extra.resolving ? ` {${color}-fg}⟳ resolving..{/}` : "";
        const fm_np = fm_on && st?.state === "playing" ? ` {${color}-fg}♫{/}` : "";
        header.setContent(` ${dot(vlc_on, "vlc")}   ${dot(rpc_on, "rpc")}   ${dot(fm_on, "lastfm")}${fm_np}   {${dim}-fg}provider: ${extra.provider ?? cfg.provider}{/}${spin}`);

        if (!st || !meta || !meta.title) {
            title.setContent(`{${dim}-fg}${status_line ?? "nothing playing"}{/}`);
            artist.setContent("");
            album.setContent("");
            progressline.setContent("");
            volline.setContent("");
            stateline.setContent("");
        } else {
            title.setContent(`{${color}-fg}${meta.title}{/}`);
            artist.setContent(meta.artist || "");
            album.setContent(meta.album || "");

            const elapsed = clock(st.time);
            const total = clock(st.length);
            const line_w = (typeof progressline.width === "number" ? progressline.width : 40);
            const bar_w = line_w - elapsed.length - total.length - 2;
            const pct = st.length ? (st.time / st.length) * 100 : 0;
            progressline.setContent(`{${dim}-fg}${elapsed}{/} ${bar(pct, bar_w)} {${dim}-fg}${total}{/}`);

            const volpct = Math.min(100, Math.round((st.volume / 256) * 100));
            const vol_bar_w = Math.max(4, line_w - 14);
            volline.setContent(`{${dim}-fg}vol{/} ${bar(volpct, vol_bar_w)} {${dim}-fg}${volpct}%{/}`);

            stateline.setContent(`source: ${meta.source}   state: ${st.state}   art: ${meta.art ? "yes" : "{#da4a6e-fg}no cover found{/}"}`);
            drawart(meta);
        }

        screen.render();
    }

    function logline(text) {
        const stamp = new Date().toTimeString().slice(0, 8);
        logs.log(`{${dim}-fg}${stamp}{/} ${text}`);
    }

    function recentlist(items) {
        recent.setItems(items.map(item => ` {${dim}-fg}${item.at}{/} ${item.artist ? item.artist + " — " : ""}${item.title}`));
    }

    function restyle(newcfg) {
        color = accents[newcfg.accent] ?? accents.mint;
        root.style.border.fg = color;
        now.style.border.fg = color;
        recent.style.border.fg = color;
        logs.style.border.fg = color;
        drawfooter();
        screen.render();
    }

    screen.render();

    return { screen, update, logline, recentlist, restyle, color: () => color };
}

export { build, accents, clock };

