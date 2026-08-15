import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(() => {
  const isVercel = process.env.VERCEL === "1";

  return {
    base: isVercel ? "/zhidaole/" : "/",
    plugins: [react()],
    define: {
      "import.meta.env.VITE_APP_BASE_PATH": JSON.stringify(
        isVercel ? "/zhidaole" : ""
      )
    },
    server: {
      host: "127.0.0.1"
    },
    build: {
      target: "es2022"
    }
  };
});
