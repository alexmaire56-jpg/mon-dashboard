// URL de base pour les appels API
const API_BASE = import.meta.env.VITE_API_URL || "";

export function apiUrl(path) {
  return API_BASE + path;
}
