async function search(q) {
    try {
        const res = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=10`, {
            signal: AbortSignal.timeout(5000)
        });
        const data = await res.json();
        return (data.data ?? []).map(hit => ({
            title: hit.title ?? "",
            artist: hit.artist?.name ?? "",
            album: hit.album?.title ?? "",
            art: hit.album?.cover_big ?? "",
            duration: hit.duration ?? 0
        }));
    } catch {
        return [];
    }
}

export { search };

