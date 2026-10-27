
import React, { useEffect, useRef, useState } from 'react';
import {
  AuthSession,
  getGoogleClientId,
  allowedDomain,
  verifyCredential,
  verifyGuest,
  getSession,
  saveSession,
  clearSession,
} from '../services/auth';

declare global {
  interface Window {
    google?: any;
  }
}

const AuthGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<AuthSession | null>(() => getSession());
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'google' | 'guest'>('google');
  const [guestEmail, setGuestEmail] = useState('');
  const [guestPassword, setGuestPassword] = useState('');
  const btnRef = useRef<HTMLDivElement>(null);

  const clientId = getGoogleClientId();
  const domain = allowedDomain();

  useEffect(() => {
    if (session || mode !== 'google' || !clientId) return;

    let cancelled = false;
    const tryInit = () => {
      if (cancelled) return;
      const gid = window.google?.accounts?.id;
      if (!gid) {
        setTimeout(tryInit, 200); // el script de Google aún no carga
        return;
      }
      gid.initialize({
        client_id: clientId,
        callback: async (resp: any) => {
          try {
            const s = await verifyCredential(resp.credential);
            saveSession(s);
            setError(null);
            setSession(s);
          } catch (e: any) {
            setError(e.message || 'No se pudo iniciar sesión.');
          }
        },
      });
      if (btnRef.current) {
        gid.renderButton(btnRef.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'signin_with',
          shape: 'rectangular',
          logo_alignment: 'left',
        });
      }
    };
    tryInit();
    return () => {
      cancelled = true;
    };
  }, [session, clientId, mode]);

  const handleLogout = () => {
    clearSession();
    setSession(null);
    setError(null);
    setMode('google');
    setGuestEmail('');
    setGuestPassword('');
    try {
      window.google?.accounts?.id?.disableAutoSelect?.();
    } catch {
      /* noop */
    }
  };

  const handleGuestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const s = await verifyGuest(guestEmail, guestPassword);
      saveSession(s);
      setError(null);
      setSession(s);
    } catch (err: any) {
      setError(err.message || 'No se pudo iniciar sesión.');
    }
  };

  // ---- Sesión activa: renderiza la app + un control discreto para salir ----
  if (session) {
    return (
      <>
        {children}
        <div className="no-print fixed bottom-3 right-3 z-[60] flex items-center gap-2 px-3 py-1.5 bg-surface/90 backdrop-blur border border-line rounded-pill shadow-sm">
          {session.picture ? (
            <img src={session.picture} alt="" className="w-5 h-5 rounded-full" referrerPolicy="no-referrer" />
          ) : (
            <span className="text-[9px] text-muted font-mono uppercase border border-line rounded-pill px-1.5 py-0.5">
              {session.provider === 'guest' ? 'Invitado' : 'Zebra'}
            </span>
          )}
          <span className="text-[10px] text-muted font-medium font-mono max-w-[160px] truncate">{session.email}</span>
          <button
            onClick={handleLogout}
            className="text-[10px] text-muted hover:text-text font-medium uppercase tracking-wider font-mono border-l border-line pl-2"
          >
            Salir
          </button>
        </div>
      </>
    );
  }

  // ---- Pantalla de acceso ----
  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img src="/assets/logo-zebra.svg" alt="Zebra" className="h-6 w-auto mx-auto dark-invert" />
          <p className="mt-2 text-[10px] text-muted font-medium uppercase tracking-[0.3em] font-mono">Intelligence Platform</p>
        </div>

        <div className="bg-surface rounded-card border border-line shadow-lg p-8 text-center">
          {mode === 'google' ? (
            <>
              <h1 className="text-lg font-semibold text-text">Acceso restringido</h1>
              <p className="mt-2 text-sm text-muted font-normal leading-relaxed">
                Inicia sesión con tu cuenta <span className="text-text font-medium">@{domain}</span>.
              </p>

              {clientId ? (
                <div className="mt-6 flex justify-center min-h-[44px]">
                  <div ref={btnRef} />
                </div>
              ) : (
                <div className="mt-6 p-4 bg-surface-2 border border-line rounded-control text-xs text-muted font-normal text-left">
                  <p className="font-medium text-text mb-1">Falta configurar Google</p>
                  Define <code className="font-mono">GOOGLE_CLIENT_ID</code> en el entorno, o en la consola:
                  <code className="block mt-2 font-mono text-[11px] text-text break-all">
                    localStorage.setItem('GOOGLE_CLIENT_ID', 'tu-id.apps.googleusercontent.com')
                  </code>
                </div>
              )}

              <div className="mt-6 flex items-center gap-3">
                <span className="flex-1 h-px bg-line" />
                <span className="text-[9px] text-muted font-mono uppercase tracking-wider">o</span>
                <span className="flex-1 h-px bg-line" />
              </div>
              <button
                onClick={() => {
                  setMode('guest');
                  setError(null);
                }}
                className="mt-4 w-full py-3 rounded-btn border border-line text-xs font-medium text-text hover:bg-surface-2 hover:border-accent transition-all uppercase tracking-widest font-mono"
              >
                Acceder como invitado
              </button>
            </>
          ) : (
            <>
              <h1 className="text-lg font-semibold text-text">Acceso de invitado</h1>
              <p className="mt-2 text-sm text-muted font-normal leading-relaxed">
                Entra con el correo y la contraseña que te compartieron.
              </p>
              <form onSubmit={handleGuestSubmit} className="mt-6 space-y-3 text-left">
                <input
                  type="email"
                  autoComplete="username"
                  value={guestEmail}
                  onChange={(e) => setGuestEmail(e.target.value)}
                  placeholder="correo@ejemplo.com"
                  className="w-full p-3 bg-surface-2 border border-line rounded-input focus:shadow-[0_0_0_1px_var(--accent)] focus:border-accent transition-all outline-none text-text font-normal placeholder:text-muted text-sm"
                />
                <input
                  type="password"
                  autoComplete="current-password"
                  value={guestPassword}
                  onChange={(e) => setGuestPassword(e.target.value)}
                  placeholder="Contraseña"
                  className="w-full p-3 bg-surface-2 border border-line rounded-input focus:shadow-[0_0_0_1px_var(--accent)] focus:border-accent transition-all outline-none text-text font-normal placeholder:text-muted text-sm"
                />
                <button
                  type="submit"
                  className="w-full py-3 rounded-btn bg-accent text-bg text-sm font-semibold uppercase tracking-[0.1em] hover:-translate-y-0.5 shadow-md hover:shadow-lg transition-all"
                >
                  Entrar
                </button>
              </form>
              <button
                onClick={() => {
                  setMode('google');
                  setError(null);
                }}
                className="mt-4 text-[10px] text-muted hover:text-text font-medium uppercase tracking-widest font-mono"
              >
                ← Volver
              </button>
            </>
          )}

          {error && (
            <div className="mt-5 p-3 bg-surface-2 border border-line rounded-control text-xs text-text font-medium">
              {error}
            </div>
          )}
        </div>

        <p className="mt-6 text-center text-[10px] text-muted font-normal leading-relaxed">
          Personal de Zebra: entra con Google. Clientes e invitados: usa el acceso con correo y contraseña.
          Los invitados ven solo sus propios análisis.
        </p>
      </div>
    </div>
  );
};

export default AuthGate;
