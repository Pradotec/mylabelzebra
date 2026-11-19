/**
 * Client Zebra Browser Print (service local installé par Zebra).
 * Points d'accès : /available, /default, /write, /read sur http://127.0.0.1:9100 ou https://127.0.0.1:9101.
 */
import { prefGet, prefSet } from './storage';

export interface ZebraDevice {
  name: string;
  uid: string;
  connection: string;
  deviceType: string;
  provider?: string;
  manufacturer?: string;
  version?: number;
}

export interface PrinterSettings {
  darkness?: number;
  speed?: number;
  dpi?: number;
  widthDots?: number;
  lengthDots?: number;
  model?: string;
}

export interface PrinterStatus {
  ok: boolean;
  paperOut: boolean;
  paused: boolean;
  headOpen: boolean;
  ribbonOut: boolean;
  raw: string;
}

const BASES = ['http://127.0.0.1:9100', 'https://127.0.0.1:9101'];
let base: string | null = null;

async function fetchT(url: string, init: RequestInit = {}, ms = 2500) {
  const ctl = new AbortController();
  const tm = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(tm);
  }
}

async function call(path: string, init?: RequestInit, ms?: number): Promise<Response> {
  const list = base ? [base, ...BASES.filter((b) => b !== base)] : BASES;
  let lastErr: unknown;
  for (const b of list) {
    try {
      const r = await fetchT(b + path, init, ms);
      base = b;
      return r;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('Browser Print indisponible');
}

export class BrowserPrintMissing extends Error {}

export async function isAvailable(): Promise<boolean> {
  try {
    await call('/default?type=printer', undefined, 1500);
    return true;
  } catch {
    return false;
  }
}

export async function getDefaultPrinter(): Promise<ZebraDevice | null> {
  try {
    const r = await call('/default?type=printer');
    const txt = await r.text();
    if (!txt.trim()) return null;
    return JSON.parse(txt) as ZebraDevice;
  } catch {
    throw new BrowserPrintMissing();
  }
}

export async function listPrinters(): Promise<ZebraDevice[]> {
  try {
    const r = await call('/available', undefined, 6000);
    const j = await r.json();
    return ((j.printer || []) as ZebraDevice[]).filter(Boolean);
  } catch {
    throw new BrowserPrintMissing();
  }
}

export async function write(device: ZebraDevice, data: string): Promise<void> {
  const r = await call('/write', { method: 'POST', body: JSON.stringify({ device, data }), headers: { 'Content-Type': 'text/plain;charset=UTF-8' } }, 20000);
  if (!r.ok) throw new Error('Erreur d’envoi (' + r.status + ')');
}

export async function read(device: ZebraDevice): Promise<string> {
  const r = await call('/read', { method: 'POST', body: JSON.stringify({ device }), headers: { 'Content-Type': 'text/plain;charset=UTF-8' } }, 5000);
  return r.text();
}

/** Envoie une commande puis lit la réponse (plusieurs tentatives) */
export async function query(device: ZebraDevice, cmd: string, tries = 6): Promise<string> {
  await write(device, cmd);
  let acc = '';
  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const part = await read(device).catch(() => '');
    acc += part;
    if (acc && !part) break;
  }
  return acc;
}

export function parseHostStatus(raw: string): PrinterStatus {
  // ~HS : chaîne 1 = aaa,b,c,... (b = papier épuisé, c = pause) ; chaîne 2 = mmm,n,o,p,... (o = tête ouverte, p = ruban épuisé)
  const lines = raw
    .split(/[\x02\x03\r\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const f1 = (lines[0] || '').split(',');
  const f2 = (lines[1] || '').split(',');
  const paperOut = f1[1] === '1';
  const paused = f1[2] === '1';
  const headOpen = f2[2] === '1';
  const ribbonOut = f2[3] === '1';
  return { ok: !paperOut && !paused && !headOpen && !ribbonOut && lines.length > 0, paperOut, paused, headOpen, ribbonOut, raw };
}

export async function getStatus(device: ZebraDevice): Promise<PrinterStatus> {
  return parseHostStatus(await query(device, '~HS'));
}

export function parseSettings(hi: string, hh: string): PrinterSettings {
  const s: PrinterSettings = {};
  const dm = /(\d{3})\s*dpi/i.exec(hi) || /(\d{3})\s*DPI/.exec(hh);
  if (dm) s.dpi = +dm[1];
  const model = hi.replace(/[\x02\x03]/g, '').split(',')[0]?.trim();
  if (model) s.model = model;
  const num = (re: RegExp) => {
    const m = re.exec(hh);
    return m ? parseFloat(m[1]) : undefined;
  };
  s.darkness = num(/([+-]?\d+(?:\.\d+)?)\s+DARKNESS/i);
  s.speed = num(/(\d+(?:\.\d+)?)\s*IPS\s+PRINT SPEED/i);
  s.widthDots = num(/(\d+)\s+PRINT WIDTH/i);
  s.lengthDots = num(/(\d+)\s+LABEL LENGTH/i);
  if (!s.dpi) {
    const r = /(\d+)\s*DOTS\/MM|(\d+)\s*DPMM/i.exec(hh);
    if (r) s.dpi = Math.round(+(r[1] || r[2]) * 25.4);
  }
  return s;
}

export async function readSettings(device: ZebraDevice): Promise<PrinterSettings> {
  const hi = await query(device, '~HI').catch(() => '');
  const hh = await query(device, '^XA^HH^XZ', 10).catch(() => '');
  return parseSettings(hi, hh);
}

export function settingsZpl(s: PrinterSettings): string {
  let z = '';
  if (s.darkness != null) z += `~SD${String(Math.max(0, Math.min(30, Math.round(s.darkness)))).padStart(2, '0')}`;
  if (s.speed != null) z += `^XA^PR${Math.max(1, Math.min(14, Math.round(s.speed)))}^XZ`;
  return z;
}

const key = (d: ZebraDevice) => 'zebra.settings.' + (d.uid || d.name);
export const savedSettings = (d: ZebraDevice) => prefGet<PrinterSettings>(key(d), {});
export const saveSettings = (d: ZebraDevice, s: PrinterSettings) => prefSet(key(d), s);
export const lastPrinter = () => prefGet<ZebraDevice | null>('zebra.last', null);
export const rememberPrinter = (d: ZebraDevice | null) => prefSet('zebra.last', d);

export const BROWSER_PRINT_URL = 'https://www.zebra.com/us/en/support-downloads/software/printer-software/browser-print.html';
