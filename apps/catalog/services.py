"""Servicios del catálogo: generación de solicitudes de origen a proveedores."""
from apps.catalog.models import SolicitationRequest


def generate_solicitations(finished_product, treaty, due_date=None):
    """Recorre el BOM del producto y crea una solicitud PENDIENTE por cada
    componente que tenga proveedor y aún no tenga declaración ni solicitud abierta
    para ese tratado. Devuelve la lista de solicitudes creadas."""
    created = []
    components = finished_product.bom_components.select_related("component", "component__supplier")
    for bom in components:
        comp = bom.component
        if not comp.supplier:
            continue
        if comp.declarations.filter(treaty=treaty).exists():
            continue
        if SolicitationRequest.objects.filter(
            product=comp, treaty=treaty,
            status__in=[SolicitationRequest.Status.PENDING, SolicitationRequest.Status.SENT],
        ).exists():
            continue
        created.append(SolicitationRequest.objects.create(
            tenant=finished_product.tenant,
            supplier=comp.supplier,
            product=comp,
            treaty=treaty,
            due_date=due_date,
        ))
    return created
