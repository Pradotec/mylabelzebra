import { useEffect, useMemo, useRef, useState } from 'react';
import { ScanLine, FileUp, Copy, Download, Printer, PenSquare, RefreshCw } from 'lucide-react';
import { useStore } from '../store';
import { Modal, NumField, Seg } from './ui';
import { t } from '../i18n';
import { parseZpl, renderZplLabel, zplLabelToElements, lintZpl, type ZLabel } from '../zpl/parse';
import { generateBatchZpl } from '../zpl/generate';
import { copyText, downloadText, pickFile, safeFileName } from '../util';
import { sendToZebra } from '../actions';
import { newDoc } from '../elements';

/** ZPL à afficher à la prochaine ouverture (fichier .zpl déposé sur l'éditeur) */
let pendingCode: string | null = null;
export function openZplViewer(code?: string) {
  pendingCode = code ?? null;
  useStore.getState().set('modal', 'zpl');
}

export function ZplViewer() {
  const st = useStore();
  const close = () => st.set('modal', null);
  const generated = () => generateBatchZpl(st.doc, st.previewRow);
  // pendingCode est vidé après le montage (l'initialiseur peut être appelé deux fois en StrictMode)
  const [code, setCode] = useState<string>(() => pendingCode ?? generated());
  useEffect(() => {
    pendingCode = null;
  }, []);
  const [labels, setLabels] = useState<ZLabel[]>([]);
  const [dpi, setDpi] = useState(String(st.doc.dpi));
  const [wIn, setW] = useState(st.doc.widthIn);
  const [hIn, setH] = useState(st.doc.heightIn);
  const [err, setErr] = useState('');
  const [page, setPage] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    const tm = setTimeout(async () => {
      try {
        const ls = await parseZpl(code);
        if (!alive) return;
        setLabels(ls);
        setErr(ls.length ? '' : t('Aucune étiquette ^XA…^XZ détectée'));
        setPage((p) => Math.min(p, Math.max(0, ls.length - 1)));
      } catch (e) {
        if (alive) setErr((e as Error).message);
      }
    }, 250);
    return () => {
      alive = false;
      clearTimeout(tm);
    };
  }, [code]);

  const lab = labels[page];
  const lint = useMemo(() => lintZpl(code), [code]);
  const d = +dpi;
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    box.innerHTML = '';
    if (!lab) return;
    const W = lab.width || Math.round(wIn * d);
    const H = lab.height || Math.round(hIn * d);
    const cv = renderZplLabel(lab, W, H);
    cv.style.maxWidth = '100%';
    cv.style.maxHeight = '52vh';
    cv.style.boxShadow = '0 2px 12px rgba(0,0,0,.18)';
    cv.style.background = '#fff';
    cv.style.imageRendering = 'auto';
    box.appendChild(cv);
  }, [lab, d, wIn, hIn]);

  const openFile = async () => {
    const f = await pickFile('.zpl,.txt,.prn');
    if (f) setCode(await f.text());
  };
  const toEditor = () => {
    if (!lab) return;
    const W = lab.width || Math.round(wIn * d);
    const H = lab.height || Math.round(hIn * d);
    const doc = newDoc({ name: t('Importé depuis ZPL'), widthIn: W / d, heightIn: H / d, dpi: d });
    doc.elements = zplLabelToElements(lab, d / 203);
    st.loadDoc(doc, true);
    close();
    st.toast(t('ZPL converti en étiquette modifiable (approximation des polices)'), 'ok');
  };

  return (
    <Modal
      title={t('Visionneuse ZPL')}
      wide
      icon={<ScanLine size={20} />}
      onClose={close}
      footer={
        <>
          <button className="btn flat" onClick={openFile}>
            <FileUp size={16} /> {t('Ouvrir un fichier .zpl')}
          </button>
          <button className="btn flat" onClick={() => setCode(generated())}>
            <RefreshCw size={16} /> {t('ZPL de l’étiquette actuelle')}
          </button>
          <button className="btn flat" onClick={async () => (await copyText(code)) && st.toast(t('ZPL copié'), 'ok')}>
            <Copy size={16} /> {t('Copier')}
          </button>
          <button className="btn flat" onClick={() => downloadText(code, safeFileName(st.doc.name) + '.zpl')}>
            <Download size={16} /> .zpl
          </button>
          <button className="btn" onClick={toEditor} disabled={!lab}>
            <PenSquare size={16} /> {t('Ouvrir dans l’éditeur')}
          </button>
          <button className="btn accent" onClick={() => sendToZebra(code, false)} title={t('Le code ci-dessus est envoyé tel quel, sans modification')}>
            <Printer size={16} /> {t('Imprimer sur Zebra')}
          </button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.2fr)', gap: 16 }}>
        <div>
          <textarea className="inp code" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.stopPropagation()} style={{ height: '52vh', fontSize: 11.5, whiteSpace: 'pre', overflow: 'auto' }} aria-label={t('Code ZPL')} />
          <div className="hint" style={{ marginTop: 6 }}>
            {t('{n} caractères', { n: code.length })} · {t('Collez votre ZPL ou ouvrez un fichier. Commandes prises en charge : ^FO ^FT ^A ^CF ^FD ^FB ^FR ^GB ^GE ^GC ^BC ^BE ^B8 ^BU ^B3 ^BA ^B2 ^BQ ^BX ^GFA ^LH ^PW ^LL.')} {t('Également : ^BO (Aztec), ^B7 (PDF417), ^BX GS1 (FNC1).')}
          </div>
        </div>
        <div>
          <div className="row">
            <span style={{ fontSize: 12.5 }}>{t('Résolution')}</span>
            <Seg value={dpi} onChange={setDpi} options={[{ v: '203', label: '203' }, { v: '300', label: '300' }, { v: '600', label: '600' }]} />
            <div style={{ width: 80 }}>
              <NumField value={wIn} suffix="in" onChange={setW} min={0.25} title={t('Largeur si ^PW absent')} />
            </div>
            ×
            <div style={{ width: 80 }}>
              <NumField value={hIn} suffix="in" onChange={setH} min={0.25} title={t('Hauteur si ^LL absent')} />
            </div>
          </div>
          {labels.length > 1 && (
            <div className="row">
              <button className="btn sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
                ‹
              </button>
              <span>{t('Étiquette {i} / {n}', { i: page + 1, n: labels.length })}</span>
              <button className="btn sm" disabled={page >= labels.length - 1} onClick={() => setPage(page + 1)}>
                ›
              </button>
            </div>
          )}
          <div ref={boxRef} style={{ background: 'var(--bg)', borderRadius: 12, minHeight: 240, display: 'grid', placeItems: 'center', padding: 12 }} />
          {err && <div className="err" style={{ marginTop: 8 }}>{err}</div>}
          {lint.length > 0 && (
            <div style={{ marginTop: 8, maxHeight: '18vh', overflow: 'auto' }} aria-label={t('Vérification du ZPL')}>
              <div className="sec-t" style={{ margin: '0 0 4px' }}>
                {t('Vérification : {e} erreur(s), {w} avertissement(s)', { e: lint.filter((x) => x.level === 'error').length, w: lint.filter((x) => x.level === 'warning').length })}
              </div>
              {lint.slice(0, 200).map((x, i) => (
                <div key={i} className={x.level === 'error' ? 'err' : 'hint'} style={{ marginTop: 2 }}>
                  {t('Ligne {n}', { n: x.line })} : {x.msg}
                </div>
              ))}
            </div>
          )}
          {lab?.warnings.map((w, i) => (
            <div key={i} className="hint" style={{ marginTop: 6 }}>
              ⚠ {w}
            </div>
          ))}
          <div className="hint" style={{ marginTop: 6 }}>
            {t('Aperçu approximatif généré localement : les polices Zebra sont simulées.')}
          </div>
        </div>
      </div>
    </Modal>
  );
}
