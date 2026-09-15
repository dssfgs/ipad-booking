# 測試指南（TESTING）

三層測試：本地 Node 模擬測試（開發者）、Apps Script 內建測試（部署者）、真實環境驗收（部署者＋三角色測試帳戶）。

---

## 1. 本地 Node 模擬測試

位置：`local-tests/`（不會部署到 Pages，也不需要 Google 帳戶）。

```bash
cd local-tests
node run.js
```

`gas-shim.js` 以記憶體模擬 `SpreadsheetApp`、`CacheService`、`PropertiesService`、`LockService`、`UrlFetchApp`、`MailApp`、`Utilities`；`run.js` 把 `apps-script/*.gs` 載入同一 VM context 後執行：

| 測試 | 內容 |
|---|---|
| JWT 驗簽 | 以 Node 產生 RSA 金鑰簽出 RS256 token；正確 token 通過；篡改 payload → `INVALID_TOKEN`；錯 aud → `INVALID_AUDIENCE`；錯 iss → `INVALID_ISSUER`；過期 → `TOKEN_EXPIRED`；hd 錯 → `FORBIDDEN_DOMAIN` |
| 時間正規化 | `9:10`、`08:00:00`、Date 物件 → `HH:mm` |
| 連續時段 | `[P01,P02]` 通過、`[P01,P03]` 拒絕、跨午膳 `[P07,P08]` 依 order 相鄰仍通過 |
| 公式注入 | `=SUM(A1)`、`+1`、`-1`、`@x` 寫入時加 `'` |
| 狀態機 | 白名單內轉換通過，其他 → `INVALID_STATE_TRANSITION` |
| Migration | v2 fixtures（含 `ACT`、`特別活動`、`9:10`）升級 v3 後舊欄舊值不變、只追加新欄 |
| 併發 | 同格 50+50 → 第二筆 `CONFLICT_INSUFFICIENT_STOCK`；45+45 通過、再 1 部失敗 |
| 排程冪等 | `processScheduledTasks` 連跑兩次，第二次寄信數為 0，狀態不再變 |
| 效能 | 空資料、一般資料、1,000 筆明細的 `getWeekData` 相對耗時 |

結果記錄於 `backend_test_report.md`（開發交付時附上）。

---

## 2. Apps Script 內建測試（Tests.gs）

在 Apps Script 編輯器選擇函式執行，結果見「執行紀錄」：

| 函式 | 用途 |
|---|---|
| `runAllTests()` | 純函式單元測試 + 狀態機 + 併發（序列化模擬）+ 排程冪等（mail stub） |
| `testAuthRejections()` | 以內建測試向量驗證各種拒絕情境 |
| `testConcurrentBooking()` | 同格兩筆搶最後庫存 |
| `testSchedulerIdempotent()` | 排程連跑兩次 |
| `benchmarkGetWeekData()` | 在**臨時測試試算表**建立空／一般／1,000 筆資料，記錄 execution duration，結束後刪除臨時表 |

所有測試不會寄出真實電郵，也不會寫入正式試算表。

### 真實併發測試（可選）
1. 建立兩個時間驅動觸發器，同時指向 `Tests.gs` 內的 `concurrencyProbeA` 與 `concurrencyProbeB`，設定於同一分鐖。
2. 兩者各向同一格提交 50 部 iPad；查看 `操作紀錄`，應只有一筆成功，另一筆 `失敗:CONFLICT_INSUFFICIENT_STOCK`。
3. 測試後刪除該兩筆申請及觸發器。

---

## 3. 階段 A：真實環境技術驗證（必須全部通過）

前置：Pages 已發布、Apps Script 已部署、`js/config.js` 已填。

| # | 測試 | 操作 | 預期 |
|---|---|---|---|
| A1 | GET health | 瀏覽器開 `<API_URL>?action=health` | `ok:true`，無資料 |
| A2 | 跨網域 GET | 在 Pages 開 DevTools Console：`fetch(APP_CONFIG.API_URL+'?action=health').then(r=>r.json()).then(console.log)` | 讀到 JSON；Network 只見 GET 與 302 |
| A3 | 無 token POST | Console：`fetch(APP_CONFIG.API_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify({action:'whoami',payload:{}})}).then(r=>r.json()).then(console.log)` | `error.code:"AUTH_REQUIRED"`；Network **沒有** OPTIONS |
| A4 | 校內帳戶 | 登入 → 頁首顯示電郵，週表載入 | 成功；Console 無錯誤 |
| A5 | 個人 Gmail | 以 gmail.com 帳戶登入 | 顯示「只限 blcwc.edu.hk 帳戶」；Network 回應 `FORBIDDEN_DOMAIN`，`data:null` |
| A6 | 篡改 token | Console 取 `sessionStorage.ipad_id_token`，改中段一個字元後手動 POST whoami | `INVALID_TOKEN` |
| A7 | 錯誤 audience | 以另一個 OAuth client 取得的 token POST | `INVALID_AUDIENCE` |
| A8 | 過期 token | 登入後放置 65 分鐘，或用舊 token | 前端自動續期一次；手動 POST 舊 token → `TOKEN_EXPIRED` |
| A9 | GET 寫入 | 開 `<API_URL>?action=submitApplication` | `METHOD_NOT_ALLOWED` |
| A10 | 未知 action | POST `action:"dropTable"` | `UNKNOWN_ACTION` |
| A11 | 瀏覽器 | Chrome、Safari（iPad）、Edge 各重跑 A2–A5 | 一致 |
| A12 | 效能 | Apps Script「執行數」查看 `bootstrap` 與 `getWeekData` 時長 | 冷啟動 bootstrap < 6 秒；暖啟動 bootstrap < 3 秒、getWeekData < 2 秒 |

---

## 4. 階段 B／C：功能驗收

### 4.1 測試帳戶模板

| 角色 | 電郵 | 人員設定 | 用途 |
|---|---|---|---|
| 教師 A | `teacher-a@blcwc.edu.hk` | 不列 | 提交、取消、看週表 |
| 教師 B | `teacher-b@blcwc.edu.hk` | 不列 | 併發搶庫存、確認看不到 A 的電郵 |
| 審批員 | `approver@blcwc.edu.hk` | 管理員 / TRUE | 核准、拒絕 |
| 處理員 | `handover@blcwc.edu.hk` | 設備室經手人 / TRUE | 領取、部分歸還 |
| 校外 | `someone@gmail.com` | — | 必須被拒 |

### 4.2 功能測試清單

| # | 情境 | 步驟 | 預期 |
|---|---|---|---|
| B1 | 正常申請 | 教師 A 選明天 P02+P03、iPad 20、Pencil 10 | 待審批；格內待審 +20；A 與審批員收到電郵 |
| B2 | 不連續時段 | 選 P02+P04 | 前端即時提示；強行送出後端 `VALIDATION_ERROR` |
| B3 | Pencil > iPad | iPad 10、Pencil 11 | 前端阻止；後端 `VALIDATION_ERROR` |
| B4 | 封鎖日 | 在封鎖日期加入明天全日 | 該日格灰、不可點；後端 `SLOT_BLOCKED` |
| B5 | 過去時段 | 選今天已過的節 | 灰、不可點；後端 `SLOT_PAST` |
| B6 | 超額 | 已核准 80、教師 B 再申請 15 | 前端顯示尚餘 10；後端 `CONFLICT_INSUFFICIENT_STOCK` |
| B7 | 併發 | A、B 同時提交最後 10 部 | 只一筆成功 |
| B8 | 取消 | A 取消待審申請 | 已取消；格內待審減少；電郵 |
| B9 | 核准 | 審批員核准 B1 | 已核准；待審→已核准；A 收電郵 |
| B10 | 拒絕無原因 | 審批員拒絕不填原因 | 前端阻止；後端 `VALIDATION_ERROR` |
| B11 | 領取 | 處理員登記實領 18/10 | 已領取；未還 18/10；交收紀錄一筆 |
| B12 | 部分歸還 | 歸還 10/5 | 未完全歸還；未還 8/5 |
| B13 | 完全歸還 | 歸還 8/5 | 已歸還；電郵 |
| B14 | 逾時未領取 | 核准後不領取，等時段開始 +30 分鐘後排程 | 逾時未領取；電郵一次；再等 15 分鐘不重寄 |
| B15 | 逾時未歸還 | 已領取不歸還，等最後時段結束 +30 分鐘 | 逾時未歸還；電郵一次 |
| B16 | 自動過期 | 待審批未處理直到時段開始 | 已過期 |
| B17 | 角色隔離 | 教師 A 直接 POST `approveApplication` | `FORBIDDEN_ROLE`，操作紀錄有 `拒絕存取` |
| B18 | 隱私 | 教師 B 看週表 | 只見 A 的姓名／班別／科目，無電郵 |
| B19 | 公式注入 | 備註填 `=HYPERLINK("x")` | 試算表顯示為文字 `'=HYPERLINK("x")`，前端顯示原文 |
| B20 | 手機 | 390px 寬 | 單日模式、星期下拉、切換完整週表可用 |
| B21 | 無障礙 | 只用鍵盤 | Tab 可到每格、Enter 開表單、Esc 關閉、焦點回到原格 |
| B22 | 處理中不卡死 | 斷網後按提交 | 20 秒逾時顯示錯誤與重試，按鈕恢復 |

### 4.3 特別活動測試清單

| # | 情境 | 步驟 | 預期 |
|---|---|---|---|
| S1 | 基本特別活動 | 教師 A 選星期三，活動「領袖訓練」14:00–16:00、iPad 30、Pencil 10 | 待審批；週表底部「特別活動」列顯示「領袖訓練 14:00–16:00」；P08、P09、AFTER 的待審各 +30 |
| S2 | 跨時段扣減 | 承 S1 核准後，教師 B 於 P08 申請 iPad 70 | 前端尚餘顯示 60；後端 `CONFLICT_INSUFFICIENT_STOCK` |
| S3 | 兩個活動重疊 | 另一活動 15:30–17:00 iPad 65 | 尖峰 15:30–16:00 為 30+65=95 > 90 → 拒絕；改 60 → 成功 |
| S4 | 17:15 後結束未確認 | 結束時間 18:30，不勾保管確認 | 前端阻止；後端 `VALIDATION_ERROR`（afterHoursConfirm） |
| S5 | 17:15 後結束無備註 | 勾選確認但備註空白 | 前端阻止；後端 `VALIDATION_ERROR`（remark） |
| S6 | 17:15 後結束完整 | 勾選＋備註 | 主表「17:15後保管確認」＝是；審批卡片及電郵含保管確認全文 |
| S7 | 星期日 | 教師 A 選星期日提交特別活動 | 可提交；「需特別批准」＝是，原因「星期日」；週表徽章「需特別批准」；電郵主旨含【需特別批准】 |
| S8 | 星期日一般課堂 | 教師 A 嘗試在星期日一般時段申請 | 週表星期日一般時段灰格不可點；後端 `VALIDATION_ERROR` |
| S9 | 封鎖日特別活動 | 管理員封鎖星期四全日「校慶」；教師 A 提交星期四特別活動 | 可提交；原因「封鎖日期：校慶」；一般課堂該日仍不可申請 |
| S10 | 星期日兼封鎖 | 封鎖星期日 + 提交特別活動 | 前端雙重警告；原因「星期日；封鎖日期：…」 |
| S11 | 一般核准誤按 | 管理員對 S7 申請直接按核准 | 出現第二次確認對話框列出原因；未確認不送出；直接 POST 不帶 confirmSpecial → `VALIDATION_ERROR` |
| S12 | 特別批准 | 管理員確認後核准 | 已核准；操作紀錄有「特別批准」含批准人、時間、原因 |
| S13 | 過去活動 | 上週的特別活動 | 週表上週該格不顯示活動；「我的申請／借用紀錄」可搜尋到 |
| S14 | 逾時 | 特別活動 14:00–16:00 已領取未歸還 | 16:30 後排程標示逾時未歸還（以自訂結束時間計） |
| S15 | 舊資料相容 | 現有 v2.1 特別活動列（ACT） | 週表正確扣減、我的申請正確顯示 |
