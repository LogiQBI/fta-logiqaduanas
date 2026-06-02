"use client";

import { useEffect, useState } from "react";
import {
  api, clearToken, getToken, Product, Qualification, Treaty,
} from "@/lib/api";

export default function Home() {
  const [authed, setAuthed] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setAuthed(!!getToken());
    setReady(true);
  }, []);

  if (!ready) return null;
  return authed ? (
    <Dashboard onLogout={() => { clearToken(); setAuthed(false); }} />
  ) : (
    <Login onLogin={() => setAuthed(true)} />
  );
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState("admin");
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
        <input value={username} onChange={(e) => setUsername(e.target.value)}
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

function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [treaties, setTreaties] = useState<Treaty[]>([]);
  const [quals, setQuals] = useState<Qualification[]>([]);
  const [treatyId, setTreatyId] = useState<number | null>(null);
  const [msg, setMsg] = useState("");

  async function load() {
    const [p, t, q] = await Promise.all([
      api.products(), api.treaties(), api.qualifications(),
    ]);
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
      setMsg(`Resultado: ${q.status_display}` +
        (q.rvc_value ? ` · VCR ${q.rvc_value}%` : "") +
        (q.criterion ? ` · criterio ${q.criterion}` : ""));
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  const statusColor = (s: string) =>
    s === "QUALIFIES" ? "text-green-600" : s === "DOES_NOT" ? "text-red-600" : "text-amber-600";
  const qualFor = (pid: number) => quals.find((q) => q.product === pid && q.treaty === treatyId);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">FTA · LogiQ Aduanas</h1>
          <p className="text-sm text-zinc-500">Gestión de origen preferencial</p>
        </div>
        <button onClick={onLogout}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300">
          Salir
        </button>
      </header>

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
            {products.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-zinc-400">
                Sin productos. Carga datos con <code>python manage.py seed_demo</code>.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
