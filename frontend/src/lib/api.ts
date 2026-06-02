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
  hs_code: string; unit_cost: string; country_of_origin: string;
};
export type Treaty = { id: number; code: string; name: string };
export type Qualification = {
  id: number; product: number; treaty: number; status: string;
  status_display: string; criterion: string; rvc_value: string | null;
};
export type Me = {
  username: string; role: string | null; role_display?: string;
  is_supplier?: boolean;
  tenant: { id: number; name: string } | null;
  supplier: { id: number; name: string } | null;
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
  treaties: () => req("/treaties/"),
  qualifications: () => req("/qualifications/"),
  solicitations: () => req("/solicitations/"),
  declarations: () => req("/supplier-declarations/"),
  qualify: (productId: number, treatyId: number) =>
    req(`/products/${productId}/qualify/`, {
      method: "POST",
      body: JSON.stringify({ treaty: treatyId }),
    }),
  respond: (solicitationId: number, payload: Record<string, unknown>) =>
    req(`/solicitations/${solicitationId}/respond/`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};
