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

async function req(path: string, opts: RequestInit = {}) {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((opts.headers as Record<string, string>) || {}),
  };
  if (token) headers["Authorization"] = `Token ${token}`;
  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || data.detail || `HTTP ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

export type HsLog = {
  old_hs: string; new_hs: string; action: string;
  suggested_by: string; note: string; created_at: string;
};
export type Product = {
  id: number; sku: string; description: string; kind: string;
  kind_display?: string; hs_code: string; unit_cost: string;
  currency: string; country_of_origin: string; supplier: number | null;
  supplier_name?: string | null; supplier_code?: string | null;
  is_active: boolean;
  hs_suggested?: string; hs_suggestion_status?: string;
  hs_suggestion_note?: string; hs_suggested_by_name?: string | null;
  hs_logs?: HsLog[];
};
export type Treaty = { id: number; code: string; name: string };
export type SupplierUser = { id: number; username: string; must_change_password: boolean; is_locked: boolean };
export type Party = {
  id: number; kind: string; kind_display?: string; name: string;
  code: string; slug: string; tax_id: string; country: string;
  email: string; phone: string; access_users: SupplierUser[];
};
export type Qualification = {
  id: number; product: number; treaty: number; status: string;
  status_display: string; criterion: string; rvc_value: string | null;
};
export type Me = {
  username: string; role: string | null; role_display?: string;
  is_supplier?: boolean; must_change_password?: boolean;
  tenant: { id: number; name: string; slug: string } | null;
  supplier: { id: number; name: string; slug: string } | null;
};
export type BomLine = {
  id?: number; part_number: string; description: string; hs_code: string;
  unit_price: string; quantity: string; country: string;
  has_origin_evidence: boolean; total?: string;
};
export type SubmittedBom = {
  id: number; rule: number | null; rule_description?: string | null;
  rule_hs?: string | null; rule_type?: string | null; notes: string; lines: BomLine[];
  origin_status?: string; criterion?: string; rvc_value?: string | null;
  detail?: Record<string, unknown>; computed_at?: string | null;
};
export type OriginRule = {
  id: number; hs_pattern: string; rule_type: string; description: string;
  treaty: number; treaty_code?: string; treaty_label?: string;
};
export type SolLog = {
  action: string; action_label: string; detail: string;
  user: string | null; created_at: string;
};
export type Solicitation = {
  id: number; product: number; supplier: number; treaty: number;
  status: string; status_display: string; due_date: string | null;
  period_type: string; period_display?: string;
  period_from: string | null; period_to: string | null;
  bom_analysis: boolean; submitted_bom: SubmittedBom | null;
  product_sku?: string; product_description?: string; product_hs?: string;
  product_unit_cost?: string; treaty_code?: string; supplier_name?: string;
  treaty_members?: string[]; treaty_de_minimis?: string; logs?: SolLog[];
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
  treaties: () => req("/treaties/"),
  qualifications: () => req("/qualifications/"),
  solicitations: () => req("/solicitations/"),
  declarations: () => req("/supplier-declarations/"),
  parties: () => req("/parties/"),
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
  certificates: () => req("/certificates/"),
  rules: (params = "") => req(`/origin-rules/${params}`),
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

  // --- Master (LogiQ) ---
  masterTenants: () => req("/master/tenants/"),
  masterUsers: () => req("/master/users/"),
  masterCreateTenant: (payload: Record<string, unknown>) =>
    req("/master/tenants/", { method: "POST", body: JSON.stringify(payload) }),
  masterDeleteTenant: (id: number) =>
    req(`/master/tenants/${id}/`, { method: "DELETE" }),
  masterSetLicense: (id: number, payload: Record<string, unknown>) =>
    req(`/master/tenants/${id}/license/`, { method: "PATCH", body: JSON.stringify(payload) }),
  masterCreateUser: (payload: Record<string, unknown>) =>
    req("/master/users/", { method: "POST", body: JSON.stringify(payload) }),
  masterUnlockUser: (id: number) =>
    req(`/master/users/${id}/unlock/`, { method: "POST" }),
};

export type MasterTenant = {
  id: number; name: string; rfc: string; slug: string; user_count: number;
  license: { plan_display: string; status: string; status_display: string;
             valid_until: string | null } | null;
};
