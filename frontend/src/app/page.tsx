"use client";

import { useEffect, useState } from "react";
import {
  Home, Building2, Users, Package, Truck, ClipboardList, BadgeCheck,
  FileText, ScrollText, BookOpen, Inbox, ChevronDown, LogOut, Search,
  Plus, CheckCircle2, Pencil, Trash2, X,
} from "lucide-react";
import {
  api, clearToken, getToken, MasterTenant, Me, Product, Qualification,
  Solicitation, Treaty,
} from "@/lib/api";

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(" ");

export default function Page() {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);

  async function loadMe() {
    try { setMe(await api.me()); } catch { clearToken(); setMe(null); }
    finally { setReady(true); }
  }
  useEffect(() => { if (getToken()) loadMe(); else setReady(true); }, []);

  if (!ready) return null;
  if (!me) return <Login onLogin={loadMe} />;
  return <Shell me={me} onLogout={() => { clearToken(); setMe(null); }} />;
}

/* ============ Login ============ */
type LoginMode = "empresa" | "proveedor" | "admin";

function Login({ onLogin }: { onLogin: () => void }) {
  const [mode, setMode] = useState<LoginMode>("empresa");
  const [slug, setSlug] = useState("");
  const [u, setU] = useState(""); const [p, setP] = useState("");
  const [error, setError] = useState(""); const [loading, setLoading] = useState(false);

  function validate(me: Me): string | null {
    if (mode === "admin")
      return me.role === "master" ? null : "Esta cuenta no tiene acceso de administrador.";

    // Empresa y proveedor deben indicar el slug de la empresa a la que pertenecen.
    const want = slug.trim().toLowerCase();
    if (!want) return "Escribe el slug de tu empresa.";
    if (me.role === "master") return "Usa “Acceso de administrador” para entrar como LogiQ.";
    if (me.tenant?.slug !== want)
      return `Esta cuenta no pertenece a la empresa “${want}”.`;

    if (mode === "proveedor")
      return me.is_supplier ? null : "Esta cuenta no es de proveedor. Cambia a la pestaña Empresa.";
    // empresa
    if (me.is_supplier) return "Esta cuenta es de proveedor. Cambia a la pestaña Proveedor.";
    return null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(""); setLoading(true);
    try {
      await api.login(u, p);
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
              <label className="mb-1.5 block text-sm font-semibold text-zinc-800">Empresa</label>
              <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="Nombre de tu empresa" autoFocus
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
      { label: "Mi información de origen", items: [
        { key: "mis-solicitudes", label: "Solicitudes", icon: Inbox, badge: badges.pendientes },
        { key: "mis-declaraciones", label: "Mis declaraciones", icon: FileText },
      ] },
    ];
  }
  return [
    { items: [{ key: "home", label: "Inicio", icon: Home }] },
    { label: "Origen", items: [
      { key: "productos", label: "Productos", icon: Package },
      { key: "calificaciones", label: "Calificaciones", icon: CheckCircle2 },
      { key: "certificados", label: "Certificados", icon: BadgeCheck },
    ] },
    { label: "Proveedores", items: [
      { key: "proveedores", label: "Proveedores", icon: Truck },
      { key: "solicitudes", label: "Solicitudes", icon: ClipboardList, badge: badges.pendientes },
    ] },
    { label: "Catálogos", items: [
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
    case "calificaciones": return <CalificacionesView />;
    case "certificados": return <CertificadosView />;
    case "proveedores": return <ProveedoresView />;
    case "solicitudes": return <SolicitudesEmpresaView />;
    case "mis-solicitudes": return <MisSolicitudesView />;
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
    { icon: Inbox, color: "bg-blue-50 text-blue-600", title: "Solicitudes", desc: "Información que te piden", k: "mis-solicitudes" },
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
  const { data, reload } = useList<{ id: number; username: string; membership: { tenant: string; role_display: string; party: string | null } | null }>(() => api.masterUsers());
  const tenants = useList<MasterTenant>(() => api.masterTenants());
  const [f, setF] = useState({ username: "", password: "", tenant: "" as number | "", role: "admin" });
  const [msg, setMsg] = useState("");
  async function create() {
    if (!f.username || !f.tenant) { setMsg("Usuario y empresa son obligatorios."); return; }
    try { await api.masterCreateUser(f); setF({ username: "", password: "", tenant: "", role: "admin" }); setMsg("Usuario creado."); await reload(); }
    catch (e) { setMsg((e as Error).message); }
  }
  return (
    <div>
      <PageTitle title="Usuarios" desc="Accesos de empresas y proveedores." />
      {msg && <p className="mb-3 text-sm text-amber-600">{msg}</p>}
      <Table head={["Usuario", "Empresa", "Rol", "Proveedor"]}>
        {data.map((u) => (
          <tr key={u.id}>
            <td className="px-4 py-3 font-medium">{u.username}</td>
            <td className="px-4 py-3">{u.membership?.tenant ?? "—"}</td>
            <td className="px-4 py-3">{u.membership?.role_display ?? "Master"}</td>
            <td className="px-4 py-3">{u.membership?.party ?? "—"}</td>
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
          <tr key={t.id}><td className="px-4 py-3 font-mono text-xs font-semibold">{t.code}</td>
            <td className="px-4 py-3">{t.name}</td></tr>
        ))}
      </Table>
    </div>
  );
}
function ReglasView() {
  const { data, count } = useList<{ id: number; hs_pattern: string; rule_type: string; description: string; treaty: number }>(() => api.rules());
  return (
    <div>
      <PageTitle title="Reglas de origen" desc={`${count} reglas cargadas (mostrando las primeras 50).`} />
      <Table head={["HS", "Tipo", "Descripción"]}>
        {data.map((r) => (
          <tr key={r.id}>
            <td className="px-4 py-3 font-mono text-xs">{r.hs_pattern}</td>
            <td className="px-4 py-3"><Pill>{r.rule_type}</Pill></td>
            <td className="px-4 py-3 text-zinc-600">{r.description?.slice(0, 90)}</td>
          </tr>
        ))}
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
  return (
    <div>
      <PageTitle title="Productos" desc="Da de alta tus productos y califícalos contra los tratados." />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="text-sm text-zinc-500">Tratado:</span>
        <select value={treatyId ?? ""} onChange={(e) => setTreatyId(Number(e.target.value))}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm">
          {treaties.data.map((t) => <option key={t.id} value={t.id}>{t.code} — {t.name}</option>)}
        </select>
        <div className="ml-auto"><Btn onClick={() => setEditing("new")}><Plus size={15} className="-mt-0.5 mr-1 inline" />Nuevo producto</Btn></div>
      </div>
      {msg && <p className="mb-3 text-sm text-amber-600">{msg}</p>}
      <Table head={["SKU", "Descripción", "Tipo", "HS", "Resultado", ""]}>
        {data.map((p) => {
          const q = qualFor(p.id);
          return (
            <tr key={p.id}>
              <td className="px-4 py-3 font-mono text-xs">{p.sku}</td>
              <td className="px-4 py-3">{p.description}</td>
              <td className="px-4 py-3 text-xs text-zinc-500">{p.kind_display ?? p.kind}</td>
              <td className="px-4 py-3 font-mono text-xs">{p.hs_code}</td>
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
        {!loading && data.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-zinc-400">Aún no tienes productos. Crea el primero con “Nuevo producto”.</td></tr>}
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
        <Field label="Fracción arancelaria (HS)">
          <input value={f.hs_code} onChange={(e) => set("hs_code", e.target.value)} className={cx(inputCls, "font-mono")} placeholder="8703.23" />
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
function ProveedoresView() {
  const { data, count } = useList<{ id: number; name: string; slug: string; country: string; tax_id: string; kind: string }>(() => api.parties());
  return (
    <div>
      <PageTitle title="Proveedores y clientes" desc={`${count} registros. El slug identifica a cada uno dentro de tu empresa.`} />
      <Table head={["Nombre", "Slug", "Tipo", "País", "RFC / Tax ID"]}>
        {data.map((p) => (
          <tr key={p.id}>
            <td className="px-4 py-3 font-medium">{p.name}</td>
            <td className="px-4 py-3"><code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600">{p.slug}</code></td>
            <td className="px-4 py-3">{p.kind === "supplier" ? "Proveedor" : "Cliente"}</td>
            <td className="px-4 py-3">{p.country}</td>
            <td className="px-4 py-3 font-mono text-xs">{p.tax_id || "—"}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
function SolicitudesEmpresaView() {
  const { data, count } = useList<Solicitation>(() => api.solicitations());
  const products = useList<Product>(() => api.products());
  const treaties = useList<Treaty>(() => api.treaties());
  const pn = (id: number) => products.data.find((p) => p.id === id)?.sku ?? `#${id}`;
  const tn = (id: number) => treaties.data.find((t) => t.id === id)?.code ?? `#${id}`;
  return (
    <div>
      <PageTitle title="Solicitudes a proveedores" desc={`${count} solicitudes. Genera nuevas desde Productos → "Solicitar origen".`} />
      <Table head={["Material", "Tratado", "Estado", "Límite"]}>
        {data.map((s) => (
          <tr key={s.id}>
            <td className="px-4 py-3 font-mono text-xs">{pn(s.product)}</td>
            <td className="px-4 py-3">{tn(s.treaty)}</td>
            <td className="px-4 py-3"><Pill k={s.status}>{s.status_display}</Pill></td>
            <td className="px-4 py-3">{s.due_date ?? "—"}</td>
          </tr>
        ))}
        {count === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-zinc-400">Sin solicitudes todavía.</td></tr>}
      </Table>
    </div>
  );
}

/* ============ PROVEEDOR ============ */
function MisSolicitudesView() {
  const { data, reload, count } = useList<Solicitation>(() => api.solicitations());
  const products = useList<Product>(() => api.products());
  const treaties = useList<Treaty>(() => api.treaties());
  const prod = (id: number) => products.data.find((p) => p.id === id);
  const tcode = (id: number) => treaties.data.find((t) => t.id === id)?.code ?? `#${id}`;
  return (
    <div>
      <PageTitle title="Solicitudes" desc="Completa la información de origen que te piden." />
      {count === 0 && <Card className="p-8 text-center text-zinc-400">No tienes solicitudes pendientes.</Card>}
      <div className="space-y-4">
        {data.map((s) => <SolCard key={s.id} s={s} product={prod(s.product)} tcode={tcode(s.treaty)} onDone={reload} />)}
      </div>
    </div>
  );
}
function SolCard({ s, product, tcode, onDone }: {
  s: Solicitation; product?: Product; tcode: string; onDone: () => void;
}) {
  const [orig, setOrig] = useState(true); const [country, setCountry] = useState("");
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [saving, setSaving] = useState(false); const [err, setErr] = useState("");
  const done = s.status === "responded";
  async function submit() {
    setErr(""); setSaving(true);
    try { await api.respond(s.id, { is_originating: orig, country_of_origin: country, valid_from: from, valid_to: to }); onDone(); }
    catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  }
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="font-medium text-zinc-900">{product ? `${product.sku} — ${product.description}` : `Material #${s.product}`}</div>
          <div className="text-xs text-zinc-500">HS {product?.hs_code} · Tratado {tcode}</div>
        </div>
        <Pill k={s.status}>{s.status_display}</Pill>
      </div>
      {done ? <p className="text-sm text-zinc-500">Ya enviaste tu declaración. ¡Gracias!</p> : (
        <div className="grid grid-cols-2 gap-3 text-sm">
          <label className="col-span-2 flex items-center gap-2">
            <input type="checkbox" checked={orig} onChange={(e) => setOrig(e.target.checked)} />
            ¿El material es originario para este tratado?
          </label>
          <div><label className="block text-xs text-zinc-500">País (ISO-2)</label>
            <input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="MX" className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-1.5" /></div>
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
