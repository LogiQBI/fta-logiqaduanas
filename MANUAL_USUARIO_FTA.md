# Manual de Usuario y Guía de Validación — LogiQ Aduanas | FTA

**Sistema de Gestión de Origen Preferencial (Reglas de Origen / TLC).**
Multi-empresa (SaaS). Permite a una empresa calificar el origen de sus productos
bajo los tratados de libre comercio de México, gestionar declaraciones de sus
proveedores y emitir certificados de origen a sus clientes.

- **URL producción:** https://fta-logiqaduanas-production.up.railway.app
- **Idioma:** español. Público objetivo: usuarios no técnicos de comercio exterior.

> Este documento sirve para dos cosas: (1) **manual de usuario** y (2) **guía de
> validación** para agentes de Cowork (QA). La sección 8 contiene los casos de
> prueba con pasos y resultados esperados.

---

## 1. ¿Qué hace el sistema? (visión general)

Un producto "califica" como originario de un país cuando cumple la **regla de
origen** del tratado (TLC) correspondiente. El sistema:

1. Guarda el **catálogo** de la empresa (proveedores, clientes, productos/insumos).
2. Arma la **lista de materiales (BOM)** de cada producto.
3. **Calcula el origen** del producto por tratado, aplicando la regla (salto
   arancelario y/o valor de contenido regional).
4. Gestiona el **flujo con proveedores**: la empresa les solicita declaraciones de
   origen; el proveedor responde; la empresa acepta o rechaza.
5. **Emite certificados de origen** (PDF) a los clientes, con folio y registro.

---

## 2. Arquitectura técnica

| Capa | Tecnología |
|---|---|
| Backend | Django 5.2 + Django REST Framework (DRF), autenticación por **Token** |
| Base de datos | PostgreSQL |
| Frontend | Next.js 16 (una sola página, export estático) + Tailwind CSS |
| Despliegue | Railway (un solo servicio, Docker multi-etapa) |
| Archivos estáticos | WhiteNoise; el backend Django sirve el frontend exportado |

**Apps de Django:**
- `tenants` — empresas (Tenant), usuarios, membresías, licencias, seguridad (bloqueo por intentos).
- `catalog` — proveedores/clientes (Party), productos (Product), BOM (BOMComponent), declaraciones de proveedor (SupplierDeclaration), solicitudes (SolicitationRequest + BOM/Líneas), perfiles (SupplierProfile, CompanyProfile).
- `treaties` — tratados (Treaty) y reglas de origen (OriginRule).
- `origin` — motor de cálculo (`engine.py`), servicios (`services.py`), serializers, vistas/API, calificaciones (Qualification) y certificados (Certificate).

**Arranque en cada despliegue** (`bootstrap_prod`): crea el superusuario, siembra
datos demo (si `SEED_DEMO=1`), carga tratados (`seed_treaties`), reglas T-MEC CSV
(`import_rules`) y las PSR por fracción de todos los tratados (`load_psr`).

### Multi-empresa y roles
- Cada empresa es un **Tenant**; todos los datos se aíslan por tenant.
- Un **proveedor** solo ve los datos de su propia ficha (Party).
- Una empresa puede tener varios proveedores; un proveedor puede tener varias
  empresas (cada empresa le da acceso por separado).

### Seguridad de acceso
- Token por usuario. El **proveedor** entra con: **empresa (slug) + proveedor
  (slug) + usuario + contraseña** (porque distintas empresas pueden usar al mismo
  proveedor sin chocar).
- **Bloqueo a los 5 intentos fallidos.** Desbloqueo: a un proveedor lo desbloquea
  su empresa; a una empresa, el Admin LogiQ; a un Admin, otro Admin.

### Motor de origen (`apps/origin/engine.py`)
- `find_rule`: elige la regla MÁS específica para la fracción (por **rango**
  `hs_from–hs_to` o por **prefijo**; si no hay específica, usa la **regla general**
  del tratado).
- Criterios: **WO** (totalmente obtenido), **CTC** (salto arancelario: CC capítulo /
  CTH partida / CTSH subpartida, con excepciones "excepto de…"), **RVC** (valor de
  contenido regional: valor de transacción o costo neto), **CTC_OR_RVC**,
  **CTC_AND_RVC**.
- **De minimis** (tolerancia de no originarios) y **aviso de régimen automotriz**
  (LVC, acero/aluminio) cuando aplica.
- Catálogo: ~13,460 reglas de los 14 tratados de México (T-MEC con PSR curadas +
  PSR por fracción de los anexos oficiales de los demás).

---

## 3. Roles y accesos demo (producción)

| Rol | Cómo entra | Usuario / Contraseña |
|---|---|---|
| **Admin LogiQ** (master) | Pantalla de login → "Acceso de administrador" | `admin` / `admin12345` |
| **Empresa** | Login normal | `empresa1` / `demo12345` |
| **Proveedor** | Pestaña "Proveedor": Empresa=`demo`, Proveedor=`componentes-mx`, Usuario=`proveedor_mx` / `demo12345` (o `imports-china` / `proveedor_cn`) |

> Datos demo sembrados por `seed_demo` + `seed_users`. La empresa demo se llama
> "Demo Manufacturing SA de CV" (slug `demo`).

---

## 4. Módulos del ADMIN LogiQ (master)

| Módulo | Qué hace |
|---|---|
| **Empresas** | Alta/baja de empresas (tenants) y su **licencia** (plan, vigencia). Si la licencia no es válida, la empresa no puede entrar. |
| **Usuarios** | Gestión de usuarios master. Desbloqueo de usuarios. |
| **Reglas de origen** | Catálogo global de PSR. **Solo el Admin** puede crear/editar/borrar reglas. |
| **Tratados** | Catálogo de TLC (referencia). |

---

## 5. Módulos de la EMPRESA

### Mi empresa
- **Datos de la empresa** — razón social, RFC, domicilio, **país (3 letras, ISO-3)**,
  contacto y **firma (PNG)**. Llenan los certificados que la empresa emite.

### Catálogos
- **Proveedores** — padrón de proveedores (código, país, RFC, contacto). Botón
  **"Crear acceso"** (usuarios del proveedor, con contraseña temporal). **Carga masiva** (Excel).
- **Clientes** — padrón de clientes/importadores a quienes se emiten certificados. **Carga masiva**.
- **Números de parte** — productos e insumos (SKU, descripción, tipo
  material/subensamble/terminado, fracción HS, costo, proveedor). Botón **"BOM"**
  (lista de materiales con país de origen por insumo). **Carga masiva** de productos y de BOM.

### Origen
- **Productos** — productos terminados; botones **Calificar**, **Solicitar origen**,
  **BOM**, editar.
- **Cálculo de origen** — elige producto + tratado; por cada insumo del BOM, un
  **toggle**: tomar el origen de la **declaración del proveedor** (más reciente o de
  un periodo) o **manual** (país). Botón **"Calcular origen"** → reporte (criterio,
  VCR, salto arancelario, aviso automotriz).
- **Calificaciones** — resultados guardados por producto × tratado.
- **Emitir certificados** — elige producto (que **califique**) + tratado + cliente →
  **"Emitir y registrar"** (genera **folio**, lo guarda) o **"Vista previa"**. Tabla
  **"Certificados emitidos"** con **Reimprimir**.
- **Solicitudes** — crea solicitudes de declaración a proveedores (por periodo:
  mes/semestre/año/personalizado; manual o por BOM). Cuando el proveedor responde,
  la empresa **Acepta** o **Rechaza** (con motivo).
- **Declaraciones aceptadas** — declaraciones aceptadas; genera certificado.

### Referencia
- **Tratados** y **Reglas de origen** (consulta; la empresa puede personalizar solo
  **cómo se muestran** las reglas, sin cambiar el cálculo).

---

## 6. Módulos del PROVEEDOR

| Módulo | Qué hace |
|---|---|
| **Datos de la empresa** | Datos de contacto + **firma (PNG)**, país ISO-3, para los certificados. |
| **Productos** | Ve los insumos que le asignó la empresa. Puede fijar el **país de origen** y **sugerir** corrección de la fracción HS (la empresa acepta/rechaza). |
| **Solicitudes de cliente** | Responde las solicitudes. Si es por **BOM**: captura componentes (manual o **"Responder por Excel"**/layout), **calcula el origen** y **envía**. Si es declaración simple: Originario/No + valores. |
| **Declaraciones aceptadas** | Declaraciones aceptadas por sus clientes; genera/imprime certificado. |
| **Mis declaraciones** | Histórico de sus declaraciones. |

---

## 7. Flujos principales (paso a paso)

**A. Alta de catálogo (Empresa):** Proveedores → Clientes → Números de parte
(manual o carga masiva Excel) → BOM de cada producto.

**B. Cálculo de origen propio (Empresa):** Cálculo de origen → producto + tratado →
ajustar origen por insumo (declaración o manual) → **Calcular** → resultado.

**C. Solicitud y declaración (Empresa ↔ Proveedor):**
1. Empresa: Solicitudes → nueva solicitud (producto, proveedor, tratado, periodo, ¿BOM?).
2. Proveedor: Solicitudes de cliente → responde (manual o BOM/layout) → calcula → **Enviar**.
3. Empresa: **Aceptar** o **Rechazar** (con motivo). Aceptada → "Declaraciones aceptadas".

**D. Emisión de certificado (Empresa):** Datos de la empresa (con firma) → calcular
origen del producto (debe **calificar**) → Emitir certificados → producto + tratado +
cliente → **Emitir y registrar** (folio) → Imprimir/Guardar PDF.

---

## 8. Guía de validación para agentes de Cowork (QA)

**Objetivo:** confirmar que cada módulo funciona en producción.
**Entorno:** https://fta-logiqaduanas-production.up.railway.app (producción).
**Herramientas sugeridas:** navegador (Claude in Chrome) para la UI; llamadas a la
API REST (base `…/api/`) para validación rápida. Token: `POST /api/login/`.

> **Cuidado (regla de negocio):** durante las pruebas en la UI, **no borrar el token
> `fta_token` de localStorage** mientras un usuario está logueado (lo desloguea).

### 8.1 Smoke test de API (rápido)
```
# 1) Login admin -> debe devolver {"token": "..."}
POST /api/login/   {"username":"admin","password":"admin12345"}
# 2) Login empresa
POST /api/login/   {"username":"empresa1","password":"demo12345"}
# 3) Login proveedor
POST /api/login/   {"tenant_slug":"demo","supplier_slug":"componentes-mx","username":"proveedor_mx","password":"demo12345"}
# 4) Identidad (con header  Authorization: Token <token>)
GET  /api/me/      -> role: master | admin | supplier
```
**Esperado:** los 3 logins devuelven token; `/api/me/` devuelve el rol correcto.

### 8.2 Casos de prueba por módulo (UI)

| # | Caso | Pasos | Resultado esperado |
|---|---|---|---|
| 1 | Login por rol | Entrar como admin, empresa y proveedor | Cada uno ve SU menú (admin: Empresas/Reglas; empresa: Catálogos/Origen; proveedor: Solicitudes de cliente) |
| 2 | Aislamiento | Como `proveedor_mx`, revisar Productos | Solo ve insumos de "Componentes MX", no de otros proveedores |
| 3 | Bloqueo por intentos | 5 logins con contraseña incorrecta | A partir del 3º avisa intentos restantes; al 5º **bloquea** |
| 4 | Proveedores | Crear proveedor + "Crear acceso" | Se crea con contraseña temporal mostrada una vez |
| 5 | Clientes | Crear un cliente | Aparece en el padrón (kind customer) |
| 6 | Productos/insumos | Crear un producto terminado y un insumo con proveedor | Aparecen en "Números de parte" |
| 7 | BOM | En un producto, botón "BOM" → agregar insumos + cantidad + país | Se guardan las líneas; el país (manual o "traer de declaración") queda registrado |
| 8 | Carga masiva | Números de parte → "Carga masiva" → descargar plantilla, llenarla, subirla | Resumen "creados/actualizados" + errores por fila |
| 9 | Cálculo de origen | Cálculo de origen → producto con BOM + tratado → toggle por insumo → "Calcular origen" | Muestra Originario SÍ/NO, criterio (CTC/RVC), VCR%, y la fuente de cada insumo |
| 10 | Reglas por tratado | Reglas de origen → elegir CPTPP, Alianza del Pacífico, Israel | Muestran cientos/miles de reglas (no "0 reglas") |
| 11 | Solicitud a proveedor | Empresa: Solicitudes → nueva (con BOM) | El proveedor la ve en "Solicitudes de cliente" |
| 12 | Responder (proveedor) | Proveedor: capturar BOM (o "Responder por Excel") → Calcular → Enviar | Estado pasa a "Respondida"; empresa la ve |
| 13 | Aceptar/Rechazar | Empresa: Rechazar con motivo → proveedor corrige → Aceptar | Rechazo muestra motivo al proveedor; aceptada va a "Declaraciones aceptadas" |
| 14 | Datos de empresa | Empresa y proveedor: llenar datos + subir firma PNG; país 3 letras | Se guarda; el país solo admite 3 letras |
| 15 | Emitir certificado | Calcular origen (que CALIFIQUE) → Emitir certificados → producto+tratado+cliente → "Emitir y registrar" | Genera **folio**, abre PDF, aparece en "Certificados emitidos" |
| 16 | Reimprimir | En "Certificados emitidos", botón "Reimprimir" | Reabre el mismo certificado desde el folio guardado |

### 8.3 Resultado esperado del cálculo (referencia)
Con el producto demo `FG-AUTO-01` (HS 870321) y su BOM (un insumo de México y uno
de China):
- **T-MEC / CPTPP / Alianza del Pacífico:** "Originario: SÍ" (criterio RVC, ~70%) si
  el insumo de China se marca manual como país miembro o se usa la regla aplicable.
- Cambiar el país del insumo a uno **no miembro** debe dar "Originario: NO".

### 8.4 Endpoints clave (referencia API)
```
POST /api/login/                         Token (empresa/admin/proveedor)
GET  /api/me/                            Identidad/rol
GET  /api/products/                      Productos (acotado por rol)
GET  /api/parties/?kind=supplier|customer  Proveedores / clientes
GET/POST/PATCH/DELETE /api/bom-components/?parent=<id>   BOM
GET  /api/products/<id>/bom-origin/?treaty=<id>   BOM + declaraciones por insumo
POST /api/products/<id>/calc-bom-origin/  {treaty}  Calcular origen del producto
GET  /api/treaties/                      Tratados
GET  /api/origin-rules/?treaty=<id>      Reglas (count > 0 en todos los tratados)
GET/PATCH /api/supplier-profile/         Datos del proveedor
GET/PATCH /api/company-profile/          Datos de la empresa
GET  /api/bulk/template/?type=products|suppliers|customers|bom   Plantilla .xlsx
POST /api/bulk/import/?type=...          Carga masiva (multipart 'file')
GET  /api/solicitations/                 Solicitudes
POST /api/solicitations/<id>/submit-bom|calculate-origin|send-bom|accept|reject|import-bom/
GET  /api/certificates/                  Certificados emitidos
POST /api/certificates/emit/             Emitir+registrar {product,treaty,client}
```

### 8.5 Checklist de aprobación
- [ ] Los 3 roles entran y ven su menú correcto.
- [ ] Aislamiento por proveedor y por empresa (no ven datos ajenos).
- [ ] Catálogos (proveedores/clientes/productos) y BOM funcionan, manual y por Excel.
- [ ] El cálculo de origen da resultado coherente en varios tratados.
- [ ] Todos los tratados muestran reglas (ninguno en "0 reglas").
- [ ] Flujo solicitud → responder → aceptar/rechazar completo.
- [ ] Datos de empresa (país 3 letras) + firma PNG.
- [ ] Emisión de certificado con folio + registro + reimprimir.

---

## 9. Notas y pendientes conocidos (no bloquean)

- **Panamá, Japón, ACE55:** su anexo de reglas por fracción no estaba público en las
  fuentes consultadas; quedan con su **regla general** oficial citada.
- **TLCUEM / AELC** (estilo UE): cargadas las reglas mapeables (cambio de partida y
  topes de valor → VCR); los procesos específicos no convertibles se omitieron.
- Las reglas son extracción **verbatim** de fuentes oficiales; conviene **validación
  final por un especialista** contra el anexo vigente antes de uso formal ante la autoridad.
- El BOM multinivel profundo (subensamble con su propio BOM) se resuelve hoy por
  declaración/país; el cálculo recursivo completo es una mejora futura.
- Cálculo automotriz completo (LVC + acero/aluminio + core parts): hoy se **avisa**,
  no se calcula.

---
*Documento generado por LogiQ Aduanas | FTA. Actualízalo cuando cambien los módulos.*
