from django.contrib import admin

from apps.origin.models import Certificate, ExpedienteDocument, Qualification


@admin.register(Qualification)
class QualificationAdmin(admin.ModelAdmin):
    list_display = ("product", "treaty", "status", "criterion", "rvc_value",
                    "computed_at", "tenant")
    list_filter = ("status", "treaty", "tenant")
    search_fields = ("product__sku",)
    readonly_fields = ("detail", "computed_at")


@admin.register(Certificate)
class CertificateAdmin(admin.ModelAdmin):
    list_display = ("folio", "qualification", "certifier_type", "issued_at", "tenant")
    list_filter = ("certifier_type", "tenant")
    search_fields = ("folio",)


@admin.register(ExpedienteDocument)
class ExpedienteDocumentAdmin(admin.ModelAdmin):
    list_display = ("doc_type", "product", "certificate", "created_at", "tenant")
    list_filter = ("doc_type", "tenant")
