/* RC Grand Prix internet multiplayer configuration.
   Leave blank for STUN-only (LAN and many home-network connections).
   For global reliability, configure a credential-scoped TURN API URL.
   NEVER paste an account Secret Key or admin API token into public GitHub Pages.
   See RC_GLOBAL_MULTIPLAYER.md for steps. */
window.RC_MULTIPLAYER_CONFIG = {
  // Metered example (credential API key only; NOT the workspace secret key):
  // https://YOURAPP.metered.live/api/v1/turn/credentials?apiKey=YOUR_CREDENTIAL_API_KEY
  turnCredentialUrl: ''
};
