import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "نظام تشغيل ورقابة فرع العوادي – عدن",
    short_name: "العوادي عدن",
    description: "نظام داخلي لتشغيل ورقابة فرع العوادي في عدن.",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f7fb",
    theme_color: "#101828",
    lang: "ar",
    dir: "rtl",
  };
}
