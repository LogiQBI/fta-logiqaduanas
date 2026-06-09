"""Headers de seguridad adicionales (CSP y Permissions-Policy) que Django no trae
de fábrica. Se aplican a TODA respuesta. La CSP es deliberadamente compatible con
la SPA (Next.js export) y con las firmas en data: URL."""

CSP = "; ".join([
    "default-src 'self'",
    # La SPA exportada usa scripts propios + algo de inline/eval del runtime.
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    # Firmas y logos van como data: URL (PNG base64); blob: por si acaso.
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    # La API vive en el mismo origen (/api/).
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
])

PERMISSIONS_POLICY = "geolocation=(), microphone=(), camera=(), payment=(), usb=()"


class SecurityHeadersMiddleware:
    """Agrega Content-Security-Policy y Permissions-Policy a cada respuesta."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        response.setdefault("Content-Security-Policy", CSP)
        response.setdefault("Permissions-Policy", PERMISSIONS_POLICY)
        response.setdefault("X-Content-Type-Options", "nosniff")
        return response
