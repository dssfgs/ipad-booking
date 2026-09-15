// 前端設定檔（可公開，無 secret）。複製為 js/config.js 後填入實際數值。
// 若 API_URL 或 GOOGLE_CLIENT_ID 仍含 REPLACE_WITH，前端會顯示「系統尚未完成設定」而不呼叫 API。
window.APP_CONFIG = {
  API_URL: "https://script.google.com/macros/s/REPLACE_WITH_DEPLOYMENT_ID/exec",
  GOOGLE_CLIENT_ID: "REPLACE_WITH_CLIENT_ID.apps.googleusercontent.com",
  ALLOWED_DOMAIN: "blcwc.edu.hk",
  SCHOOL_NAME: "香港正覺蓮社佛教梁植偉中學",
  APP_TITLE: "iPad 預約及借還系統",
  REQUEST_TIMEOUT_MS: 20000,
  WEEK_CACHE_TTL_MS: 60000
};
