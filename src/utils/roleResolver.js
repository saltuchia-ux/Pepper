// Finds a role by mention, ID or (fuzzy) name. Same matching rules as .grole / .trole.
// Returns { role } or { error }.

function normalizeName(text) {
    return String(text)
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function similarity(a, b) {
    if (a === b) return 1;
    if (!a.length || !b.length) return 0;

    const rows = a.length + 1;
    const cols = b.length + 1;
    const dist = Array.from({ length: rows }, (_, i) => {
        const row = new Array(cols).fill(0);
        row[0] = i;
        return row;
    });

    for (let j = 0; j < cols; j++) dist[0][j] = j;

    for (let i = 1; i < rows; i++) {
        for (let j = 1; j < cols; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            dist[i][j] = Math.min(dist[i - 1][j] + 1, dist[i][j - 1] + 1, dist[i - 1][j - 1] + cost);
        }
    }

    return 1 - dist[a.length][b.length] / Math.max(a.length, b.length);
}

export async function findRole(guild, text) {
    const query = String(text).trim();

    if (!query) return { error: 'Role not found' };

    // @Role mention or role ID
    const idMatch = query.match(/^<@&(\d+)>$/) || query.match(/^(\d{15,25})$/);
    if (idMatch) {
        const byId = await guild.roles.fetch(idMatch[1]).catch(() => null);
        if (byId) return { role: byId };
    }

    await guild.roles.fetch().catch(() => null);

    const roles = [...guild.roles.cache.values()]
        .filter((r) => r.id !== guild.id) // skip @everyone
        .map((r) => ({ role: r, clean: normalizeName(r.name) }));

    const lowered = query.toLowerCase();
    const normalized = normalizeName(query);

    // Shortest name first (closest in size), then the higher role if still tied
    const closest = (list) =>
        [...list].sort((a, b) => a.clean.length - b.clean.length || b.role.position - a.role.position)[0].role;

    const exact = roles.filter((r) => r.role.name.toLowerCase() === lowered);
    if (exact.length) return { role: closest(exact) };

    if (normalized) {
        const same = roles.filter((r) => r.clean === normalized);
        if (same.length) return { role: closest(same) };

        const starts = roles.filter((r) => r.clean.startsWith(normalized));
        if (starts.length) return { role: closest(starts) };

        const contains = roles.filter((r) => r.clean.includes(normalized));
        if (contains.length) return { role: closest(contains) };

        let best = null;
        let bestScore = 0;

        for (const r of roles) {
            if (!r.clean) continue;

            const score = Math.max(
                similarity(normalized, r.clean),
                similarity(normalized, r.clean.slice(0, normalized.length)),
            );

            if (score > bestScore) {
                best = r;
                bestScore = score;
            }
        }

        if (best && bestScore >= 0.5) return { role: best.role };
    }

    return { error: `I could not find a role close to **${query}**.` };
}
