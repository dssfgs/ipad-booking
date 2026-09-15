# 安全設計（SECURITY）

## 1. 威脅模型

| 資產 | 威脅 | 對策 |
|---|---|---|
| 預約資料、教師電郵 | 未登入者或校外帳戶讀取 | 每個非 `health` 請求必須附 Google ID token，後端完整驗證後才讀資料 |
| 庫存完整性 | 併發申請超額、前端偽造數量 | 後端在 LockService 臨界區重新讀取並重算庫存；前端數字只作顯示 |
| 身分冒用 | 前端傳入他人 email | 後端完全忽略 payload 內的 email，只用 token 內已驗證的 email |
| 權限提升 | 前端自行顯示管理功能 | 角色由 `人員設定` 工作表決定並在每個 action 檢查；前端導覽只是便利 |
| 狀態竄改 | 直接呼叫 API 指定任意狀態 | API 不接受狀態欄位；所有轉換經 `assertTransition_` 白名單 |
| 試算表公式注入 | 備註以 `=`、`+`、`-`、`@` 開頭 | 寫入前加 `'` 前綴 |
| 資訊洩漏 | stack trace 回傳、token 進入 URL | 只回傳安全訊息與 requestId；token 只放 POST body |
| Secret 外洩 | 提交到公開 repo | repo 只含 OAuth Client ID（公開值）與 Web App URL；試算表 ID、網域、通知名單皆在 Script Properties 或工作表 |

## 2. ID token 驗證流程（Auth.gs）

1. 解析 JWT 三段，`alg` 必須為 `RS256`。
2. 以 `kid` 取 Google 公開金鑰（`https://www.googleapis.com/oauth2/v3/certs`），依 `Cache-Control: max-age` 快取於 CacheService；`kid` 未命中則強制重抓一次。
3. 以 V8 `BigInt` 執行 RSASSA-PKCS1-v1_5 驗簽（SHA-256 由 `Utilities.computeDigest` 計算），比對 EM 編碼。
4. 檢查 `aud === OAUTH_CLIENT_ID`、`iss ∈ {accounts.google.com, https://accounts.google.com}`、`exp > now − 30s`、`email_verified === true`、`hd === ALLOWED_HD`。
5. 通過後以 `sha256(token)` 快取結果，TTL 不超過 token 剩餘壽命且最長 300 秒。

`tokeninfo` 端點只在 `Tests.gs` 作交叉檢查，不在正式路徑使用。

## 3. 傳輸

- 前端 → 後端：HTTPS，`POST`，`Content-Type: text/plain;charset=UTF-8`（simple request，無 preflight），body 為 JSON。
- 後端回應經 Apps Script 302 轉址至 `script.googleusercontent.com`，附 `Access-Control-Allow-Origin: *`；瀏覽器可讀取 JSON。
- 不使用 `mode: 'no-cors'`、不使用 JSONP、不使用自訂 header。
- `GET` 只允許 `action=health`，內容不含任何資料。

## 4. Web App「所有人」存取的含意

Apps Script Web App 必須設為「所有人」才可被靜態網站匿名呼叫。這代表 URL 可達，但：
- 任何未附有效 token 的請求都只會收到 `{"ok":false,"error":{"code":"AUTH_REQUIRED"}}` 類型回應。
- Web App URL 不是 secret；系統安全不依賴它保密。

## 5. 前端

- Token 只存於記憶體與 `sessionStorage`，關閉分頁即消失。
- 前端解析 JWT 只為顯示 email 與判斷是否需要續期，不用於任何授權決定。
- 所有伺服器回應以 `textContent` 寫入 DOM，不使用 `innerHTML` 插入使用者資料，避免 XSS。
- 按鈕防連點與 `clientRequestId` 減少重複提交。

## 6. 稽核

- 每次寫入 action 均寫入 `操作紀錄`：時間、已驗證 email、角色、動作、預約編號、原資料、新資料、結果、requestId。
- `操作紀錄`、`人員設定`、`系統設定` 以工作表保護限制為擁有者可編輯；Web App 以擁有者身分執行。
- `FORBIDDEN_ROLE` 事件會記錄；每次 token 驗證失敗不逐筆記錄以避免被灌爆，但 Apps Script 執行紀錄會保留。

## 7. 回報漏洞

請直接聯絡系統擁有者（資訊科技組），不要在公開 issue 貼出任何 token、試算表 ID 或個人資料。
