"""
Django settings for FTA — LogiQ Aduanas.
Sistema de gestión de origen preferencial (Rules of Origin / FTA Qualification).
"""

from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent

# --- Variables de entorno (.env) ---
env = environ.Env(
    DEBUG=(bool, False),
)
environ.Env.read_env(BASE_DIR / ".env")

SECRET_KEY = env(
    "SECRET_KEY",
    default="django-insecure-dev-only-change-me-in-production",
)
DEBUG = env("DEBUG")
ALLOWED_HOSTS = env.list("ALLOWED_HOSTS", default=["localhost", "127.0.0.1"])
CSRF_TRUSTED_ORIGINS = env.list("CSRF_TRUSTED_ORIGINS", default=[])

# Railway expone el dominio público del servicio en esta variable.
# Lo agregamos automáticamente para no tener que hardcodearlo.
RAILWAY_PUBLIC_DOMAIN = env("RAILWAY_PUBLIC_DOMAIN", default="")
if RAILWAY_PUBLIC_DOMAIN:
    ALLOWED_HOSTS.append(RAILWAY_PUBLIC_DOMAIN)
    CSRF_TRUSTED_ORIGINS.append(f"https://{RAILWAY_PUBLIC_DOMAIN}")

# Railway/Proxy: confiar en el encabezado de HTTPS del proxy.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")


# --- Aplicaciones ---
DJANGO_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
]

THIRD_PARTY_APPS = [
    "rest_framework",
    "rest_framework.authtoken",
    "corsheaders",
]

LOCAL_APPS = [
    "apps.tenants",
    "apps.catalog",
    "apps.treaties",
    "apps.origin",
]

INSTALLED_APPS = DJANGO_APPS + THIRD_PARTY_APPS + LOCAL_APPS

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "config.security.SecurityHeadersMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"


# --- Base de datos (PostgreSQL) ---
DATABASES = {
    "default": env.db(
        "DATABASE_URL",
        default="postgres://localhost:5432/fta_dev",
    ),
}


# --- Validación de contraseñas ---
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]


# --- Internacionalización (México) ---
LANGUAGE_CODE = "es-mx"
TIME_ZONE = "America/Mexico_City"
USE_I18N = True
USE_TZ = True


# --- Archivos estáticos y media (expedientes) ---
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# WhiteNoise: sirve los estáticos del admin/DRF en producción (comprimidos).
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}

# --- Frontend (Next.js exportado) servido por el MISMO servicio ---
# El Dockerfile construye el frontend y deja su salida estática aquí.
# Si existe, WhiteNoise la sirve en la raíz del sitio ("/", "/_next/...", logos)
# y un catch-all en urls.py devuelve index.html para el resto (SPA).
FRONTEND_BUILD_DIR = BASE_DIR / "frontend_build"


def _whitenoise_headers(headers, path, url):
    """El HTML (index.html) NO se cachea: cada deploy se ve de inmediato sin
    recargar a mano. Los chunks /_next con hash sí se cachean (inmutables)."""
    if path.endswith(".html"):
        headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        headers["Pragma"] = "no-cache"
        headers["Expires"] = "0"


if FRONTEND_BUILD_DIR.exists():
    WHITENOISE_ROOT = str(FRONTEND_BUILD_DIR)
    WHITENOISE_INDEX_FILE = True
    WHITENOISE_ADD_HEADERS_FUNCTION = _whitenoise_headers


# --- Django REST Framework ---
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.TokenAuthentication",
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 50,
}

# --- CORS (frontend moderno: Next.js) ---
# Orígenes exactos (ej. el frontend en local o su dominio de producción).
CORS_ALLOWED_ORIGINS = env.list(
    "CORS_ALLOWED_ORIGINS",
    default=["http://localhost:3000"],
)
# Comodines por regex (django-cors-headers NO acepta '*' en la lista anterior).
CORS_ALLOWED_ORIGIN_REGEXES = [
    r"^https://.*\.up\.railway\.app$",
    r"^https://.*\.logiqaduanas\.com$",
]
# Header custom para "Abrir empresa" (el master ve una empresa como admin).
# En producción es same-origin (no hay preflight); en dev sí lo necesita.
from corsheaders.defaults import default_headers as _cors_default_headers  # noqa: E402
CORS_ALLOW_HEADERS = list(_cors_default_headers) + ["x-as-tenant"]


# --- Endurecimiento de seguridad ---
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"
SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"
if not DEBUG:
    SECURE_SSL_REDIRECT = True
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = 31536000  # 1 año
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True
