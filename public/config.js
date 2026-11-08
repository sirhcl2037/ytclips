// On Azure, set this to the Container App origin (HTTPS, no trailing slash).
// Leave empty when the Node server hosts this page locally.
window.CLIPS_CONFIG = { apiBase: location.hostname.endsWith('.azurestaticapps.net') ? 'http://127.0.0.1:8787' : '' };
