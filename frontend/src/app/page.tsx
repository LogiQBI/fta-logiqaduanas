"use client";

import { useEffect, useState } from "react";
import {
  Home, Building2, Users, Package, Truck, ClipboardList, BadgeCheck,
  FileText, ScrollText, BookOpen, Inbox, ChevronDown, LogOut, Search,
  Plus, CheckCircle2,
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
  const [u, setU] = useState(""); const [p, setP] = useState("");
  const [error, setError] = useState(""); const [loading, setLoading] = useState(false);

  function validate(me: Me): string | null {
    if (mode === "admin")
      return me.role === "master" ? null : "Esta cuenta no tiene acceso de administrador.";
    if (mode === "proveedor")
      return me.is_supplier ? null : "Esta cuenta no es de proveedor. Cambia a la pestaña Empresa.";
    // empresa
    if (me.role === "master") return "Usa “Acceso de administrador” para entrar como LogiQ.";
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
          <input value={u} onChange={(e) => setU(e.target.value)} placeholder="Usuario" autoFocus
            className="mb-3 w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
          <input type="password" value={p} onChange={(e) => setP(e.target.value)} placeholder="Contraseña"
            className="mb-4 w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
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

const NAVY = "#0E3A5F";
const CYAN = "#2CA6CB";

function LogoMark({ size = 34 }: { size?: number }) {
  // Símbolo LogiQ Aduanas: dos cuadrados redondeados superpuestos (navy atrás-izq,
  // cyan adelante-der) con un canal blanco interior formando la "G/espiral".
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-label="LogiQ Aduanas">
      {/* cuadrado navy (atrás, izquierda-abajo) */}
      <rect x="12" y="34" width="50" height="50" rx="9" fill={NAVY} />
      {/* cuadrado cyan (adelante, arriba-derecha) */}
      <rect x="40" y="16" width="50" height="50" rx="9" fill={CYAN} />
      {/* campo blanco interior (el hueco de la G) */}
      <rect x="33" y="27" width="33" height="33" rx="3" fill="#fff" />
      {/* pestaña cyan que entra al hueco */}
      <rect x="54" y="47" width="12" height="13" fill={CYAN} />
      {/* barra navy inferior que asoma */}
      <rect x="33" y="66" width="33" height="11" rx="2" fill={NAVY} />
    </svg>
  );
}

function Logo({ center, big }: { center?: boolean; big?: boolean }) {
  return (
    <div className={cx("flex items-center", big ? "gap-3" : "gap-2.5", center && "justify-center")}>
      <LogoMark size={big ? 50 : 36} />
      <div className={cx("font-extrabold leading-none tracking-tight", big ? "text-2xl" : "text-base")}>
        <div style={{ color: NAVY }}>LOGIQ</div>
        <div style={{ color: CYAN }} className={big ? "text-xl" : "text-sm"}>ADUANAS</div>
      </div>
      <div className={cx("mx-1 w-px bg-zinc-300", big ? "h-10" : "h-7")} />
      <div className={cx("font-semibold text-zinc-500", big ? "text-2xl" : "text-lg")}>FTA</div>
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
      <aside className="flex w-64 flex-col border-r border-zinc-200 bg-white">
        <div className="flex h-14 items-center border-b border-zinc-100 px-4"><Logo /></div>
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
      <Table head={["Empresa", "RFC", "Usuarios", "Plan", "Licencia", ""]}>
        {data.map((t) => (
          <tr key={t.id}>
            <td className="px-4 py-3 font-medium">{t.name}</td>
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
        {!loading && data.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-zinc-400">Sin empresas.</td></tr>}
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
  const { data, reload } = useList<Product>(() => api.products());
  const treaties = useList<Treaty>(() => api.treaties());
  const quals = useList<Qualification>(() => api.qualifications());
  const [treatyId, setTreatyId] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
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
  return (
    <div>
      <PageTitle title="Productos" desc="Califica tus productos contra los tratados." />
      <div className="mb-4 flex items-center gap-3">
        <span className="text-sm text-zinc-500">Tratado:</span>
        <select value={treatyId ?? ""} onChange={(e) => setTreatyId(Number(e.target.value))}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm">
          {treaties.data.map((t) => <option key={t.id} value={t.id}>{t.code} — {t.name}</option>)}
        </select>
        {msg && <span className="text-sm text-zinc-500">{msg}</span>}
      </div>
      <Table head={["SKU", "Descripción", "HS", "Resultado", ""]}>
        {data.map((p) => {
          const q = qualFor(p.id);
          return (
            <tr key={p.id}>
              <td className="px-4 py-3 font-mono text-xs">{p.sku}</td>
              <td className="px-4 py-3">{p.description}</td>
              <td className="px-4 py-3 font-mono text-xs">{p.hs_code}</td>
              <td className="px-4 py-3">{q ? <Pill k={q.status}>{q.status_display}{q.rvc_value ? ` · ${q.rvc_value}%` : ""}</Pill> : <span className="text-zinc-400">—</span>}</td>
              <td className="px-4 py-3 text-right">
                <span className="mr-2 inline-block"><Btn size="sm" onClick={() => treatyId && run(p.id, () => api.qualify(p.id, treatyId))}>Calificar</Btn></span>
                <Btn size="sm" variant="ghost" onClick={() => treatyId && run(p.id, async () => { await api.solicit(p.id, treatyId); return { status_display: "Solicitudes enviadas", rvc_value: null } as unknown as Qualification; })}>Solicitar origen</Btn>
              </td>
            </tr>
          );
        })}
      </Table>
    </div>
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
  const { data, count } = useList<{ id: number; name: string; country: string; tax_id: string; kind: string }>(() => api.parties());
  return (
    <div>
      <PageTitle title="Proveedores y clientes" desc={`${count} registros.`} />
      <Table head={["Nombre", "Tipo", "País", "RFC / Tax ID"]}>
        {data.map((p) => (
          <tr key={p.id}>
            <td className="px-4 py-3 font-medium">{p.name}</td>
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
