# 部署指南（DEPLOYMENT）

適用：香港正覺蓮社佛教梁植偉中學 iPad 預約及借還系統
架構：GitHub Pages 靜態前端 ＋ Google Apps Script Web App（JSON API）＋ 中央 Google 試算表

整個部署分五步，順序不可調動：
1. 建立 Google Cloud OAuth Client ID
2. 建立／設定 Apps Script 專案並部署 Web App
3. 設定 Script Properties
4. 執行 `setupSystem()`（初始化或 migration）
5. 設定 GitHub Pages 前端並填入 `js/config.js`

所有步驟均由學校的 Google Workspace 管理帳戶（系統擁有者帳戶）操作。

---

## 1. Google Cloud OAuth Client ID

1. 以系統擁有者帳戶登入 [Google Cloud Console](https://console.cloud.google.com/)。
2. 建立新專案（建議名稱 `ipad-booking`），或選用學校既有專案。
3. 左側「API 和服務」→「OAuth 同意畫面」：
   - 使用者類型選 **內部（Internal）**：只有 blcwc.edu.hk 網域帳戶可登入，這是第一道網域限制（後端仍會嚴格檢查 `hd`）。
   - 應用程式名稱：`iPad 預約及借還系統`；支援電郵：系統擁有者電郵。
   - 範圍（Scopes）：只需預設的 `openid`、`email`、`profile`。
4. 「憑證」→「建立憑證」→「OAuth 用戶端 ID」：
   - 應用程式類型：**網頁應用程式**。
   - 名稱：`ipad-booking-web`。
   - **已授權的 JavaScript 來源**（必須逐一加入，不含結尾斜線）：
     - `https://<GitHub 帳戶>.github.io`
     - 若日後使用自訂網域，另加 `https://<自訂網域>`
   - 「已授權的重新導向 URI」留空（Google Identity Services 不需要）。
5. 建立後複製「用戶端 ID」（格式 `xxxxxxxx.apps.googleusercontent.com`）。
   - 用戶端 ID 是公開值，會放入前端 `js/config.js`。
   - **用戶端密碼（Client secret）在本系統完全不使用**，不要複製到任何地方。

---

## 2. Apps Script 專案

### 2.1 建立專案
1. 前往 [script.google.com](https://script.google.com/) → 「新專案」，命名 `iPad Booking API`。
   - 建議使用**獨立（standalone）專案**，以 Script Properties 指定試算表 ID；這樣日後更換試算表不需搬移程式。
   - 若你想沿用綁定在現有試算表的專案亦可，步驟相同。
2. 「專案設定」→ 勾選「在編輯器中顯示 appsscript.json 資訊清單檔案」。
3. 依 `apps-script/` 目錄，逐一建立同名檔案並貼上全部內容：
   `Code.gs`、`Api.gs`、`Auth.gs`、`Data.gs`、`Booking.gs`、`Approval.gs`、`Handover.gs`、`Notifications.gs`、`Scheduler.gs`、`Migration.gs`、`Tests.gs`，並以 `apps-script/appsscript.json` 取代資訊清單內容。

### 2.2 部署為 Web App
1. 右上「部署」→「新增部署作業」→ 類型「網頁應用程式」。
2. 說明：`v3 JSON API`。
3. **執行身分：我**（系統擁有者）。
4. **誰可以存取：所有人**。
   - 這是讓 GitHub Pages 瀏覽器能匿名 `fetch` 的必要設定。安全性由每個請求內的 Google ID token 驗證保證（見 SECURITY.md），未通過驗證的請求只會收到 401/403 類型 JSON，不會取得任何資料。
5. 按「部署」，首次會要求授權（試算表、Drive 備份、外部請求、寄送電郵、觸發器）。
6. 複製「網頁應用程式 URL」（`https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec`）。

### 2.3 更新版本
- 修改程式後：「部署」→「管理部署作業」→ 選取現有部署 → 鉛筆圖示 → 版本選「新版本」→「部署」。
- **必須更新同一個部署**，URL 才不會改變；不要每次「新增部署作業」。
- 更新後在瀏覽器開啟 `<URL>?action=health` 確認 `version` 已變更。

---

## 3. Script Properties

「專案設定」→「指令碼屬性」→「新增指令碼屬性」，逐一加入：

| 屬性 | 值 | 說明 |
|---|---|---|
| `SPREADSHEET_ID` | `<中央試算表 ID>` | 網址 `/spreadsheets/d/<ID>/edit` 中的 ID。沿用現有試算表時填現有 ID；留空則 `setupSystem()` 會建立全新試算表並自動填入 |
| `OAUTH_CLIENT_ID` | `<第 1 步的用戶端 ID>` | 必須與前端 `GOOGLE_CLIENT_ID` 完全相同 |
| `ALLOWED_HD` | `blcwc.edu.hk` | 只接受此 Workspace 網域 |
| `FRONTEND_URL` | `https://<帳戶>.github.io/<repo>/` | 電郵內的操作連結 |
| `ADMIN_EMAIL_FALLBACK` | `<系統擁有者電郵>` | 人員設定沒有任何啟用管理員時的通知收件人 |

這些值只存在 Apps Script 內，**絕不可提交到 GitHub**。

---

## 4. 初始化或 migration

### 4.1 沿用現有試算表（有舊資料）
1. 先手動備份：在 Google Drive 對試算表按右鍵 →「建立副本」，命名 `ipad-backup-YYYYMMDD-manual`。
2. 在 Apps Script 編輯器選擇函式 `setupSystem` → 執行。它會：
   - 偵測 `系統設定` 沒有 `schemaVersion`（視為 v2）→ 自動再以 `DriveApp.makeCopy` 建立一份 `ipad-backup-<時間戳>`。
   - 只在缺少時追加 `申請主表` 第 U–Y 欄、`操作紀錄` 第 G–J 欄、`系統設定` 新列（schemaVersion、逾時未領取分鐘、逾時未歸還分鐘、系統版本）。
   - 不會刪除、改名、搬動任何欄位或資料。
   - 安裝／重建 `processScheduledTasks` 每 15 分鐘觸發器。
   - 在 `操作紀錄` 寫入 `執行 migration`。
3. 到「執行紀錄」確認沒有錯誤，並打開試算表核對新欄位。

### 4.2 全新試算表（只在沒有現有試算表時使用）
1. `setupSystem` **不會**自行建立試算表；若 `SPREADSHEET_ID` 未設定，它會停止並提示先填入 ID，以免誤建。
2. 確定要從零開始時，不填 `SPREADSHEET_ID`，改執行 `createNewSpreadsheetAndSetup`。完成後 `SPREADSHEET_ID` 會自動寫入。
3. 新試算表的 `人員設定` 會以 `ADMIN_EMAIL_FALLBACK`（或部署者帳戶）預填一位管理員及經手人；請再補上其他人員電郵。
4. 若 `SPREADSHEET_ID` 已有值，`createNewSpreadsheetAndSetup` 會拒絕執行，避免覆蓋現有系統。

### 4.2.1 首次執行的授權
首次執行任何函式時 Google 會要求授權。若看到「Specified permissions are not sufficient」，代表 `appsscript.json` 未以本 repository 的版本取代（缺少 `userinfo.email` 等 scope）；請貼上最新 `appsscript.json` 後，於「部署 → 測試部署」或重新執行函式時重新授權。

### 4.3 驗證後端
- 瀏覽器直接開啟 `<Web App URL>`（或 `<Web App URL>?action=health`），應看到 `{"ok":true,"data":{"status":"ok","schemaVersion":3,"setup":{...}}}`。
- `data.setup` 會回報設定完成度（不含任何個人資料）：`spreadsheetConfigured`、`oauthClientConfigured`、`allowedHdConfigured`、`missingSheets`、`slotCount`、`staffCount`，以及中文 `hints`。若 `status` 為 `setup_incomplete`，依 `hints` 逐項處理後重新整理即可。
- 若 `data.configWarning` 有值，代表 `系統設定.獲准網域` 與 `ALLOWED_HD` 不一致，請修正。
- 注意：Web App URL 只回傳 JSON，不會改動試算表；真正建立工作表的是在編輯器執行 `setupSystem()`。

---

## 5. GitHub Pages 前端

### 5.1 建立 repository 並發布
1. 在 GitHub 建立 repository（本專案為 `ipad-booking`，公開；免費方案只有公開 repo 能開 GitHub Pages）。
2. 推送本專案全部檔案至 `main` 分支。
3. Repository →「Settings」→「Pages」→「Build and deployment」：Source 選「Deploy from a branch」，Branch 選 `main`／`/(root)` → Save。
4. 約 1–2 分鐘後網址為 `https://<帳戶>.github.io/ipad-booking/`。`.nojekyll` 檔案已存在，確保 Jekyll 不會改動檔案。

### 5.2 填入設定
編輯 `js/config.js`（此檔只含公開值）：

```js
window.APP_CONFIG = {
  API_URL: "https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec",
  GOOGLE_CLIENT_ID: "<用戶端 ID>.apps.googleusercontent.com",
  ALLOWED_DOMAIN: "blcwc.edu.hk",
  SCHOOL_NAME: "香港正覺蓮社佛教梁植偉中學",
  APP_TITLE: "iPad 預約及借還系統",
  REQUEST_TIMEOUT_MS: 20000,
  WEEK_CACHE_TTL_MS: 60000
};
```
提交並推送，等待 Pages 重新發布。

### 5.3 首次登入檢查
1. 以校內帳戶開啟 Pages 網址，按「使用 Google 帳戶登入」。
2. 若出現 `origin_mismatch` 或按鈕不顯示：回到第 1 步確認「已授權的 JavaScript 來源」與網址完全一致（含 https、不含路徑與斜線）。
3. 登入後頁首應顯示你的電郵，週表在 6 秒內出現。

---

## 6. 備份、回復與災難復原

| 情境 | 步驟 |
|---|---|
| 定期備份 | 每學期在 Drive 對試算表「建立副本」；`migrateSystem()` 每次升級亦自動建立 `ipad-backup-<時間戳>` |
| 前端回復舊版 | GitHub → 該 commit →「Revert」或 `git revert`；Pages 自動重建 |
| 後端回復舊版 | Apps Script「部署」→「管理部署作業」→ 編輯部署 → 版本選舊版本 →「部署」；URL 不變 |
| 試算表損毀 | 把備份副本的 ID 填入 `SPREADSHEET_ID`（或把備份內容複製回原表），執行 `setupSystem` 確認 schema 與觸發器 |
| 觸發器遺失 | 執行 `setupSystem`，會重建 `processScheduledTasks` 觸發器 |
| OAuth Client 被刪除 | 依第 1 步重建，同時更新 `OAUTH_CLIENT_ID` 與 `js/config.js` |
| 更換系統擁有者 | 新擁有者複製 Apps Script 專案、重新部署、重新填 Script Properties，並把試算表擁有權轉移 |

---

## 7. 常見問題

| 現象 | 原因 | 處理 |
|---|---|---|
| 瀏覽器 Console 出現 CORS 錯誤 | Web App 未設為「所有人」，或前端加了自訂 header | 檢查部署設定；`api.js` 只用 `text/plain` |
| health 正常但登入後所有請求 `INVALID_AUDIENCE` | `OAUTH_CLIENT_ID` 與 `GOOGLE_CLIENT_ID` 不同 | 兩邊填同一個值 |
| 校內帳戶被拒 `FORBIDDEN_DOMAIN` | 帳戶不屬於 blcwc.edu.hk（例如別名或個人帳戶） | 以正式 Workspace 帳戶登入 |
| 沒有收到電郵 | MailApp 每日配額用盡或收件人在人員設定未啟用 | 查看 Apps Script「執行紀錄」及 `操作紀錄` 備註欄 |
| 排程沒有執行 | 觸發器遺失 | 執行 `setupSystem` |
