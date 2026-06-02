"use client";

import { useEffect, useState } from "react";
import {
  api, clearToken, getToken, Me, Product, Qualification, Solicitation, Treaty,
} from "@/lib/api";

export default function Home() {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);

  async function loadMe() {
    try {
      setMe(await api.me());
    } catch {
      clearToken();
      setMe(null);
    } finally {
      setReady(true);
    }
  }

  useEffect(() => {
    if (getToken()) loadMe();
    else setReady(true);
  }, []);

  if (!ready) return null;
  if (!me) return <Login onLogin={loadMe} />;

  const logout = () => { clearToken(); setMe(null); };
  return me.is_supplier
    ? <SupplierView me={me} onLogout={logout} />
    : <CompanyView me={me} onLogout={logout} />;
}

/* ---------------- Login ---------------- */
function Login({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      await api.login(username, password);
      onLogin();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-50 dark:bg-black">
      <form onSubmit={submit}
        className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">FTA</h1>
        <p className="mb-6 text-sm text-zinc-500">LogiQ Aduanas — gestión de origen</p>
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Usuario</label>
        <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus
          className="mb-4 mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800" />
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Contraseña</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          className="mb-4 mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800" />
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
        <button disabled={loading}
          className="w-full rounded-lg bg-zinc-900 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900">
          {loading ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </main>
  );
}

/* ---------------- Header común ---------------- */
function Header({ me, onLogout, subtitle }: { me: Me; onLogout: () => void; subtitle: string }) {
  return (
    <header className="mb-8 flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">FTA · LogiQ Aduanas</h1>
        <p className="text-sm text-zinc-500">{subtitle}</p>
      </div>
      <div className="flex items-center gap-3">
        <div className="text-right text-sm">
          <div className="font-medium text-zinc-800 dark:text-zinc-200">{me.username}</div>
          <div className="text-zinc-500">
            {me.is_supplier ? `Proveedor · ${me.supplier?.name}` : `${me.role_display} · ${me.tenant?.name}`}
          </div>
        </div>
        <button onClick={onLogout}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300">
          Salir
        </button>
      </div>
    </header>
  );
}

/* ---------------- Vista EMPRESA ---------------- */
function CompanyView({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [treaties, setTreaties] = useState<Treaty[]>([]);
  const [quals, setQuals] = useState<Qualification[]>([]);
  const [treatyId, setTreatyId] = useState<number | null>(null);
  const [msg, setMsg] = useState("");

  async function load() {
    const [p, t, q] = await Promise.all([api.products(), api.treaties(), api.qualifications()]);
    setProducts(p.results); setTreaties(t.results); setQuals(q.results);
    if (!treatyId && t.results.length) {
      const tmec = t.results.find((x: Treaty) => x.code === "TMEC");
      setTreatyId(tmec ? tmec.id : t.results[0].id);
    }
  }
  useEffect(() => { load().catch((e) => setMsg(e.message)); }, []);

  async function runQualify(productId: number) {
    if (!treatyId) return;
    setMsg("Calculando…");
    try {
      const q = await api.qualify(productId, treatyId);
      setMsg(`Resultado: ${q.status_display}` + (q.rvc_value ? ` · VCR ${q.rvc_value}%` : "") +
        (q.criterion ? ` · criterio ${q.criterion}` : ""));
      await load();
    } catch (e) { setMsg((e as Error).message); }
  }

  const statusColor = (st: string) =>
    st === "QUALIFIES" ? "text-green-600" : st === "DOES_NOT" ? "text-red-600" : "text-amber-600";
  const qualFor = (pid: number) => quals.find((q) => q.product === pid && q.treaty === treatyId);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      <Header me={me} onLogout={onLogout} subtitle="Panel de empresa — ves todos tus productos y proveedores" />
      <div className="mb-6 flex items-center gap-3">
        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Tratado:</label>
        <select value={treatyId ?? ""} onChange={(e) => setTreatyId(Number(e.target.value))}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800">
          {treaties.map((t) => <option key={t.id} value={t.id}>{t.code} — {t.name}</option>)}
        </select>
        {msg && <span className="text-sm text-zinc-600 dark:text-zinc-400">{msg}</span>}
      </div>
      <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-zinc-500 dark:bg-zinc-900">
            <tr>
              <th className="px-4 py-3 font-medium">SKU</th>
              <th className="px-4 py-3 font-medium">Descripción</th>
              <th className="px-4 py-3 font-medium">HS</th>
              <th className="px-4 py-3 font-medium">Resultado</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {products.map((p) => {
              const q = qualFor(p.id);
              return (
                <tr key={p.id} className="bg-white dark:bg-zinc-950">
                  <td className="px-4 py-3 font-mono text-xs">{p.sku}</td>
                  <td className="px-4 py-3">{p.description}</td>
                  <td className="px-4 py-3 font-mono text-xs">{p.hs_code}</td>
                  <td className={`px-4 py-3 font-medium ${q ? statusColor(q.status) : "text-zinc-400"}`}>
                    {q ? q.status_display + (q.rvc_value ? ` (${q.rvc_value}%)` : "") : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => runQualify(p.id)}
                      className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900">
                      Calificar
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}

/* ---------------- Vista PROVEEDOR ---------------- */
function SupplierView({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const [sols, setSols] = useState<Solicitation[]>([]);
  const [products, setProducts] = useState<Record<number, Product>>({});
  const [treaties, setTreaties] = useState<Record<number, Treaty>>({});
  const [msg, setMsg] = useState("");

  async function load() {
    const [s, p, t] = await Promise.all([api.solicitations(), api.products(), api.treaties()]);
    setSols(s.results);
    setProducts(Object.fromEntries(p.results.map((x: Product) => [x.id, x])));
    setTreaties(Object.fromEntries(t.results.map((x: Treaty) => [x.id, x])));
  }
  useEffect(() => { load().catch((e) => setMsg(e.message)); }, []);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <Header me={me} onLogout={onLogout} subtitle="Portal de proveedor — completa la información de origen que te piden" />
      {msg && <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">{msg}</p>}
      {sols.length === 0 && (
        <p className="rounded-xl border border-zinc-200 bg-white p-6 text-center text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950">
          No tienes solicitudes pendientes.
        </p>
      )}
      <div className="space-y-4">
        {sols.map((sr) => (
          <SolicitationCard key={sr.id} sr={sr}
            product={products[sr.product]} treaty={treaties[sr.treaty]}
            onDone={() => load()} />
        ))}
      </div>
    </main>
  );
}

function SolicitationCard({ sr, product, treaty, onDone }: {
  sr: Solicitation; product?: Product; treaty?: Treaty; onDone: () => void;
}) {
  const [isOrig, setIsOrig] = useState(true);
  const [country, setCountry] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const responded = sr.status === "responded";

  async function submit() {
    setErr(""); setSaving(true);
    try {
      await api.respond(sr.id, {
        is_originating: isOrig, country_of_origin: country,
        valid_from: from, valid_to: to,
      });
      onDone();
    } catch (e) { setErr((e as Error).message); }
    finally { setSaving(false); }
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="font-medium text-zinc-900 dark:text-zinc-50">
            {product ? `${product.sku} — ${product.description}` : `Material #${sr.product}`}
          </div>
          <div className="text-xs text-zinc-500">
            HS {product?.hs_code} · Tratado {treaty?.code ?? sr.treaty}
          </div>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
          responded ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
          {sr.status_display}
        </span>
      </div>
      {responded ? (
        <p className="text-sm text-zinc-500">Ya enviaste tu declaración. ¡Gracias!</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 text-sm">
          <label className="col-span-2 flex items-center gap-2">
            <input type="checkbox" checked={isOrig} onChange={(e) => setIsOrig(e.target.checked)} />
            <span className="text-zinc-700 dark:text-zinc-300">¿El material es originario para este tratado?</span>
          </label>
          <div>
            <label className="block text-xs text-zinc-500">País de origen (ISO-2)</label>
            <input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="MX"
              className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-800" />
          </div>
          <div></div>
          <div>
            <label className="block text-xs text-zinc-500">Vigente desde</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-800" />
          </div>
          <div>
            <label className="block text-xs text-zinc-500">Vigente hasta</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-800" />
          </div>
          {err && <p className="col-span-2 text-sm text-red-600">{err}</p>}
          <div className="col-span-2">
            <button onClick={submit} disabled={saving}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900">
              {saving ? "Enviando…" : "Enviar declaración"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
