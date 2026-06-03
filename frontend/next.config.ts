import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Exportación estática: genera HTML/JS en `out/` para que Django (el backend)
  // los sirva en el mismo servicio de Railway (un solo despliegue).
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;
