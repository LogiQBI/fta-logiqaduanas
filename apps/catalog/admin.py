from django.contrib import admin

from apps.catalog.models import BOMComponent, Party, Product, SupplierDeclaration


class BOMComponentInline(admin.TabularInline):
    model = BOMComponent
    fk_name = "parent"
    extra = 1
    autocomplete_fields = ("component",)


@admin.register(Party)
class PartyAdmin(admin.ModelAdmin):
    list_display = ("name", "kind", "country", "tax_id", "tenant")
    list_filter = ("kind", "tenant", "country")
    search_fields = ("name", "tax_id")


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    list_display = ("sku", "description", "kind", "hs_code", "unit_cost",
                    "currency", "country_of_origin", "tenant")
    list_filter = ("kind", "tenant", "country_of_origin")
    search_fields = ("sku", "description", "hs_code")
    inlines = [BOMComponentInline]


@admin.register(SupplierDeclaration)
class SupplierDeclarationAdmin(admin.ModelAdmin):
    list_display = ("product", "supplier", "treaty", "is_originating",
                    "country_of_origin", "valid_from", "valid_to")
    list_filter = ("treaty", "is_originating", "tenant")
    search_fields = ("product__sku", "supplier__name")
