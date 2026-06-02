"""Catálogo de tratados (TLC) y reglas de origen DATA-DRIVEN.

Las reglas de origen NO están programadas por tratado: viven aquí como datos.
El motor (apps.origin.engine) las interpreta de forma genérica, así que agregar
un tratado nuevo = cargar datos, no reprogramar.
"""
from django.db import models

from apps.tenants.models import TimeStampedModel


class Treaty(TimeStampedModel):
    """Tratado de libre comercio. Catálogo GLOBAL, compartido por todos los tenants."""

    code = models.CharField("Código", max_length=20, unique=True,
                            help_text="Ej: TMEC, TLCUEM, CPTPP")
    name = models.CharField("Nombre", max_length=255)
    member_countries = models.JSONField("Países miembro (ISO-2)", default=list,
                                         help_text='Ej: ["MX", "US", "CA"]')
    rvc_transaction_threshold = models.DecimalField(
        "Umbral VCR — valor de transacción (%)", max_digits=5, decimal_places=2, default=60)
    rvc_net_cost_threshold = models.DecimalField(
        "Umbral VCR — costo neto (%)", max_digits=5, decimal_places=2, default=50)
    de_minimis_pct = models.DecimalField(
        "De minimis (%)", max_digits=5, decimal_places=2, default=10)
    in_force_from = models.DateField("En vigor desde", null=True, blank=True)

    class Meta:
        verbose_name = "Tratado (TLC)"
        verbose_name_plural = "Tratados (TLC)"

    def __str__(self):
        return f"{self.code} — {self.name}"


class OriginRule(TimeStampedModel):
    """Regla de origen específica por producto (REE / PSRO), data-driven.

    `hs_pattern` es el prefijo HS al que aplica (el motor elige el patrón más
    específico que coincida). `params` lleva los parámetros que el motor interpreta.
    """

    class RuleType(models.TextChoices):
        WHOLLY_OBTAINED = "WO", "Totalmente obtenido"
        TARIFF_SHIFT = "CTC", "Salto arancelario"
        RVC = "RVC", "Valor de contenido regional"
        TARIFF_SHIFT_OR_RVC = "CTC_OR_RVC", "Salto arancelario O VCR"
        TARIFF_SHIFT_AND_RVC = "CTC_AND_RVC", "Salto arancelario Y VCR"

    treaty = models.ForeignKey(Treaty, on_delete=models.CASCADE, related_name="rules")
    hs_pattern = models.CharField(
        "Patrón HS", max_length=10,
        help_text="Prefijo HS al que aplica. Ej: '87', '8703', '870321'")
    rule_type = models.CharField(max_length=20, choices=RuleType.choices)
    params = models.JSONField(
        "Parámetros del motor", default=dict, blank=True,
        help_text='Ej: {"shift_level": "CTH", "rvc_method": "transaction", '
                  '"rvc_threshold": 60, "de_minimis": 10}')
    description = models.TextField("Texto de la regla", blank=True)
    valid_from = models.DateField("Vigente desde", null=True, blank=True)
    valid_to = models.DateField("Vigente hasta", null=True, blank=True)

    class Meta:
        verbose_name = "Regla de origen"
        verbose_name_plural = "Reglas de origen"

    def __str__(self):
        return f"{self.treaty.code} / {self.hs_pattern} [{self.get_rule_type_display()}]"
