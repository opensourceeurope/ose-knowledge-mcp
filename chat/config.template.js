// Template for chat/config.js — rendered by chat/render-config.sh (locally) or by the
// deploy-chat GitHub workflow, from the FUNCTION_URL environment value.
// Do NOT hand-edit config.js for deploys; set the value via env / repo variables instead.
window.OSE_CHAT_CONFIG = {
  FUNCTION_URL: "${FUNCTION_URL}",
};
