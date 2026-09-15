# iPad 預約及借還系統

香港正覺蓮社佛教梁植偉中學 iPad 及 Apple Pencil 預約、審批、借還管理系統。

- **前端**：純 HTML／CSS／JavaScript 靜態網站，由 GitHub Pages 發布（本 repository 根目錄）。
- **後端**：Google Apps Script Web App，只提供 JSON API（`apps-script/`）。
- **資料庫**：學校中央 Google 試算表（八個工作表），透過 migration 相容舊資料。
- **身分**：Google Identity Services ID token，後端完整驗證簽章、`aud`、`iss`、`exp`、`email_verified`、`hd = blcwc.edu.hk`。

## 目錄結構

```
index.html            前端入口（共用時間表、我的申請、審批中心、借還處理、借用紀錄搜尋）
css/styles.css        樣式
js/config.js          前端公開設定（API URL、OAuth Client ID）— 部署時填入，不含任何 secret
js/config.example.js  設定範本
js/api.js             fetch 封裝（POST text/plain simple request、逾時、requestId、序號）
js/auth.js            Google Identity Services 登入、token 續期
js/calendar.js        七天週表（星期一至日）及特別活動列
js/forms.js           申請對話框（一般課堂／特別活動）、驗證、共用格式化
js/admin.js           審批中心、借還處理、借用紀錄搜尋
js/app.js             路由、狀態、視圖切換
assets/favicon.svg    圖示
.nojekyll             關閉 GitHub Pages 的 Jekyll 處理
apps-script/          Apps Script 後端全部檔案（貼到 Apps Script 專案）
dev/                  本機測試模式（mock API 伺服器，不需 Google 帳戶）
docs/CONTRACT.md      前後端 API 契約（權威文件）
DEPLOYMENT.md         安裝與部署步驟
SECURITY.md           安全設計與威脅模型
TESTING.md            測試方法、測試清單、效能驗收
```

## 快速開始

1. 依 [DEPLOYMENT.md](DEPLOYMENT.md) 建立 OAuth Client ID、部署 Apps Script Web App、設定 Script Properties、執行 `setupSystem()`。
2. 在 `js/config.js` 填入 `API_URL` 與 `GOOGLE_CLIENT_ID`（兩者皆為公開值），推送到 `main`。
3. GitHub → Settings → Pages → Source：`Deploy from a branch`，Branch：`main` / `/ (root)`。
4. 開啟 `https://<帳戶>.github.io/ipad-booking/`，以 blcwc.edu.hk 帳戶登入。

## 本機測試（不需 Google 帳戶）

```bash
node dev/mock-server.js
# 瀏覽 http://127.0.0.1:8787/dev/mock.html
```

Mock 模式可切換教師／管理員／經手人角色，模擬庫存衝突、特別活動、審批與借還流程。詳見 [TESTING.md](TESTING.md)。

後端單元測試（Node 模擬 Apps Script 環境）：

```bash
cd local-tests && node run.js
```

Apps Script 內亦可直接執行 `runAllTests()`。

## 主要功能

- 七天共用時間表（星期一至六一般時段，星期日只限特別活動），顯示每時段核准／待審／尚餘 iPad 與 Apple Pencil。
- 一般課堂申請：可連續多個時段，Apple Pencil 數量不可多於 iPad。
- 特別活動申請：自訂開始／結束時間、跨越多個時段，以區間尖峰法計算庫存；一律需管理員審批；星期日或封鎖日期需特別批准；17:15 後結束必須填寫備註並確認自行保管。
- 審批中心：核准／拒絕（需理由）、特別批准二次確認、電郵通知。
- 借還處理：領取、部分歸還、異常備註；排程自動標示逾時。
- 借用紀錄搜尋：關鍵字、日期範圍、預約類型。
- 操作紀錄：所有寫入均記錄操作者、角色、原資料、新資料、請求編號。

## 安全重點

- 所有寫入只用 POST；GET 只能讀取（`?action=health`）。
- POST 使用 `text/plain;charset=UTF-8`，避免 preflight，不使用 `no-cors`、JSONP。
- ID token 只在 POST body 傳送，不放 URL。
- 後端 action 白名單，不會依前端字串動態執行函式。
- 寫入試算表的自由文字會處理公式注入（`=`、`+`、`-`、`@` 開頭）。
- 試算表 ID、管理員清單、電郵等只存放於 Script Properties 及試算表，不進 GitHub。

詳見 [SECURITY.md](SECURITY.md)。

## 授權

供香港正覺蓮社佛教梁植偉中學內部使用。
