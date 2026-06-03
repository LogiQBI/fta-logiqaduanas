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

export type Product = {
  id: number; sku: string; description: string; kind: string;
  kind_display?: string; hs_code: string; unit_cost: string;
  currency: string; country_of_origin: string; supplier: number | null;
};
export type Treaty = { id: number; code: string; name: string };
export type Qualification = {
  id: number; product: number; treaty: number; status: string;
  status_display: string; criterion: string; rvc_value: string | null;
};
export type Me = {
  username: string; role: string | null; role_display?: string;
  is_supplier?: boolean;
  tenant: { id: number; name: string; slug: string } | null;
  supplier: { id: number; name: string; slug: string } | null;
};
export type Solicitation = {
  id: number; product: number; supplier: number; treaty: number;
  status: string; status_display: string; due_date: string | null;
};

export const api = {
  async login(username: string, password: string) {
    const res = await fetch(`${BASE}/login/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) throw new Error("Usuario o contraseña incorrectos.");
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
  treaties: () => req("/treaties/"),
  qualifications: () => req("/qualifications/"),
  solicitations: () => req("/solicitations/"),
  declarations: () => req("/supplier-declarations/"),
  parties: () => req("/parties/"),
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
};

export type MasterTenant = {
  id: number; name: string; rfc: string; slug: string; user_count: number;
  license: { plan_display: string; status: string; status_display: string;
             valid_until: string | null } | null;
};
