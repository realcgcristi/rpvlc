const headers = { "user-agent": "rpvlc/1.0 ( discord rpc for vlc )" };
const mb_host = ["musicbrainz", "org"].join(".");
const ca_host = ["coverartarchive", "org"].join(".");

async function search(q) {
    try {
        const res = await fetch(`https://${mb_host}/ws/2/recording?query=${encodeURIComponent(q)}&fmt=json&limit=10`, {
            headers,
            signal: AbortSignal.timeout(5000)
        });
        const data = await res.json();
        return (data.recordings ?? []).map(hit => ({
            title: hit.title ?? "",
            artist: hit["artist-credit"]?.map(c => c.name).join("") ?? "",
            album: hit.releases?.[0]?.title ?? "",
            art: "",
            duration: Math.round((hit.length ?? 0) / 1000),
            release_group: hit["release-group"]?.id ?? hit.releases?.[0]?.["release-group"]?.id ?? ""
        }));
    } catch {
        return [];
    }
}

async function art(release_group) {
    if (!release_group) return "";
    try {
        const res = await fetch(`https://${ca_host}/release-group/${release_group}`, {
            headers,
            signal: AbortSignal.timeout(5000)
        });
        if (!res.ok) return "";
        const data = await res.json();
        return data.images?.[0]?.thumbnails?.large ?? data.images?.[0]?.image ?? "";
    } catch {
        return "";
    }
}

export { search, art };

