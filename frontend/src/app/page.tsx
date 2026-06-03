"use client";

import { useEffect, useState } from "react";
import {
  Home, Building2, Users, Package, Truck, ClipboardList, BadgeCheck,
  FileText, ScrollText, BookOpen, Inbox, ChevronDown, LogOut, Search,
  Plus, CheckCircle2, Pencil, Trash2, X, KeyRound, Boxes,
} from "lucide-react";
import {
  api, BomLine, clearToken, getToken, MasterTenant, Me, OriginRule, Party,
  Product, Qualification, Solicitation, SubmittedBom, SupplierUser, Treaty,
} from "@/lib/api";
import { COUNTRIES, isValidCountry } from "@/lib/countries";

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(" ");

// Etiqueta de tratado en inglés para mostrar (interno se mantiene el código).
const TREATY_LABELS: Record<string, string> = { TMEC: "USMCA" };
const treatyLabel = (code?: string) => (code ? (TREATY_LABELS[code] ?? code) : "—");

export default function Page() {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);

  async function loadMe() {
    try { setMe(await api.me()); } catch { clearToken(); setMe(null); }
    finally { setReady(true); }
  }
  useEffect(() => { if (getToken()) loadMe(); else setReady(true); }, []);

  const logout = () => { clearToken(); setMe(null); };
  if (!ready) return null;
  if (!me) return <Login onLogin={loadMe} />;
  if (me.must_change_password)
    return <FirstLoginPassword me={me} onDone={loadMe} onLogout={logout} />;
  return <Shell me={me} onLogout={logout} />;
}

/* ============ Primer ingreso: cambio de contraseña obligatorio ============ */
function FirstLoginPassword({ me, onDone, onLogout }: {
  me: Me; onDone: () => void; onLogout: () => void;
}) {
  const [p1, setP1] = useState(""); const [p2, setP2] = useState("");
  const [err, setErr] = useState(""); const [saving, setSaving] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr("");
    if (p1.length < 6) { setErr("La contraseña debe tener al menos 6 caracteres."); return; }
    if (p1 !== p2) { setErr("Las contraseñas no coinciden."); return; }
    setSaving(true);
    try { await api.changePassword(p1); onDone(); }
    catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  }
  return (
    <main className="flex min-h-screen flex-1 items-center justify-center bg-gradient-to-br from-[#e9f3f8] via-white to-[#eef2f6]">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center"><Logo center big /></div>
        <form onSubmit={submit} className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
          <h2 className="mb-1 text-lg font-bold text-zinc-900">Crea tu contraseña</h2>
          <p className="mb-5 text-sm text-zinc-500">
            Hola <strong>{me.username}</strong>. Entraste con una contraseña temporal.
            Define una nueva para continuar.
          </p>
          <div className="mb-3">
            <label className="mb-1.5 block text-sm font-semibold text-zinc-800">Nueva contraseña</label>
            <input type="password" value={p1} onChange={(e) => setP1(e.target.value)} autoFocus className={inputCls} />
          </div>
          <div className="mb-4">
            <label className="mb-1.5 block text-sm font-semibold text-zinc-800">Repite la contraseña</label>
            <input type="password" value={p2} onChange={(e) => setP2(e.target.value)} className={inputCls} />
          </div>
          {err && <p className="mb-3 text-sm text-red-600">{err}</p>}
          <button disabled={saving} className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {saving ? "Guardando…" : "Guardar y entrar"}
          </button>
          <button type="button" onClick={onLogout} className="mt-3 w-full text-center text-xs text-zinc-400 hover:text-zinc-600">
            Cancelar y salir
          </button>
        </form>
      </div>
    </main>
  );
}

/* ============ Login ============ */
type LoginMode = "empresa" | "proveedor" | "admin";

function Login({ onLogin }: { onLogin: () => void }) {
  const [mode, setMode] = useState<LoginMode>("empresa");
  const [slug, setSlug] = useState("");
  const [supplierSlug, setSupplierSlug] = useState("");
  const [u, setU] = useState(""); const [p, setP] = useState("");
  const [error, setError] = useState(""); const [loading, setLoading] = useState(false);

  function validate(me: Me): string | null {
    if (mode === "admin")
      return me.role === "master" ? null : "Esta cuenta no tiene acceso de administrador.";
    if (me.role === "master") return "Usa “Acceso de administrador” para entrar como LogiQ.";

    if (mode === "proveedor") {
      // El backend ya resolvió por empresa+proveedor; confirmamos que es proveedor.
      return me.is_supplier ? null : "Esta cuenta no es de proveedor. Cambia a la pestaña Empresa.";
    }
    // Empresa: el slug debe coincidir con su tenant.
    const want = slug.trim().toLowerCase();
    if (me.tenant?.slug !== want) return `Esta cuenta no pertenece a la empresa “${want}”.`;
    if (me.is_supplier) return "Esta cuenta es de proveedor. Cambia a la pestaña Proveedor.";
    return null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError("");
    if (mode !== "admin" && !slug.trim())
      return setError("Escribe la empresa (cliente).");
    if (mode === "proveedor" && !supplierSlug.trim())
      return setError("Escribe el proveedor.");
    setLoading(true);
    try {
      const opts = mode === "proveedor"
        ? { tenantSlug: slug.trim().toLowerCase(), supplierSlug: supplierSlug.trim().toLowerCase() }
        : undefined;
      await api.login(u, p, opts);
      const me = await api.me();
      const problem = validate(me);
      if (problem) { clearToken(); setError(problem); return; }
      onLogin();
    } catch (err) { setError((err as Error).message); }
    finally { setLoading(false); }
  }

  const adminMode = mode === "admin";
  return (
    <main className="relative flex min-h-screen flex-1 items-center justify-center overflow-hidden bg-gradient-to-br from-[#e9f3f8] via-white to-[#eef2f6]">
      {/* Fondo animado (colores LogiQ) */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="fta-blob anim-blob absolute -left-24 -top-24 h-[28rem] w-[28rem]"
          style={{ background: CYAN, opacity: 0.3 }} />
        <div className="fta-blob anim-blob-rev absolute -bottom-32 -right-24 h-[34rem] w-[34rem]"
          style={{ background: NAVY, opacity: 0.26 }} />
        <div className="fta-blob anim-blob absolute left-1/3 top-1/2 h-80 w-80"
          style={{ background: CYAN, opacity: 0.18, animationDelay: "-6s" }} />
        <div className="anim-float absolute left-[12%] top-[20%]" style={{ opacity: 0.18 }}><LogoMark size={60} /></div>
        <div className="anim-float absolute right-[14%] top-[28%]" style={{ opacity: 0.14, animationDelay: "-3s" }}><LogoMark size={40} /></div>
        <div className="anim-float absolute bottom-[16%] right-[24%]" style={{ opacity: 0.14, animationDelay: "-5s" }}><LogoMark size={50} /></div>
        <div className="anim-float absolute bottom-[22%] left-[20%]" style={{ opacity: 0.12, animationDelay: "-2s" }}><LogoMark size={34} /></div>
      </div>
      <div className="relative z-10 w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <Logo center big />
          <p className="mt-3 text-sm text-zinc-500">Sistema de gestión de origen</p>
        </div>
        <form onSubmit={submit} className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
          {adminMode ? (
            <div className="mb-5 flex items-center justify-between rounded-lg bg-zinc-900 px-3 py-2 text-white">
              <span className="text-sm font-medium">Acceso de administrador (LogiQ)</span>
              <button type="button" onClick={() => { setMode("empresa"); setError(""); }}
                className="text-xs text-zinc-300 hover:text-white">← Volver</button>
            </div>
          ) : (
            <div className="mb-5 grid grid-cols-2 gap-1 rounded-lg bg-zinc-100 p-1">
              {(["empresa", "proveedor"] as const).map((m) => (
                <button key={m} type="button" onClick={() => { setMode(m); setError(""); }}
                  className={cx("rounded-md py-2 text-sm font-medium capitalize transition",
                    mode === m ? "bg-white text-blue-700 shadow-sm" : "text-zinc-500 hover:text-zinc-700")}>
                  {m}
                </button>
              ))}
            </div>
          )}
          {!adminMode && (
            <div className="mb-3">
              <label className="mb-1.5 block text-sm font-semibold text-zinc-800">
                {mode === "proveedor" ? "Empresa (cliente)" : "Empresa"}
              </label>
              <input value={slug} onChange={(e) => setSlug(e.target.value)}
                placeholder={mode === "proveedor" ? "Empresa que te contrata" : "Nombre de tu empresa"} autoFocus
                className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 lowercase outline-none focus:border-blue-500" />
            </div>
          )}
          {mode === "proveedor" && (
            <div className="mb-3">
              <label className="mb-1.5 block text-sm font-semibold text-zinc-800">Proveedor</label>
              <input value={supplierSlug} onChange={(e) => setSupplierSlug(e.target.value)} placeholder="Tu identificador de proveedor"
                className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 lowercase outline-none focus:border-blue-500" />
            </div>
          )}
          <div className="mb-3">
            <label className="mb-1.5 block text-sm font-semibold text-zinc-800">Usuario</label>
            <input value={u} onChange={(e) => setU(e.target.value)} placeholder="Tu usuario" autoFocus={adminMode}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 outline-none focus:border-blue-500" />
          </div>
          <div className="mb-4">
            <label className="mb-1.5 block text-sm font-semibold text-zinc-800">Contraseña</label>
            <input type="password" value={p} onChange={(e) => setP(e.target.value)} placeholder="Tu contraseña"
              className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 outline-none focus:border-blue-500" />
          </div>
          {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
          <button disabled={loading}
            className={cx("w-full rounded-lg py-2.5 text-sm font-medium text-white disabled:opacity-50",
              adminMode ? "bg-zinc-900 hover:bg-zinc-800" : "bg-blue-600 hover:bg-blue-700")}>
            {loading ? "Entrando…" : adminMode ? "Entrar como administrador" : "Entrar"}
          </button>
        </form>
        {!adminMode && (
          <div className="mt-4 text-center">
            <button onClick={() => { setMode("admin"); setError(""); }}
              className="text-xs text-zinc-400 hover:text-zinc-600 hover:underline">
              Acceso de administrador
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

// Colores oficiales de marca LogiQ Aduanas (del SVG oficial)
const NAVY = "#043a70";
const CYAN = "#30aac6";

// Isotipo oficial (solo el símbolo) para fondos/animaciones
function LogoMark({ size = 34 }: { size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/logo-mark.png" alt="" width={size} height={size} className="object-contain" />;
}

function Logo({ center, big }: { center?: boolean; big?: boolean }) {
  return (
    <div className={cx("flex items-center", big ? "gap-4" : "gap-2.5", center && "justify-center")}>
      {/* Logo oficial LogiQ Aduanas (PNG transparente, recortado) */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-logiq.png" alt="LogiQ Aduanas" className={cx("w-auto object-contain", big ? "h-16" : "h-9")} />
      <span className={cx("font-light leading-none text-zinc-300", big ? "text-5xl" : "text-3xl")}>|</span>
      <span className={cx("leading-none", big ? "text-5xl" : "text-3xl")}
        style={{ color: NAVY, fontFamily: "Manifold, sans-serif" }}>FTA</span>
    </div>
  );
}

/* ============ Shell ============ */
type NavItem = { key: string; label: string; icon: React.ElementType; badge?: number; isNew?: boolean };
type NavSection = { label?: string; items: NavItem[] };

function navFor(me: Me, badges: Record<string, number>): NavSection[] {
  if (me.role === "master") {
    return [
      { items: [{ key: "home", label: "Inicio", icon: Home }] },
      { label: "Administración", items: [
        { key: "empresas", label: "Empresas", icon: Building2 },
        { key: "usuarios", label: "Usuarios", icon: Users },
      ] },
      { label: "Catálogos", items: [
        { key: "tratados", label: "Tratados (TLC)", icon: ScrollText },
        { key: "reglas", label: "Reglas de origen", icon: BookOpen },
      ] },
    ];
  }
  if (me.is_supplier) {
    return [
      { items: [{ key: "home", label: "Inicio", icon: Home }] },
      { label: "Catálogo", items: [
        { key: "mis-productos", label: "Productos", icon: Package },
      ] },
      { label: "Origen", items: [
        { key: "mis-solicitudes", label: "Solicitudes de cliente", icon: Inbox, badge: badges.pendientes },
        { key: "mis-declaraciones", label: "Mis declaraciones", icon: FileText },
      ] },
    ];
  }
  return [
    { items: [{ key: "home", label: "Inicio", icon: Home }] },
    { label: "Catálogos", items: [
      { key: "proveedores", label: "Proveedores", icon: Truck },
      { key: "insumos", label: "Números de parte", icon: Package },
    ] },
    { label: "Origen", items: [
      { key: "productos", label: "Productos", icon: Boxes },
      { key: "calificaciones", label: "Calificaciones", icon: CheckCircle2 },
      { key: "certificados", label: "Certificados", icon: BadgeCheck },
      { key: "solicitudes", label: "Solicitudes", icon: ClipboardList, badge: badges.pendientes },
    ] },
    { label: "Referencia", items: [
      { key: "tratados", label: "Tratados (TLC)", icon: ScrollText },
      { key: "reglas", label: "Reglas de origen", icon: BookOpen },
    ] },
  ];
}

function Shell({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const [view, setView] = useState("home");
  const [badges, setBadges] = useState<Record<string, number>>({});
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    // badge de solicitudes pendientes (empresa o proveedor)
    if (me.role === "master") return;
    api.solicitations().then((r) => {
      const pend = r.results.filter((s: Solicitation) => s.status !== "responded").length;
      setBadges({ pendientes: pend });
    }).catch(() => {});
  }, [me.role, view]);

  const sections = navFor(me, badges);
  const subtitle = me.role === "master" ? "Equipo LogiQ"
    : me.is_supplier ? `Proveedor · ${me.supplier?.name}`
    : `${me.role_display} · ${me.tenant?.name}`;
  const headerName = me.is_supplier ? me.supplier?.name : (me.tenant?.name ?? "LogiQ");

  return (
    <div className="flex min-h-screen bg-[#f5f6f8] text-zinc-800">
      {/* Catálogo de países para autocompletar/validar inputs de país */}
      <datalist id="iso-countries">
        {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
      </datalist>
      {/* Sidebar */}
      <aside className="flex w-80 flex-col border-r border-zinc-200 bg-white">
        <div className="flex h-16 items-center border-b border-zinc-100 px-4"><Logo /></div>
        <div className="border-b border-zinc-100 px-4 py-3">
          <div className="text-sm font-semibold text-zinc-900">{headerName}</div>
          <div className="truncate text-xs text-zinc-500">{subtitle}</div>
        </div>
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
          {sections.map((sec, i) => (
            <div key={i}>
              {sec.label && (
                <div className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                  {sec.label}
                </div>
              )}
              {sec.items.map((it) => {
                const active = view === it.key;
                const Icon = it.icon;
                return (
                  <button key={it.key} onClick={() => setView(it.key)}
                    className={cx("mb-0.5 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm",
                      active ? "bg-blue-50 font-medium text-blue-700" : "text-zinc-600 hover:bg-zinc-100")}>
                    <Icon size={18} className={active ? "text-blue-600" : "text-zinc-400"} />
                    <span className="flex-1 text-left">{it.label}</span>
                    {it.badge ? (
                      <span className="rounded-full bg-amber-100 px-2 text-xs font-semibold text-amber-700">{it.badge}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>

      {/* Main */}
      <div className="flex flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-zinc-200 bg-white px-6">
          <div className="relative w-80 max-w-full">
            <Search size={16} className="absolute left-3 top-2.5 text-zinc-400" />
            <input placeholder="Buscar…" className="w-full rounded-lg border border-zinc-200 bg-zinc-50 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-400" />
          </div>
          <div className="relative">
            <button onClick={() => setMenuOpen(!menuOpen)}
              className="flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm hover:bg-zinc-50">
              <div className="grid h-6 w-6 place-items-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">
                {me.username.slice(0, 2).toUpperCase()}
              </div>
              <span className="font-medium">{me.username}</span>
              <ChevronDown size={15} className="text-zinc-400" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 mt-1 w-44 rounded-lg border border-zinc-200 bg-white py-1 shadow-lg">
                <div className="px-3 py-2 text-xs text-zinc-500">{me.role_display}</div>
                <button onClick={onLogout}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50">
                  <LogOut size={15} /> Cerrar sesión
                </button>
              </div>
            )}
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-8">
          <View view={view} me={me} go={setView} />
        </main>
      </div>
    </div>
  );
}

/* ============ Router de vistas ============ */
function View({ view, me, go }: { view: string; me: Me; go: (v: string) => void }) {
  switch (view) {
    case "home": return <HomeView me={me} go={go} />;
    case "empresas": return <EmpresasView />;
    case "usuarios": return <UsuariosView />;
    case "tratados": return <TratadosView />;
    case "reglas": return <ReglasView />;
    case "productos": return <ProductosView />;
    case "insumos": return <InsumosView />;
    case "calificaciones": return <CalificacionesView />;
    case "certificados": return <CertificadosView />;
    case "proveedores": return <ProveedoresView me={me} />;
    case "solicitudes": return <SolicitudesEmpresaView />;
    case "mis-productos": return <ProveedorProductosView />;
    case "mis-solicitudes": return <MisSolicitudesView me={me} />;
    case "mis-declaraciones": return <MisDeclaracionesView />;
    default: return <HomeView me={me} go={go} />;
  }
}

/* ============ UI primitives ============ */
function PageTitle({ title, desc }: { title: string; desc?: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-bold tracking-tight text-zinc-900">{title}</h1>
      {desc && <p className="mt-1 text-sm text-zinc-500">{desc}</p>}
    </div>
  );
}
function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cx("rounded-xl border border-zinc-200 bg-white", className)}>{children}</div>;
}
function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-zinc-50 text-left text-zinc-500">
          <tr>{head.map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">{children}</tbody>
      </table>
    </Card>
  );
}
function Btn({ children, onClick, variant = "primary", size = "md", disabled }: {
  children: React.ReactNode; onClick?: () => void;
  variant?: "primary" | "ghost" | "danger"; size?: "sm" | "md"; disabled?: boolean;
}) {
  const v = {
    primary: "bg-blue-600 text-white hover:bg-blue-700",
    ghost: "border border-zinc-300 text-zinc-700 hover:bg-zinc-100",
    danger: "border border-red-300 text-red-600 hover:bg-red-50",
  }[variant];
  const s = size === "sm" ? "px-2.5 py-1 text-xs" : "px-4 py-2 text-sm";
  return <button onClick={onClick} disabled={disabled}
    className={cx("rounded-lg font-medium disabled:opacity-50", v, s)}>{children}</button>;
}
function Modal({ title, onClose, children }: {
  title: string; onClose: () => void; children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4">
          <h3 className="font-semibold text-zinc-900">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700">
            <X size={18} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-zinc-700">{label}</span>
      {children}
    </label>
  );
}
const inputCls = "w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 outline-none focus:border-blue-500";

const STATUS_PILL: Record<string, string> = {
  QUALIFIES: "bg-green-100 text-green-700", DOES_NOT: "bg-red-100 text-red-700",
  INSUFFICIENT: "bg-amber-100 text-amber-700",
  active: "bg-green-100 text-green-700", suspended: "bg-red-100 text-red-700",
  expired: "bg-zinc-200 text-zinc-600", responded: "bg-green-100 text-green-700",
  pending: "bg-amber-100 text-amber-700", sent: "bg-blue-100 text-blue-700",
};
function Pill({ k, children }: { k?: string; children: React.ReactNode }) {
  return <span className={cx("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_PILL[k ?? ""] ?? "bg-zinc-100 text-zinc-600")}>{children}</span>;
}
function ActionCard({ icon: Icon, color, title, desc, onClick }: {
  icon: React.ElementType; color: string; title: string; desc: string; onClick?: () => void;
}) {
  return (
    <button onClick={onClick}
      className="flex flex-col items-start rounded-xl border border-zinc-200 bg-white p-5 text-left transition hover:border-blue-300 hover:shadow-sm">
      <div className={cx("mb-3 grid h-10 w-10 place-items-center rounded-lg", color)}><Icon size={20} /></div>
      <div className="font-semibold text-zinc-900">{title}</div>
      <div className="mt-0.5 text-sm text-zinc-500">{desc}</div>
    </button>
  );
}
function useList<T>(fn: () => Promise<{ results: T[]; count: number }>, deps: unknown[] = []) {
  const [data, setData] = useState<T[]>([]); const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const reload = () => fn().then((r) => { setData(r.results); setCount(r.count); })
    .catch((e) => setError(e.message)).finally(() => setLoading(false));
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, deps);
  return { data, count, loading, error, reload };
}

/* ============ HOME ============ */
function HomeView({ me, go }: { me: Me; go: (v: string) => void }) {
  const cards = me.role === "master" ? [
    { icon: Building2, color: "bg-blue-50 text-blue-600", title: "Empresas", desc: "Alta, baja y licencias", k: "empresas" },
    { icon: Users, color: "bg-purple-50 text-purple-600", title: "Usuarios", desc: "Crear y administrar accesos", k: "usuarios" },
    { icon: ScrollText, color: "bg-emerald-50 text-emerald-600", title: "Tratados", desc: "Catálogo de TLC", k: "tratados" },
    { icon: BookOpen, color: "bg-amber-50 text-amber-600", title: "Reglas", desc: "Reglas de origen", k: "reglas" },
  ] : me.is_supplier ? [
    { icon: Package, color: "bg-blue-50 text-blue-600", title: "Productos", desc: "Lo que tus clientes te compran", k: "mis-productos" },
    { icon: Inbox, color: "bg-amber-50 text-amber-600", title: "Solicitudes de cliente", desc: "Información que te piden", k: "mis-solicitudes" },
    { icon: FileText, color: "bg-emerald-50 text-emerald-600", title: "Mis declaraciones", desc: "Lo que ya enviaste", k: "mis-declaraciones" },
  ] : [
    { icon: Package, color: "bg-blue-50 text-blue-600", title: "Productos", desc: "Califica tus productos", k: "productos" },
    { icon: Truck, color: "bg-purple-50 text-purple-600", title: "Proveedores", desc: "Tu padrón de proveedores", k: "proveedores" },
    { icon: ClipboardList, color: "bg-amber-50 text-amber-600", title: "Solicitudes", desc: "Pide origen a proveedores", k: "solicitudes" },
    { icon: BadgeCheck, color: "bg-emerald-50 text-emerald-600", title: "Certificados", desc: "Emite certificados de origen", k: "certificados" },
  ];
  return (
    <div>
      <PageTitle title={`Bienvenido, ${me.username}.`}
        desc={me.role === "master" ? "Panel del equipo LogiQ — administra el sistema."
          : me.is_supplier ? "Completa la información de origen que te solicitan."
          : "Gestiona el origen de tus productos y proveedores."} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => <ActionCard key={c.k} {...c} onClick={() => go(c.k)} />)}
      </div>
    </div>
  );
}

/* ============ MASTER ============ */
function EmpresasView() {
  const { data, reload, loading } = useList<MasterTenant>(() => api.masterTenants());
  const [name, setName] = useState(""); const [rfc, setRfc] = useState(""); const [msg, setMsg] = useState("");
  const act = async (fn: () => Promise<unknown>) => { try { await fn(); await reload(); } catch (e) { setMsg((e as Error).message); } };
  return (
    <div>
      <PageTitle title="Empresas" desc="Clientes del sistema y sus licencias." />
      {msg && <p className="mb-3 text-sm text-amber-600">{msg}</p>}
      <Table head={["Empresa", "Slug", "RFC", "Usuarios", "Plan", "Licencia", ""]}>
        {data.map((t) => (
          <tr key={t.id}>
            <td className="px-4 py-3 font-medium">{t.name}</td>
            <td className="px-4 py-3"><code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600">{t.slug}</code></td>
            <td className="px-4 py-3 font-mono text-xs">{t.rfc || "—"}</td>
            <td className="px-4 py-3">{t.user_count}</td>
            <td className="px-4 py-3">{t.license?.plan_display ?? "—"}</td>
            <td className="px-4 py-3"><Pill k={t.license?.status}>{t.license?.status_display ?? "—"}</Pill></td>
            <td className="px-4 py-3 text-right">
              <span className="mr-2 inline-block">
                <Btn size="sm" variant="ghost" onClick={() => act(() => api.masterSetLicense(t.id,
                  { status: t.license?.status === "active" ? "suspended" : "active" }))}>
                  {t.license?.status === "active" ? "Suspender" : "Activar"}
                </Btn>
              </span>
              <Btn size="sm" variant="danger" onClick={() => { if (confirm(`¿Eliminar ${t.name}?`)) act(() => api.masterDeleteTenant(t.id)); }}>Eliminar</Btn>
            </td>
          </tr>
        ))}
        {!loading && data.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-zinc-400">Sin empresas.</td></tr>}
      </Table>
      <Card className="mt-6 max-w-md p-5">
        <h3 className="mb-3 font-semibold">Nueva empresa</h3>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Razón social"
          className="mb-2 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm" />
        <input value={rfc} onChange={(e) => setRfc(e.target.value)} placeholder="RFC (opcional)"
          className="mb-3 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm" />
        <Btn onClick={() => name && act(async () => { await api.masterCreateTenant({ name, rfc }); setName(""); setRfc(""); })}>
          <Plus size={15} className="-mt-0.5 mr-1 inline" />Crear empresa
        </Btn>
      </Card>
    </div>
  );
}

function UsuariosView() {
  const { data, reload } = useList<{ id: number; username: string; is_locked: boolean; membership: { tenant: string; role_display: string; party: string | null } | null }>(() => api.masterUsers());
  const tenants = useList<MasterTenant>(() => api.masterTenants());
  const [f, setF] = useState({ username: "", password: "", tenant: "" as number | "", role: "admin" });
  const [msg, setMsg] = useState("");
  async function create() {
    if (!f.username || !f.tenant) { setMsg("Usuario y empresa son obligatorios."); return; }
    try { await api.masterCreateUser(f); setF({ username: "", password: "", tenant: "", role: "admin" }); setMsg("Usuario creado."); await reload(); }
    catch (e) { setMsg((e as Error).message); }
  }
  async function unlock(id: number) {
    setMsg(""); try { await api.masterUnlockUser(id); await reload(); }
    catch (e) { setMsg((e as Error).message); }
  }
  return (
    <div>
      <PageTitle title="Usuarios" desc="Accesos de empresas y proveedores." />
      {msg && <p className="mb-3 text-sm text-amber-600">{msg}</p>}
      <Table head={["Usuario", "Empresa", "Rol", "Proveedor", "Estado", ""]}>
        {data.map((u) => (
          <tr key={u.id}>
            <td className="px-4 py-3 font-medium">{u.username}</td>
            <td className="px-4 py-3">{u.membership?.tenant ?? "—"}</td>
            <td className="px-4 py-3">{u.membership?.role_display ?? "Master"}</td>
            <td className="px-4 py-3">{u.membership?.party ?? "—"}</td>
            <td className="px-4 py-3">
              {u.is_locked
                ? <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Bloqueado</span>
                : <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Activo</span>}
            </td>
            <td className="px-4 py-3 text-right">
              {u.is_locked && <Btn size="sm" onClick={() => unlock(u.id)}>Desbloquear</Btn>}
            </td>
          </tr>
        ))}
      </Table>
      <Card className="mt-6 max-w-xl p-5">
        <h3 className="mb-3 font-semibold">Nuevo usuario</h3>
        <div className="grid grid-cols-2 gap-2">
          <input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} placeholder="Usuario"
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm" />
          <input value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} placeholder="Contraseña"
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm" />
          <select value={f.tenant} onChange={(e) => setF({ ...f, tenant: Number(e.target.value) })}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm">
            <option value="">— Empresa —</option>
            {tenants.data.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm">
            <option value="admin">Administrador</option>
            <option value="analyst">Analista</option>
            <option value="auditor">Auditor</option>
          </select>
        </div>
        <div className="mt-3"><Btn onClick={create}><Plus size={15} className="-mt-0.5 mr-1 inline" />Crear usuario</Btn></div>
      </Card>
    </div>
  );
}

/* ============ CATÁLOGOS ============ */
function TratadosView() {
  const { data, count } = useList<Treaty & { name: string; code: string }>(() => api.treaties());
  return (
    <div>
      <PageTitle title="Tratados (TLC)" desc={`${count} tratados en el catálogo.`} />
      <Table head={["Código", "Nombre"]}>
        {data.map((t) => (
          <tr key={t.id}><td className="px-4 py-3 font-mono text-xs font-semibold">{treatyLabel(t.code)}</td>
            <td className="px-4 py-3">{t.name}</td></tr>
        ))}
      </Table>
    </div>
  );
}
// Formatea la fracción HS: 870810 -> 8708.10 (y 8 o 10 dígitos con más grupos).
function formatHs(p: string) {
  const d = (p || "").replace(/\D/g, "");
  if (d.length <= 4) return d;
  let out = d.slice(0, 4) + "." + d.slice(4, 6);
  if (d.length > 6) out += "." + d.slice(6);
  return out;
}
// Input de fracción: solo 6 dígitos, se muestra con punto (8708.10).
function HsInput({ value, onChange, className, placeholder }: {
  value: string; onChange: (v: string) => void; className?: string; placeholder?: string;
}) {
  return (
    <input value={formatHs(value)} placeholder={placeholder ?? "8708.10"}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
      className={cx(className ?? inputCls, "font-mono")} />
  );
}
// Campo de país (ISO-2) con autocompletado y validación contra catálogo.
function CountryInput({ value, onChange, className }: {
  value: string; onChange: (v: string) => void; className?: string;
}) {
  const v = (value || "").toUpperCase();
  const valid = isValidCountry(v);
  return (
    <span className="block">
      <input list="iso-countries" value={v} maxLength={2} placeholder="MX"
        onChange={(e) => onChange(e.target.value.replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 2))}
        className={cx(className ?? inputCls, "uppercase", !valid && "border-red-400 bg-red-50")} />
      {!valid && <span className="mt-0.5 block text-[11px] text-red-600">País no válido</span>}
    </span>
  );
}
// Modal: el proveedor sugiere corregir la fracción.
function SuggestHsModal({ product, onClose, onSaved }: {
  product: Product; onClose: () => void; onSaved: () => void;
}) {
  const [hs, setHs] = useState(""); const [note, setNote] = useState("");
  const [err, setErr] = useState(""); const [saving, setSaving] = useState(false);
  async function save() {
    if (hs.length < 6) { setErr("La fracción debe tener 6 dígitos."); return; }
    setErr(""); setSaving(true);
    try { await api.suggestHs(product.id, hs, note); onSaved(); }
    catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  }
  return (
    <Modal title={`Sugerir fracción — ${product.sku}`} onClose={onClose}>
      <p className="mb-3 text-sm text-zinc-500">
        Fracción actual del cliente: <strong className="font-mono">{formatHs(product.hs_code) || "—"}</strong>.
        Si crees que es incorrecta, sugiere la correcta. El cliente la aceptará o rechazará.
      </p>
      <Field label="Fracción sugerida (6 dígitos)"><HsInput value={hs} onChange={setHs} /></Field>
      <div className="mt-3"><Field label="Motivo (opcional)">
        <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} placeholder="¿Por qué?" />
      </Field></div>
      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
        <Btn onClick={save} disabled={saving}>{saving ? "Enviando…" : "Enviar sugerencia"}</Btn>
      </div>
    </Modal>
  );
}
// Modal: el proveedor define el país de origen del producto.
function CountryModal({ product, onClose, onSaved }: {
  product: Product; onClose: () => void; onSaved: () => void;
}) {
  const [c, setC] = useState(product.country_of_origin ?? "");
  const [err, setErr] = useState(""); const [saving, setSaving] = useState(false);
  async function save() {
    if (!isValidCountry(c)) { setErr("País no válido. Usa un código ISO-2 del catálogo (ej. MX, US, CN)."); return; }
    setErr(""); setSaving(true);
    try { await api.setCountry(product.id, c.trim().toUpperCase()); onSaved(); }
    catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  }
  return (
    <Modal title={`País de origen — ${product.sku}`} onClose={onClose}>
      <p className="mb-3 text-sm text-zinc-500">{product.description}</p>
      <Field label="País de origen (ISO-2)">
        <CountryInput value={c} onChange={setC} />
      </Field>
      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
        <Btn onClick={save} disabled={saving}>{saving ? "Guardando…" : "Guardar país"}</Btn>
      </div>
    </Modal>
  );
}
// Modal: historial (bitácora) de cambios de fracción.
function HsLogModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const logs = product.hs_logs ?? [];
  return (
    <Modal title={`Historial de fracción — ${product.sku}`} onClose={onClose}>
      {logs.length === 0 ? <p className="text-sm text-zinc-400">Sin cambios registrados.</p> : (
        <ul className="space-y-2 text-sm">
          {logs.map((l, i) => (
            <li key={i} className="rounded-lg border border-zinc-200 p-2">
              <span className={cx("rounded-full px-2 py-0.5 text-xs font-medium",
                l.action === "accepted" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700")}>
                {l.action === "accepted" ? "Aceptada" : "Rechazada"}
              </span>
              <span className="ml-2 font-mono">{formatHs(l.old_hs) || "—"} → {formatHs(l.new_hs)}</span>
              <div className="mt-1 text-xs text-zinc-500">Sugerida por {l.suggested_by || "—"} · {l.created_at?.slice(0, 10)}{l.note ? ` · ${l.note}` : ""}</div>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-5 flex justify-end"><Btn variant="ghost" onClick={onClose}>Cerrar</Btn></div>
    </Modal>
  );
}
function ReglasView() {
  const treaties = useList<Treaty>(() => api.treaties());
  const [treaty, setTreaty] = useState<number | "">("");
  const [hs, setHs] = useState("");
  const [pageSize, setPageSize] = useState("50");
  const buildParams = () => {
    const p = new URLSearchParams();
    p.set("page_size", pageSize === "all" ? "5000" : pageSize);
    if (treaty !== "") p.set("treaty", String(treaty));
    if (hs.trim()) p.set("q", hs.trim());
    return "?" + p.toString();
  };
  const { data, count, loading } = useList<OriginRule>(
    () => api.rules(buildParams()), [treaty, hs, pageSize]);
  return (
    <div>
      <PageTitle title="Reglas de origen" desc={`${count} reglas en total · mostrando ${data.length}.`} />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-semibold text-zinc-700">Tratado</label>
          <select value={treaty} onChange={(e) => setTreaty(e.target.value === "" ? "" : Number(e.target.value))}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm">
            <option value="">Todos los tratados</option>
            {treaties.data.map((t) => <option key={t.id} value={t.id}>{treatyLabel(t.code)} — {t.name}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-zinc-700">Fracción (HS)</label>
          <input value={hs} onChange={(e) => setHs(e.target.value)} placeholder="ej. 8708"
            className="w-40 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-mono" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-zinc-700">Mostrar</label>
          <select value={pageSize} onChange={(e) => setPageSize(e.target.value)}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm">
            <option value="50">50</option>
            <option value="100">100</option>
            <option value="all">Todo</option>
          </select>
        </div>
      </div>
      <Table head={["Tratado", "HS", "Tipo", "Descripción"]}>
        {data.map((r) => (
          <tr key={r.id}>
            <td className="px-4 py-3"><span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700">{r.treaty_label ?? r.treaty_code}</span></td>
            <td className="px-4 py-3 font-mono text-xs font-semibold">{formatHs(r.hs_pattern)}</td>
            <td className="px-4 py-3"><Pill>{r.rule_type}</Pill></td>
            <td className="px-4 py-3 text-zinc-600">{r.description?.slice(0, 110)}</td>
          </tr>
        ))}
        {!loading && data.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-zinc-400">Sin reglas para ese filtro.</td></tr>}
      </Table>
    </div>
  );
}

/* ============ EMPRESA ============ */
function ProductosView() {
  const { data, reload, loading } = useList<Product>(() => api.products());
  const treaties = useList<Treaty>(() => api.treaties());
  const quals = useList<Qualification>(() => api.qualifications());
  const parties = useList<{ id: number; name: string; kind: string }>(() => api.parties());
  const [treatyId, setTreatyId] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  useEffect(() => {
    if (!treatyId && treaties.data.length) {
      const tmec = treaties.data.find((t) => t.code === "TMEC");
      setTreatyId(tmec ? tmec.id : treaties.data[0].id);
    }
  }, [treaties.data, treatyId]);
  const qualFor = (pid: number) => quals.data.find((q) => q.product === pid && q.treaty === treatyId);
  async function run(pid: number, fn: () => Promise<Qualification>) {
    setMsg("…"); try { const q = await fn(); setMsg(`${q.status_display}${q.rvc_value ? ` · VCR ${q.rvc_value}%` : ""}`); await quals.reload(); }
    catch (e) { setMsg((e as Error).message); }
  }
  async function del(p: Product) {
    if (!confirm(`¿Eliminar el producto “${p.sku}”?`)) return;
    setMsg(""); try { await api.deleteProduct(p.id); await reload(); }
    catch (e) { setMsg((e as Error).message); }
  }
  const suppliers = parties.data.filter((p) => p.kind === "supplier");
  // En "Productos" solo los terminados/subensambles; los insumos van en "Números de parte".
  const visibles = data.filter((p) => p.kind !== "material");
  return (
    <div>
      <PageTitle title="Productos terminados" desc="Tus productos terminados. Califícalos contra los tratados." />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="text-sm text-zinc-500">Tratado:</span>
        <select value={treatyId ?? ""} onChange={(e) => setTreatyId(Number(e.target.value))}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm">
          {treaties.data.map((t) => <option key={t.id} value={t.id}>{treatyLabel(t.code)} — {t.name}</option>)}
        </select>
        <div className="ml-auto"><Btn onClick={() => setEditing("new")}><Plus size={15} className="-mt-0.5 mr-1 inline" />Nuevo producto</Btn></div>
      </div>
      {msg && <p className="mb-3 text-sm text-amber-600">{msg}</p>}
      <Table head={["SKU", "Descripción", "Tipo", "HS", "Resultado", ""]}>
        {visibles.map((p) => {
          const q = qualFor(p.id);
          return (
            <tr key={p.id}>
              <td className="px-4 py-3 font-mono text-xs">{p.sku}</td>
              <td className="px-4 py-3">{p.description}</td>
              <td className="px-4 py-3 text-xs text-zinc-500">{p.kind_display ?? p.kind}</td>
              <td className="px-4 py-3 font-mono text-xs">{formatHs(p.hs_code)}</td>
              <td className="px-4 py-3">{q ? <Pill k={q.status}>{q.status_display}{q.rvc_value ? ` · ${q.rvc_value}%` : ""}</Pill> : <span className="text-zinc-400">—</span>}</td>
              <td className="px-4 py-3 text-right whitespace-nowrap">
                <span className="mr-2 inline-block"><Btn size="sm" onClick={() => treatyId && run(p.id, () => api.qualify(p.id, treatyId))}>Calificar</Btn></span>
                <span className="mr-2 inline-block"><Btn size="sm" variant="ghost" onClick={() => treatyId && run(p.id, async () => { await api.solicit(p.id, treatyId); return { status_display: "Solicitudes enviadas", rvc_value: null } as unknown as Qualification; })}>Solicitar origen</Btn></span>
                <button onClick={() => setEditing(p)} title="Editar"
                  className="mr-1 rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-blue-600"><Pencil size={15} /></button>
                <button onClick={() => del(p)} title="Eliminar"
                  className="rounded-lg p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={15} /></button>
              </td>
            </tr>
          );
        })}
        {!loading && visibles.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-zinc-400">Aún no tienes productos terminados. Crea el primero con “Nuevo producto”.</td></tr>}
      </Table>
      {editing && (
        <ProductForm product={editing === "new" ? null : editing} suppliers={suppliers}
          onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await reload(); }} />
      )}
    </div>
  );
}

const KINDS = [
  { value: "finished", label: "Producto terminado" },
  { value: "subassembly", label: "Subensamble" },
  { value: "material", label: "Material / Insumo" },
];
function ProductForm({ product, suppliers, onClose, onSaved }: {
  product: Product | null; suppliers: { id: number; name: string }[];
  onClose: () => void; onSaved: () => void;
}) {
  const [f, setF] = useState({
    sku: product?.sku ?? "", description: product?.description ?? "",
    kind: product?.kind ?? "finished", hs_code: product?.hs_code ?? "",
    unit_cost: product?.unit_cost ?? "0", currency: product?.currency ?? "USD",
    country_of_origin: product?.country_of_origin ?? "",
    supplier: (product?.supplier ?? "") as number | "",
  });
  const [err, setErr] = useState(""); const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f, v: string | number) => setF({ ...f, [k]: v });
  async function save() {
    if (!f.sku.trim() || !f.description.trim() || !f.hs_code.trim()) {
      setErr("SKU, descripción y fracción arancelaria (HS) son obligatorios."); return;
    }
    setErr(""); setSaving(true);
    const payload = {
      sku: f.sku.trim(), description: f.description.trim(), kind: f.kind,
      hs_code: f.hs_code.trim(), unit_cost: f.unit_cost || "0",
      currency: f.currency || "USD",
      country_of_origin: f.country_of_origin.trim().toUpperCase(),
      supplier: f.supplier === "" ? null : Number(f.supplier),
    };
    try {
      if (product) await api.updateProduct(product.id, payload);
      else await api.createProduct(payload);
      onSaved();
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  }
  return (
    <Modal title={product ? "Editar producto" : "Nuevo producto"} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="SKU / Núm. de parte">
          <input value={f.sku} onChange={(e) => set("sku", e.target.value)} className={inputCls} placeholder="PT-001" autoFocus />
        </Field>
        <Field label="Tipo">
          <select value={f.kind} onChange={(e) => set("kind", e.target.value)} className={inputCls}>
            {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </Field>
        <div className="col-span-2">
          <Field label="Descripción">
            <input value={f.description} onChange={(e) => set("description", e.target.value)} className={inputCls} placeholder="Nombre del producto" />
          </Field>
        </div>
        <Field label="Fracción arancelaria (HS, 6 dígitos)">
          <HsInput value={f.hs_code} onChange={(v) => set("hs_code", v)} />
        </Field>
        <Field label="País de origen (ISO-2)">
          <input value={f.country_of_origin} onChange={(e) => set("country_of_origin", e.target.value)} className={cx(inputCls, "uppercase")} placeholder="MX" maxLength={2} />
        </Field>
        <Field label="Costo unitario">
          <input type="number" step="0.0001" value={f.unit_cost} onChange={(e) => set("unit_cost", e.target.value)} className={inputCls} />
        </Field>
        <Field label="Moneda">
          <input value={f.currency} onChange={(e) => set("currency", e.target.value.toUpperCase())} className={cx(inputCls, "uppercase")} maxLength={3} placeholder="USD" />
        </Field>
        <div className="col-span-2">
          <Field label="Proveedor (opcional)">
            <select value={f.supplier} onChange={(e) => set("supplier", e.target.value === "" ? "" : Number(e.target.value))} className={inputCls}>
              <option value="">— Sin proveedor —</option>
              {suppliers.map((sp) => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
            </select>
          </Field>
        </div>
      </div>
      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
        <Btn onClick={save} disabled={saving}>{saving ? "Guardando…" : product ? "Guardar cambios" : "Crear producto"}</Btn>
      </div>
    </Modal>
  );
}
/* ====== Insumos / Números de parte (lo que la empresa compra) ====== */
const KIND_BADGE: Record<string, { label: string; cls: string }> = {
  material: { label: "Insumo", cls: "bg-blue-100 text-blue-700" },
  subassembly: { label: "Subproducto", cls: "bg-purple-100 text-purple-700" },
  finished: { label: "Producto", cls: "bg-emerald-100 text-emerald-700" },
};
function KindBadge({ kind }: { kind: string }) {
  const b = KIND_BADGE[kind] ?? { label: kind, cls: "bg-zinc-100 text-zinc-600" };
  return <span className={cx("rounded-full px-2 py-0.5 text-xs font-medium", b.cls)}>{b.label}</span>;
}
function InsumosView() {
  const { data, reload, loading } = useList<Product>(() => api.products());
  const parties = useList<Party>(() => api.parties());
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [logFor, setLogFor] = useState<Product | null>(null);
  const [msg, setMsg] = useState("");
  const suppliers = parties.data.filter((p) => p.kind === "supplier");
  async function del(p: Product) {
    if (!confirm(`¿Eliminar el número de parte “${p.sku}”?`)) return;
    setMsg(""); try { await api.deleteProduct(p.id); await reload(); }
    catch (e) { setMsg((e as Error).message); }
  }
  async function resolve(p: Product, action: "accept" | "reject") {
    setMsg(""); try {
      await api.resolveHs(p.id, action);
      setMsg(action === "accept" ? "Fracción actualizada y registrada en bitácora." : "Sugerencia rechazada (registrada en bitácora).");
      await reload();
    } catch (e) { setMsg((e as Error).message); }
  }
  return (
    <div>
      <PageTitle title="Números de parte" desc="Tu catálogo de partes (insumos, subproductos y productos) ligadas a su proveedor." />
      <div className="mb-4 flex">
        <div className="ml-auto"><Btn onClick={() => setEditing("new")}><Plus size={15} className="-mt-0.5 mr-1 inline" />Nuevo número de parte</Btn></div>
      </div>
      {msg && <p className="mb-3 text-sm text-emerald-700">{msg}</p>}
      {suppliers.length === 0 && !loading && (
        <Card className="mb-4 p-4 text-sm text-amber-700">
          Primero da de alta al menos un proveedor en <strong>Catálogos → Proveedores</strong> para poder ligarle números de parte.
        </Card>
      )}
      <Table head={["Núm. de parte", "Tipo", "Descripción", "Proveedor", "HS", "País", "Precio unitario", "Estatus", ""]}>
        {data.map((p) => (
          <tr key={p.id} className={p.is_active ? "" : "opacity-60"}>
            <td className="px-4 py-3 font-mono text-xs font-semibold">{p.sku}</td>
            <td className="px-4 py-3"><KindBadge kind={p.kind} /></td>
            <td className="px-4 py-3">{p.description}</td>
            <td className="px-4 py-3">
              {p.supplier_name
                ? <span>{p.supplier_name} {p.supplier_code ? <code className="ml-1 rounded bg-zinc-100 px-1 py-0.5 text-[11px] text-zinc-600">{p.supplier_code}</code> : null}</span>
                : <span className="text-zinc-400">—</span>}
            </td>
            <td className="px-4 py-3">
              <span className="font-mono text-xs">{formatHs(p.hs_code) || "—"}</span>
              {(p.hs_logs?.length ?? 0) > 0 && (
                <button onClick={() => setLogFor(p)} className="ml-2 text-[11px] text-blue-600 hover:underline">historial</button>
              )}
              {p.hs_suggestion_status === "pending" && (
                <div className="mt-1 rounded-lg bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
                  Proveedor sugiere <strong className="font-mono">{formatHs(p.hs_suggested ?? "")}</strong>
                  {p.hs_suggestion_note ? ` — ${p.hs_suggestion_note}` : ""}
                  <div className="mt-1 flex gap-1">
                    <Btn size="sm" onClick={() => resolve(p, "accept")}>Aceptar</Btn>
                    <Btn size="sm" variant="ghost" onClick={() => resolve(p, "reject")}>Rechazar</Btn>
                  </div>
                </div>
              )}
            </td>
            <td className="px-4 py-3">{p.country_of_origin || <span className="text-zinc-400">—</span>}</td>
            <td className="px-4 py-3 font-mono text-xs">{p.unit_cost} {p.currency}</td>
            <td className="px-4 py-3">
              <span className={cx("rounded-full px-2 py-0.5 text-xs font-medium",
                p.is_active ? "bg-green-100 text-green-700" : "bg-zinc-200 text-zinc-600")}>
                {p.is_active ? "Activo" : "Inactivo"}
              </span>
            </td>
            <td className="px-4 py-3 text-right whitespace-nowrap">
              <button onClick={() => setEditing(p)} title="Editar"
                className="mr-1 rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-blue-600"><Pencil size={15} /></button>
              <button onClick={() => del(p)} title="Eliminar"
                className="rounded-lg p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={15} /></button>
            </td>
          </tr>
        ))}
        {!loading && data.length === 0 && <tr><td colSpan={9} className="px-4 py-8 text-center text-zinc-400">Aún no tienes números de parte. Crea el primero con el botón de arriba.</td></tr>}
      </Table>
      {editing && (
        <InsumoForm insumo={editing === "new" ? null : editing} suppliers={suppliers}
          onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await reload(); }} />
      )}
      {logFor && <HsLogModal product={logFor} onClose={() => setLogFor(null)} />}
    </div>
  );
}
function InsumoForm({ insumo, suppliers, onClose, onSaved }: {
  insumo: Product | null; suppliers: Party[]; onClose: () => void; onSaved: () => void;
}) {
  const [f, setF] = useState({
    sku: insumo?.sku ?? "", description: insumo?.description ?? "",
    kind: insumo?.kind ?? "material",
    supplier: (insumo?.supplier ?? "") as number | "",
    hs_code: insumo?.hs_code ?? "", unit_cost: insumo?.unit_cost ?? "0",
    currency: insumo?.currency ?? "USD", country_of_origin: insumo?.country_of_origin ?? "",
    is_active: insumo?.is_active ?? true,
  });
  const [err, setErr] = useState(""); const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f, v: string | number | boolean) => setF({ ...f, [k]: v });
  async function save() {
    if (!f.sku.trim() || !f.description.trim()) {
      setErr("El número de parte y la descripción son obligatorios."); return;
    }
    setErr(""); setSaving(true);
    const payload = {
      sku: f.sku.trim(), description: f.description.trim(), kind: f.kind,
      supplier: f.supplier === "" ? null : Number(f.supplier),
      hs_code: f.hs_code, unit_cost: f.unit_cost || "0",
      currency: f.currency || "USD",
      // El país de origen lo define el PROVEEDOR (no la empresa).
      is_active: f.is_active,
    };
    try {
      if (insumo) await api.updateProduct(insumo.id, payload);
      else await api.createProduct(payload);
      onSaved();
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  }
  return (
    <Modal title={insumo ? "Editar número de parte" : "Nuevo número de parte"} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Número de parte">
          <input value={f.sku} onChange={(e) => set("sku", e.target.value)} className={cx(inputCls, "font-mono")} placeholder="7782-A" autoFocus />
        </Field>
        <Field label="Tipo">
          <select value={f.kind} onChange={(e) => set("kind", e.target.value)} className={inputCls}>
            <option value="material">Insumo</option>
            <option value="subassembly">Subproducto</option>
            <option value="finished">Producto</option>
          </select>
        </Field>
        <Field label="Estatus">
          <select value={f.is_active ? "1" : "0"} onChange={(e) => set("is_active", e.target.value === "1")} className={inputCls}>
            <option value="1">Activo</option>
            <option value="0">Inactivo</option>
          </select>
        </Field>
        <Field label="Fracción HS (6 dígitos)">
          <HsInput value={f.hs_code} onChange={(v) => set("hs_code", v)} />
        </Field>
        <div className="col-span-2">
          <Field label="Descripción">
            <input value={f.description} onChange={(e) => set("description", e.target.value)} className={inputCls} placeholder="Nombre del insumo" />
          </Field>
        </div>
        <div className="col-span-2">
          <Field label="Proveedor">
            <select value={f.supplier} onChange={(e) => set("supplier", e.target.value === "" ? "" : Number(e.target.value))} className={inputCls}>
              <option value="">— Selecciona un proveedor —</option>
              {suppliers.map((sp) => <option key={sp.id} value={sp.id}>{sp.name}{sp.code ? ` (${sp.code})` : ""}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Precio unitario">
          <input type="number" step="0.0001" value={f.unit_cost} onChange={(e) => set("unit_cost", e.target.value)} className={inputCls} />
        </Field>
        <Field label="Moneda">
          <input value={f.currency} onChange={(e) => set("currency", e.target.value.toUpperCase())} className={cx(inputCls, "uppercase")} maxLength={3} />
        </Field>
      </div>
      <p className="mt-2 text-xs text-zinc-400">El <strong>país de origen</strong> lo define el proveedor desde su acceso.</p>
      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
        <Btn onClick={save} disabled={saving}>{saving ? "Guardando…" : insumo ? "Guardar cambios" : "Crear número de parte"}</Btn>
      </div>
    </Modal>
  );
}
function CalificacionesView() {
  const { data, count } = useList<Qualification & { product: number }>(() => api.qualifications());
  const products = useList<Product>(() => api.products());
  const name = (pid: number) => products.data.find((p) => p.id === pid)?.sku ?? `#${pid}`;
  return (
    <div>
      <PageTitle title="Calificaciones" desc={`${count} calificaciones registradas.`} />
      <Table head={["Producto", "Criterio", "VCR", "Resultado"]}>
        {data.map((q) => (
          <tr key={q.id}>
            <td className="px-4 py-3 font-mono text-xs">{name(q.product)}</td>
            <td className="px-4 py-3">{q.criterion || "—"}</td>
            <td className="px-4 py-3">{q.rvc_value ? `${q.rvc_value}%` : "—"}</td>
            <td className="px-4 py-3"><Pill k={q.status}>{q.status_display}</Pill></td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
function CertificadosView() {
  const { data, count } = useList<{ id: number; folio: string; certifier_type: string; issued_at: string }>(() => api.certificates());
  return (
    <div>
      <PageTitle title="Certificados de origen" desc={`${count} certificados emitidos.`} />
      <Table head={["Folio", "Certificador", "Emitido"]}>
        {data.map((c) => (
          <tr key={c.id}>
            <td className="px-4 py-3 font-mono text-xs">{c.folio}</td>
            <td className="px-4 py-3">{c.certifier_type}</td>
            <td className="px-4 py-3">{c.issued_at?.slice(0, 10)}</td>
          </tr>
        ))}
        {count === 0 && <tr><td colSpan={3} className="px-4 py-8 text-center text-zinc-400">Aún no emites certificados.</td></tr>}
      </Table>
    </div>
  );
}
function ProveedoresView({ me }: { me: Me }) {
  const { data, reload, loading } = useList<Party>(() => api.parties());
  const [editing, setEditing] = useState<Party | "new" | null>(null);
  const [access, setAccess] = useState<Party | null>(null);
  const [msg, setMsg] = useState("");
  async function del(p: Party) {
    if (!confirm(`¿Eliminar el proveedor “${p.name}”?`)) return;
    setMsg(""); try { await api.deleteParty(p.id); await reload(); }
    catch (e) { setMsg((e as Error).message); }
  }
  return (
    <div>
      <PageTitle title="Proveedores" desc="Tu padrón de proveedores. Asígnales un código y crea su acceso." />
      <div className="mb-4 flex">
        <div className="ml-auto"><Btn onClick={() => setEditing("new")}><Plus size={15} className="-mt-0.5 mr-1 inline" />Nuevo proveedor</Btn></div>
      </div>
      {msg && <p className="mb-3 text-sm text-amber-600">{msg}</p>}
      <Table head={["Código", "Proveedor", "País", "RFC / Tax ID", "Acceso", ""]}>
        {data.map((p) => (
          <tr key={p.id}>
            <td className="px-4 py-3"><code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-semibold text-zinc-700">{p.code || "—"}</code></td>
            <td className="px-4 py-3">
              <div className="font-medium">{p.name}</div>
              <div className="text-[11px] text-zinc-400">{p.slug}</div>
            </td>
            <td className="px-4 py-3">{p.country || "—"}</td>
            <td className="px-4 py-3 font-mono text-xs">{p.tax_id || "—"}</td>
            <td className="px-4 py-3">
              {p.access_users.length > 0
                ? <button onClick={() => setAccess(p)} className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline">
                    <KeyRound size={13} />{p.access_users.length} usuario{p.access_users.length > 1 ? "s" : ""}
                  </button>
                : <Btn size="sm" variant="ghost" onClick={() => setAccess(p)}><KeyRound size={13} className="-mt-0.5 mr-1 inline" />Crear acceso</Btn>}
            </td>
            <td className="px-4 py-3 text-right whitespace-nowrap">
              <button onClick={() => setEditing(p)} title="Editar"
                className="mr-1 rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-blue-600"><Pencil size={15} /></button>
              <button onClick={() => del(p)} title="Eliminar"
                className="rounded-lg p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={15} /></button>
            </td>
          </tr>
        ))}
        {!loading && data.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-zinc-400">Aún no tienes proveedores. Crea el primero con “Nuevo proveedor”.</td></tr>}
      </Table>
      {editing && (
        <ProveedorForm party={editing === "new" ? null : editing}
          onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await reload(); }} />
      )}
      {access && (
        <UsersModal party={access} tenantSlug={me.tenant?.slug ?? ""}
          onClose={() => setAccess(null)} onChanged={reload} />
      )}
    </div>
  );
}
function ProveedorForm({ party, onClose, onSaved }: {
  party: Party | null; onClose: () => void; onSaved: () => void;
}) {
  const [f, setF] = useState({
    name: party?.name ?? "", code: party?.code ?? "", country: party?.country ?? "",
    tax_id: party?.tax_id ?? "", email: party?.email ?? "", phone: party?.phone ?? "",
  });
  const [err, setErr] = useState(""); const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v });
  async function save() {
    if (!f.name.trim()) { setErr("El nombre del proveedor es obligatorio."); return; }
    setErr(""); setSaving(true);
    const payload = {
      name: f.name.trim(), code: f.code.trim(), country: f.country.trim().toUpperCase(),
      tax_id: f.tax_id.trim(), email: f.email.trim(), phone: f.phone.trim(),
    };
    try {
      if (party) await api.updateParty(party.id, payload);
      else await api.createParty(payload);
      onSaved();
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  }
  return (
    <Modal title={party ? "Editar proveedor" : "Nuevo proveedor"} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Field label="Nombre / Razón social">
            <input value={f.name} onChange={(e) => set("name", e.target.value)} className={inputCls} placeholder="Stellantis" autoFocus />
          </Field>
        </div>
        <Field label="Código de proveedor">
          <input value={f.code} onChange={(e) => set("code", e.target.value)} className={cx(inputCls, "uppercase")} placeholder="ST01" />
        </Field>
        <Field label="País (ISO-2)">
          <input value={f.country} onChange={(e) => set("country", e.target.value)} className={cx(inputCls, "uppercase")} placeholder="MX" maxLength={2} />
        </Field>
        <Field label="RFC / Tax ID">
          <input value={f.tax_id} onChange={(e) => set("tax_id", e.target.value)} className={inputCls} />
        </Field>
        <Field label="Teléfono">
          <input value={f.phone} onChange={(e) => set("phone", e.target.value)} className={inputCls} />
        </Field>
        <div className="col-span-2">
          <Field label="Email">
            <input value={f.email} onChange={(e) => set("email", e.target.value)} className={inputCls} placeholder="contacto@proveedor.com" />
          </Field>
        </div>
      </div>
      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
        <Btn onClick={save} disabled={saving}>{saving ? "Guardando…" : party ? "Guardar cambios" : "Crear proveedor"}</Btn>
      </div>
    </Modal>
  );
}
function UsersModal({ party, tenantSlug, onClose, onChanged }: {
  party: Party; tenantSlug: string; onClose: () => void; onChanged: () => void;
}) {
  const [users, setUsers] = useState<SupplierUser[]>(party.access_users);
  const [username, setUsername] = useState("");
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  // Última contraseña temporal generada (para mostrarla/copiarla una sola vez).
  const [temp, setTemp] = useState<{ username: string; password: string } | null>(null);
  async function refresh() { setUsers(await api.supplierUsers(party.id)); onChanged(); }
  async function add() {
    if (!username.trim()) { setErr("Escribe un nombre de usuario."); return; }
    setErr(""); setBusy(true);
    try {
      const r = await api.addSupplierUser(party.id, username.trim());
      setTemp({ username: r.username, password: r.temp_password });
      setUsername(""); await refresh();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function reset(u: SupplierUser) {
    setErr(""); setBusy(true);
    try {
      const r = await api.resetSupplierPassword(party.id, u.id);
      setTemp({ username: u.username, password: r.temp_password });
      await refresh();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function remove(u: SupplierUser) {
    if (!confirm(`¿Quitar el usuario “${u.username}”? Ya no podrá entrar.`)) return;
    setErr(""); setBusy(true);
    try { await api.removeSupplierUser(party.id, u.id); if (temp?.username === u.username) setTemp(null); await refresh(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function unlock(u: SupplierUser) {
    setErr(""); setBusy(true);
    try { await api.unlockSupplierUser(party.id, u.id); await refresh(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Modal title={`Usuarios de acceso — ${party.name}`} onClose={onClose}>
      <p className="mb-4 text-sm text-zinc-500">
        Para entrar, el proveedor elige la pestaña <strong>Proveedor</strong> y escribe:
        Empresa (cliente) = <code className="rounded bg-zinc-100 px-1">{tenantSlug}</code>,
        Proveedor = <code className="rounded bg-zinc-100 px-1">{party.slug}</code>, su usuario y contraseña.
        Con una contraseña temporal, deberá cambiarla en su primer ingreso.
      </p>

      {temp && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
          <div className="font-semibold text-emerald-800">Contraseña temporal de “{temp.username}”</div>
          <div className="mt-1 flex items-center gap-2">
            <code className="rounded bg-white px-2 py-1 font-mono text-emerald-900 ring-1 ring-emerald-200">{temp.password}</code>
            <button onClick={() => navigator.clipboard?.writeText(temp.password)}
              className="text-xs text-emerald-700 hover:underline">Copiar</button>
          </div>
          <div className="mt-1 text-xs text-emerald-700">Cópiala y compártela con el proveedor. No se volverá a mostrar.</div>
        </div>
      )}

      <div className="mb-4 overflow-hidden rounded-lg border border-zinc-200">
        {users.length === 0 && <div className="px-3 py-4 text-center text-sm text-zinc-400">Aún no hay usuarios.</div>}
        {users.map((u) => (
          <div key={u.id} className="flex items-center justify-between border-b border-zinc-100 px-3 py-2 last:border-0">
            <div className="flex items-center gap-2">
              <KeyRound size={14} className={u.is_locked ? "text-red-500" : "text-zinc-400"} />
              <span className="text-sm font-medium">{u.username}</span>
              {u.is_locked && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700">bloqueado</span>}
              {u.must_change_password && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">contraseña temporal</span>}
            </div>
            <div className="flex items-center gap-1">
              {u.is_locked && <Btn size="sm" onClick={() => unlock(u)} disabled={busy}>Desbloquear</Btn>}
              <Btn size="sm" variant="ghost" onClick={() => reset(u)} disabled={busy}>Restablecer contraseña</Btn>
              <button onClick={() => remove(u)} disabled={busy} title="Quitar"
                className="rounded-lg p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={15} /></button>
            </div>
          </div>
        ))}
      </div>

      <Field label="Agregar usuario">
        <div className="flex gap-2">
          <input value={username} onChange={(e) => setUsername(e.target.value)} className={inputCls}
            placeholder="usuario del proveedor" onKeyDown={(e) => e.key === "Enter" && add()} />
          <Btn onClick={add} disabled={busy}><Plus size={15} className="-mt-0.5 mr-1 inline" />Agregar</Btn>
        </div>
      </Field>
      <p className="mt-1 text-xs text-zinc-400">Se generará una contraseña temporal automáticamente.</p>

      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
      <div className="mt-5 flex justify-end">
        <Btn variant="ghost" onClick={onClose}>Cerrar</Btn>
      </div>
    </Modal>
  );
}
function periodoTexto(s: Solicitation) {
  if (s.period_from && s.period_to)
    return `${s.period_display ?? ""} ${s.period_from} → ${s.period_to}`.trim();
  return "—";
}
// Alerta por fecha límite: vencida / por vencer (si aún no se respondió).
function dueAlert(s: Solicitation): { label: string; cls: string } | null {
  if (s.status === "responded" || !s.due_date) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(s.due_date + "T00:00:00");
  const days = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (days < 0) return { label: `Vencida · fuera de periodo (límite ${s.due_date})`, cls: "bg-red-100 text-red-700" };
  if (days <= 3) return { label: `Por vencer · límite ${s.due_date} (${days} día${days === 1 ? "" : "s"})`, cls: "bg-amber-100 text-amber-700" };
  return null;
}
function SolicitudesEmpresaView() {
  const { data, count, reload, loading } = useList<Solicitation>(() => api.solicitations());
  const [open, setOpen] = useState(false);
  const [verBom, setVerBom] = useState<Solicitation | null>(null);
  const [msg, setMsg] = useState("");
  return (
    <div>
      <PageTitle title="Solicitudes a proveedores" desc="Pide a tus proveedores la declaración de origen, por periodo." />
      <div className="mb-4 flex">
        <div className="ml-auto"><Btn onClick={() => setOpen(true)}><Plus size={15} className="-mt-0.5 mr-1 inline" />Nueva solicitud</Btn></div>
      </div>
      {msg && <p className="mb-3 text-sm text-emerald-700">{msg}</p>}
      <Table head={["Núm. de parte", "Proveedor", "Tratado", "Periodo", "Tipo", "Límite", "Estado", ""]}>
        {data.map((s) => {
          const alert = dueAlert(s);
          return (
          <tr key={s.id}>
            <td className="px-4 py-3 font-mono text-xs">{s.product_sku ?? `#${s.product}`}</td>
            <td className="px-4 py-3">{s.supplier_name ?? "—"}</td>
            <td className="px-4 py-3">{treatyLabel(s.treaty_code)}</td>
            <td className="px-4 py-3 text-xs text-zinc-600">{periodoTexto(s)}</td>
            <td className="px-4 py-3 text-xs">{s.bom_analysis ? "BOM" : "Declaración"}</td>
            <td className="px-4 py-3 text-xs">
              {s.due_date ?? "—"}
              {alert && <span className={cx("mt-1 block rounded-full px-2 py-0.5 text-[11px] font-medium", alert.cls)}>{alert.label}</span>}
            </td>
            <td className="px-4 py-3"><Pill k={s.status}>{s.status_display}</Pill></td>
            <td className="px-4 py-3 text-right">
              {s.submitted_bom && <Btn size="sm" variant="ghost" onClick={() => setVerBom(s)}>Ver BOM</Btn>}
            </td>
          </tr>
          );
        })}
        {!loading && count === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-zinc-400">Sin solicitudes todavía. Crea una con “Nueva solicitud”.</td></tr>}
      </Table>
      {verBom && <BomViewModal s={verBom} onClose={() => setVerBom(null)} />}
      {open && <SolicitudForm onClose={() => setOpen(false)}
        onSaved={async (r) => {
          setOpen(false);
          setMsg(`${r.creadas} solicitud(es) creada(s)` +
            (r.sin_proveedor?.length ? ` · ${r.sin_proveedor.length} sin proveedor (omitidas)` : ""));
          await reload();
        }} />}
    </div>
  );
}
function BomViewModal({ s, onClose }: { s: Solicitation; onClose: () => void }) {
  const b = s.submitted_bom;
  const total = (b?.lines ?? []).reduce((a, l) => a + Number(l.total ?? 0), 0);
  const members = (s.treaty_members ?? []).map((c) => c.toUpperCase());
  const noOrig = (b?.lines ?? []).reduce((a, l) =>
    a + (l.country && members.includes(l.country.toUpperCase()) ? 0 : Number(l.total ?? 0)), 0);
  const deMinimis = total > 0 ? (noOrig / total * 100) : 0;
  const sinEvidencia = (b?.lines ?? []).filter((l) => !l.has_origin_evidence).length;
  return (
    <Modal title={`BOM — ${s.product_sku}`} onClose={onClose}>
      <div className="mb-3 text-sm text-zinc-600">
        <div><strong>{s.product_sku}</strong> — {s.product_description}</div>
        <div className="text-xs text-zinc-500">HS {s.product_hs} · Tratado {treatyLabel(s.treaty_code)} · Proveedor {s.supplier_name}</div>
        {b?.rule_description && <div className="mt-1 text-xs">Regla (PSR): <strong>{b.rule_hs}</strong> — {b.rule_description}</div>}
      </div>
      <Table head={["Núm. de parte", "Descripción", "HS", "Precio", "Cant.", "Total", "País", "Evidencia"]}>
        {(b?.lines ?? []).map((l, i) => (
          <tr key={i} className={l.has_origin_evidence ? "" : "bg-amber-50/40"}>
            <td className="px-4 py-2 font-mono text-xs">{l.part_number}</td>
            <td className="px-4 py-2">{l.description}</td>
            <td className="px-4 py-2 font-mono text-xs">{formatHs(l.hs_code) || "—"}</td>
            <td className="px-4 py-2 font-mono text-xs">{l.unit_price}</td>
            <td className="px-4 py-2 font-mono text-xs">{l.quantity}</td>
            <td className="px-4 py-2 font-mono text-xs">{l.total}</td>
            <td className="px-4 py-2">{l.country}</td>
            <td className="px-4 py-2">
              {l.has_origin_evidence
                ? <span className="text-xs font-medium text-green-700">Sí</span>
                : <span className="text-xs font-medium text-amber-700">Sin evidencia</span>}
            </td>
          </tr>
        ))}
      </Table>
      {sinEvidencia > 0 && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          ⚠️ {sinEvidencia} componente(s) <strong>sin documento de respaldo de origen</strong> — mayor riesgo en auditoría.
        </p>
      )}
      {b && <OriginReport bom={b} />}
      <div className="mt-3 flex items-center justify-between text-sm">
        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">De Minimis (no originario): <strong>{deMinimis.toFixed(2)}%</strong>{s.treaty_de_minimis ? ` · límite ${s.treaty_de_minimis}%` : ""}</span>
        <span className="font-semibold">Total BOM: {total.toFixed(2)}</span>
      </div>
    </Modal>
  );
}
const PERIOD_OPTIONS = [
  { value: "month", label: "Mensual (mes actual)" },
  { value: "semester", label: "Semestral" },
  { value: "year", label: "Anual" },
  { value: "custom", label: "Personalizado" },
];
function periodDates(type: string): { from: string; to: string } {
  const now = new Date(); const y = now.getFullYear(); const m = now.getMonth();
  const pad = (n: number) => String(n).padStart(2, "0");
  if (type === "month") {
    const last = new Date(y, m + 1, 0).getDate();
    return { from: `${y}-${pad(m + 1)}-01`, to: `${y}-${pad(m + 1)}-${pad(last)}` };
  }
  if (type === "semester")
    return m < 6 ? { from: `${y}-01-01`, to: `${y}-06-30` } : { from: `${y}-07-01`, to: `${y}-12-31` };
  if (type === "year") return { from: `${y}-01-01`, to: `${y}-12-31` };
  return { from: "", to: "" };
}
function SolicitudForm({ onClose, onSaved }: {
  onClose: () => void; onSaved: (r: { creadas: number; sin_proveedor: string[] }) => void;
}) {
  const products = useList<Product>(() => api.products());
  const parties = useList<Party>(() => api.parties());
  const treaties = useList<Treaty>(() => api.treaties());
  const [treatyId, setTreatyId] = useState<number | "">("");
  const [periodType, setPeriodType] = useState("year");
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [mode, setMode] = useState<"proveedor" | "productos">("proveedor");
  const [supplierId, setSupplierId] = useState<number | "">("");
  const [picked, setPicked] = useState<number[]>([]);
  const [bomAnalysis, setBomAnalysis] = useState(false);
  const [err, setErr] = useState(""); const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (treatyId === "" && treaties.data.length) {
      const tmec = treaties.data.find((t) => t.code === "TMEC");
      setTreatyId(tmec ? tmec.id : treaties.data[0].id);
    }
  }, [treaties.data, treatyId]);
  useEffect(() => {
    if (periodType !== "custom") { const d = periodDates(periodType); setFrom(d.from); setTo(d.to); }
  }, [periodType]);

  const suppliers = parties.data.filter((p) => p.kind === "supplier");
  const conProveedor = products.data.filter((p) => p.supplier);
  const selectedIds = mode === "proveedor"
    ? conProveedor.filter((p) => p.supplier === supplierId).map((p) => p.id)
    : picked;
  const toggle = (id: number) => setPicked((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);

  async function save() {
    if (!treatyId) { setErr("Elige el tratado."); return; }
    if (!from || !to) { setErr("Indica el periodo (desde y hasta)."); return; }
    if (selectedIds.length === 0) { setErr("Selecciona proveedor o productos."); return; }
    setErr(""); setSaving(true);
    try {
      const r = await api.createSolicitudes({
        treaty: Number(treatyId), period_type: periodType,
        period_from: from, period_to: to, products: selectedIds,
        due_date: dueDate || null, bom_analysis: bomAnalysis,
      });
      onSaved(r);
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  }
  return (
    <Modal title="Nueva solicitud de origen" onClose={onClose}>
      <div className="grid gap-3">
        <Field label="Tratado (TLC) para el que pides el origen">
          <select value={treatyId} onChange={(e) => setTreatyId(Number(e.target.value))} className={inputCls}>
            {treaties.data.map((t) => <option key={t.id} value={t.id}>{treatyLabel(t.code)} — {t.name}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Periodo">
            <select value={periodType} onChange={(e) => setPeriodType(e.target.value)} className={inputCls}>
              {PERIOD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Desde">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Hasta">
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
          </Field>
        </div>

        <Field label="Fecha límite para responder (carga del proveedor)">
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputCls} />
        </Field>

        <div>
          <span className="mb-1 block text-xs font-semibold text-zinc-700">¿Qué incluir?</span>
          <div className="mb-2 grid grid-cols-2 gap-1 rounded-lg bg-zinc-100 p-1">
            {(["proveedor", "productos"] as const).map((mm) => (
              <button key={mm} type="button" onClick={() => setMode(mm)}
                className={cx("rounded-md py-1.5 text-sm font-medium", mode === mm ? "bg-white text-blue-700 shadow-sm" : "text-zinc-500")}>
                {mm === "proveedor" ? "Por proveedor (todo)" : "Productos individuales"}
              </button>
            ))}
          </div>
          {mode === "proveedor" ? (
            <div>
              <select value={supplierId} onChange={(e) => setSupplierId(Number(e.target.value))} className={inputCls}>
                <option value="">— Selecciona un proveedor —</option>
                {suppliers.map((sp) => <option key={sp.id} value={sp.id}>{sp.name}{sp.code ? ` (${sp.code})` : ""}</option>)}
              </select>
              {supplierId !== "" && (
                <p className="mt-1 text-xs text-zinc-500">Se incluirán <strong>{selectedIds.length}</strong> número(s) de parte de este proveedor.</p>
              )}
            </div>
          ) : (
            <div className="max-h-48 overflow-y-auto rounded-lg border border-zinc-200">
              {conProveedor.length === 0 && <div className="px-3 py-4 text-center text-sm text-zinc-400">No hay productos con proveedor asignado.</div>}
              {conProveedor.map((p) => (
                <label key={p.id} className="flex items-center gap-2 border-b border-zinc-100 px-3 py-2 text-sm last:border-0">
                  <input type="checkbox" checked={picked.includes(p.id)} onChange={() => toggle(p.id)} />
                  <span className="font-mono text-xs">{p.sku}</span>
                  <span className="flex-1 truncate text-zinc-600">{p.description}</span>
                  <span className="text-xs text-zinc-400">{p.supplier_name}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
          <input type="checkbox" checked={bomAnalysis} onChange={(e) => setBomAnalysis(e.target.checked)} className="mt-0.5" />
          <span className="text-sm">
            <span className="font-semibold text-zinc-800">Análisis automático por BOM</span>
            <span className="block text-xs text-zinc-500">Si lo activas, el proveedor deberá subir la lista de materiales (BOM) en vez de solo declarar el origen.</span>
          </span>
        </label>
      </div>
      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
        <Btn onClick={save} disabled={saving}>{saving ? "Creando…" : `Crear solicitud${selectedIds.length > 1 ? "es" : ""}`}</Btn>
      </div>
    </Modal>
  );
}

/* ============ PROVEEDOR ============ */
function ProveedorProductosView() {
  const { data, count, loading, reload } = useList<Product>(() => api.products());
  const [suggest, setSuggest] = useState<Product | null>(null);
  const [country, setCountry] = useState<Product | null>(null);
  return (
    <div>
      <PageTitle title="Productos" desc="Lo que tus clientes te compran. Tú defines el país de origen; si una fracción es incorrecta, puedes sugerir la correcta." />
      <Table head={["Núm. de parte", "Descripción", "Tipo", "HS", "País", "Estatus", ""]}>
        {data.map((p) => (
          <tr key={p.id} className={p.is_active ? "" : "opacity-60"}>
            <td className="px-4 py-3 font-mono text-xs font-semibold">{p.sku}</td>
            <td className="px-4 py-3">{p.description}</td>
            <td className="px-4 py-3"><KindBadge kind={p.kind} /></td>
            <td className="px-4 py-3">
              <span className="font-mono text-xs">{formatHs(p.hs_code) || "—"}</span>
              {p.hs_suggestion_status === "pending" && (
                <div className="mt-0.5 text-[11px] text-amber-700">Sugeriste <strong className="font-mono">{formatHs(p.hs_suggested ?? "")}</strong> · pendiente</div>
              )}
            </td>
            <td className="px-4 py-3">
              {p.country_of_origin
                ? <span>{p.country_of_origin} <button onClick={() => setCountry(p)} className="ml-1 text-[11px] text-blue-600 hover:underline">editar</button></span>
                : <Btn size="sm" variant="ghost" onClick={() => setCountry(p)}>Poner país</Btn>}
            </td>
            <td className="px-4 py-3">
              <span className={cx("rounded-full px-2 py-0.5 text-xs font-medium",
                p.is_active ? "bg-green-100 text-green-700" : "bg-zinc-200 text-zinc-600")}>
                {p.is_active ? "Activo" : "Inactivo"}
              </span>
            </td>
            <td className="px-4 py-3 text-right">
              {p.hs_suggestion_status !== "pending" &&
                <Btn size="sm" variant="ghost" onClick={() => setSuggest(p)}>Sugerir fracción</Btn>}
            </td>
          </tr>
        ))}
        {!loading && count === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-zinc-400">Todavía no hay productos asignados a ti por tus clientes.</td></tr>}
      </Table>
      {suggest && <SuggestHsModal product={suggest}
        onClose={() => setSuggest(null)} onSaved={async () => { setSuggest(null); await reload(); }} />}
      {country && <CountryModal product={country}
        onClose={() => setCountry(null)} onSaved={async () => { setCountry(null); await reload(); }} />}
    </div>
  );
}
function MisSolicitudesView({ me }: { me: Me }) {
  const { data, reload, count } = useList<Solicitation>(() => api.solicitations());
  const products = useList<Product>(() => api.products());
  const treaties = useList<Treaty>(() => api.treaties());
  const prod = (id: number) => products.data.find((p) => p.id === id);
  const tcode = (id: number) => treaties.data.find((t) => t.id === id)?.code ?? `#${id}`;
  const cliente = me.tenant?.name;
  return (
    <div>
      <PageTitle title={`Solicitudes de cliente${cliente ? ` (${cliente})` : ""}`}
        desc="Completa la información de origen que te piden tus clientes." />
      {count === 0 && <Card className="p-8 text-center text-zinc-400">No tienes solicitudes pendientes.</Card>}
      <div className="space-y-4">
        {data.map((s) => s.bom_analysis
          ? <BomCard key={s.id} s={s} onDone={reload} />
          : <SolCard key={s.id} s={s} product={prod(s.product)} tcode={tcode(s.treaty)} onDone={reload} />)}
      </div>
    </div>
  );
}
function SolCard({ s, product, tcode, onDone }: {
  s: Solicitation; product?: Product; tcode: string; onDone: () => void;
}) {
  const [orig, setOrig] = useState(true);
  const [country, setCountry] = useState(product?.country_of_origin ?? "");
  const [from, setFrom] = useState(s.period_from ?? "");
  const [to, setTo] = useState(s.period_to ?? "");
  const [saving, setSaving] = useState(false); const [err, setErr] = useState("");
  const done = s.status === "responded";
  async function submit() {
    if (!isValidCountry(country)) { setErr("País no válido. Usa un código ISO-2 del catálogo."); return; }
    setErr(""); setSaving(true);
    try { await api.respond(s.id, { is_originating: orig, country_of_origin: country, valid_from: from, valid_to: to }); onDone(); }
    catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  }
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="font-medium text-zinc-900">{product ? `${product.sku} — ${product.description}` : (s.product_sku ?? `Material #${s.product}`)}</div>
          <div className="text-xs text-zinc-500">HS {product?.hs_code ?? s.product_hs} · Tratado {tcode}</div>
        </div>
        <Pill k={s.status}>{s.status_display}</Pill>
      </div>
      {(s.period_from && s.period_to) && (
        <div className="mb-3 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800">
          Periodo solicitado: <strong>{s.period_display}</strong> · {s.period_from} → {s.period_to}
        </div>
      )}
      {done ? <p className="text-sm text-zinc-500">Ya enviaste tu declaración. ¡Gracias!</p> : (
        <div className="grid grid-cols-2 gap-3 text-sm">
          <label className="col-span-2 flex items-center gap-2">
            <input type="checkbox" checked={orig} onChange={(e) => setOrig(e.target.checked)} />
            ¿El material es originario para este tratado?
          </label>
          <div><label className="block text-xs text-zinc-500">País (ISO-2)</label>
            <span className="mt-1 block"><CountryInput value={country} onChange={setCountry} className="w-full rounded-lg border border-zinc-300 px-2 py-1.5" /></span></div>
          <div />
          <div><label className="block text-xs text-zinc-500">Vigente desde</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-1.5" /></div>
          <div><label className="block text-xs text-zinc-500">Vigente hasta</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-1.5" /></div>
          {err && <p className="col-span-2 text-sm text-red-600">{err}</p>}
          <div className="col-span-2"><Btn onClick={submit} disabled={saving}>{saving ? "Enviando…" : "Enviar declaración"}</Btn></div>
        </div>
      )}
    </Card>
  );
}
function emptyBomLine(): BomLine {
  return { part_number: "", description: "", hs_code: "", unit_price: "", quantity: "", country: "", has_origin_evidence: false };
}
/* Reporte del análisis de origen (CTC / VCR) a partir del detalle calculado. */
function OriginReport({ bom }: { bom: SubmittedBom }) {
  if (!bom.origin_status) return null;
  const d = (bom.detail ?? {}) as {
    rule?: string; rule_type?: string; error?: string;
    tariff_shift?: { shift_level: string; violating_value: string; violating_pct: string; de_minimis: string; components: { sku: string; shifted: boolean }[] };
    rvc?: { method: string; threshold: string; rvc: string; vnm: string; transaction_value: string };
  };
  const ok = bom.origin_status === "QUALIFIES";
  const insf = bom.origin_status === "INSUFFICIENT";
  return (
    <div className="mt-3 rounded-lg border border-zinc-200 p-3">
      <div className="flex items-center gap-2">
        <span className={cx("rounded-full px-2.5 py-0.5 text-sm font-semibold",
          ok ? "bg-green-100 text-green-700" : insf ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700")}>
          {ok ? "Originario: SÍ" : insf ? "Datos insuficientes" : "Originario: NO"}
        </span>
        {bom.criterion && <span className="text-xs text-zinc-500">Criterio: <strong>{bom.criterion}</strong></span>}
        {bom.rvc_value != null && <span className="text-xs text-zinc-500">VCR: <strong>{bom.rvc_value}%</strong></span>}
      </div>
      {d.error && <p className="mt-2 text-sm text-amber-700">{d.error}</p>}
      {d.rule && <p className="mt-2 text-xs text-zinc-500">Regla aplicada: <strong>{d.rule}</strong></p>}
      {d.tariff_shift && (
        <div className="mt-2 text-xs">
          <div className="font-semibold text-zinc-700">Salto arancelario ({d.tariff_shift.shift_level})</div>
          <div className="text-zinc-500">Valor que no salta: {d.tariff_shift.violating_value} ({d.tariff_shift.violating_pct}%) · de minimis permitido {d.tariff_shift.de_minimis}%</div>
          <ul className="mt-1 space-y-0.5">
            {d.tariff_shift.components.map((c, i) => (
              <li key={i} className={c.shifted ? "text-green-700" : "text-red-700"}>
                {c.shifted ? "✓" : "✗"} {c.sku} — {c.shifted ? "cambia de clasificación" : "NO cambia (mismo capítulo/partida)"}
              </li>
            ))}
          </ul>
        </div>
      )}
      {d.rvc && (
        <div className="mt-2 text-xs">
          <div className="font-semibold text-zinc-700">Valor de Contenido Regional (VCR)</div>
          <div className="text-zinc-500">VCR {d.rvc.rvc}% vs umbral {d.rvc.threshold}% · método {d.rvc.method} · valor no originario {d.rvc.vnm} de {d.rvc.transaction_value}</div>
        </div>
      )}
    </div>
  );
}
// Huella de los datos del BOM (para detectar si no cambió desde el periodo anterior).
function bomSnapshot(lines: BomLine[], rule: number | ""): string {
  return JSON.stringify({
    rule: rule === "" ? null : rule,
    lines: lines.filter((l) => l.part_number.trim()).map((l) => ({
      pn: l.part_number.trim(), d: l.description.trim(), hs: l.hs_code,
      up: String(l.unit_price || "0"), q: String(l.quantity || "0"),
      c: l.country, e: l.has_origin_evidence,
    })),
  });
}
function BomCard({ s, onDone }: { s: Solicitation; onDone: () => void }) {
  const done = s.status === "responded";
  const [rules, setRules] = useState<OriginRule[]>([]);
  const [ruleId, setRuleId] = useState<number | "">(s.submitted_bom?.rule ?? "");
  const [lines, setLines] = useState<BomLine[]>(
    s.submitted_bom?.lines?.length ? s.submitted_bom.lines : [emptyBomLine()]);
  const [saving, setSaving] = useState(false); const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [showLog, setShowLog] = useState(false);
  // Huella de lo traído de un periodo anterior (para avisar si no cambió).
  const [broughtSnap, setBroughtSnap] = useState<string | null>(null);
  useEffect(() => {
    api.rules(`?treaty=${s.treaty}&hs=${encodeURIComponent(s.product_hs ?? "")}`)
      .then((d: { results?: OriginRule[] } | OriginRule[]) =>
        setRules(Array.isArray(d) ? d : (d.results ?? []))).catch(() => {});
  }, [s.treaty, s.product_hs]);
  const setLine = (i: number, k: keyof BomLine, v: string | boolean) =>
    setLines((ls) => ls.map((l, idx) => idx === i ? { ...l, [k]: v } : l));
  const allEvidence = lines.length > 0 && lines.every((l) => l.has_origin_evidence);
  const setAllEvidence = (v: boolean) => setLines((ls) => ls.map((l) => ({ ...l, has_origin_evidence: v })));
  const addLine = () => setLines((ls) => [...ls, emptyBomLine()]);
  const delLine = (i: number) => setLines((ls) => ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls);
  const lt = (l: BomLine) => (Number(l.unit_price || 0) * Number(l.quantity || 0));
  const total = lines.reduce((a, l) => a + lt(l), 0);
  // De Minimis = % del valor que viene de componentes NO originarios
  // (país fuera de los miembros del tratado). Se calcula automático.
  const members = (s.treaty_members ?? []).map((c) => c.toUpperCase());
  const noOrig = lines.reduce((a, l) =>
    a + (l.country && members.includes(l.country.toUpperCase()) ? 0 : lt(l)), 0);
  const deMinimis = total > 0 ? (noOrig / total * 100) : 0;
  async function submit() {
    const valid = lines.filter((l) => l.part_number.trim());
    if (valid.length === 0) { setErr("Agrega al menos un componente con número de parte."); return; }
    if (valid.some((l) => !isValidCountry(l.country))) { setErr("Hay un país no válido en el detalle (usa un código ISO-2 del catálogo)."); return; }
    setErr(""); setSaving(true);
    try {
      await api.submitBom(s.id, {
        rule: ruleId === "" ? null : Number(ruleId),
        lines: valid.map((l) => ({
          part_number: l.part_number, description: l.description, hs_code: l.hs_code,
          unit_price: l.unit_price || "0", quantity: l.quantity || "0", country: l.country,
          has_origin_evidence: l.has_origin_evidence,
        })),
      });
      onDone();
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  }
  async function calcular() {
    const valid = lines.filter((l) => l.part_number.trim());
    if (valid.length === 0) { setErr("Agrega al menos un componente con número de parte."); return; }
    if (valid.some((l) => !isValidCountry(l.country))) { setErr("Hay un país no válido en el detalle (usa un código ISO-2 del catálogo)."); return; }
    setErr(""); setSaving(true);
    try {
      // Guarda el BOM actual y luego calcula el origen.
      await api.submitBom(s.id, {
        rule: ruleId === "" ? null : Number(ruleId),
        lines: valid.map((l) => ({
          part_number: l.part_number, description: l.description, hs_code: l.hs_code,
          unit_price: l.unit_price || "0", quantity: l.quantity || "0", country: l.country,
          has_origin_evidence: l.has_origin_evidence,
        })),
      });
      await api.calculateOrigin(s.id);
      onDone();
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  }
  async function enviar() {
    setErr("");
    // ¿Es idéntico a lo traído de un periodo anterior? -> advertir.
    const unchanged = broughtSnap !== null && bomSnapshot(lines, ruleId) === broughtSnap;
    if (unchanged && !confirm(
      "La información no ha cambiado desde el último periodo. Verifica si los precios y " +
      "orígenes de tu BOM no han cambiado. ¿Deseas continuar y enviar igual?")) return;
    setSaving(true);
    try { await api.sendBom(s.id, unchanged); onDone(); }
    catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  }
  async function traerPrevia() {
    setErr(""); setMsg(""); setSaving(true);
    try {
      const r = await api.copyPrevious(s.id);
      if (!r.found) { setMsg("No hay información de un periodo anterior para este producto."); return; }
      const newLines: BomLine[] = r.lines;
      setLines(newLines);
      setRuleId(r.rule ?? "");
      setBroughtSnap(bomSnapshot(newLines, r.rule ?? ""));
      setMsg(`Información traída del periodo anterior (${r.source_period}). Revisa y guarda.`);
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  }
  const cell = "rounded-lg border border-zinc-300 px-2 py-1.5 text-sm w-full";
  // Estados del flujo: BOM cargado -> calculado -> enviado.
  const bomLoaded = !!s.submitted_bom;
  const calculated = !!s.submitted_bom?.origin_status;
  const sent = done;
  const alert = dueAlert(s);
  return (
    <Card className="p-5">
      {/* Encabezado: tratado y periodo EN GRANDE */}
      <div className="mb-2 flex items-start justify-between">
        <div>
          <div className="font-semibold text-zinc-900">{s.product_sku} — {s.product_description}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-blue-600 px-2.5 py-1 text-sm font-bold text-white">{treatyLabel(s.treaty_code)}</span>
            {(s.period_from && s.period_to) && (
              <span className="rounded-md bg-zinc-800 px-2.5 py-1 text-sm font-semibold text-white">
                {s.period_display}: {s.period_from} → {s.period_to}
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-zinc-500">HS {formatHs(s.product_hs ?? "") || "—"} · Precio {s.product_unit_cost}</div>
        </div>
        <Pill k={s.status}>{s.status_display}</Pill>
      </div>

      {/* Fecha límite + alerta de vencimiento */}
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        {s.due_date && <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-600">Fecha límite: <strong>{s.due_date}</strong></span>}
        {alert && <span className={cx("rounded-full px-2 py-0.5 font-medium", alert.cls)}>⏰ {alert.label}</span>}
      </div>

      {/* Estado del flujo (alertas) */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-700">De Minimis (no originario): <strong>{deMinimis.toFixed(2)}%</strong>{s.treaty_de_minimis ? ` · límite ${s.treaty_de_minimis}%` : ""}</span>
        {sent
          ? <span className="rounded-full bg-green-100 px-2 py-0.5 font-medium text-green-700">✓ Enviado al cliente</span>
          : calculated
            ? <span className="rounded-full bg-blue-100 px-2 py-0.5 font-medium text-blue-700">Origen calculado — falta ENVIAR al cliente</span>
            : bomLoaded
              ? <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800">⚠️ BOM cargado — falta CALCULAR ORIGEN</span>
              : <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-600">Captura el BOM y guárdalo</span>}
      </div>

      {/* Atajos: traer de periodo anterior + historial */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Btn size="sm" variant="ghost" onClick={traerPrevia} disabled={saving}>↩︎ Traer información de última solicitud</Btn>
        {(s.logs?.length ?? 0) > 0 && (
          <Btn size="sm" variant="ghost" onClick={() => setShowLog(true)}>Ver historial</Btn>
        )}
        {msg && <span className="text-xs text-emerald-700">{msg}</span>}
      </div>

      {/* Regla de origen (PSR) */}
      <div className="mb-3">
        <label className="mb-1 block text-xs font-semibold text-zinc-700">Regla de origen específica (PSR)</label>
        <select value={ruleId} onChange={(e) => setRuleId(e.target.value === "" ? "" : Number(e.target.value))} className={cell}>
          <option value="">— Selecciona la regla aplicable —</option>
          {rules.map((r) => <option key={r.id} value={r.id}>{r.hs_pattern} · {r.rule_type} — {r.description?.slice(0, 70)}</option>)}
        </select>
        {rules.length === 0 && <p className="mt-1 text-xs text-zinc-400">No hay PSR para esta fracción/tratado en el catálogo; puedes continuar sin seleccionarla.</p>}
      </div>

      {/* Detalle de componentes */}
      <div className="mb-2 text-xs font-semibold text-zinc-700">Detalle de componentes</div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-zinc-500">
            <tr>
              <th className="px-1 py-1 font-medium">Núm. de parte</th>
              <th className="px-1 py-1 font-medium">Descripción</th>
              <th className="px-1 py-1 font-medium">HS</th>
              <th className="px-1 py-1 font-medium">Precio unit.</th>
              <th className="px-1 py-1 font-medium">Cantidad</th>
              <th className="px-1 py-1 font-medium">Total</th>
              <th className="px-1 py-1 font-medium">País</th>
              <th className="px-1 py-1 font-medium">
                <div>¿Documento de origen?</div>
                <label className="flex items-center gap-1 font-normal text-zinc-400">
                  <input type="checkbox" checked={allEvidence} onChange={(e) => setAllEvidence(e.target.checked)} /> marcar todos
                </label>
              </th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className={l.has_origin_evidence ? "" : "bg-amber-50/40"}>
                <td className="px-1 py-1"><input value={l.part_number} onChange={(e) => setLine(i, "part_number", e.target.value)} className={cell} /></td>
                <td className="px-1 py-1"><input value={l.description} onChange={(e) => setLine(i, "description", e.target.value)} className={cell} /></td>
                <td className="px-1 py-1"><HsInput value={l.hs_code} onChange={(v) => setLine(i, "hs_code", v)} className={cx(cell, "w-24")} /></td>
                <td className="px-1 py-1"><input type="number" step="0.0001" value={l.unit_price} onChange={(e) => setLine(i, "unit_price", e.target.value)} className={cx(cell, "w-24")} /></td>
                <td className="px-1 py-1"><input type="number" step="0.0001" value={l.quantity} onChange={(e) => setLine(i, "quantity", e.target.value)} className={cx(cell, "w-20")} /></td>
                <td className="px-1 py-1 font-mono text-xs text-zinc-600">{lt(l).toFixed(2)}</td>
                <td className="px-1 py-1"><CountryInput value={l.country} onChange={(v) => setLine(i, "country", v)} className={cx(cell, "w-20")} /></td>
                <td className="px-1 py-1">
                  <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                    <input type="checkbox" checked={l.has_origin_evidence} onChange={(e) => setLine(i, "has_origin_evidence", e.target.checked)} />
                    <span className={l.has_origin_evidence ? "font-medium text-green-700" : "font-medium text-amber-700"}>
                      {l.has_origin_evidence ? "Sí, tengo documento" : "No tengo documento"}
                    </span>
                  </label>
                </td>
                <td className="px-1 py-1"><button onClick={() => delLine(i)} className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={14} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800">
        La casilla <strong>“¿Documento de origen?”</strong> indica si tienes un <strong>certificado o documento</strong> que respalde
        el origen de ese componente (factura, declaración, certificado, etc.). <strong>Todos</strong> los componentes pueden ser
        revisados en una <strong>auditoría</strong>; los que marques <strong>“No tengo documento”</strong> (resaltados) son los de mayor riesgo y deberás conseguir el respaldo.
      </p>
      <div className="mt-2 flex items-center justify-between">
        <Btn size="sm" variant="ghost" onClick={addLine}><Plus size={14} className="-mt-0.5 mr-1 inline" />Agregar componente</Btn>
        <div className="text-sm font-semibold text-zinc-700">Total BOM: {total.toFixed(2)}</div>
      </div>

      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Btn variant="ghost" onClick={submit} disabled={saving}>{saving ? "…" : "1 · Guardar BOM"}</Btn>
        <Btn variant="ghost" onClick={calcular} disabled={saving}>{saving ? "…" : "2 · Calcular origen"}</Btn>
        <Btn onClick={enviar} disabled={saving || !calculated}>{saving ? "Enviando…" : sent ? "Reenviar al cliente" : "3 · Enviar al cliente"}</Btn>
        {!calculated && <span className="text-xs text-zinc-400">Calcula el origen antes de enviar.</span>}
      </div>
      {s.submitted_bom && <OriginReport bom={s.submitted_bom} />}
      {showLog && (
        <Modal title={`Historial — ${s.product_sku}`} onClose={() => setShowLog(false)}>
          {(s.logs?.length ?? 0) === 0 ? <p className="text-sm text-zinc-400">Sin eventos.</p> : (
            <ul className="space-y-2 text-sm">
              {s.logs!.map((l, i) => (
                <li key={i} className="rounded-lg border border-zinc-200 p-2">
                  <span className="font-medium">{l.action_label}</span>
                  {l.detail ? <span className="text-zinc-500"> · {l.detail}</span> : null}
                  <div className="text-xs text-zinc-400">{l.user ?? "—"} · {l.created_at?.slice(0, 16).replace("T", " ")}</div>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-5 flex justify-end"><Btn variant="ghost" onClick={() => setShowLog(false)}>Cerrar</Btn></div>
        </Modal>
      )}
    </Card>
  );
}
function MisDeclaracionesView() {
  const { data, count } = useList<{ id: number; is_originating: boolean; country_of_origin: string; valid_from: string; valid_to: string }>(() => api.declarations());
  return (
    <div>
      <PageTitle title="Mis declaraciones" desc={`${count} declaraciones enviadas.`} />
      <Table head={["Origen", "País", "Vigencia"]}>
        {data.map((d) => (
          <tr key={d.id}>
            <td className="px-4 py-3"><Pill k={d.is_originating ? "QUALIFIES" : "DOES_NOT"}>{d.is_originating ? "Originario" : "No originario"}</Pill></td>
            <td className="px-4 py-3">{d.country_of_origin || "—"}</td>
            <td className="px-4 py-3">{d.valid_from} → {d.valid_to}</td>
          </tr>
        ))}
        {count === 0 && <tr><td colSpan={3} className="px-4 py-8 text-center text-zinc-400">Aún no envías declaraciones.</td></tr>}
      </Table>
    </div>
  );
}
