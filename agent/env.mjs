// Loads open-source-tryon/.env before any module reads process.env (ES imports run before the importer's body).
try { process.loadEnvFile(new URL("../.env", import.meta.url)); } catch { /* no .env: rely on the environment */ }
