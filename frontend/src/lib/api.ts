// Cliente de la API de FTA (LogiQ Aduanas).
const BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8100/api";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("fta_token");
}
export function setToken(t: string) {
  localStorage.setItem("fta_token", t);
}
export function clearToken() {
  localStorage.removeItem("fta_token");
}

// "Abrir empresa": el equipo LogiQ (master) ve una empresa como admin sin login
// aparte. Se guarda el id del tenant y se manda en cada request (X-As-Tenant).
export function getAsTenant(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("fta_as_tenant");
}
export function setAsTenant(id: number | string) {
  localStorage.setItem("fta_as_tenant", String(id));
}
export function clearAsTenant() {
  localStorage.removeItem("fta_as_tenant");
}
function authHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  const token = getToken();
  if (token) h["Authorization"] = `Token ${token}`;
  const as = getAsTenant();
  if (as) h["X-As-Tenant"] = as;
  return h;
}

async function req(path: string, opts: RequestInit = {}) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...authHeaders(),
    ...((opts.headers as Record<string, string>) || {}),
  };
  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    // Surface DRF field errors (p.ej. {"sku": "Ya existe…"}) además de error/detail.
    let fieldErr: string | null = null;
    if (data && typeof data === "object") {
      for (const v of Object.values(data)) {
        if (typeof v === "string") { fieldErr = v; break; }
        if (Array.isArray(v) && typeof v[0] === "string") { fieldErr = v[0]; break; }
      }
    }
    throw new Error(data.error || data.detail || fieldErr || `HTTP ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

// Descarga un archivo (xlsx) autenticado y dispara la descarga en el navegador.
async function downloadFile(path: string, filename: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  a.remove(); URL.revokeObjectURL(url);
}

// Sube un archivo (multipart) y devuelve el JSON de respuesta.
async function uploadFile(path: string, file: File) {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: authHeaders(),
    body: fd,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.detail || `HTTP ${res.status}`);
  return data;
}

// Envía un formulario multipart (archivo + campos) y devuelve el JSON.
async function uploadForm(path: string, fields: Record<string, string | number | File>) {
  const fd = new FormData();
  Object.entries(fields).forEach(([k, v]) => fd.append(k, v instanceof File ? v : String(v)));
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: authHeaders(),
    body: fd,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.detail || `HTTP ${res.status}`);
  return data;
}

// POST que descarga un archivo binario (ej. el layout del cliente generado).
async function downloadPost(path: string, body: Record<string, unknown>, filename: string) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || data.detail || `HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  a.remove(); URL.revokeObjectURL(url);
}

export type BulkResult = {
  creados: number; actualizados: number; omitidos?: number;
  errores: { fila: number; error: string }[];
  advertencias?: { fila: number; error: string }[];
  creados_skus?: string[]; actualizados_skus?: string[]; sin_precio_skus?: string[];
  duplicados_skus?: string[];
};
export type BulkPreview = {
  total: number; existentes: number; nuevos: number; existentes_skus: string[];
  duplicados?: number; duplicados_skus?: string[];
};
export type EmittedCertificate = {
  id: number; folio: string;
  certifier_data: Record<string, string>; importer_data: Record<string, string>;
  producer_data?: Record<string, string>; exporter_data?: Record<string, string>;
  blanket_from: string | null; blanket_to: string | null; issued_at: string;
  product_sku: string; product_description: string; product_hs: string;
  treaty_code: string; treaty_label: string; criterion: string;
  origin_status: string; rvc_value: string | null;
  verify_url?: string; qr_data_uri?: string;
};

export type HsLog = {
  old_hs: string; new_hs: string; action: string;
  suggested_by: string; note: string; created_at: string;
};
export type ProductChangeLog = {
  kind: "price" | "origin"; kind_display: string;
  old_value: string; new_value: string;
  old_price: string | null; new_price: string | null; currency: string;
  source: "manual" | "bulk" | "supplier"; source_display: string;
  changed_by: string | null; created_at: string;
};
export type Product = {
  id: number; sku: string; description: string; kind: string;
  kind_display?: string; hs_code: string; unit_cost: string; conversion_cost?: string;
  currency: string; country_of_origin: string; supplier: number | null;
  supplier_name?: string | null; supplier_code?: string | null;
  is_active: boolean;
  hs_suggested?: string; hs_suggestion_status?: string;
  hs_suggestion_note?: string; hs_suggested_by_name?: string | null;
  hs_logs?: HsLog[]; change_log_count?: number; is_automotive_core?: boolean;
  customers?: number[]; customer_names?: { id: number; name: string }[];
};
export type Treaty = { id: number; code: string; name: string };
export type ComponentDeclaration = {
  treaty_code?: string; valid_from: string | null; valid_to: string | null;
  is_originating: boolean; country: string;
};
export type BomComponent = {
  id: number; parent: number; component: number; quantity: string; uom?: string;
  origin_mode: "supplier" | "manual"; origin_as_of: string | null;
  manual_is_originating: boolean; manual_country: string;
  component_sku?: string; component_description?: string; component_hs?: string;
  component_unit_cost?: string; component_supplier_name?: string | null;
  component_declarations?: ComponentDeclaration[];
};
export type BomOriginComponent = BomComponent & { declarations: ComponentDeclaration[]; originating?: boolean | null };
export type BomOriginResponse = {
  product: Product; components: BomOriginComponent[]; treaty_members?: string[];
  total_value?: string; conversion_cost?: string; net_cost?: string; vnm?: string;
  suggested_rule?: { id: number; hs_pattern: string; rule_type: string; description: string } | null;
  automotive_core_code?: string | null;
};
export type OriginCalcResult = {
  status: string; criterion: string; rvc_value: string | number | null;
  detail: Record<string, unknown>;
};
export type OriginAnalysis = {
  id: number; product: number; product_sku?: string; product_description?: string;
  product_hs?: string; treaty: number; treaty_code?: string;
  kind: string; kind_display?: string; status: string; status_display?: string;
  criterion: string; rvc_value: string | null; total_value: string | null;
  vnm: string | null; computed_by?: string | null; created_at: string;
};
export type OriginAnalysisDetail = OriginAnalysis & { detail: Record<string, unknown> };
export type AutoPillar = {
  key: string; label: string; value: string | null; threshold: string; ok: boolean;
  detail: string; informational?: boolean; unit?: string; value_pct?: string | null;
};
export type AutomotiveResult = {
  vehicle_class: string; class_label: string; as_of: string | null; qualifies: boolean;
  pillars: AutoPillar[]; failing: string[]; rvc_value: string | null; disclaimer: string;
  rvc_method?: string;
};
export type AutomotiveSaved = {
  vehicle_class?: string; as_of?: string | null; net_cost?: string; vnm?: string;
  lvc_pct?: string; lvc_value?: string; wage_usd_h?: string; steel_na_pct?: string;
  aluminum_na_pct?: string; core_parts_originating?: boolean; detail?: AutomotiveResult;
};
export type SupplierUser = { id: number; username: string; must_change_password: boolean; is_locked: boolean };
export type Party = {
  id: number; kind: string; kind_display?: string; name: string;
  code: string; slug: string; tax_id: string; country: string;
  email: string; phone: string; access_users: SupplierUser[];
};
export type Qualification = {
  id: number; product: number; treaty: number; treaty_code?: string; status: string;
  status_display: string; criterion: string; rvc_value: string | null;
};
export type Me = {
  username: string; role: string | null; role_display?: string;
  is_supplier?: boolean; is_master?: boolean; impersonating?: boolean;
  must_change_password?: boolean;
  tenant: { id: number; name: string; slug: string; logo?: string } | null;
  supplier: { id: number; name: string; slug: string } | null;
};
export type BomLine = {
  id?: number; part_number: string; description: string; hs_code: string;
  unit_price: string; quantity: string; uom: string; country: string;
  has_origin_evidence: boolean; total?: string;
};
export type SubmittedBom = {
  id: number; rule: number | null; rule_description?: string | null;
  rule_hs?: string | null; rule_type?: string | null; notes: string; lines: BomLine[];
  rvc_method?: string; net_cost?: string;
  origin_status?: string; criterion?: string; rvc_value?: string | null;
  detail?: Record<string, unknown>; computed_at?: string | null;
};
export type OriginRule = {
  id: number; hs_pattern: string; rule_type: string; description: string;
  treaty: number; treaty_code?: string; treaty_label?: string;
  params?: Record<string, unknown>;
  display_type?: string; display_description?: string; has_override?: boolean;
};
export type SolLog = {
  action: string; action_label: string; detail: string;
  user: string | null; created_at: string;
};
export type SupplierProfile = {
  id?: number; party?: number; party_name?: string; party_code?: string;
  legal_name: string; tax_id: string; address: string; city: string;
  state: string; postal_code: string; country: string;
  contact_name: string; contact_email: string; contact_phone: string;
  signatory_name: string; signatory_title: string; signature_png: string;
};
export type CompanyProfile = {
  id?: number; tenant?: number; tenant_name?: string;
  legal_name: string; tax_id: string; address: string; city: string;
  state: string; postal_code: string; country: string;
  contact_name: string; contact_email: string; contact_phone: string;
  signatory_name: string; signatory_title: string; signature_png: string;
  logo_png?: string;
};
export type DeclarationDetail = {
  is_originating: boolean; country_of_origin: string;
  rule_description: string | null; rule_type: string | null;
  value_originating: string; value_non_originating: string;
  valid_from: string | null; valid_to: string | null;
};
export type Solicitation = {
  id: number; product: number; supplier: number; treaty: number;
  status: string; status_display: string; due_date: string | null;
  period_type: string; period_display?: string;
  period_from: string | null; period_to: string | null;
  bom_analysis: boolean; submitted_bom: SubmittedBom | null;
  product_sku?: string; product_description?: string; product_hs?: string;
  product_unit_cost?: string; treaty_code?: string; supplier_name?: string;
  supplier_country?: string; tenant_name?: string;
  treaty_members?: string[]; treaty_de_minimis?: string; logs?: SolLog[];
  suggested_rule?: { id: number; hs_pattern: string; rule_type: string; description: string } | null;
  origin_hint?: string; declared_originating?: boolean | null;
  declaration_detail?: DeclarationDetail | null;
  supplier_profile?: SupplierProfile | null;
  rejection_reason?: string;
  certificate?: SolCertLite | null;
};
export type SolCertLite = {
  id: number; signed: boolean; sign_method: string;
  sign_method_display: string; folio: string; signed_at: string | null;
};
export type ClientLayout = {
  id: number; client: number; client_name?: string; treaty: number; treaty_code?: string;
  name: string; filename: string; sheet_name: string; header_row: number;
  headers: Record<string, string>; mapping: Record<string, string>; updated_at?: string;
};
export type SolicitationCert = {
  id: number; solicitation: number; folio: string; verify_token: string;
  data: {
    producer?: Record<string, string>; importer?: Record<string, string>;
    product?: { sku: string; description: string; hs: string };
    treaty?: { code: string; label: string };
    origin?: { is_originating: boolean | null; country: string; criterion: string; rule: string };
    period?: { from: string | null; to: string | null };
  };
  sign_method: string; sign_method_display: string;
  signature_png: string; scanned_file: string; signed: boolean;
  signed_at: string | null; verify_url?: string; qr_data_uri?: string;
};

export const api = {
  async login(username: string, password: string,
              opts?: { tenantSlug?: string; supplierSlug?: string }) {
    const body: Record<string, unknown> = { username, password };
    if (opts?.tenantSlug) body.tenant_slug = opts.tenantSlug;
    if (opts?.supplierSlug) body.supplier_slug = opts.supplierSlug;
    const res = await fetch(`${BASE}/login/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || "Usuario o contraseña incorrectos.");
    }
    const data = await res.json();
    setToken(data.token);
    return data;
  },
  me: (): Promise<Me> => req("/me/"),
  products: () => req("/products/"),
  createProduct: (payload: Record<string, unknown>) =>
    req("/products/", { method: "POST", body: JSON.stringify(payload) }),
  updateProduct: (id: number, payload: Record<string, unknown>) =>
    req(`/products/${id}/`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteProduct: (id: number) =>
    req(`/products/${id}/`, { method: "DELETE" }),
  suggestHs: (productId: number, hs_suggested: string, note: string) =>
    req(`/products/${productId}/suggest-hs/`, {
      method: "POST", body: JSON.stringify({ hs_suggested, note }),
    }),
  resolveHs: (productId: number, action: "accept" | "reject") =>
    req(`/products/${productId}/resolve-hs/`, {
      method: "POST", body: JSON.stringify({ action }),
    }),
  setCountry: (productId: number, country_of_origin: string) =>
    req(`/products/${productId}/set-country/`, {
      method: "POST", body: JSON.stringify({ country_of_origin }),
    }),
  productHistory: (productId: number): Promise<ProductChangeLog[]> =>
    req(`/products/${productId}/history/`),
  treaties: () => req("/treaties/"),
  qualifications: () => req("/qualifications/"),
  bomComponents: (parentId: number) => req(`/bom-components/?parent=${parentId}`),
  addBomComponent: (payload: Record<string, unknown>) =>
    req("/bom-components/", { method: "POST", body: JSON.stringify(payload) }),
  updateBomComponent: (id: number, payload: Record<string, unknown>) =>
    req(`/bom-components/${id}/`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteBomComponent: (id: number) =>
    req(`/bom-components/${id}/`, { method: "DELETE" }),
  productBomOrigin: (id: number, treaty: number): Promise<BomOriginResponse> =>
    req(`/products/${id}/bom-origin/?treaty=${treaty}`),
  calcBomOrigin: (id: number, treaty: number, as_of?: string | null): Promise<OriginCalcResult> =>
    req(`/products/${id}/calc-bom-origin/`, {
      method: "POST", body: JSON.stringify({ treaty, as_of: as_of || null }),
    }),
  originAnalyses: (productId: number, treaty?: number): Promise<{ results: OriginAnalysis[] } | OriginAnalysis[]> =>
    req(`/origin-analyses/?product=${productId}${treaty ? `&treaty=${treaty}` : ""}`),
  originAnalysis: (id: number): Promise<OriginAnalysisDetail> =>
    req(`/origin-analyses/${id}/`),
  deleteOriginAnalysis: (id: number): Promise<null> =>
    req(`/origin-analyses/${id}/`, { method: "DELETE" }),
  automotive: (id: number, treaty: number): Promise<AutomotiveSaved> =>
    req(`/products/${id}/automotive/?treaty=${treaty}`),
  calcAutomotive: (id: number, payload: Record<string, unknown>): Promise<AutomotiveResult> =>
    req(`/products/${id}/calc-automotive/`, { method: "POST", body: JSON.stringify(payload) }),
  solicitations: () => req("/solicitations/"),
  declarations: () => req("/supplier-declarations/"),
  parties: (kind?: string) => req(kind ? `/parties/?kind=${kind}` : "/parties/"),
  createParty: (payload: Record<string, unknown>) =>
    req("/parties/", { method: "POST", body: JSON.stringify(payload) }),
  updateParty: (id: number, payload: Record<string, unknown>) =>
    req(`/parties/${id}/`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteParty: (id: number) =>
    req(`/parties/${id}/`, { method: "DELETE" }),
  supplierUsers: (partyId: number) => req(`/parties/${partyId}/users/`),
  addSupplierUser: (partyId: number, username: string, password?: string) =>
    req(`/parties/${partyId}/users/`, {
      method: "POST",
      body: JSON.stringify(password ? { username, password } : { username }),
    }),
  resetSupplierPassword: (partyId: number, userId: number, password?: string) =>
    req(`/parties/${partyId}/users/${userId}/reset-password/`, {
      method: "POST", body: JSON.stringify(password ? { password } : {}),
    }),
  removeSupplierUser: (partyId: number, userId: number) =>
    req(`/parties/${partyId}/users/${userId}/`, { method: "DELETE" }),
  unlockSupplierUser: (partyId: number, userId: number) =>
    req(`/parties/${partyId}/users/${userId}/unlock/`, { method: "POST" }),
  changePassword: (newPassword: string) =>
    req("/change-password/", {
      method: "POST", body: JSON.stringify({ new_password: newPassword }),
    }),
  license: (): Promise<LicenseInfo> => req("/license/"),
  certificates: () => req("/certificates/"),
  emitCertificate: (payload: Record<string, unknown>): Promise<EmittedCertificate> =>
    req("/certificates/emit/", { method: "POST", body: JSON.stringify(payload) }),
  certificateXlsx: (id: number, folio: string) =>
    downloadFile(`/certificates/${id}/xlsx/`, `certificado_${folio}.xlsx`),
  rules: (params = "") => req(`/origin-rules/${params}`),
  createRule: (payload: Record<string, unknown>) =>
    req("/origin-rules/", { method: "POST", body: JSON.stringify(payload) }),
  updateRule: (id: number, payload: Record<string, unknown>) =>
    req(`/origin-rules/${id}/`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteRule: (id: number) =>
    req(`/origin-rules/${id}/`, { method: "DELETE" }),
  setRuleDisplay: (id: number, display_type: string, display_description: string) =>
    req(`/origin-rules/${id}/set-display/`, {
      method: "POST", body: JSON.stringify({ display_type, display_description }),
    }),
  resetRuleDisplay: (id: number) =>
    req(`/origin-rules/${id}/reset-display/`, { method: "POST" }),
  qualify: (productId: number, treatyId: number) =>
    req(`/products/${productId}/qualify/`, {
      method: "POST",
      body: JSON.stringify({ treaty: treatyId }),
    }),
  solicit: (productId: number, treatyId: number) =>
    req(`/products/${productId}/solicit/`, {
      method: "POST",
      body: JSON.stringify({ treaty: treatyId }),
    }),
  respond: (solicitationId: number, payload: Record<string, unknown>) =>
    req(`/solicitations/${solicitationId}/respond/`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  createSolicitudes: (payload: Record<string, unknown>) =>
    req("/solicitations/batch/", { method: "POST", body: JSON.stringify(payload) }),
  submitBom: (solicitationId: number, payload: Record<string, unknown>) =>
    req(`/solicitations/${solicitationId}/submit-bom/`, {
      method: "POST", body: JSON.stringify(payload),
    }),
  calculateOrigin: (solicitationId: number) =>
    req(`/solicitations/${solicitationId}/calculate-origin/`, { method: "POST" }),
  sendBom: (solicitationId: number, unchanged = false) =>
    req(`/solicitations/${solicitationId}/send-bom/`, {
      method: "POST", body: JSON.stringify({ unchanged }),
    }),
  copyPrevious: (solicitationId: number) =>
    req(`/solicitations/${solicitationId}/copy-previous/`, { method: "POST" }),
  acceptSolicitud: (id: number, sign_method: string) =>
    req(`/solicitations/${id}/accept/`, { method: "POST", body: JSON.stringify({ sign_method }) }),
  solicitationCert: (id: number): Promise<SolicitationCert> =>
    req(`/solicitation-certificates/${id}/`),
  clientLayouts: (clientId?: number) =>
    req(clientId ? `/client-layouts/?client=${clientId}` : "/client-layouts/"),
  uploadClientLayout: (fields: { client: number; treaty: number; file: File; name?: string }): Promise<ClientLayout> =>
    uploadForm("/client-layouts/", fields as unknown as Record<string, string | number | File>),
  updateClientLayout: (id: number, payload: Record<string, unknown>): Promise<ClientLayout> =>
    req(`/client-layouts/${id}/`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteClientLayout: (id: number) =>
    req(`/client-layouts/${id}/`, { method: "DELETE" }),
  generateClientLayout: (id: number, payload: Record<string, unknown>, filename: string) =>
    downloadPost(`/client-layouts/${id}/generate/`, payload, filename),
  signSolicitationCert: (id: number, payload: Record<string, unknown>): Promise<SolicitationCert> =>
    req(`/solicitation-certificates/${id}/sign/`, { method: "POST", body: JSON.stringify(payload) }),
  rejectSolicitud: (id: number, reason: string) =>
    req(`/solicitations/${id}/reject/`, { method: "POST", body: JSON.stringify({ reason }) }),
  supplierProfile: (): Promise<SupplierProfile> => req("/supplier-profile/"),
  updateSupplierProfile: (payload: Partial<SupplierProfile>) =>
    req("/supplier-profile/", { method: "PATCH", body: JSON.stringify(payload) }),
  companyProfile: (): Promise<CompanyProfile> => req("/company-profile/"),
  updateCompanyProfile: (payload: Partial<CompanyProfile>) =>
    req("/company-profile/", { method: "PATCH", body: JSON.stringify(payload) }),
  bulkTemplate: (type: string) => downloadFile(`/bulk/template/?type=${type}`, `plantilla_${type}.xlsx`),
  bulkImport: (type: string, file: File): Promise<BulkResult> => uploadFile(`/bulk/import/?type=${type}`, file),
  bulkPreview: (type: string, file: File): Promise<BulkPreview> => uploadFile(`/bulk/import/?type=${type}&dry=1`, file),
  solicitudBomTemplate: () => downloadFile(`/bulk/template/?type=bom_response`, "plantilla_respuesta_bom.xlsx"),
  importSolicitudBom: (id: number, file: File) => uploadFile(`/solicitations/${id}/import-bom/`, file),
  // Declaración EN LOTE por layout (varias solicitudes de un bloque a la vez).
  solicitudDeclarationTemplate: (ids: number[]) =>
    downloadPost(`/solicitations/declaration-template/`, { ids }, "plantilla_declaracion_origen.xlsx"),
  importSolicitudDeclarations: (ids: number[], file: File) =>
    uploadForm(`/solicitations/import-declarations/`, { file, ids: ids.join(",") }),

  // --- Master (LogiQ) ---
  masterTenants: () => req("/master/tenants/"),
  masterUsers: () => req("/master/users/"),
  masterCreateTenant: (payload: Record<string, unknown>) =>
    req("/master/tenants/", { method: "POST", body: JSON.stringify(payload) }),
  masterUpdateTenant: (id: number, payload: Record<string, unknown>) =>
    req(`/master/tenants/${id}/`, { method: "PATCH", body: JSON.stringify(payload) }),
  masterDeleteTenant: (id: number) =>
    req(`/master/tenants/${id}/`, { method: "DELETE" }),
  masterSetLicense: (id: number, payload: Record<string, unknown>) =>
    req(`/master/tenants/${id}/license/`, { method: "PATCH", body: JSON.stringify(payload) }),
  masterCreateUser: (payload: Record<string, unknown>) =>
    req("/master/users/", { method: "POST", body: JSON.stringify(payload) }),
  masterUnlockUser: (id: number) =>
    req(`/master/users/${id}/unlock/`, { method: "POST" }),
};

export type LicenseInfo = {
  plan?: string; plan_display?: string; status?: string; status_display?: string;
  valid_until?: string | null; days_left?: number | null;
  renewal_amount?: string; renewal_currency?: string; renewal_notes?: string;
  is_valid?: boolean;
};
export type MasterTenant = {
  id: number; name: string; rfc: string; slug: string; user_count: number;
  license: LicenseInfo | null;
};
