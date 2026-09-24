// The app uses same-domain URLs by default, which works behind a normal
// production reverse proxy. Set VITE_SERVER_URL only when the API lives on a
// separate public HTTPS domain. Vite's development proxy handles local work.
export const SERVER_URL = (import.meta.env.VITE_SERVER_URL || '').replace(/\/$/, '');
export const apiUrl = (path: string) => `${SERVER_URL}${path}`;
