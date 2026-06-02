"""Portal público de proveedores (acceso por token, sin cuenta)."""
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from apps.catalog.models import SolicitationRequest, SupplierDeclaration


@api_view(["GET", "POST"])
@permission_classes([AllowAny])
def supplier_portal(request, token):
    """GET: muestra qué se le pide al proveedor.
    POST: el proveedor entrega su declaración de origen."""
    try:
        sr = SolicitationRequest.objects.select_related(
            "product", "supplier", "treaty", "tenant"
        ).get(token=token)
    except SolicitationRequest.DoesNotExist:
        return Response({"error": "Solicitud no encontrada."}, status=status.HTTP_404_NOT_FOUND)

    if request.method == "GET":
        return Response({
            "empresa_solicitante": sr.tenant.name,
            "proveedor": sr.supplier.name,
            "material": {"sku": sr.product.sku, "descripcion": sr.product.description,
                         "hs_code": sr.product.hs_code},
            "tratado": sr.treaty.code,
            "estado": sr.get_status_display(),
            "fecha_limite": sr.due_date,
            "ya_respondida": sr.status == SolicitationRequest.Status.RESPONDED,
        })

    # POST: registrar la declaración
    if sr.status == SolicitationRequest.Status.RESPONDED:
        return Response({"error": "Esta solicitud ya fue respondida."},
                        status=status.HTTP_400_BAD_REQUEST)
    data = request.data
    valid_from = data.get("valid_from")
    valid_to = data.get("valid_to")
    if not valid_from or not valid_to:
        return Response({"error": "Faltan 'valid_from' y 'valid_to' (vigencia)."},
                        status=status.HTTP_400_BAD_REQUEST)

    decl = SupplierDeclaration.objects.create(
        tenant=sr.tenant, supplier=sr.supplier, product=sr.product, treaty=sr.treaty,
        is_originating=bool(data.get("is_originating")),
        country_of_origin=data.get("country_of_origin", ""),
        valid_from=valid_from, valid_to=valid_to,
    )
    sr.declaration = decl
    sr.status = SolicitationRequest.Status.RESPONDED
    sr.responded_at = timezone.now()
    sr.save(update_fields=["declaration", "status", "responded_at", "updated_at"])
    return Response({"ok": True, "mensaje": "Declaración registrada. Gracias.",
                     "declaracion_id": decl.id})
