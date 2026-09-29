/**
 * Name tokens. Engine events, lesson copy and catalogue blurbs never embed a vendor / product / protocol name directly:
 * they embed a token that `resolveText` (lib/data/names.ts) swaps for the fictional or real name at render time, so
 * toggling the skin also re-labels text that was written earlier (ledger entries, saved messages).
 *
 *   {v:ID} vendor name   {vs:ID} vendor short code   {c:ID} vendor country
 *   {m:ID} module name   {p:ID} R&D project name     {x:PROTOCOL} protocol   {xs:PROTOCOL} protocol short
 */
export const vt = (id: string) => `{v:${id}}`;
export const vst = (id: string) => `{vs:${id}}`;
export const ct = (id: string) => `{c:${id}}`;
export const mt = (id: string) => `{m:${id}}`;
export const pt = (id: string) => `{p:${id}}`;
export const xt = (protocol: string) => `{x:${protocol}}`;
export const xst = (protocol: string) => `{xs:${protocol}}`;
