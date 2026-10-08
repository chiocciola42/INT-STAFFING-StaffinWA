/**
 * @file PwaPrompts.tsx
 * @description Registrazione del service worker (progressive enhancement), toast di
 * aggiornamento e banner di installazione per Android/Chrome e iOS Safari.
 * Il componente e' indipendente dai provider dell'app e non usa localStorage/sessionStorage:
 * la scelta "non ora" sul banner e' salvata in un cookie di durata limitata.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_COOKIE = 'pwa_install_dismissed';
const DISMISS_DAYS = 14;
const SW_UPDATE_CHECK_MS = 60 * 60 * 1000;

const readCookie = (name: string): boolean => {
  try {
    return document.cookie.split('; ').some(c => c.startsWith(`${name}=`));
  } catch {
    return false;
  }
};

const writeCookie = (name: string, days: number): void => {
  try {
    document.cookie = `${name}=1; max-age=${days * 86400}; path=/; SameSite=Lax`;
  } catch {
    /* cookie bloccati: il banner tornera' al prossimo caricamento, nessun impatto funzionale */
  }
};

const isStandalone = (): boolean => {
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.('(display-mode: standalone)').matches === true || nav.standalone === true;
};

const detectIosSafari = (): boolean => {
  const ua = window.navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua) || (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);
  // Browser di terze parti su iOS (Chrome, Firefox, Edge, Opera) hanno un menu di condivisione diverso.
  const isOtherBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|GSA/.test(ua);
  return isIos && !isOtherBrowser;
};

const isAndroid = (): boolean => /Android/i.test(window.navigator.userAgent);

const PwaPrompts: React.FC = () => {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [installDismissed, setInstallDismissed] = useState(false);
  const updateSWRef = useRef<((reload?: boolean) => Promise<void>) | null>(null);
  const installButtonRef = useRef<HTMLButtonElement>(null);

  // Registrazione del service worker: qualsiasi errore lascia l'app invariata.
  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
    let cancelled = false;
    (async () => {
      try {
        const { registerSW } = await import('virtual:pwa-register');
        if (cancelled) return;
        updateSWRef.current = registerSW({
          onNeedRefresh: () => setNeedRefresh(true),
          onRegisteredSW: (_url, registration) => {
            if (registration) setInterval(() => { registration.update().catch(() => undefined); }, SW_UPDATE_CHECK_MS);
          },
          onRegisterError: () => undefined,
        });
      } catch {
        /* registrazione fallita: comportamento identico a un sito senza PWA */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Rilevamento installabilita'.
  useEffect(() => {
    if (isStandalone() || readCookie(DISMISS_COOKIE)) {
      setInstallDismissed(true);
      return;
    }
    if (detectIosSafari()) setShowIosHint(true);

    const onBeforeInstall = (e: Event) => {
      // Solo mobile Android: su desktop si lascia il comportamento nativo del browser.
      if (!isAndroid()) return;
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => { setInstallEvent(null); setShowIosHint(false); };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const dismissInstall = useCallback(() => {
    writeCookie(DISMISS_COOKIE, DISMISS_DAYS);
    setInstallDismissed(true);
    setInstallEvent(null);
    setShowIosHint(false);
  }, []);

  const handleInstall = useCallback(async () => {
    if (!installEvent) return;
    try {
      await installEvent.prompt();
      await installEvent.userChoice;
    } catch {
      /* prompt non disponibile: nessuna azione */
    }
    setInstallEvent(null);
  }, [installEvent]);

  const handleReload = useCallback(() => {
    const update = updateSWRef.current;
    if (update) update(true).catch(() => window.location.reload());
    else window.location.reload();
  }, []);

  const showInstall = !installDismissed && (installEvent !== null || showIosHint);
  if (!needRefresh && !showInstall) return null;

  const panel = 'pointer-events-auto w-full max-w-md rounded-2xl border shadow-xl p-4 flex items-center gap-3';
  const panelStyle: React.CSSProperties = {
    background: 'var(--color-inverse-surface, #06414a)',
    color: 'var(--color-inverse-on-surface, #fafaf7)',
    borderColor: 'var(--color-outline, #cdd9db)',
  };
  const primaryBtn = 'rounded-full px-4 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2';
  const primaryStyle: React.CSSProperties = {
    background: 'var(--color-yellow-container, #fae650)',
    color: 'var(--color-on-yellow-container, #06414a)',
    outlineColor: 'var(--color-yellow-container, #fae650)',
  };
  const ghostBtn = 'rounded-full px-3 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2';
  const ghostStyle: React.CSSProperties = { color: 'inherit', outlineColor: 'var(--color-yellow-container, #fae650)' };

  return (
    <div
      className="fixed inset-x-0 z-[90] flex flex-col items-center gap-2 px-4 pointer-events-none bottom-[calc(5.75rem+env(safe-area-inset-bottom))] md:bottom-4"
    >
      {needRefresh && (
        <div role="status" aria-live="polite" className={panel} style={panelStyle}>
          <p className="flex-1 text-sm">Aggiornamento disponibile</p>
          <button type="button" onClick={handleReload} className={primaryBtn} style={primaryStyle}>Ricarica</button>
          <button type="button" onClick={() => setNeedRefresh(false)} className={ghostBtn} style={ghostStyle} aria-label="Chiudi avviso di aggiornamento">Più tardi</button>
        </div>
      )}
      {showInstall && (
        <section role="region" aria-label="Installa l'app" className={panel} style={panelStyle}>
          {installEvent ? (
            <>
              <p className="flex-1 text-sm">Installa Staffing sul tuo dispositivo per aprirla come una app.</p>
              <button ref={installButtonRef} type="button" onClick={handleInstall} className={primaryBtn} style={primaryStyle}>Installa app</button>
            </>
          ) : (
            <p className="flex-1 text-sm">
              Per installare l'app tocca <strong>Condividi</strong> <span aria-hidden="true">→</span> <strong>Aggiungi a Home</strong>.
            </p>
          )}
          <button type="button" onClick={dismissInstall} className={ghostBtn} style={ghostStyle} aria-label="Chiudi suggerimento di installazione">Chiudi</button>
        </section>
      )}
    </div>
  );
};

export default PwaPrompts;
