from rest_framework import serializers

from apps.catalog.models import (
    BOMComponent, CompanyProfile, Party, Product, SolicitationBOM,
    SolicitationBOMLine, SolicitationRequest, SupplierDeclaration, SupplierProfile,
)
from apps.origin.models import (
    AutomotiveAssessment, Certificate, ClientOriginLayout, OriginAnalysis,
    Qualification, SolicitationCertificate,
)
from apps.treaties.models import OriginRule, Treaty


class TreatySerializer(serializers.ModelSerializer):
    class Meta:
        model = Treaty
        fields = "__all__"


# Etiquetas de tratado en inglés para mostrar (interno se mantiene el code).
TREATY_LABELS = {"TMEC": "USMCA"}


class OriginRuleSerializer(serializers.ModelSerializer):
    treaty_code = serializers.CharField(source="treaty.code", read_only=True)
    treaty_label = serializers.SerializerMethodField()
    display_type = serializers.SerializerMethodField()
    display_description = serializers.SerializerMethodField()
    has_override = serializers.SerializerMethodField()

    class Meta:
        model = OriginRule
        fields = "__all__"

    def get_treaty_label(self, obj):
        return TREATY_LABELS.get(obj.treaty.code, obj.treaty.code)

    def _override(self, obj):
        return (self.context.get("rule_overrides") or {}).get(obj.id)

    def get_display_type(self, obj):
        o = self._override(obj)
        return o.display_type if (o and o.display_type) else obj.rule_type

    def get_display_description(self, obj):
        o = self._override(obj)
        return o.display_description if (o and o.display_description) else obj.description

    def get_has_override(self, obj):
        return bool(self._override(obj))


class PartySerializer(serializers.ModelSerializer):
    kind_display = serializers.CharField(source="get_kind_display", read_only=True)
    # Usuarios de acceso (proveedor) ligados a esta Party.
    access_users = serializers.SerializerMethodField()

    class Meta:
        model = Party
        fields = "__all__"
        read_only_fields = ["tenant", "slug"]
        # Por defecto se da de alta un proveedor (lo fija la vista).
        extra_kwargs = {"kind": {"required": False}}

    def get_access_users(self, obj):
        from apps.tenants.models import UserSecurity
        locked_ids = set(UserSecurity.objects.filter(
            user__memberships__party=obj, is_locked=True).values_list("user_id", flat=True))
        return [
            {"id": m.user_id, "username": m.login_name or m.user.username,
             "must_change_password": m.must_change_password,
             "is_locked": m.user_id in locked_ids}
            for m in obj.memberships.select_related("user").all()
        ]


class ProductSerializer(serializers.ModelSerializer):
    kind_display = serializers.CharField(source="get_kind_display", read_only=True)
    supplier_name = serializers.CharField(source="supplier.name", read_only=True, default=None)
    supplier_code = serializers.CharField(source="supplier.code", read_only=True, default=None)
    hs_suggested_by_name = serializers.CharField(source="hs_suggested_by.name", read_only=True, default=None)
    hs_logs = serializers.SerializerMethodField()
    change_log_count = serializers.SerializerMethodField()
    is_automotive_core = serializers.SerializerMethodField()

    def get_is_automotive_core(self, obj):
        from apps.origin.engine import core_part_code
        return bool(core_part_code(obj.hs_code or ""))

    def get_hs_logs(self, obj):
        return [{"old_hs": l.old_hs, "new_hs": l.new_hs, "action": l.action,
                 "suggested_by": l.suggested_by, "note": l.note,
                 "created_at": l.created_at} for l in obj.hs_logs.all()[:10]]

    def get_change_log_count(self, obj):
        # Anotado por ProductViewSet.get_queryset; fallback para otros usos.
        n = getattr(obj, "_change_log_count", None)
        return n if n is not None else obj.change_logs.count()

    def validate_sku(self, value):
        # Los números de parte se guardan en MAYÚSCULAS (consistencia con la carga
        # masiva y para que se vean bien).
        return (value or "").strip().upper()

    class Meta:
        model = Product
        fields = "__all__"
        # El tenant y la sugerencia los gestiona el servidor (acciones dedicadas).
        read_only_fields = ["tenant", "hs_suggested", "hs_suggestion_status",
                            "hs_suggestion_note", "hs_suggested_by"]


class BOMComponentSerializer(serializers.ModelSerializer):
    component_sku = serializers.CharField(source="component.sku", read_only=True)
    component_description = serializers.CharField(source="component.description", read_only=True)
    component_hs = serializers.CharField(source="component.hs_code", read_only=True)
    component_unit_cost = serializers.DecimalField(
        source="component.unit_cost", max_digits=14, decimal_places=4, read_only=True)
    component_supplier_name = serializers.CharField(
        source="component.supplier.name", read_only=True, default=None)
    # Declaraciones que el proveedor entregó para este insumo (todos los tratados),
    # para poder "traer" su país de origen al armar el BOM.
    component_declarations = serializers.SerializerMethodField()

    class Meta:
        model = BOMComponent
        fields = ["id", "parent", "component", "quantity", "uom", "origin_mode",
                  "origin_as_of", "manual_is_originating", "manual_country",
                  "component_sku", "component_description", "component_hs",
                  "component_unit_cost", "component_supplier_name",
                  "component_declarations"]
        read_only_fields = ["tenant"]

    def get_component_declarations(self, obj):
        from apps.catalog.models import SupplierDeclaration
        qs = (SupplierDeclaration.objects.filter(product_id=obj.component_id)
              .select_related("treaty").order_by("-valid_from")[:20])
        return [{"treaty_code": d.treaty.code, "valid_from": d.valid_from,
                 "valid_to": d.valid_to, "is_originating": d.is_originating,
                 "country": d.country_of_origin} for d in qs]


class SupplierDeclarationSerializer(serializers.ModelSerializer):
    class Meta:
        model = SupplierDeclaration
        fields = "__all__"


class SupplierProfileSerializer(serializers.ModelSerializer):
    party_name = serializers.CharField(source="party.name", read_only=True)
    party_code = serializers.CharField(source="party.code", read_only=True)

    class Meta:
        model = SupplierProfile
        fields = ["id", "party", "party_name", "party_code", "legal_name", "tax_id",
                  "address", "city", "state", "postal_code", "country",
                  "contact_name", "contact_email", "contact_phone",
                  "signatory_name", "signatory_title", "signature_png"]
        read_only_fields = ["party"]

    def validate_signature_png(self, value):
        # Evita firmas gigantes en BD (~3 MB de base64).
        if value and len(value) > 3_000_000:
            raise serializers.ValidationError(
                "La imagen de la firma es muy grande. Usa un PNG más pequeño.")
        return value


class CompanyProfileSerializer(serializers.ModelSerializer):
    tenant_name = serializers.CharField(source="tenant.name", read_only=True)

    class Meta:
        model = CompanyProfile
        fields = ["id", "tenant", "tenant_name", "legal_name", "tax_id", "address",
                  "city", "state", "postal_code", "country", "contact_name",
                  "contact_email", "contact_phone", "signatory_name",
                  "signatory_title", "signature_png", "logo_png"]
        read_only_fields = ["tenant"]

    def validate_signature_png(self, value):
        if value and len(value) > 3_000_000:
            raise serializers.ValidationError(
                "La imagen de la firma es muy grande. Usa un PNG más pequeño.")
        return value

    def validate_logo_png(self, value):
        if value and len(value) > 3_000_000:
            raise serializers.ValidationError(
                "El logo es muy grande. Usa un PNG más pequeño (≤ ~2 MB).")
        return value


class QualificationSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = Qualification
        fields = "__all__"


class AutomotiveAssessmentSerializer(serializers.ModelSerializer):
    product_sku = serializers.CharField(source="product.sku", read_only=True)
    treaty_code = serializers.CharField(source="treaty.code", read_only=True)

    class Meta:
        model = AutomotiveAssessment
        fields = ["id", "product", "product_sku", "treaty", "treaty_code", "vehicle_class",
                  "as_of", "net_cost", "vnm", "lvc_pct", "wage_usd_h", "steel_na_pct",
                  "aluminum_na_pct", "core_parts_originating", "qualifies", "detail", "computed_at"]


class OriginAnalysisSerializer(serializers.ModelSerializer):
    """Lista ligera del histórico (sin la traza pesada)."""
    status_display = serializers.SerializerMethodField()
    kind_display = serializers.CharField(source="get_kind_display", read_only=True)
    treaty_code = serializers.CharField(source="treaty.code", read_only=True)
    product_sku = serializers.CharField(source="product.sku", read_only=True)
    product_description = serializers.CharField(source="product.description", read_only=True)
    product_hs = serializers.CharField(source="product.hs_code", read_only=True)
    computed_by = serializers.CharField(source="computed_by.username", read_only=True, default=None)

    STATUS_LABELS = {"QUALIFIES": "Califica", "DOES_NOT": "No califica",
                     "INSUFFICIENT": "Datos insuficientes",
                     "AUTO_REVIEW": "Requiere régimen automotriz"}

    class Meta:
        model = OriginAnalysis
        fields = ["id", "product", "product_sku", "product_description", "product_hs",
                  "treaty", "treaty_code", "kind", "kind_display",
                  "status", "status_display", "criterion", "rvc_value", "total_value",
                  "vnm", "computed_by", "created_at"]

    def get_status_display(self, obj):
        return self.STATUS_LABELS.get(obj.status, obj.status)


class OriginAnalysisDetailSerializer(OriginAnalysisSerializer):
    """Igual que la lista pero incluye la traza completa del cálculo."""
    class Meta(OriginAnalysisSerializer.Meta):
        fields = OriginAnalysisSerializer.Meta.fields + ["detail"]


class CertificateSerializer(serializers.ModelSerializer):
    product_sku = serializers.CharField(source="qualification.product.sku", read_only=True)
    product_description = serializers.CharField(source="qualification.product.description", read_only=True)
    product_hs = serializers.CharField(source="qualification.product.hs_code", read_only=True)
    treaty_code = serializers.CharField(source="qualification.treaty.code", read_only=True)
    treaty_label = serializers.SerializerMethodField()
    criterion = serializers.CharField(source="qualification.criterion", read_only=True)
    origin_status = serializers.CharField(source="qualification.status", read_only=True)
    rvc_value = serializers.DecimalField(source="qualification.rvc_value", max_digits=6,
                                         decimal_places=2, read_only=True)
    verify_url = serializers.SerializerMethodField()
    qr_data_uri = serializers.SerializerMethodField()

    class Meta:
        model = Certificate
        fields = ["id", "folio", "certifier_type", "certifier_data", "exporter_data",
                  "producer_data", "importer_data", "blanket_from", "blanket_to",
                  "issued_at", "product_sku", "product_description", "product_hs",
                  "treaty_code", "treaty_label", "criterion", "origin_status", "rvc_value",
                  "verify_url", "qr_data_uri"]

    def get_treaty_label(self, obj):
        code = obj.qualification.treaty.code
        return TREATY_LABELS.get(code, code)

    def get_verify_url(self, obj):
        if not obj.verify_token:
            return ""
        path = f"/api/verify/{obj.verify_token}/"
        req = self.context.get("request")
        return req.build_absolute_uri(path) if req else path

    def get_qr_data_uri(self, obj):
        if not obj.verify_token:
            return ""
        import segno
        return segno.make(self.get_verify_url(obj), error="m").png_data_uri(scale=3, border=2)


class SolicitationCertificateSerializer(serializers.ModelSerializer):
    """Certificado de origen del proveedor por solicitud (firmado)."""
    sign_method_display = serializers.CharField(source="get_sign_method_display", read_only=True)
    verify_url = serializers.SerializerMethodField()
    qr_data_uri = serializers.SerializerMethodField()

    class Meta:
        model = SolicitationCertificate
        fields = ["id", "solicitation", "folio", "verify_token", "data", "sign_method",
                  "sign_method_display", "signature_png", "scanned_file", "signed",
                  "signed_at", "verify_url", "qr_data_uri"]
        read_only_fields = fields

    def get_verify_url(self, obj):
        if not obj.needs_qr or not obj.verify_token:
            return ""
        path = f"/api/verify-origin/{obj.verify_token}/"
        req = self.context.get("request")
        return req.build_absolute_uri(path) if req else path

    def get_qr_data_uri(self, obj):
        url = self.get_verify_url(obj)
        if not url:
            return ""
        import segno
        return segno.make(url, error="m").png_data_uri(scale=3, border=2)


class ClientOriginLayoutSerializer(serializers.ModelSerializer):
    """Plantilla del portal de origen del cliente. El archivo (file_b64) NO se
    expone por la API (pesado); solo metadatos, encabezados y mapeo."""
    client_name = serializers.CharField(source="client.name", read_only=True)
    treaty_code = serializers.CharField(source="treaty.code", read_only=True)

    class Meta:
        model = ClientOriginLayout
        fields = ["id", "client", "client_name", "treaty", "treaty_code", "name",
                  "filename", "sheet_name", "header_row", "headers", "mapping",
                  "updated_at"]
        read_only_fields = ["client", "treaty", "filename", "sheet_name",
                            "header_row", "headers"]


class SolicitationBOMLineSerializer(serializers.ModelSerializer):
    total = serializers.DecimalField(max_digits=18, decimal_places=4, read_only=True)

    class Meta:
        model = SolicitationBOMLine
        fields = ["id", "part_number", "description", "hs_code", "unit_price",
                  "quantity", "uom", "country", "has_origin_evidence", "total"]


class SolicitationBOMSerializer(serializers.ModelSerializer):
    lines = SolicitationBOMLineSerializer(many=True, read_only=True)
    rule_description = serializers.CharField(source="rule.description", read_only=True, default=None)
    rule_hs = serializers.CharField(source="rule.hs_pattern", read_only=True, default=None)
    rule_type = serializers.CharField(source="rule.rule_type", read_only=True, default=None)

    class Meta:
        model = SolicitationBOM
        fields = ["id", "rule", "rule_description", "rule_hs", "rule_type", "notes",
                  "rvc_method", "net_cost", "lines", "origin_status", "criterion",
                  "rvc_value", "detail", "computed_at"]


class SolicitationRequestSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    period_display = serializers.CharField(source="get_period_type_display", read_only=True)
    portal_path = serializers.CharField(read_only=True)
    product_sku = serializers.CharField(source="product.sku", read_only=True)
    product_description = serializers.CharField(source="product.description", read_only=True)
    product_hs = serializers.CharField(source="product.hs_code", read_only=True)
    product_unit_cost = serializers.CharField(source="product.unit_cost", read_only=True)
    treaty_code = serializers.CharField(source="treaty.code", read_only=True)
    treaty_members = serializers.JSONField(source="treaty.member_countries", read_only=True)
    treaty_de_minimis = serializers.DecimalField(
        source="treaty.de_minimis_pct", max_digits=5, decimal_places=2, read_only=True)
    supplier_name = serializers.CharField(source="supplier.name", read_only=True)
    supplier_country = serializers.CharField(source="supplier.country", read_only=True)
    tenant_name = serializers.CharField(source="tenant.name", read_only=True)
    submitted_bom = serializers.SerializerMethodField()
    logs = serializers.SerializerMethodField()
    suggested_rule = serializers.SerializerMethodField()
    origin_hint = serializers.SerializerMethodField()
    declared_originating = serializers.SerializerMethodField()
    declaration_detail = serializers.SerializerMethodField()
    supplier_profile = serializers.SerializerMethodField()
    certificate = serializers.SerializerMethodField()

    def get_certificate(self, obj):
        try:
            cert = obj.certificate
        except SolicitationCertificate.DoesNotExist:
            return None
        return {"id": cert.id, "signed": cert.signed, "sign_method": cert.sign_method,
                "sign_method_display": cert.get_sign_method_display(),
                "folio": cert.folio, "signed_at": cert.signed_at}

    def get_declared_originating(self, obj):
        return obj.declaration.is_originating if obj.declaration_id else None

    def get_declaration_detail(self, obj):
        d = obj.declaration if obj.declaration_id else None
        if not d:
            return None
        return {
            "is_originating": d.is_originating, "country_of_origin": d.country_of_origin,
            "rule_description": d.rule.description if d.rule_id else None,
            "rule_type": d.rule.rule_type if d.rule_id else None,
            "value_originating": str(d.value_originating),
            "value_non_originating": str(d.value_non_originating),
            "valid_from": d.valid_from, "valid_to": d.valid_to,
        }

    def get_supplier_profile(self, obj):
        prof = getattr(obj.supplier, "profile", None)
        if not prof:
            return None
        return SupplierProfileSerializer(prof).data

    def _psr(self, obj):
        if not hasattr(obj, "_psr_cache"):
            from apps.origin import engine
            obj._psr_cache = engine.find_rule(obj.treaty, obj.product.hs_code or "")
        return obj._psr_cache

    def get_suggested_rule(self, obj):
        r = self._psr(obj)
        if not r:
            return None
        return {"id": r.id, "hs_pattern": r.hs_pattern,
                "rule_type": r.rule_type, "description": r.description}

    def get_origin_hint(self, obj):
        hs = "".join(c for c in (obj.product.hs_code or "") if c.isdigit())
        if hs.startswith("8708"):
            return ("Este producto es una AUTOPARTE (fracción 8708). En el USMCA las autopartes "
                    "siguen el régimen automotriz (VCR alto + Valor de Contenido Laboral y "
                    "requisitos de compra de acero/aluminio). Revisa la regla específica con cuidado.")
        if hs[:2] == "87":
            return ("Producto del sector automotor (capítulo 87). Aplica el régimen automotriz "
                    "del USMCA; las reglas son más estrictas que las generales.")
        r = self._psr(obj)
        crit = {"CTC": "cambio de clasificación arancelaria (CTH)",
                "RVC": "valor de contenido regional (VCR)",
                "CTC_OR_RVC": "CTH o VCR", "CTC_AND_RVC": "CTH y VCR",
                "WO": "totalmente obtenido"}
        if r:
            return (f"Para esta fracción suele aplicar: {crit.get(r.rule_type, r.rule_type)}. "
                    "Selecciona la regla sugerida y completa el BOM en consecuencia.")
        return ("No encontramos una regla específica para esta fracción; lo más común es el "
                "cambio de clasificación arancelaria (CTH). Confírmalo con un especialista.")

    ACTION_LABELS = {
        "bom_saved": "BOM guardado", "origin_calculated": "Origen calculado",
        "copied_previous": "Información traída de periodo anterior",
        "sent": "Enviada al cliente",
        "sent_unchanged": "Enviada SIN cambios vs periodo anterior",
        "accepted": "Aceptada por el cliente",
        "rejected": "Rechazada por el cliente",
    }

    def get_logs(self, obj):
        return [{"action": l.action, "action_label": self.ACTION_LABELS.get(l.action, l.action),
                 "detail": l.detail, "user": l.user.username if l.user_id else None,
                 "created_at": l.created_at} for l in obj.logs.all()[:30]]

    class Meta:
        model = SolicitationRequest
        fields = "__all__"

    def get_submitted_bom(self, obj):
        bom = SolicitationBOM.objects.filter(solicitation=obj).prefetch_related("lines").first()
        return SolicitationBOMSerializer(bom).data if bom else None
