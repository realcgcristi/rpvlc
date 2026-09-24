const host = ["itunes", "apple", "com"].join(".");

async function search(q) {
    try {
        const res = await fetch(`https://${host}/search?media=music&entity=song&limit=10&term=${encodeURIComponent(q)}`, {
            signal: AbortSignal.timeout(5000)
        });
        const data = await res.json();
        return (data.results ?? []).map(hit => ({
            title: hit.trackName ?? "",
            artist: hit.artistName ?? "",
            album: hit.collectionName ?? "",
            art: (hit.artworkUrl100 ?? "").replace("100x100", "600x600"),
            duration: Math.round((hit.trackTimeMillis ?? 0) / 1000)
        }));
    } catch {
        return [];
    }
}

export { search };

