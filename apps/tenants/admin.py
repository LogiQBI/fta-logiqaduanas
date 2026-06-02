from django.contrib import admin

from apps.tenants.models import Membership, Tenant


@admin.register(Tenant)
class TenantAdmin(admin.ModelAdmin):
    list_display = ("name", "rfc", "slug", "is_active", "created_at")
    search_fields = ("name", "rfc", "slug")
    prepopulated_fields = {"slug": ("name",)}


@admin.register(Membership)
class MembershipAdmin(admin.ModelAdmin):
    list_display = ("user", "tenant", "role", "party")
    list_filter = ("role", "tenant")
    search_fields = ("user__username", "party__name")
    autocomplete_fields = ("user", "party")
