"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import {
  Home, Building2, Users, Package, Truck, ClipboardList, BadgeCheck,
  FileText, ScrollText, BookOpen, Inbox, ChevronDown, LogOut, Search,
  Plus, CheckCircle2, Pencil, Trash2, X, KeyRound, Boxes, Calculator, Upload,
  Sun, Moon, Download, ShieldCheck,
} from "lucide-react";
import {
  api, AuditDoc, AuditRow, AutomotiveResult, AutomotiveSaved, BomComponent, BomLine, BomOriginComponent,
  BulkPreview, BulkResult, BulkSpec, CertificateItem, clearAsTenant, clearToken, ClientLayout, CompanyUser, EmittedCertificate,
  getAsTenant, getToken, LicenseInfo, setAsTenant,
  MasterTenant, Me, OriginAnalysis, OriginAnalysisDetail, OriginCalcResult, OriginRule, Party,
  Product, ProductChangeLog, ProductOriginDoc, Qualification,
  Solicitation, SolicitationCert, SubmittedBom, SupercoreResult, SupplierProfile, SupplierUser, Treaty,
} from "@/lib/api";
import { COUNTRIES, isValidCountry } from "@/lib/countries";
import { UOM_OPTIONS, uomLabel } from "@/lib/uom";
import { getLang as getAppLang, initLangFromStorage, setLang as setAppLang, t as tr, useLang } from "@/lib/i18n";

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(" ");

// Desplegable de unidad de medida (UOM) para las líneas de BOM.
function UomSelect({ value, onChange, className }: {
  value: string; onChange: (v: string) => void; className?: string;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={className} aria-label="Unidad de medida">
      <option value="">U.M.…</option>
      {UOM_OPTIONS.map((u) => <option key={u.code} value={u.code}>{u.code} — {u.label}</option>)}
    </select>
  );
}

// Etiqueta de tratado en inglés para mostrar (interno se mantiene el código).
const TREATY_LABELS: Record<string, string> = { TMEC: "USMCA" };
const treatyLabel = (code?: string) => (code ? (TREATY_LABELS[code] ?? code) : "—");

export default function Page() {
  const [me, setMe] = useState<Me | null>(null);
  const [lic, setLic] = useState<LicenseInfo | null>(null);
  const [ready, setReady] = useState(false);
  // Idioma: re-renderiza TODO al cambiar; se carga el guardado tras montar.
  useLang();
  useEffect(() => { initLangFromStorage(); }, []);

  async function loadMe() {
    try {
      const u = await api.me(); setMe(u);
      if (u.role !== "master") { try { setLic(await api.license()); } catch { setLic(null); } }
      else setLic(null);
    } catch { clearToken(); setMe(null); }
    finally { setReady(true); }
  }
  useEffect(() => { if (getToken()) loadMe(); else setReady(true); }, []);
  // Aplica el tema guardado (día/noche) al cargar.
  useEffect(() => {
    if (typeof document !== "undefined" && localStorage.getItem("fta_theme") === "dark")
      document.documentElement.classList.add("dark");
  }, []);

  const logout = () => { clearToken(); clearAsTenant(); setMe(null); };
  if (!ready) return null;
  if (!me) return <Login onLogin={loadMe} />;
  if (me.must_change_password)
    return <FirstLoginPassword me={me} onDone={loadMe} onLogout={logout} />;
  if (me.role !== "master" && !me.is_master && lic && lic.is_valid === false)
    return <SuspensionScreen lic={lic} onLogout={logout} />;
  return <Shell me={me} onLogout={logout} />;
}

/* ============ Sistema suspendido por licencia vencida ============ */
function SuspensionScreen({ lic, onLogout }: { lic: LicenseInfo; onLogout: () => void }) {
  const monto = lic.renewal_amount && Number(lic.renewal_amount) > 0
    ? `${Number(lic.renewal_amount).toLocaleString("es-MX")} ${lic.renewal_currency ?? "MXN"}` : null;
  return (
    <main className="grid min-h-screen place-items-center bg-zinc-50 p-6">
      <div className="w-full max-w-md rounded-2xl border border-red-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-red-100 text-3xl">⛔</div>
        <h1 className="text-xl font-bold text-red-700">Sistema suspendido</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Tu licencia de <strong>LogiQ Aduanas | FTA</strong> se encuentra <strong>vencida</strong>.
          El acceso está suspendido hasta su renovación.
        </p>
        <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm">
          {lic.valid_until && <div className="text-zinc-600">Venció el <strong>{lic.valid_until}</strong></div>}
          {monto && <div className="mt-1 text-zinc-900">Monto de renovación: <strong>{monto}</strong></div>}
          {lic.renewal_notes && <div className="mt-1 text-xs text-zinc-500">{lic.renewal_notes}</div>}
        </div>
        <p className="mt-4 text-sm text-zinc-600">Contacta a tu proveedor <strong>LogiQ Aduanas</strong> para renovar tu licencia.</p>
        <button onClick={onLogout} className="mt-6 rounded-lg border border-zinc-300 px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-100">Cerrar sesión</button>
      </div>
    </main>
  );
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
    // Un "Abrir empresa" viejo (X-As-Tenant) haría que /me/ no responda como
    // master y el login de admin se rechace: en la pantalla de login no hay
    // impersonación válida, así que se limpia siempre.
    clearAsTenant();
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
          <div className="mt-2 flex justify-center"><LangToggle /></div>
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
        // El master LIMITADO no gestiona usuarios globales (solo los de sus
        // empresas asignadas, desde adentro de cada una).
        ...(me.master_limited ? [] : [{ key: "usuarios", label: "Usuarios", icon: Users }]),
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
      { label: "Mi empresa", items: [
        { key: "datos-empresa", label: "Datos de la empresa", icon: Building2 },
      ] },
      { label: "Catálogo", items: [
        { key: "mis-productos", label: "Productos", icon: Package },
      ] },
      { label: "Origen", items: [
        { key: "mis-solicitudes", label: "Solicitudes de cliente", icon: Inbox, badge: badges.pendientes },
        { key: "auditorias-prov", label: "Auditorías", icon: ShieldCheck },
        { key: "aceptadas", label: "Declaraciones aceptadas", icon: BadgeCheck },
        { key: "mis-declaraciones", label: "Mis declaraciones", icon: FileText },
      ] },
    ];
  }
  return [
    { items: [{ key: "home", label: "Inicio", icon: Home }] },
    { label: "Mi empresa", items: [
      { key: "datos-empresa", label: "Datos de la empresa", icon: Building2 },
      // Solo el ADMINISTRADOR de la empresa gestiona los usuarios de su equipo.
      ...(me.role === "admin" ? [{ key: "equipo", label: "Usuarios", icon: Users }] : []),
      { key: "licencia", label: "Licencia", icon: BadgeCheck },
    ] },
    { label: "Catálogos", items: [
      { key: "proveedores", label: "Proveedores", icon: Truck },
      { key: "clientes", label: "Clientes", icon: Users },
      { key: "insumos", label: "Números de parte", icon: Package },
    ] },
    { label: "Origen", items: [
      { key: "productos", label: "Productos", icon: Boxes },
      { key: "calculo-origen", label: "Cálculo de origen", icon: Calculator },
      { key: "calificaciones", label: "Calificaciones", icon: CheckCircle2 },
      { key: "certificados", label: "Emitir certificados", icon: BadgeCheck },
      { key: "auditorias", label: "Auditorías", icon: ShieldCheck },
      { key: "solicitudes", label: "Solicitudes", icon: ClipboardList, badge: badges.pendientes },
      { key: "aceptadas", label: "Declaraciones aceptadas", icon: BadgeCheck },
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
  // Secciones del menú lateral colapsadas (por etiqueta). Por defecto TODAS
  // retraídas para una UX limpia; el usuario expande la que necesite.
  const [colapsadas, setColapsadas] = useState<Record<string, boolean>>(() => {
    const o: Record<string, boolean> = {};
    navFor(me, {}).forEach((s) => { if (s.label) o[s.label] = true; });
    return o;
  });
  const toggleSec = (label: string) => setColapsadas((c) => ({ ...c, [label]: !c[label] }));

  useEffect(() => {
    // badge de solicitudes pendientes (empresa o proveedor)
    if (me.role === "master") return;
    api.solicitations().then((r) => {
      const pend = r.results.filter((s: Solicitation) => !solAnswered(s)).length;
      setBadges({ pendientes: pend });
    }).catch(() => {});
  }, [me.role, view]);

  const sections = navFor(me, badges);
  const subtitle = me.role === "master" ? "Equipo LogiQ"
    : me.is_supplier ? `Proveedor · ${me.supplier?.name}`
    : `${me.role_display} · ${me.tenant?.name}`;
  const headerName = me.is_supplier ? me.supplier?.name : (me.tenant?.name ?? "LogiQ");

  return (
    <div className="flex min-h-screen flex-col">
    {me.impersonating && (
      <div className="flex items-center justify-between gap-3 bg-indigo-600 px-6 py-2 text-sm text-white">
        <span className="truncate">
          Estás viendo <strong>{me.tenant?.name}</strong> como <strong>equipo LogiQ</strong> (administrador).
        </span>
        <button onClick={() => { clearAsTenant(); window.location.reload(); }}
          className="shrink-0 rounded-md bg-white/15 px-3 py-1 font-medium hover:bg-white/25">
          Salir y volver a LogiQ
        </button>
      </div>
    )}
    <div className="flex flex-1 bg-[#f5f6f8] text-zinc-800">
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
          {sections.map((sec, i) => {
            const isCollapsed = sec.label ? !!colapsadas[sec.label] : false;
            return (
            <div key={i}>
              {sec.label && (
                <button onClick={() => toggleSec(sec.label!)}
                  className="mb-1 flex w-full items-center gap-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 hover:text-zinc-600">
                  <ChevronDown size={13} className={cx("transition-transform", isCollapsed && "-rotate-90")} />
                  <span className="flex-1 text-left">{sec.label}</span>
                </button>
              )}
              {!isCollapsed && sec.items.map((it) => {
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
            );
          })}
        </nav>
      </aside>

      {/* Main */}
      <div className="flex flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-zinc-200 bg-white px-6">
          <div className="relative w-64 max-w-full">
            <Search size={16} className="absolute left-3 top-2.5 text-zinc-400" />
            <input placeholder="Buscar…" className="w-full rounded-lg border border-zinc-200 bg-zinc-50 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-400" />
          </div>
          {me.tenant?.logo && (
            <div className="ml-4 flex min-w-0 items-center gap-2">
              <img src={me.tenant.logo} alt={me.tenant.name} className="h-8 w-auto max-w-[150px] object-contain" />
              <span className="hidden truncate text-sm font-semibold text-zinc-700 lg:inline">{me.tenant.name}</span>
            </div>
          )}
          <div className="ml-auto flex items-center gap-3">
          <LangToggle />
          <ThemeToggle />
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
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-8">
          <View view={view} me={me} go={setView} />
        </main>
      </div>
    </div>
    </div>
  );
}

/* ============ Router de vistas ============ */
function View({ view, me, go }: { view: string; me: Me; go: (v: string) => void }) {
  switch (view) {
    case "home": return <HomeView me={me} go={go} />;
    case "empresas": return <EmpresasView me={me} />;
    case "usuarios": return <UsuariosView me={me} />;
    case "equipo": return <EquipoView me={me} />;
    case "tratados": return <TratadosView />;
    case "reglas": return <ReglasView me={me} />;
    case "productos": return <ProductosView />;
    case "calculo-origen": return <CalculoOrigenView />;
    case "insumos": return <InsumosView />;
    case "asignar-proveedor": return <AsignarProveedorView />;
    case "calificaciones": return <CalificacionesView />;
    case "certificados": return <CertificadosEmitirView />;
    case "auditorias": return <AuditoriasView />;
    case "auditorias-prov": return <AuditoriasProveedorView />;
    case "proveedores": return <ProveedoresView me={me} />;
    case "clientes": return <ClientesView />;
    case "licencia": return <LicenciaView />;
    case "datos-empresa": return me.is_supplier ? <DatosEmpresaView /> : <DatosEmpresaCompanyView me={me} />;
    case "solicitudes": return <SolicitudesEmpresaView />;
    case "mis-productos": return <ProveedorProductosView />;
    case "aceptadas": return <DeclaracionesAceptadasView me={me} />;
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
      {/* Scroll horizontal cuando la tabla es ancha */}
      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="sticky top-0 z-10 bg-zinc-50 text-left text-zinc-500">
            <tr>{head.map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">{children}</tbody>
        </table>
      </div>
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
function Modal({ title, onClose, children, wide }: {
  title: string; onClose: () => void; children: React.ReactNode; wide?: boolean;
}) {
  // OJO: el fondo NO cierra el modal. Cerrarlo con un clic fuera (o al soltar
  // el mouse fuera mientras se selecciona texto para copiar/pegar) tiraba
  // capturas completas — caso real de Hanwha. Solo cierran la X y Cancelar.
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className={cx("flex max-h-[90vh] w-full flex-col rounded-2xl bg-white shadow-xl",
        wide ? "max-w-5xl" : "max-w-lg")}>
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4">
          <h3 className="font-semibold text-zinc-900">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700">
            <X size={18} />
          </button>
        </div>
        {/* Scroll vertical y horizontal del contenido del modal */}
        <div className="overflow-auto p-5">{children}</div>
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

// Botón de idioma ES/EN. Persiste la elección; el cambio re-renderiza todo
// (useLang en la raíz) y el runtime JSX traduce con el diccionario.
function LangToggle() {
  const lang = useLang();
  return (
    <button onClick={() => setAppLang(lang === "es" ? "en" : "es")}
      title={lang === "es" ? "Switch to English" : "Cambiar a español"}
      className="grid h-9 min-w-9 place-items-center rounded-lg border border-zinc-200 px-1.5 text-xs font-bold text-zinc-500 hover:bg-zinc-50 hover:text-zinc-700">
      {lang === "es" ? "EN" : "ES"}
    </button>
  );
}

// Botón de modo día/noche. Persiste la elección en localStorage.
function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => { setDark(document.documentElement.classList.contains("dark")); }, []);
  function toggle() {
    const d = !dark;
    document.documentElement.classList.toggle("dark", d);
    localStorage.setItem("fta_theme", d ? "dark" : "light");
    setDark(d);
  }
  return (
    <button onClick={toggle} title={dark ? "Modo día" : "Modo noche"}
      className="grid h-9 w-9 place-items-center rounded-lg border border-zinc-200 text-zinc-500 hover:bg-zinc-50 hover:text-zinc-700">
      {dark ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}

// Búsqueda inteligente: prioriza coincidencias por PREFIJO (ej. "ST" → ST001,
// ST002…) y luego por contenido. `fields` extrae los textos buscables de cada fila.
function smartFilter<T>(rows: T[], q: string, fields: (r: T) => (string | null | undefined)[]): T[] {
  const s = q.trim().toLowerCase();
  if (!s) return rows;
  const pref: T[] = [], sub: T[] = [];
  for (const r of rows) {
    const fs = fields(r).map((x) => (x ?? "").toString().toLowerCase());
    if (fs.some((x) => x.startsWith(s))) pref.push(r);
    else if (fs.some((x) => x.includes(s))) sub.push(r);
  }
  return [...pref, ...sub];
}

// Exporta filas a un archivo CSV (lo abre Excel; con BOM para acentos correctos).
function exportCSV(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    const t = String(v ?? "");
    return /[",\n;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const csv = [headers, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

// Barra de reportes: buscador inteligente + botón de exportar a Excel (CSV).
function ReportToolbar({ q, setQ, onExport, placeholder }: {
  q: string; setQ: (s: string) => void; onExport: () => void; placeholder?: string;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <div className="relative min-w-[14rem] flex-1 sm:max-w-sm">
        <Search size={15} className="absolute left-2.5 top-2.5 text-zinc-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder ?? "Buscar… (ej. ST muestra ST001, ST002)"}
          className={cx(inputCls, "pl-8")} />
      </div>
      <Btn size="sm" variant="ghost" onClick={onExport}><Download size={14} className="-mt-0.5 mr-1 inline" />Exportar a Excel</Btn>
    </div>
  );
}

const STATUS_PILL: Record<string, string> = {
  QUALIFIES: "bg-green-100 text-green-700", DOES_NOT: "bg-red-100 text-red-700",
  INSUFFICIENT: "bg-amber-100 text-amber-700", AUTO_REVIEW: "bg-amber-100 text-amber-800",
  active: "bg-green-100 text-green-700", suspended: "bg-red-100 text-red-700",
  expired: "bg-zinc-200 text-zinc-600", responded: "bg-green-100 text-green-700",
  pending: "bg-amber-100 text-amber-700", sent: "bg-blue-100 text-blue-700",
  accepted: "bg-green-100 text-green-700", rejected: "bg-red-100 text-red-700",
};
function Pill({ k, children }: { k?: string; children: React.ReactNode }) {
  return <span className={cx("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_PILL[k ?? ""] ?? "bg-zinc-100 text-zinc-600")}>{children}</span>;
}
// Cuadro que explica el estado "Requiere régimen automotriz" (core parts T-MEC).
function AutoReviewBox() {
  return (
    <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
      <div className="mb-1 font-semibold">🚗 ¿Qué significa “Requiere régimen automotriz”?</div>
      <p className="text-amber-800">
        Uno o más productos son una <strong>parte esencial (“core part”)</strong> del régimen automotriz
        del T-MEC (Anexo 4-B, ej. suspensión, ejes, transmisiones, dirección, carrocerías, motores,
        baterías). Para estas partes <strong>el salto arancelario NO es suficiente</strong> para darlas
        por originarias — por eso no aparecen como “Califica”.
      </p>
      <div className="mt-2">
        <div className="font-semibold text-amber-900">¿Qué hay que hacer?</div>
        <ul className="ml-4 mt-1 list-disc space-y-0.5 text-amber-800">
          <li>Entra a <strong>“Cálculo de origen”</strong> y elige este producto: ahí mismo aparecerán
            los campos del <strong>régimen automotriz</strong> para completarlo.</li>
          <li>Debe cumplir: <strong>Valor de Contenido Regional (VCR)</strong> alto por costo neto,
            <strong> Valor de Contenido Laboral (LVC)</strong> y compra de <strong>acero/aluminio</strong>
            originario (super-core).</li>
          <li>Al completarlo, el sistema determina el origen (y si califica, ya se puede certificar).</li>
        </ul>
        <p className="mt-1 text-[11px] text-amber-700">El cálculo por BOM es solo informativo; la determinación formal usa el régimen automotriz, con apoyo de un especialista.</p>
      </div>
    </div>
  );
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
      {me.role !== "master" && !me.is_supplier && <LicenseBanner />}
      {me.role !== "master" && !me.is_supplier && <InsumosSinProveedorBanner go={go} />}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => <ActionCard key={c.k} {...c} onClick={() => go(c.k)} />)}
      </div>
      {me.role !== "master" && <PendientesPanel me={me} go={go} />}
    </div>
  );
}
// Días restantes / vencimiento de una solicitud por su fecha límite.
function diasInfo(s: Solicitation): { dias: number | null; txt: string; cls: string } {
  if (!s.due_date) return { dias: null, txt: "Sin fecha límite", cls: "bg-zinc-100 text-zinc-600" };
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const due = new Date(s.due_date + "T00:00:00");
  const d = Math.round((due.getTime() - hoy.getTime()) / 86400000);
  if (d < 0) return { dias: d, txt: `Vencida hace ${-d} día${-d === 1 ? "" : "s"}`, cls: "bg-red-100 text-red-700" };
  if (d === 0) return { dias: 0, txt: "Vence hoy", cls: "bg-red-100 text-red-700" };
  if (d <= 7) return { dias: d, txt: `Quedan ${d} día${d === 1 ? "" : "s"}`, cls: "bg-amber-100 text-amber-800" };
  return { dias: d, txt: `Quedan ${d} días`, cls: "bg-emerald-100 text-emerald-700" };
}
// Panel de solicitudes pendientes de respuesta (empresa o proveedor) con su
// estado de vencimiento (vencidas / por vencer / días restantes).
function PendientesPanel({ me, go }: { me: Me; go: (v: string) => void }) {
  const { data, loading, error } = useList<Solicitation>(() => api.solicitations());
  const esEmpresa = !me.is_supplier;
  const pend = data.filter((s) => !solAnswered(s));
  const conInfo = pend.map((s) => ({ s, info: diasInfo(s) }));
  const vencidas = conInfo.filter((x) => x.info.dias !== null && x.info.dias <= 0).length;
  const porVencer = conInfo.filter((x) => x.info.dias !== null && x.info.dias > 0 && x.info.dias <= 7).length;
  const aTiempo = conInfo.length - vencidas - porVencer;
  const orden = [...conInfo].sort((a, b) => {
    if (a.info.dias === null) return 1;
    if (b.info.dias === null) return -1;
    return a.info.dias - b.info.dias;
  });
  const target = esEmpresa ? "solicitudes" : "mis-solicitudes";
  const titulo = esEmpresa
    ? "Solicitudes pendientes de respuesta (proveedores)"
    : "Solicitudes pendientes por responder";
  const quien = esEmpresa ? "Proveedor" : "Cliente";
  if (loading) return null;
  return (
    <div className="mt-8">
      <h2 className="mb-3 text-lg font-bold text-zinc-900">{titulo}</h2>
      {error ? (
        <Card className="p-6 text-center text-sm text-red-600">No se pudieron cargar las solicitudes ({error}). Recarga la página.</Card>
      ) : pend.length === 0 ? (
        <Card className="p-6 text-center text-sm text-zinc-400">No hay solicitudes pendientes. 🎉</Card>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-2 text-sm">
            <span className="rounded-full bg-zinc-100 px-3 py-1 font-medium text-zinc-700">{pend.length} pendientes</span>
            {vencidas > 0 && <span className="rounded-full bg-red-100 px-3 py-1 font-medium text-red-700">⏰ {vencidas} vencida{vencidas === 1 ? "" : "s"} / vence hoy</span>}
            {porVencer > 0 && <span className="rounded-full bg-amber-100 px-3 py-1 font-medium text-amber-800">⏳ {porVencer} por vencer (≤7 días)</span>}
            {aTiempo > 0 && <span className="rounded-full bg-emerald-100 px-3 py-1 font-medium text-emerald-700">✓ {aTiempo} a tiempo</span>}
          </div>
          {!esEmpresa && pend.some((s) => !s.bom_analysis) && (
            <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
              💡 No las respondas una por una: puedes responder <strong>todas en un solo Excel</strong>.{" "}
              <button onClick={() => go(target)} className="font-semibold text-blue-700 underline hover:text-blue-900">
                Ir a Solicitudes de cliente → Responder TODO por Excel
              </button>
            </div>
          )}
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-xs text-zinc-500">
                <tr>
                  <th className="px-4 py-2.5">Núm. de parte</th>
                  <th className="px-4 py-2.5">{quien}</th>
                  <th className="px-4 py-2.5">Tratado</th>
                  <th className="px-4 py-2.5">Fecha límite</th>
                  <th className="px-4 py-2.5">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {orden.slice(0, 12).map(({ s, info }) => (
                  <tr key={s.id} className="cursor-pointer hover:bg-zinc-50" onClick={() => go(target)}>
                    <td className="px-4 py-2.5 font-mono text-xs">{s.product_sku ?? `#${s.product}`}</td>
                    <td className="px-4 py-2.5 text-xs">{esEmpresa ? (s.supplier_name ?? "—") : (s.tenant_name ?? "—")}</td>
                    <td className="px-4 py-2.5 text-xs">{treatyLabel(s.treaty_code)}</td>
                    <td className="px-4 py-2.5 text-xs text-zinc-500">{s.due_date ?? "—"}</td>
                    <td className="px-4 py-2.5"><span className={cx("rounded-full px-2 py-0.5 text-[11px] font-medium", info.cls)}>{info.txt}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          {orden.length > 12 && (
            <button onClick={() => go(target)} className="mt-2 text-sm text-blue-600 hover:underline">
              Ver las {orden.length} solicitudes pendientes →
            </button>
          )}
        </>
      )}
    </div>
  );
}

/* ============ MASTER ============ */
function EmpresasView({ me }: { me: Me }) {
  const { data, reload, loading } = useList<MasterTenant>(() => api.masterTenants());
  const [name, setName] = useState(""); const [rfc, setRfc] = useState(""); const [msg, setMsg] = useState("");
  const [edit, setEdit] = useState<MasterTenant | null>(null);
  const [licFor, setLicFor] = useState<MasterTenant | null>(null);
  const limitado = !!me.master_limited;
  const act = async (fn: () => Promise<unknown>) => { try { await fn(); await reload(); } catch (e) { setMsg((e as Error).message); } };
  return (
    <div>
      <PageTitle title="Empresas" desc={limitado
        ? "Tus empresas asignadas. Puedes abrirlas y administrarlas por dentro; el alta, baja y licencias las gestiona el equipo master completo."
        : "Clientes del sistema y sus licencias."} />
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
            <td className="px-4 py-3 text-right whitespace-nowrap">
              <span className="mr-2 inline-block"><Btn size="sm" onClick={() => { setAsTenant(t.id); window.location.reload(); }}>Abrir empresa</Btn></span>
              {!limitado && <>
                <span className="mr-2 inline-block"><Btn size="sm" variant="ghost" onClick={() => setEdit(t)}>Editar</Btn></span>
                <span className="mr-2 inline-block"><Btn size="sm" variant="ghost" onClick={() => setLicFor(t)}>Licencia</Btn></span>
                <Btn size="sm" variant="danger" onClick={() => { if (confirm(tr(`¿Eliminar ${t.name}?`))) act(() => api.masterDeleteTenant(t.id)); }}>Eliminar</Btn>
              </>}
            </td>
          </tr>
        ))}
        {!loading && data.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-zinc-400">Sin empresas.</td></tr>}
      </Table>
      {!limitado && <Card className="mt-6 max-w-md p-5">
        <h3 className="mb-3 font-semibold">Nueva empresa</h3>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Razón social"
          className="mb-2 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm" />
        <input value={rfc} onChange={(e) => setRfc(e.target.value)} placeholder="RFC (opcional)"
          className="mb-3 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm" />
        <Btn onClick={() => name && act(async () => { await api.masterCreateTenant({ name, rfc }); setName(""); setRfc(""); })}>
          <Plus size={15} className="-mt-0.5 mr-1 inline" />Crear empresa
        </Btn>
      </Card>}
      {edit && <EditTenantModal tenant={edit} onClose={() => setEdit(null)}
        onSaved={async () => { setEdit(null); await reload(); }} />}
      {licFor && <LicenseModal tenant={licFor} onClose={() => setLicFor(null)}
        onSaved={async () => { setLicFor(null); await reload(); }} />}
    </div>
  );
}
// El master fija la vigencia, el estado y el monto de renovación de la licencia.
function LicenseModal({ tenant, onClose, onSaved }: {
  tenant: MasterTenant; onClose: () => void; onSaved: () => void;
}) {
  const l = tenant.license;
  const [f, setF] = useState({
    plan: l?.plan ?? "trial", status: l?.status ?? "active",
    valid_until: l?.valid_until ?? "", renewal_amount: l?.renewal_amount ?? "",
    renewal_currency: l?.renewal_currency ?? "MXN", renewal_notes: l?.renewal_notes ?? "",
  });
  const [err, setErr] = useState(""); const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v });
  async function save() {
    setErr(""); setSaving(true);
    try { await api.masterSetLicense(tenant.id, f); onSaved(); }
    catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  }
  return (
    <Modal title={`Licencia — ${tenant.name}`} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Plan">
          <select className={inputCls} value={f.plan} onChange={(e) => set("plan", e.target.value)}>
            <option value="trial">Prueba</option><option value="basic">Básico</option>
            <option value="pro">Pro</option><option value="enterprise">Enterprise</option>
          </select>
        </Field>
        <Field label="Estado">
          <select className={inputCls} value={f.status} onChange={(e) => set("status", e.target.value)}>
            <option value="active">Activa</option><option value="suspended">Suspendida</option>
            <option value="expired">Vencida</option>
          </select>
        </Field>
        <div className="col-span-2"><Field label="Vigente hasta">
          <input type="date" className={inputCls} value={f.valid_until} onChange={(e) => set("valid_until", e.target.value)} /></Field></div>
        <Field label="Monto de renovación">
          <input type="number" step="any" className={inputCls} value={f.renewal_amount} onChange={(e) => set("renewal_amount", e.target.value)} /></Field>
        <Field label="Moneda">
          <input className={cx(inputCls, "uppercase")} maxLength={3} value={f.renewal_currency} onChange={(e) => set("renewal_currency", e.target.value.toUpperCase())} /></Field>
        <div className="col-span-2"><Field label="Notas de renovación (opcional)">
          <input className={inputCls} value={f.renewal_notes} onChange={(e) => set("renewal_notes", e.target.value)} placeholder="Ej. incluye soporte y actualizaciones" /></Field></div>
      </div>
      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
        <Btn onClick={save} disabled={saving}>{saving ? "Guardando…" : "Guardar licencia"}</Btn>
      </div>
    </Modal>
  );
}
// El master edita la razón social / RFC de una empresa (se sincroniza con sus
// "Datos de la empresa"). Solo el master puede cambiar la identidad del tenant.
function EditTenantModal({ tenant, onClose, onSaved }: {
  tenant: MasterTenant; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(tenant.name);
  const [rfc, setRfc] = useState(tenant.rfc ?? "");
  const [err, setErr] = useState(""); const [saving, setSaving] = useState(false);
  async function save() {
    if (!name.trim()) { setErr("La razón social es obligatoria."); return; }
    setErr(""); setSaving(true);
    try { await api.masterUpdateTenant(tenant.id, { name: name.trim(), rfc: rfc.trim() }); onSaved(); }
    catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  }
  return (
    <Modal title={`Editar empresa — ${tenant.name}`} onClose={onClose}>
      <p className="mb-3 text-sm text-zinc-500">La razón social y el RFC alimentan los certificados de origen de la empresa. Solo el administrador de LogiQ puede cambiarlos.</p>
      <Field label="Razón social"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
      <div className="mt-3"><Field label="RFC / Tax ID"><input className={inputCls} value={rfc} onChange={(e) => setRfc(e.target.value)} /></Field></div>
      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
        <Btn onClick={save} disabled={saving}>{saving ? "Guardando…" : "Guardar"}</Btn>
      </div>
    </Modal>
  );
}

type MasterUserRow = {
  id: number; username: string; is_superuser: boolean; is_locked: boolean;
  must_change_password: boolean;
  membership: { tenant: string; tenant_id?: number; role: string; role_display: string; party: string | null } | null;
  master_scope?: { tenants: { id: number; name: string }[] } | null;
};
function UsuariosView({ me }: { me: Me }) {
  const { data, reload } = useList<MasterUserRow>(() => api.masterUsers());
  const tenants = useList<MasterTenant>(() => api.masterTenants());
  const [f, setF] = useState({ username: "", password: "", tenant: "" as number | "", role: "admin" });
  const [msg, setMsg] = useState("");
  // Empresas asignadas para el master LIMITADO (solo ve/abre esas).
  const [scopeSel, setScopeSel] = useState<number[]>([]);
  const toggleScope = (id: number) =>
    setScopeSel((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  // Última contraseña temporal generada (para mostrarla/copiarla una sola vez).
  const [temp, setTemp] = useState<{ username: string; password: string } | null>(null);
  const [scopeFor, setScopeFor] = useState<MasterUserRow | null>(null);
  const esMaster = f.role === "master";
  const esLimitado = f.role === "master_limited";
  async function create() {
    if (esLimitado) {
      // Master LIMITADO: sin superusuario; solo ve/abre sus empresas asignadas.
      if (!f.username) { setMsg("Escribe el nombre de usuario."); return; }
      if (!scopeSel.length) { setMsg("Asigna al menos una empresa al master limitado."); return; }
      try {
        const r = await api.masterCreateUser({ username: f.username, password: f.password || undefined,
          is_limited_master: true, scope_tenants: scopeSel }) as { username: string; temp_password?: string };
        if (r.temp_password) setTemp({ username: r.username, password: r.temp_password });
        setF({ username: "", password: "", tenant: "", role: "admin" }); setScopeSel([]);
        setMsg("Master limitado creado."); await reload();
      } catch (e) { setMsg((e as Error).message); }
      return;
    }
    if (esMaster) {
      // Usuario del equipo LogiQ: superusuario, sin empresa.
      if (!f.username || !f.password) { setMsg("Un usuario master necesita usuario y contraseña."); return; }
      try {
        await api.masterCreateUser({ username: f.username, password: f.password, is_superuser: true });
        setF({ username: "", password: "", tenant: "", role: "admin" }); setMsg("Usuario master creado."); await reload();
      } catch (e) { setMsg((e as Error).message); }
      return;
    }
    if (!f.username || !f.tenant) { setMsg("Usuario y empresa son obligatorios."); return; }
    try { await api.masterCreateUser(f); setF({ username: "", password: "", tenant: "", role: "admin" }); setMsg("Usuario creado."); await reload(); }
    catch (e) { setMsg((e as Error).message); }
  }
  async function unlock(id: number) {
    setMsg(""); try { await api.masterUnlockUser(id); await reload(); }
    catch (e) { setMsg((e as Error).message); }
  }
  async function resetPwd(u: { id: number; username: string }) {
    // Escribe una contraseña específica, o déjalo vacío para generar temporal.
    const pwd = prompt(tr(`Nueva contraseña para “${u.username}” (déjalo VACÍO para generar una temporal). En ambos casos deberá cambiarla en su próximo ingreso.`), "");
    if (pwd === null) return;
    setMsg("");
    try {
      const r = await api.masterResetPassword(u.id, pwd.trim() || undefined) as { username: string; temp_password: string };
      setTemp({ username: u.username, password: r.temp_password });
      await reload();
    } catch (e) { setMsg((e as Error).message); }
  }
  async function eliminar(u: MasterUserRow) {
    if (!confirm(tr(`¿Eliminar el usuario “${u.username}”? Perderá el acceso al sistema definitivamente.`))) return;
    setMsg("");
    try { await api.masterDeleteUser(u.id); if (temp?.username === u.username) setTemp(null); await reload(); }
    catch (e) { setMsg((e as Error).message); }
  }
  async function cambiarRol(u: MasterUserRow, role: string) {
    setMsg("");
    try { await api.masterSetRole(u.id, role); await reload(); }
    catch (e) { setMsg((e as Error).message); }
  }
  return (
    <div>
      <PageTitle title="Usuarios" desc="Accesos de empresas y proveedores." />
      {msg && <p className="mb-3 text-sm text-amber-600">{msg}</p>}
      {temp && (
        <div className="mb-4 max-w-xl rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
          <div className="font-semibold text-emerald-800">Contraseña temporal de “{temp.username}”</div>
          <div className="mt-1 flex items-center gap-2">
            <code className="rounded bg-white px-2 py-1 font-mono text-emerald-900 ring-1 ring-emerald-200">{temp.password}</code>
            <button onClick={() => navigator.clipboard?.writeText(temp.password)}
              className="text-xs text-emerald-700 hover:underline">Copiar</button>
          </div>
          <div className="mt-1 text-xs text-emerald-700">Cópiala y compártela con el usuario: deberá cambiarla en su próximo ingreso. No se volverá a mostrar.</div>
        </div>
      )}
      <Table head={["Usuario", "Empresa", "Rol", "Proveedor", "Estado", ""]}>
        {data.map((u) => {
          const soyYo = u.username === me.username;
          return (
          <tr key={u.id}>
            <td className="px-4 py-3 font-medium">{u.username}{soyYo && <span className="ml-1.5 text-xs text-zinc-400">(tú)</span>}</td>
            <td className="px-4 py-3">{u.membership?.tenant
              ?? (u.master_scope ? u.master_scope.tenants.map((t) => t.name).join(", ") : "—")}</td>
            <td className="px-4 py-3">
              {u.membership && u.membership.role !== "supplier" && !soyYo ? (
                <select value={u.membership.role} onChange={(e) => cambiarRol(u, e.target.value)}
                  className="rounded-lg border border-zinc-300 px-2 py-1 text-sm">
                  <option value="admin">Administrador</option>
                  <option value="analyst">Analista de origen</option>
                  <option value="auditor">Auditor (solo lectura)</option>
                </select>
              ) : u.membership ? u.membership.role_display
                : u.master_scope ? (
                  <span>Master limitado <button onClick={() => setScopeFor(u)}
                    className="ml-1 text-xs text-blue-600 hover:underline">Empresas…</button></span>
                ) : u.is_superuser ? "Master"
                : <span className="text-zinc-400">Sin membresía (huérfano)</span>}
            </td>
            <td className="px-4 py-3">{u.membership?.party ?? "—"}</td>
            <td className="px-4 py-3">
              {u.is_locked
                ? <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Bloqueado</span>
                : <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Activo</span>}
              {u.must_change_password && <span className="ml-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">contraseña temporal</span>}
            </td>
            <td className="px-4 py-3 text-right">
              <div className="flex items-center justify-end gap-1">
                {u.is_locked && <Btn size="sm" onClick={() => unlock(u.id)}>Desbloquear</Btn>}
                <Btn size="sm" variant="ghost" onClick={() => resetPwd(u)}>Cambiar contraseña</Btn>
                {!soyYo && (
                  <button onClick={() => eliminar(u)} title="Eliminar usuario"
                    className="rounded-lg p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={15} /></button>
                )}
              </div>
            </td>
          </tr>
          );
        })}
      </Table>
      {scopeFor && <MasterScopeModal user={scopeFor} tenants={tenants.data}
        onClose={() => setScopeFor(null)}
        onSaved={async () => { setScopeFor(null); await reload(); }} />}
      <Card className="mt-6 max-w-xl p-5">
        <h3 className="mb-3 font-semibold">Nuevo usuario</h3>
        <div className="grid grid-cols-2 gap-2">
          <input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} placeholder="Usuario"
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm" />
          <input value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} placeholder="Contraseña"
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm" />
          <select value={f.tenant} onChange={(e) => setF({ ...f, tenant: Number(e.target.value) })}
            disabled={esMaster}
            className={cx("rounded-lg border border-zinc-300 px-3 py-2 text-sm", esMaster && "bg-zinc-100 text-zinc-400")}>
            <option value="">{esMaster ? "— No aplica (equipo LogiQ) —" : "— Empresa —"}</option>
            {tenants.data.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm">
            <option value="admin">Administrador</option>
            <option value="analyst">Analista</option>
            <option value="auditor">Auditor</option>
            <option value="master">Master (equipo LogiQ)</option>
            <option value="master_limited">Master limitado (empresas asignadas)</option>
          </select>
        </div>
        {esLimitado && (
          <div className="mt-3">
            <div className="mb-1 text-xs font-semibold text-zinc-700">Empresas asignadas</div>
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-zinc-200 p-2">
              {tenants.data.map((t) => (
                <label key={t.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-zinc-50">
                  <input type="checkbox" checked={scopeSel.includes(t.id)} onChange={() => toggleScope(t.id)} />
                  <span>{t.name}</span>
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              Solo podrá VER y ABRIR estas empresas (administrándolas por dentro). No podrá crear,
              editar ni eliminar empresas, licencias ni usuarios globales. Sin contraseña se genera
              una temporal con cambio obligatorio.
            </p>
          </div>
        )}
        {esMaster && <p className="mt-2 text-xs text-amber-600">⚠️ Un usuario <strong>master</strong> administra TODO el sistema (empresas, licencias, usuarios) y puede abrir cualquier empresa. Crea solo los necesarios.</p>}
        <div className="mt-3"><Btn onClick={create}><Plus size={15} className="-mt-0.5 mr-1 inline" />{esMaster ? "Crear usuario master" : "Crear usuario"}</Btn></div>
      </Card>
    </div>
  );
}

/* ==== Empresas asignadas de un master limitado (edición) ==== */
function MasterScopeModal({ user, tenants, onClose, onSaved }: {
  user: MasterUserRow; tenants: MasterTenant[]; onClose: () => void; onSaved: () => void;
}) {
  const [sel, setSel] = useState<number[]>(user.master_scope?.tenants.map((t) => t.id) ?? []);
  const [err, setErr] = useState(""); const [saving, setSaving] = useState(false);
  const toggle = (id: number) =>
    setSel((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  async function save() {
    if (!sel.length) { setErr("Asigna al menos una empresa al master limitado."); return; }
    setErr(""); setSaving(true);
    try { await api.masterSetScope(user.id, sel); onSaved(); }
    catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  }
  return (
    <Modal title={`Empresas asignadas — ${user.username}`} onClose={onClose}>
      <p className="mb-3 text-sm text-zinc-500">
        Este master limitado solo podrá VER y ABRIR las empresas marcadas.
      </p>
      <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-zinc-200 p-2">
        {tenants.map((t) => (
          <label key={t.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-zinc-50">
            <input type="checkbox" checked={sel.includes(t.id)} onChange={() => toggle(t.id)} />
            <span>{t.name}</span>
          </label>
        ))}
      </div>
      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
        <Btn onClick={save} disabled={saving}>{saving ? "Guardando…" : "Guardar"}</Btn>
      </div>
    </Modal>
  );
}

/* ==== Usuarios del equipo (los gestiona el ADMIN de la empresa) ==== */
const ROLE_LEVELS: { value: string; label: string; desc: string }[] = [
  { value: "admin", label: "Administrador", desc: "Todo: opera el sistema, edita datos de la empresa y gestiona usuarios." },
  { value: "analyst", label: "Analista de origen", desc: "Opera todo (catálogos, BOM, cálculos, certificados, solicitudes) pero no gestiona usuarios." },
  { value: "auditor", label: "Auditor (solo lectura)", desc: "Consulta toda la información sin poder crearla ni modificarla." },
];
function EquipoView({ me }: { me: Me }) {
  const { data, reload } = useList<CompanyUser>(() => api.companyUsers());
  const [f, setF] = useState({ username: "", email: "", role: "analyst", password: "" });
  const [msg, setMsg] = useState(""); const [err, setErr] = useState("");
  const [temp, setTemp] = useState<{ username: string; password: string } | null>(null);
  async function crear() {
    if (!f.username.trim()) { setErr("Escribe el nombre de usuario."); return; }
    setErr(""); setMsg("");
    try {
      const r = await api.companyCreateUser({ ...f, username: f.username.trim() });
      if (r.temp_password) setTemp({ username: r.username, password: r.temp_password });
      setF({ username: "", email: "", role: "analyst", password: "" });
      setMsg(`Usuario “${r.username}” creado.`); await reload();
    } catch (e) { setErr((e as Error).message); }
  }
  async function reset(u: CompanyUser) {
    if (!confirm(tr(`¿Restablecer la contraseña de “${u.username}”? Se generará una temporal y deberá cambiarla en su próximo ingreso.`))) return;
    setErr(""); setMsg("");
    try {
      const r = await api.companyResetPassword(u.id);
      setTemp({ username: u.username, password: r.temp_password }); await reload();
    } catch (e) { setErr((e as Error).message); }
  }
  async function cambiarRol(u: CompanyUser, role: string) {
    setErr(""); setMsg("");
    try { await api.companySetRole(u.id, role); await reload(); }
    catch (e) { setErr((e as Error).message); }
  }
  async function desbloquear(u: CompanyUser) {
    setErr(""); try { await api.companyUnlockUser(u.id); await reload(); }
    catch (e) { setErr((e as Error).message); }
  }
  async function eliminar(u: CompanyUser) {
    if (!confirm(tr(`¿Quitar el acceso de “${u.username}”? Ya no podrá entrar al sistema.`))) return;
    setErr(""); setMsg("");
    try { await api.companyDeleteUser(u.id); if (temp?.username === u.username) setTemp(null); await reload(); }
    catch (e) { setErr((e as Error).message); }
  }
  return (
    <div>
      <PageTitle title="Usuarios" desc="Cuentas de tu equipo y su nivel de permisos." />
      {msg && <p className="mb-3 text-sm text-emerald-700">{msg}</p>}
      {err && <p className="mb-3 text-sm text-red-600">{err}</p>}
      {temp && (
        <div className="mb-4 max-w-xl rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
          <div className="font-semibold text-emerald-800">Contraseña temporal de “{temp.username}”</div>
          <div className="mt-1 flex items-center gap-2">
            <code className="rounded bg-white px-2 py-1 font-mono text-emerald-900 ring-1 ring-emerald-200">{temp.password}</code>
            <button onClick={() => navigator.clipboard?.writeText(temp.password)}
              className="text-xs text-emerald-700 hover:underline">Copiar</button>
          </div>
          <div className="mt-1 text-xs text-emerald-700">Cópiala y compártela con el usuario: deberá cambiarla en su primer ingreso. No se volverá a mostrar.</div>
        </div>
      )}
      <Table head={["Usuario", "Email", "Nivel", "Estado", ""]}>
        {data.map((u) => {
          const soyYo = u.username === me.username;
          return (
            <tr key={u.id}>
              <td className="px-4 py-3 font-medium">{u.username}{soyYo && <span className="ml-1.5 text-xs text-zinc-400">(tú)</span>}</td>
              <td className="px-4 py-3">{u.email || <span className="text-zinc-400">—</span>}</td>
              <td className="px-4 py-3">
                {soyYo ? u.role_display : (
                  <select value={u.role} onChange={(e) => cambiarRol(u, e.target.value)}
                    className="rounded-lg border border-zinc-300 px-2 py-1 text-sm">
                    {ROLE_LEVELS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                )}
              </td>
              <td className="px-4 py-3">
                {u.is_locked
                  ? <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Bloqueado</span>
                  : <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Activo</span>}
                {u.must_change_password && <span className="ml-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">contraseña temporal</span>}
              </td>
              <td className="px-4 py-3 text-right">
                <div className="flex items-center justify-end gap-1">
                  {u.is_locked && <Btn size="sm" onClick={() => desbloquear(u)}>Desbloquear</Btn>}
                  <Btn size="sm" variant="ghost" onClick={() => reset(u)}>Restablecer contraseña</Btn>
                  {!soyYo && (
                    <button onClick={() => eliminar(u)} title="Quitar acceso"
                      className="rounded-lg p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={15} /></button>
                  )}
                </div>
              </td>
            </tr>
          );
        })}
        {data.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-zinc-400">Aún no hay usuarios de equipo.</td></tr>}
      </Table>
      <Card className="mt-6 max-w-2xl p-5">
        <h3 className="mb-1 font-semibold">Nuevo usuario</h3>
        <p className="mb-3 text-sm text-zinc-500">
          Si no escribes contraseña se genera una <strong>temporal</strong>; en ambos casos el
          usuario deberá cambiarla en su primer ingreso.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} placeholder="Usuario"
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm" />
          <input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="Email (opcional)"
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm" />
          <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm">
            {ROLE_LEVELS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <input value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} placeholder="Contraseña (opcional: se genera temporal)"
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm" />
        </div>
        <p className="mt-2 text-xs text-zinc-500">{ROLE_LEVELS.find((r) => r.value === f.role)?.desc}</p>
        <div className="mt-3"><Btn onClick={crear}><Plus size={15} className="-mt-0.5 mr-1 inline" />Crear usuario</Btn></div>
      </Card>
      <Card className="mt-4 max-w-2xl p-4 text-sm text-zinc-600">
        <div className="font-semibold text-zinc-800">Niveles de permisos</div>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          {ROLE_LEVELS.map((r) => <li key={r.value}><strong>{r.label}:</strong> {r.desc}</li>)}
        </ul>
        <p className="mt-2 text-xs text-zinc-400">Los accesos de <strong>proveedores</strong> se crean en Catálogos → Proveedores → Crear acceso.</p>
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
// Etiqueta legible del tipo de regla de origen.
// Etiqueta del tipo de regla. Si la regla trae su NIVEL de salto (params.
// shift_level), se muestra el específico (CC/CTH/CTSH) en vez del genérico CTC.
const SHIFT_LABELS: Record<string, string> = {
  CC: "CC (cambio de capítulo)",
  CTH: "CTH (cambio de partida)",
  CTSH: "CTSH (cambio de subpartida)",
};
function ruleTypeLabel(t?: string, level?: string) {
  const shift = SHIFT_LABELS[(level ?? "").toUpperCase()];
  return ({
    CTC: shift ?? "Cambio de clasificación arancelaria (CTC)",
    RVC: "Valor de contenido regional (VCR)",
    CTC_OR_RVC: shift ? `${shift} o VCR` : "Cambio de clasificación arancelaria o VCR",
    CTC_AND_RVC: shift ? `${shift} y VCR` : "Cambio de clasificación arancelaria y VCR",
    WO: "Totalmente obtenido",
  } as Record<string, string>)[t ?? ""] ?? (t ?? "");
}
// Nivel de salto de una regla (para pasarlo a ruleTypeLabel).
function ruleShift(r?: { params?: Record<string, unknown> } | null): string {
  return String(r?.params?.shift_level ?? "");
}
// Criterio de preferencia USMCA (A–D) a partir del criterio interno del motor.
// Etiquetas en INGLÉS porque se imprimen en el certificado (fallback del
// pref_letter/pref_label que ahora manda el backend). Orientativo.
function usmcaPref(criterion?: string, status?: string): { letter: string; label: string } {
  if (status !== "QUALIFIES") return { letter: "—", label: "Origin not confirmed" };
  const c = (criterion || "").toUpperCase();
  if (c === "WO") return { letter: "A", label: "Wholly obtained or produced (Art. 4.2(a))" };
  if (c.includes("CTC") || c.includes("RVC") || c.includes("AUTOMOTRIZ"))
    return { letter: "B", label: "Meets the product-specific rule of origin (Annex 4-B)" };
  return { letter: "B", label: criterion || "Meets the applicable PSR" };
}
// Limpia la descripción de la regla (quita el marcador interno [AUTO-GN11 ...]).
function cleanRuleDesc(d?: string) {
  return (d ?? "").replace(/\[AUTO-GN11[^\]]*\]\s*/g, "").trim();
}
// Texto completo y legible de una regla para los desplegables (usa el override
// cosmético de la empresa si existe).
function ruleOptionLabel(r: OriginRule) {
  const type = r.display_type || r.rule_type;
  const desc = cleanRuleDesc(r.display_description || r.description);
  return `${formatHs(r.hs_pattern)} · ${ruleTypeLabel(type, ruleShift(r))}${desc ? " — " + desc : ""}`;
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
// Modal: histórico de cambios de precio y de país de origen de un número de parte.
function PriceHistoryModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const [logs, setLogs] = useState<ProductChangeLog[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let alive = true;
    api.productHistory(product.id)
      .then((d) => { if (alive) setLogs(d); })
      .catch((e) => { if (alive) setErr((e as Error).message); });
    return () => { alive = false; };
  }, [product.id]);
  const srcStyle: Record<string, string> = {
    manual: "bg-blue-100 text-blue-700", bulk: "bg-violet-100 text-violet-700",
    supplier: "bg-amber-100 text-amber-700",
  };
  return (
    <Modal title={`Histórico de precio y origen — ${product.sku}`} onClose={onClose}>
      <p className="mb-3 text-sm text-zinc-500">{product.description}</p>
      {err && <p className="text-sm text-red-600">{err}</p>}
      {!logs && !err && <p className="text-sm text-zinc-400">Cargando…</p>}
      {logs && logs.length === 0 && (
        <p className="text-sm text-zinc-400">Sin cambios registrados. El histórico se irá llenando conforme actualices el precio o el país de origen (manualmente, por carga masiva o cuando el proveedor lo defina).</p>
      )}
      {logs && logs.length > 0 && (
        <ul className="space-y-2 text-sm">
          {logs.map((l, i) => (
            <li key={i} className="rounded-lg border border-zinc-200 p-2 dark:border-zinc-700">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cx("rounded-full px-2 py-0.5 text-xs font-medium",
                  l.kind === "price" ? "bg-emerald-100 text-emerald-700" : "bg-sky-100 text-sky-700")}>
                  {l.kind_display}
                </span>
                <span className="font-mono">{l.old_value || "—"} → <strong>{l.new_value || "—"}</strong></span>
                {l.kind === "price" && l.old_price != null && l.new_price != null && (
                  <PriceDelta from={Number(l.old_price)} to={Number(l.new_price)} />
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                <span className={cx("rounded px-1.5 py-0.5", srcStyle[l.source] ?? "bg-zinc-100 text-zinc-600")}>{l.source_display}</span>
                <span>{l.created_at?.slice(0, 10)}</span>
                {l.changed_by && <span>· {l.changed_by}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-5 flex justify-end"><Btn variant="ghost" onClick={onClose}>Cerrar</Btn></div>
    </Modal>
  );
}
// Variación porcentual entre dos precios (verde si baja, rojo si sube).
function PriceDelta({ from, to }: { from: number; to: number }) {
  if (!from) return null;
  const pct = ((to - from) / from) * 100;
  const up = to > from;
  return (
    <span className={cx("text-xs font-medium", up ? "text-red-600" : "text-emerald-600")}>
      {up ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}%
    </span>
  );
}
const RULE_TYPES = [
  { value: "CTC", label: "Cambio de clasificación arancelaria (CTC)" },
  { value: "RVC", label: "Valor de contenido regional (VCR)" },
  { value: "CTC_OR_RVC", label: "CTC o VCR" },
  { value: "CTC_AND_RVC", label: "CTC y VCR" },
  { value: "WO", label: "Totalmente obtenido" },
];
function ReglasView({ me }: { me: Me }) {
  const esMaster = me.role === "master";
  const treaties = useList<Treaty>(() => api.treaties());
  const [treaty, setTreaty] = useState<number | "">("");
  const [hs, setHs] = useState("");
  const [pageSize, setPageSize] = useState("50");
  const [editing, setEditing] = useState<OriginRule | "new" | null>(null);
  const [display, setDisplay] = useState<OriginRule | null>(null);
  const [msg, setMsg] = useState("");
  const buildParams = () => {
    const p = new URLSearchParams();
    p.set("page_size", pageSize === "all" ? "5000" : pageSize);
    if (treaty !== "") p.set("treaty", String(treaty));
    if (hs.trim()) p.set("q", hs.trim());
    return "?" + p.toString();
  };
  const { data, count, loading, reload } = useList<OriginRule>(
    () => api.rules(buildParams()), [treaty, hs, pageSize]);
  async function del(r: OriginRule) {
    if (!confirm(tr(`¿Eliminar la regla ${formatHs(r.hs_pattern)}?`))) return;
    setMsg(""); try { await api.deleteRule(r.id); await reload(); } catch (e) { setMsg((e as Error).message); }
  }
  function exportar() {
    exportCSV("reglas_de_origen", ["Tratado", "HS", "Tipo", "Descripción"],
      data.map((r) => [r.treaty_label ?? r.treaty_code ?? "", r.hs_pattern || "General",
        ruleTypeLabel(r.display_type || r.rule_type, ruleShift(r)), cleanRuleDesc(r.display_description || r.description)]));
  }
  return (
    <div>
      <PageTitle title="Reglas de origen"
        desc={esMaster ? `${count} reglas oficiales · administra el catálogo.`
          : `${count} reglas · puedes personalizar cómo aparecen (no cambia el cálculo).`} />
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
            <option value="50">50</option><option value="100">100</option><option value="all">Todo</option>
          </select>
        </div>
        <div className="ml-auto flex gap-2">
          <Btn variant="ghost" onClick={exportar}><Download size={14} className="-mt-0.5 mr-1 inline" />Exportar a Excel</Btn>
          {esMaster && <Btn onClick={() => setEditing("new")}><Plus size={15} className="-mt-0.5 mr-1 inline" />Nueva regla</Btn>}
        </div>
      </div>
      {msg && <p className="mb-3 text-sm text-amber-600">{msg}</p>}
      <Table head={["Tratado", "HS", "Tipo", "Descripción", ""]}>
        {data.map((r) => (
          <tr key={r.id}>
            <td className="px-4 py-3"><span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700">{r.treaty_label ?? r.treaty_code}</span></td>
            <td className="px-4 py-3 font-mono text-xs font-semibold">{r.hs_pattern ? (r.hs_pattern.includes("-") ? r.hs_pattern.split("-").map((x) => formatHs(x)).join(" – ") : formatHs(r.hs_pattern)) : <span className="rounded-full bg-amber-100 px-2 py-0.5 font-sans text-[11px] font-medium text-amber-700">General</span>}</td>
            <td className="px-4 py-3">
              <Pill>{ruleTypeLabel(r.display_type || r.rule_type, ruleShift(r))}</Pill>
              {r.has_override && <span className="ml-1 rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-700">personalizado</span>}
            </td>
            <td className="px-4 py-3 text-zinc-600">{cleanRuleDesc(r.display_description || r.description)}</td>
            <td className="px-4 py-3 text-right whitespace-nowrap">
              {esMaster ? (
                <>
                  <button onClick={() => setEditing(r)} title="Editar" className="mr-1 rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-blue-600"><Pencil size={15} /></button>
                  <button onClick={() => del(r)} title="Eliminar" className="rounded-lg p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={15} /></button>
                </>
              ) : (
                <Btn size="sm" variant="ghost" onClick={() => setDisplay(r)}>Cómo aparece</Btn>
              )}
            </td>
          </tr>
        ))}
        {!loading && data.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-zinc-400">Sin reglas para ese filtro.</td></tr>}
      </Table>
      {editing && <RuleForm rule={editing === "new" ? null : editing} treaties={treaties.data}
        onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await reload(); }} />}
      {display && <RuleDisplayModal rule={display}
        onClose={() => setDisplay(null)} onSaved={async () => { setDisplay(null); await reload(); }} />}
    </div>
  );
}
// Admin: crear/editar una regla oficial.
function RuleForm({ rule, treaties, onClose, onSaved }: {
  rule: OriginRule | null; treaties: Treaty[]; onClose: () => void; onSaved: () => void;
}) {
  const p = (rule?.params ?? {}) as Record<string, unknown>;
  const [f, setF] = useState({
    treaty: (rule?.treaty ?? "") as number | "",
    hs_pattern: rule?.hs_pattern ?? "", rule_type: rule?.rule_type ?? "CTC",
    shift_level: String(p.shift_level ?? "CTH"),
    rvc_threshold: String(p.rvc_threshold ?? ""), de_minimis: String(p.de_minimis ?? ""),
    description: rule?.description ?? "",
  });
  const [err, setErr] = useState(""); const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f, v: string | number) => setF({ ...f, [k]: v });
  async function save() {
    if (f.treaty === "" || !f.hs_pattern.trim()) { setErr("Tratado y fracción HS son obligatorios."); return; }
    const params: Record<string, unknown> = {};
    if (["CTC", "CTC_OR_RVC", "CTC_AND_RVC"].includes(f.rule_type)) params.shift_level = f.shift_level;
    if (["RVC", "CTC_OR_RVC", "CTC_AND_RVC"].includes(f.rule_type) && f.rvc_threshold) params.rvc_threshold = Number(f.rvc_threshold);
    if (f.de_minimis) params.de_minimis = Number(f.de_minimis);
    const payload = { treaty: Number(f.treaty), hs_pattern: f.hs_pattern.replace(/\D/g, ""), rule_type: f.rule_type, params, description: f.description };
    setErr(""); setSaving(true);
    try { if (rule) await api.updateRule(rule.id, payload); else await api.createRule(payload); onSaved(); }
    catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  }
  const ctc = ["CTC", "CTC_OR_RVC", "CTC_AND_RVC"].includes(f.rule_type);
  const rvc = ["RVC", "CTC_OR_RVC", "CTC_AND_RVC"].includes(f.rule_type);
  return (
    <Modal title={rule ? "Editar regla de origen" : "Nueva regla de origen"} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tratado">
          <select value={f.treaty} onChange={(e) => set("treaty", Number(e.target.value))} className={inputCls}>
            <option value="">— Tratado —</option>
            {treaties.map((t) => <option key={t.id} value={t.id}>{treatyLabel(t.code)}</option>)}
          </select>
        </Field>
        <Field label="Fracción HS (patrón)"><HsInput value={f.hs_pattern} onChange={(v) => set("hs_pattern", v)} /></Field>
        <div className="col-span-2"><Field label="Tipo de regla">
          <select value={f.rule_type} onChange={(e) => set("rule_type", e.target.value)} className={inputCls}>
            {RULE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select></Field></div>
        {ctc && <Field label="Nivel de salto">
          <select value={f.shift_level} onChange={(e) => set("shift_level", e.target.value)} className={inputCls}>
            <option value="CC">CC (cambio de capítulo)</option>
            <option value="CTH">CTH (cambio de partida)</option>
            <option value="CTSH">CTSH (cambio de subpartida)</option>
          </select></Field>}
        {rvc && <Field label="Umbral VCR (%)"><input type="number" value={f.rvc_threshold} onChange={(e) => set("rvc_threshold", e.target.value)} className={inputCls} placeholder="60" /></Field>}
        <Field label="De minimis (%)"><input type="number" value={f.de_minimis} onChange={(e) => set("de_minimis", e.target.value)} className={inputCls} placeholder="10" /></Field>
        <div className="col-span-2"><Field label="Descripción">
          <input value={f.description} onChange={(e) => set("description", e.target.value)} className={inputCls} /></Field></div>
      </div>
      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
        <Btn onClick={save} disabled={saving}>{saving ? "Guardando…" : rule ? "Guardar" : "Crear regla"}</Btn>
      </div>
    </Modal>
  );
}
// Empresa: personalizar cómo aparece una regla (cosmético).
function RuleDisplayModal({ rule, onClose, onSaved }: {
  rule: OriginRule; onClose: () => void; onSaved: () => void;
}) {
  const [t, setT] = useState(rule.has_override ? (rule.display_type ?? "") : "");
  const [d, setD] = useState(rule.has_override ? (rule.display_description ?? "") : "");
  const [err, setErr] = useState(""); const [saving, setSaving] = useState(false);
  async function save() {
    setErr(""); setSaving(true);
    try { await api.setRuleDisplay(rule.id, t, d); onSaved(); } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  }
  async function reset() {
    setSaving(true);
    try { await api.resetRuleDisplay(rule.id); onSaved(); } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  }
  return (
    <Modal title={`Cómo aparece — ${formatHs(rule.hs_pattern)}`} onClose={onClose}>
      <p className="mb-3 text-sm text-zinc-500">
        Personaliza cómo se muestra este PSR en tu empresa (ej. usar <strong>CTH</strong> en vez de <strong>CC</strong>).
        Es <strong>solo cosmético</strong>: el cálculo de origen siempre usa la regla oficial.
      </p>
      <div className="mb-2 text-xs text-zinc-500">Oficial: <strong>{ruleTypeLabel(rule.rule_type, ruleShift(rule))}</strong> — {cleanRuleDesc(rule.description)}</div>
      <Field label="Tipo/código a mostrar (déjalo vacío para el oficial)">
        <input value={t} onChange={(e) => setT(e.target.value)} className={inputCls} placeholder="ej. CTH" />
      </Field>
      <div className="mt-3"><Field label="Descripción a mostrar (opcional)">
        <input value={d} onChange={(e) => setD(e.target.value)} className={inputCls} /></Field></div>
      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
      <div className="mt-5 flex justify-between">
        <Btn variant="ghost" onClick={reset} disabled={saving}>Restablecer al oficial</Btn>
        <div className="flex gap-2">
          <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
          <Btn onClick={save} disabled={saving}>{saving ? "Guardando…" : "Guardar"}</Btn>
        </div>
      </div>
    </Modal>
  );
}

/* ============ EMPRESA ============ */
function ProductosView() {
  const { data, reload, loading } = useList<Product>(() => api.products());
  const parties = useList<{ id: number; name: string; kind: string }>(() => api.parties());
  // Calificaciones (cálculos de origen) para el badge Calculado / Sin cálculo.
  const qualsL = useList<Qualification>(() => api.qualifications());
  const treatiesL = useList<Treaty>(() => api.treaties());
  const [treatyFilter, setTreatyFilter] = useState<number | "">("");
  const [msg, setMsg] = useState("");
  const [busq, setBusq] = useState("");
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [bomFor, setBomFor] = useState<Product | null>(null);
  const [bulk, setBulk] = useState<"products" | "bom" | null>(null);
  async function del(p: Product) {
    if (!confirm(tr(`¿Eliminar el producto “${p.sku}”?`))) return;
    setMsg(""); try { await api.deleteProduct(p.id); await reload(); }
    catch (e) { setMsg((e as Error).message); }
  }
  const suppliers = parties.data.filter((p) => p.kind === "supplier");
  // Calificaciones por producto (todas, o solo las del tratado filtrado).
  const qualsDe = (pid: number) =>
    qualsL.data.filter((q) => q.product === pid && (treatyFilter === "" || q.treaty === Number(treatyFilter)));
  // En "Productos" solo los terminados/subensambles; los insumos van en "Números de parte".
  const visibles = smartFilter(data.filter((p) => p.kind !== "material"), busq, (p) => [p.sku, p.description, p.hs_code]);
  const money = (v?: string, cur?: string) =>
    v != null && Number(v) > 0 ? `${Number(v).toLocaleString("es-MX")} ${cur ?? ""}`.trim() : "—";
  function exportar() {
    exportCSV("productos", ["Núm. de parte", "Descripción", "Tipo", "HS", "Cálculo de origen", "Precio", "Moneda", "Mano de obra/conversión"],
      visibles.map((p) => [p.sku, p.description, p.kind_display ?? p.kind, p.hs_code ?? "",
        qualsDe(p.id).length ? "Calculado" : "Sin cálculo",
        p.unit_cost ?? "", p.currency ?? "", p.conversion_cost ?? ""]));
  }
  return (
    <div>
      <PageTitle title="Productos terminados" desc="Ficha de tus productos: fracción (HS), costos, mano de obra y BOM. Para calificarlos ve a “Cálculo de origen”; para pedir origen a proveedores, a “Solicitudes”." />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="min-w-[16rem]">
          <span className="mb-1 block text-xs font-semibold text-zinc-700">Ver cálculo por tratado</span>
          <select value={treatyFilter} onChange={(e) => setTreatyFilter(e.target.value ? Number(e.target.value) : "")} className={inputCls}>
            <option value="">Todos los tratados</option>
            {treatiesL.data.map((t) => <option key={t.id} value={t.id}>{treatyLabel(t.code)} — {t.name}</option>)}
          </select>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <Btn variant="ghost" onClick={() => setBulk("products")}><Upload size={15} className="-mt-0.5 mr-1 inline" />Carga masiva</Btn>
          <Btn variant="ghost" onClick={() => setBulk("bom")}><Upload size={15} className="-mt-0.5 mr-1 inline" />BOM masivo</Btn>
          <Btn onClick={() => setEditing("new")}><Plus size={15} className="-mt-0.5 mr-1 inline" />Nuevo producto</Btn>
        </div>
      </div>
      {msg && <p className="mb-3 text-sm text-amber-600">{msg}</p>}
      <ReportToolbar q={busq} setQ={setBusq} onExport={exportar} placeholder="Buscar producto… (número de parte o descripción)" />
      <Table head={["Núm. de parte", "Descripción", "Tipo", "HS", "Cálculo de origen", "Precio", "Mano de obra", ""]}>
        {visibles.map((p) => {
          const qs = qualsDe(p.id);
          return (
          <tr key={p.id}>
            <td className="px-4 py-3 font-mono text-xs">{p.sku}</td>
            <td className="px-4 py-3">{p.description}</td>
            <td className="px-4 py-3 text-xs text-zinc-500">{p.kind_display ?? p.kind}</td>
            <td className="px-4 py-3 font-mono text-xs">{formatHs(p.hs_code)}</td>
            <td className="px-4 py-3">
              {qs.length ? (
                <>
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">Calculado</span>
                  <div className="mt-0.5 text-[11px] text-zinc-500">
                    {treatyFilter === ""
                      ? qs.map((q) => q.treaty_code ? treatyLabel(q.treaty_code) : "").filter(Boolean).join(", ")
                      : <>{qs[0].status_display}{qs[0].rvc_value ? ` · VCR ${qs[0].rvc_value}%` : ""}{qs[0].is_stale ? " ⚠️" : ""}</>}
                  </div>
                </>
              ) : (
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500">Sin cálculo</span>
              )}
            </td>
            <td className="px-4 py-3 text-xs">{money(p.unit_cost, p.currency)}</td>
            <td className="px-4 py-3 text-xs">{money(p.conversion_cost, p.currency)}</td>
            <td className="px-4 py-3 text-right whitespace-nowrap">
              <span className="mr-2 inline-block"><Btn size="sm" variant="ghost" onClick={() => setBomFor(p)}>BOM</Btn></span>
              <button onClick={() => setEditing(p)} title="Editar"
                className="mr-1 rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-blue-600"><Pencil size={15} /></button>
              <button onClick={() => del(p)} title="Eliminar"
                className="rounded-lg p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={15} /></button>
            </td>
          </tr>
          );
        })}
        {!loading && visibles.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-zinc-400">Aún no tienes productos terminados. Crea el primero con “Nuevo producto”.</td></tr>}
      </Table>
      {editing && (
        <ProductForm product={editing === "new" ? null : editing} suppliers={suppliers}
          onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await reload(); }} />
      )}
      {bomFor && <BomEditorModal product={bomFor} allProducts={data} onClose={() => setBomFor(null)} />}
      {bulk === "products" && (
        <CargaMasivaModal specType="products" title="Carga masiva de productos / números de parte" onClose={() => setBulk(null)} onDone={reload}
          hint="Da de alta o actualiza muchos productos a la vez (incluye terminados con la columna 'tipo' = terminado). Los que YA existen se actualizan por SKU exacto; los nuevos se crean."
          templateFn={() => api.bulkTemplate("products")} importFn={(f) => api.bulkImport("products", f)} previewFn={(f) => api.bulkPreview("products", f)} />
      )}
      {bulk === "bom" && (
        <CargaMasivaModal specType="bom" title="Carga masiva de BOM" onClose={() => setBulk(null)} onDone={reload}
          hint="Arma las listas de materiales en lote: cada fila liga un producto (padre) con un insumo (componente) por SKU. Incluye unidad de medida y país de origen opcional."
          templateFn={() => api.bulkTemplate("bom")} importFn={(f) => api.bulkImport("bom", f)} />
      )}
    </div>
  );
}

// Editor de la lista de materiales (BOM) de un producto de la empresa.
function BomEditorModal({ product, allProducts, onClose }: {
  product: Product; allProducts: Product[]; onClose: () => void;
}) {
  const { data, reload, loading } = useList<BomComponent>(() => api.bomComponents(product.id));
  const [compId, setCompId] = useState<number | "">("");
  const [qty, setQty] = useState("1");
  const [uom, setUom] = useState("");
  const [err, setErr] = useState(""); const [saving, setSaving] = useState(false);
  // País por insumo (local, para escribir fluido; se guarda al salir del campo).
  const [pais, setPais] = useState<Record<number, string>>({});
  useEffect(() => { setPais(Object.fromEntries(data.map((c) => [c.id, c.manual_country || ""]))); }, [data]);
  // Insumos disponibles: cualquier producto del catálogo distinto del padre y
  // que no esté ya en el BOM.
  const usados = new Set(data.map((c) => c.component));
  const opciones = allProducts
    .filter((p) => p.id !== product.id && !usados.has(p.id))
    .slice().sort((a, b) => (a.sku || "").localeCompare(b.sku || "", "es", { numeric: true, sensitivity: "base" }));
  async function add() {
    if (!compId) { setErr("Elige un insumo."); return; }
    setErr(""); setSaving(true);
    try {
      await api.addBomComponent({ parent: product.id, component: compId, quantity: qty || "1", uom });
      setCompId(""); setQty("1"); setUom(""); await reload();
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  }
  async function setUomManual(c: BomComponent, value: string) {
    try { await api.updateBomComponent(c.id, { uom: value }); await reload(); }
    catch (e) { setErr((e as Error).message); }
  }
  async function quitar(c: BomComponent) {
    if (!confirm(tr(`¿Quitar “${c.component_sku}” del BOM?`))) return;
    try { await api.deleteBomComponent(c.id); await reload(); }
    catch (e) { setErr((e as Error).message); }
  }
  async function setPaisManual(c: BomComponent, country: string) {
    try { await api.updateBomComponent(c.id, { origin_mode: "manual", manual_country: country.toUpperCase() }); await reload(); }
    catch (e) { setErr((e as Error).message); }
  }
  async function usarDeclaracion(c: BomComponent) {
    // Vuelve a modo "declaración del proveedor": el país/origen se toma de la
    // declaración vigente del tratado al calcular.
    try { await api.updateBomComponent(c.id, { origin_mode: "supplier", manual_country: "" }); await reload(); }
    catch (e) { setErr((e as Error).message); }
  }
  return (
    <Modal title={`Lista de materiales — ${product.sku}`} onClose={onClose} wide>
      <p className="mb-3 text-sm text-zinc-500">Agrega los insumos que componen este producto. Por cada uno define el <strong>país de origen</strong>: a mano, o tráelo de una declaración del proveedor. El país determina el origen al calcular según cada tratado.</p>
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div className="min-w-[16rem] flex-1">
          <span className="mb-1 block text-xs font-semibold text-zinc-700">Insumo</span>
          <select value={compId} onChange={(e) => setCompId(e.target.value ? Number(e.target.value) : "")} className={inputCls}>
            <option value="">Elige un insumo…</option>
            {opciones.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.description}{p.supplier_name ? ` (${p.supplier_name})` : ""}</option>)}
          </select>
        </div>
        <div className="w-28">
          <span className="mb-1 block text-xs font-semibold text-zinc-700">Cantidad</span>
          <input className={inputCls} type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} />
        </div>
        <div className="w-36">
          <span className="mb-1 block text-xs font-semibold text-zinc-700">Unidad de medida</span>
          <UomSelect value={uom} onChange={setUom} className={inputCls} />
        </div>
        <Btn onClick={add} disabled={saving}><Plus size={15} className="-mt-0.5 mr-1 inline" />Agregar</Btn>
      </div>
      {err && <p className="mb-2 text-sm text-red-600">{err}</p>}
      <Table head={["Núm. de parte", "Descripción", "Proveedor", "Cant.", "U.M.", "País de origen", ""]}>
        {data.map((c) => {
          const decls = c.component_declarations ?? [];
          const enDeclaracion = c.origin_mode === "supplier";
          return (
            <tr key={c.id} className="align-top">
              <td className="px-4 py-3 font-mono text-xs">{c.component_sku}<div className="text-[11px] text-zinc-400">HS {c.component_hs ? formatHs(c.component_hs) : "—"}</div></td>
              <td className="px-4 py-3">{c.component_description}</td>
              <td className="px-4 py-3 text-xs">{c.component_supplier_name ?? "—"}</td>
              <td className="px-4 py-3 text-xs">{c.quantity}</td>
              <td className="px-4 py-3">
                <UomSelect value={c.uom ?? ""} onChange={(v) => setUomManual(c, v)}
                  className="rounded-lg border border-zinc-300 px-2 py-1 text-xs" />
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <input value={pais[c.id] ?? ""} maxLength={2} placeholder="País"
                    onChange={(e) => setPais((m) => ({ ...m, [c.id]: e.target.value.replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 2) }))}
                    onBlur={() => { const v = pais[c.id] ?? ""; if (v !== (c.manual_country || "") || enDeclaracion) setPaisManual(c, v); }}
                    className={cx("w-20 rounded-lg border px-2 py-1 text-xs uppercase", enDeclaracion ? "border-zinc-200 bg-zinc-50 text-zinc-400" : "border-zinc-300")} />
                  {decls.length > 0 && (
                    <select value="" onChange={(e) => { if (e.target.value) setPaisManual(c, e.target.value); }}
                      className="rounded-lg border border-zinc-300 px-2 py-1 text-xs">
                      <option value="">Traer de declaración…</option>
                      {decls.map((d, i) => (
                        <option key={i} value={d.country}>
                          {treatyLabel(d.treaty_code)} · {d.valid_from} → {d.valid_to} · {d.country || "—"} ({d.is_originating ? "orig." : "no orig."})
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                {enDeclaracion
                  ? <div className="mt-1 text-[11px] text-zinc-400">Tomando origen de la declaración del proveedor al calcular.</div>
                  : <button onClick={() => usarDeclaracion(c)} className="mt-1 text-[11px] text-blue-600 hover:underline">Usar declaración del proveedor</button>}
              </td>
              <td className="px-4 py-3 text-right">
                <button onClick={() => quitar(c)} title="Quitar" className="rounded-lg p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={15} /></button>
              </td>
            </tr>
          );
        })}
        {!loading && data.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-zinc-400">Sin insumos en el BOM. Agrega el primero arriba.</td></tr>}
      </Table>
    </Modal>
  );
}

// Modal reutilizable de carga masiva por Excel (.xlsx).
function CargaMasivaModal({ title, hint, specType, onClose, onDone, templateFn, importFn, previewFn }: {
  title: string; hint?: string; specType?: string; onClose: () => void; onDone: () => void;
  templateFn: () => Promise<void>; importFn: (file: File) => Promise<unknown>;
  previewFn?: (file: File) => Promise<BulkPreview>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<BulkResult | null>(null);
  const [ok, setOk] = useState(false);
  const [preview, setPreview] = useState<BulkPreview | null>(null);
  // Especificación del layout: qué va en cada columna (misma fuente que la
  // hoja "Instrucciones" de la plantilla, pero visible aquí sin descargar).
  const [spec, setSpec] = useState<BulkSpec | null>(null);
  const [specOpen, setSpecOpen] = useState(false);
  useEffect(() => {
    if (!specType) return;
    let alive = true;
    api.bulkSpec(specType).then((sp) => { if (alive) setSpec(sp); }).catch(() => {});
    return () => { alive = false; };
  }, [specType]);
  async function descargar() {
    setErr(""); try { await templateFn(); } catch (e) { setErr((e as Error).message); }
  }
  async function doImport(f: File) {
    setBusy(true); setErr(""); setResult(null); setOk(false); setPreview(null);
    try {
      const r = await importFn(f);
      if (r && typeof (r as BulkResult).creados === "number") setResult(r as BulkResult);
      else setOk(true);
      onDone();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function importar() {
    if (!file) { setErr("Elige un archivo .xlsx o .csv."); return; }
    // Si hay previsualización, primero avisamos cuántos ya existen.
    if (previewFn) {
      setBusy(true); setErr(""); setResult(null); setOk(false);
      try {
        const pv = await previewFn(file);
        if (pv.existentes > 0) { setPreview(pv); setBusy(false); return; }
      } catch (e) { setErr((e as Error).message); setBusy(false); return; }
    }
    await doImport(file);
  }
  return (
    <Modal title={title} onClose={onClose} wide>
      {hint && <p className="mb-3 text-sm text-zinc-500">{hint}</p>}
      {spec && (
        <div className="mb-4 overflow-hidden rounded-lg border border-zinc-200">
          <button onClick={() => setSpecOpen(!specOpen)}
            className="flex w-full items-center justify-between bg-zinc-50 px-3 py-2 text-left text-sm font-semibold text-zinc-700 hover:bg-zinc-100">
            <span>📋 ¿Qué va en cada columna del Excel?</span>
            <ChevronDown size={15} className={cx("transition-transform", specOpen && "rotate-180")} />
          </button>
          {specOpen && (
            <div className="p-3">
              {spec.instructions.length > 0 && (
                <ul className="mb-3 list-disc space-y-0.5 pl-5 text-xs text-zinc-600">
                  {spec.instructions.map((p, i) => <li key={i}>{p}</li>)}
                </ul>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-zinc-200 text-left text-zinc-500">
                      <th className="py-1.5 pr-3 font-semibold">Columna</th>
                      <th className="py-1.5 pr-3 font-semibold">¿Obligatoria?</th>
                      <th className="py-1.5 pr-3 font-semibold">Qué va</th>
                      <th className="py-1.5 font-semibold">Ejemplo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {spec.columns.map((c) => (
                      <tr key={c.key} className="border-b border-zinc-100 align-top last:border-0">
                        <td className="py-1.5 pr-3 font-medium text-zinc-800">{c.label}</td>
                        <td className="py-1.5 pr-3">
                          {c.required
                            ? <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">Sí</span>
                            : <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] text-zinc-500">Opcional</span>}
                        </td>
                        <td className="py-1.5 pr-3 text-zinc-600">{c.help}</td>
                        <td className="py-1.5 font-mono text-[11px] text-zinc-500">{c.example}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[11px] text-zinc-400">
                La misma explicación viene dentro de la plantilla (hoja «Instrucciones») y en el
                comentario de cada encabezado del Excel.
              </p>
            </div>
          )}
        </div>
      )}
      <ol className="space-y-3 text-sm">
        <li className="flex items-center gap-3">
          <span className="grid h-6 w-6 place-items-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">1</span>
          <span>Descarga la plantilla, llénala en Excel y guárdala.</span>
          <Btn size="sm" variant="ghost" onClick={descargar}>Descargar plantilla</Btn>
        </li>
        <li className="flex items-center gap-3">
          <span className="grid h-6 w-6 place-items-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">2</span>
          <span>Elige el archivo:</span>
          <input type="file" accept=".xlsx,.csv" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); setResult(null); setOk(false); }}
            className="text-sm text-zinc-600 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-blue-700 hover:file:bg-blue-100" />
        </li>
        <li className="flex items-center gap-3">
          <span className="grid h-6 w-6 place-items-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">3</span>
          <Btn size="sm" onClick={importar} disabled={busy || !file}>{busy ? "Procesando…" : "Importar"}</Btn>
        </li>
      </ol>
      {preview && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          ⚠️ En el Excel hay <strong>{preview.existentes}</strong> número(s) de parte que <strong>ya están en el sistema</strong>: se <strong>actualizarán</strong> sus datos (precio, descripción, HS, país, proveedor…) con lo que traiga el archivo, sin duplicarlos.
          {preview.nuevos > 0 && <> Además se agregarán <strong>{preview.nuevos}</strong> nuevos.</>} ¿Deseas continuar?
          {preview.existentes_skus.length > 0 && (
            <div className="mt-1 text-xs text-amber-700">Ya existen: {preview.existentes_skus.join(", ")}{preview.existentes > preview.existentes_skus.length ? "…" : ""}</div>
          )}
          {(preview.duplicados ?? 0) > 0 && (
            <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
              ⚠️ <strong>{preview.duplicados} número(s) de parte vienen REPETIDOS</strong> en el archivo; se importará solo la primera fila de cada uno. Deja un solo renglón por número de parte: <span className="font-mono">{(preview.duplicados_skus ?? []).join(", ")}</span>
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <Btn size="sm" onClick={() => file && doImport(file)} disabled={busy}>{busy ? "Cargando…" : `Sí, actualizar ${preview.existentes}${preview.nuevos > 0 ? ` y agregar ${preview.nuevos}` : ""}`}</Btn>
            <Btn size="sm" variant="ghost" onClick={() => setPreview(null)}>Cancelar</Btn>
          </div>
        </div>
      )}
      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
      {ok && <p className="mt-3 text-sm text-emerald-700">✓ Cargado correctamente.</p>}
      {result && (
        <div className="mt-4 rounded-lg border border-zinc-200 p-3 text-sm">
          <div className="text-emerald-700">✓ {result.creados} creados{(result.omitidos ?? 0) > 0 ? ` · ${result.omitidos} ya existían (omitidos)` : ""}{result.actualizados > 0 ? ` · ${result.actualizados} actualizados` : ""}</div>
          {result.errores.length > 0 && (
            <div className="mt-2">
              <div className="font-semibold text-red-700">{result.errores.length} fila(s) con error:</div>
              <ul className="mt-1 max-h-40 overflow-auto text-xs text-red-600">
                {result.errores.map((e, i) => <li key={i}>Fila {e.fila}: {e.error}</li>)}
              </ul>
            </div>
          )}
          {(result.advertencias?.length ?? 0) > 0 && (
            <div className="mt-2">
              <div className="font-semibold text-amber-700">{result.advertencias!.length} advertencia(s):</div>
              <ul className="mt-1 max-h-40 overflow-auto text-xs text-amber-700">
                {result.advertencias!.map((e, i) => <li key={i}>Fila {e.fila}: {e.error}</li>)}
              </ul>
            </div>
          )}
          {(result.duplicados_skus?.length ?? 0) > 0 && (
            <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2">
              <div className="font-semibold text-red-700">{result.duplicados_skus!.length} número(s) de parte venían REPETIDOS (se usó la primera fila de cada uno):</div>
              <div className="mt-1 max-h-32 overflow-auto font-mono text-xs text-red-600">{result.duplicados_skus!.join(", ")}</div>
            </div>
          )}
          {(result.sin_precio_skus?.length ?? 0) > 0 && (
            <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2">
              <div className="font-semibold text-amber-800">{result.sin_precio_skus!.length} número(s) de parte quedaron SIN precio (su fila no traía costo):</div>
              <div className="mt-1 max-h-32 overflow-auto font-mono text-xs text-amber-700">{result.sin_precio_skus!.join(", ")}</div>
              <div className="mt-1 text-[11px] text-amber-700">Revisa la columna “Costo unitario” de esas filas en tu Excel y vuelve a subir.</div>
            </div>
          )}
          {((result.actualizados_skus?.length ?? 0) > 0 || (result.creados_skus?.length ?? 0) > 0) && (
            <details className="mt-2 text-xs text-zinc-500">
              <summary className="cursor-pointer">Ver detalle por número de parte</summary>
              {(result.actualizados_skus?.length ?? 0) > 0 && (
                <div className="mt-1"><span className="font-semibold text-zinc-600">Actualizados:</span> <span className="font-mono">{result.actualizados_skus!.join(", ")}</span></div>
              )}
              {(result.creados_skus?.length ?? 0) > 0 && (
                <div className="mt-1"><span className="font-semibold text-zinc-600">Creados:</span> <span className="font-mono">{result.creados_skus!.join(", ")}</span></div>
              )}
            </details>
          )}
        </div>
      )}
      <div className="mt-5 flex justify-end"><Btn variant="ghost" onClick={onClose}>Cerrar</Btn></div>
    </Modal>
  );
}

// Reporte del resultado del cálculo de origen del producto de la empresa.
function OriginResultReport({ result }: { result: OriginCalcResult }) {
  const d = (result.detail ?? {}) as {
    error?: string; rule?: string; automotive_regime?: string; automotive_core?: string;
    bom?: { sku: string; originating: boolean; origin_source: string; line_value: string; country: string }[];
    tariff_shift?: { shift_level: string; violating_value: string; violating_pct: string; de_minimis: string; except_codes?: string[]; components: { sku: string; shifted: boolean; in_exception?: boolean }[] };
    rvc?: { method: string; threshold: string; rvc: string; vnm: string; transaction_value: string };
  };
  const review = result.status === "AUTO_REVIEW";
  const ok = result.status === "QUALIFIES";
  const insf = result.status === "INSUFFICIENT";
  return (
    <div className="mt-4 rounded-lg border border-zinc-200 p-3">
      <div className="flex items-center gap-2">
        <span className={cx("rounded-full px-2.5 py-0.5 text-sm font-semibold",
          ok ? "bg-green-100 text-green-700" : (insf || review) ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700")}>
          {ok ? "Originario: SÍ" : review ? "Requiere régimen automotriz" : insf ? "Datos insuficientes" : "Originario: NO"}
        </span>
        {result.criterion && <span className="text-xs text-zinc-500">Criterio: <strong>{result.criterion}</strong></span>}
        {result.rvc_value != null && <span className="text-xs text-zinc-500">VCR: <strong>{result.rvc_value}%</strong></span>}
      </div>
      {d.automotive_core && <div className="mt-3"><AutoReviewBox /></div>}
      {d.error && <p className="mt-2 text-sm text-amber-700">{d.error}</p>}
      {d.rule && <p className="mt-2 text-xs text-zinc-500">Regla aplicada: <strong>{d.rule}</strong></p>}
      {d.automotive_regime && (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
          🚗 <strong>Régimen automotriz.</strong> {d.automotive_regime}
        </div>
      )}
      {d.bom && d.bom.length > 0 && (
        <div className="mt-2 text-xs">
          <div className="font-semibold text-zinc-700">Insumos</div>
          <ul className="mt-1 space-y-0.5">
            {d.bom.map((l, i) => (
              <li key={i} className={l.originating ? "text-green-700" : "text-red-700"}>
                {l.originating ? "✓" : "✗"} {l.sku} — {l.originating ? "originario" : "no originario"} ({l.country || "—"}) · {l.origin_source} · valor {l.line_value}
              </li>
            ))}
          </ul>
        </div>
      )}
      {d.tariff_shift && (
        <div className="mt-2 text-xs">
          <div className="font-semibold text-zinc-700">Salto arancelario ({d.tariff_shift.shift_level})</div>
          <div className="text-zinc-500">Valor que no salta: {d.tariff_shift.violating_value} ({d.tariff_shift.violating_pct}%) · de minimis permitido {d.tariff_shift.de_minimis}%
            {d.tariff_shift.except_codes && d.tariff_shift.except_codes.length > 0 && <> · excepto desde {d.tariff_shift.except_codes.map(formatHs).join(", ")}</>}</div>
        </div>
      )}
      {d.rvc && (
        <div className="mt-2 text-xs">
          <div className="font-semibold text-zinc-700">Valor de Contenido Regional (VCR)</div>
          <div className="text-zinc-500">VCR {d.rvc.rvc}% vs umbral {d.rvc.threshold}% · método {d.rvc.method === "net_cost" ? "Costo neto" : "Valor de transacción"} · valor no originario {d.rvc.vnm} sobre base {d.rvc.transaction_value}</div>
        </div>
      )}
    </div>
  );
}

// Instructivo paso a paso para calcular el origen de una AUTOPARTE (core).
function AutoInstructivoModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="¿Cómo se determina el origen de una autoparte?" onClose={onClose} wide>
      <div className="space-y-3 text-sm text-zinc-700">
        <p>Tu producto es una <strong>parte esencial (core part)</strong> del Anexo 4-B del T-MEC
          (suspensión, ejes, transmisiones, dirección, carrocerías, motores, baterías). Para una
          AUTOPARTE el origen se determina por el <strong>Valor de Contenido Regional (VCR)</strong>.</p>
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
          <strong>Importante:</strong> el <strong>Valor de Contenido Laboral (LVC)</strong> y la
          compra de <strong>acero/aluminio (70%)</strong> son requisitos del <strong>fabricante del
          VEHÍCULO</strong>, NO de la autoparte. Por eso aquí <strong>no se piden</strong>.
        </div>
        <div>
          <div className="font-semibold text-zinc-900">Paso a paso</div>
          <ol className="ml-5 mt-1 list-decimal space-y-1">
            <li>Elige el <strong>método de VCR</strong>:
              <ul className="ml-4 list-disc">
                <li><strong>Costo neto</strong> — umbral <strong>75%</strong> (suele ser más favorable; úsalo si tienes el costo).</li>
                <li><strong>Valor de transacción</strong> — umbral <strong>85%</strong> (precio de venta).</li>
              </ul>
            </li>
            <li>Captura la <strong>base</strong> (costo neto o valor de transacción del bien) y el
              <strong> valor de materiales NO originarios (VNM)</strong>. El sistema los pre-llena
              desde tu BOM: la base = suma del BOM; el VNM = suma de los insumos de países que NO son
              miembros del tratado. Ajústalos si tu costeo real difiere.</li>
            <li>VCR = <strong>(Base − VNM) ÷ Base × 100</strong>. Si <strong>VCR ≥ umbral</strong>, la
              autoparte es <strong>originaria</strong>.</li>
            <li><strong>Alternativa (CTC):</strong> muchas autopartes también califican por
              <strong> salto arancelario</strong> según su regla específica (PSR) — si todos tus
              insumos no originarios cambian de clasificación, puede calificar aunque no llegue al VCR.
              El cálculo por BOM normal evalúa eso.</li>
            <li><strong>De minimis:</strong> si el VNM no supera el <strong>10%</strong> del valor, hay
              tolerancia para materiales que no cumplan el salto.</li>
            <li>Si resulta originaria, ya puedes <strong>emitir el certificado</strong>.</li>
          </ol>
        </div>
        <p className="text-xs text-zinc-400">Herramienta orientativa. Umbrales y fechas del T-MEC deben confirmarse contra la normativa vigente (Anexo 4-B y Reglamentaciones Uniformes) y validarse con un especialista antes de uso formal.</p>
      </div>
      <div className="mt-5 flex justify-end"><Btn variant="ghost" onClick={onClose}>Cerrar</Btn></div>
    </Modal>
  );
}
// Panel del régimen automotriz para AUTOPARTES (core), INTEGRADO en "Cálculo de
// origen": solo pide el VCR (costo neto o valor de transacción). NO pide LVC ni
// acero/aluminio (son requisitos del vehículo, no de la parte).
function AutomotivePanel({ productId, treatyId, suggestNet, autoVnm, onCalcDone }: {
  productId: number; treatyId: number; suggestNet: string; autoVnm: string;
  onCalcDone?: () => void;
}) {
  const [method, setMethod] = useState<"net_cost" | "transaction">("net_cost");
  const [netCost, setNetCost] = useState(suggestNet);
  const [txValue, setTxValue] = useState(suggestNet);
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const [result, setResult] = useState<AutomotiveResult | null>(null);
  const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  const [ayuda, setAyuda] = useState(false);
  // LVC (Contenido de Valor Laboral) — OPCIONAL e informativo: algunas OEM piden
  // reportarlo. Es el VALOR EN USD de materiales/mano de obra de proveedores con
  // salario ≥ 16 USD/h. No determina el origen de la autoparte.
  const [lvcOn, setLvcOn] = useState(false);
  const [lvcValue, setLvcValue] = useState("");
  // El VNM (materiales NO originarios) lo determina el sistema desde el BOM según el
  // tratado; NO se captura a mano.
  const vnm = autoVnm;
  // Carga evaluación previa guardada (si existe).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const a: AutomotiveSaved & { rvc_method?: string } = await api.automotive(productId, treatyId);
        if (!alive || !a || !a.vehicle_class) return;
        if (a.net_cost) setNetCost(a.net_cost);
        if (a.as_of) setAsOf(a.as_of);
        if (a.lvc_value && Number(a.lvc_value) > 0) { setLvcOn(true); setLvcValue(a.lvc_value); }
        if (a.detail) { setResult(a.detail); if (a.detail.rvc_method) setMethod(a.detail.rvc_method === "transaction" ? "transaction" : "net_cost"); }
      } catch { /* sin guardado */ }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, treatyId]);
  const threshold = method === "transaction" ? "85" : "75";
  async function evaluar() {
    setBusy(true); setMsg("");
    try {
      setResult(await api.calcAutomotive(productId, {
        treaty: treatyId, vehicle_class: "autopart", as_of: asOf, rvc_method: method,
        net_cost: netCost || "0", transaction_value: txValue || "0", vnm: vnm || "0",
        ...(lvcOn && lvcValue ? { lvc_value: lvcValue } : {}),
      }));
      onCalcDone?.();
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="mt-4">
      {ayuda && <AutoInstructivoModal onClose={() => setAyuda(false)} />}
      <Card className="border-amber-300 bg-amber-50/40 p-5">
        <div className="mb-1 flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-amber-900">🚗 Autoparte esencial (core) — Valor de Contenido Regional</div>
          <Btn variant="ghost" size="sm" onClick={() => setAyuda(true)}>¿Cómo se calcula?</Btn>
        </div>
        <p className="mb-3 text-xs text-amber-800">Para una autoparte el origen se determina por el <strong>VCR</strong>. No se piden LVC ni acero/aluminio (esos son del vehículo). El <strong>VNM se detecta automáticamente</strong> del BOM según el tratado; tú solo capturas el costo neto / valor de transacción del bien final.</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Método de VCR">
            <select value={method} onChange={(e) => setMethod(e.target.value as "net_cost" | "transaction")} className={inputCls}>
              <option value="net_cost">Costo neto (umbral 75%)</option>
              <option value="transaction">Valor de transacción (umbral 85%)</option>
            </select>
          </Field>
          {method === "net_cost" ? (
            <Field label="Costo neto del bien final"><input type="number" step="any" className={inputCls} value={netCost} onChange={(e) => setNetCost(e.target.value)} /></Field>
          ) : (
            <Field label="Valor de transacción del bien final"><input type="number" step="any" className={inputCls} value={txValue} onChange={(e) => setTxValue(e.target.value)} /></Field>
          )}
          <Field label="Materiales NO originarios (VNM) — automático">
            <div className={cx(inputCls, "flex items-center bg-zinc-100 text-zinc-600")}>
              <span className="font-mono">{vnm}</span>
              <span className="ml-2 text-[11px] text-zinc-400">detectado del BOM</span>
            </div>
          </Field>
          <Field label="Fecha"><input type="date" className={inputCls} value={asOf} onChange={(e) => setAsOf(e.target.value)} /></Field>
        </div>
        <p className="mt-3 text-xs text-amber-800">Umbral requerido: <strong>VCR ≥ {threshold}%</strong> ({method === "transaction" ? "valor de transacción" : "costo neto"}).</p>

        <div className="mt-3 rounded-lg border border-amber-200 bg-white/60 p-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-amber-900">
            <input type="checkbox" checked={lvcOn} onChange={(e) => setLvcOn(e.target.checked)} />
            Reportar Contenido de Valor Laboral (LVC) — opcional
          </label>
          <p className="mt-1 text-[11px] text-amber-800">El LVC es un requisito del <strong>vehículo</strong> (no de la autoparte) y <strong>no cambia</strong> el origen de la parte. Actívalo solo si tu OEM te pide reportarlo.</p>
          {lvcOn && (
            <>
              <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-[11px] text-amber-900">
                <strong>¿Qué se captura aquí?</strong> El <strong>valor en USD</strong> de los materiales y la mano de obra usados para fabricar el bien que provienen de <strong>plantas/proveedores cuyos trabajadores de producción ganan en promedio ≥ 16 USD/h</strong> (“high-wage material and manufacturing expenditure”, T-MEC Art. 4-B). <strong>No</strong> es un porcentaje: el sistema calcula automáticamente el % que representa sobre el costo neto. El umbral del 40% (autos) / 45% (camiones) es del <strong>vehículo</strong>, no de tu parte.
              </div>
              <div className="mt-2 max-w-sm">
                <Field label="Valor de contenido de alto salario (USD) — proveedores ≥ 16 USD/h">
                  <input type="number" step="any" className={inputCls} value={lvcValue} onChange={(e) => setLvcValue(e.target.value)} placeholder="Ej. 5.20" />
                </Field>
                {lvcValue && Number(netCost) > 0 && (
                  <p className="mt-1 text-[11px] text-amber-700">≈ {((Number(lvcValue) / Number(netCost)) * 100).toFixed(2)}% del costo neto ({netCost} USD).</p>
                )}
              </div>
            </>
          )}
        </div>

        {msg && <p className="mt-2 text-sm text-red-600">{msg}</p>}
        <div className="mt-4"><Btn onClick={evaluar} disabled={busy}>{busy ? "Calculando…" : "Calcular origen"}</Btn></div>
      </Card>

      {result && (
        <div className="mt-3 rounded-lg border border-zinc-200 p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className={cx("rounded-full px-3 py-1 text-sm font-bold", result.qualifies ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700")}>
              {result.qualifies ? "Originario: SÍ (por VCR)" : "Originario: NO (por VCR)"}
            </span>
          </div>
          <Table head={["Criterio", "Valor", "Umbral", "Estado", "Detalle"]}>
            {result.pillars.map((p) => (
              <tr key={p.key}>
                <td className="px-4 py-3 font-medium">{p.label}</td>
                <td className="px-4 py-3 text-xs">{p.value ?? "—"}{p.value != null && p.unit ? ` ${p.unit}` : ""}{p.value_pct ? ` (${p.value_pct}%)` : ""}</td>
                <td className="px-4 py-3 text-xs">{p.threshold === "—" ? "—" : `${p.threshold}%`}</td>
                <td className="px-4 py-3">{p.informational ? <span className="text-zinc-400">informativo</span> : p.ok ? <span className="text-green-700">✓</span> : <span className="text-red-700">✗</span>}</td>
                <td className="px-4 py-3 text-xs text-zinc-500">{p.detail}</td>
              </tr>
            ))}
          </Table>
          {!result.qualifies && (
            <p className="mt-2 text-xs text-amber-700">Si no alcanza el VCR, revisa si califica por <strong>salto arancelario (CTC)</strong> con el cálculo por BOM, o ajusta el costeo / origen de tus insumos.</p>
          )}
          <p className="mt-3 text-xs text-zinc-400">{result.disclaimer}</p>
        </div>
      )}
    </div>
  );
}

// Ayuda: cómo funciona el cálculo de origen y el BOM recursivo (roll-up).
function AyudaOrigenModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="¿Cómo funciona el cálculo de origen?" onClose={onClose} wide>
      <div className="space-y-4 text-sm text-zinc-700">
        <div>
          <div className="font-semibold text-zinc-900">¿Para qué sirve?</div>
          <p>Determina si tu producto es <strong>originario</strong> de un tratado (TLC) según su lista de materiales (BOM). El sistema aplica la regla de origen de la fracción (salto arancelario y/o valor de contenido regional) y te dice si <strong>califica</strong>.</p>
        </div>
        <div>
          <div className="font-semibold text-zinc-900">Paso a paso</div>
          <ol className="ml-5 list-decimal space-y-1">
            <li>Da de alta el producto y su <strong>BOM</strong> (Productos → botón “BOM”), con cada insumo y su cantidad.</li>
            <li>Aquí eliges el <strong>producto</strong> y el <strong>tratado</strong>.</li>
            <li>Por cada insumo defines su origen: <strong>declaración del proveedor</strong> (más reciente o de un periodo) o <strong>manual</strong> (país).</li>
            <li>Pulsas <strong>“Calcular origen”</strong> y obtienes el resultado con su detalle.</li>
          </ol>
        </div>
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
          <div className="font-semibold text-blue-900">BOM recursivo (roll-up) — para subensambles que fabricas tú</div>
          <p className="mt-1 text-blue-900">Si un insumo es un <strong>subensamble que tú fabricas</strong> y tiene su propio BOM, el sistema lo calcula “hacia adentro”: primero califica el subensamble con SUS materiales y, si resulta originario, su <strong>valor completo</strong> cuenta como originario en el producto de arriba (esto se llama <em>roll-up</em> y maximiza el VCR).</p>
          <p className="mt-2 text-blue-900"><strong>Ejemplo:</strong> un Tablero ($100) lleva un Arnés que fabricas ($60) + una carcasa importada ($40). El Arnés, por dentro, lleva cobre de México ($50) + un conector importado ($10). El sistema califica primero el Arnés (VCR 83% → originario) y entonces sus $60 completos cuentan como originarios en el Tablero.</p>
          <p className="mt-2 text-blue-900"><strong>¿Cómo se activa?</strong> Deja el subensamble en modo <strong>“usar declaración del proveedor”</strong> (sin país manual y sin declaración cargada): al no encontrar declaración y ver que tiene BOM propio, el sistema lo calcula solo. En el reporte verás la línea como <em>“Subensamble calculado (roll-up)”</em>.</p>
        </div>
        <div>
          <div className="font-semibold text-zinc-900">¿Cuándo NO lo necesitas?</div>
          <p>Si todos tus insumos son <strong>comprados</strong> (llegan ya hechos con su declaración), el cálculo a un nivel es suficiente; el roll-up solo aplica cuando hay manufactura en varios niveles.</p>
        </div>
        <p className="text-xs text-zinc-400">El cálculo es orientativo; valídalo con un especialista antes de uso formal ante la autoridad.</p>
      </div>
      <div className="mt-5 flex justify-end"><Btn variant="ghost" onClick={onClose}>Entendido</Btn></div>
    </Modal>
  );
}

// Buscador con autocompletar de productos: el usuario teclea el número de parte
// (o descripción) y elige de la lista filtrada. Mejor que un <select> cuando hay
// muchas variantes.
function ProductCombobox({ products, value, onChange, placeholder }: {
  products: Product[]; value: number | ""; onChange: (id: number | "") => void; placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const CAP = 500;
  const selected = products.find((p) => p.id === value) || null;
  const ordered = products.slice().sort((a, b) =>
    (a.sku || "").localeCompare(b.sku || "", "es", { numeric: true, sensitivity: "base" }));
  const display = open ? query : (selected ? `${selected.sku} — ${selected.description}` : "");
  const all = open && query.trim()
    ? smartFilter(ordered, query, (p) => [p.sku, p.description, p.hs_code])
    : ordered;
  const matches = all.slice(0, CAP);
  return (
    <div className="relative">
      <input
        className={inputCls}
        value={display}
        placeholder={placeholder ?? "Escribe el número de parte o descripción…"}
        onFocus={() => { setOpen(true); setQuery(""); }}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); if (value !== "") onChange(""); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <div className="absolute z-20 mt-1 max-h-80 w-full overflow-auto rounded-lg border border-zinc-200 bg-white shadow-lg">
          <div className="sticky top-0 border-b border-zinc-100 bg-zinc-50 px-3 py-1.5 text-[11px] text-zinc-500">
            {all.length} producto{all.length === 1 ? "" : "s"}{all.length > CAP ? ` · mostrando ${CAP}, escribe para filtrar` : ""}
          </div>
          {matches.length === 0 ? (
            <div className="px-3 py-2 text-sm text-zinc-400">Sin coincidencias.</div>
          ) : matches.map((p) => (
            <button key={p.id} type="button"
              onMouseDown={(e) => { e.preventDefault(); onChange(p.id); setOpen(false); setQuery(""); }}
              className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-blue-50">
              <span className="font-mono text-xs font-semibold text-zinc-800">{p.sku}</span>
              <span className="text-xs text-zinc-500">{p.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// SÚPER-CORE (T-MEC, Apéndice automotriz Art. 3.9): las partes esenciales
// (Tabla A.1) se tratan como UNA sola parte y se evalúa el VCR del conjunto por
// costo neto. El backend detecta las partes core del catálogo y suma su costo
// neto/VNM desde el BOM de cada una.
function SupercoreModal({ treatyId, onClose }: { treatyId: number; onClose: () => void }) {
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const [result, setResult] = useState<SupercoreResult | null>(null);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  // Universo inicial de partes core (para poder re-incluir las excluidas).
  const [master, setMaster] = useState<SupercoreResult["parts"]>([]);
  const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  const money = (v?: string | null) => {
    const n = Number(v); return isNaN(n) ? "—" : `$${n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };
  async function calc(excl: Set<number>, ids: number[], fecha: string) {
    setBusy(true); setMsg("");
    try {
      const products = ids.length ? ids.filter((id) => !excl.has(id)) : undefined;
      const r = await api.supercore({ treaty: treatyId, as_of: fecha, ...(products ? { products } : {}) });
      setResult(r);
      if (!ids.length) setMaster(r.parts);  // universo inicial
    } catch (e) { setMsg((e as Error).message); setResult(null); }
    finally { setBusy(false); }
  }
  useEffect(() => { calc(new Set(), [], asOf); /* carga inicial: todas las core */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function toggle(id: number) {
    const next = new Set(excluded);
    if (next.has(id)) next.delete(id); else next.add(id);
    setExcluded(next);
    calc(next, master.map((p) => p.id), asOf);
  }
  // Se pinta el universo completo; las excluidas quedan sin marcar (re-incluibles).
  const filas = master.map((m) => result?.parts.find((p) => p.id === m.id) ?? m);
  return (
    <Modal title="Súper-core — partes esenciales como una sola (T-MEC)" onClose={onClose} wide>
      <p className="mb-3 text-sm text-zinc-500">
        El Apéndice automotriz del T-MEC (Art. 3.9) permite tratar las <strong>partes esenciales
        (core, Tabla A.1)</strong> como <strong>una sola parte</strong>: se promedia el VCR del
        conjunto por costo neto y, si alcanza el umbral, <strong>todas</strong> se consideran
        originarias (roll-up). El costo neto y el VNM de cada parte salen de su BOM.
      </p>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="Fecha (phase-in)">
          <input type="date" className={inputCls} value={asOf}
            onChange={(e) => { setAsOf(e.target.value); if (e.target.value) calc(excluded, master.map((p) => p.id), e.target.value); }} />
        </Field>
        {result && (
          <span className={cx("mb-1 rounded-full px-3 py-1 text-sm font-bold",
            result.qualifies ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700")}>
            {result.rvc != null
              ? `VCR combinado ${result.rvc}% ${result.qualifies ? "≥" : "<"} ${result.threshold}% — ${result.qualifies ? "TODAS originarias (roll-up)" : "NO alcanza el umbral"}`
              : "Sin datos suficientes"}
          </span>
        )}
        {busy && <span className="mb-1 text-sm text-zinc-400">Calculando…</span>}
      </div>
      {msg && <p className="mb-3 text-sm text-red-600">{msg}</p>}
      {result && (
        <>
          <div className="mb-3 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-zinc-100 px-3 py-1">Costo neto del conjunto: <strong>{money(result.net_cost)}</strong></span>
            <span className="rounded-full bg-zinc-100 px-3 py-1">VNM del conjunto: <strong>{money(result.vnm)}</strong></span>
            <span className="rounded-full bg-zinc-100 px-3 py-1">{result.included} de {result.total_parts} parte(s) con datos</span>
          </div>
          <Table head={["Incluir", "Núm. de parte", "Descripción", "HS (core)", "Costo neto", "VNM", "VCR individual"]}>
            {filas.map((p) => (
              <tr key={p.id} className={cx(!p.has_data && "bg-amber-50/60")}>
                <td className="px-4 py-3">
                  <input type="checkbox" checked={!excluded.has(p.id)} disabled={busy} onChange={() => toggle(p.id)} />
                </td>
                <td className="px-4 py-3 font-mono text-xs">{p.sku}</td>
                <td className="px-4 py-3 text-xs">{p.description}</td>
                <td className="px-4 py-3 text-xs">{formatHs(p.hs_code)} <span className="text-zinc-400">({formatHs(p.core_code)})</span></td>
                <td className="px-4 py-3 text-xs">{p.has_data ? money(p.net_cost) : "—"}</td>
                <td className="px-4 py-3 text-xs">{p.has_data ? money(p.vnm) : "—"}</td>
                <td className="px-4 py-3 text-xs">
                  {p.rvc != null ? `${p.rvc}%`
                    : <span className="text-amber-700">sin BOM/costos — no suma</span>}
                </td>
              </tr>
            ))}
          </Table>
          {result.missing.length > 0 && (
            <p className="mt-2 text-xs text-amber-700">
              ⚠️ Sin datos de BOM (no suman al conjunto): {result.missing.join(", ")}. Ármales su lista de materiales para incluirlas.
            </p>
          )}
          <p className="mt-3 text-xs text-zinc-400">{result.disclaimer}</p>
        </>
      )}
      <div className="mt-5 flex justify-end"><Btn variant="ghost" onClick={onClose}>Cerrar</Btn></div>
    </Modal>
  );
}
// Cálculo de origen del producto de la EMPRESA a partir de su BOM, con toggle
// por insumo (declaración del proveedor / periodo, o captura manual).
/* ==== Ayuda: qué es una core part (T-MEC/USMCA), bilingüe ES/EN ==== */
function CorePartInfoModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="🚗 ¿Qué es una parte esencial (core part)? / What is a core part?" onClose={onClose} wide>
      <div className="grid grid-cols-1 gap-5 text-sm sm:grid-cols-2">
        <div>
          <h4 className="mb-2 font-semibold text-zinc-900">Español</h4>
          <p className="mb-2">
            Las <strong>partes esenciales (core parts)</strong> son las autopartes listadas en la
            <strong> Tabla A.1 del Apéndice al Anexo 4-B del T-MEC</strong>, usadas en vehículos de
            pasajeros y camiones ligeros: <strong>motores, transmisiones, carrocerías y chasis,
            ejes, sistemas de suspensión, sistemas de dirección y baterías avanzadas</strong>.
          </p>
          <div className="mb-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs">
            <div className="mb-1 font-semibold text-zinc-700">Extracto (Apéndice al Anexo 4-B, Art. 3)</div>
            «Una parte esencial listada en la Tabla A.1 es originaria <strong>solo si cumple el
            requisito de Valor de Contenido Regional (VCR)</strong> aplicable — método de costo
            neto, con calendario de transición (phase-in) que llega al <strong>75%</strong> —.
            No obstante cualquier otra regla, <strong>el cambio de clasificación arancelaria
            (salto) no es suficiente</strong> por sí solo para conferir origen a estas partes.»
          </div>
          <p className="text-xs text-zinc-600">
            <strong>En el sistema:</strong> al marcar la casilla, el cálculo <strong>omite el
            CTH/CTSH</strong> y determina el origen <strong>exclusivamente por VCR</strong> sobre
            costo neto (materiales + mano de obra). El resultado y el PDF lo indican.
          </p>
        </div>
        <div>
          <h4 className="mb-2 font-semibold text-zinc-900">English</h4>
          <p className="mb-2">
            <strong>Core parts</strong> are the auto parts listed in <strong>Table A.1 of the
            Appendix to Annex 4-B of the USMCA</strong>, for use in passenger vehicles and light
            trucks: <strong>engines, transmissions, bodies and chassis, axles, suspension
            systems, steering systems, and advanced batteries</strong>.
          </p>
          <div className="mb-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs">
            <div className="mb-1 font-semibold text-zinc-700">Excerpt (Appendix to Annex 4-B, Art. 3)</div>
            “A core part listed in Table A.1 is originating <strong>only if it satisfies the
            applicable Regional Value Content (RVC) requirement</strong> — net cost method, with
            a phase-in schedule reaching <strong>75%</strong> —. Notwithstanding any other rule,
            <strong> a change in tariff classification (tariff shift) alone is not
            sufficient</strong> to confer origin on these parts.”
          </div>
          <p className="text-xs text-zinc-600">
            <strong>In the system:</strong> when the box is checked, the calculation
            <strong> skips CTH/CTSH</strong> and determines origin <strong>exclusively by
            RVC</strong> over net cost (materials + labor). The result and the PDF state it.
          </p>
        </div>
      </div>
      <p className="mt-4 text-[11px] text-zinc-400">
        Referencia: T-MEC/USMCA, Apéndice al Anexo 4-B (Disposiciones relacionadas con las reglas
        de origen específicas por producto para mercancías automotrices), Art. 3 y Tabla A.1.
        Texto orientativo; confirma contra la normativa vigente y las Reglamentaciones Uniformes.
      </p>
      <div className="mt-4 flex justify-end"><Btn variant="ghost" onClick={onClose}>Cerrar</Btn></div>
    </Modal>
  );
}

function CalculoOrigenView() {
  const productsL = useList<Product>(() => api.products());
  const treatiesL = useList<Treaty>(() => api.treaties());
  const [productId, setProductId] = useState<number | "">("");
  const [treatyId, setTreatyId] = useState<number | "">("");
  const [comps, setComps] = useState<BomOriginComponent[]>([]);
  const [product, setProduct] = useState<Product | null>(null);
  const [bomTotal, setBomTotal] = useState("0");
  const [bomConversion, setBomConversion] = useState("0");
  const [bomNetCost, setBomNetCost] = useState("0");
  const [bomVnm, setBomVnm] = useState("0");
  const [suggestedRule, setSuggestedRule] = useState<{ rule_type: string; description: string; hs_pattern: string; shift_level?: string } | null>(null);
  const [loadingBom, setLoadingBom] = useState(false);
  const [bomError, setBomError] = useState(false);
  const [result, setResult] = useState<OriginCalcResult | null>(null);
  const [msg, setMsg] = useState(""); const [calc, setCalc] = useState(false);
  const [ayuda, setAyuda] = useState(false);
  const [supercoreOpen, setSupercoreOpen] = useState(false);
  const [histKey, setHistKey] = useState(0);  // refresca el histórico tras cada cálculo
  const [autoCore, setAutoCore] = useState<string | null>(null);  // core part SOLO si T-MEC
  // Marca MANUAL de parte esencial (core part): solo VCR, sin CTH. Solo T-MEC.
  const [corePart, setCorePart] = useState(false);
  const [coreInfo, setCoreInfo] = useState(false);
  const productos = productsL.data.filter((p) => p.kind !== "material");
  // El régimen automotriz (core part) es exclusivo del T-MEC: el backend solo
  // devuelve automotive_core_code cuando el tratado es T-MEC.
  const automotive = !!autoCore;
  // Total y VNM (valor de materiales NO originarios) los calcula el BACKEND según el
  // tratado (origen real de cada insumo): aquí solo se muestran/usan.

  useEffect(() => {
    if (treatyId === "" && treatiesL.data.length) {
      const tmec = treatiesL.data.find((t) => t.code === "TMEC");
      setTreatyId(tmec ? tmec.id : treatiesL.data[0].id);
    }
  }, [treatiesL.data, treatyId]);

  const loadBom = useCallback(async () => {
    if (!productId || !treatyId) { setComps([]); setProduct(null); setBomError(false); return; }
    setLoadingBom(true); setResult(null); setBomError(false); setMsg("");
    try {
      const r = await api.productBomOrigin(Number(productId), Number(treatyId));
      setComps(r.components); setProduct(r.product);
      setBomTotal(r.total_value ?? "0"); setBomVnm(r.vnm ?? "0");
      setBomConversion(r.conversion_cost ?? "0");
      setBomNetCost(r.net_cost ?? r.total_value ?? "0");
      setAutoCore(r.automotive_core_code ?? null);
      setSuggestedRule(r.suggested_rule ?? null);
    } catch (e) { setBomError(true); setComps([]); setMsg((e as Error).message); }
    finally { setLoadingBom(false); }
  }, [productId, treatyId]);
  useEffect(() => { loadBom(); }, [loadBom]);
  // La marca de core part es POR PRODUCTO (persistida en el catálogo): hay
  // empresas que manejan ambos tipos. Si el producto no la tiene definida,
  // se pre-marca con la detección automática (Tabla A.1).
  useEffect(() => { setCorePart(product?.is_core_part ?? !!autoCore); }, [product, autoCore]);

  async function patch(c: BomOriginComponent, payload: Record<string, unknown>) {
    setMsg("");
    try { await api.updateBomComponent(c.id, payload); await loadBom(); }
    catch (e) { setMsg((e as Error).message); }
  }
  async function calcular() {
    if (!productId || !treatyId) return;
    setCalc(true); setMsg("");
    try {
      setResult(await api.calcBomOrigin(Number(productId), Number(treatyId), null, corePart));
      setHistKey((k) => k + 1);
    }
    catch (e) { setMsg((e as Error).message); }
    finally { setCalc(false); }
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <PageTitle title="Cálculo de origen" desc="Calcula el origen de tus productos a partir de su BOM. Por cada insumo elige si tomas el origen que declaró el proveedor o lo capturas tú." />
        <div className="flex shrink-0 items-center gap-2">
          {treatiesL.data.find((t) => t.id === treatyId)?.code === "TMEC" && (
            <Btn variant="ghost" size="sm" onClick={() => setSupercoreOpen(true)}>🚗 Súper-core</Btn>
          )}
          <Btn variant="ghost" size="sm" onClick={() => setAyuda(true)}>¿Cómo funciona?</Btn>
        </div>
      </div>
      {ayuda && <AyudaOrigenModal onClose={() => setAyuda(false)} />}
      {supercoreOpen && treatyId !== "" && (
        <SupercoreModal treatyId={Number(treatyId)} onClose={() => setSupercoreOpen(false)} />
      )}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[20rem]">
          <span className="mb-1 block text-xs font-semibold text-zinc-700">Producto</span>
          <ProductCombobox products={productos} value={productId} onChange={setProductId} />
        </div>
        <div className="min-w-[16rem]">
          <span className="mb-1 block text-xs font-semibold text-zinc-700">Tratado</span>
          <select value={treatyId} onChange={(e) => setTreatyId(e.target.value ? Number(e.target.value) : "")} className={inputCls}>
            {treatiesL.data.map((t) => <option key={t.id} value={t.id}>{treatyLabel(t.code)} — {t.name}</option>)}
          </select>
        </div>
        {product && treatiesL.data.find((t) => t.id === treatyId)?.code === "TMEC" && (
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm">
            <input type="checkbox" checked={corePart} onChange={async (e) => {
              const v = e.target.checked;
              setCorePart(v);
              // Se persiste POR PRODUCTO en el catálogo (no es un estado general).
              try { await api.updateProduct(product.id, { is_core_part: v }); }
              catch (err) { setMsg((err as Error).message); }
            }} />
            <span>🚗 <strong>Parte esencial (core part)</strong> — solo VCR</span>
            <button type="button" onClick={() => setCoreInfo(true)} title="¿Qué es una core part?"
              className="grid h-5 w-5 place-items-center rounded-full bg-blue-100 text-[11px] font-bold text-blue-700 hover:bg-blue-200">?</button>
          </label>
        )}
        {(!automotive || corePart) && (
          <Btn onClick={calcular} disabled={!productId || !treatyId || comps.length === 0 || calc}>
            {calc ? "Calculando…" : "Calcular origen"}
          </Btn>
        )}
      </div>
      {coreInfo && <CorePartInfoModal onClose={() => setCoreInfo(false)} />}
      {msg && <p className="mb-3 text-sm text-amber-600">{msg}</p>}

      {product && comps.length > 0 && (
        <Card className="mb-4 p-4">
          <div className="flex flex-wrap items-start gap-x-8 gap-y-2">
            <div>
              <span className="text-xs text-zinc-500">Producto terminado</span>
              <div className="font-mono text-sm font-semibold">{product.sku}<span className="ml-1 font-sans font-normal text-zinc-500">— {product.description}</span></div>
            </div>
            <div>
              <span className="text-xs text-zinc-500">Fracción arancelaria (HS)</span>
              <div className="font-mono text-sm font-semibold">{product.hs_code ? formatHs(product.hs_code) : "—"}</div>
            </div>
            <div className="min-w-[16rem] flex-1">
              <span className="text-xs text-zinc-500">Regla de origen sugerida (catálogo)</span>
              <div className="text-sm">
                {suggestedRule
                  ? <><strong>{ruleTypeLabel(suggestedRule.rule_type, suggestedRule.shift_level)}</strong>{suggestedRule.description ? <span className="text-zinc-500"> — {cleanRuleDesc(suggestedRule.description)}</span> : null}</>
                  : <span className="text-amber-600">No hay una regla específica en el catálogo para esta fracción.</span>}
              </div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-x-6 gap-y-1 border-t border-zinc-100 pt-3 text-sm">
            <span className="text-xs text-zinc-500">Costo neto del bien:</span>
            <span className="font-mono">Materiales {Number(bomTotal).toLocaleString("es-MX")}</span>
            <span className="text-zinc-400">+</span>
            <span className="font-mono">Mano de obra/conversión {Number(bomConversion).toLocaleString("es-MX")}</span>
            <span className="text-zinc-400">=</span>
            <span className="font-mono font-semibold">{Number(bomNetCost).toLocaleString("es-MX")} {product.currency}</span>
            {Number(bomConversion) === 0 && (
              <span className="text-[11px] text-amber-600">· Agrega la mano de obra en “Productos” → editar producto (sube el VCR).</span>
            )}
          </div>
          {automotive && (
            <div className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
              🚗 La fracción <strong>{product.hs_code ? formatHs(product.hs_code) : ""}</strong> es una <strong>parte esencial (core part)</strong> del Anexo 4-B del T-MEC: su origen se determina por el <strong>régimen automotriz (VCR)</strong> — ver el panel de abajo.
            </div>
          )}
        </Card>
      )}
      {!productId && <p className="text-sm text-zinc-400">Elige un producto para ver su lista de materiales.</p>}
      {productId && !loadingBom && bomError && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          No se pudo cargar la información del producto (puede ser una interrupción temporal del servidor).
          <button onClick={() => loadBom()} className="ml-2 font-medium text-blue-600 hover:underline">Reintentar</button>
        </div>
      )}
      {productId && !loadingBom && !bomError && comps.length === 0 && (
        <p className="text-sm text-zinc-400">Este producto no tiene BOM. Agrégalo en “Productos” → botón “BOM”.</p>
      )}
      {comps.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-xs text-zinc-500">
              <tr>
                <th className="px-4 py-2.5">Insumo</th>
                <th className="px-4 py-2.5">Proveedor</th>
                <th className="px-4 py-2.5 text-right">Precio unit.</th>
                <th className="px-4 py-2.5 text-right">Cant.</th>
                <th className="px-4 py-2.5 text-right">Valor</th>
                <th className="px-4 py-2.5">Fuente de origen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {comps.map((c) => {
                const supplierMode = c.origin_mode === "supplier";
                const pu = Number(c.component_unit_cost || 0);
                const qty = Number(c.quantity || 0);
                const valor = (pu * qty).toFixed(2);
                return (
                  <tr key={c.id} className="align-top">
                    <td className="px-4 py-3">
                      <div className="font-mono text-xs">{c.component_sku}</div>
                      <div className="text-xs text-zinc-500">{c.component_description}</div>
                      <div className="text-[11px] text-zinc-400">HS {c.component_hs ? formatHs(c.component_hs) : "—"}</div>
                      {c.originating != null && (
                        <span className={cx("mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium",
                          c.originating ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700")}>
                          {c.originating ? "originario" : "no originario (cuenta en VNM)"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">{c.component_supplier_name ?? "—"}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs">{pu.toFixed(4)}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs">{qty}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="font-mono text-xs font-medium text-zinc-700">{valor}</div>
                      <div className="text-[10px] text-zinc-400">{pu.toFixed(4)} × {qty}</div>
                    </td>
                    <td className="px-4 py-3">
                      <label className="flex items-center gap-2 text-xs font-medium text-zinc-700">
                        <input type="checkbox" checked={supplierMode}
                          onChange={(e) => patch(c, { origin_mode: e.target.checked ? "supplier" : "manual" })} />
                        Usar origen declarado por el proveedor
                      </label>
                      {supplierMode ? (
                        <div className="mt-2">
                          {c.declarations.length === 0 ? (
                            <span className="text-[11px] text-amber-600">⚠️ Este proveedor aún no entrega declaración para este tratado.</span>
                          ) : (
                            <select value={c.origin_as_of ?? ""} onChange={(e) => patch(c, { origin_as_of: e.target.value || null })}
                              className="rounded-lg border border-zinc-300 px-2 py-1 text-xs">
                              <option value="">Más reciente</option>
                              {c.declarations.map((d, i) => (
                                <option key={i} value={d.valid_from ?? ""}>
                                  {d.valid_from} → {d.valid_to} · {d.is_originating ? "Originario" : "No originario"} ({d.country || "—"})
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      ) : (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className="text-[11px] text-zinc-500">País:</span>
                          <input value={c.manual_country ?? ""} maxLength={2} placeholder="País"
                            onChange={(e) => patch(c, { manual_country: e.target.value.replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 2) })}
                            className="w-20 rounded-lg border border-zinc-300 px-2 py-1 text-xs uppercase" />
                          {(c.component_declarations ?? []).length > 0 && (
                            <select value="" onChange={(e) => { if (e.target.value) patch(c, { manual_country: e.target.value }); }}
                              className="rounded-lg border border-zinc-300 px-2 py-1 text-xs">
                              <option value="">Traer de declaración…</option>
                              {(c.component_declarations ?? []).map((d, i) => (
                                <option key={i} value={d.country}>{treatyLabel(d.treaty_code)} · {d.valid_from} → {d.valid_to} · {d.country || "—"}</option>
                              ))}
                            </select>
                          )}
                          <span className="text-[11px] text-zinc-400">(originario si el país es miembro del tratado)</span>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
      {comps.length > 0 && automotive && (
        <AutomotivePanel productId={Number(productId)} treatyId={Number(treatyId)}
          suggestNet={bomNetCost} autoVnm={bomVnm} onCalcDone={() => setHistKey((k) => k + 1)} />
      )}
      {result?.detail?.core_part != null && (
        <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
          🚗 <strong>Parte esencial (core part).</strong> El salto arancelario (CTH/CTSH) no se
          aplicó: el origen se determinó <strong>exclusivamente por VCR</strong> sobre costo
          neto (T-MEC, Apéndice al Anexo 4-B, Tabla A.1).
        </div>
      )}
      {result && (!automotive || corePart) && <OriginResultReport result={result} />}
      {productId && treatyId && comps.length > 0 && (
        <HistorialAnalisis productId={Number(productId)} treatyId={Number(treatyId)} reloadKey={histKey} />
      )}
    </div>
  );
}

/* Histórico de análisis de origen: cada cálculo se guarda con su fecha. Se puede
   consultar la traza y borrar registros. No afecta la calificación vigente. */
function HistorialAnalisis({ productId, treatyId, reloadKey }: {
  productId: number; treatyId: number; reloadKey: number;
}) {
  const [items, setItems] = useState<OriginAnalysis[]>([]);
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [detail, setDetail] = useState<OriginAnalysisDetail | null>(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setMsg("");
    try {
      // Todos los cálculos del producto (de cualquier tratado): así el histórico se
      // mantiene aunque cambies de tratado; la columna Tratado los distingue.
      const r = await api.originAnalyses(productId);
      setItems(Array.isArray(r) ? r : r.results);
    } catch (e) { setMsg((e as Error).message); }
    finally { setLoading(false); }
  }, [productId]);
  useEffect(() => { load(); }, [load, reloadKey]);

  async function ver(id: number) {
    if (openId === id) { setOpenId(null); setDetail(null); return; }
    setOpenId(id); setDetail(null);
    try { setDetail(await api.originAnalysis(id)); }
    catch (e) { setMsg((e as Error).message); }
  }
  async function borrar(id: number) {
    if (!confirm(tr("¿Borrar este análisis del histórico? La calificación vigente no cambia."))) return;
    try {
      await api.deleteOriginAnalysis(id);
      if (openId === id) { setOpenId(null); setDetail(null); }
      await load();
    } catch (e) { setMsg((e as Error).message); }
  }
  async function pdf(id: number) {
    setMsg("");
    try {
      const [a, prof] = await Promise.all([
        api.originAnalysis(id),
        api.companyProfile().catch(() => null),
      ]);
      generarAnalisisPDF(a, prof ? { legal_name: prof.legal_name, tax_id: prof.tax_id, logo_png: prof.logo_png } : undefined);
    } catch (e) { setMsg((e as Error).message); }
  }

  const fmt = (s: string) => new Date(s).toLocaleString("es-MX",
    { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const STATUS_STYLE: Record<string, string> = {
    QUALIFIES: "bg-emerald-100 text-emerald-700", DOES_NOT: "bg-red-100 text-red-700",
    INSUFFICIENT: "bg-zinc-100 text-zinc-600", AUTO_REVIEW: "bg-amber-100 text-amber-700",
  };

  return (
    <Card className="mt-5 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-800">Histórico de análisis</h3>
        <button onClick={load} className="text-xs font-medium text-blue-600 hover:underline">Actualizar</button>
      </div>
      <p className="mb-3 text-xs text-zinc-500">
        Cada vez que corres un cálculo se guarda aquí con su fecha. Útil para comparar resultados cuando cambian los precios del producto o de los insumos del BOM.
      </p>
      {msg && <p className="mb-2 text-sm text-amber-600">{msg}</p>}
      {loading && items.length === 0 ? (
        <p className="text-sm text-zinc-400">Cargando…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-zinc-400">Aún no hay análisis guardados para este producto.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                <th className="py-2 pr-3">Fecha</th><th className="py-2 pr-3">Tipo</th>
                <th className="py-2 pr-3">Tratado</th>
                <th className="py-2 pr-3">Resultado</th><th className="py-2 pr-3">Criterio</th>
                <th className="py-2 pr-3 text-right">VCR</th><th className="py-2 pr-3 text-right">Valor total</th>
                <th className="py-2 pr-3 text-right">VNM</th><th className="py-2 pr-3">Por</th><th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <Fragment key={a.id}>
                  <tr className="border-b border-zinc-100">
                    <td className="py-2 pr-3 whitespace-nowrap">{fmt(a.created_at)}</td>
                    <td className="py-2 pr-3 text-xs text-zinc-500">{a.kind_display}</td>
                    <td className="py-2 pr-3 text-xs">{treatyLabel(a.treaty_code)}</td>
                    <td className="py-2 pr-3">
                      <span className={cx("rounded-full px-2 py-0.5 text-xs font-semibold", STATUS_STYLE[a.status] ?? "bg-zinc-100 text-zinc-600")}>
                        {a.status_display}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-xs">{a.criterion || "—"}</td>
                    <td className="py-2 pr-3 text-right font-mono text-xs">{a.rvc_value != null ? `${a.rvc_value}%` : "—"}</td>
                    <td className="py-2 pr-3 text-right font-mono text-xs">{a.total_value != null ? Number(a.total_value).toLocaleString("es-MX") : "—"}</td>
                    <td className="py-2 pr-3 text-right font-mono text-xs">{a.vnm != null ? Number(a.vnm).toLocaleString("es-MX") : "—"}</td>
                    <td className="py-2 pr-3 text-xs text-zinc-500">{a.computed_by || "—"}</td>
                    <td className="py-2 text-right whitespace-nowrap">
                      <button onClick={() => ver(a.id)} className="mr-2 text-xs font-medium text-blue-600 hover:underline">{openId === a.id ? "Ocultar" : "Ver"}</button>
                      <button onClick={() => pdf(a.id)} className="mr-2 text-xs font-medium text-blue-600 hover:underline">PDF</button>
                      <button onClick={() => borrar(a.id)} className="text-xs font-medium text-red-600 hover:underline">Borrar</button>
                    </td>
                  </tr>
                  {openId === a.id && (
                    <tr className="bg-zinc-50">
                      <td colSpan={10} className="px-3 py-3">
                        {detail ? <OriginResultReport result={{ status: a.status, criterion: a.criterion, rvc_value: a.rvc_value, detail: detail.detail }} /> : <span className="text-xs text-zinc-400">Cargando traza…</span>}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// Genera un PDF (vía HTML imprimible) con el análisis de origen completo, para
// evidencia en auditorías internas o de la autoridad (CBP / aduana). Mismo patrón
// que los certificados: abre una ventana y el usuario hace "Guardar como PDF".
function generarAnalisisPDF(a: OriginAnalysisDetail, company?: { legal_name?: string; tax_id?: string; logo_png?: string }) {
  // El PDF sale en el idioma ACTIVO del sistema (botón ES/EN de la barra).
  const en = getAppLang() === "en";
  const locale = en ? "en-US" : "es-MX";
  const esc = (v?: unknown) =>
    String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
  const num = (v: unknown, dec = 2) => {
    const n = Number(v); return isNaN(n) ? "—" : n.toLocaleString(locale, { minimumFractionDigits: dec, maximumFractionDigits: dec });
  };
  const d = (a.detail || {}) as Record<string, unknown>;
  const bom = Array.isArray(d.bom) ? (d.bom as Array<Record<string, unknown>>) : [];
  const treaty = treatyLabel(a.treaty_code);
  const fecha = new Date(a.created_at).toLocaleString(locale,
    { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const folio = `FTA-ANA-${a.id}`;
  const automotive = a.kind === "automotive";

  // Métrica de VCR: viene de detail.rvc (cálculo por BOM) o del resultado automotriz.
  const rvc = (d.rvc as Record<string, unknown>) || null;
  const pillars = Array.isArray(d.pillars) ? (d.pillars as Array<Record<string, unknown>>) : [];
  const rvcVal = rvc?.rvc ?? a.rvc_value ?? (pillars[0]?.value ?? null);
  const threshold = rvc?.threshold ?? (pillars[0]?.threshold ?? (automotive ? "75" : null));
  const method = (rvc?.method as string) || (d.rvc_method as string) || (automotive ? "net_cost" : "");
  const methodLabel = method === "transaction" ? (en ? "Transaction value" : "Valor de transacción")
    : method === "net_cost" ? (en ? "Net cost" : "Costo neto") : "—";
  const base = (rvc?.transaction_value as string) ?? a.total_value ?? d.total_value;
  const vnm = (rvc?.vnm as string) ?? a.vnm ?? d.vnm;
  const hasRvc = rvcVal != null && base != null;

  const originario = a.status === "QUALIFIES";
  const statusLabel = en
    ? ({ QUALIFIES: "Qualifies (originating)", DOES_NOT: "Does not qualify",
         INSUFFICIENT: "Insufficient information", AUTO_REVIEW: "Requires automotive review" }[a.status] ?? a.status)
    : (a.status_display || a.status);
  const statusBadge = originario ? "ok" : (a.status === "DOES_NOT" ? "no" : "warn");

  const bomRows = bom.map((l, i) => {
    const orig = l.originating === true;
    const estado = l.originating == null
      ? "—"
      : orig
        ? `<span class="g">${en ? "Originating" : "Originario"}</span>`
        : `<span class="r">${en ? "Non-originating" : "No originario"}</span><br><span class="muted">${en ? "counts as VNM" : "cuenta en VNM"}</span>`;
    return `<tr>
      <td class="num">${i + 1}</td>
      <td><b>${esc(l.sku as string)}</b> — ${esc(l.description as string)}<br><span class="muted">HS ${esc(l.hs_code ? formatHs(l.hs_code as string) : "—")}</span></td>
      <td>${esc((l.supplier as string) || "—")}</td>
      <td>${esc((l.country as string) || "—")}</td>
      <td class="num">${num(l.unit_cost, 4)}</td>
      <td class="num">${num(l.quantity, 0)}</td>
      <td class="num">${num(l.line_value)}</td>
      <td>${estado}</td>
      <td class="muted">${esc(tr((l.origin_source as string) || "—"))}</td>
    </tr>`;
  }).join("");

  // Recomendaciones cuando NO califica: insumos no originarios y su peso.
  let recos = "";
  if (!originario) {
    const noOrig = bom.filter((l) => l.originating === false);
    const tot = Number(base) || bom.reduce((s, l) => s + (Number(l.line_value) || 0), 0);
    const items: string[] = [];
    noOrig.sort((x, y) => (Number(y.line_value) || 0) - (Number(x.line_value) || 0));
    noOrig.slice(0, 3).forEach((l) => {
      const v = Number(l.line_value) || 0;
      const pct = tot ? Math.round((v / tot) * 100) : 0;
      items.push(en
        ? `<li><b>Regional sourcing:</b> material <b>${esc(l.sku as string)}</b> (${esc((l.supplier as string) || "—")}${l.country ? `, ${esc(l.country as string)}` : ""}) represents $${num(v)} (${pct}% of the value). Replacing it with a supplier from the ${esc(treaty)} region would raise the regional content.</li>`
        : `<li><b>Proveeduría regional:</b> el insumo <b>${esc(l.sku as string)}</b> (${esc((l.supplier as string) || "—")}${l.country ? `, ${esc(l.country as string)}` : ""}) representa $${num(v)} (${pct}% del valor). Sustituirlo por un proveedor de la región ${esc(treaty)} elevaría el contenido regional.</li>`);
    });
    items.push(en
      ? `<li><b>Tariff shift (CTC):</b> if changing suppliers is not feasible, validate whether the non-originating materials meet the change in tariff classification required by the product-specific rule.</li>`
      : `<li><b>Salto arancelario (CTC):</b> si no es posible cambiar de proveedor, validar si los insumos no originarios cumplen el cambio de clasificación arancelaria requerido por la regla específica.</li>`);
    items.push(en
      ? `<li><b>Costing:</b> verify that direct labor, manufacturing overhead and freight are included in the net cost, since higher regional value added improves the RVC.</li>`
      : `<li><b>Costeo:</b> verificar que mano de obra directa, gastos indirectos de fabricación y transporte estén integrados en el costo neto, ya que un mayor valor agregado regional mejora el VCR.</li>`);
    recos = `<div class="section">${en ? "3. Recommendations and next steps" : "3. Recomendaciones y siguientes pasos"}</div><ul>${items.join("")}</ul>`;
  }

  const materials = d.materials_total;
  const conversion = d.conversion_cost;
  const hasConv = conversion != null && Number(conversion) > 0;
  const vcrBlock = hasRvc ? `
    <div class="section">${en ? "2. Regional Value Content (RVC) metric" : "2. Métrica del Valor de Contenido Regional (VCR)"}</div>
    <div class="grid g3">
      <div class="cell"><div class="lbl">${en ? "Method used" : "Método utilizado"}</div><div class="big">${esc(methodLabel)}</div></div>
      <div class="cell"><div class="lbl">${en ? "Materials (BOM)" : "Materiales (BOM)"}</div><div class="big">$${num(materials ?? base)} USD</div></div>
      <div class="cell"><div class="lbl">${en ? "Labor / conversion" : "Mano de obra / conversión"}</div><div class="big">$${num(conversion ?? 0)} USD</div></div>
      <div class="cell"><div class="lbl">${automotive ? (en ? "Net cost of the good" : "Costo neto del bien") : (en ? "Value of the good (net cost)" : "Valor del bien (costo neto)")}</div><div class="big">$${num(base)} USD</div></div>
      <div class="cell"><div class="lbl">${en ? "Non-originating materials (VNM)" : "Materiales no originarios (VNM)"}</div><div class="big">$${num(vnm)} USD</div></div>
      <div class="cell"><div class="lbl">${en ? "Required threshold" : "Umbral requerido"}</div><div class="big">${esc(threshold)}%</div></div>
    </div>
    ${hasConv ? (en
      ? `<p class="muted">Net cost of the good = materials $${num(materials)} + labor/conversion $${num(conversion)} = <b>$${num(base)}</b>. Labor is originating regional value: it adds to the net cost but not to the VNM.</p>`
      : `<p class="muted">Costo neto del bien = materiales $${num(materials)} + mano de obra/conversión $${num(conversion)} = <b>$${num(base)}</b>. La mano de obra es valor regional originario: suma al costo neto pero no al VNM.</p>`) : ""}
    <p class="formula">${en ? "RVC formula: RVC = ((Net cost − VNM) / Net cost) × 100" : "Fórmula del VCR: VCR = ((Costo neto − VNM) / Costo neto) × 100"}<br>
       ${en ? "Applied calculation" : "Cálculo aplicado"}: ${en ? "RVC" : "VCR"} = (($${num(base)} − $${num(vnm)}) / $${num(base)}) × 100 = <b>${num(rvcVal)}%</b></p>
    <p>${en ? "Determination" : "Determinación"}: <span class="badge ${statusBadge}">${esc(statusLabel.toUpperCase())}</span></p>
    <p class="muted">${en
      ? `The obtained RVC is <b>${num(rvcVal)}%</b>, ${Number(rvcVal) >= Number(threshold) ? "at or above" : "below"} the minimum threshold of <b>${esc(threshold)}%</b> (${esc(methodLabel.toLowerCase())})${automotive ? " for essential auto parts under the USMCA automotive regime" : ""}.`
      : `El VCR obtenido es de <b>${num(rvcVal)}%</b>, ${Number(rvcVal) >= Number(threshold) ? "igual o superior" : "por debajo"} del umbral mínimo de <b>${esc(threshold)}%</b> (${esc(methodLabel.toLowerCase())})${automotive ? " para autopartes esenciales del sector automotriz bajo el T-MEC" : ""}.`}</p>
  ` : `
    <div class="section">${en ? "2. Qualification result" : "2. Resultado de la calificación"}</div>
    <p>${en ? "Applied criterion" : "Criterio aplicado"}: <b>${esc(a.criterion || "—")}</b></p>
    <p>${en ? "Determination" : "Determinación"}: <span class="badge ${statusBadge}">${esc(statusLabel.toUpperCase())}</span></p>
    ${d.error ? `<p class="muted">${esc(d.error as string)}</p>` : ""}
  `;

  // LVC opcional (informativo) — si se reportó en el cálculo automotriz.
  const psr = d.psr as { hs_pattern?: string; rule_type?: string; shift_level?: string; description?: string } | undefined;
  const core = d.core_part as { note?: string; note_en?: string } | undefined;
  const coreBlock = core ? `
    <div class="section">${en ? "Core part — USMCA" : "Parte esencial (core part) — T-MEC"}</div>
    <p><b>${esc((en ? core.note_en : core.note) ?? core.note ?? "")}</b></p>
    ${en ? "" : (core.note_en ? `<p class="muted">${esc(core.note_en)}</p>` : "")}
  ` : "";
  const psrBlock = psr ? `
    <div class="section">${en ? "Applicable product-specific rule of origin (PSR)" : "Regla de origen específica (PSR) aplicable"}</div>
    <table>
      <tr><td class="k">${en ? "HS code / pattern" : "Fracción / patrón"}</td><td>${esc(psr.hs_pattern ? formatHs(psr.hs_pattern) : (a.product_hs ? formatHs(a.product_hs) : "—"))}</td></tr>
      <tr><td class="k">${en ? "Rule type" : "Tipo de regla"}</td><td><b>${esc(tr(ruleTypeLabel(psr.rule_type, psr.shift_level)))}</b></td></tr>
      <tr><td class="k">${en ? "Rule text" : "Texto de la regla"}</td><td>${esc(cleanRuleDesc(psr.description) || "—")}</td></tr>
    </table>
  ` : "";
  const lvcPillar = pillars.find((p) => (p.key as string) === "lvc");
  const lvcBlock = lvcPillar ? `
    <div class="section">${en ? "Labor Value Content (LVC) — informational" : "Contenido de Valor Laboral (LVC) — informativo"}</div>
    <p>${en ? "Reported high-wage content" : "Contenido de alto salario reportado"}: <b>$${num(lvcPillar.value)} USD</b>${lvcPillar.value_pct ? ` (<b>${esc(lvcPillar.value_pct)}%</b> ${en ? "of net cost" : "del costo neto"})` : ""}</p>
    <p class="muted">${esc(lvcPillar.detail)}</p>
  ` : "";

  const html = `<!doctype html><html lang="${en ? "en" : "es"}"><head><meta charset="utf-8">
<title>${en ? "Origin analysis" : "Análisis de origen"} ${esc(a.product_sku)} — ${esc(treaty)}</title>
<style>
  *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;color:#1f2937;margin:0;padding:32px;font-size:12.5px;line-height:1.45}
  .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid ${NAVY};padding-bottom:12px;margin-bottom:16px}
  .brand{font-size:19px;font-weight:bold;color:${NAVY}} .sub{color:#6b7280;font-size:11px}
  h1{font-size:15px;color:${NAVY};margin:0 0 2px}
  .meta{margin:6px 0 14px} .meta b{color:#111827}
  .section{font-size:12.5px;font-weight:bold;color:${NAVY};margin:18px 0 6px;text-transform:uppercase;letter-spacing:.3px;border-bottom:1px solid #e5e7eb;padding-bottom:3px}
  table{width:100%;border-collapse:collapse;margin:6px 0 8px} th,td{border:1px solid #e5e7eb;padding:6px 8px;vertical-align:top;text-align:left}
  th{background:${NAVY};color:#fff;font-size:11px} td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
  td.k{background:#f8fafc;font-weight:bold;width:28%;color:#374151}
  .bomtbl th,.bomtbl td{font-size:10px;padding:4px 6px}
  .muted{color:#6b7280;font-size:11px} .g{color:#15803d;font-weight:bold} .r{color:#b91c1c;font-weight:bold}
  .grid{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;margin:8px 0}
  .grid.g3{grid-template-columns:1fr 1fr 1fr}
  .cell{border:1px solid #e5e7eb;border-radius:6px;padding:8px} .lbl{font-size:10px;color:#6b7280;text-transform:uppercase} .big{font-size:15px;font-weight:bold;color:#111827;margin-top:2px}
  .formula{background:#f8fafc;border:1px solid #e5e7eb;border-radius:6px;padding:10px;font-size:12px}
  .badge{display:inline-block;padding:3px 10px;border-radius:999px;font-weight:bold;font-size:12px}
  .ok{background:#dcfce7;color:#15803d} .no{background:#fee2e2;color:#b91c1c} .warn{background:#fef3c7;color:#92400e}
  ul{margin:6px 0;padding-left:18px} li{margin-bottom:6px}
  .legal{margin-top:24px;font-size:10.5px;color:#6b7280;line-height:1.5;border-top:1px solid #e5e7eb;padding-top:10px}
  @media print{.noprint{display:none} body{padding:16px}}
</style></head><body>
  <div class="head">
    <div>${company?.logo_png
      ? `<img src="${company.logo_png}" alt="${esc(company.legal_name || "")}" style="max-height:60px;max-width:240px;object-fit:contain"/>`
      : `<div class="brand">${esc(company?.legal_name || "")}</div>`}
      ${company?.legal_name ? `<div class="sub">${esc(company.legal_name)}</div>` : ""}
    </div>
    <div style="text-align:right"><h1>${en ? "Origin Qualification Analysis" : "Análisis de Calificación de Origen"}</h1>
      <div class="sub">${en ? "Trade agreement" : "Tratado"}: <b>${esc(treaty)}</b> · ${en ? "Document No." : "Folio"}: ${esc(folio)}</div>
      <div class="sub">${en ? "Generated" : "Generado"}: ${esc(fecha)}</div></div>
  </div>

  <div class="meta">
    <div><b>${en ? "Final product" : "Producto final"}:</b> ${esc(a.product_sku)} — ${esc(a.product_description)}</div>
    <div><b>${en ? "HS tariff code" : "Fracción arancelaria (HS)"}:</b> ${esc(a.product_hs ? formatHs(a.product_hs) : "—")}</div>
    ${company?.legal_name ? `<div><b>${en ? "Company (producer/exporter)" : "Empresa (productor/exportador)"}:</b> ${esc(company.legal_name)}${company.tax_id ? ` · ${en ? "Tax ID" : "RFC"} ${esc(company.tax_id)}` : ""}</div>` : ""}
    <div><b>${en ? "Analysis type" : "Tipo de análisis"}:</b> ${esc(en ? (automotive ? "Automotive (USMCA)" : "BOM calculation") : a.kind_display)}</div>
  </div>

  ${psrBlock}
  ${coreBlock}

  <div class="section">${en ? "1. Bill of materials (BOM) breakdown" : "1. Desglose de la lista de materiales (BOM) e insumos"}</div>
  ${bom.length ? `<table class="bomtbl">
    <thead><tr><th class="num">#</th><th>${en ? "Material / Description / HS" : "Insumo / Descripción / HS"}</th><th>${en ? "Supplier" : "Proveedor"}</th><th>${en ? "Country" : "País"}</th><th class="num">${en ? "Unit price" : "Precio unit."}</th><th class="num">${en ? "Qty." : "Cant."}</th><th class="num">${en ? "Value" : "Valor"}</th><th>${en ? "Origin" : "Origen"}</th><th>${en ? "How it was determined" : "Cómo se determinó"}</th></tr></thead>
    <tbody>${bomRows}</tbody>
  </table>
  <p class="muted">${en ? "Materials (BOM)" : "Materiales (BOM)"}: <b>$${num(materials ?? d.total_value)} USD</b>${hasConv ? ` · ${en ? "Labor/conversion" : "Mano de obra/conversión"}: <b>$${num(conversion)} USD</b>` : ""} · ${en ? "Net cost of the good" : "Costo neto del bien"}: <b>$${num(base ?? d.total_value)} USD</b> · ${en ? "Non-originating materials (VNM)" : "Materiales no originarios (VNM)"}: <b>$${num(vnm)} USD</b></p>
  <p class="muted">${en
    ? `<b>How to read origin:</b> “Originating” = the material is from a member country of the agreement or meets the applicable rule; “Non-originating” = its value counts as VNM and lowers the RVC. The “How it was determined” column shows the support (supplier declaration, manual entry, sub-assembly calculated by roll-up, or member country).`
    : `<b>Cómo leer el origen:</b> “Originario” = el insumo es del país miembro del tratado o cumple la regla aplicable; “No originario” = su valor cuenta como VNM y resta al VCR. La columna “Cómo se determinó” indica el sustento (declaración del proveedor, captura manual, subensamble calculado por roll-up o país miembro).`}</p>`
    : `<p class="muted">${en ? "This analysis did not record a BOM breakdown." : "Este análisis no registró desglose de BOM."}</p>`}

  ${vcrBlock}
  ${lvcBlock}
  ${recos}

  <div class="legal">
    ${en
      ? `Document generated by <b>LogiQ Aduanas | FTA</b> on ${esc(fecha)} as evidence of the origin qualification
    analysis under the ${esc(treaty)} agreement. The information was <b>processed and calculated by the LogiQ Aduanas
    system</b> using the data provided by <b>${esc(company?.legal_name || (en ? "the company" : "la empresa"))}</b>; the system
    <b>does not manipulate, alter or modify</b> the information, which is strictly entered by the company.
    It consolidates the origin costing information and the applicable product-specific rules of origin. The result is
    for guidance and must be validated by personnel with technical knowledge of rules of origin; keep this file
    for the applicable retention periods (minimum 5 years, USMCA).`
      : `Documento generado por <b>LogiQ Aduanas | FTA</b> el ${esc(fecha)} como evidencia del análisis de calificación de
    origen bajo el tratado ${esc(treaty)}. La información fue <b>procesada y calculada por el sistema LogiQ Aduanas</b>
    utilizando los datos proporcionados por <b>${esc(company?.legal_name || "la empresa")}</b>; el sistema
    <b>no manipula, altera ni modifica</b> la información, la cual es estrictamente ingresada por la empresa.
    Consolida la información de costeo de origen y las reglas de origen específicas aplicables. El resultado es
    orientativo y debe ser validado por personal con conocimientos técnicos en reglas de origen; conserve este
    expediente conforme a los plazos de retención aplicables (mínimo 5 años, T-MEC).`}
  </div>

  <div class="noprint" style="margin-top:24px;text-align:center">
    <button onclick="window.print()" style="background:${NAVY};color:#fff;border:0;padding:10px 20px;border-radius:8px;font-size:14px;cursor:pointer">${en ? "Print / Save as PDF" : "Imprimir / Guardar PDF"}</button>
  </div>
</body></html>`;
  const win = window.open("", "_blank", "width=900,height=1000");
  if (!win) { alert(tr("Permite las ventanas emergentes para generar el PDF del análisis.")); return; }
  win.document.open(); win.document.write(html); win.document.close();
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
    description_en: product?.description_en ?? "",
    kind: product?.kind ?? "finished", hs_code: product?.hs_code ?? "",
    unit_cost: product?.unit_cost ?? "0", currency: product?.currency ?? "USD",
    conversion_cost: product?.conversion_cost ?? "0",
    country_of_origin: product?.country_of_origin ?? "",
    supplier: (product?.supplier ?? "") as number | "",
  });
  const clientsL = useList<Party>(() => api.parties("customer"));
  const [customers, setCustomers] = useState<number[]>(product?.customers ?? []);
  const toggleCustomer = (id: number) =>
    setCustomers((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  const [err, setErr] = useState(""); const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f, v: string | number) => setF({ ...f, [k]: v });
  async function save() {
    if (!f.sku.trim() || !f.description.trim() || !f.hs_code.trim()) {
      setErr("SKU, descripción y fracción arancelaria (HS) son obligatorios."); return;
    }
    setErr(""); setSaving(true);
    const payload = {
      sku: f.sku.trim(), description: f.description.trim(),
      description_en: f.description_en.trim(), kind: f.kind,
      hs_code: f.hs_code.trim(), unit_cost: f.unit_cost || "0",
      currency: f.currency || "USD", conversion_cost: f.conversion_cost || "0",
      country_of_origin: f.country_of_origin.trim().toUpperCase(),
      supplier: f.supplier === "" ? null : Number(f.supplier),
      customers,
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
        <Field label="Número de parte (SKU)">
          <input value={f.sku} onChange={(e) => set("sku", e.target.value.toUpperCase())} className={cx(inputCls, "uppercase")} placeholder="PT-001" autoFocus />
        </Field>
        <Field label="Tipo">
          <select value={f.kind} onChange={(e) => set("kind", e.target.value)} className={inputCls}>
            {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </Field>
        <div className="col-span-2">
          <Field label="Descripción (español)">
            <input value={f.description} onChange={(e) => set("description", e.target.value)} className={inputCls} placeholder="Nombre del producto" />
          </Field>
        </div>
        <div className="col-span-2">
          <Field label="Descripción en inglés (para el certificado, opcional)">
            <input value={f.description_en} onChange={(e) => set("description_en", e.target.value)} className={inputCls} placeholder="Product name in English" />
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
        {f.kind !== "material" && (
          <div className="col-span-2">
            <Field label="Mano de obra y costos de conversión (opcional)">
              <input type="number" step="0.0001" value={f.conversion_cost} onChange={(e) => set("conversion_cost", e.target.value)} className={inputCls} placeholder="0" />
              <p className="mt-1 text-[11px] text-zinc-500">Mano de obra directa + indirectos de fabricación del bien. Es valor regional originario: se suma al costo neto y <strong>sube el VCR</strong>. Ej.: 7.77</p>
            </Field>
          </div>
        )}
        <div className="col-span-2">
          <Field label="Proveedor (opcional)">
            <select value={f.supplier} onChange={(e) => set("supplier", e.target.value === "" ? "" : Number(e.target.value))} className={inputCls}>
              <option value="">— Sin proveedor —</option>
              {suppliers.map((sp) => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
            </select>
          </Field>
        </div>
        <div className="col-span-2">
          <Field label="Cliente(s) que compran esta parte (opcional)">
            {clientsL.data.length === 0
              ? <p className="text-xs text-zinc-400">No tienes clientes. Agrégalos en Catálogos → Clientes.</p>
              : <div className="max-h-36 overflow-y-auto rounded-lg border border-zinc-200">
                  {clientsL.data.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 border-b border-zinc-100 px-3 py-1.5 text-sm last:border-0">
                      <input type="checkbox" checked={customers.includes(c.id)} onChange={() => toggleCustomer(c.id)} />
                      <span className="flex-1 truncate">{c.name}</span>
                    </label>
                  ))}
                </div>}
            <p className="mt-1 text-[11px] text-zinc-500">Al emitir certificados o declarar, podrás filtrar los números de parte por cliente.</p>
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
// Banner del dashboard: insumos (materiales) sin proveedor asignado.
function InsumosSinProveedorBanner({ go }: { go: (v: string) => void }) {
  const { data } = useList<Product>(() => api.products());
  const n = data.filter((p) => p.kind === "material" && !p.supplier).length;
  if (!n) return null;
  return (
    <button onClick={() => go("asignar-proveedor")}
      className="mb-4 flex w-full items-center justify-between rounded-lg border border-amber-200 bg-amber-50 p-3 text-left text-sm text-amber-800 hover:bg-amber-100">
      <span>📦 <strong>{n} insumo{n === 1 ? "" : "s"} sin proveedor asignado.</strong> Da clic para ver cuáles y asignarlos (uno por uno o por layout).</span>
      <span className="font-medium text-amber-700">Asignar →</span>
    </button>
  );
}
// Vista para asignar proveedor a los insumos que no lo tienen.
function AsignarProveedorView() {
  const { data, reload, loading } = useList<Product>(() => api.products());
  const sup = useList<Party>(() => api.parties("supplier"));
  const [bulk, setBulk] = useState(false);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState("");
  const sinProv = smartFilter(data.filter((p) => p.kind === "material" && !p.supplier), q, (p) => [p.sku, p.description]);
  async function asignar(p: Product, sid: string) {
    if (!sid) return;
    setMsg("");
    try { await api.updateProduct(p.id, { supplier: Number(sid) }); await reload(); }
    catch (e) { setMsg((e as Error).message); }
  }
  return (
    <div>
      <PageTitle title="Insumos sin proveedor" desc="Asigna un proveedor a cada insumo, uno por uno o por layout (Excel). Si el proveedor no existe en el layout, se precarga automáticamente." />
      <div className="mb-3 flex">
        <div className="ml-auto"><Btn variant="ghost" onClick={() => setBulk(true)}><Upload size={15} className="-mt-0.5 mr-1 inline" />Asignar por layout</Btn></div>
      </div>
      <ReportToolbar q={q} setQ={setQ} onExport={() => exportCSV("insumos_sin_proveedor", ["Núm. de parte", "Descripción", "HS"], sinProv.map((p) => [p.sku, p.description, p.hs_code ?? ""]))} placeholder="Buscar insumo…" />
      {msg && <p className="mb-3 text-sm text-amber-600">{msg}</p>}
      <Table head={["Núm. de parte", "Descripción", "HS", "Asignar proveedor"]}>
        {sinProv.map((p) => (
          <tr key={p.id}>
            <td className="px-4 py-3 font-mono text-xs">{p.sku}</td>
            <td className="px-4 py-3">{p.description}</td>
            <td className="px-4 py-3 font-mono text-xs">{p.hs_code ? formatHs(p.hs_code) : "—"}</td>
            <td className="px-4 py-3">
              <select className={cx(inputCls, "max-w-xs")} defaultValue="" onChange={(e) => asignar(p, e.target.value)}>
                <option value="">Elegir proveedor…</option>
                {sup.data.map((s) => <option key={s.id} value={s.id}>{s.name}{s.code ? ` (${s.code})` : ""}</option>)}
              </select>
            </td>
          </tr>
        ))}
        {!loading && sinProv.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-zinc-400">Todos los insumos tienen proveedor asignado. 🎉</td></tr>}
      </Table>
      {bulk && (
        <CargaMasivaModal specType="supplier_assign" title="Asignar proveedor por layout" onClose={() => setBulk(false)} onDone={reload}
          hint="Sube el número de parte (SKU) y el código de proveedor. Si el proveedor no existe, se precarga automáticamente (complétalo luego en Proveedores)."
          templateFn={() => api.bulkTemplate("supplier_assign")} importFn={(f) => api.bulkImport("supplier_assign", f)} />
      )}
    </div>
  );
}
function InsumosView() {
  const { data, reload, loading } = useList<Product>(() => api.products());
  const parties = useList<Party>(() => api.parties());
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [logFor, setLogFor] = useState<Product | null>(null);
  const [histFor, setHistFor] = useState<Product | null>(null);
  const [bomFor, setBomFor] = useState<Product | null>(null);
  const [docsFor, setDocsFor] = useState<Product | null>(null);
  const [bulk, setBulk] = useState<"products" | "bom" | null>(null);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState("");
  const suppliers = parties.data.filter((p) => p.kind === "supplier");
  const vis = smartFilter(data, q, (p) => [p.sku, p.description, p.hs_code, p.supplier_name]);
  function exportar() {
    exportCSV("numeros_de_parte", ["Núm. de parte", "Tipo", "Descripción", "Proveedor", "HS", "País", "Precio unitario", "Moneda", "Estatus"],
      vis.map((p) => [p.sku, p.kind_display ?? p.kind, p.description, p.supplier_name ?? "", p.hs_code ?? "", p.country_of_origin ?? "", p.unit_cost ?? "", p.currency ?? "", p.is_active ? "Activo" : "Inactivo"]));
  }
  async function del(p: Product) {
    if (!confirm(tr(`¿Eliminar el número de parte “${p.sku}”?`))) return;
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
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="ml-auto flex gap-2">
          <Btn variant="ghost" onClick={() => setBulk("bom")}><Upload size={15} className="-mt-0.5 mr-1 inline" />BOM masivo</Btn>
          <Btn variant="ghost" onClick={() => setBulk("products")}><Upload size={15} className="-mt-0.5 mr-1 inline" />Carga masiva</Btn>
          <Btn onClick={() => setEditing("new")}><Plus size={15} className="-mt-0.5 mr-1 inline" />Nuevo número de parte</Btn>
        </div>
      </div>
      {msg && <p className="mb-3 text-sm text-emerald-700">{msg}</p>}
      <ReportToolbar q={q} setQ={setQ} onExport={exportar} />
      {suppliers.length === 0 && !loading && (
        <Card className="mb-4 p-4 text-sm text-amber-700">
          Primero da de alta al menos un proveedor en <strong>Catálogos → Proveedores</strong> para poder ligarle números de parte.
        </Card>
      )}
      <Table head={["Núm. de parte", "Tipo", "Descripción", "Proveedor", "HS", "País", "Precio unitario", "Estatus", ""]}>
        {vis.map((p) => (
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
            <td className="px-4 py-3 font-mono text-xs">
              {p.unit_cost} {p.currency}
              {(p.change_log_count ?? 0) > 0 && (
                <button onClick={() => setHistFor(p)} title="Ver histórico de precio y origen"
                  className="ml-2 font-sans text-[11px] text-blue-600 hover:underline">histórico</button>
              )}
            </td>
            <td className="px-4 py-3">
              <span className={cx("rounded-full px-2 py-0.5 text-xs font-medium",
                p.is_active ? "bg-green-100 text-green-700" : "bg-zinc-200 text-zinc-600")}>
                {p.is_active ? "Activo" : "Inactivo"}
              </span>
            </td>
            <td className="px-4 py-3 text-right whitespace-nowrap">
              {p.kind !== "material" && (
                <span className="mr-2 inline-block"><Btn size="sm" variant="ghost" onClick={() => setBomFor(p)}>BOM</Btn></span>
              )}
              <button onClick={() => setDocsFor(p)} title="Certificados de origen (PDF) de este insumo"
                className="mr-1 rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-emerald-600"><FileText size={15} /></button>
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
      {histFor && <PriceHistoryModal product={histFor} onClose={() => setHistFor(null)} />}
      {bomFor && <BomEditorModal product={bomFor} allProducts={data} onClose={() => setBomFor(null)} />}
      {docsFor && <OriginDocsModal product={docsFor} suppliers={suppliers} onClose={() => setDocsFor(null)} />}
      {bulk === "products" && (
        <CargaMasivaModal specType="products" title="Carga masiva de números de parte" onClose={() => setBulk(null)} onDone={reload}
          hint="Da de alta o actualiza muchos insumos/productos a la vez. Los que YA existen NO se duplican: se actualizan sus datos (precio, descripción, HS, país…) con lo que traiga el Excel; los que no existen se crean. La columna 'tipo' acepta material, subensamble o terminado; el código de proveedor liga (o precarga) al proveedor."
          templateFn={() => api.bulkTemplate("products")} importFn={(f) => api.bulkImport("products", f)} previewFn={(f) => api.bulkPreview("products", f)} />
      )}
      {bulk === "bom" && (
        <CargaMasivaModal specType="bom" title="Carga masiva de BOM" onClose={() => setBulk(null)} onDone={reload}
          hint="Arma las listas de materiales en lote: cada fila liga un producto (padre) con un insumo (componente) por SKU. El país de origen es opcional (lo deja en manual)."
          templateFn={() => api.bulkTemplate("bom")} importFn={(f) => api.bulkImport("bom", f)} />
      )}
    </div>
  );
}
function InsumoForm({ insumo, suppliers, onClose, onSaved }: {
  insumo: Product | null; suppliers: Party[]; onClose: () => void; onSaved: () => void;
}) {
  const [f, setF] = useState({
    sku: insumo?.sku ?? "", description: insumo?.description ?? "",
    description_en: insumo?.description_en ?? "",
    kind: insumo?.kind ?? "material",
    supplier: (insumo?.supplier ?? "") as number | "",
    hs_code: insumo?.hs_code ?? "", unit_cost: insumo?.unit_cost ?? "0",
    currency: insumo?.currency ?? "USD", country_of_origin: insumo?.country_of_origin ?? "",
    is_active: insumo?.is_active ?? true,
  });
  // Un PRODUCTO (terminado) se relaciona con CLIENTES que lo compran; un
  // insumo/subproducto, con el PROVEEDOR que lo surte.
  const esProducto = f.kind === "finished";
  const clientes = useList<Party>(() => api.parties("customer"));
  const [customers, setCustomers] = useState<number[]>(insumo?.customers ?? []);
  const toggleCustomer = (id: number) =>
    setCustomers((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  const [err, setErr] = useState(""); const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f, v: string | number | boolean) => setF({ ...f, [k]: v });
  async function save() {
    if (!f.sku.trim() || !f.description.trim()) {
      setErr("El número de parte y la descripción son obligatorios."); return;
    }
    setErr(""); setSaving(true);
    const payload = {
      sku: f.sku.trim(), description: f.description.trim(),
      description_en: f.description_en.trim(), kind: f.kind,
      hs_code: f.hs_code, unit_cost: f.unit_cost || "0",
      currency: f.currency || "USD",
      country_of_origin: f.country_of_origin.trim().toUpperCase(),
      is_active: f.is_active,
      // Solo se envía la relación que aplica al tipo (PATCH parcial: la otra no se toca).
      ...(esProducto
        ? { customers }
        : { supplier: f.supplier === "" ? null : Number(f.supplier) }),
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
          <input value={f.sku} onChange={(e) => set("sku", e.target.value.toUpperCase())} className={cx(inputCls, "font-mono uppercase")} placeholder="7782-A" autoFocus />
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
          <Field label="Descripción (español)">
            <input value={f.description} onChange={(e) => set("description", e.target.value)} className={inputCls} placeholder="Nombre del insumo" />
          </Field>
        </div>
        <div className="col-span-2">
          <Field label="Descripción en inglés (para el certificado, opcional)">
            <input value={f.description_en} onChange={(e) => set("description_en", e.target.value)} className={inputCls} placeholder="Part name in English" />
          </Field>
        </div>
        <div className="col-span-2">
          {esProducto ? (
            <Field label="Cliente(s) que compran esta parte">
              {clientes.data.length === 0 ? (
                <p className="rounded-lg border border-dashed border-zinc-300 px-3 py-2 text-sm text-zinc-400">
                  No tienes clientes. Agrégalos en Catálogos → Clientes.
                </p>
              ) : (
                <div className="max-h-36 space-y-1 overflow-y-auto rounded-lg border border-zinc-200 p-2">
                  {clientes.data.map((c) => (
                    <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-zinc-50">
                      <input type="checkbox" checked={customers.includes(c.id)} onChange={() => toggleCustomer(c.id)} />
                      <span>{c.name}{c.code ? ` (${c.code})` : ""}</span>
                    </label>
                  ))}
                </div>
              )}
            </Field>
          ) : (
            <Field label="Proveedor">
              <select value={f.supplier} onChange={(e) => set("supplier", e.target.value === "" ? "" : Number(e.target.value))} className={inputCls}>
                <option value="">— Selecciona un proveedor —</option>
                {suppliers.map((sp) => <option key={sp.id} value={sp.id}>{sp.name}{sp.code ? ` (${sp.code})` : ""}</option>)}
              </select>
            </Field>
          )}
        </div>
        <Field label="Precio unitario">
          <input type="number" step="0.0001" value={f.unit_cost} onChange={(e) => set("unit_cost", e.target.value)} className={inputCls} />
        </Field>
        <Field label="Moneda">
          <input value={f.currency} onChange={(e) => set("currency", e.target.value.toUpperCase())} className={cx(inputCls, "uppercase")} maxLength={3} />
        </Field>
        <Field label="País de origen (ISO-2)">
          <input value={f.country_of_origin} onChange={(e) => set("country_of_origin", e.target.value.replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 2))} className={cx(inputCls, "uppercase")} placeholder="MX" maxLength={2} />
        </Field>
      </div>
      <p className="mt-2 text-xs text-zinc-400">El <strong>país de origen</strong> también puede definirlo el proveedor desde su acceso, o traerse de sus declaraciones al armar el BOM.</p>
      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
        <Btn onClick={save} disabled={saving}>{saving ? "Guardando…" : insumo ? "Guardar cambios" : "Crear número de parte"}</Btn>
      </div>
    </Modal>
  );
}
/* ==== Certificados de origen (PDF) que la empresa ya tiene de un insumo ==== */
function OriginDocsModal({ product, suppliers, onClose }: {
  product: Product; suppliers: Party[]; onClose: () => void;
}) {
  const docs = useList<ProductOriginDoc>(() => api.productOriginDocs(product.id));
  const treaties = useList<Treaty>(() => api.treaties());
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [f, setF] = useState({
    supplier: (product.supplier ?? "") as number | "", treaty: "" as number | "",
    valid_from: "", valid_to: "", notes: "",
    register: false, is_originating: true, country: product.country_of_origin ?? "",
  });
  const set = (k: keyof typeof f, v: string | number | boolean) => setF({ ...f, [k]: v });
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  async function subir() {
    if (!file) { setErr("Elige el archivo PDF del certificado."); return; }
    if (file.size > 10_000_000) { setErr("El archivo es muy grande (máximo ~10 MB)."); return; }
    setErr(""); setBusy(true);
    try {
      const b64 = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(",")[1] ?? "");
        r.onerror = rej; r.readAsDataURL(file);
      });
      await api.uploadProductOriginDoc(product.id, {
        filename: file.name, content_type: file.type || "application/pdf", data_b64: b64,
        supplier: f.supplier === "" ? null : f.supplier,
        treaty: f.treaty === "" ? null : f.treaty,
        valid_from: f.valid_from || null, valid_to: f.valid_to || null,
        notes: f.notes, register_declaration: f.register,
        is_originating: f.is_originating, country_of_origin: f.country,
      });
      setFile(null); if (fileInput.current) fileInput.current.value = "";
      await docs.reload();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function borrar(d: ProductOriginDoc) {
    if (!confirm(tr(`¿Eliminar “${d.filename}”?${d.has_declaration ? " También se eliminará la declaración de origen que se registró con él." : ""}`))) return;
    setErr(""); setBusy(true);
    try { await api.deleteProductOriginDoc(product.id, d.id); await docs.reload(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  const kb = (n: number) => n > 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`;
  return (
    <Modal title={`Certificados de origen — ${product.sku}`} onClose={onClose}>
      <p className="mb-4 text-sm text-zinc-500">
        Si ya tienes el <strong>certificado de origen en PDF</strong> de este insumo (te lo dio tu
        proveedor por fuera), súbelo aquí directamente: no hace falta que el proveedor entre a su
        portal. Queda guardado como evidencia del expediente.
      </p>
      <div className="mb-4 overflow-hidden rounded-lg border border-zinc-200">
        {docs.data.length === 0 && <div className="px-3 py-4 text-center text-sm text-zinc-400">Aún no hay certificados subidos para este insumo.</div>}
        {docs.data.map((d) => (
          <div key={d.id} className="flex items-center justify-between gap-2 border-b border-zinc-100 px-3 py-2 last:border-0">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <FileText size={14} className="shrink-0 text-emerald-600" />
                <button onClick={() => api.downloadProductOriginDoc(product.id, d.id, d.filename)}
                  className="truncate text-sm font-medium text-blue-700 hover:underline" title="Descargar">{d.filename}</button>
                {d.has_declaration && <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">con declaración</span>}
              </div>
              <div className="mt-0.5 text-[11px] text-zinc-400">
                {d.treaty_code ? `${treatyLabel(d.treaty_code)} · ` : ""}{d.supplier_name ? `${d.supplier_name} · ` : ""}
                {d.valid_from && d.valid_to ? `vigencia ${d.valid_from} → ${d.valid_to} · ` : ""}{kb(d.size)}
                {d.uploaded_by_name ? ` · subió ${d.uploaded_by_name}` : ""}{d.notes ? ` · ${d.notes}` : ""}
              </div>
            </div>
            <button onClick={() => borrar(d)} disabled={busy} title="Eliminar"
              className="shrink-0 rounded-lg p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={15} /></button>
          </div>
        ))}
      </div>
      <h4 className="mb-2 text-sm font-semibold text-zinc-800">Subir certificado</h4>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Field label="Archivo (PDF)">
            <input ref={fileInput} type="file" accept=".pdf,application/pdf,image/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-zinc-600 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-blue-700 hover:file:bg-blue-100" />
          </Field>
        </div>
        <Field label="Proveedor que lo emitió">
          <select value={f.supplier} onChange={(e) => set("supplier", e.target.value === "" ? "" : Number(e.target.value))} className={inputCls}>
            <option value="">— Sin especificar —</option>
            {suppliers.map((sp) => <option key={sp.id} value={sp.id}>{sp.name}{sp.code ? ` (${sp.code})` : ""}</option>)}
          </select>
        </Field>
        <Field label="Tratado que ampara">
          <select value={f.treaty} onChange={(e) => set("treaty", e.target.value === "" ? "" : Number(e.target.value))} className={inputCls}>
            <option value="">— Sin especificar —</option>
            {treaties.data.map((t) => <option key={t.id} value={t.id}>{treatyLabel(t.code)}</option>)}
          </select>
        </Field>
        <Field label="Vigente desde">
          <input type="date" value={f.valid_from} onChange={(e) => set("valid_from", e.target.value)} className={inputCls} />
        </Field>
        <Field label="Vigente hasta">
          <input type="date" value={f.valid_to} onChange={(e) => set("valid_to", e.target.value)} className={inputCls} />
        </Field>
        <div className="col-span-2">
          <Field label="Notas (opcional)">
            <input value={f.notes} onChange={(e) => set("notes", e.target.value)} className={inputCls} placeholder="Folio, observaciones…" />
          </Field>
        </div>
      </div>
      <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm">
        <input type="checkbox" checked={f.register} onChange={(e) => set("register", e.target.checked)} className="mt-0.5" />
        <span>
          <strong>Registrar también la declaración de origen</strong> con este certificado como
          respaldo, para que el <strong>cálculo de origen</strong> la tome en cuenta (igual que si
          el proveedor la hubiera respondido). Requiere tratado, vigencia y proveedor.
        </span>
      </label>
      {f.register && (
        <div className="mt-2 grid grid-cols-2 gap-3">
          <Field label="¿El insumo es originario?">
            <select value={f.is_originating ? "1" : "0"} onChange={(e) => set("is_originating", e.target.value === "1")} className={inputCls}>
              <option value="1">Sí, originario</option>
              <option value="0">No originario</option>
            </select>
          </Field>
          <Field label="País de origen (ISO-2)">
            <input value={f.country} onChange={(e) => set("country", e.target.value.replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 2))}
              className={cx(inputCls, "uppercase")} placeholder="MX" maxLength={2} />
          </Field>
        </div>
      )}
      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Btn variant="ghost" onClick={onClose}>Cerrar</Btn>
        <Btn onClick={subir} disabled={busy || !file}><Upload size={15} className="-mt-0.5 mr-1 inline" />{busy ? "Subiendo…" : "Subir certificado"}</Btn>
      </div>
    </Modal>
  );
}
function CalificacionesView() {
  const { data, count } = useList<Qualification & { product: number }>(() => api.qualifications());
  const products = useList<Product>(() => api.products());
  const clientes = useList<Party>(() => api.parties("customer"));
  const name = (pid: number) => products.data.find((p) => p.id === pid)?.sku ?? `#${pid}`;
  const [q, setQ] = useState("");
  const [layoutCliente, setLayoutCliente] = useState<number | "">("");
  const [layoutsFor, setLayoutsFor] = useState<Party | null>(null);
  const [pdfMsg, setPdfMsg] = useState("");
  const vis = smartFilter(data, q, (x) => [name(x.product), treatyLabel(x.treaty_code), x.criterion, x.status_display]);
  // PDF del cálculo: usa el análisis más reciente guardado para ese producto+tratado.
  async function pdfDe(qz: Qualification) {
    setPdfMsg("");
    try {
      const r = await api.originAnalyses(qz.product, qz.treaty);
      const list = Array.isArray(r) ? r : r.results;
      if (!list.length) { setPdfMsg(`${name(qz.product)}: aún no hay un cálculo guardado. Córrelo en “Cálculo de origen”.`); return; }
      const [a, prof] = await Promise.all([
        api.originAnalysis(list[0].id),
        api.companyProfile().catch(() => null),
      ]);
      generarAnalisisPDF(a, prof ? { legal_name: prof.legal_name, tax_id: prof.tax_id, logo_png: prof.logo_png } : undefined);
    } catch (e) { setPdfMsg((e as Error).message); }
  }
  function exportar() {
    exportCSV("calificaciones", ["Producto", "Tratado", "Criterio", "VCR", "Resultado"],
      vis.map((x) => [name(x.product), treatyLabel(x.treaty_code), x.criterion || "", x.rvc_value ? `${x.rvc_value}%` : "", x.status_display]));
  }
  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageTitle title="Calificaciones" desc={`${count} calificaciones registradas.`} />
        <div className="flex items-end gap-2">
          <div>
            <span className="mb-1 block text-xs font-semibold text-zinc-700">Layout del portal de un cliente</span>
            <select value={layoutCliente} onChange={(e) => setLayoutCliente(e.target.value ? Number(e.target.value) : "")}
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm">
              <option value="">Elige un cliente…</option>
              {clientes.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <Btn variant="ghost" disabled={!layoutCliente}
            onClick={() => { const c = clientes.data.find((x) => x.id === layoutCliente); if (c) setLayoutsFor(c); }}>
            <Download size={15} className="-mt-0.5 mr-1 inline" />Generar layout
          </Btn>
        </div>
      </div>
      <ReportToolbar q={q} setQ={setQ} onExport={exportar} />
      {pdfMsg && <p className="mb-3 text-sm text-amber-600">{pdfMsg}</p>}
      {vis.some((x) => x.status === "AUTO_REVIEW") && <AutoReviewBox />}
      <Table head={["Producto", "Tratado", "Criterio", "VCR", "Resultado", ""]}>
        {vis.map((q) => (
          <tr key={q.id}>
            <td className="px-4 py-3 font-mono text-xs">{name(q.product)}</td>
            <td className="px-4 py-3 text-xs">{treatyLabel(q.treaty_code)}</td>
            <td className="px-4 py-3">{q.criterion || "—"}</td>
            <td className="px-4 py-3">{q.rvc_value ? `${q.rvc_value}%` : "—"}</td>
            <td className="px-4 py-3"><Pill k={q.status}>{q.status_display}</Pill></td>
            <td className="px-4 py-3 text-right">
              <button onClick={() => pdfDe(q)} className="text-xs font-medium text-blue-600 hover:underline">PDF del cálculo</button>
            </td>
          </tr>
        ))}
      </Table>
      {layoutsFor && <ClientLayoutsModal client={layoutsFor} onClose={() => setLayoutsFor(null)} />}
    </div>
  );
}
function ProveedoresView({ me }: { me: Me }) {
  const { data, reload, loading } = useList<Party>(() => api.parties("supplier"));
  const [editing, setEditing] = useState<Party | "new" | null>(null);
  const [access, setAccess] = useState<Party | null>(null);
  const [bulk, setBulk] = useState(false);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState("");
  const vis = smartFilter(data, q, (p) => [p.code, p.name, p.tax_id, p.country]);
  function exportar() {
    exportCSV("proveedores", ["Código", "Proveedor", "País", "RFC / Tax ID", "Email", "Teléfono"],
      vis.map((p) => [p.code ?? "", p.name, p.country ?? "", p.tax_id ?? "", p.email ?? "", p.phone ?? ""]));
  }
  async function del(p: Party) {
    if (!confirm(tr(`¿Eliminar el proveedor “${p.name}”?`))) return;
    setMsg(""); try { await api.deleteParty(p.id); await reload(); }
    catch (e) { setMsg((e as Error).message); }
  }
  return (
    <div>
      <PageTitle title="Proveedores" desc="Tu padrón de proveedores. Asígnales un código y crea su acceso." />
      <div className="mb-4 flex">
        <div className="ml-auto flex gap-2">
          <Btn variant="ghost" onClick={() => setBulk(true)}><Upload size={15} className="-mt-0.5 mr-1 inline" />Carga masiva</Btn>
          <Btn onClick={() => setEditing("new")}><Plus size={15} className="-mt-0.5 mr-1 inline" />Nuevo proveedor</Btn>
        </div>
      </div>
      {msg && <p className="mb-3 text-sm text-amber-600">{msg}</p>}
      <ReportToolbar q={q} setQ={setQ} onExport={exportar} placeholder="Buscar proveedor… (código o nombre)" />
      <Table head={["Código", "Proveedor", "País", "RFC / Tax ID", "Acceso", ""]}>
        {vis.map((p) => (
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
      {bulk && (
        <CargaMasivaModal specType="suppliers" title="Carga masiva de proveedores" onClose={() => setBulk(false)} onDone={reload}
          hint="Da de alta o actualiza muchos proveedores a la vez. Se busca por código (o por nombre) para actualizar el existente."
          templateFn={() => api.bulkTemplate("suppliers")} importFn={(f) => api.bulkImport("suppliers", f)} />
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
    if (!confirm(tr(`¿Quitar el usuario “${u.username}”? Ya no podrá entrar.`))) return;
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
// Catálogo de CLIENTES (Party kind=customer) — a quienes se emiten certificados.
// Campos de FTA que se pueden mapear a una columna del layout del cliente
// (refleja apps/origin/layouts.py LAYOUT_FIELDS).
const LAYOUT_FIELDS = [
  { v: "", l: "— No llenar esta columna —" },
  { v: "sku", l: "Núm. de parte (SKU)" },
  { v: "description", l: "Descripción" },
  { v: "hs", l: "Fracción HS (solo dígitos)" },
  { v: "hs_formatted", l: "Fracción HS (con punto, ej. 8708.80)" },
  { v: "origin_yn", l: "¿Originario? (Y/N)" },
  { v: "origin_sino", l: "¿Originario? (SÍ/NO)" },
  { v: "status", l: "Resultado de origen (texto)" },
  { v: "criterion", l: "Criterio de origen" },
  { v: "rvc", l: "VCR (%)" },
  { v: "country", l: "País de origen del producto" },
  { v: "treaty", l: "Tratado" },
  { v: "period_from", l: "Vigencia desde" },
  { v: "period_to", l: "Vigencia hasta" },
  { v: "date", l: "Fecha de generación" },
  { v: "company_name", l: "Razón social de tu empresa" },
  { v: "company_tax_id", l: "RFC / Tax ID de tu empresa" },
  { v: "company_country", l: "País de tu empresa" },
  { v: "client_name", l: "Nombre del cliente" },
  { v: "supplier_name", l: "Proveedor del producto" },
  { v: "unit_cost", l: "Costo unitario" },
  { v: "currency", l: "Moneda" },
];
const colOrder = (a: string, b: string) => a.length - b.length || a.localeCompare(b);

// Plantillas del portal de origen del cliente: subir por tratado, mapear columnas
// y generar el archivo con los cálculos de origen, listo para su portal.
function ClientLayoutsModal({ client, onClose }: { client: Party; onClose: () => void }) {
  const treaties = useList<Treaty>(() => api.treaties());
  const [layouts, setLayouts] = useState<ClientLayout[]>([]);
  const [mode, setMode] = useState<{ t: "map" | "gen"; layout: ClientLayout } | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [upTreaty, setUpTreaty] = useState<number | "">("");
  const [upFile, setUpFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(""); const [err, setErr] = useState("");
  const [genProducts, setGenProducts] = useState<Product[]>([]);
  const [genQuals, setGenQuals] = useState<Record<number, Qualification>>({});
  const [genSel, setGenSel] = useState<Set<number>>(new Set());
  const [genQ, setGenQ] = useState("");
  const [genFrom, setGenFrom] = useState(""); const [genTo, setGenTo] = useState("");

  const load = useCallback(async () => {
    const d = await api.clientLayouts(client.id);
    setLayouts((d as { results?: ClientLayout[] }).results ?? (d as ClientLayout[]));
  }, [client.id]);
  useEffect(() => { load().catch((e) => setErr((e as Error).message)); }, [load]);

  async function subir() {
    if (!upTreaty || !upFile) { setErr("Elige el tratado y el archivo .xlsx de tu cliente."); return; }
    setBusy(true); setErr(""); setMsg("");
    try {
      const l = await api.uploadClientLayout({ client: client.id, treaty: Number(upTreaty), file: upFile });
      setUpFile(null); setUpTreaty(""); await load();
      setMode({ t: "map", layout: l }); setMapping(l.mapping ?? {});
      setMsg("Plantilla cargada. Ahora indica qué dato de FTA va en cada columna.");
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  function abrirMapeo(l: ClientLayout) { setMode({ t: "map", layout: l }); setMapping(l.mapping ?? {}); setMsg(""); setErr(""); }
  async function guardarMapeo() {
    if (!mode) return;
    setBusy(true); setErr("");
    try { await api.updateClientLayout(mode.layout.id, { mapping }); await load(); setMode(null); setMsg("Mapeo guardado."); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function abrirGen(l: ClientLayout) {
    setMode({ t: "gen", layout: l }); setMsg(""); setErr(""); setGenQ("");
    try {
      const [prods, quals] = await Promise.all([api.products(), api.qualifications()]);
      const plist: Product[] = (prods as { results?: Product[] }).results ?? (prods as Product[]);
      const qlist: Qualification[] = (quals as { results?: Qualification[] }).results ?? (quals as Qualification[]);
      const byProd: Record<number, Qualification> = {};
      qlist.filter((x) => x.treaty === l.treaty).forEach((x) => { byProd[x.product] = x; });
      const withQual = plist.filter((p) => byProd[p.id]);
      setGenProducts(withQual); setGenQuals(byProd);
      setGenSel(new Set(withQual.filter((p) => byProd[p.id].status === "QUALIFIES").map((p) => p.id)));
    } catch (e) { setErr((e as Error).message); }
  }
  async function generar() {
    if (!mode || genSel.size === 0) { setErr("Selecciona al menos un producto."); return; }
    setBusy(true); setErr("");
    try {
      await api.generateClientLayout(mode.layout.id,
        { products: [...genSel], period_from: genFrom || "", period_to: genTo || "" },
        `layout_${client.name.replace(/\s+/g, "_")}_${mode.layout.treaty_code ?? ""}.xlsx`);
      setMsg("Archivo generado y descargado: súbelo al portal de tu cliente.");
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function del(l: ClientLayout) {
    if (!confirm(tr(`¿Eliminar la plantilla ${l.treaty_code} de ${client.name}?`))) return;
    try { await api.deleteClientLayout(l.id); setMode(null); await load(); }
    catch (e) { setErr((e as Error).message); }
  }
  const genVis = smartFilter(genProducts, genQ, (p) => [p.sku, p.description]);
  return (
    <Modal title={`Layouts del portal de origen — ${client.name}`} onClose={onClose} wide>
      <p className="mb-3 text-sm text-zinc-500">Sube la plantilla (.xlsx) que te exige el portal de origen de tu cliente (una por tratado),
        indica qué dato va en cada columna y genera el archivo lleno con tus cálculos de origen, listo para subir a su portal.</p>
      <Table head={["Tratado", "Plantilla", "Columnas mapeadas", ""]}>
        {layouts.map((l) => (
          <tr key={l.id}>
            <td className="px-4 py-3">{treatyLabel(l.treaty_code)}</td>
            <td className="px-4 py-3 text-xs">{l.name || l.filename}<div className="text-[11px] text-zinc-400">{l.filename} · hoja “{l.sheet_name}”</div></td>
            <td className="px-4 py-3 text-xs">{Object.keys(l.mapping ?? {}).length} de {Object.keys(l.headers ?? {}).length}</td>
            <td className="px-4 py-3 text-right whitespace-nowrap">
              <span className="mr-1 inline-block"><Btn size="sm" variant="ghost" onClick={() => abrirMapeo(l)}>Mapear columnas</Btn></span>
              <span className="mr-1 inline-block"><Btn size="sm" onClick={() => abrirGen(l)} disabled={!Object.keys(l.mapping ?? {}).length}>Generar archivo</Btn></span>
              <button onClick={() => del(l)} title="Eliminar" className="rounded-lg p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={15} /></button>
            </td>
          </tr>
        ))}
        {layouts.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-zinc-400">Aún no hay plantillas de este cliente. Sube la primera abajo.</td></tr>}
      </Table>
      <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-zinc-300 p-3">
        <div>
          <span className="mb-1 block text-xs font-semibold text-zinc-700">Tratado</span>
          <select value={upTreaty} onChange={(e) => setUpTreaty(e.target.value ? Number(e.target.value) : "")} className={inputCls}>
            <option value="">Elige…</option>
            {treaties.data.map((t) => <option key={t.id} value={t.id}>{treatyLabel(t.code)} — {t.name}</option>)}
          </select>
        </div>
        <div className="min-w-[14rem] flex-1">
          <span className="mb-1 block text-xs font-semibold text-zinc-700">Plantilla del cliente (.xlsx)</span>
          <input type="file" accept=".xlsx" onChange={(e) => setUpFile(e.target.files?.[0] ?? null)}
            className="text-sm text-zinc-600 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-blue-700 hover:file:bg-blue-100" />
        </div>
        <Btn onClick={subir} disabled={busy}><Upload size={15} className="-mt-0.5 mr-1 inline" />{busy ? "Subiendo…" : "Subir plantilla"}</Btn>
      </div>
      {msg && <p className="mt-3 text-sm text-emerald-700">{msg}</p>}
      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}

      {mode?.t === "map" && (
        <div className="mt-4 rounded-lg border border-zinc-200 p-3">
          <div className="mb-2 text-sm font-semibold text-zinc-700">Mapeo de columnas — {treatyLabel(mode.layout.treaty_code)} (encabezados en la fila {mode.layout.header_row})</div>
          <p className="mb-2 text-xs text-zinc-500">Por cada columna de la plantilla de tu cliente, elige qué dato de FTA debe llenarla.</p>
          <div className="grid gap-1.5 md:grid-cols-2">
            {Object.keys(mode.layout.headers ?? {}).sort(colOrder).map((col) => (
              <div key={col} className="flex items-center gap-2">
                <span className="w-44 truncate text-xs" title={mode.layout.headers[col]}>
                  <code className="rounded bg-zinc-100 px-1 text-[10px]">{col}</code> {mode.layout.headers[col]}
                </span>
                <select value={mapping[col] ?? ""} onChange={(e) => setMapping((m) => ({ ...m, [col]: e.target.value }))}
                  className="flex-1 rounded-lg border border-zinc-300 px-2 py-1 text-xs">
                  {LAYOUT_FIELDS.map((f) => <option key={f.v} value={f.v}>{f.l}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Btn variant="ghost" size="sm" onClick={() => setMode(null)}>Cancelar</Btn>
            <Btn size="sm" onClick={guardarMapeo} disabled={busy}>{busy ? "Guardando…" : "Guardar mapeo"}</Btn>
          </div>
        </div>
      )}

      {mode?.t === "gen" && (
        <div className="mt-4 rounded-lg border border-zinc-200 p-3">
          <div className="mb-2 text-sm font-semibold text-zinc-700">Generar archivo — {treatyLabel(mode.layout.treaty_code)}</div>
          <p className="mb-2 text-xs text-zinc-500">Se incluye una fila por producto con su cálculo de origen. Solo aparecen productos con calificación para este tratado; los que CALIFICAN vienen preseleccionados.</p>
          <div className="mb-2 flex flex-wrap items-end gap-2">
            <input value={genQ} onChange={(e) => setGenQ(e.target.value)} placeholder="Filtrar productos…" className={cx(inputCls, "w-56")} />
            <div><span className="mb-1 block text-[11px] font-semibold text-zinc-600">Vigencia desde</span>
              <input type="date" value={genFrom} onChange={(e) => setGenFrom(e.target.value)} className={inputCls} /></div>
            <div><span className="mb-1 block text-[11px] font-semibold text-zinc-600">Vigencia hasta</span>
              <input type="date" value={genTo} onChange={(e) => setGenTo(e.target.value)} className={inputCls} /></div>
            <span className="text-xs text-zinc-500">{genSel.size} seleccionados</span>
          </div>
          <div className="max-h-56 overflow-auto rounded-lg border border-zinc-100">
            {genVis.map((p) => {
              const qual = genQuals[p.id];
              return (
                <label key={p.id} className="flex cursor-pointer items-center gap-2 border-b border-zinc-50 px-3 py-1.5 text-xs hover:bg-zinc-50">
                  <input type="checkbox" checked={genSel.has(p.id)}
                    onChange={(e) => setGenSel((s) => { const n = new Set(s); if (e.target.checked) n.add(p.id); else n.delete(p.id); return n; })} />
                  <span className="w-40 font-mono">{p.sku}</span>
                  <span className="flex-1 truncate text-zinc-500">{p.description}</span>
                  <Pill k={qual?.status}>{qual?.status_display ?? "Sin calcular"}</Pill>
                </label>
              );
            })}
            {genProducts.length === 0 && <p className="px-3 py-4 text-center text-xs text-zinc-400">No hay productos con calificación para este tratado. Califícalos primero en “Cálculo de origen”.</p>}
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Btn variant="ghost" size="sm" onClick={() => setMode(null)}>Cerrar</Btn>
            <Btn size="sm" onClick={generar} disabled={busy || genSel.size === 0}><Download size={14} className="-mt-0.5 mr-1 inline" />{busy ? "Generando…" : "Generar y descargar"}</Btn>
          </div>
        </div>
      )}
      <div className="mt-5 flex justify-end"><Btn variant="ghost" onClick={onClose}>Cerrar</Btn></div>
    </Modal>
  );
}
function ClientesView() {
  const { data, reload, loading } = useList<Party>(() => api.parties("customer"));
  const [editing, setEditing] = useState<Party | "new" | null>(null);
  const [layoutsFor, setLayoutsFor] = useState<Party | null>(null);
  const [bulk, setBulk] = useState(false);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState("");
  const vis = smartFilter(data, q, (p) => [p.name, p.tax_id, p.country]);
  function exportar() {
    exportCSV("clientes", ["Cliente", "País", "RFC / Tax ID", "Email", "Teléfono"],
      vis.map((p) => [p.name, p.country ?? "", p.tax_id ?? "", p.email ?? "", p.phone ?? ""]));
  }
  async function del(p: Party) {
    if (!confirm(tr(`¿Eliminar el cliente “${p.name}”?`))) return;
    setMsg(""); try { await api.deleteParty(p.id); await reload(); }
    catch (e) { setMsg((e as Error).message); }
  }
  return (
    <div>
      <PageTitle title="Clientes" desc="Tu padrón de clientes (importadores) a quienes emites certificados de origen." />
      <div className="mb-4 flex">
        <div className="ml-auto flex gap-2">
          <Btn variant="ghost" onClick={() => setBulk(true)}><Upload size={15} className="-mt-0.5 mr-1 inline" />Carga masiva</Btn>
          <Btn onClick={() => setEditing("new")}><Plus size={15} className="-mt-0.5 mr-1 inline" />Nuevo cliente</Btn>
        </div>
      </div>
      {msg && <p className="mb-3 text-sm text-amber-600">{msg}</p>}
      <ReportToolbar q={q} setQ={setQ} onExport={exportar} placeholder="Buscar cliente…" />
      <Table head={["Cliente", "País", "RFC / Tax ID", "Contacto", ""]}>
        {vis.map((p) => (
          <tr key={p.id}>
            <td className="px-4 py-3"><div className="font-medium">{p.name}</div></td>
            <td className="px-4 py-3">{p.country || "—"}</td>
            <td className="px-4 py-3 font-mono text-xs">{p.tax_id || "—"}</td>
            <td className="px-4 py-3 text-xs text-zinc-500">{[p.email, p.phone].filter(Boolean).join(" · ") || "—"}</td>
            <td className="px-4 py-3 text-right whitespace-nowrap">
              <span className="mr-1 inline-block"><Btn size="sm" variant="ghost" onClick={() => setLayoutsFor(p)}>Layouts portal</Btn></span>
              <button onClick={() => setEditing(p)} title="Editar" className="mr-1 rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-blue-600"><Pencil size={15} /></button>
              <button onClick={() => del(p)} title="Eliminar" className="rounded-lg p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={15} /></button>
            </td>
          </tr>
        ))}
        {!loading && data.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-zinc-400">Aún no tienes clientes. Crea el primero con “Nuevo cliente”.</td></tr>}
      </Table>
      {editing && <ClienteForm party={editing === "new" ? null : editing}
        onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await reload(); }} />}
      {layoutsFor && <ClientLayoutsModal client={layoutsFor} onClose={() => setLayoutsFor(null)} />}
      {bulk && (
        <CargaMasivaModal specType="customers" title="Carga masiva de clientes" onClose={() => setBulk(false)} onDone={reload}
          hint="Da de alta o actualiza muchos clientes (importadores) a la vez."
          templateFn={() => api.bulkTemplate("customers")} importFn={(f) => api.bulkImport("customers", f)} />
      )}
    </div>
  );
}
function ClienteForm({ party, onClose, onSaved }: {
  party: Party | null; onClose: () => void; onSaved: () => void;
}) {
  const [f, setF] = useState({
    name: party?.name ?? "", country: party?.country ?? "", tax_id: party?.tax_id ?? "",
    address: party?.address ?? "", email: party?.email ?? "", phone: party?.phone ?? "",
  });
  const [err, setErr] = useState(""); const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v });
  async function save() {
    if (!f.name.trim()) { setErr("El nombre del cliente es obligatorio."); return; }
    setErr(""); setSaving(true);
    const payload = {
      kind: "customer", name: f.name.trim(), country: f.country.trim().toUpperCase(),
      tax_id: f.tax_id.trim(), address: f.address.trim(),
      email: f.email.trim(), phone: f.phone.trim(),
    };
    try {
      if (party) await api.updateParty(party.id, payload);
      else await api.createParty(payload);
      onSaved();
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  }
  return (
    <Modal title={party ? "Editar cliente" : "Nuevo cliente"} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Field label="Nombre / Razón social"><input value={f.name} onChange={(e) => set("name", e.target.value)} className={inputCls} placeholder="Importadora USA Inc" autoFocus /></Field>
        </div>
        <Field label="País (ISO-2)"><input value={f.country} onChange={(e) => set("country", e.target.value.replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 2))} className={cx(inputCls, "uppercase")} placeholder="US" maxLength={2} /></Field>
        <Field label="RFC / Tax ID"><input value={f.tax_id} onChange={(e) => set("tax_id", e.target.value)} className={inputCls} /></Field>
        <div className="col-span-2">
          <Field label="Dirección"><input value={f.address} onChange={(e) => set("address", e.target.value)} className={inputCls} placeholder="1 Tesla Road, Austin, TX 78725" /></Field>
        </div>
        <Field label="Teléfono"><input value={f.phone} onChange={(e) => set("phone", e.target.value)} className={inputCls} /></Field>
        <Field label="Email"><input value={f.email} onChange={(e) => set("email", e.target.value)} className={inputCls} placeholder="compras@cliente.com" /></Field>
      </div>
      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
        <Btn onClick={save} disabled={saving}>{saving ? "Guardando…" : party ? "Guardar cambios" : "Crear cliente"}</Btn>
      </div>
    </Modal>
  );
}

// Genera el certificado de origen imprimible que EMITE la EMPRESA a un cliente.
function generarCertificadoEmpresa(a: {
  product: Product; treatyCode?: string; client: Party; profile: ProfileShape;
  qual?: Qualification; blanketFrom?: string; blanketTo?: string;
}) {
  const esc = (v?: string | null) =>
    (v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
  const { product: p, client, profile: pr, qual } = a;
  const treaty = treatyLabel(a.treatyCode);
  const originario = qual?.status === "QUALIFIES";
  const criterio = qual
    ? `${qual.criterion || qual.status_display}${qual.rvc_value ? ` · VCR ${qual.rvc_value}%` : ""}`
    : "Pendiente de cálculo de origen";
  const periodo = (a.blanketFrom && a.blanketTo) ? `${a.blanketFrom} a ${a.blanketTo}` : "No especificado";
  const empresa = pr.legal_name || "—";
  const dirEmp = [pr.address, [pr.postal_code, pr.city, pr.state].filter(Boolean).join(" "), pr.country].filter(Boolean).join(", ");
  const hoy = new Date().toLocaleDateString("es-MX", { year: "numeric", month: "long", day: "numeric" });
  const folio = `FTA-${p.id}-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
  const firmaImg = pr.signature_png
    ? `<img src="${pr.signature_png}" alt="Firma" style="max-height:70px;max-width:260px"/>`
    : `<span style="color:#b91c1c;font-size:12px">Firma pendiente — cárgala en “Datos de la empresa”.</span>`;
  const row = (k: string, v: string) => `<tr><td class="k">${k}</td><td class="v">${v}</td></tr>`;
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>Certificación de Origen ${esc(treaty)} — ${esc(p.sku)}</title>
<style>
  *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;color:#1f2937;margin:0;padding:32px;font-size:13px}
  .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid ${NAVY};padding-bottom:12px;margin-bottom:18px}
  .brand{font-size:20px;font-weight:bold;color:${NAVY}} .sub{color:#6b7280;font-size:12px}
  h1{font-size:16px;color:${NAVY};margin:0 0 2px} .badge{display:inline-block;padding:3px 10px;border-radius:999px;font-weight:bold;font-size:12px}
  .ok{background:#dcfce7;color:#15803d} .no{background:#fee2e2;color:#b91c1c}
  table{width:100%;border-collapse:collapse;margin:10px 0 18px} td{border:1px solid #e5e7eb;padding:7px 10px;vertical-align:top}
  td.k{background:#f8fafc;font-weight:bold;width:34%;color:#374151} td.v{width:66%}
  .section{font-size:13px;font-weight:bold;color:${NAVY};margin:18px 0 4px;text-transform:uppercase;letter-spacing:.3px}
  .sign{display:flex;gap:40px;margin-top:36px} .sign div{flex:1;border-top:1px solid #9ca3af;padding-top:6px;font-size:12px}
  .legal{margin-top:24px;font-size:11px;color:#6b7280;line-height:1.5;border-top:1px solid #e5e7eb;padding-top:10px}
  @media print{.noprint{display:none} body{padding:16px}}
</style></head><body>
  <div class="head">
    <div><div class="brand">LogiQ Aduanas</div><div class="sub">FTA · Gestión de Origen Preferencial</div></div>
    <div style="text-align:right"><h1>Certificación de Origen</h1><div class="sub">Tratado: <b>${esc(treaty)}</b></div>
      <div class="sub">Folio: ${esc(folio)} · Emitido: ${esc(hoy)}</div></div>
  </div>

  <div class="section">Resultado de origen</div>
  <p><span class="badge ${originario ? "ok" : "no"}">${originario ? "PRODUCTO ORIGINARIO" : "ORIGEN NO CONFIRMADO"}</span></p>

  <div class="section">1. Mercancía</div>
  <table>
    ${row("Núm. de parte / SKU", esc(p.sku))}
    ${row("Descripción", esc(p.description))}
    ${row("Clasificación arancelaria (HS)", esc(p.hs_code ? formatHs(p.hs_code) : "—"))}
    ${row("Criterio de origen", esc(criterio))}
  </table>

  <div class="section">2. Exportador / Productor (Empresa)</div>
  <table>
    ${row("Razón social", esc(empresa))}
    ${row("RFC / Tax ID", esc(pr.tax_id || "—"))}
    ${row("Domicilio", esc(dirEmp || "—"))}
    ${row("País", esc(pr.country || "—"))}
    ${row("Contacto", esc([pr.contact_name, pr.contact_email, pr.contact_phone].filter(Boolean).join(" · ") || "—"))}
  </table>

  <div class="section">3. Importador (Cliente)</div>
  <table>
    ${row("Razón social", esc(client.name))}
    ${row("RFC / Tax ID", esc(client.tax_id || "—"))}
    ${row("País", esc(client.country || "—"))}
    ${row("Contacto", esc([client.email, client.phone].filter(Boolean).join(" · ") || "—"))}
  </table>

  <div class="section">4. Periodo que cubre (blanket period)</div>
  <table>${row("Vigencia", esc(periodo))}</table>

  <div class="section">5. Firma autorizada</div>
  <div class="sign">
    <div>${firmaImg}<br><b>${esc(pr.signatory_name || pr.contact_name || "—")}</b><br>
      ${esc(pr.signatory_title || "")}<br>${esc(empresa)}<br>Fecha: ${esc(hoy)}</div>
  </div>

  <div class="legal">
    Certificación de origen emitida por ${esc(empresa)} para el tratado ${esc(treaty)}. El cálculo de origen es
    orientativo y debe ser validado por una persona con conocimientos técnicos en reglas de origen.
    Documento generado por LogiQ Aduanas | FTA.
  </div>

  <div class="noprint" style="margin-top:24px;text-align:center">
    <button onclick="window.print()" style="background:${NAVY};color:#fff;border:0;padding:10px 20px;border-radius:8px;font-size:14px;cursor:pointer">Imprimir / Guardar PDF</button>
  </div>
</body></html>`;
  const win = window.open("", "_blank", "width=900,height=1000");
  if (!win) { alert("Permite las ventanas emergentes para generar el certificado."); return; }
  win.document.open(); win.document.write(html); win.document.close();
}

// EMPRESA emite certificados de origen: elige producto + tratado + cliente.
// Imprime un certificado YA REGISTRADO (desde el folio guardado).
function generarCertificadoRegistro(c: EmittedCertificate) {
  const esc = (v?: string | null) =>
    (v ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch] as string));
  const ce = c.certifier_data || {}; const im = c.importer_data || {};
  const pr = (c.producer_data && Object.keys(c.producer_data).length ? c.producer_data : ce);
  const hoy = (c.issued_at || "").slice(0, 10);
  const periodo = (c.blanket_from && c.blanket_to) ? `${c.blanket_from} → ${c.blanket_to}` : "Single shipment";
  const ct = c.certifier_type || "producer";  // Anexo 5-A elemento 1
  const fallbackPref = usmcaPref(c.criterion, c.origin_status);
  const pref = { letter: c.pref_letter || fallbackPref.letter, label: c.pref_label || fallbackPref.label };
  // País de origen = país del PRODUCTOR; el backend resuelve fallbacks (perfil, RFC).
  const paisOrigen = c.country_of_origin || pr.pais || ce.pais || "";
  // Partes del DOCUMENTO (multi-línea); certificados viejos: una sola desde los campos planos.
  const items: CertificateItem[] = (c.items && c.items.length) ? c.items : [{
    product: 0, product_sku: c.product_sku, product_description: c.product_description,
    product_hs: c.product_hs, origin_status: c.origin_status, criterion: c.criterion,
    rvc_value: c.rvc_value, pref_letter: pref.letter, pref_label: pref.label,
    rule_text: c.rule_text ?? "", total_value: c.total_value ?? null, vnm: c.vnm ?? null,
    originating_value: c.originating_value ?? null,
  }];
  const contacto = (d: Record<string, string> = {}) =>
    [d.direccion, d.pais].filter(Boolean).join(" — ");
  // Bloque de una parte (1..6 datos de identidad). Estilo del CO oficial USMCA.
  const party = (title: string, d: Record<string, string> = {}, extra = "") => `
    <td class="box">
      <div class="bt">${title}</div>
      <div class="bl"><b>Name:</b> ${esc(d.nombre || "—")}</div>
      <div class="bl"><b>Address:</b> ${esc(d.direccion || "—")}${d.pais ? ` [${esc(d.pais)}]` : ""}</div>
      <div class="bl"><b>Tax ID:</b> ${esc(d.rfc || "—")}</div>
      <div class="bl"><b>Tel:</b> ${esc(d.telefono || "—")} &nbsp; <b>E-mail:</b> ${esc(d.email || "—")}</div>
      ${extra}
    </td>`;
  const firmaImg = ce.firma_png
    ? `<img src="${ce.firma_png}" alt="Signature" style="max-height:60px;max-width:240px"/>`
    : `<span style="color:#b91c1c;font-size:11px">Sin firma cargada (Datos de la empresa).</span>`;

  // NO ORIGINARIO → se emite un AFFIDAVIT (Value of Originating Material / VOM) en
  // vez de certificado de origen.
  if (c.origin_status !== "QUALIFIES") {
    const money = (v?: string | null) => {
      const n = Number(v); return isNaN(n) ? "—" : `$${n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };
    const affidavit = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Affidavit of Origin (VOM) ${esc(c.folio)} — ${esc(c.product_sku)}</title>
<style>
  *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;color:#111827;margin:0;padding:24px;font-size:11.5px;line-height:1.35}
  .top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid ${NAVY};padding-bottom:8px;margin-bottom:6px}
  h1{font-size:16px;margin:0;color:${NAVY}} .doc{font-size:11px;color:#374151;text-align:right} .sub{font-size:10.5px;color:#6b7280}
  table{width:100%;border-collapse:collapse;margin:6px 0} td,th{border:1px solid #9ca3af;padding:6px 8px;vertical-align:top}
  .box{width:50%} .bt{font-weight:bold;background:#eef2f6;margin:-6px -8px 6px;padding:4px 8px;font-size:11px} .bl{margin:1px 0}
  th{background:${NAVY};color:#fff;font-size:10.5px;text-align:left} td.num{text-align:right}
  .cert{font-size:10.5px;margin:8px 0;line-height:1.5} .badge{display:inline-block;padding:2px 8px;border-radius:999px;background:#fef3c7;color:#92400e;font-weight:bold;font-size:11px}
  .foot{margin-top:10px;font-size:9.5px;color:#6b7280;border-top:1px solid #e5e7eb;padding-top:6px}
  @media print{.noprint{display:none} body{padding:10px}}
</style></head><body>
  <div class="top">
    <div><h1>AFFIDAVIT OF ORIGIN (VOM)</h1>
      <div class="sub">Value of Originating Material — ${esc(c.treaty_label)}</div></div>
    <div class="doc"><b>Document No.:</b> ${esc(c.folio)}<br>Issued: ${esc(hoy)}</div>
  </div>
  <table>
    <tr>${party("1. Supplier / Exporter", ce)}<td class="box"><div class="bt">2. Period</div><div class="bl">${esc(periodo)}</div></td></tr>
    <tr>${party("3. Producer", pr, pr === ce ? '<div class="sub">Same as supplier</div>' : "")}${party("4. Recipient / Buyer", im)}</tr>
  </table>
  <table>
    <tr><th colspan="4">5. Merchandise Information</th></tr>
    <tr><th>Serial / Part No.</th><th>Description of Good(s)</th><th>HS No.</th><th>Country of Origin</th></tr>
    ${items.map((it) => `<tr><td>${esc(it.product_sku)}</td><td>${esc(it.product_description)}</td><td>${esc(it.product_hs ? formatHs(it.product_hs) : "—")}</td><td style="text-align:center">${esc(paisOrigen || "—")}</td></tr>`).join("")}
  </table>
  <table>
    <tr><th colspan="4">6. Value of Originating Material (VOM)</th></tr>
    <tr><th>Part No.</th><th>Total value (net cost)</th><th>Non-originating (VNM)</th><th>Originating (VOM)</th></tr>
    ${items.map((it) => `<tr><td>${esc(it.product_sku)}</td><td class="num">${money(it.total_value)}</td><td class="num">${money(it.vnm)}</td><td class="num">${money(it.originating_value)}</td></tr>`).join("")}
    <tr><td><b>TOTAL</b></td><td class="num"><b>${money(c.total_value)}</b></td><td class="num"><b>${money(c.vnm)}</b></td><td class="num"><b>${money(c.originating_value)}</b></td></tr>
  </table>
  <div class="cert">
    <span class="badge">NOT ORIGINATING under ${esc(c.treaty_label)}</span><br><br>
    <b>7. Certification.</b> I certify that the good described above does <b>not</b> qualify as originating under the ${esc(c.treaty_label)},
    and that the <b>Value of Originating Material (VOM)</b> stated herein is true and accurate. This affidavit is provided so the recipient
    may account for the originating content in its own regional value content determination. I assume responsibility for proving these
    representations and agree to maintain and present supporting documentation upon request.
  </div>
  <table>
    <tr><td class="box" style="height:56px"><div class="bt">8. Authorized Signature</div>${firmaImg}</td>
      <td class="box"><div class="bt">Signatory</div>
        <div class="bl"><b>Name &amp; Title:</b> ${esc(ce.firmante || "—")}${ce.cargo ? `, ${esc(ce.cargo)}` : ""}</div>
        <div class="bl"><b>Company:</b> ${esc(ce.nombre || "—")}</div>
        <div class="bl"><b>Date:</b> ${esc(hoy)} &nbsp; <b>Tel:</b> ${esc(ce.telefono || "—")} &nbsp; <b>E-mail:</b> ${esc(ce.email || "—")}</div>
      </td></tr>
  </table>
  <div class="foot">Folio ${esc(c.folio)} · ${esc(c.treaty_label)}.</div>
  <div class="noprint" style="margin-top:16px;text-align:center"><button onclick="window.print()" style="background:${NAVY};color:#fff;border:0;padding:9px 18px;border-radius:8px;font-size:13px;cursor:pointer">Imprimir / Guardar PDF</button></div>
</body></html>`;
    const w = window.open("", "_blank", "width=980,height=1000");
    if (!w) { alert("Permite las ventanas emergentes para ver el affidavit."); return; }
    w.document.open(); w.document.write(affidavit); w.document.close();
    return;
  }

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Certificate of Origin ${esc(c.folio)} — ${esc(c.product_sku)}</title>
<style>
  *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;color:#111827;margin:0;padding:24px;font-size:11.5px;line-height:1.35}
  .top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid ${NAVY};padding-bottom:8px;margin-bottom:6px}
  h1{font-size:16px;margin:0;color:${NAVY}} .doc{font-size:11px;color:#374151;text-align:right}
  .sub{font-size:10.5px;color:#6b7280}
  table{width:100%;border-collapse:collapse;margin:6px 0} td,th{border:1px solid #9ca3af;padding:6px 8px;vertical-align:top}
  .box{width:50%} .bt{font-weight:bold;background:#eef2f6;margin:-6px -8px 6px;padding:4px 8px;font-size:11px}
  .bl{margin:1px 0} .full .bt{}
  th{background:${NAVY};color:#fff;font-size:10.5px;text-align:left}
  .mtbl td{font-size:10.5px}
  .cert{font-size:10.5px;margin:8px 0;line-height:1.5}
  .sign td{height:56px}
  .foot{margin-top:10px;font-size:9.5px;color:#6b7280;border-top:1px solid #e5e7eb;padding-top:6px}
  @media print{.noprint{display:none} body{padding:10px}}
</style></head><body>
  <div class="top">
    <div>
      <h1>CERTIFICATE OF ORIGIN</h1>
      <div class="sub">${esc(c.treaty_label)}${c.treaty_code === "TMEC" ? " (USMCA/T-MEC)" : ""}</div>
    </div>
    <div class="doc"><b>Document No.:</b> ${esc(c.folio)}<br>Issued: ${esc(hoy)}</div>
  </div>

  <div style="border:1px solid #9ca3af;padding:5px 8px;margin:6px 0;font-size:11px">
    <b>1. Certifier is the:</b>
    &nbsp; ${ct === "exporter" ? "☑" : "☐"} Exporter
    &nbsp; ${ct === "producer" ? "☑" : "☐"} Producer
    &nbsp; ${ct === "importer" ? "☑" : "☐"} Importer
  </div>

  <table>
    <tr>
      <td class="box">
        <div class="bt">2. Certifier</div>
        <div class="bl"><b>Name:</b> ${esc(ce.nombre || "—")}</div>
        <div class="bl"><b>Certifier / Title:</b> ${esc(ce.firmante || "—")}${ce.cargo ? `, ${esc(ce.cargo)}` : ""}</div>
        <div class="bl"><b>Address:</b> ${esc(ce.direccion || "—")}${ce.pais ? ` [${esc(ce.pais)}]` : ""}</div>
        <div class="bl"><b>Tel:</b> ${esc(ce.telefono || "—")} &nbsp; <b>E-mail:</b> ${esc(ce.email || "—")}</div>
      </td>
      ${party("3. Exporter", ce)}
    </tr>
    <tr>${party("4. Producer", pr, pr === ce ? '<div class="sub">Same as certifier</div>' : "")}${party("5. Importer", im)}</tr>
  </table>

  <div style="border:1px solid #9ca3af;padding:5px 8px;margin:6px 0;font-size:11px">
    <b>Blanket Period:</b> ${esc(periodo)}
    &nbsp;•&nbsp; <b>Invoice No. (single shipment):</b> ${esc(c.invoice_number || "—")}
  </div>

  <table class="mtbl">
    <tr><th colspan="7">6. Description &amp; HS Classification · 7–9. Origin Criteria</th></tr>
    <tr><th>Serial / Part No.</th><th>Description of Good(s)</th><th>HS No. (6-digit)</th><th>7. Origin Criterion</th><th>8. Certification Indicator</th><th>9. Method of Qualification</th><th>Country of Origin</th></tr>
    ${items.map((it) => `<tr>
      <td>${esc(it.product_sku)}</td>
      <td>${esc(it.product_description)}</td>
      <td>${esc(it.product_hs ? formatHs(it.product_hs) : "—")}</td>
      <td style="text-align:center"><b>${esc(it.pref_letter)}</b><div class="sub">${esc(it.pref_label)}</div>${it.rule_text
        ? `<div class="sub" style="margin-top:3px;text-align:left">${esc(it.rule_text)}</div>`
        : (it.rvc_value ? `<div class="sub">RVC ${it.rvc_value}%</div>` : "")}</td>
      <td style="text-align:center"><b>${esc(it.certification_indicator || (ct === "producer" ? "YES" : "NO"))}</b><div class="sub">${ct === "producer" ? "certifier is the producer" : "certifier is not the producer"}</div></td>
      <td style="text-align:center"><b>${esc(it.method_of_qualification || "—")}</b><div class="sub">${{ TS: "tariff shift", NC: "RVC · net cost", TV: "RVC · transaction value", WO: "wholly obtained" }[it.method_of_qualification ?? ""] ?? ""}</div></td>
      <td style="text-align:center">${esc(paisOrigen || "—")}</td>
    </tr>`).join("")}
  </table>

  <div class="cert">
    <b>Certification.</b> ${esc(c.certification_text || "I certify that the goods described in this document qualify as originating and the information contained in this document is true and accurate. I assume responsibility for proving such representations and agree to maintain and present upon request or to make available during a verification visit, documentation necessary to support this certification.")}
  </div>

  <table>
    <tr>
      <td class="box sign"><div class="bt">Authorized Signature &amp; Date</div>${firmaImg}</td>
      <td class="box">
        <div class="bt">Signatory</div>
        <div class="bl"><b>Name &amp; Title:</b> ${esc(ce.firmante || "—")}${ce.cargo ? `, ${esc(ce.cargo)}` : ""}</div>
        <div class="bl"><b>Company:</b> ${esc(ce.nombre || "—")}</div>
        <div class="bl"><b>Date (YYYY-MM-DD):</b> ${esc(hoy)}</div>
        <div class="bl"><b>Tel:</b> ${esc(ce.telefono || "—")} &nbsp; <b>E-mail:</b> ${esc(ce.email || "—")}</div>
        ${c.qr_data_uri ? `<img src="${c.qr_data_uri}" alt="QR" style="width:70px;height:70px;margin-top:4px">` : ""}
      </td>
    </tr>
  </table>

  <div class="foot">Folio ${esc(c.folio)} · ${esc(c.treaty_label)}.${c.verify_url ? ` Public verification: ${esc(c.verify_url)}` : ""}</div>
  <div class="noprint" style="margin-top:16px;text-align:center">
    <button onclick="window.print()" style="background:${NAVY};color:#fff;border:0;padding:9px 18px;border-radius:8px;font-size:13px;cursor:pointer">Imprimir / Guardar PDF</button>
  </div>
</body></html>`;
  const win = window.open("", "_blank", "width=980,height=1000");
  if (!win) { alert("Permite las ventanas emergentes para ver el certificado."); return; }
  win.document.open(); win.document.write(html); win.document.close();
}


/* ============ AUDITORÍAS DE ORIGEN ============ */
// Días restantes de una fecha límite de auditoría.
function venceInfo(date: string | null): { txt: string; cls: string } | null {
  if (!date) return null;
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const d = Math.round((new Date(date + "T00:00:00").getTime() - hoy.getTime()) / 86400000);
  if (d < 0) return { txt: `venció ${date}`, cls: "bg-red-100 text-red-700" };
  if (d <= 3) return { txt: `${date} (${d} día${d === 1 ? "" : "s"})`, cls: "bg-amber-100 text-amber-800" };
  return { txt: date, cls: "bg-zinc-100 text-zinc-600" };
}

// El CLIENTE audita a la empresa: registrar la auditoría, responder el
// cuestionario (pre-llenado desde la plataforma), adjuntar evidencia y
// descargar el expediente ZIP.
function AuditoriasView() {
  const audits = useList<AuditRow>(() => api.audits());
  const [crear, setCrear] = useState(false);
  const [abierta, setAbierta] = useState<AuditRow | null>(null);
  const [msg, setMsg] = useState("");
  async function abrir(a: AuditRow) { setAbierta(a); }
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <PageTitle title="Auditorías de origen" desc="Cuando un cliente (o su despacho) te audita: registra la auditoría, la plataforma pre-llena el cuestionario con tus cálculos y certificados, adjunta la evidencia externa y descarga el expediente completo." />
        <Btn onClick={() => setCrear(true)}><Plus size={15} className="-mt-0.5 mr-1 inline" />Nueva auditoría</Btn>
      </div>
      {msg && <p className="mb-3 text-sm text-amber-600">{msg}</p>}
      <Table head={["Auditoría", "Alcance", "Límite cuestionario", "Límite documentos", "Avance", "Estado", ""]}>
        {audits.data.map((a) => {
          const vq = venceInfo(a.questionnaire_due); const vd = venceInfo(a.documents_due);
          return (
            <tr key={a.id}>
              <td className="px-4 py-3"><div className="font-medium">{a.title}</div>
                <div className="text-[11px] text-zinc-500">
                  {a.kind === "supplier_audit"
                    ? <span className="mr-1 rounded bg-purple-50 px-1 py-0.5 font-medium text-purple-700">a proveedor: {a.supplier_name ?? "—"}</span>
                    : <span className="mr-1 rounded bg-blue-50 px-1 py-0.5 font-medium text-blue-700">de cliente</span>}
                  {a.auditor || "—"}{a.client_name ? ` · ${a.client_name}` : ""}
                </div></td>
              <td className="px-4 py-3 text-xs">{a.items.map((i) => `${i.product_sku} (${treatyLabel(i.treaty_code)})`).join(", ")}</td>
              <td className="px-4 py-3">{vq ? <span className={cx("rounded-full px-2 py-0.5 text-[11px] font-medium", vq.cls)}>{vq.txt}</span> : "—"}</td>
              <td className="px-4 py-3">{vd ? <span className={cx("rounded-full px-2 py-0.5 text-[11px] font-medium", vd.cls)}>{vd.txt}</span> : "—"}</td>
              <td className="px-4 py-3 text-xs">{a.progress.provided}/{a.progress.total}</td>
              <td className="px-4 py-3"><Pill k={a.status === "open" ? "sent" : "accepted"}>{a.status_display}</Pill></td>
              <td className="px-4 py-3 text-right whitespace-nowrap">
                <span className="mr-1 inline-block"><Btn size="sm" onClick={() => abrir(a)}>Abrir</Btn></span>
                <Btn size="sm" variant="ghost" onClick={() => api.auditPackage(a.id, a.title.replace(/\s+/g, "_")).catch((e) => setMsg((e as Error).message))}>ZIP</Btn>
              </td>
            </tr>
          );
        })}
        {audits.count === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-zinc-400">Sin auditorías registradas. Cuando un cliente te audite, créala aquí con “Nueva auditoría”.</td></tr>}
      </Table>
      {crear && <NuevaAuditoriaModal onClose={() => setCrear(false)}
        onSaved={async (a) => { setCrear(false); await audits.reload(); setAbierta(a); }} />}
      {abierta && <AuditoriaDetalleModal auditId={abierta.id}
        onClose={async () => { setAbierta(null); await audits.reload(); }} />}
    </div>
  );
}


// Portal del PROVEEDOR: auditorías que su cliente (la empresa) le mandó.
function AuditoriasProveedorView() {
  const audits = useList<AuditRow>(() => api.audits());
  const [abierta, setAbierta] = useState<AuditRow | null>(null);
  return (
    <div>
      <PageTitle title="Auditorías de tu cliente" desc="Tu cliente te está auditando el origen de estas partes: responde el cuestionario, adjunta la evidencia y marca cada renglón como listo antes de la fecha límite." />
      <Table head={["Auditoría", "Alcance", "Límite cuestionario", "Límite documentos", "Avance", "Estado", ""]}>
        {audits.data.map((a) => {
          const vq = venceInfo(a.questionnaire_due); const vd = venceInfo(a.documents_due);
          return (
            <tr key={a.id}>
              <td className="px-4 py-3"><div className="font-medium">{a.title}</div>
                <div className="text-[11px] text-zinc-500">{a.auditor || "—"}</div></td>
              <td className="px-4 py-3 text-xs">{a.items.map((i) => `${i.product_sku} (${treatyLabel(i.treaty_code)})`).join(", ")}</td>
              <td className="px-4 py-3">{vq ? <span className={cx("rounded-full px-2 py-0.5 text-[11px] font-medium", vq.cls)}>{vq.txt}</span> : "—"}</td>
              <td className="px-4 py-3">{vd ? <span className={cx("rounded-full px-2 py-0.5 text-[11px] font-medium", vd.cls)}>{vd.txt}</span> : "—"}</td>
              <td className="px-4 py-3 text-xs">{a.progress.provided}/{a.progress.total}</td>
              <td className="px-4 py-3"><Pill k={a.status === "open" ? "sent" : "accepted"}>{a.status_display}</Pill></td>
              <td className="px-4 py-3 text-right"><Btn size="sm" onClick={() => setAbierta(a)}>Responder</Btn></td>
            </tr>
          );
        })}
        {audits.count === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-zinc-400">No tienes auditorías pendientes. 🎉</td></tr>}
      </Table>
      {abierta && <AuditoriaDetalleModal auditId={abierta.id} proveedor
        onClose={async () => { setAbierta(null); await audits.reload(); }} />}
    </div>
  );
}

function NuevaAuditoriaModal({ onClose, onSaved }: { onClose: () => void; onSaved: (a: AuditRow) => void }) {
  const productsL = useList<Product>(() => api.products());
  const treatiesL = useList<Treaty>(() => api.treaties());
  const clientsL = useList<Party>(() => api.parties("customer"));
  const [f, setF] = useState({ title: "", auditor: "", client: "" as number | "", notified_at: "", questionnaire_due: "", documents_due: "" });
  const [kind, setKind] = useState<"client_audit" | "supplier_audit">("client_audit");
  const [supplierId, setSupplierId] = useState<number | "">("");
  const suppliersL = useList<Party>(() => api.parties("supplier"));
  const [items, setItems] = useState<{ product: number; treaty: number }[]>([]);
  const [prodId, setProdId] = useState<number | "">("");
  const [treatyId, setTreatyId] = useState<number | "">("");
  const [err, setErr] = useState(""); const [saving, setSaving] = useState(false);
  // Auditoría de cliente: tus productos terminados/subproductos. Auditoría A UN
  // proveedor: las partes que le compras (cualquier tipo, filtradas por proveedor).
  const productos = kind === "supplier_audit"
    ? productsL.data.filter((p) => supplierId !== "" && p.supplier === Number(supplierId))
    : productsL.data.filter((p) => p.kind !== "material");
  const nombre = (id: number) => productsL.data.find((p) => p.id === id)?.sku ?? `#${id}`;
  const tcode = (id: number) => treatiesL.data.find((t) => t.id === id)?.code ?? "";
  function agregarItem() {
    if (!prodId || !treatyId) { setErr("Elige la parte y el tratado."); return; }
    setErr("");
    if (!items.some((i) => i.product === prodId && i.treaty === treatyId))
      setItems([...items, { product: Number(prodId), treaty: Number(treatyId) }]);
    setProdId("");
  }
  async function crear() {
    if (!f.title.trim()) { setErr("Ponle un título (ej. “Origin Verification — KMX”)."); return; }
    if (kind === "supplier_audit" && supplierId === "") { setErr("Elige el proveedor auditado."); return; }
    if (!items.length) { setErr("Agrega al menos una parte al alcance."); return; }
    setErr(""); setSaving(true);
    try {
      const a = await api.createAudit({ ...f, kind, supplier: supplierId === "" ? null : supplierId, client: f.client === "" ? null : f.client, items });
      onSaved(a);
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  }
  return (
    <Modal title="Nueva auditoría de origen" onClose={onClose} wide>
      <p className="mb-3 text-sm text-zinc-500">{kind === "supplier_audit"
        ? <>Audita a un proveedor: la plataforma siembra el cuestionario estándar y <strong>el proveedor lo responde desde su portal</strong> (con evidencia adjunta); tú sigues el avance y descargas el expediente.</>
        : <>Registra la auditoría que te mandó tu cliente. Al crearla, la plataforma <strong>siembra el cuestionario estándar</strong> (documentos requeridos + preguntas por tratado) y lo <strong>pre-llena</strong> con tus cálculos, PSR, certificados y proceso de proveedores.</>}</p>
      <div className="mb-3 grid grid-cols-2 gap-1 rounded-lg bg-zinc-100 p-1">
        {([["client_audit", "Un cliente me audita"], ["supplier_audit", "Yo audito a un proveedor"]] as const).map(([k, lbl]) => (
          <button key={k} onClick={() => { setKind(k); setItems([]); setProdId(""); }}
            className={cx("rounded-md px-3 py-1.5 text-sm font-medium", kind === k ? "bg-white text-blue-700 shadow-sm" : "text-zinc-500 hover:text-zinc-700")}>
            {lbl}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Título"><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} className={inputCls} placeholder={kind === "supplier_audit" ? "Verificación de origen — proveedor X" : "Origin Verification — KMX"} autoFocus /></Field>
        <Field label="Auditor (cliente o despacho)"><input value={f.auditor} onChange={(e) => setF({ ...f, auditor: e.target.value })} className={inputCls} placeholder="SS Commerce / Deloitte / KPMG / EY…" /></Field>
        {kind === "supplier_audit" ? (
          <Field label="Proveedor auditado">
            <select value={supplierId} onChange={(e) => { setSupplierId(e.target.value ? Number(e.target.value) : ""); setItems([]); }} className={inputCls}>
              <option value="">Elige el proveedor…</option>
              {suppliersL.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        ) : (
          <Field label="Cliente relacionado (opcional)">
            <select value={f.client} onChange={(e) => setF({ ...f, client: e.target.value ? Number(e.target.value) : "" })} className={inputCls}>
              <option value="">—</option>
              {clientsL.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        )}
        <div className="grid grid-cols-3 gap-2">
          <Field label="Notificación"><input type="date" value={f.notified_at} onChange={(e) => setF({ ...f, notified_at: e.target.value })} className={inputCls} /></Field>
          <Field label="Límite cuestionario"><input type="date" value={f.questionnaire_due} onChange={(e) => setF({ ...f, questionnaire_due: e.target.value })} className={inputCls} /></Field>
          <Field label="Límite documentos"><input type="date" value={f.documents_due} onChange={(e) => setF({ ...f, documents_due: e.target.value })} className={inputCls} /></Field>
        </div>
      </div>
      <div className="mt-4 rounded-lg border border-zinc-200 p-3">
        <div className="mb-2 text-xs font-semibold text-zinc-700">Alcance: partes auditadas (parte + tratado)</div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[16rem] flex-1"><ProductCombobox products={productos} value={prodId} onChange={setProdId} /></div>
          <select value={treatyId} onChange={(e) => setTreatyId(e.target.value ? Number(e.target.value) : "")} className={cx(inputCls, "w-56")}>
            <option value="">Tratado…</option>
            {treatiesL.data.map((t) => <option key={t.id} value={t.id}>{treatyLabel(t.code)}</option>)}
          </select>
          <Btn variant="ghost" onClick={agregarItem}><Plus size={14} className="-mt-0.5 mr-1 inline" />Agregar</Btn>
        </div>
        {items.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {items.map((i, ix) => (
              <span key={ix} className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs">
                <span className="font-mono">{nombre(i.product)}</span>
                <span className="text-zinc-500">{treatyLabel(tcode(i.treaty))}</span>
                <button onClick={() => setItems(items.filter((_, j) => j !== ix))} className="text-zinc-400 hover:text-red-600">✕</button>
              </span>
            ))}
          </div>
        )}
      </div>
      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
        <Btn onClick={crear} disabled={saving}>{saving ? "Creando…" : "Crear y pre-llenar"}</Btn>
      </div>
    </Modal>
  );
}

function AuditoriaDetalleModal({ auditId, onClose, proveedor }: { auditId: number; onClose: () => void; proveedor?: boolean }) {
  const [a, setA] = useState<AuditRow | null>(null);
  const [msg, setMsg] = useState("");
  const [resp, setResp] = useState<Record<number, string>>({});
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [uploadFor, setUploadFor] = useState<number | null>(null);
  const recargar = useCallback(async () => {
    try {
      const list: { results: AuditRow[] } = await api.audits();
      const found = list.results.find((x) => x.id === auditId) ?? null;
      setA(found);
      if (found) setResp(Object.fromEntries(found.documents.map((d) => [d.id, d.response])));
    } catch (e) { setMsg((e as Error).message); }
  }, [auditId]);
  useEffect(() => { recargar(); }, [recargar]);
  async function guardar(d: AuditDoc, patch: Record<string, unknown>) {
    setMsg("");
    try { await api.updateAuditDocument(auditId, { id: d.id, ...patch }); await recargar(); }
    catch (e) { setMsg((e as Error).message); }
  }
  function pedirArchivo(docId: number) { setUploadFor(docId); fileInput.current?.click(); }
  async function subir(file: File) {
    if (file.size > 10_000_000) { setMsg("El archivo es muy grande (máximo ~10 MB)."); return; }
    const b64 = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(",")[1] ?? "");
      r.onerror = rej; r.readAsDataURL(file);
    });
    try {
      await api.uploadAuditFile(auditId, { document: uploadFor, filename: file.name, content_type: file.type, data_b64: b64 });
      await recargar();
    } catch (e) { setMsg((e as Error).message); }
  }
  if (!a) return null;
  const secciones: { nombre: string; docs: AuditDoc[] }[] = [];
  for (const d of a.documents) {
    const last = secciones[secciones.length - 1];
    if (!last || last.nombre !== d.section) secciones.push({ nombre: d.section, docs: [d] });
    else last.docs.push(d);
  }
  const vq = venceInfo(a.questionnaire_due); const vd = venceInfo(a.documents_due);
  return (
    <Modal title={`${a.title} — ${a.auditor || "auditoría"}`} onClose={onClose} wide>
      <input ref={fileInput} type="file" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) subir(f); e.target.value = ""; }} />
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-zinc-100 px-3 py-1">Alcance: <strong>{a.items.map((i) => `${i.product_sku} (${treatyLabel(i.treaty_code)})`).join(", ")}</strong></span>
        {vq && <span className={cx("rounded-full px-3 py-1 font-medium", vq.cls)}>Cuestionario: {vq.txt}</span>}
        {vd && <span className={cx("rounded-full px-3 py-1 font-medium", vd.cls)}>Documentos: {vd.txt}</span>}
        <span className="rounded-full bg-blue-50 px-3 py-1 text-blue-700">{a.progress.provided}/{a.progress.total} listos</span>
        {proveedor
          ? <Pill k={a.status === "open" ? "sent" : "accepted"}>{a.status_display}</Pill>
          : <select value={a.status} onChange={async (e) => { await api.patchAudit(a.id, { status: e.target.value }); await recargar(); }}
              className="rounded-lg border border-zinc-300 px-2 py-1 text-xs">
              <option value="open">En preparación</option>
              <option value="submitted">Entregada</option>
              <option value="closed">Cerrada</option>
            </select>}
      </div>
      <p className="mb-3 text-xs text-zinc-500">{proveedor
        ? <>Responde cada renglón y adjunta la evidencia que lo respalde; las respuestas se guardan al salir del campo. Marca <strong>“Listo”</strong> cuando el renglón esté completo. Tu cliente ve el avance en tiempo real.</>
        : <>Las respuestas marcadas <span className="rounded bg-blue-50 px-1 text-blue-700">auto</span> las pre-llenó la plataforma con tus cálculos — revísalas y ajústalas; se guardan al salir del campo. Marca “Listo” cuando el renglón esté completo y adjunta la evidencia externa donde aplique.</>}</p>
      {msg && <p className="mb-2 text-sm text-red-600">{msg}</p>}
      <div className="space-y-4">
        {secciones.map((sec) => (
          <div key={sec.nombre} className="overflow-hidden rounded-lg border border-zinc-200">
            <div className="bg-[#043a70] px-4 py-2 text-sm font-semibold text-white">{sec.nombre}</div>
            <div className="divide-y divide-zinc-100">
              {sec.docs.map((d) => (
                <div key={d.id} className="p-3">
                  <div className="flex items-start gap-2">
                    <label className="mt-0.5 flex shrink-0 cursor-pointer items-center gap-1 text-xs text-zinc-600">
                      <input type="checkbox" checked={d.provided} onChange={(e) => guardar(d, { provided: e.target.checked })} /> Listo
                    </label>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-zinc-800"><span className="font-semibold">{d.number}.</span> {d.title}
                        {d.auto_filled && <span className="ml-1.5 rounded bg-blue-50 px-1 text-[10px] font-medium text-blue-700">auto</span>}
                      </div>
                      <textarea value={resp[d.id] ?? ""} rows={Math.min(5, Math.max(2, Math.ceil((resp[d.id] ?? "").length / 110)))}
                        onChange={(e) => setResp({ ...resp, [d.id]: e.target.value })}
                        onBlur={() => { if ((resp[d.id] ?? "") !== d.response) guardar(d, { response: resp[d.id] ?? "" }); }}
                        placeholder="Respuesta / comentarios…"
                        className="mt-1.5 w-full rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs" />
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {d.files.map((fl) => (
                          <span key={fl.id} className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px]">
                            <button className="text-blue-600 hover:underline" onClick={() => api.auditFileDownload(auditId, fl.id, fl.filename)}>{fl.filename}</button>
                            <button className="text-zinc-400 hover:text-red-600" onClick={async () => { await api.deleteAuditFile(auditId, fl.id); await recargar(); }}>✕</button>
                          </span>
                        ))}
                        <button onClick={() => pedirArchivo(d.id)} className="text-[11px] font-medium text-blue-600 hover:underline">
                          <Upload size={11} className="-mt-0.5 mr-0.5 inline" />Adjuntar evidencia
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Btn variant="ghost" onClick={onClose}>Cerrar</Btn>
        <Btn onClick={() => api.auditPackage(a.id, a.title.replace(/\s+/g, "_")).catch((e) => setMsg((e as Error).message))}>
          <Download size={15} className="-mt-0.5 mr-1 inline" />Descargar expediente (ZIP)
        </Btn>
      </div>
    </Modal>
  );
}

function CertificadosEmitirView() {
  const productsL = useList<Product>(() => api.products());
  const treatiesL = useList<Treaty>(() => api.treaties());
  const clientsL = useList<Party>(() => api.parties("customer"));
  const qualsL = useList<Qualification>(() => api.qualifications());
  const [productId, setProductId] = useState<number | "">("");  // combobox = agregador
  const [selIds, setSelIds] = useState<number[]>([]);           // partes del documento
  const [treatyId, setTreatyId] = useState<number | "">("");
  const [clientId, setClientId] = useState<number | "">("");
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  // Idioma de las DESCRIPCIONES del documento (el layout no cambia).
  const [lang, setLang] = useState<"es" | "en">("es");
  const [profile, setProfile] = useState<ProfileShape | null>(null);
  const [msg, setMsg] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const emitidos = useList<EmittedCertificate>(() => api.certificates());
  const [qReg, setQReg] = useState("");
  const visCerts = smartFilter(emitidos.data, qReg, (c) => [c.folio, c.product_sku, c.product_description,
    ...(c.items ?? []).flatMap((it) => [it.product_sku, it.product_description]),
    c.importer_data?.nombre, c.treaty_label]);
  function exportarCerts() {
    exportCSV("certificados_emitidos", ["Folio", "Producto", "Descripción", "Tratado", "Cliente", "Criterio", "VCR", "Emitido"],
      visCerts.map((c) => [c.folio, c.product_sku, c.product_description, c.treaty_label, c.importer_data?.nombre ?? "", c.criterion, c.rvc_value ?? "", c.issued_at?.slice(0, 10) ?? ""]));
  }
  useEffect(() => { api.companyProfile().then((p) => setProfile(p as ProfileShape)).catch(() => {}); }, []);
  const productos = productsL.data.filter((p) => p.kind !== "material");
  // Si se elige un cliente, solo sus números de parte (los que tienen ese cliente
  // asignado). Si el cliente AÚN no tiene partes asignadas, se muestran todas (para
  // no dejar el buscador vacío) con un aviso.
  const asignadasCliente = clientId === ""
    ? productos
    : productos.filter((p) => (p.customers ?? []).includes(Number(clientId)));
  const clienteSinPartes = clientId !== "" && asignadasCliente.length === 0;
  const productosCliente = clienteSinPartes ? productos : asignadasCliente;
  // Si cambia el cliente, se limpian las partes que ya no le corresponden.
  useEffect(() => {
    if (clientId !== "" && !clienteSinPartes) {
      setSelIds((ids) => ids.filter((id) => productosCliente.some((p) => p.id === id)));
    }
    setProductId("");
  }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps
  // El combobox AGREGA a la lista (documento multi-línea).
  function agregar(id: number | "") {
    if (id === "") { setProductId(""); return; }
    setSelIds((ids) => (ids.includes(Number(id)) ? ids : [...ids, Number(id)]));
    setProductId("");
  }
  const seleccionadas = selIds
    .map((id) => productos.find((p) => p.id === id))
    .filter((p): p is Product => !!p);
  const qualDe = (pid: number) =>
    qualsL.data.find((q) => q.product === pid && q.treaty === Number(treatyId));
  const qualsSel = seleccionadas.map((p) => ({ p, q: qualDe(p.id) }));
  const sinCalculo = qualsSel.filter((x) => !x.q).map((x) => x.p.sku);
  const conQual = qualsSel.filter((x) => !!x.q);
  const todasCalifican = conQual.length > 0 && conQual.every((x) => x.q!.status === "QUALIFIES");
  const ningunaCalifica = conQual.length > 0 && conQual.every((x) => x.q!.status !== "QUALIFIES");
  const mezcla = conQual.length > 0 && !todasCalifican && !ningunaCalifica;
  const algunaStale = conQual.some((x) => x.q!.is_stale);
  const listoParaEmitir = selIds.length > 0 && treatyId !== "" && clientId !== "" &&
    sinCalculo.length === 0 && !mezcla && conQual.length === selIds.length;
  const profileOk = !!profile && !!profile.legal_name;
  const califica = todasCalifican;
  function vistaPrevia() {
    if (selIds.length !== 1) { setErr("La vista previa es de UNA parte; para varias, emite y se abre el documento completo."); return; }
    const p = productos.find((x) => x.id === selIds[0]);
    const client = clientsL.data.find((x) => x.id === Number(clientId));
    const treaty = treatiesL.data.find((x) => x.id === Number(treatyId));
    if (!p || !client || !treaty || !profile) { setErr("Elige producto, tratado y cliente."); return; }
    setErr("");
    // La vista previa respeta el idioma elegido (descripción EN con fallback a ES).
    const pLang = lang === "en" && p.description_en ? { ...p, description: p.description_en } : p;
    generarCertificadoEmpresa({ product: pLang, treatyCode: treaty.code, client, profile, qual: qualDe(p.id), blanketFrom: from, blanketTo: to });
  }
  async function emitirRegistrar() {
    if (!selIds.length || !treatyId || !clientId) { setErr("Agrega al menos una parte y elige tratado y cliente."); return; }
    setBusy(true); setErr(""); setMsg("");
    try {
      const cert = await api.emitCertificate({ products: selIds, treaty: treatyId, client: clientId, blanket_from: from || null, blanket_to: to || null, invoice_number: invoiceNo || "", language: lang });
      setMsg(`${cert.origin_status === "QUALIFIES" ? "Certificado" : "Affidavit"} ${cert.folio} emitido y registrado con ${selIds.length} parte(s).`);
      setSelIds([]);
      await emitidos.reload();
      generarCertificadoRegistro(cert);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="max-w-5xl">
      <PageTitle title="Emitir certificados de origen" desc="Emite el certificado de origen de un producto que CALIFICA, para el tratado que elijas, dirigido a un cliente. Queda registrado con folio." />
      {!profileOk && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          ⚠️ Completa primero los <strong>Datos de la empresa</strong> (razón social y firma) para que el certificado salga lleno.
        </div>
      )}
      {clientsL.data.length === 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          ⚠️ Aún no tienes clientes. Agrega uno en <strong>Catálogos → Clientes</strong>.
        </div>
      )}
      <Card className="p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Partes del documento (agrega una o varias)">
            <div className="flex items-center gap-2">
              <div className="flex-1"><ProductCombobox products={productosCliente.filter((p) => !selIds.includes(p.id))} value={productId} onChange={agregar} /></div>
              {clientId !== "" && !clienteSinPartes && productosCliente.length > selIds.length && (
                <Btn variant="ghost" size="sm" onClick={() => setSelIds(Array.from(new Set([...selIds, ...productosCliente.map((p) => p.id)])))}>
                  + Todas ({productosCliente.length})
                </Btn>
              )}
            </div>
            {clientId !== "" && (clienteSinPartes
              ? <p className="mt-1 text-[11px] text-amber-600">Este cliente no tiene números de parte asignados; mostrando todos. Asígnalos en el producto (campo “Cliente(s)”).</p>
              : <p className="mt-1 text-[11px] text-zinc-500">Mostrando los números de parte de este cliente ({productosCliente.length}).</p>)}
          </Field>
          <Field label="Tratado">
            <select value={treatyId} onChange={(e) => setTreatyId(e.target.value ? Number(e.target.value) : "")} className={inputCls}>
              <option value="">Elige un tratado…</option>
              {treatiesL.data.map((t) => <option key={t.id} value={t.id}>{treatyLabel(t.code)} — {t.name}</option>)}
            </select>
          </Field>
          <Field label="Cliente (importador)">
            <select value={clientId} onChange={(e) => setClientId(e.target.value ? Number(e.target.value) : "")} className={inputCls}>
              <option value="">Elige un cliente…</option>
              {clientsL.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Periodo desde"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} /></Field>
            <Field label="Periodo hasta"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} /></Field>
          </div>
          <Field label="Número de factura (solo envío único, opcional)">
            <input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} className={inputCls} placeholder="Ej. INV-2026-00123" />
          </Field>
          <Field label="Idioma de las descripciones">
            <select value={lang} onChange={(e) => setLang(e.target.value as "es" | "en")} className={inputCls}>
              <option value="es">Español (como se capturaron)</option>
              <option value="en">Inglés (usa la descripción en inglés de cada parte)</option>
            </select>
          </Field>
        </div>
        {lang === "en" && (
          <p className="mt-2 text-xs text-amber-700">
            Se imprime la <strong>descripción en inglés</strong> de cada parte; si a alguna le
            falta, se usa su descripción en español. Captúrala en Números de parte (o por carga
            masiva, columna «Descripción en inglés»).
          </p>
        )}
        {seleccionadas.length > 0 && (
          <div className="mt-4">
            <div className="mb-1 text-xs font-semibold text-zinc-700">{seleccionadas.length} parte(s) en el documento:</div>
            <div className="flex flex-wrap gap-1.5">
              {qualsSel.map(({ p, q }) => (
                <span key={p.id} className={cx("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
                  !q ? "border-amber-300 bg-amber-50 text-amber-800"
                    : q.status === "QUALIFIES" ? "border-green-200 bg-green-50 text-green-800"
                    : "border-red-200 bg-red-50 text-red-700")}>
                  <span className="font-mono">{p.sku}</span>
                  <span>{!q ? "sin calcular" : q.status === "QUALIFIES" ? `✓${q.rvc_value ? ` ${q.rvc_value}%` : ""}` : "no califica"}</span>
                  {q?.is_stale && <span title="cálculo desactualizado">⚠️</span>}
                  <button onClick={() => setSelIds(selIds.filter((id) => id !== p.id))} className="text-zinc-400 hover:text-red-600">✕</button>
                </span>
              ))}
            </div>
          </div>
        )}
        {treatyId !== "" && sinCalculo.length > 0 && (
          <p className="mt-3 text-xs text-amber-600">Sin calcular para este tratado: <strong>{sinCalculo.join(", ")}</strong> — córrelas en “Cálculo de origen” primero.</p>
        )}
        {mezcla && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            ⚠️ <strong>No se pueden mezclar</strong> partes que califican con partes que no en un mismo documento
            (certificado vs affidavit). Quita unas u otras y emite dos documentos.
          </div>
        )}
        {ningunaCalifica && !mezcla && (
          <p className="mt-3 text-xs text-amber-600">Ninguna parte califica → se emitirá un <strong>affidavit de origen (VOM)</strong> con todas.</p>
        )}
        {algunaStale && (
          <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            ⚠️ <strong>El BOM o los costos de alguna parte (⚠️) cambiaron después del último cálculo.</strong> El documento
            saldría con los valores anteriores. Recalcula en <strong>Cálculo de origen</strong> y regresa a emitir.
          </div>
        )}
        {msg && <p className="mt-3 text-sm text-emerald-700">{msg}</p>}
        {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
        <div className="mt-5 flex flex-wrap gap-2">
          <Btn onClick={emitirRegistrar} disabled={busy || !listoParaEmitir}>
            {busy ? "Emitiendo…" : califica ? `Emitir certificado${selIds.length > 1 ? ` (${selIds.length} partes)` : ""}` : `Emitir affidavit (VOM)${selIds.length > 1 ? ` (${selIds.length} partes)` : ""}`}
          </Btn>
          <Btn variant="ghost" onClick={vistaPrevia} disabled={selIds.length !== 1 || !treatyId || !clientId}>Vista previa (sin registrar)</Btn>
        </div>
      </Card>
      <p className="mt-3 text-xs text-zinc-500">📄 Se abre en una ventana nueva; usa “Imprimir / Guardar PDF”. Si el producto CALIFICA se emite un <strong>certificado de origen</strong>; si NO califica, un <strong>affidavit (VOM)</strong>. Requiere haber calculado el origen; queda registrado con folio.</p>

      <div className="mt-8">
        <div className="mb-2 text-sm font-semibold text-zinc-800">Certificados emitidos ({emitidos.count})</div>
        {emitidos.count > 0 && <ReportToolbar q={qReg} setQ={setQReg} onExport={exportarCerts} placeholder="Buscar por folio, producto o cliente…" />}
        <Table head={["Folio", "Producto", "Tratado", "Cliente", "Criterio", "Emitido", ""]}>
          {visCerts.map((c) => (
            <tr key={c.id}>
              <td className="px-4 py-3 font-mono text-xs font-semibold">{c.folio}</td>
              <td className="px-4 py-3">
                {(c.items && c.items.length > 1)
                  ? <>
                      <span className="font-mono text-xs">{c.items.map((it) => it.product_sku).join(", ")}</span>
                      <div className="text-[11px] text-zinc-500">{c.items.length} partes en el documento</div>
                    </>
                  : <><span className="font-mono text-xs">{c.product_sku}</span><div className="text-[11px] text-zinc-500">{c.product_description}</div></>}
              </td>
              <td className="px-4 py-3">{c.treaty_label}</td>
              <td className="px-4 py-3 text-xs">{c.importer_data?.nombre ?? "—"}</td>
              <td className="px-4 py-3 text-xs">{c.origin_status === "QUALIFIES" ? `${c.criterion}${c.rvc_value ? ` · ${c.rvc_value}%` : ""}` : <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">Affidavit (VOM)</span>}</td>
              <td className="px-4 py-3 text-xs text-zinc-500">{c.issued_at?.slice(0, 10)}</td>
              <td className="px-4 py-3 text-right whitespace-nowrap">
                <span className="mr-1 inline-block"><Btn size="sm" variant="ghost" onClick={() => generarCertificadoRegistro(c)}>PDF</Btn></span>
                <Btn size="sm" variant="ghost" onClick={() => api.certificateXlsx(c.id, c.folio)}>Excel</Btn>
              </td>
            </tr>
          ))}
          {emitidos.count === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-zinc-400">Aún no has emitido certificados.</td></tr>}
        </Table>
      </div>
    </div>
  );
}

function periodoTexto(s: Solicitation) {
  if (s.period_from && s.period_to)
    return `${s.period_display ?? ""} ${s.period_from} → ${s.period_to}`.trim();
  return "—";
}
// Alerta por fecha límite: vencida / por vencer (si aún no se respondió).
function dueAlert(s: Solicitation): { label: string; cls: string } | null {
  if (solAnswered(s) || !s.due_date) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(s.due_date + "T00:00:00");
  const days = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (days < 0) return { label: `Vencida · fuera de periodo (límite ${s.due_date})`, cls: "bg-red-100 text-red-700" };
  if (days <= 3) return { label: `Por vencer · límite ${s.due_date} (${days} día${days === 1 ? "" : "s"})`, cls: "bg-amber-100 text-amber-700" };
  return null;
}
function OrigenCelda({ s }: { s: Solicitation }) {
  const st = s.submitted_bom?.origin_status;
  const decl = s.declared_originating;
  let label = "Pendiente", cls = "bg-zinc-100 text-zinc-600", crit = s.submitted_bom?.criterion;
  if (st === "QUALIFIES" || decl === true) { label = "Originario: SÍ"; cls = "bg-green-100 text-green-700"; }
  else if (st === "DOES_NOT" || decl === false) { label = "Originario: NO"; cls = "bg-red-100 text-red-700"; }
  else if (st === "AUTO_REVIEW") { label = "Requiere régimen automotriz"; cls = "bg-amber-100 text-amber-800"; }
  else if (st === "INSUFFICIENT") { label = "Datos insuficientes"; cls = "bg-amber-100 text-amber-700"; }
  const psr = s.submitted_bom?.rule_hs;
  return (
    <div>
      <span className={cx("rounded-full px-2 py-0.5 text-xs font-medium", cls)}>{label}</span>
      {crit && <span className="ml-1 text-[11px] text-zinc-500">{crit}</span>}
      {psr && <div className="mt-0.5 text-[11px] text-zinc-500">PSR: <span className="font-mono">{formatHs(psr)}</span>{s.submitted_bom?.rule_type ? ` · ${s.submitted_bom.rule_type}` : ""}</div>}
    </div>
  );
}
// Abre una ventana imprimible con el certificado de origen del tratado.
// Se imprime / guarda como PDF desde el navegador (sin librerías de servidor).
function generarCertificado(s: Solicitation) {
  const esc = (v?: string | null) =>
    (v ?? "").replace(/[&<>"]/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
  const prof = s.supplier_profile;
  const bom = s.submitted_bom;
  const dd = s.declaration_detail;
  const originario = bom ? bom.origin_status === "QUALIFIES"
    : (dd ? dd.is_originating : (s.declared_originating ?? false));
  const treaty = treatyLabel(s.treaty_code);
  const psr = bom?.rule_hs
    ? `${formatHs(bom.rule_hs)}${bom.rule_type ? " · " + ruleTypeLabel(bom.rule_type) : ""}`
    : (dd?.rule_description ? cleanRuleDesc(dd.rule_description) : "—");
  const criterio = bom?.criterion
    ? `${bom.criterion}${bom.rvc_value != null ? ` · VCR ${bom.rvc_value}%` : ""}`
    : (dd ? "Declaración de origen del proveedor" : "—");
  const periodo = (s.period_from && s.period_to)
    ? `${s.period_from} a ${s.period_to}` : "No especificado";
  const proveedorNombre = prof?.legal_name || s.supplier_name || "—";
  const dirProv = prof
    ? [prof.address, [prof.postal_code, prof.city, prof.state].filter(Boolean).join(" "),
       prof.country || s.supplier_country].filter(Boolean).join(", ")
    : (s.supplier_country || "");
  const hoy = new Date().toLocaleDateString("es-MX", { year: "numeric", month: "long", day: "numeric" });
  const firmaImg = prof?.signature_png
    ? `<img src="${prof.signature_png}" alt="Firma" style="max-height:70px;max-width:260px"/>`
    : `<span style="color:#b91c1c;font-size:12px">Firma pendiente — el proveedor debe cargarla en “Datos de la empresa”.</span>`;
  const row = (k: string, v: string) =>
    `<tr><td class="k">${k}</td><td class="v">${v}</td></tr>`;
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>Certificación de Origen ${esc(treaty)} — ${esc(s.product_sku)}</title>
<style>
  *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;color:#1f2937;margin:0;padding:32px;font-size:13px}
  .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid ${NAVY};padding-bottom:12px;margin-bottom:18px}
  .brand{font-size:20px;font-weight:bold;color:${NAVY}} .sub{color:#6b7280;font-size:12px}
  h1{font-size:16px;color:${NAVY};margin:0 0 2px} .badge{display:inline-block;padding:3px 10px;border-radius:999px;font-weight:bold;font-size:12px}
  .ok{background:#dcfce7;color:#15803d} .no{background:#fee2e2;color:#b91c1c}
  table{width:100%;border-collapse:collapse;margin:10px 0 18px} td{border:1px solid #e5e7eb;padding:7px 10px;vertical-align:top}
  td.k{background:#f8fafc;font-weight:bold;width:34%;color:#374151} td.v{width:66%}
  .section{font-size:13px;font-weight:bold;color:${NAVY};margin:18px 0 4px;text-transform:uppercase;letter-spacing:.3px}
  .sign{display:flex;gap:40px;margin-top:36px} .sign div{flex:1;border-top:1px solid #9ca3af;padding-top:6px;font-size:12px}
  .legal{margin-top:24px;font-size:11px;color:#6b7280;line-height:1.5;border-top:1px solid #e5e7eb;padding-top:10px}
  @media print{.noprint{display:none} body{padding:16px}}
</style></head><body>
  <div class="head">
    <div><div class="brand">LogiQ Aduanas</div><div class="sub">FTA · Gestión de Origen Preferencial</div></div>
    <div style="text-align:right"><h1>Certificación de Origen</h1><div class="sub">Tratado: <b>${esc(treaty)}</b></div>
      <div class="sub">Emitido: ${esc(hoy)}</div></div>
  </div>

  <div class="section">Resultado de origen</div>
  <p><span class="badge ${originario ? "ok" : "no"}">${originario ? "PRODUCTO ORIGINARIO" : "PRODUCTO NO ORIGINARIO"}</span></p>

  <div class="section">1. Mercancía</div>
  <table>
    ${row("Núm. de parte / SKU", esc(s.product_sku))}
    ${row("Descripción", esc(s.product_description))}
    ${row("Clasificación arancelaria (HS)", esc(s.product_hs ? formatHs(s.product_hs) : "—"))}
    ${row("Regla aplicada (PSR)", esc(psr))}
    ${row("Criterio de origen", esc(criterio))}
  </table>

  <div class="section">2. Productor / Exportador (Proveedor)</div>
  <table>
    ${row("Razón social", esc(proveedorNombre))}
    ${row("RFC / Tax ID", esc(prof?.tax_id || "—"))}
    ${row("Domicilio", esc(dirProv || "—"))}
    ${row("Contacto", esc([prof?.contact_name, prof?.contact_email, prof?.contact_phone].filter(Boolean).join(" · ") || "—"))}
  </table>

  <div class="section">3. Importador (Cliente)</div>
  <table>
    ${row("Empresa", esc(s.tenant_name || "—"))}
  </table>

  <div class="section">4. Periodo que cubre (blanket period)</div>
  <table>${row("Vigencia", esc(periodo))}</table>

  <div class="section">5. Firma autorizada</div>
  <div class="sign">
    <div>${firmaImg}<br><b>${esc(prof?.signatory_name || prof?.contact_name || "—")}</b><br>
      ${esc(prof?.signatory_title || "")}<br>${esc(proveedorNombre)}<br>Fecha: ${esc(hoy)}</div>
  </div>

  <div class="legal">
    Esta certificación de origen se emite con base en la información declarada por el proveedor para el tratado ${esc(treaty)}.
    El cálculo de origen es orientativo y debe ser validado por una persona con conocimientos técnicos en reglas de origen.
    Documento generado por LogiQ Aduanas | FTA.
  </div>

  <div class="noprint" style="margin-top:24px;text-align:center">
    <button onclick="window.print()" style="background:${NAVY};color:#fff;border:0;padding:10px 20px;border-radius:8px;font-size:14px;cursor:pointer">Imprimir / Guardar PDF</button>
  </div>
</body></html>`;
  const win = window.open("", "_blank", "width=900,height=1000");
  if (!win) { alert("Permite las ventanas emergentes para generar el certificado."); return; }
  win.document.open(); win.document.write(html); win.document.close();
}

// Certificado de origen del proveedor por solicitud (firmado). Reutiliza el estilo
// de generarCertificado, pero desde el snapshot del cert + el artefacto de firma.
// `draft`=true imprime el borrador (firma manual a mano) sin firma embebida.
function renderOrigenCertHTML(cert: SolicitationCert, draft = false) {
  const esc = (v?: string | null) => (v ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
  const d = cert.data || {};
  const prod = d.product || { sku: "", description: "", hs: "" };
  const origin = d.origin || { is_originating: null, country: "", criterion: "", rule: "" };
  const prod2 = d.producer || {};
  const imp = d.importer || {};
  const treaty = d.treaty?.label || d.treaty?.code || "—";
  const isManual = cert.sign_method === "manual" || cert.sign_method === "manual_qr";
  const win = window.open("", "_blank", "width=900,height=1000");
  if (!win) { alert("Permite las ventanas emergentes para ver el certificado."); return; }

  // Firma manual ya firmada: mostrar el documento escaneado tal cual.
  if (cert.signed && isManual && cert.scanned_file && !draft) {
    if (cert.scanned_file.startsWith("data:application/pdf")) { win.location.href = cert.scanned_file; return; }
    const qr = cert.qr_data_uri ? `<div style="text-align:center;margin-top:16px"><img src="${cert.qr_data_uri}" style="width:120px;height:120px"/><div style="font-size:11px;color:#6b7280">Verificación pública</div></div>` : "";
    win.document.open();
    win.document.write(`<!doctype html><meta charset="utf-8"><title>Certificado firmado — ${esc(cert.folio)}</title>
      <body style="font-family:Arial;margin:0;padding:24px;text-align:center">
      <div style="font-weight:bold;color:${NAVY};margin-bottom:10px">LogiQ Aduanas | FTA · Certificado firmado · Folio ${esc(cert.folio)}</div>
      <img src="${cert.scanned_file}" style="max-width:100%;border:1px solid #e5e7eb"/>${qr}
      <div class="noprint" style="margin-top:18px"><button onclick="window.print()" style="background:${NAVY};color:#fff;border:0;padding:10px 20px;border-radius:8px;cursor:pointer">Imprimir / Guardar PDF</button></div>
      <style>@media print{.noprint{display:none}}</style></body>`);
    win.document.close(); return;
  }

  const originario = origin.is_originating === true;
  const criterio = origin.criterion || (origin.rule ? cleanRuleDesc(origin.rule) : "—");
  const periodo = (d.period?.from && d.period?.to) ? `${d.period.from} a ${d.period.to}` : "No especificado";
  const hoy = cert.signed_at
    ? new Date(cert.signed_at).toLocaleDateString("es-MX", { year: "numeric", month: "long", day: "numeric" })
    : new Date().toLocaleDateString("es-MX", { year: "numeric", month: "long", day: "numeric" });
  const dirProv = [prod2.direccion].filter(Boolean).join(", ");
  const showPng = !draft && (cert.sign_method === "png" || cert.sign_method === "png_qr") && cert.signature_png;
  const firmaImg = showPng
    ? `<img src="${cert.signature_png}" alt="Firma" style="max-height:70px;max-width:260px"/>`
    : (draft && isManual
        ? `<div style="height:48px"></div><span style="font-size:11px;color:#6b7280">(Firma autógrafa)</span>`
        : `<span style="color:#b91c1c;font-size:12px">Firma pendiente.</span>`);
  const qrBlock = (!draft && cert.qr_data_uri)
    ? `<div style="flex:0 0 auto;text-align:center"><img src="${cert.qr_data_uri}" style="width:110px;height:110px"/><div style="font-size:10px;color:#6b7280">Verificación pública</div></div>`
    : "";
  const row = (k: string, v: string) => `<tr><td class="k">${k}</td><td class="v">${v}</td></tr>`;
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>Certificado de Origen ${esc(treaty)} — ${esc(prod.sku)}</title>
<style>
  *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;color:#1f2937;margin:0;padding:32px;font-size:13px}
  .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid ${NAVY};padding-bottom:12px;margin-bottom:18px}
  .brand{font-size:20px;font-weight:bold;color:${NAVY}} .sub{color:#6b7280;font-size:12px}
  h1{font-size:16px;color:${NAVY};margin:0 0 2px} .badge{display:inline-block;padding:3px 10px;border-radius:999px;font-weight:bold;font-size:12px}
  .ok{background:#dcfce7;color:#15803d} .no{background:#fee2e2;color:#b91c1c}
  table{width:100%;border-collapse:collapse;margin:10px 0 18px} td{border:1px solid #e5e7eb;padding:7px 10px;vertical-align:top}
  td.k{background:#f8fafc;font-weight:bold;width:34%;color:#374151} td.v{width:66%}
  .section{font-size:13px;font-weight:bold;color:${NAVY};margin:18px 0 4px;text-transform:uppercase;letter-spacing:.3px}
  .sign{display:flex;gap:40px;margin-top:36px;align-items:flex-end} .sign .col{flex:1;border-top:1px solid #9ca3af;padding-top:6px;font-size:12px}
  .legal{margin-top:24px;font-size:11px;color:#6b7280;line-height:1.5;border-top:1px solid #e5e7eb;padding-top:10px}
  @media print{.noprint{display:none} body{padding:16px}}
</style></head><body>
  <div class="head">
    <div><div class="brand">LogiQ Aduanas</div><div class="sub">FTA · Gestión de Origen Preferencial</div></div>
    <div style="text-align:right"><h1>Certificado de Origen${draft ? " (BORRADOR)" : ""}</h1>
      <div class="sub">Tratado: <b>${esc(treaty)}</b></div><div class="sub">Folio: ${esc(cert.folio)} · ${esc(hoy)}</div></div>
  </div>
  <div class="section">Resultado de origen</div>
  <p><span class="badge ${originario ? "ok" : "no"}">${originario ? "PRODUCTO ORIGINARIO" : "PRODUCTO NO ORIGINARIO"}</span></p>
  <div class="section">1. Mercancía</div>
  <table>
    ${row("Núm. de parte / SKU", esc(prod.sku))}
    ${row("Descripción", esc(prod.description))}
    ${row("Clasificación arancelaria (HS)", esc(prod.hs ? formatHs(prod.hs) : "—"))}
    ${row("Criterio de origen", esc(criterio))}
    ${row("País de origen", esc(origin.country || "—"))}
  </table>
  <div class="section">2. Productor / Exportador (Proveedor)</div>
  <table>
    ${row("Razón social", esc(prod2.nombre || "—"))}
    ${row("RFC / Tax ID", esc(prod2.rfc || "—"))}
    ${row("Domicilio", esc(dirProv || "—"))}
    ${row("Contacto", esc([prod2.email, prod2.telefono].filter(Boolean).join(" · ") || "—"))}
  </table>
  <div class="section">3. Importador (Empresa cliente)</div>
  <table>${row("Empresa", esc(imp.nombre || "—"))}${row("RFC / Tax ID", esc(imp.rfc || "—"))}</table>
  <div class="section">4. Periodo que cubre (blanket period)</div>
  <table>${row("Vigencia", esc(periodo))}</table>
  <div class="section">5. Firma autorizada del proveedor</div>
  <div class="sign">
    <div class="col">${firmaImg}<br><b>${esc(prod2.firmante || "—")}</b><br>${esc(prod2.cargo || "")}<br>${esc(prod2.nombre || "")}<br>Fecha: ${esc(hoy)}</div>
    ${qrBlock}
  </div>
  <div class="legal">
    Certificado de origen declarado por el proveedor para el tratado ${esc(treaty)}. La información es responsabilidad de quien la declara;
    el cálculo es orientativo y no sustituye el criterio de un especialista. Documento generado por LogiQ Aduanas | FTA.
  </div>
  <div class="noprint" style="margin-top:24px;text-align:center">
    <button onclick="window.print()" style="background:${NAVY};color:#fff;border:0;padding:10px 20px;border-radius:8px;font-size:14px;cursor:pointer">Imprimir / Guardar PDF</button>
  </div>
</body></html>`;
  win.document.open(); win.document.write(html); win.document.close();
}

// Celda de certificado en "Declaraciones aceptadas": el proveedor FIRMA según el
// método que exigió la empresa; la empresa solo VE el certificado firmado.
function CertificadoCelda({ s, esEmpresa, reload }: {
  s: Solicitation; esEmpresa: boolean; reload: () => Promise<void> | void;
}) {
  const cert = s.certificate;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  if (!cert) {
    return <Btn size="sm" variant="ghost" onClick={() => generarCertificado(s)}>Certificado</Btn>;
  }
  async function ver(draft = false) {
    setErr("");
    try { renderOrigenCertHTML(await api.solicitationCert(cert!.id), draft); }
    catch (e) { setErr((e as Error).message); }
  }
  async function firmar(payload: Record<string, unknown> = {}) {
    setBusy(true); setErr("");
    try { await api.signSolicitationCert(cert!.id, payload); await reload(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    if (f.size > 4_000_000) { setErr("Archivo muy grande (máx 4 MB)."); return; }
    const reader = new FileReader();
    reader.onload = () => firmar({ scanned_file: reader.result as string });
    reader.readAsDataURL(f);
  }
  const isManual = cert.sign_method === "manual" || cert.sign_method === "manual_qr";
  if (cert.signed) {
    return (
      <span className="inline-flex flex-col items-end gap-0.5">
        <Btn size="sm" onClick={() => ver()}>Ver certificado firmado</Btn>
        {err && <span className="text-[11px] text-red-600">{err}</span>}
      </span>
    );
  }
  if (esEmpresa) {
    return <span className="text-[11px] text-amber-700">Pendiente de firma del proveedor · {cert.sign_method_display}</span>;
  }
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <span className="text-[11px] text-zinc-500">Firma exigida: <strong className="text-zinc-700">{cert.sign_method_display}</strong></span>
      {isManual ? (
        <span className="flex items-center gap-1.5">
          <Btn size="sm" variant="ghost" onClick={() => ver(true)}>Imprimir borrador</Btn>
          <label className="cursor-pointer text-[11px] font-medium text-blue-600 hover:underline">
            {busy ? "Subiendo…" : "Subir firmado"}
            <input type="file" accept="image/*,application/pdf" className="hidden" onChange={onFile} disabled={busy} />
          </label>
        </span>
      ) : (
        <Btn size="sm" onClick={() => firmar()} disabled={busy}>
          {busy ? "Firmando…" : (cert.sign_method === "qr" ? "Firmar (generar QR)" : "Firmar con mi firma")}
        </Btn>
      )}
      {err && <span className="text-[11px] text-red-600">{err}</span>}
    </span>
  );
}
function DeclaracionesAceptadasView({ me }: { me: Me }) {
  const { data, loading, reload } = useList<Solicitation>(() => api.solicitations());
  const [verBom, setVerBom] = useState<Solicitation | null>(null);
  const [q, setQ] = useState("");
  const esEmpresa = me.role !== "master" && !me.is_supplier;
  const aceptadas = smartFilter(data.filter((s) => s.status === "accepted"), q,
    (s) => [s.product_sku, s.product_description, s.supplier_name, s.treaty_code]);
  function exportar() {
    exportCSV("declaraciones_aceptadas", ["Núm. de parte", "Descripción", "Proveedor", "Tratado", "Periodo", "Origen"],
      aceptadas.map((s) => [s.product_sku ?? "", s.product_description ?? "", s.supplier_name ?? "", treatyLabel(s.treaty_code), periodoTexto(s), s.declared_originating || s.submitted_bom?.origin_status === "QUALIFIES" ? "Originario" : "No originario"]));
  }
  return (
    <div>
      <PageTitle title="Declaraciones aceptadas"
        desc={esEmpresa ? "Declaraciones de origen aceptadas por ti. Genera el certificado de origen del tratado."
          : "Tus declaraciones aceptadas por tus clientes. Genera el certificado de origen del tratado."} />
      <ReportToolbar q={q} setQ={setQ} onExport={exportar} placeholder="Buscar por núm. de parte o proveedor…" />
      <Table head={["Núm. de parte", "Descripción", esEmpresa ? "Proveedor" : "Tipo", "Tratado", "Periodo", "Origen / PSR", ""]}>
        {aceptadas.map((s) => (
          <tr key={s.id}>
            <td className="px-4 py-3 font-mono text-xs">{s.product_sku}</td>
            <td className="px-4 py-3">{s.product_description}</td>
            <td className="px-4 py-3 text-xs">{esEmpresa ? s.supplier_name : (s.bom_analysis ? "BOM" : "Declaración")}</td>
            <td className="px-4 py-3">{treatyLabel(s.treaty_code)}</td>
            <td className="px-4 py-3 text-xs text-zinc-600">{periodoTexto(s)}</td>
            <td className="px-4 py-3"><OrigenCelda s={s} /></td>
            <td className="px-4 py-3 text-right whitespace-nowrap">
              {s.submitted_bom && <span className="mr-1 inline-block"><Btn size="sm" variant="ghost" onClick={() => setVerBom(s)}>Ver BOM</Btn></span>}
              <CertificadoCelda s={s} esEmpresa={esEmpresa} reload={reload} />
            </td>
          </tr>
        ))}
        {!loading && aceptadas.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-zinc-400">Aún no hay declaraciones aceptadas.</td></tr>}
      </Table>
      <p className="mt-3 text-xs text-zinc-500">📄 El certificado se abre en una ventana nueva; usa “Imprimir / Guardar PDF” para descargarlo.
        {esEmpresa ? " La firma proviene de los datos que cargó el proveedor." : " Carga tu firma en “Datos de la empresa” para que aparezca en el certificado."}</p>
      {verBom && <BomViewModal s={verBom} onClose={() => setVerBom(null)} />}
    </div>
  );
}
type ProfileShape = {
  legal_name: string; tax_id: string; address: string; city: string;
  state: string; postal_code: string; country: string;
  contact_name: string; contact_email: string; contact_phone: string;
  signatory_name: string; signatory_title: string; signature_png: string;
  logo_png?: string; tenant_slug?: string;
};
const EMPTY_PROFILE: ProfileShape = {
  legal_name: "", tax_id: "", address: "", city: "", state: "", postal_code: "",
  country: "", contact_name: "", contact_email: "", contact_phone: "",
  signatory_name: "", signatory_title: "", signature_png: "", logo_png: "",
};
// Editor de "Datos de la empresa" reutilizable por PROVEEDOR y EMPRESA.
// El país se captura en ISO-3 (tres letras) para los certificados (PDF).
// `showLogo` (solo EMPRESA): permite subir el logo que aparece en la barra superior.
function ProfileEditor({ desc, load, save, lockIdentity, showLogo, onLogoSaved }: {
  desc: string;
  load: () => Promise<ProfileShape>;
  save: (p: ProfileShape) => Promise<unknown>;
  lockIdentity?: boolean;
  showLogo?: boolean;
  onLogoSaved?: () => void;
}) {
  const [form, setForm] = useState<ProfileShape>(EMPTY_PROFILE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(""); const [err, setErr] = useState("");
  useEffect(() => {
    load().then((p) => setForm({ ...EMPTY_PROFILE, ...p }))
      .catch((e) => setErr((e as Error).message)).finally(() => setLoading(false));
  }, [load]);
  const set = (k: keyof ProfileShape, v: string) => setForm((f) => ({ ...f, [k]: v }));
  function onSignatureFile(file: File | undefined) {
    setErr("");
    if (!file) return;
    if (!/png|jpe?g/i.test(file.type)) { setErr("La firma debe ser una imagen PNG o JPG."); return; }
    if (file.size > 1_500_000) { setErr("La imagen es muy grande (máx. 1.5 MB). Usa una más ligera."); return; }
    const reader = new FileReader();
    reader.onload = () => set("signature_png", String(reader.result || ""));
    reader.readAsDataURL(file);
  }
  function onLogoFile(file: File | undefined) {
    setErr("");
    if (!file) return;
    if (!/png|jpe?g|svg/i.test(file.type)) { setErr("El logo debe ser PNG, JPG o SVG."); return; }
    if (file.size > 1_500_000) { setErr("El logo es muy grande (máx. 1.5 MB). Usa uno más ligero."); return; }
    const reader = new FileReader();
    reader.onload = () => set("logo_png", String(reader.result || ""));
    reader.readAsDataURL(file);
  }
  async function guardar() {
    setSaving(true); setMsg(""); setErr("");
    try { await save(form); setMsg("Datos guardados."); if (onLogoSaved) onLogoSaved(); }
    catch (e) { setErr((e as Error).message); }
    finally { setSaving(false); }
  }
  if (loading) return <div className="p-6 text-sm text-zinc-400">Cargando…</div>;
  return (
    <div className="max-w-3xl">
      <PageTitle title="Datos de la empresa" desc={desc} />
      <Card className="mb-4 p-5">
        <div className="mb-3 text-sm font-semibold text-zinc-800">Información de la empresa</div>
        {form.tenant_slug && (
          <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900">
            Tu <strong>nombre de acceso</strong> es <code className="rounded bg-white px-1.5 py-0.5 font-mono ring-1 ring-blue-200">{form.tenant_slug}</code> (lo
            administra LogiQ): es lo que tu equipo y tus proveedores escriben al entrar. La{" "}
            <strong>razón social</strong> de abajo es tu identidad LEGAL, la que sale en los
            certificados — son cosas distintas.
          </div>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={lockIdentity ? "Razón social (la edita el administrador)" : "Razón social (legal, sale en los certificados)"}>
            <input className={cx(inputCls, lockIdentity && "cursor-not-allowed bg-zinc-100 text-zinc-500")} value={form.legal_name}
              readOnly={lockIdentity} disabled={lockIdentity}
              onChange={(e) => !lockIdentity && set("legal_name", e.target.value)} /></Field>
          <Field label={lockIdentity ? "RFC / Tax ID (lo edita el administrador)" : "RFC / Tax ID"}>
            <input className={cx(inputCls, lockIdentity && "cursor-not-allowed bg-zinc-100 text-zinc-500")} value={form.tax_id}
              readOnly={lockIdentity} disabled={lockIdentity}
              onChange={(e) => !lockIdentity && set("tax_id", e.target.value)} /></Field>
          <Field label="Domicilio"><input className={inputCls} value={form.address} onChange={(e) => set("address", e.target.value)} /></Field>
          <Field label="Ciudad"><input className={inputCls} value={form.city} onChange={(e) => set("city", e.target.value)} /></Field>
          <Field label="Estado / Provincia"><input className={inputCls} value={form.state} onChange={(e) => set("state", e.target.value)} /></Field>
          <Field label="Código postal"><input className={inputCls} value={form.postal_code} onChange={(e) => set("postal_code", e.target.value)} /></Field>
          <Field label="País (3 letras, ej. MEX)">
            <input className={cx(inputCls, "uppercase")} value={form.country} maxLength={3} placeholder="MEX"
              onChange={(e) => set("country", e.target.value.replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 3))} />
          </Field>
        </div>
      </Card>
      {showLogo && (
        <Card className="mb-4 p-5">
          <div className="mb-1 text-sm font-semibold text-zinc-800">Logo de la empresa</div>
          <p className="mb-3 text-xs text-zinc-500">Sube el logo (PNG con fondo transparente recomendado). Aparecerá en la barra superior del sistema; tus proveedores también lo verán al entrar.</p>
          {form.logo_png ? (
            <div className="flex items-center gap-4">
              <img src={form.logo_png} alt="Logo" className="max-h-16 max-w-[220px] rounded-lg border border-zinc-200 bg-white object-contain p-2" />
              <Btn variant="ghost" size="sm" onClick={() => set("logo_png", "")}>Quitar logo</Btn>
            </div>
          ) : (
            <input type="file" accept="image/png,image/jpeg,image/svg+xml"
              onChange={(e) => onLogoFile(e.target.files?.[0])}
              className="text-sm text-zinc-600 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-blue-700 hover:file:bg-blue-100" />
          )}
        </Card>
      )}
      <Card className="mb-4 p-5">
        <div className="mb-3 text-sm font-semibold text-zinc-800">Contacto</div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Nombre de contacto"><input className={inputCls} value={form.contact_name} onChange={(e) => set("contact_name", e.target.value)} /></Field>
          <Field label="Correo de contacto"><input className={inputCls} type="email" value={form.contact_email} onChange={(e) => set("contact_email", e.target.value)} /></Field>
          <Field label="Teléfono de contacto"><input className={inputCls} value={form.contact_phone} onChange={(e) => set("contact_phone", e.target.value)} /></Field>
        </div>
      </Card>
      <Card className="mb-4 p-5">
        <div className="mb-1 text-sm font-semibold text-zinc-800">Firma para los certificados</div>
        <p className="mb-3 text-xs text-zinc-500">Sube una imagen PNG/JPG de tu firma (fondo transparente recomendado). Aparecerá en el certificado de origen.</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Nombre de quien firma"><input className={inputCls} value={form.signatory_name} onChange={(e) => set("signatory_name", e.target.value)} /></Field>
          <Field label="Cargo de quien firma"><input className={inputCls} value={form.signatory_title} onChange={(e) => set("signatory_title", e.target.value)} /></Field>
        </div>
        <div className="mt-4">
          <span className="mb-1 block text-xs font-semibold text-zinc-700">Imagen de la firma</span>
          {form.signature_png ? (
            <div className="flex items-center gap-4">
              <img src={form.signature_png} alt="Firma" className="max-h-20 rounded-lg border border-zinc-200 bg-white p-2" />
              <Btn variant="ghost" size="sm" onClick={() => set("signature_png", "")}>Quitar firma</Btn>
            </div>
          ) : (
            <input type="file" accept="image/png,image/jpeg"
              onChange={(e) => onSignatureFile(e.target.files?.[0])}
              className="text-sm text-zinc-600 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-blue-700 hover:file:bg-blue-100" />
          )}
        </div>
      </Card>
      {msg && <p className="mb-2 text-sm text-emerald-700">{msg}</p>}
      {err && <p className="mb-2 text-sm text-red-600">{err}</p>}
      <Btn onClick={guardar} disabled={saving}>{saving ? "Guardando…" : "Guardar datos"}</Btn>
    </div>
  );
}
// PROVEEDOR: sus datos de empresa.
function DatosEmpresaView() {
  const load = useCallback(() => api.supplierProfile() as Promise<ProfileShape>, []);
  return <ProfileEditor load={load} save={(p) => api.updateSupplierProfile(p)}
    desc="Información de contacto y firma de tu empresa. Se usan para llenar el certificado de origen." />;
}
// EMPRESA: sus datos para emitir certificados. La razón social y el RFC LEGALES
// los captura el ADMINISTRADOR de la empresa (el nombre de acceso es aparte).
function DatosEmpresaCompanyView({ me }: { me: Me }) {
  const load = useCallback(() => api.companyProfile() as Promise<ProfileShape>, []);
  const esAdmin = me.role === "admin";
  // Al guardar, recargamos para que el logo nuevo aparezca en la barra superior.
  return <ProfileEditor load={load} save={(p) => api.updateCompanyProfile(p)} lockIdentity={!esAdmin} showLogo
    onLogoSaved={() => { setTimeout(() => window.location.reload(), 600); }}
    desc="Datos, logo y firma de tu empresa. El logo aparece en la barra superior (y lo ven tus proveedores). La razón social y el RFC son los LEGALES que salen en tus certificados." />;
}
// Color/etiqueta de la vigencia según días restantes.
function vigenciaInfo(d: number | null | undefined): { txt: string; cls: string } {
  if (d === null || d === undefined) return { txt: "Sin fecha de vigencia", cls: "bg-zinc-100 text-zinc-600" };
  if (d < 0) return { txt: `Vencida hace ${-d} día${-d === 1 ? "" : "s"}`, cls: "bg-red-100 text-red-700" };
  if (d === 0) return { txt: "Vence hoy", cls: "bg-red-100 text-red-700" };
  if (d <= 30) return { txt: `Vence en ${d} día${d === 1 ? "" : "s"}`, cls: "bg-amber-100 text-amber-800" };
  return { txt: `Vigente · ${d} días restantes`, cls: "bg-emerald-100 text-emerald-700" };
}
// Banner de licencia para el dashboard (avisa si está por vencer).
function LicenseBanner() {
  const [lic, setLic] = useState<LicenseInfo | null>(null);
  useEffect(() => { api.license().then(setLic).catch(() => {}); }, []);
  if (!lic || !lic.valid_until) return null;
  const d = lic.days_left ?? null;
  if (d === null || d > 30) return null; // solo avisa cuando está por vencer/vencida
  const info = vigenciaInfo(d);
  const monto = lic.renewal_amount && Number(lic.renewal_amount) > 0
    ? `${Number(lic.renewal_amount).toLocaleString("es-MX")} ${lic.renewal_currency ?? "MXN"}` : null;
  return (
    <div className={cx("mb-4 rounded-lg border p-3 text-sm",
      d <= 0 ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-800")}>
      🔔 <strong>Licencia:</strong> {info.txt} (vence el {lic.valid_until}).
      {monto && <> Monto de renovación: <strong>{monto}</strong>.</>} Renueva con tu proveedor LogiQ Aduanas.
    </div>
  );
}
// Módulo de Licencia (EMPRESA): vigencia, días restantes y monto de renovación.
function LicenciaView() {
  const [lic, setLic] = useState<LicenseInfo | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { api.license().then(setLic).catch(() => {}).finally(() => setLoading(false)); }, []);
  if (loading) return <div className="p-6 text-sm text-zinc-400">Cargando…</div>;
  const info = vigenciaInfo(lic?.days_left ?? null);
  const monto = lic?.renewal_amount && Number(lic.renewal_amount) > 0
    ? `${Number(lic.renewal_amount).toLocaleString("es-MX")} ${lic.renewal_currency ?? "MXN"}` : "—";
  const row = (k: string, v: React.ReactNode) => (
    <div className="flex justify-between border-b border-zinc-100 py-2.5 text-sm last:border-0">
      <span className="text-zinc-500">{k}</span><span className="font-medium text-zinc-900">{v}</span>
    </div>
  );
  return (
    <div className="max-w-2xl">
      <PageTitle title="Licencia" desc="Estado y vigencia de tu licencia del sistema. El control de licencias lo realiza el administrador de LogiQ." />
      <Card className="p-5">
        {row("Plan", lic?.plan_display ?? "—")}
        {row("Estado", <Pill k={lic?.status}>{lic?.status_display ?? "—"}</Pill>)}
        {row("Vigente hasta", lic?.valid_until ?? "—")}
        {row("Vigencia", <span className={cx("rounded-full px-2 py-0.5 text-xs font-medium", info.cls)}>{info.txt}</span>)}
        {row("Monto de renovación", monto)}
        {lic?.renewal_notes ? row("Notas", lic.renewal_notes) : null}
      </Card>
      <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        Para <strong>renovar</strong> tu licencia, contacta a tu proveedor <strong>LogiQ Aduanas</strong>. Una vez confirmado el pago, el administrador actualizará la vigencia y el sistema se reactivará automáticamente.
      </div>
    </div>
  );
}
function RechazoModal({ s, onClose, onSaved }: { s: Solicitation; onClose: () => void; onSaved: () => void }) {
  const [reason, setReason] = useState(""); const [err, setErr] = useState(""); const [saving, setSaving] = useState(false);
  async function save() {
    if (!reason.trim()) { setErr("Indica el motivo del rechazo."); return; }
    setErr(""); setSaving(true);
    try { await api.rejectSolicitud(s.id, reason.trim()); onSaved(); }
    catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  }
  return (
    <Modal title={`Rechazar — ${s.product_sku}`} onClose={onClose}>
      <p className="mb-3 text-sm text-zinc-500">Explica el motivo del rechazo para que el proveedor pueda corregir y reenviar.</p>
      <textarea value={reason} onChange={(e) => setReason(e.target.value)} autoFocus
        className={cx(inputCls, "h-28")} placeholder="Ej. Falta evidencia del componente X; el VCR no alcanza el umbral…" />
      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
        <Btn variant="danger" onClick={save} disabled={saving}>{saving ? "Rechazando…" : "Rechazar"}</Btn>
      </div>
    </Modal>
  );
}
// Métodos de firma que la empresa puede exigir al proveedor (5).
const SIGN_METHODS = [
  { v: "png", l: "Firma digital (PNG)", d: "El proveedor firma con la firma PNG cargada en su perfil." },
  { v: "manual", l: "Firma manual (escaneada)", d: "El proveedor imprime el certificado, lo firma a mano, lo escanea y lo sube." },
  { v: "qr", l: "Firma por QR", d: "El certificado lleva un código QR de verificación pública." },
  { v: "png_qr", l: "Firma digital + QR", d: "Firma PNG del proveedor más el QR de verificación." },
  { v: "manual_qr", l: "Firma manual + QR", d: "Escaneado firmado a mano más el QR de verificación." },
];
function AceptarFirmaModal({ s, onClose, onAccept }: {
  s: Solicitation; onClose: () => void; onAccept: (method: string) => void;
}) {
  const [method, setMethod] = useState("png");
  return (
    <Modal title={`Aceptar — ${s.product_sku}`} onClose={onClose}>
      <p className="mb-3 text-sm text-zinc-500">Al aceptar se genera el certificado de origen para que el <strong>proveedor lo firme</strong>. Elige <strong>cómo quieres que lo firme</strong>:</p>
      <div className="space-y-2">
        {SIGN_METHODS.map((m) => (
          <label key={m.v} className={cx("flex cursor-pointer items-start gap-2 rounded-lg border p-2.5", method === m.v ? "border-blue-400 bg-blue-50" : "border-zinc-200")}>
            <input type="radio" name="signm" checked={method === m.v} onChange={() => setMethod(m.v)} className="mt-0.5" />
            <span><span className="text-sm font-medium text-zinc-800">{m.l}</span><span className="block text-[11px] text-zinc-500">{m.d}</span></span>
          </label>
        ))}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
        <Btn onClick={() => onAccept(method)}>Aceptar y generar certificado</Btn>
      </div>
    </Modal>
  );
}
function SolicitudesEmpresaView() {
  const { data, count, reload, loading } = useList<Solicitation>(() => api.solicitations());
  const [open, setOpen] = useState(false);
  const [verBom, setVerBom] = useState<Solicitation | null>(null);
  const [rejecting, setRejecting] = useState<Solicitation | null>(null);
  const [aceptando, setAceptando] = useState<Solicitation | null>(null);
  const [periodo, setPeriodo] = useState("");
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState("");
  async function aceptar(s: Solicitation, signMethod: string) {
    setMsg(""); try { await api.acceptSolicitud(s.id, signMethod); setMsg("Declaración aceptada. Se generó el certificado para que el proveedor lo firme."); await reload(); }
    catch (e) { setMsg((e as Error).message); }
  }
  // Periodos distintos presentes (para el filtro).
  const periodos = Array.from(new Set(data.map((s) => periodoTexto(s)).filter((p) => p !== "—")));
  const porPeriodo = periodo ? data.filter((s) => periodoTexto(s) === periodo) : data;
  const visibles = smartFilter(porPeriodo, q, (s) => [s.product_sku, s.supplier_name, s.treaty_code]);
  function exportar() {
    exportCSV("solicitudes", ["Núm. de parte", "Proveedor", "Tratado", "Periodo", "Límite", "Estado"],
      visibles.map((s) => [s.product_sku ?? `#${s.product}`, s.supplier_name ?? "", treatyLabel(s.treaty_code), periodoTexto(s), s.due_date ?? "", s.status_display]));
  }
  return (
    <div>
      <PageTitle title="Solicitudes a proveedores" desc="Pide a tus proveedores la declaración de origen, por periodo." />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-semibold text-zinc-700">Periodo</label>
          <select value={periodo} onChange={(e) => setPeriodo(e.target.value)} className="rounded-lg border border-zinc-300 px-3 py-2 text-sm">
            <option value="">Todos los periodos</option>
            {periodos.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="ml-auto"><Btn onClick={() => setOpen(true)}><Plus size={15} className="-mt-0.5 mr-1 inline" />Nueva solicitud</Btn></div>
      </div>
      <ReportToolbar q={q} setQ={setQ} onExport={exportar} placeholder="Buscar por núm. de parte o proveedor…" />
      {msg && <p className="mb-3 text-sm text-emerald-700">{msg}</p>}
      {(() => {
        const conAlerta = data.filter((s) => dueAlert(s));
        const vencidas = conAlerta.filter((s) => (dueAlert(s)?.label ?? "").startsWith("Vencida")).length;
        const porVencer = conAlerta.length - vencidas;
        if (!conAlerta.length) return null;
        return (
          <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            ⏰ <strong>Recordatorio:</strong> {vencidas > 0 && <span>{vencidas} solicitud(es) <strong>vencida(s)</strong>. </span>}
            {porVencer > 0 && <span>{porVencer} por vencer. </span>}
            Da seguimiento a tus proveedores para recibir sus declaraciones a tiempo.
          </div>
        );
      })()}
      <Table head={["Núm. de parte", "Proveedor", "Tratado", "Periodo", "Origen / PSR", "Límite", "Estado", ""]}>
        {visibles.map((s) => {
          const alert = dueAlert(s);
          return (
          <tr key={s.id}>
            <td className="px-4 py-3 font-mono text-xs">{s.product_sku ?? `#${s.product}`}</td>
            <td className="px-4 py-3">{s.supplier_name ?? "—"}</td>
            <td className="px-4 py-3">{treatyLabel(s.treaty_code)}</td>
            <td className="px-4 py-3 text-xs text-zinc-600">{periodoTexto(s)}</td>
            <td className="px-4 py-3"><OrigenCelda s={s} /></td>
            <td className="px-4 py-3 text-xs">
              {s.due_date ?? "—"}
              {alert && <span className={cx("mt-1 block rounded-full px-2 py-0.5 text-[11px] font-medium", alert.cls)}>{alert.label}</span>}
            </td>
            <td className="px-4 py-3">
              <Pill k={s.status}>{s.status_display}</Pill>
              {s.status === "rejected" && s.rejection_reason &&
                <div className="mt-1 text-[11px] text-red-600">Motivo: {s.rejection_reason}</div>}
            </td>
            <td className="px-4 py-3 text-right whitespace-nowrap">
              {s.submitted_bom && <span className="mr-1 inline-block"><Btn size="sm" variant="ghost" onClick={() => setVerBom(s)}>Ver BOM</Btn></span>}
              {s.status === "responded" && <>
                <span className="mr-1 inline-block"><Btn size="sm" onClick={() => setAceptando(s)}>Aceptar</Btn></span>
                <Btn size="sm" variant="danger" onClick={() => setRejecting(s)}>Rechazar</Btn>
              </>}
              {s.status === "accepted" && s.certificate && (
                <span className="text-[11px] text-zinc-500">
                  {s.certificate.signed
                    ? <button onClick={async () => { try { renderOrigenCertHTML(await api.solicitationCert(s.certificate!.id)); } catch (e) { setMsg((e as Error).message); } }} className="text-blue-600 hover:underline">Ver certificado firmado</button>
                    : <>Certificado pendiente de firma · <span className="text-amber-700">{s.certificate.sign_method_display}</span></>}
                </span>
              )}
            </td>
          </tr>
          );
        })}
        {!loading && visibles.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-zinc-400">{count === 0 ? "Sin solicitudes todavía. Crea una con “Nueva solicitud”." : "Sin solicitudes para ese periodo."}</td></tr>}
      </Table>
      {verBom && <BomViewModal s={verBom} onClose={() => setVerBom(null)} />}
      {rejecting && <RechazoModal s={rejecting} onClose={() => setRejecting(null)}
        onSaved={async () => { setRejecting(null); setMsg("Declaración rechazada."); await reload(); }} />}
      {aceptando && <AceptarFirmaModal s={aceptando} onClose={() => setAceptando(null)}
        onAccept={async (method) => { const s = aceptando; setAceptando(null); await aceptar(s, method); }} />}
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
    <Modal title={`BOM — ${s.product_sku}`} onClose={onClose} wide>
      <div className="mb-3 text-sm text-zinc-600">
        <div><strong>{s.product_sku}</strong> — {s.product_description}</div>
        <div className="text-xs text-zinc-500">HS {s.product_hs} · Tratado {treatyLabel(s.treaty_code)} · Proveedor {s.supplier_name}</div>
        {b?.rule_description && <div className="mt-1 text-xs">Regla (PSR): <strong>{b.rule_hs}</strong> — {b.rule_description}</div>}
      </div>
      <Table head={["Núm. de parte", "Descripción", "HS", "Precio", "Cant.", "U.M.", "Total", "País", "Evidencia"]}>
        {(b?.lines ?? []).map((l, i) => (
          <tr key={i} className={l.has_origin_evidence ? "" : "bg-amber-50/40"}>
            <td className="px-4 py-2 font-mono text-xs">{l.part_number}</td>
            <td className="px-4 py-2">{l.description}</td>
            <td className="px-4 py-2 font-mono text-xs">{formatHs(l.hs_code) || "—"}</td>
            <td className="px-4 py-2 font-mono text-xs">{l.unit_price}</td>
            <td className="px-4 py-2 font-mono text-xs">{l.quantity}</td>
            <td className="px-4 py-2 text-xs" title={l.uom ? uomLabel(l.uom) : ""}>{l.uom || "—"}</td>
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
  const [prodSupplierFilter, setProdSupplierFilter] = useState<number | "">("");  // filtra la lista por proveedor
  const [prodQuery, setProdQuery] = useState("");
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
  // Lista para "productos individuales": filtrada por proveedor elegido y búsqueda.
  const conProveedorVis = smartFilter(
    conProveedor.filter((p) => prodSupplierFilter === "" || p.supplier === prodSupplierFilter),
    prodQuery, (p) => [p.sku, p.description, p.supplier_name ?? ""]);
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
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <select value={prodSupplierFilter} onChange={(e) => setProdSupplierFilter(e.target.value === "" ? "" : Number(e.target.value))}
                  className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm">
                  <option value="">Todos los proveedores</option>
                  {suppliers.map((sp) => <option key={sp.id} value={sp.id}>{sp.name}{sp.code ? ` (${sp.code})` : ""}</option>)}
                </select>
                <input value={prodQuery} onChange={(e) => setProdQuery(e.target.value)} placeholder="Buscar número de parte…"
                  className="flex-1 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm" />
              </div>
              <div className="max-h-48 overflow-y-auto rounded-lg border border-zinc-200">
                {conProveedorVis.length === 0 && <div className="px-3 py-4 text-center text-sm text-zinc-400">{conProveedor.length === 0 ? "No hay productos con proveedor asignado." : "Sin coincidencias para ese proveedor/búsqueda."}</div>}
                {conProveedorVis.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 border-b border-zinc-100 px-3 py-2 text-sm last:border-0">
                    <input type="checkbox" checked={picked.includes(p.id)} onChange={() => toggle(p.id)} />
                    <span className="font-mono text-xs">{p.sku}</span>
                    <span className="flex-1 truncate text-zinc-600">{p.description}</span>
                    <span className="text-xs text-zinc-400">{p.supplier_name}</span>
                  </label>
                ))}
              </div>
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
  const [histFor, setHistFor] = useState<Product | null>(null);
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
              {(p.change_log_count ?? 0) > 0 && (
                <button onClick={() => setHistFor(p)} className="ml-2 text-[11px] text-blue-600 hover:underline">histórico</button>
              )}
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
      {histFor && <PriceHistoryModal product={histFor} onClose={() => setHistFor(null)} />}
    </div>
  );
}
// Estado desde la perspectiva del PROVEEDOR ("sent" -> pendiente por responder).
function estadoProveedor(s: Solicitation) {
  return s.status === "sent" ? "Pendiente por responder" : s.status_display;
}
// "Ya quedó" para el proveedor: respondida o ya ACEPTADA por el cliente. Antes
// solo se contaba "responded" y las aceptadas aparecían como pendientes.
function solAnswered(s: Solicitation) {
  return s.status === "responded" || s.status === "accepted";
}
// Acordeón por producto (modo compacto cuando va dentro de un bloque).
function SolAccordion({ s, defaultOpen, compact, children }: {
  s: Solicitation; defaultOpen?: boolean; compact?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  const alert = dueAlert(s);
  return (
    <Card className="overflow-hidden">
      <button onClick={() => setOpen(!open)}
        className="flex w-full items-start justify-between gap-3 p-4 text-left hover:bg-zinc-50">
        <div className="min-w-0">
          <div className="font-semibold text-zinc-900">{s.product_sku} — {s.product_description}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-600">{s.bom_analysis ? "BOM" : "Declaración"}</span>
            <span className="text-zinc-500">HS {formatHs(s.product_hs ?? "") || "—"} · Precio {s.product_unit_cost}</span>
            {!compact && <>
              <span className="rounded-md bg-blue-600 px-2 py-0.5 font-bold text-white">{treatyLabel(s.treaty_code)}</span>
              {(s.period_from && s.period_to) &&
                <span className="rounded-md bg-zinc-800 px-2 py-0.5 font-semibold text-white">{s.period_display}: {s.period_from} → {s.period_to}</span>}
              {s.due_date && <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-600">Límite: {s.due_date}</span>}
              {alert && <span className={cx("rounded-full px-2 py-0.5 font-medium", alert.cls)}>⏰ {alert.label}</span>}
            </>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Pill k={s.status}>{estadoProveedor(s)}</Pill>
          <ChevronDown size={18} className={cx("text-zinc-400 transition-transform", open && "rotate-180")} />
        </div>
      </button>
      {open && (
        <div className="border-t border-zinc-100 p-5">
          {s.status === "rejected" && s.rejection_reason && (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              ❌ <strong>Rechazado por el cliente.</strong> Corrige y vuelve a enviar. Motivo: {s.rejection_reason}
            </div>
          )}
          {s.status === "accepted" && (
            <div className="mb-3 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
              ✓ <strong>Aceptada por el cliente.</strong> Disponible en “Declaraciones aceptadas”.
            </div>
          )}
          {children}
        </div>
      )}
    </Card>
  );
}
// Bloque: una solicitud de origen (tratado + periodo) que cubre varios productos.
function SolicitudBloque({ items, prod, onDone }: {
  items: Solicitation[]; prod: (id: number) => Product | undefined; onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [layoutDecl, setLayoutDecl] = useState(false);
  const s0 = items[0];
  const esBom = !!s0.bom_analysis;
  const pendingIds = items.filter((i) => !solAnswered(i)).map((i) => i.id);
  const alert = dueAlert(s0);
  const respondidas = items.filter(solAnswered).length;
  const pendientesItems = items.filter((i) => !solAnswered(i));
  const listas = items.filter((i) => i.bom_analysis && i.submitted_bom?.origin_status && !solAnswered(i));
  async function traerTodo() {
    setBusy(true); setMsg("");
    const sinPrevia: string[] = [];
    try {
      for (const i of pendientesItems) {
        const r = await api.copyPrevious(i.id);
        if (!r.found) { sinPrevia.push(i.product_sku ?? `#${i.product}`); continue; }
        await api.submitBom(i.id, { rule: r.rule, lines: r.lines });
        await api.calculateOrigin(i.id);
      }
      setMsg(sinPrevia.length
        ? `Listo. SIN información anterior (llénalos a mano): ${sinPrevia.join(", ")}.`
        : "Información traída y origen calculado para todos. Revisa y envía.");
      await onDone();
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }
  async function enviarTodo() {
    const noListos = pendientesItems.filter((i) => !i.submitted_bom?.origin_status);
    if (listas.length === 0) { setMsg("No hay productos listos para enviar (calcula el origen primero)."); return; }
    if (noListos.length && !confirm(tr(
      `${noListos.length} producto(s) aún no tienen origen calculado y NO se enviarán. ¿Enviar los ${listas.length} listos?`))) return;
    setBusy(true);
    try { for (const i of listas) await api.sendBom(i.id); await onDone(); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Card className="overflow-hidden">
      <button onClick={() => setOpen(!open)}
        className="flex w-full items-start justify-between gap-3 p-4 text-left hover:bg-zinc-50">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-md bg-blue-600 px-2.5 py-1 text-sm font-bold text-white">{treatyLabel(s0.treaty_code)}</span>
            {(s0.period_from && s0.period_to) &&
              <span className="rounded-md bg-zinc-800 px-2.5 py-1 text-sm font-semibold text-white">{s0.period_display}: {s0.period_from} → {s0.period_to}</span>}
            {s0.due_date && <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600">Límite: {s0.due_date}</span>}
            {alert && <span className={cx("rounded-full px-2 py-0.5 text-xs font-medium", alert.cls)}>⏰ {alert.label}</span>}
          </div>
          <div className="mt-1 text-xs text-zinc-500">{items.length} número(s) de parte · {respondidas}/{items.length} enviado(s)</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!esBom && respondidas < items.length && (
            <span role="button" tabIndex={0}
              onClick={(e) => { e.stopPropagation(); setOpen(true); setLayoutDecl(true); }}
              className="rounded-lg bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-700">
              <Upload size={12} className="-mt-0.5 mr-1 inline" />Responder TODO por Excel
            </span>
          )}
          {respondidas === items.length
            ? <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Completa</span>
            : <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">Pendiente</span>}
          <ChevronDown size={18} className={cx("text-zinc-400 transition-transform", open && "rotate-180")} />
        </div>
      </button>
      {open && (
        <div className="space-y-3 border-t border-zinc-100 bg-zinc-50/50 p-4">
          {esBom && respondidas < items.length && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
              <div className="flex flex-wrap items-center gap-2">
                <Btn size="sm" variant="ghost" onClick={traerTodo} disabled={busy}>↩︎ Traer todo de la última solicitud</Btn>
                <Btn size="sm" onClick={enviarTodo} disabled={busy}>Enviar solicitud completa{listas.length ? ` (${listas.length} listo${listas.length === 1 ? "" : "s"})` : ""}</Btn>
                <span className="text-zinc-500">o envía cada producto por separado abajo.</span>
              </div>
              {msg && <div className="mt-2 text-zinc-700">{msg}</div>}
            </div>
          )}
          {!esBom && respondidas < items.length && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
              <div className="flex flex-wrap items-center gap-2">
                <Btn size="sm" onClick={() => setLayoutDecl(true)} disabled={busy}>
                  <Upload size={14} className="-mt-0.5 mr-1 inline" />Responder por Excel (layout)
                </Btn>
                <span className="text-zinc-500">responde todos los productos de esta solicitud en un solo archivo, o uno por uno abajo.</span>
              </div>
            </div>
          )}
          {layoutDecl && (
            <CargaMasivaModal specType="declaration_response" title="Responder por layout (declaración de origen)" onClose={() => setLayoutDecl(false)} onDone={onDone}
              hint="Descarga la plantilla (ya viene con todos los números de parte de esta solicitud), marca por cada uno si es originario, su país y los valores, y súbela. Cada parte quedará respondida."
              templateFn={() => api.solicitudDeclarationTemplate(pendingIds)}
              importFn={(f) => api.importSolicitudDeclarations(pendingIds, f)} />
          )}
          {items.map((i) => (
            <SolAccordion key={i.id} s={i} compact>
              {i.bom_analysis ? <BomCard s={i} onDone={onDone} /> : <SolCard s={i} product={prod(i.product)} onDone={onDone} />}
            </SolAccordion>
          ))}
        </div>
      )}
    </Card>
  );
}
function MisSolicitudesView({ me }: { me: Me }) {
  const { data, reload, count, error } = useList<Solicitation>(() => api.solicitations());
  const products = useList<Product>(() => api.products());
  const prod = (id: number) => products.data.find((p) => p.id === id);
  const cliente = me.tenant?.name;
  const [estadoF, setEstadoF] = useState("");
  const [periodoF, setPeriodoF] = useState("");
  const [tratadoF, setTratadoF] = useState("");
  // Agrupar por BLOQUE: misma solicitud = mismo tratado + periodo + fecha límite.
  const bloques = new Map<string, Solicitation[]>();
  for (const s of data) {
    const key = `${s.treaty_code}__${s.period_from}__${s.period_to}__${s.due_date}`;
    (bloques.get(key) ?? bloques.set(key, []).get(key)!).push(s);
  }
  const periodos = Array.from(new Set(data.map((s) => periodoTexto(s)).filter((p) => p !== "—")));
  const tratados = Array.from(new Set(data.map((s) => s.treaty_code ?? "")));
  const bloquesFiltrados = Array.from(bloques.values()).filter((items) => {
    const s0 = items[0];
    const completa = items.every(solAnswered);
    if (estadoF === "pendiente" && completa) return false;
    if (estadoF === "completa" && !completa) return false;
    if (periodoF && periodoTexto(s0) !== periodoF) return false;
    if (tratadoF && (s0.treaty_code ?? "") !== tratadoF) return false;
    return true;
  });
  const selCls = "rounded-lg border border-zinc-300 px-3 py-2 text-sm";
  return (
    <div>
      <PageTitle title={`Solicitudes de cliente${cliente ? ` (${cliente})` : ""}`}
        desc="Cada bloque es una solicitud (tratado + periodo). Haz clic para ver y responder sus productos." />
      {error ? (
        <Card className="p-8 text-center text-sm text-red-600">
          No se pudieron cargar las solicitudes ({error}).{" "}
          <button onClick={reload} className="font-semibold underline">Reintentar</button>
        </Card>
      ) : count === 0
        ? <Card className="p-8 text-center text-zinc-400">No tienes solicitudes pendientes.</Card>
        : <>
            <div className="mb-4 flex flex-wrap items-end gap-3">
              <div><label className="mb-1 block text-xs font-semibold text-zinc-700">Estado</label>
                <select value={estadoF} onChange={(e) => setEstadoF(e.target.value)} className={selCls}>
                  <option value="">Todas</option><option value="pendiente">Pendientes</option><option value="completa">Completas</option>
                </select></div>
              <div><label className="mb-1 block text-xs font-semibold text-zinc-700">Tratado</label>
                <select value={tratadoF} onChange={(e) => setTratadoF(e.target.value)} className={selCls}>
                  <option value="">Todos</option>
                  {tratados.map((t) => <option key={t} value={t}>{treatyLabel(t)}</option>)}
                </select></div>
              <div><label className="mb-1 block text-xs font-semibold text-zinc-700">Periodo</label>
                <select value={periodoF} onChange={(e) => setPeriodoF(e.target.value)} className={selCls}>
                  <option value="">Todos</option>
                  {periodos.map((p) => <option key={p} value={p}>{p}</option>)}
                </select></div>
            </div>
            <div className="space-y-3">
              {bloquesFiltrados.map((items) => (
                <SolicitudBloque key={items[0].id} items={items} prod={prod} onDone={reload} />
              ))}
              {bloquesFiltrados.length === 0 && <Card className="p-8 text-center text-zinc-400">Sin solicitudes para esos filtros.</Card>}
            </div>
          </>}
    </div>
  );
}
// Panel de orientación reutilizable (sugerencia + disclaimer).
function SugerenciaPanel({ s, onUse, ruleId }: { s: Solicitation; onUse: (id: number) => void; ruleId: number | "" }) {
  if (!s.origin_hint) return null;
  return (
    <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
      💡 <strong>Sugerencia del sistema:</strong> {s.origin_hint}
      {s.suggested_rule && (
        <div className="mt-1.5">
          Regla sugerida: <strong className="font-mono">{formatHs(s.suggested_rule.hs_pattern)}</strong> · {ruleTypeLabel(s.suggested_rule.rule_type, s.suggested_rule.shift_level)}{cleanRuleDesc(s.suggested_rule.description) ? ` — ${cleanRuleDesc(s.suggested_rule.description)}` : ""}
          {ruleId !== s.suggested_rule.id &&
            <button onClick={() => onUse(s.suggested_rule!.id)} className="ml-2 rounded bg-blue-600 px-2 py-0.5 font-medium text-white">Usar</button>}
        </div>
      )}
    </div>
  );
}
const disclaimerNode = (
  <p className="mt-3 rounded-lg bg-zinc-50 px-3 py-2 text-[11px] text-zinc-500">
    ⚖️ El sistema te <strong>orienta</strong> en el llenado, pero <strong>no sustituye la asesoría profesional</strong>.
    Se recomienda que toda la información sea <strong>validada por una persona con conocimientos en certificación de origen</strong>.
  </p>
);
function SolCard({ s, product, onDone }: {
  s: Solicitation; product?: Product; onDone: () => void;
}) {
  const [orig, setOrig] = useState(true);
  const [country, setCountry] = useState(product?.country_of_origin ?? "");
  const [ruleId, setRuleId] = useState<number | "">(s.suggested_rule?.id ?? "");
  const [vOrig, setVOrig] = useState(""); const [vNon, setVNon] = useState("");
  const [rules, setRules] = useState<OriginRule[]>([]);
  const [saving, setSaving] = useState(false); const [err, setErr] = useState(""); const [msg, setMsg] = useState("");
  const done = solAnswered(s);
  useEffect(() => {
    api.rules(`?treaty=${s.treaty}&hs=${encodeURIComponent(s.product_hs ?? "")}`)
      .then((d: { results?: OriginRule[] } | OriginRule[]) =>
        setRules(Array.isArray(d) ? d : (d.results ?? []))).catch(() => {});
  }, [s.treaty, s.product_hs]);
  const price = Number(s.product_unit_cost ?? product?.unit_cost ?? 0);
  const sumMat = Number(vOrig || 0) + Number(vNon || 0);
  const overPrice = price > 0 && sumMat > price;
  const cellI = "mt-1 w-full rounded-lg border border-zinc-300 px-2 py-1.5";
  async function submit() {
    if (!isValidCountry(country)) { setErr("País no válido. Usa un código ISO-2 del catálogo."); return; }
    if (overPrice) { setErr(`La suma de materiales (${sumMat}) no puede superar el precio de venta (${price}).`); return; }
    setErr(""); setSaving(true);
    try {
      await api.respond(s.id, {
        is_originating: orig, country_of_origin: country,
        rule: ruleId === "" ? null : Number(ruleId),
        value_originating: vOrig || "0", value_non_originating: vNon || "0",
        // La vigencia la toma el backend del periodo solicitado por la empresa.
      });
      onDone();
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  }
  async function traerPrevia() {
    setErr(""); setMsg(""); setSaving(true);
    try {
      const r = await api.copyPrevious(s.id);
      if (!r.found) { setMsg("No hay información de un periodo anterior para este producto."); return; }
      setOrig(!!r.is_originating);
      setCountry(r.country_of_origin ?? "");
      setRuleId(r.rule ?? "");
      setVOrig(String(r.value_originating ?? "")); setVNon(String(r.value_non_originating ?? ""));
      setMsg(`Información traída del periodo anterior (${r.source_period ?? ""}). Revisa y envía.`);
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  }
  if (done) return <p className="text-sm text-zinc-500">Ya enviaste tu declaración. ¡Gracias!</p>;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Btn size="sm" variant="ghost" onClick={traerPrevia} disabled={saving}>↩︎ Traer información de última solicitud</Btn>
        {msg && <span className="text-xs text-emerald-700">{msg}</span>}
      </div>
      <SugerenciaPanel s={s} ruleId={ruleId} onUse={setRuleId} />
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="col-span-2">
          <label className="block text-xs text-zinc-500">Origen para este tratado</label>
          <div className="mt-1 inline-flex overflow-hidden rounded-lg border border-zinc-300">
            <button type="button" onClick={() => setOrig(true)}
              className={cx("px-4 py-1.5 text-sm font-semibold", orig ? "bg-green-600 text-white" : "bg-white text-zinc-600 hover:bg-zinc-50")}>
              Originario
            </button>
            <button type="button" onClick={() => setOrig(false)}
              className={cx("px-4 py-1.5 text-sm font-semibold", !orig ? "bg-red-600 text-white" : "bg-white text-zinc-600 hover:bg-zinc-50")}>
              No originario
            </button>
          </div>
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-zinc-500">Regla de origen específica (PSR)</label>
          <select value={ruleId} onChange={(e) => setRuleId(e.target.value === "" ? "" : Number(e.target.value))} className={cellI}>
            <option value="">— Selecciona la regla aplicable —</option>
            {rules.map((r) => <option key={r.id} value={r.id}>{ruleOptionLabel(r)}</option>)}
          </select>
        </div>
        <div><label className="block text-xs text-zinc-500">País (ISO-2)</label>
          <span className="mt-1 block"><CountryInput value={country} onChange={setCountry} className="w-full rounded-lg border border-zinc-300 px-2 py-1.5" /></span></div>
        <div />
        <div><label className="block text-xs text-zinc-500">Valor de materiales ORIGINARIOS</label>
          <input type="number" step="0.0001" value={vOrig} onChange={(e) => setVOrig(e.target.value)} className={cellI} /></div>
        <div><label className="block text-xs text-zinc-500">Valor de materiales NO originarios</label>
          <input type="number" step="0.0001" value={vNon} onChange={(e) => setVNon(e.target.value)} className={cellI} /></div>
        <div className="col-span-2 text-xs text-zinc-500">
          Suma de materiales: <strong className={overPrice ? "text-red-600" : ""}>{sumMat.toFixed(2)}</strong>
          {price > 0 && <> · Precio de venta: {price.toFixed(2)}</>}
          {overPrice && <span className="ml-2 font-medium text-red-600">⚠️ La suma supera el precio de venta</span>}
        </div>
        <div className="col-span-2 rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-500">
          Vigencia: corresponde al <strong>periodo solicitado por el cliente</strong>
          {(s.period_from && s.period_to) ? <> ({s.period_from} → {s.period_to})</> : null}.
        </div>
        {err && <p className="col-span-2 text-sm text-red-600">{err}</p>}
        <div className="col-span-2"><Btn onClick={submit} disabled={saving || overPrice}>{saving ? "Enviando…" : "Enviar declaración"}</Btn></div>
      </div>
      {disclaimerNode}
    </div>
  );
}
function emptyBomLine(): BomLine {
  return { part_number: "", description: "", hs_code: "", unit_price: "", quantity: "", uom: "", country: "", has_origin_evidence: false };
}
/* Reporte del análisis de origen (CTC / VCR) a partir del detalle calculado. */
function OriginReport({ bom }: { bom: SubmittedBom }) {
  if (!bom.origin_status) return null;
  const d = (bom.detail ?? {}) as {
    rule?: string; rule_type?: string; error?: string; automotive_regime?: string; automotive_core?: string;
    tariff_shift?: { shift_level: string; violating_value: string; violating_pct: string; de_minimis: string; except_codes?: string[]; components: { sku: string; shifted: boolean; in_exception?: boolean }[] };
    rvc?: { method: string; threshold: string; rvc: string; vnm: string; transaction_value: string };
  };
  const review = bom.origin_status === "AUTO_REVIEW";
  const ok = bom.origin_status === "QUALIFIES";
  const insf = bom.origin_status === "INSUFFICIENT";
  return (
    <div className="mt-3 rounded-lg border border-zinc-200 p-3">
      <div className="flex items-center gap-2">
        <span className={cx("rounded-full px-2.5 py-0.5 text-sm font-semibold",
          ok ? "bg-green-100 text-green-700" : (insf || review) ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700")}>
          {ok ? "Originario: SÍ" : review ? "Requiere régimen automotriz" : insf ? "Datos insuficientes" : "Originario: NO"}
        </span>
        {d.automotive_core && (
          <span className="text-[11px] text-amber-800">🚗 parte esencial (core)</span>
        )}
        {bom.criterion && <span className="text-xs text-zinc-500">Criterio: <strong>{bom.criterion}</strong></span>}
        {bom.rvc_value != null && <span className="text-xs text-zinc-500">VCR: <strong>{bom.rvc_value}%</strong></span>}
      </div>
      {d.automotive_core && (
        <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
          🚗 <strong>Parte esencial (core part).</strong> {d.automotive_core}
        </div>
      )}
      {d.error && <p className="mt-2 text-sm text-amber-700">{d.error}</p>}
      {d.rule && <p className="mt-2 text-xs text-zinc-500">Regla aplicada: <strong>{d.rule}</strong></p>}
      {d.automotive_regime && (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
          🚗 <strong>Régimen automotriz.</strong> {d.automotive_regime}
        </div>
      )}
      {d.tariff_shift && (
        <div className="mt-2 text-xs">
          <div className="font-semibold text-zinc-700">Salto arancelario ({d.tariff_shift.shift_level})</div>
          <div className="text-zinc-500">Valor que no salta: {d.tariff_shift.violating_value} ({d.tariff_shift.violating_pct}%) · de minimis permitido {d.tariff_shift.de_minimis}%
            {d.tariff_shift.except_codes && d.tariff_shift.except_codes.length > 0 && <> · excepto desde {d.tariff_shift.except_codes.map(formatHs).join(", ")}</>}</div>
          <ul className="mt-1 space-y-0.5">
            {d.tariff_shift.components.map((c, i) => (
              <li key={i} className={c.shifted && !c.in_exception ? "text-green-700" : "text-red-700"}>
                {c.shifted && !c.in_exception ? "✓" : "✗"} {c.sku} — {c.in_exception ? "viene de una clasificación excluida por la regla" : c.shifted ? "cambia de clasificación" : "NO cambia (mismo capítulo/partida)"}
              </li>
            ))}
          </ul>
        </div>
      )}
      {d.rvc && (
        <div className="mt-2 text-xs">
          <div className="font-semibold text-zinc-700">Valor de Contenido Regional (VCR)</div>
          <div className="text-zinc-500">VCR {d.rvc.rvc}% vs umbral {d.rvc.threshold}% · método {d.rvc.method === "net_cost" ? "Costo neto" : "Valor de transacción"} · valor no originario {d.rvc.vnm} sobre base {d.rvc.transaction_value}</div>
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
      u: l.uom || "", c: l.country, e: l.has_origin_evidence,
    })),
  });
}
function BomCard({ s, onDone }: { s: Solicitation; onDone: () => void }) {
  const done = solAnswered(s);
  const [rules, setRules] = useState<OriginRule[]>([]);
  const [ruleId, setRuleId] = useState<number | "">(s.submitted_bom?.rule ?? "");
  const [rvcMethod, setRvcMethod] = useState(s.submitted_bom?.rvc_method ?? "transaction");
  const [netCost, setNetCost] = useState(s.submitted_bom?.net_cost ?? "");
  const [lines, setLines] = useState<BomLine[]>(
    s.submitted_bom?.lines?.length ? s.submitted_bom.lines : [emptyBomLine()]);
  const [saving, setSaving] = useState(false); const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [showLog, setShowLog] = useState(false);
  const [layout, setLayout] = useState(false);
  // Huella de lo traído de un periodo anterior (para avisar si no cambió).
  const [broughtSnap, setBroughtSnap] = useState<string | null>(null);
  useEffect(() => {
    api.rules(`?treaty=${s.treaty}&hs=${encodeURIComponent(s.product_hs ?? "")}`)
      .then((d: { results?: OriginRule[] } | OriginRule[]) =>
        setRules(Array.isArray(d) ? d : (d.results ?? []))).catch(() => {});
  }, [s.treaty, s.product_hs]);
  // Preselecciona la regla sugerida por el sistema si aún no hay una elegida.
  useEffect(() => {
    if (ruleId === "" && s.suggested_rule) setRuleId(s.suggested_rule.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.suggested_rule?.id]);
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
      await api.submitBom(s.id, bomPayload(valid));
      onDone();
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  }
  function bomPayload(valid: BomLine[]) {
    return {
      rule: ruleId === "" ? null : Number(ruleId),
      rvc_method: rvcMethod, net_cost: rvcMethod === "net_cost" ? (netCost || "0") : "0",
      lines: valid.map((l) => ({
        part_number: l.part_number, description: l.description, hs_code: l.hs_code,
        unit_price: l.unit_price || "0", quantity: l.quantity || "0", uom: l.uom || "",
        country: l.country, has_origin_evidence: l.has_origin_evidence,
      })),
    };
  }
  async function calcular() {
    const valid = lines.filter((l) => l.part_number.trim());
    if (valid.length === 0) { setErr("Agrega al menos un componente con número de parte."); return; }
    if (valid.some((l) => !isValidCountry(l.country))) { setErr("Hay un país no válido en el detalle (usa un código ISO-2 del catálogo)."); return; }
    setErr(""); setSaving(true);
    try {
      // Guarda el BOM actual y luego calcula el origen.
      await api.submitBom(s.id, bomPayload(valid));
      await api.calculateOrigin(s.id);
      onDone();
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  }
  async function enviar() {
    setErr("");
    // ¿Es idéntico a lo traído de un periodo anterior? -> advertir.
    const unchanged = broughtSnap !== null && bomSnapshot(lines, ruleId) === broughtSnap;
    if (unchanged && !confirm(tr(
      "La información no ha cambiado desde el último periodo. Verifica si los precios y " +
      "orígenes de tu BOM no han cambiado. ¿Deseas continuar y enviar igual?"))) return;
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
  return (
    <>
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
        <Btn size="sm" variant="ghost" onClick={() => setLayout(true)} disabled={saving}><Upload size={14} className="-mt-0.5 mr-1 inline" />Responder por Excel</Btn>
        {(s.logs?.length ?? 0) > 0 && (
          <Btn size="sm" variant="ghost" onClick={() => setShowLog(true)}>Ver historial</Btn>
        )}
        {msg && <span className="text-xs text-emerald-700">{msg}</span>}
      </div>
      {layout && (
        <CargaMasivaModal specType="bom_response" title="Responder por layout (Excel)" onClose={() => setLayout(false)} onDone={onDone}
          hint="Para solicitudes grandes: descarga la plantilla, captura todos los componentes y súbela. Reemplaza el detalle del BOM; luego revisa, calcula el origen y envía."
          templateFn={() => api.solicitudBomTemplate()} importFn={(f) => api.importSolicitudBom(s.id, f)} />
      )}

      {/* Sugerencia del sistema (orientación) */}
      {s.origin_hint && (
        <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
          💡 <strong>Sugerencia del sistema:</strong> {s.origin_hint}
          {s.suggested_rule && (
            <div className="mt-1.5">
              Regla sugerida: <strong className="font-mono">{formatHs(s.suggested_rule.hs_pattern)}</strong> · {s.suggested_rule.rule_type} — {s.suggested_rule.description}
              {ruleId !== s.suggested_rule.id &&
                <button onClick={() => setRuleId(s.suggested_rule!.id)} className="ml-2 rounded bg-blue-600 px-2 py-0.5 font-medium text-white">Usar</button>}
            </div>
          )}
        </div>
      )}

      {/* Regla de origen (PSR) */}
      <div className="mb-3">
        <label className="mb-1 block text-xs font-semibold text-zinc-700">Regla de origen específica (PSR)</label>
        <select value={ruleId} onChange={(e) => setRuleId(e.target.value === "" ? "" : Number(e.target.value))} className={cell}>
          <option value="">— Selecciona la regla aplicable —</option>
          {rules.map((r) => <option key={r.id} value={r.id}>{ruleOptionLabel(r)}</option>)}
        </select>
        {rules.length === 0 && <p className="mt-1 text-xs text-zinc-400">No hay PSR para esta fracción/tratado en el catálogo; puedes continuar sin seleccionarla.</p>}
      </div>

      {/* Método de VCR (valor de transacción o costo neto) */}
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-semibold text-zinc-700">Método de VCR</label>
          <select value={rvcMethod} onChange={(e) => setRvcMethod(e.target.value)} className={cell}>
            <option value="transaction">Valor de transacción (precio de venta)</option>
            <option value="net_cost">Costo neto</option>
          </select>
        </div>
        {rvcMethod === "net_cost" && (
          <div>
            <label className="mb-1 block text-xs font-semibold text-zinc-700">Costo neto</label>
            <input type="number" step="0.0001" value={netCost} onChange={(e) => setNetCost(e.target.value)} className={cx(cell, "w-40")} placeholder="0.00" />
          </div>
        )}
        <span className="text-xs text-zinc-400">El VCR se calcula sobre esta base; cada método tiene su umbral.</span>
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
              <th className="px-1 py-1 font-medium">U.M.</th>
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
                <td className="px-1 py-1"><UomSelect value={l.uom} onChange={(v) => setLine(i, "uom", v)} className={cx(cell, "w-24")} /></td>
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

      <p className="mt-3 rounded-lg bg-zinc-50 px-3 py-2 text-[11px] text-zinc-500">
        ⚖️ El sistema te <strong>orienta</strong> en el llenado, pero <strong>no sustituye la asesoría profesional</strong>.
        Se recomienda que toda la información sea <strong>validada por una persona con conocimientos en certificación de origen</strong>.
      </p>
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
    </>
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
