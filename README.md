# FTA

**LogiQ Aduanas | FTA** — Sistema de gestión de origen preferencial (Rules of Origin / FTA Qualification).

Las empresas piden a sus proveedores información de origen de los materiales (BOM),
el sistema **califica** el producto contra los tratados de libre comercio (determina si
CALIFICA o NO con cada TLC) y permite **emitir certificados de origen** a los clientes,
guardando el **expediente** de soporte.

> Proyecto independiente. No relacionado con cuius.mx ni lufsync.

## Stack

- **Backend:** Django 5.2 + Django REST Framework
- **Base de datos:** PostgreSQL 16
- **Python:** 3.12
- **Multitenant:** aislamiento por empresa (Tenant)
- **Motor de origen:** data-driven — las reglas de cada TLC viven como datos
  (`treaties.OriginRule`), no programadas. Agregar un tratado = cargar datos.

## Estructura

```
apps/
  tenants/    Empresas (multitenant), membresías, modelos base
  catalog/    Productos, BOM multinivel, proveedores, declaraciones
  treaties/   Tratados (TLC) + reglas de origen data-driven
  origin/     Motor de calificación, certificados, expediente, API
config/       settings, urls
```

## Cómo correrlo en local

Requisitos ya instalados: Homebrew, Python 3.12, PostgreSQL 16 (servicio activo).

```bash
cd ~/Desarrollo\ FTA

# 1. Activar el entorno virtual
source venv/bin/activate

# 2. Aplicar migraciones (si hay nuevas)
python manage.py migrate

# 3. Cargar datos demo y ver una calificación de ejemplo
python manage.py seed_demo

# 4. Levantar el servidor
python manage.py runserver 127.0.0.1:8100
```

- **Admin:** http://127.0.0.1:8100/admin/  (usuario `admin`, contraseña `admin12345` en dev)
- **API:**   http://127.0.0.1:8100/api/

### Calificar un producto vía API

```
POST /api/products/<id>/qualify/   body: {"treaty": <id_tratado>}
```

Devuelve el estado (CALIFICA / NO CALIFICA), el criterio aplicado y el VCR calculado.

## Estado actual (MVP)

- [x] Multitenant + datos maestros + BOM multinivel
- [x] Catálogo de tratados con reglas data-driven
- [x] Motor: salto arancelario (CTC) + VCR + de minimis
- [x] API REST con aislamiento por tenant + panel admin
- [ ] Portal de proveedores (solicitud de declaraciones)
- [ ] Emisión de certificados (9 elementos T-MEC)
- [ ] Carga de los 14 TLC de México
- [ ] Frontend Next.js
