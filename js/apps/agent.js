// js/apps/agent.js – Zugang zum App-Agenten im Browser. Die Logik liegt in shared/agent-core.js (läuft auch auf dem Server).
import { KINDS } from './templates.js';
const A = () => window.CodenAgent;
export const systemPrompt = (o) => A().systemPrompt(o);
export const parse = (t) => A().parse(t);
export const apply = (f, o) => A().apply(f, o);
export const condense = (t) => A().condense(t);
export const check = (f) => A().check(f, { syntax: (code) => { try { new Function(code); return null; } catch (e) { return e.message; } } });
export const kindLabel = (k) => KINDS[k]?.label || k;
