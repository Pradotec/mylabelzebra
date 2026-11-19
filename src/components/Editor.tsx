import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer, Group, Rect, Ellipse, Image as KImage, Transformer, Line, Shape } from 'react-konva';
import type Konva from 'konva';
import { useStore } from '../store';
import type { LabelElement, TableEl } from '../types';
import { BASE_DPI } from '../types';
import { renderElementCanvas, elementHeight, hasFixedHeight, tableColumns, tableRows, fontString, renderLabel, labelSizeDots, incoCheck, incoIndices, isIncoMandatory, flowElements, rollColumns, rollGeometryU, type DrawCtx } from '../render/draw';
import { SideDialogs } from './SideDialogs';
import { keepsRatio } from '../render/codes';
import { shapeDef } from '../render/shapes';
import { conditionHolds } from '../render/resolve';
import { promptsVersion, onPromptsChange } from '../prompts';
import { ContextMenu, type CtxMenuState } from './ContextMenu';
import { t } from '../i18n';

const RULER = 22;
const RULER_GAP = 6;

const dataIds = new WeakMap<object, number>();
let dataSeq = 0;
const refId = (o: object | undefined) => {
  if (!o) return 0;
  let v = dataIds.get(o);
  if (!v) {
    v = ++dataSeq;
    dataIds.set(o, v);
  }
  return v;
};

interface Cached {
  key: string;
  canvas: HTMLCanvasElement;
  h: number;
}
const renderCache = new WeakMap<LabelElement, Cached>();

export function aabb(el: LabelElement, h: number) {
  if (!el.rotation) return { x: el.x, y: el.y, w: el.w, h };
  const a = (el.rotation * Math.PI) / 180;
  const cos = Math.cos(a),
    sin = Math.sin(a);
  const pts = [
    [0, 0],
    [el.w, 0],
    [el.w, h],
    [0, h],
  ].map(([px, py]) => [el.x + px * cos - py * sin, el.y + px * sin + py * cos]);
  const xs = pts.map((p) => p[0]),
    ys = pts.map((p) => p[1]);
  const x = Math.min(...xs),
    y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

interface DragState {
  kind: 'move';
  start: { x: number; y: number };
  items: { id: string; x: number; y: number }[];
  box: { x: number; y: number; w: number; h: number };
  moved: boolean;
  last: { dx: number; dy: number };
}
interface MarqueeState {
  kind: 'marquee';
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  additive: boolean;
}
interface GuideDrag {
  kind: 'guide';
  axis: 'x' | 'y';
  index: number; // -1 = nouveau
  pos: number;
}
interface TableDrag {
  kind: 'table';
  id: string;
  axis: 'c' | 'r';
  index: number;
  pos: number;
}
type Interaction = DragState | MarqueeState | GuideDrag | TableDrag | null;

/** Zone de l'écran non couverte par les barres et panneaux flottants (px écran). */
function freeArea(w: number, h: number, rightOpen: boolean, preview: boolean) {
  if (preview) return { l: 16, r: w - 16, t: 24, b: h - 80 };
  if (w <= 820) return { l: 15, r: w - 15, t: 110, b: h - 150 };
  // gauche : barre d'outils (112) + panneau propriétés/outils (292-300) + marge
  // droite : barre données (112) + panneau de droite ouvert (330) + marge
  let l = 428;
  let r = w - (rightOpen ? 458 : 128);
  // écran moyen : on renonce d'abord à réserver la place du panneau de gauche,
  // puis à celle du panneau de droite, plutôt que d'afficher une étiquette minuscule
  if (r - l < 260) l = 120;
  if (r - l < 260) r = w - 128;
  return { l, r, t: 128, b: h - 84 };
}

function fitZoom(a: { l: number; r: number; t: number; b: number }, W: number, H: number) {
  const f = Math.min((a.r - a.l) / W, (a.b - a.t) / H);
  return Math.max(0.15, Math.min(6, f));
}

export function Editor() {
  const doc = useStore((s) => s.doc);
  const zoom = useStore((s) => s.zoom);
  const pan = useStore((s) => s.pan);
  const selected = useStore((s) => s.selected);
  const grid = useStore((s) => s.grid);
  const preview = useStore((s) => s.preview);
  const previewRow = useStore((s) => s.previewRow);
  const showData = useStore((s) => s.showData);
  const imgVersion = useStore((s) => s.imgVersion);
  const editingTextId = useStore((s) => s.editingTextId);
  const fitRequest = useStore((s) => s.fitRequest);
  const rightPanel = useStore((s) => s.rightPanel);
  const thermal = useStore((s) => s.thermal);

  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [snapLines, setSnapLines] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] });
  const [inter, setInter] = useState<Interaction>(null);
  const interRef = useRef<Interaction>(null);
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);
  const [editCell, setEditCell] = useState<{ id: string; r: number; c: number } | null>(null);

  const W = doc.widthIn * BASE_DPI;
  const H = doc.heightIn * BASE_DPI;
  // décale l'étiquette quand un panneau latéral est ouvert (grand écran)
  // la place du panneau de propriétés (gauche) est toujours réservée pour éviter les sauts
  const rightOpen = !preview && !!rightPanel;
  const area = freeArea(size.w, size.h, rightOpen, preview);
  const ox = Math.round(pan.x + area.l + (area.r - area.l - W * zoom) / 2);
  const oy = Math.round(pan.y + area.t + (area.b - area.t - H * zoom) / 2);

  useLayoutEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // recadrage (chargement, changement de taille)
  useEffect(() => {
    const st = useStore.getState();
    const d = st.doc;
    const w = wrapRef.current?.clientWidth || window.innerWidth;
    const h = wrapRef.current?.clientHeight || window.innerHeight;
    const a = freeArea(w, h, !st.preview && !!st.rightPanel, st.preview);
    const fit = fitZoom(a, d.widthIn * BASE_DPI, d.heightIn * BASE_DPI);
    const z = d.zoom ? Math.min(d.zoom, fit) : fit;
    useStore.setState({ zoom: z, pan: { x: 0, y: 0 } });
  }, [fitRequest]);

  // ouverture d'un panneau / redimensionnement de la fenêtre : si l'étiquette
  // ne tient plus dans la zone libre, on dézoome pour qu'aucun panneau ne la masque
  useEffect(() => {
    const st = useStore.getState();
    const a = freeArea(size.w, size.h, rightOpen, preview);
    const fit = fitZoom(a, W, H);
    if (st.zoom > fit + 1e-3) useStore.setState({ zoom: fit, pan: { x: 0, y: 0 } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rightOpen, preview, size.w, size.h, W, H]);

  const pixelScale = useMemo(() => {
    const raw = zoom * (window.devicePixelRatio || 1);
    const q = Math.pow(1.25, Math.ceil(Math.log(raw) / Math.log(1.25)));
    return Math.min(8, Math.max(0.5, q));
  }, [zoom]);

  const resolve = showData || preview;
  const rctx: DrawCtx = useMemo(
    () => ({ doc, index: previewRow, row: doc.data?.rows[previewRow], resolve, scale: pixelScale, screen: !preview }),
    [doc, previewRow, resolve, pixelScale, preview],
  );
  const [pv, setPv] = useState(promptsVersion());
  useEffect(() => onPromptsChange(() => setPv(promptsVersion())), []);
  const ctxKey = `${pv}|${pixelScale}|${resolve}|${previewRow}|${imgVersion}|${doc.dpi}|${refId(doc.numbering)}|${refId(doc.date)}|${refId(doc.data)}|${doc.background}|${preview}`;

  const rendered = useMemo(() => {
    const out = new Map<string, Cached>();
    for (const el of doc.elements) {
      if (el.hidden) continue;
      let c = renderCache.get(el);
      if (!c || c.key !== ctxKey) {
        const r = renderElementCanvas(el, rctx);
        c = { key: ctxKey, canvas: r.canvas, h: r.h };
        renderCache.set(el, c);
      }
      out.set(el.id, c);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.elements, ctxKey]);

  // aperçu thermique : même chemin que le ZPL (rendu mono à la résolution de l'imprimante,
  // gris tramés en Bayer, codes en noir pur)
  const thermalCanvas = useMemo(() => {
    if (!thermal) return null;
    try {
      return renderLabel(doc, { index: previewRow, mono: true, pixelSize: labelSizeDots(doc) });
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thermal, doc, previewRow, imgVersion, pv]);

  const heightOf = (el: LabelElement) => rendered.get(el.id)?.h ?? elementHeight(el, rctx);

  // repères INCO : mention obligatoire dont la hauteur de x imprimée passe sous le seuil
  // (rouge plein : ligne affichée ; orange pointillé : d'autres lignes de données seulement)
  const incoMarks = useMemo(() => {
    if (preview || !doc.elements.some((e) => isIncoMandatory(e))) return [];
    const idx = incoIndices(doc, 500);
    if (!idx.includes(previewRow)) idx.push(previewRow);
    const out: { el: LabelElement; current: boolean }[] = [];
    for (const el of doc.elements)
      if (isIncoMandatory(el) && !el.hidden) {
        const r = incoCheck(el, doc, idx);
        if (r.failing.length) out.push({ el, current: r.failing.includes(previewRow) });
      }
    return out;
  }, [doc, previewRow, preview]);

  // aperçu : positions effectives (ancres verticales « remonter sous… » appliquées pour la ligne affichée)
  const flowY = useMemo(() => {
    if (!preview || !doc.elements.some((e) => e.anchorTo)) return null;
    return new Map(flowElements(doc, rctx).map((e) => [e.id, e.y]));
  }, [preview, doc, rctx, pv]); // eslint-disable-line react-hooks/exhaustive-deps

  // rouleau à plusieurs étiquettes de front : étiquettes voisines en aperçu (lignes suivantes du lot)
  const rollGhosts = useMemo(() => {
    if (rollColumns(doc) < 2) return null;
    const geo = rollGeometryU(doc);
    const n = doc.data?.rows.length ?? 0;
    const items = geo.offsets.slice(1).map((off, k) => {
      const index = n ? Math.min(n - 1, previewRow + k + 1) : previewRow;
      return { x: off - geo.offsets[0], canvas: renderLabel(doc, { index, scale: Math.min(pixelScale, 2) }) };
    });
    return { geo, items };
  }, [doc, previewRow, pixelScale, imgVersion, pv]); // eslint-disable-line react-hooks/exhaustive-deps

  const selEls = doc.elements.filter((e) => selected.includes(e.id) && !e.hidden);
  const transformable = selEls.filter((e) => !e.locked);

  // ---- Transformer ----
  useEffect(() => {
    const tr = trRef.current;
    const stage = stageRef.current;
    if (!tr || !stage) return;
    const nodes = preview || editingTextId ? [] : transformable.map((e) => stage.findOne('#' + e.id)).filter(Boolean);
    tr.nodes(nodes as Konva.Node[]);
    tr.getLayer()?.batchDraw();
  });

  const single = transformable.length === 1 ? transformable[0] : undefined;
  const keepRatio =
    !!single &&
    (single.type === 'qr' ||
      (single.type === 'barcode' && keepsRatio(single.symbology)) ||
      (single.type === 'image' && single.keepRatio) ||
      (single.type === 'mark' && single.kind === 'estimated') ||
      (single.type === 'shape' && (shapeDef(single.kind)?.category !== 'forme' || (shapeDef(single.kind) as { square?: boolean })?.square)));
  const autoHeightText = !!single && single.type === 'text' && !hasFixedHeight(single);

  const toLabel = (clientX: number, clientY: number) => {
    const r = wrapRef.current!.getBoundingClientRect();
    return { x: (clientX - r.left - ox) / zoom, y: (clientY - r.top - oy) / zoom, sx: clientX - r.left, sy: clientY - r.top };
  };

  // ---- snapping ----
  const snapBox = (box: { x: number; y: number; w: number; h: number }, ignore: Set<string>) => {
    const thr = 7 / zoom;
    const xs: number[] = [...doc.guides.x];
    const ys: number[] = [...doc.guides.y];
    if (grid.objects) {
      xs.push(0, W / 2, W);
      ys.push(0, H / 2, H);
      for (const e of doc.elements) {
        if (ignore.has(e.id) || e.hidden) continue;
        const b = aabb(e, heightOf(e));
        xs.push(b.x, b.x + b.w / 2, b.x + b.w);
        ys.push(b.y, b.y + b.h / 2, b.y + b.h);
      }
    }
    const best = (pts: number[], cands: number[]) => {
      let bd = thr + 1,
        delta = 0,
        line: number | null = null;
      for (const p of pts)
        for (const c of cands) {
          const d = Math.abs(c - p);
          if (d < bd) {
            bd = d;
            delta = c - p;
            line = c;
          }
        }
      return bd <= thr ? { delta, line } : null;
    };
    const bx = best([box.x, box.x + box.w / 2, box.x + box.w], xs);
    const by = best([box.y, box.y + box.h / 2, box.y + box.h], ys);
    let dx = bx?.delta ?? 0;
    let dy = by?.delta ?? 0;
    if (grid.snap && grid.size > 0) {
      if (!bx) dx = Math.round(box.x / grid.size) * grid.size - box.x;
      if (!by) dy = Math.round(box.y / grid.size) * grid.size - box.y;
    }
    return { dx, dy, lines: { x: bx?.line != null ? [bx.line] : [], y: by?.line != null ? [by.line] : [] } };
  };

  // ---- interactions globales (pointeur) ----
  useEffect(() => {
    if (!inter) return;
    const move = (e: PointerEvent) => {
      const cur = interRef.current;
      if (!cur) return;
      const p = toLabel(e.clientX, e.clientY);
      if (cur.kind === 'move') {
        let dx = p.x - cur.start.x;
        let dy = p.y - cur.start.y;
        if (!cur.moved && Math.hypot(dx * zoom, dy * zoom) < 3) return;
        cur.moved = true;
        const ignore = new Set(cur.items.map((i) => i.id));
        let lines = { x: [] as number[], y: [] as number[] };
        if (!e.altKey) {
          const s = snapBox({ ...cur.box, x: cur.box.x + dx, y: cur.box.y + dy }, ignore);
          dx += s.dx;
          dy += s.dy;
          lines = s.lines;
        }
        if (e.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        cur.last = { dx, dy };
        const stage = stageRef.current!;
        for (const it of cur.items) stage.findOne('#' + it.id)?.position({ x: it.x + dx, y: it.y + dy });
        trRef.current?.forceUpdate();
        stage.batchDraw();
        setSnapLines(lines);
      } else if (cur.kind === 'marquee') {
        const next = { ...cur, x1: p.x, y1: p.y };
        interRef.current = next;
        setInter(next);
      } else if (cur.kind === 'table') {
        const next = { ...cur, pos: cur.axis === 'c' ? p.x : p.y };
        interRef.current = next;
        setInter(next);
      } else if (cur.kind === 'guide') {
        const next = { ...cur, pos: cur.axis === 'x' ? p.x : p.y };
        interRef.current = next;
        setInter(next);
      }
    };
    const up = (e: PointerEvent) => {
      const cur = interRef.current;
      interRef.current = null;
      setInter(null);
      setSnapLines({ x: [], y: [] });
      if (!cur) return;
      const st = useStore.getState();
      if (cur.kind === 'move') {
        if (cur.moved) {
          const map = new Map(cur.items.map((i) => [i.id, i]));
          st.updateEls(
            cur.items.map((i) => i.id),
            (el) => ({ x: Math.round((map.get(el.id)!.x + cur.last.dx) * 100) / 100, y: Math.round((map.get(el.id)!.y + cur.last.dy) * 100) / 100 }),
          );
        }
      } else if (cur.kind === 'marquee') {
        const x = Math.min(cur.x0, cur.x1),
          y = Math.min(cur.y0, cur.y1);
        const w = Math.abs(cur.x1 - cur.x0),
          h = Math.abs(cur.y1 - cur.y0);
        if (w * zoom < 3 && h * zoom < 3) {
          if (!cur.additive) st.select([]);
          return;
        }
        const hit = st.doc.elements
          .filter((el) => !el.hidden)
          .filter((el) => {
            const b = aabb(el, heightOf(el));
            return b.x < x + w && b.x + b.w > x && b.y < y + h && b.y + b.h > y;
          })
          .map((el) => el.id);
        st.select(hit, cur.additive ? 'add' : 'set');
      } else if (cur.kind === 'table') {
        const el = st.doc.elements.find((x) => x.id === cur.id);
        if (el && el.type === 'table') commitTableResize(el, cur.axis, cur.index, cur.axis === 'c' ? cur.pos - el.x : cur.pos - el.y);
      } else if (cur.kind === 'guide') {
        const p = toLabel(e.clientX, e.clientY);
        const inRuler = st.grid.rulers && ((cur.axis === 'y' && p.sy < oy - RULER_GAP && p.sy > oy - RULER_GAP - RULER - 30) || (cur.axis === 'x' && p.sx < ox - RULER_GAP && p.sx > ox - RULER_GAP - RULER - 30));
        const outside = cur.axis === 'x' ? cur.pos < -W * 0.5 || cur.pos > W * 1.5 : cur.pos < -H * 0.5 || cur.pos > H * 1.5;
        st.setDoc((d) => {
          const arr = [...d.guides[cur.axis]];
          if (cur.index >= 0) arr.splice(cur.index, 1);
          if (!inRuler && !outside) arr.push(Math.round(cur.pos * 10) / 10);
          d.guides = { ...d.guides, [cur.axis]: arr };
        });
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inter ? inter.kind : null, ox, oy, zoom]);

  const begin = (s: Interaction) => {
    interRef.current = s;
    setInter(s);
  };

  // ---- pincement / appui long ----
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; mid: { x: number; y: number }; zoom: number; pan: { x: number; y: number } } | null>(null);
  const longPress = useRef<number | undefined>();

  const onPointerDownCapture = (e: React.PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.current.size === 2) {
      window.clearTimeout(longPress.current);
      interRef.current = null;
      setInter(null);
      const [a, b] = Array.from(touches.current.values());
      const st = useStore.getState();
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, zoom: st.zoom, pan: st.pan };
    } else {
      const sx = e.clientX,
        sy = e.clientY;
      window.clearTimeout(longPress.current);
      longPress.current = window.setTimeout(() => {
        const p = touches.current.get(e.pointerId);
        if (p && Math.hypot(p.x - sx, p.y - sy) < 10 && touches.current.size === 1) {
          interRef.current = null;
          setInter(null);
          setCtxMenu({ x: sx, y: sy });
        }
      }, 550);
    }
  };
  const onPointerMoveCapture = (e: React.PointerEvent) => {
    if (e.pointerType !== 'touch' || !touches.current.has(e.pointerId)) return;
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && touches.current.size >= 2) {
      const [a, b] = Array.from(touches.current.values());
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const p0 = pinch.current;
      const z = Math.max(0.1, Math.min(8, (p0.zoom * d) / p0.d));
      useStore.getState().setZoom(z);
      useStore.setState({ pan: { x: p0.pan.x + (mid.x - p0.mid.x), y: p0.pan.y + (mid.y - p0.mid.y) } });
    }
  };
  const onPointerUpCapture = (e: React.PointerEvent) => {
    touches.current.delete(e.pointerId);
    window.clearTimeout(longPress.current);
    if (touches.current.size < 2) pinch.current = null;
  };

  const lastDown = useRef({ id: '', t: 0 });
  // ---- événements Konva ----
  const onStageDown = (e: Konva.KonvaEventObject<PointerEvent>) => {
    if (preview || pinch.current) return;
    if ((e.evt as PointerEvent).button === 2) return;
    setCtxMenu(null);
    const target = e.target;
    if (target.getParent()?.className === 'Transformer') return;
    const name = target.name() || '';
    const st = useStore.getState();
    const p = toLabel(e.evt.clientX, e.evt.clientY);
    if (name === 'ruler-top' || name === 'ruler-left') {
      begin({ kind: 'guide', axis: name === 'ruler-top' ? 'y' : 'x', index: -1, pos: name === 'ruler-top' ? p.y : p.x });
      return;
    }
    if (name.startsWith('guide-')) {
      const [, axis, idx] = name.split('-');
      begin({ kind: 'guide', axis: axis as 'x' | 'y', index: +idx, pos: axis === 'x' ? p.x : p.y });
      return;
    }
    if (name.startsWith('tblh-')) {
      const [, axis, idx, id] = name.split('-');
      begin({ kind: 'table', id, axis: axis as 'c' | 'r', index: +idx, pos: axis === 'c' ? p.x : p.y });
      return;
    }
    if (name === 'el') {
      const id = target.id();
      // double-clic détecté à la main (plus fiable que dblclick avec le Transformer)
      const now = Date.now();
      if (lastDown.current.id === id && now - lastDown.current.t < 380) {
        lastDown.current = { id: '', t: 0 };
        e.evt.preventDefault();
        onDblClick(e as unknown as Konva.KonvaEventObject<MouseEvent>);
        return;
      }
      lastDown.current = { id, t: now };
      const additive = e.evt.shiftKey || e.evt.ctrlKey || e.evt.metaKey;
      if (additive) st.select([id], 'toggle', e.evt.altKey);
      else if (!st.selected.includes(id) || e.evt.altKey) st.select([id], 'set', e.evt.altKey);
      const sel = useStore.getState().selected;
      const items = useStore
        .getState()
        .doc.elements.filter((x) => sel.includes(x.id) && !x.locked && !x.hidden)
        .map((x) => ({ id: x.id, x: x.x, y: x.y }));
      if (!items.length || !sel.includes(id)) return;
      const els = useStore.getState().doc.elements.filter((x) => items.some((i) => i.id === x.id));
      const boxes = els.map((x) => aabb(x, heightOf(x)));
      const bx = Math.min(...boxes.map((b) => b.x)),
        by = Math.min(...boxes.map((b) => b.y));
      const box = { x: bx, y: by, w: Math.max(...boxes.map((b) => b.x + b.w)) - bx, h: Math.max(...boxes.map((b) => b.y + b.h)) - by };
      begin({ kind: 'move', start: { x: p.x, y: p.y }, items, box, moved: false, last: { dx: 0, dy: 0 } });
      return;
    }
    // vide → sélection rectangulaire
    begin({ kind: 'marquee', x0: p.x, y0: p.y, x1: p.x, y1: p.y, additive: e.evt.shiftKey || e.evt.ctrlKey || e.evt.metaKey });
  };

  const onDblClick = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (preview) return;
    const target = e.target;
    if (target.name() !== 'el') return;
    const el = doc.elements.find((x) => x.id === target.id());
    if (!el || el.locked) return;
    if (el.type === 'text') {
      useStore.setState({ editingTextId: el.id, selected: [el.id] });
    } else if (el.type === 'table') {
      const stage = stageRef.current!;
      const pos = stage.getPointerPosition()!;
      const lx = (pos.x - ox) / zoom - el.x,
        ly = (pos.y - oy) / zoom - el.y;
      const cw = tableColumns(el),
        rh = tableRows(el);
      let c = 0,
        acc = 0;
      while (c < el.cols - 1 && lx > acc + cw[c]) acc += cw[c++];
      let r = 0;
      acc = 0;
      while (r < el.rows - 1 && ly > acc + rh[r]) acc += rh[r++];
      setEditCell({ id: el.id, r, c });
    }
  };

  const onTransformEnd = () => {
    const tr = trRef.current!;
    const st = useStore.getState();
    const patches = new Map<string, Partial<LabelElement>>();
    for (const node of tr.nodes()) {
      const el = st.doc.elements.find((x) => x.id === node.id());
      if (!el) continue;
      const sx = Math.abs(node.scaleX()),
        sy = Math.abs(node.scaleY());
      const p: Record<string, unknown> = { x: Math.round(node.x() * 100) / 100, y: Math.round(node.y() * 100) / 100, rotation: Math.round(node.rotation() * 100) / 100, w: Math.max(4, el.w * sx) };
      if (el.type === 'text') {
        // redimensionner la boîte ne change pas la police : seule la zone d'impression change
        if (hasFixedHeight(el)) p.h = Math.max(4, el.h * sy);
      } else p.h = Math.max(2, el.h * sy);
      node.scaleX(1);
      node.scaleY(1);
      patches.set(el.id, p as Partial<LabelElement>);
    }
    st.updateEls(Array.from(patches.keys()), (el) => patches.get(el.id)!);
  };

  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const st = useStore.getState();
    if (e.evt.ctrlKey || e.evt.metaKey) {
      const r = wrapRef.current!.getBoundingClientRect();
      const mx = e.evt.clientX - r.left,
        my = e.evt.clientY - r.top;
      const px = (mx - ox) / zoom,
        py = (my - oy) / zoom;
      const z = Math.max(0.1, Math.min(8, zoom * Math.pow(1.0015, -e.evt.deltaY)));
      st.setZoom(z);
      // inverse du calcul de ox / oy : le point sous la souris reste fixe
      useStore.setState({ pan: { x: mx - px * z - area.l - (area.r - area.l - W * z) / 2, y: my - py * z - area.t - (area.b - area.t - H * z) / 2 } });
    } else {
      const dx = e.evt.shiftKey ? e.evt.deltaY : e.evt.deltaX;
      const dy = e.evt.shiftKey ? 0 : e.evt.deltaY;
      useStore.setState({ pan: { x: st.pan.x - dx, y: st.pan.y - dy } });
    }
  };

  const onContextMenu = (e: Konva.KonvaEventObject<PointerEvent>) => {
    e.evt.preventDefault();
    if (preview) return;
    const target = e.target;
    if (target.name() === 'el' && !useStore.getState().selected.includes(target.id())) useStore.getState().select([target.id()]);
    setCtxMenu({ x: e.evt.clientX, y: e.evt.clientY });
  };

  // ---- dessin de la grille et des règles ----
  const unitU = grid.unit === 'mm' ? BASE_DPI / 25.4 : BASE_DPI;
  const drawRulerTop = (ctx: Konva.Context) => {
    const c = ctx._context;
    const x0 = 0,
      w = W * zoom;
    c.fillStyle = '#ffffff';
    c.fillRect(-40, 0, w + 80, RULER);
    c.fillStyle = '#4a5470';
    c.strokeStyle = '#9aa3b8';
    c.font = '10px Segoe UI, Arial';
    c.textBaseline = 'top';
    const step = grid.unit === 'mm' ? 1 : 1 / 8;
    const n = Math.ceil((W / unitU) / step) + 1;
    c.beginPath();
    for (let i = 0; i <= n; i++) {
      const v = i * step;
      const x = x0 + v * unitU * zoom;
      if (x > w + 0.5) break;
      const major = grid.unit === 'mm' ? i % 10 === 0 : i % 8 === 0;
      const mid = grid.unit === 'mm' ? i % 5 === 0 : i % 4 === 0;
      if (!major && step * unitU * zoom < 3) continue;
      const len = major ? 12 : mid ? 8 : 4;
      c.moveTo(Math.round(x) + 0.5, RULER);
      c.lineTo(Math.round(x) + 0.5, RULER - len);
      if (major) c.fillText(String(Math.round(v)), x + 2, 1);
    }
    c.stroke();
  };
  const drawRulerLeft = (ctx: Konva.Context) => {
    const c = ctx._context;
    const h = H * zoom;
    c.fillStyle = '#ffffff';
    c.fillRect(0, -40, RULER, h + 80);
    c.fillStyle = '#4a5470';
    c.strokeStyle = '#9aa3b8';
    c.font = '10px Segoe UI, Arial';
    const step = grid.unit === 'mm' ? 1 : 1 / 8;
    const n = Math.ceil((H / unitU) / step) + 1;
    c.beginPath();
    for (let i = 0; i <= n; i++) {
      const v = i * step;
      const y = v * unitU * zoom;
      if (y > h + 0.5) break;
      const major = grid.unit === 'mm' ? i % 10 === 0 : i % 8 === 0;
      const mid = grid.unit === 'mm' ? i % 5 === 0 : i % 4 === 0;
      if (!major && step * unitU * zoom < 3) continue;
      const len = major ? 12 : mid ? 8 : 4;
      c.moveTo(RULER, Math.round(y) + 0.5);
      c.lineTo(RULER - len, Math.round(y) + 0.5);
      if (major) {
        c.textBaseline = 'top';
        c.font = '9px Segoe UI, Arial';
        c.fillText(String(Math.round(v)), 1, y + 2);
      }
    }
    c.stroke();
  };
  const drawGrid = (ctx: Konva.Context) => {
    const c = ctx._context;
    const step = grid.size * zoom;
    if (step < 4) return;
    c.strokeStyle = 'rgba(80,110,170,0.18)';
    c.lineWidth = 1;
    c.beginPath();
    for (let x = step; x < W * zoom; x += step) {
      c.moveTo(Math.round(x) + 0.5, 0);
      c.lineTo(Math.round(x) + 0.5, H * zoom);
    }
    for (let y = step; y < H * zoom; y += step) {
      c.moveTo(0, Math.round(y) + 0.5);
      c.lineTo(W * zoom, Math.round(y) + 0.5);
    }
    c.stroke();
  };

  const editingEl = editingTextId ? (doc.elements.find((e) => e.id === editingTextId) as LabelElement | undefined) : undefined;
  const singleTable = selEls.length === 1 && selEls[0].type === 'table' && !selEls[0].locked && !selEls[0].rotation ? (selEls[0] as TableEl) : undefined;
  const marquee = inter?.kind === 'marquee' ? inter : null;
  const guideDrag = inter?.kind === 'guide' ? inter : null;

  const BIG = 100000;
  return (
    <div
      ref={wrapRef}
      className="stage-wrap"
      style={{ touchAction: 'none', cursor: inter?.kind === 'guide' ? (inter.axis === 'x' ? 'ew-resize' : 'ns-resize') : undefined }}
      onPointerDownCapture={onPointerDownCapture}
      onPointerMoveCapture={onPointerMoveCapture}
      onPointerUpCapture={onPointerUpCapture}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Stage
        ref={stageRef}
        width={size.w}
        height={size.h}
        onPointerDown={onStageDown}
        onWheel={onWheel}
        onContextMenu={onContextMenu}
      >
        <Layer imageSmoothingEnabled={!thermalCanvas}>
          {rollGhosts && (
            <Group x={ox} y={oy} scaleX={zoom} scaleY={zoom} listening={false} name="roll-preview">
              <Rect x={-rollGhosts.geo.left} y={-6 / zoom} width={rollGhosts.geo.totalW} height={H + 12 / zoom} fill="rgba(22,33,62,0.05)" stroke="#b8c0d4" strokeWidth={1 / zoom} dash={[6 / zoom, 4 / zoom]} />
              {rollGhosts.items.map((g, k) => (
                <KImage key={k} image={g.canvas} x={g.x} y={0} width={W} height={H} opacity={0.5} />
              ))}
            </Group>
          )}
          <Group x={ox} y={oy}>
            {doc.round ? (
              <Ellipse x={(W * zoom) / 2} y={(H * zoom) / 2} radiusX={(W * zoom) / 2} radiusY={(H * zoom) / 2} fill={doc.background || '#fff'} shadowColor="#16213e" shadowBlur={24} shadowOpacity={0.14} shadowOffsetY={6} />
            ) : (
              <Rect width={W * zoom} height={H * zoom} fill={doc.background || '#fff'} cornerRadius={preview ? 8 : 4} shadowColor="#16213e" shadowBlur={24} shadowOpacity={0.14} shadowOffsetY={6} />
            )}
            {grid.show && !preview && <Shape sceneFunc={drawGrid} listening={false} />}
          </Group>
          <Group
            x={ox}
            y={oy}
            scaleX={zoom}
            scaleY={zoom}
            clipFunc={
              doc.round
                ? (ctx) => {
                    ctx.ellipse(W / 2, H / 2, W / 2, H / 2, 0, 0, Math.PI * 2);
                  }
                : (ctx) => {
                    ctx.rect(0, 0, W, H);
                  }
            }
          >
            {doc.elements.map((el) => {
              if (el.hidden) return null;
              const r = rendered.get(el.id);
              if (!r) return null;
              // condition d'affichage non remplie pour cette ligne : masqué en aperçu, estompé sinon
              const off = resolve && !!el.showIf && !conditionHolds(el.showIf, rctx);
              if (off && preview) return null;
              return (
                <KImage
                  key={el.id}
                  id={el.id}
                  name="el"
                  x={el.x}
                  y={flowY?.get(el.id) ?? el.y}
                  width={el.w}
                  height={r.h}
                  rotation={el.rotation}
                  image={r.canvas}
                  opacity={thermalCanvas ? 0 : editingTextId === el.id ? 0.15 : off ? 0.18 : 1}
                  perfectDrawEnabled={false}
                />
              );
            })}
            {thermalCanvas && <KImage image={thermalCanvas} x={0} y={0} width={W} height={H} listening={false} />}
          </Group>
          {!preview && (
            <Group x={ox} y={oy} scaleX={zoom} scaleY={zoom} listening={false}>
              {doc.round && <Rect width={W} height={H} stroke="#b8c0d4" strokeWidth={1 / zoom} dash={[4 / zoom, 4 / zoom]} />}
              {incoMarks.map(({ el, current }) => {
                const b = aabb(el, heightOf(el));
                const p = 3 / zoom;
                return (
                  <Rect
                    key={'inco' + el.id}
                    name="inco-mark"
                    x={b.x - p}
                    y={b.y - p}
                    width={b.w + 2 * p}
                    height={b.h + 2 * p}
                    stroke={current ? '#e53e3e' : '#f5a524'}
                    strokeWidth={(current ? 2 : 1.5) / zoom}
                    dash={current ? undefined : [6 / zoom, 4 / zoom]}
                    fill={current ? 'rgba(229,62,62,0.06)' : undefined}
                  />
                );
              })}
              {selEls
                .filter((e) => e.locked || selEls.length > 1)
                .map((e) => {
                  const b = aabb(e, heightOf(e));
                  return <Rect key={'s' + e.id} x={b.x} y={b.y} width={b.w} height={b.h} stroke={e.locked ? '#8a93ab' : '#ff5a36'} strokeWidth={1.5 / zoom} dash={[5 / zoom, 4 / zoom]} />;
                })}
            </Group>
          )}
          {!preview && (
            <Group x={ox} y={oy} scaleX={zoom} scaleY={zoom}>
              {doc.guides.x.map((g, i) => (
                <Line key={'gx' + i} name={`guide-x-${i}`} points={[g, -BIG, g, BIG]} stroke="#14b8a6" strokeWidth={1 / zoom} hitStrokeWidth={8 / zoom} opacity={guideDrag?.index === i && guideDrag.axis === 'x' ? 0 : 1} />
              ))}
              {doc.guides.y.map((g, i) => (
                <Line key={'gy' + i} name={`guide-y-${i}`} points={[-BIG, g, BIG, g]} stroke="#14b8a6" strokeWidth={1 / zoom} hitStrokeWidth={8 / zoom} opacity={guideDrag?.index === i && guideDrag.axis === 'y' ? 0 : 1} />
              ))}
              {guideDrag && (guideDrag.axis === 'x' ? <Line points={[guideDrag.pos, -BIG, guideDrag.pos, BIG]} stroke="#14b8a6" strokeWidth={1 / zoom} dash={[4 / zoom, 3 / zoom]} listening={false} /> : <Line points={[-BIG, guideDrag.pos, BIG, guideDrag.pos]} stroke="#14b8a6" strokeWidth={1 / zoom} dash={[4 / zoom, 3 / zoom]} listening={false} />)}
              {snapLines.x.map((x, i) => (
                <Line key={'sx' + i} points={[x, -40, x, H + 40]} stroke="#ff2d87" strokeWidth={1 / zoom} listening={false} />
              ))}
              {snapLines.y.map((y, i) => (
                <Line key={'sy' + i} points={[-40, y, W + 40, y]} stroke="#ff2d87" strokeWidth={1 / zoom} listening={false} />
              ))}
              {marquee && (
                <Rect
                  x={Math.min(marquee.x0, marquee.x1)}
                  y={Math.min(marquee.y0, marquee.y1)}
                  width={Math.abs(marquee.x1 - marquee.x0)}
                  height={Math.abs(marquee.y1 - marquee.y0)}
                  fill="rgba(255,90,54,0.08)"
                  stroke="#ff5a36"
                  strokeWidth={1 / zoom}
                  listening={false}
                />
              )}
              {singleTable && <TableHandles el={singleTable} zoom={zoom} drag={inter?.kind === 'table' ? inter : null} />}
            </Group>
          )}
          {!preview && grid.rulers && (
            <>
              <Group x={ox} y={oy - RULER - RULER_GAP}>
                <Shape name="ruler-top" sceneFunc={drawRulerTop} hitFunc={(ctx, shape) => { ctx.beginPath(); ctx.rect(-40, 0, W * zoom + 80, RULER); ctx.closePath(); ctx.fillStrokeShape(shape); }} />
              </Group>
              <Group x={ox - RULER - RULER_GAP} y={oy}>
                <Shape name="ruler-left" sceneFunc={drawRulerLeft} hitFunc={(ctx, shape) => { ctx.beginPath(); ctx.rect(0, -40, RULER, H * zoom + 80); ctx.closePath(); ctx.fillStrokeShape(shape); }} />
              </Group>
            </>
          )}
          <Transformer
            ref={trRef}
            visible={!preview}
            rotateEnabled
            rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
            rotationSnapTolerance={4}
            keepRatio={keepRatio}
            enabledAnchors={autoHeightText ? ['middle-left', 'middle-right'] : undefined}
            anchorSize={9}
            anchorCornerRadius={5}
            anchorStroke="#ff5a36"
            borderStroke="#ff5a36"
            anchorFill="#fff"
            padding={2}
            ignoreStroke
            boundBoxFunc={(oldB, newB) => (Math.abs(newB.width) < 4 || Math.abs(newB.height) < 2 ? oldB : newB)}
            onTransformEnd={onTransformEnd}
          />
        </Layer>
      </Stage>
      {editingEl && editingEl.type === 'text' && (
        <TextOverlay el={editingEl} ox={ox} oy={oy} zoom={zoom} h={heightOf(editingEl)} />
      )}
      {editCell && <CellOverlay cell={editCell} ox={ox} oy={oy} zoom={zoom} onDone={() => setEditCell(null)} />}
      {ctxMenu && <ContextMenu state={ctxMenu} onClose={() => setCtxMenu(null)} />}
      <SideDialogs />
    </div>
  );
}

function commitTableResize(el: TableEl, axis: 'c' | 'r', i: number, pos: number) {
  const st = useStore.getState();
  const sizes = axis === 'c' ? tableColumns(el) : tableRows(el);
  const start = sizes.slice(0, i).reduce((a, b) => a + b, 0);
  const pair = sizes[i] + sizes[i + 1];
  const min = axis === 'c' ? 10 : 8;
  const a = Math.max(min, Math.min(pair - min, pos - start));
  const next = [...sizes];
  next[i] = a;
  next[i + 1] = pair - a;
  const total = axis === 'c' ? el.w : el.h;
  const rel = next.map((v) => Math.round((v / total) * 1000) / 1000);
  st.updateEls([el.id], (axis === 'c' ? { colWidths: rel } : { rowHeights: rel }) as Partial<LabelElement>);
}

/** Poignées de redimensionnement des colonnes / lignes d'un tableau sélectionné */
function TableHandles({ el, zoom, drag }: { el: TableEl; zoom: number; drag: TableDrag | null }) {
  const cw = tableColumns(el);
  const rh = tableRows(el);
  const hs: JSX.Element[] = [];
  const cursor = (c: string) => (e: Konva.KonvaEventObject<MouseEvent>) => void (e.target.getStage()!.container().style.cursor = c);
  let acc = 0;
  for (let i = 0; i < el.cols - 1; i++) {
    acc += cw[i];
    hs.push(<Rect key={'c' + i} name={`tblh-c-${i}-${el.id}`} x={el.x + acc - 5 / zoom} y={el.y} width={10 / zoom} height={el.h} fill="rgba(255,90,54,0.12)" onMouseEnter={cursor('col-resize')} onMouseLeave={cursor('')} />);
  }
  acc = 0;
  for (let i = 0; i < el.rows - 1; i++) {
    acc += rh[i];
    hs.push(<Rect key={'r' + i} name={`tblh-r-${i}-${el.id}`} x={el.x} y={el.y + acc - 5 / zoom} width={el.w} height={10 / zoom} fill="rgba(255,90,54,0.12)" onMouseEnter={cursor('row-resize')} onMouseLeave={cursor('')} />);
  }
  if (drag && drag.id === el.id)
    hs.push(
      drag.axis === 'c' ? (
        <Line key="pv" points={[drag.pos, el.y, drag.pos, el.y + el.h]} stroke="#ff5a36" strokeWidth={2 / zoom} dash={[4 / zoom, 3 / zoom]} listening={false} />
      ) : (
        <Line key="pv" points={[el.x, drag.pos, el.x + el.w, drag.pos]} stroke="#ff5a36" strokeWidth={2 / zoom} dash={[4 / zoom, 3 / zoom]} listening={false} />
      ),
    );
  return <>{hs}</>;
}

function TextOverlay({ el, ox, oy, zoom, h }: { el: Extract<LabelElement, { type: 'text' }>; ox: number; oy: number; zoom: number; h: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const opened = useRef(Date.now());
  useEffect(() => {
    const ta = ref.current!;
    const f = () => {
      ta.focus();
      ta.select();
    };
    f();
    const tm = setTimeout(f, 30);
    return () => clearTimeout(tm);
  }, []);
  const done = () => useStore.setState({ editingTextId: null });
  return (
    <textarea
      ref={ref}
      className="text-editor"
      aria-label={t('Modifier le texte')}
      value={el.text}
      spellCheck={false}
      onChange={(e) => useStore.getState().updateEls([el.id], { text: e.target.value } as Partial<LabelElement>, 'edit-' + el.id)}
      onBlur={() => {
        if (Date.now() - opened.current < 250) {
          setTimeout(() => ref.current?.focus(), 0);
          return;
        }
        done();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) done();
      }}
      style={{
        left: ox + el.x * zoom,
        top: oy + el.y * zoom,
        width: el.w * zoom,
        height: Math.max(h, el.fontSize * 1.2) * zoom + 4,
        font: fontString(el, el.fontSize * zoom),
        lineHeight: el.lineHeight,
        textAlign: el.align,
        color: el.invert ? '#fff' : el.color,
        background: el.invert ? el.color : 'rgba(255,255,255,0.94)',
        transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
        padding: el.invert ? Math.round(el.fontSize * 0.18 * zoom) : 0,
      }}
    />
  );
}

function CellOverlay({ cell, ox, oy, zoom, onDone }: { cell: { id: string; r: number; c: number }; ox: number; oy: number; zoom: number; onDone: () => void }) {
  const el = useStore((s) => s.doc.elements.find((e) => e.id === cell.id)) as TableEl | undefined;
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const f = () => {
      ref.current?.focus();
      ref.current?.select();
    };
    f();
    const tm = setTimeout(f, 30);
    return () => clearTimeout(tm);
  }, []);
  if (!el) return null;
  const cw = tableColumns(el),
    rh = tableRows(el);
  const x = el.x + cw.slice(0, cell.c).reduce((a, b) => a + b, 0);
  const y = el.y + rh.slice(0, cell.r).reduce((a, b) => a + b, 0);
  const val = el.cells[cell.r]?.[cell.c] ?? '';
  const setVal = (v: string) => {
    const cells = el.cells.map((r) => [...r]);
    cells[cell.r][cell.c] = v;
    useStore.getState().updateEls([el.id], { cells } as Partial<LabelElement>, `cell-${el.id}-${cell.r}-${cell.c}`);
  };
  return (
    <input
      ref={ref}
      className="text-editor"
      aria-label={t('Cellule')}
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onBlur={onDone}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' || e.key === 'Escape') onDone();
      }}
      style={{
        left: ox + x * zoom,
        top: oy + y * zoom,
        width: cw[cell.c] * zoom,
        height: rh[cell.r] * zoom,
        fontSize: el.fontSize * zoom,
        fontFamily: el.fontFamily,
        fontWeight: el.headerRow && cell.r === 0 ? 700 : 400,
        padding: `0 ${el.fontSize * 0.3 * zoom}px`,
      }}
    />
  );
}

