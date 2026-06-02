from django.contrib import admin

from apps.treaties.models import OriginRule, Treaty


class OriginRuleInline(admin.TabularInline):
    model = OriginRule
    extra = 1


@admin.register(Treaty)
class TreatyAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "rvc_transaction_threshold",
                    "rvc_net_cost_threshold", "de_minimis_pct", "in_force_from")
    search_fields = ("code", "name")
    inlines = [OriginRuleInline]


@admin.register(OriginRule)
class OriginRuleAdmin(admin.ModelAdmin):
    list_display = ("treaty", "hs_pattern", "rule_type", "valid_from", "valid_to")
    list_filter = ("treaty", "rule_type")
    search_fields = ("hs_pattern", "description")
