import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { getLang } from './i18n';
import { useStore } from './store';

document.documentElement.lang = getLang();
// accès au store pour les tests automatisés (développement uniquement)
if (import.meta.env.DEV) (window as unknown as { __mlz: typeof useStore }).__mlz = useStore;
createRoot(document.getElementById('root')!).render(<App />);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
