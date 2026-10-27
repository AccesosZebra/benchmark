import React, { useEffect, useState } from 'react';
import {
  ApiKeyInfo,
  GuestInfo,
  listKeys,
  addKey,
  updateKey,
  deleteKey,
  listGuests,
  addGuest,
  updateGuest,
  deleteGuest,
} from '../services/admin';

interface AdminPanelProps {
  onClose: () => void;
}

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const inputCls =
  'w-full p-3 bg-surface-2 border border-line rounded-input focus:shadow-[0_0_0_1px_var(--accent)] focus:border-accent transition-all outline-none text-text font-normal placeholder:text-muted text-sm';
const selectCls =
  'p-2 bg-surface-2 border border-line rounded-input focus:border-accent outline-none text-text text-xs font-mono';
const primaryBtn =
  'px-4 py-3 rounded-btn bg-accent text-bg text-[10px] font-medium uppercase tracking-widest font-mono hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:pointer-events-none';
const ghostBtn =
  'px-2.5 py-1.5 rounded-btn border border-line text-[10px] font-medium text-muted hover:text-text hover:border-accent transition-all uppercase tracking-wider font-mono';
const tag = 'text-[9px] text-muted font-mono uppercase border border-line rounded-pill px-1.5 py-0.5';

const AdminPanel: React.FC<AdminPanelProps> = ({ onClose }) => {
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [guests, setGuests] = useState<GuestInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Formularios
  const [keyLabel, setKeyLabel] = useState('');
  const [keyValue, setKeyValue] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [guestPassword, setGuestPassword] = useState('');
  const [guestKey, setGuestKey] = useState<string>('');

  // Borrado de clave con reasignación de sus invitados
  const [deletingKey, setDeletingKey] = useState<number | null>(null);
  const [reassignTo, setReassignTo] = useState<string>('');

  const refresh = async () => {
    const [k, g] = await Promise.all([listKeys(), listGuests()]);
    setKeys(k);
    setGuests(g);
  };

  useEffect(() => {
    refresh()
      .catch((e) => setError(e.message || 'No pudimos cargar la administración.'))
      .finally(() => setLoading(false));
  }, []);

  // Ejecuta una acción, refresca y muestra el resultado.
  const run = async (fn: () => Promise<any>, ok?: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      await refresh();
      if (ok) setNotice(ok);
      return true;
    } catch (e: any) {
      setError(e.message || 'Algo salió mal.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleAddKey = async (e: React.FormEvent) => {
    e.preventDefault();
    const done = await run(() => addKey(keyLabel, keyValue), 'Clave verificada con Anthropic y guardada cifrada.');
    if (done) {
      setKeyLabel('');
      setKeyValue('');
    }
  };

  const handleAddGuest = async (e: React.FormEvent) => {
    e.preventDefault();
    const done = await run(
      () => addGuest(guestEmail, guestPassword, guestKey ? Number(guestKey) : null),
      `Invitado ${guestEmail.trim().toLowerCase()} creado.`
    );
    if (done) {
      setGuestEmail('');
      setGuestPassword('');
      setGuestKey('');
    }
  };

  const handleResetPassword = (email: string) => {
    const pw = window.prompt(`Nueva contraseña para ${email} (mínimo 8 caracteres):`);
    if (pw) run(() => updateGuest(email, { password: pw }), `Contraseña de ${email} actualizada.`);
  };

  const confirmDeleteKey = async (k: ApiKeyInfo) => {
    const done = await run(() => deleteKey(k.id, reassignTo ? Number(reassignTo) : null), `Clave "${k.label}" eliminada.`);
    if (done) {
      setDeletingKey(null);
      setReassignTo('');
    }
  };

  const defaultKey = keys.find((k) => k.isDefault);
  const keyLabelFor = (id: number | null) => {
    const k = keys.find((x) => x.id === id);
    return k ? k.label : `Predeterminada${defaultKey ? ` (${defaultKey.label})` : ''}`;
  };

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto bg-surface rounded-card border border-line shadow-sm p-10 flex justify-center">
        <span className="w-5 h-5 border-2 border-muted border-t-text rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className={`max-w-3xl mx-auto space-y-10 ${busy ? 'cursor-progress' : ''}`}>
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-xl font-semibold text-text">Administración</h2>
          <p className="text-xs text-muted font-normal mt-1">
            Claves de Claude e invitados. Las claves se guardan cifradas y nunca se muestran completas.
          </p>
        </div>
        <button onClick={onClose} className="px-4 py-2 rounded-btn border border-line text-[10px] font-medium text-muted hover:text-text hover:bg-surface-2 transition-all uppercase tracking-widest font-mono">
          Cerrar
        </button>
      </div>

      {(error || notice) && (
        <div className="p-4 bg-surface-2 border border-line text-text rounded-card text-xs font-medium text-center font-mono">
          {error || notice}
        </div>
      )}

      {/* ---- Claves de Claude ---- */}
      <section className="space-y-4">
        <h3 className="text-xs font-medium text-text uppercase tracking-[0.2em] font-mono border-b border-line pb-2">
          Claves de Claude
        </h3>

        {keys.length === 0 ? (
          <div className="bg-surface rounded-card border border-line shadow-sm p-6 text-center text-sm text-muted">
            No hay claves. Agrega una para que la app pueda investigar.
          </div>
        ) : (
          <ul className="space-y-3">
            {keys.map((k) => (
              <li key={k.id} className="bg-surface rounded-card border border-line shadow-sm p-4 space-y-3">
                <div className="flex items-center gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-text truncate flex items-center gap-2">
                      {k.label}
                      {k.isDefault && <span className={tag}>Predeterminada</span>}
                      {!k.active && <span className={tag}>Inactiva</span>}
                    </p>
                    <p className="text-[10px] text-muted font-mono tracking-wider mt-1">
                      {k.hint} · {k.guests} invitado{k.guests === 1 ? '' : 's'} · último uso {fmtDate(k.lastUsedAt)}
                    </p>
                  </div>
                  <div className={`flex items-center gap-1.5 flex-shrink-0 ${busy ? 'pointer-events-none opacity-50' : ''}`}>
                    {!k.isDefault && (
                      <button onClick={() => run(() => updateKey(k.id, { isDefault: true }), `"${k.label}" es ahora la predeterminada.`)} className={ghostBtn}>
                        Predeterminar
                      </button>
                    )}
                    {!k.isDefault && (
                      <button onClick={() => run(() => updateKey(k.id, { active: !k.active }))} className={ghostBtn}>
                        {k.active ? 'Desactivar' : 'Activar'}
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setDeletingKey(deletingKey === k.id ? null : k.id);
                        setReassignTo('');
                      }}
                      className={ghostBtn}
                    >
                      Eliminar
                    </button>
                  </div>
                </div>

                {deletingKey === k.id && (
                  <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-line">
                    <span className="text-xs text-muted">
                      {k.guests > 0 ? `Sus ${k.guests} invitado${k.guests === 1 ? '' : 's'} pasan a:` : '¿Eliminar esta clave?'}
                    </span>
                    {k.guests > 0 && (
                      <select value={reassignTo} onChange={(e) => setReassignTo(e.target.value)} className={selectCls}>
                        <option value="">Predeterminada</option>
                        {keys.filter((x) => x.id !== k.id).map((x) => (
                          <option key={x.id} value={x.id}>{x.label}</option>
                        ))}
                      </select>
                    )}
                    <button onClick={() => confirmDeleteKey(k)} disabled={busy} className={primaryBtn.replace('py-3', 'py-2')}>
                      Confirmar
                    </button>
                    <button onClick={() => setDeletingKey(null)} className={ghostBtn}>Cancelar</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={handleAddKey} className="bg-surface rounded-card border border-line shadow-sm p-4 grid gap-3 md:grid-cols-[1fr_2fr_auto]">
          <input value={keyLabel} onChange={(e) => setKeyLabel(e.target.value)} placeholder="Nombre (ej. Cliente Acme)" className={inputCls} />
          <input
            type="password"
            autoComplete="off"
            value={keyValue}
            onChange={(e) => setKeyValue(e.target.value)}
            placeholder="sk-ant-..."
            className={`${inputCls} font-mono`}
          />
          <button type="submit" disabled={busy || !keyLabel.trim() || !keyValue.trim()} className={primaryBtn}>
            Agregar
          </button>
        </form>
      </section>

      {/* ---- Invitados ---- */}
      <section className="space-y-4">
        <h3 className="text-xs font-medium text-text uppercase tracking-[0.2em] font-mono border-b border-line pb-2">
          Invitados
        </h3>

        {guests.length === 0 ? (
          <div className="bg-surface rounded-card border border-line shadow-sm p-6 text-center text-sm text-muted">
            Aún no hay invitados.
          </div>
        ) : (
          <ul className="space-y-3">
            {guests.map((g) => (
              <li key={g.email} className="bg-surface rounded-card border border-line shadow-sm p-4 flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-text truncate flex items-center gap-2">
                    {g.email}
                    {!g.active && <span className={tag}>Desactivado</span>}
                  </p>
                  <p className="text-[10px] text-muted font-mono tracking-wider mt-1">
                    usa {keyLabelFor(g.apiKeyId)} · alta {fmtDate(g.createdAt)}
                  </p>
                </div>
                <div className={`flex items-center gap-1.5 flex-shrink-0 ${busy ? 'pointer-events-none opacity-50' : ''}`}>
                  <select
                    aria-label="Clave asignada"
                    value={g.apiKeyId ?? ''}
                    onChange={(e) => {
                      const id = e.target.value ? Number(e.target.value) : null;
                      run(() => updateGuest(g.email, { apiKeyId: id }), `${g.email} ahora usa ${keyLabelFor(id)}.`);
                    }}
                    className={selectCls}
                  >
                    <option value="">Predeterminada</option>
                    {keys.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.label}{k.active ? '' : ' (inactiva)'}
                      </option>
                    ))}
                  </select>
                  <button onClick={() => handleResetPassword(g.email)} className={ghostBtn}>Clave</button>
                  <button onClick={() => run(() => updateGuest(g.email, { active: !g.active }))} className={ghostBtn}>
                    {g.active ? 'Desactivar' : 'Activar'}
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm(`¿Eliminar al invitado ${g.email}? Sus benchmarks se conservan.`)) {
                        run(() => deleteGuest(g.email), `Invitado ${g.email} eliminado.`);
                      }
                    }}
                    className={ghostBtn}
                  >
                    Eliminar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={handleAddGuest} className="bg-surface rounded-card border border-line shadow-sm p-4 grid gap-3 md:grid-cols-[2fr_1.5fr_1.5fr_auto]">
          <input type="email" value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} placeholder="correo@cliente.com" className={inputCls} />
          <input
            type="text"
            autoComplete="off"
            value={guestPassword}
            onChange={(e) => setGuestPassword(e.target.value)}
            placeholder="Contraseña (mín. 8)"
            className={inputCls}
          />
          <select value={guestKey} onChange={(e) => setGuestKey(e.target.value)} className={`${selectCls} p-3`}>
            <option value="">Clave predeterminada</option>
            {keys.map((k) => (
              <option key={k.id} value={k.id}>{k.label}</option>
            ))}
          </select>
          <button type="submit" disabled={busy || !guestEmail.trim() || guestPassword.length < 8} className={primaryBtn}>
            Crear
          </button>
        </form>
      </section>
    </div>
  );
};

export default AdminPanel;
