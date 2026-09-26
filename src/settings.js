import blessed from "blessed";

import { save } from "./config.js";
import { accents } from "./tui.js";
import * as lastfm from "./lastfm.js";

function open(screen, cfg, onclose) {
    let color = accents[cfg.accent] ?? accents.mint;

    const box = blessed.box({
        parent: screen,
        top: "center",
        left: "center",
        width: 72,
        height: 24,
        border: { type: "line" },
        style: { border: { fg: color } },
        label: " settings ",
        tags: true
    });

    const list = blessed.list({
        parent: box,
        top: 1,
        left: 1,
        right: 1,
        bottom: 2,
        keys: false,
        mouse: false,
        style: { selected: { bg: color, fg: "black" } },
        tags: true
    });

    blessed.box({
        parent: box,
        bottom: 0,
        left: 1,
        right: 1,
        height: 1,
        tags: true,
        style: { fg: "gray" },
        content: " enter: change   esc: close   changes save instantly "
    });

    const input = blessed.textbox({
        parent: screen,
        top: "center",
        left: "center",
        width: 56,
        height: 3,
        hidden: true,
        border: { type: "line" },
        style: { border: { fg: color } },
        tags: true
    });

    function rows() {
        const fm = cfg.lastfm;
        const mask = (s) => (s ? "*".repeat(Math.min(s.length, 12)) : "-");
        return [
            { label: "provider", value: cfg.provider, type: "cycle", options: ["itunes", "deezer", "musicbrainz"], set: (v) => { cfg.provider = v; } },
            { label: "local first", value: cfg.local_first ? "on" : "off", type: "toggle", set: (v) => { cfg.local_first = v; } },
            { label: "art lookup", value: cfg.art_lookup ? "on" : "off", type: "toggle", set: (v) => { cfg.art_lookup = v; } },
            { label: "notifications", value: cfg.notify ? "on" : "off", type: "toggle", set: (v) => { cfg.notify = v; } },
            { label: "accent", value: cfg.accent, type: "cycle", options: Object.keys(accents), set: (v) => { cfg.accent = v; } },
            { label: "vlc password", value: mask(cfg.vlc_password), type: "edit", set: (v) => { cfg.vlc_password = v; } },
            { label: "vlc port", value: String(cfg.vlc_port), type: "edit", set: (v) => { cfg.vlc_port = Number(v) || 8080; } },
            { label: "discord client id", value: cfg.discord_client_id || "-", type: "edit", set: (v) => { cfg.discord_client_id = v; } },
            { label: "lastfm enabled", value: fm.enabled ? "on" : "off", type: "toggle", set: (v) => { fm.enabled = v; } },
            { label: "lastfm api key", value: mask(fm.api_key), type: "edit", set: (v) => { fm.api_key = v; } },
            { label: "lastfm api secret", value: mask(fm.api_secret), type: "edit", set: (v) => { fm.api_secret = v; } },
            { label: "lastfm username", value: fm.username || "-", type: "edit", set: (v) => { fm.username = v; } },
            { label: "lastfm password", value: fm.password ? mask(fm.password) : "-", type: "edit", set: (v) => { fm.password = v; } },
            { label: "lastfm connect", value: fm.session_key ? "connected" : "login", type: "action" },
            { label: "min duration (s)", value: String(fm.min_duration), type: "edit", set: (v) => { fm.min_duration = Math.max(30, Number(v) || 60); } },
            { label: "min listened (s)", value: String(fm.min_listened), type: "edit", set: (v) => { fm.min_listened = Math.max(30, Number(v) || 60); } },
            { label: "scrobble percent", value: String(fm.scrobble_percent), type: "edit", set: (v) => { fm.scrobble_percent = Math.max(30, Math.min(100, Number(v) || 50)); } }
        ];
    }

    function render() {
        list.setItems(rows().map(row => ` ${row.label.padEnd(20)} ${row.value}`));
        screen.render();
    }

    function restylebox() {
        color = accents[cfg.accent] ?? accents.mint;
        box.style.border.fg = color;
        input.style.border.fg = color;
        list.style.selected.bg = color;
    }

    function ask(label, done) {
        input.setLabel(` ${label} `);
        input.setValue("");
        input.show();
        screen.render();

        input.readInput((err, value) => {
            input.hide();
            list.focus();
            if (!err && value && value.trim()) done(value.trim());
            render();
        });
    }

    list.key(["up"], () => { list.up(); screen.render(); });
    list.key(["down"], () => { list.down(); screen.render(); });
    list.key(["escape", "q"], close);
    list.key(["enter"], () => {
        const row = rows()[list.selected];
        if (!row) return;

        if (row.type === "cycle") {
            const next = (row.options.indexOf(row.value) + 1) % row.options.length;
            row.set(row.options[next]);
            save(cfg);
            if (row.label === "accent") restylebox();
            render();
        } else if (row.type === "toggle") {
            row.set(row.value !== "on");
            save(cfg);
            render();
        } else if (row.type === "edit") {
            ask(row.label, (value) => {
                if (value && value !== "-") row.set(value);
                save(cfg);
                render();
            });
        } else if (row.type === "action") {
            lastfm.login(cfg.lastfm)
                .then((key) => {
                    cfg.lastfm.session_key = key;
                    cfg.lastfm.password = "";
                    cfg.lastfm.enabled = true;
                    save(cfg);
                    render();
                })
                .catch(() => render());
        }
    });

    function close() {
        save(cfg);
        input.detach();
        box.detach();
        screen.render();
        onclose();
    }

    list.focus();
    render();
}

export { open };

