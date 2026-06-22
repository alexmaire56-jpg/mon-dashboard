// URL de base pour les appels API
// En dev : vide (le proxy Vite redirige /api vers localhost:3001)
// En prod : l'URL Railway injectée au build par Netlify
const API_BASE = import.meta.env.VITE_API_URL || "";

export function apiUrl(path) {
  return `${API_BASE}${path}`;
}