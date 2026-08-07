export function resolveRetrievalQuery ({ retrievalQuery, message } = {}) {
    const explicitQuery = String(retrievalQuery || '').trim();
    if (explicitQuery) return explicitQuery;
    return String(message || '').trim();
}
