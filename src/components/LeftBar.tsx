import { useMemo, useState } from 'react';
import { Type, Barcode, QrCode, Image as ImageIcon, Shapes, Table2, LayoutTemplate, Layers, Eye, EyeOff, Lock, Unlock, Trash2, GripVertical, Search, Wifi, Contact, Link, Filter } from 'lucide-react';
import { useStore, type LeftPanel } from '../store';
import { Panel, Modal } from './ui';
import { t } from '../i18n';
import { addText, addQr, addShape, addTable, addImageFile, addBarcode, confirmDiscard } from '../actions';
import { pickFile } from '../util';
import { SYMBOLOGIES } from '../render/codes';
import { searchShapes, CATEGORY_LABELS, symbolSvg, type ShapeDef, type ShapeCategory } from '../render/shapes';
import { elementLabel } from '../elements';
import { TEMPLATES, TEMPLATE_CATEGORIES } from '../templates';
import { thumbnail } from '../export';
import { sizeLabel } from '../sizes';
import { makeQr } from '../elements';

export function LeftBar() {
  const st = useStore();
  const toggle = (p: LeftPanel) => st.set('leftPanel', st.leftPanel === p ? null : p);
  const image = async () => {
    const f = await pickFile('image/png,image/jpeg,image/gif,image/svg+xml,image/webp,image/bmp');
    if (f) addImageFile(f);
  };
  return (
    <>
      <nav className="sidebar left pill hide-in-preview" aria-label={t('Outils d’édition')}>
        <button className="tool" onClick={() => addText()} aria-label={t('Ajouter un texte')}>
          <Type />
          {t('Texte')}
        </button>
        <button className={'tool' + (st.leftPanel === 'barcode' ? ' on' : '')} onClick={() => toggle('barcode')} aria-label={t('Ajouter un code-barres')}>
          <Barcode />
          {t('Code-barres')}
        </button>
        <button className={'tool' + (st.leftPanel === 'qr' ? ' on' : '')} onClick={() => toggle('qr')} aria-label={t('Ajouter un QR code')}>
          <QrCode />
          QR
        </button>
        <button className="tool" onClick={image} aria-label={t('Ajouter une image')}>
          <ImageIcon />
          {t('Image')}
        </button>
        <button className={'tool' + (st.leftPanel === 'shapes' ? ' on' : '')} onClick={() => toggle('shapes')} aria-label={t('Ajouter une forme')}>
          <Shapes />
          {t('Forme')}
        </button>
        <button className={'tool' + (st.leftPanel === 'table' ? ' on' : '')} onClick={() => toggle('table')} aria-label={t('Ajouter un tableau')}>
          <Table2 />
          {t('Tableau')}
        </button>
        <button className={'tool' + (st.leftPanel === 'templates' ? ' on' : '')} onClick={() => toggle('templates')} aria-label={t('Modèles')}>
          <LayoutTemplate />
          {t('Modèles')}
        </button>
        <button className={'tool' + (st.leftPanel === 'layers' ? ' on' : '')} onClick={() => toggle('layers')} aria-label={t('Calques')}>
          <Layers />
          {t('Calques')}
        </button>
      </nav>
      {st.leftPanel === 'barcode' && <BarcodePanel />}
      {st.leftPanel === 'qr' && <QrPanel />}
      {st.leftPanel === 'shapes' && <ShapePanel />}
      {st.leftPanel === 'table' && <TablePanel />}
      {st.leftPanel === 'layers' && <LayersPanel />}
      {st.leftPanel === 'templates' && <TemplatesModal />}
    </>
  );
}

const close = () => useStore.getState().set('leftPanel', null);

function BarcodePanel() {
  return (
    <Panel className="leftp" title={t('Code-barres')} icon={<Barcode size={17} />} onClose={close}>
      <div className="hint">{t('Choisissez une symbologie ; vous pourrez la changer ensuite.')}</div>
      {SYMBOLOGIES.map((s) => (
        <button
          key={s.id}
          className="btn flat block"
          style={{ justifyContent: 'space-between', height: 'auto', padding: '8px 10px', borderRadius: 10 }}
          onClick={() => {
            addBarcode(s.id);
            close();
          }}
        >
          <b style={{ fontWeight: 600 }}>{s.label}</b>
          <span style={{ fontSize: 11.5, color: 'var(--ink-3)', textAlign: 'right' }}>{t(s.hint)}</span>
        </button>
      ))}
    </Panel>
  );
}

function QrPanel() {
  const add = (type: 'text' | 'wifi' | 'vcard') => {
    const st = useStore.getState();
    const q = makeQr(st.doc);
    q.qrType = type;
    if (type === 'wifi') q.wifi = { ssid: 'MonWifi', password: 'motdepasse', enc: 'WPA', hidden: false };
    if (type === 'vcard') q.vcard = { firstName: 'Camille', lastName: 'Durand', org: 'ACME', title: '', phone: '+33 6 12 34 56 78', email: 'camille@exemple.fr', url: 'https://exemple.fr', address: '' };
    st.addElements([q]);
    close();
  };
  return (
    <Panel className="leftp" title={t('QR code')} icon={<QrCode size={17} />} onClose={close}>
      <button className="btn flat block" style={{ justifyContent: 'flex-start' }} onClick={() => (addQr(), close())}>
        <Link size={16} /> {t('Lien (URL) ou texte')}
      </button>
      <button className="btn flat block" style={{ justifyContent: 'flex-start' }} onClick={() => add('wifi')}>
        <Wifi size={16} /> {t('Réseau Wi-Fi')}
      </button>
      <button className="btn flat block" style={{ justifyContent: 'flex-start' }} onClick={() => add('vcard')}>
        <Contact size={16} /> {t('Carte de visite (vCard)')}
      </button>
      <div className="hint" style={{ marginTop: 8 }}>
        {t('Astuce : utilisez des {{colonnes}} de vos données dans le contenu du QR.')}
      </div>
    </Panel>
  );
}

function TablePanel() {
  const [hover, setHover] = useState<[number, number]>([3, 3]);
  return (
    <Panel className="leftp" title={t('Tableau')} icon={<Table2 size={17} />} onClose={close}>
      <div className="hint">{t('Choisissez le nombre de lignes et de colonnes')}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 3, marginBottom: 8 }} onMouseLeave={() => setHover([3, 3])}>
        {Array.from({ length: 64 }, (_, i) => {
          const r = Math.floor(i / 8) + 1,
            c = (i % 8) + 1;
          const on = r <= hover[0] && c <= hover[1];
          return (
            <button
              key={i}
              aria-label={`${r} × ${c}`}
              onMouseEnter={() => setHover([r, c])}
              onClick={() => {
                addTable(r, c);
                close();
              }}
              style={{ aspectRatio: '1', border: '1px solid ' + (on ? 'var(--accent)' : 'var(--line)'), background: on ? 'var(--accent-soft)' : '#fff', borderRadius: 4, padding: 0 }}
            />
          );
        })}
      </div>
      <div style={{ textAlign: 'center', fontWeight: 600 }}>
        {hover[0]} {t('lignes')} × {hover[1]} {t('colonnes')}
      </div>
    </Panel>
  );
}

function ShapeIcon({ def }: { def: ShapeDef }) {
  // aperçu des formes géométriques dessiné dans un petit canvas
  const url = useMemo(() => {
    if (def.category !== 'forme') return '';
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const c = cv.getContext('2d')!;
    const d = def.defaults;
    const ar = d ? d.w / d.h : 1;
    const w = ar >= 1 ? 52 : 52 * ar,
      h = ar >= 1 ? 52 / ar : 52;
    const x = (64 - w) / 2,
      y = (64 - h) / 2;
    if (def.bar) {
      c.fillStyle = '#16213e';
      c.fillRect(x, y + h / 2 - 2, w, Math.max(4, ar < 1 ? h : 4));
      if (ar < 1) {
        c.clearRect(0, 0, 64, 64);
        c.fillRect(30, 6, 4, 52);
      }
    } else {
      const p = def.path!(x, y, w, h, 10);
      c.strokeStyle = '#16213e';
      c.lineWidth = 3.5;
      c.stroke(p);
    }
    return cv.toDataURL();
  }, [def]);
  if (def.category !== 'forme') return <span style={{ width: '100%', height: '100%', display: 'block' }} dangerouslySetInnerHTML={{ __html: symbolSvg(def) }} />;
  return <img src={url} alt="" style={{ width: '100%', height: '100%' }} />;
}

function ShapePanel() {
  const [q, setQ] = useState('');
  const list = searchShapes(q);
  const cats = (['forme', 'entretien', 'securite', 'bougie'] as ShapeCategory[]).filter((c) => list.some((d) => d.category === c));
  return (
    <Panel className="leftp" title={t('Formes et symboles')} icon={<Shapes size={17} />} onClose={close}>
      <div style={{ position: 'relative', marginBottom: 10 }}>
        <Search size={15} style={{ position: 'absolute', left: 9, top: 9, color: 'var(--ink-3)' }} />
        <input className="inp" style={{ paddingLeft: 30 }} placeholder={t('Rechercher (ex. étoile, entretien, danger…)')} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} autoFocus />
      </div>
      {!list.length && <div className="hint">{t('Aucun résultat')}</div>}
      {cats.map((c) => (
        <div key={c} style={{ marginBottom: 12 }}>
          <div className="sec-t">{t(CATEGORY_LABELS[c])}</div>
          <div className="shape-grid">
            {list
              .filter((d) => d.category === c)
              .map((d) => (
                <button key={d.id} className="shape-cell" title={t(d.label)} aria-label={t(d.label)} onClick={() => addShape(d.id)}>
                  <ShapeIcon def={d} />
                </button>
              ))}
          </div>
        </div>
      ))}
    </Panel>
  );
}

function LayersPanel() {
  const st = useStore();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const els = [...st.doc.elements].reverse();
  const n = st.doc.elements.length;
  return (
    <Panel className="leftp" title={t('Calques')} icon={<Layers size={17} />} onClose={close}>
      {!els.length && <div className="hint">{t('Aucun élément. Ajoutez du texte, un code-barres…')}</div>}
      <div className="layers">
        {els.map((el, i) => (
          <div
            key={el.id}
            className={'layer' + (st.selected.includes(el.id) ? ' sel' : '') + (overIdx === i ? ' drag-over' : '')}
            draggable
            onDragStart={() => setDragId(el.id)}
            onDragOver={(e) => {
              e.preventDefault();
              setOverIdx(i);
            }}
            onDragLeave={() => setOverIdx(null)}
            onDrop={() => {
              if (dragId) st.moveTo(dragId, n - 1 - i);
              setDragId(null);
              setOverIdx(null);
            }}
            onClick={(e) => st.select([el.id], e.shiftKey || e.ctrlKey ? 'toggle' : 'set', true)}
          >
            <GripVertical size={14} style={{ color: 'var(--ink-3)', cursor: 'grab' }} />
            <span className={'nm' + (el.hidden ? ' dim' : '')} title={elementLabel(el)}>
              {el.groups?.length ? <span style={{ color: 'var(--accent)' }}>▣ </span> : null}
              {elementLabel(el)}
            </span>
            {el.showIf?.field && (
              <span className="cond-badge" title={t('Affiché seulement si : {f}', { f: el.showIf.field })} aria-label={t('Élément conditionnel')}>
                <Filter size={11} /> {t('si')}
              </span>
            )}
            <button className="icon-btn flat sm" title={el.hidden ? t('Afficher') : t('Masquer')} aria-label={el.hidden ? t('Afficher') : t('Masquer')} onClick={(e) => (e.stopPropagation(), st.updateEls([el.id], { hidden: !el.hidden }))}>
              {el.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
            <button className="icon-btn flat sm" title={el.locked ? t('Déverrouiller') : t('Verrouiller')} aria-label={el.locked ? t('Déverrouiller') : t('Verrouiller')} onClick={(e) => (e.stopPropagation(), st.updateEls([el.id], { locked: !el.locked }))}>
              {el.locked ? <Lock size={14} /> : <Unlock size={14} style={{ opacity: 0.4 }} />}
            </button>
            <button
              className="icon-btn flat sm"
              title={t('Supprimer')}
              aria-label={t('Supprimer')}
              onClick={(e) => {
                e.stopPropagation();
                st.setDoc((d) => void (d.elements = d.elements.filter((x) => x.id !== el.id)));
              }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
      {els.length > 1 && <div className="hint" style={{ marginTop: 8 }}>{t('Glissez-déposez pour réordonner. Le haut de la liste est au premier plan.')}</div>}
    </Panel>
  );
}

const thumbCache = new Map<string, string>();
function TemplatesModal() {
  const st = useStore();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string | null>(null);
  const [brand, setBrand] = useState<string | null>(null);
  const brands = Array.from(new Set(TEMPLATES.flatMap((x) => x.brands)));
  const list = TEMPLATES.filter(
    (tp) =>
      (!cat || tp.categories.includes(cat as never)) &&
      (!brand || tp.brands.includes(brand)) &&
      (!q || (t(tp.name) + ' ' + tp.categories.join(' ')).toLowerCase().includes(q.toLowerCase())),
  );
  const thumb = (id: string, build: () => ReturnType<(typeof TEMPLATES)[0]['build']>) => {
    let u = thumbCache.get(id);
    if (!u) {
      u = thumbnail(build(), 260);
      thumbCache.set(id, u);
    }
    return u;
  };
  return (
    <Modal title={t('Modèles')} wide onClose={close} icon={<LayoutTemplate size={20} />}>
      <div className="row">
        <div style={{ position: 'relative', flex: 1 }}>
          <Search size={15} style={{ position: 'absolute', left: 9, top: 9, color: 'var(--ink-3)' }} />
          <input className="inp" style={{ paddingLeft: 30 }} placeholder={t('Rechercher un modèle…')} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        </div>
      </div>
      <div className="tags">
        <button className={'tag' + (!cat ? ' on' : '')} onClick={() => setCat(null)}>
          {t('Toutes catégories')}
        </button>
        {TEMPLATE_CATEGORIES.map((c) => (
          <button key={c.id} className={'tag' + (cat === c.id ? ' on' : '')} onClick={() => setCat(cat === c.id ? null : c.id)}>
            {t(c.label)}
          </button>
        ))}
      </div>
      <div className="tags">
        <span style={{ fontSize: 12, color: 'var(--ink-3)', alignSelf: 'center' }}>{t('Imprimante / marque :')}</span>
        <button className={'tag' + (!brand ? ' on' : '')} onClick={() => setBrand(null)}>
          {t('Toutes')}
        </button>
        {brands.map((b) => (
          <button key={b} className={'tag' + (brand === b ? ' on' : '')} onClick={() => setBrand(brand === b ? null : b)}>
            {t(b)}
          </button>
        ))}
        <button className="tag" onClick={() => (close(), st.set('modal', 'sheets'))}>
          {t('Planches Avery (imprimante de bureau)…')}
        </button>
      </div>
      <div className="gallery">
        {list.map((tp) => {
          const d = tp.build();
          return (
            <button
              key={tp.id}
              className="card"
              onClick={() => {
                if (!confirmDiscard()) return;
                st.loadDoc(tp.build(), true);
                close();
              }}
            >
              <div className="thumb">
                <img src={thumb(tp.id, tp.build)} alt="" style={d.round ? { borderRadius: '50%' } : undefined} />
              </div>
              <div className="t">{t(tp.name)}</div>
              <div className="s">
                {sizeLabel(d.widthIn, d.heightIn)} · {tp.brands.map((b) => t(b)).join(', ')}
              </div>
            </button>
          );
        })}
      </div>
      {!list.length && <div className="hint">{t('Aucun modèle ne correspond.')}</div>}
    </Modal>
  );
}
