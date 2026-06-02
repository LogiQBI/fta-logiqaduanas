from django.urls import path

from apps.catalog import views

urlpatterns = [
    path("portal/<str:token>/", views.supplier_portal, name="supplier-portal"),
]
