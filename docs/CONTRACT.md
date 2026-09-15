# 前後端共用合約（CONTRACT）

本文件是前端（GitHub Pages）與後端（Apps Script）唯一的介面依據。兩邊實作必須逐字遵守此處的名稱、格式與規則。所有使用者可見文字一律繁體中文。

---

## 1. 傳輸層

### 1.1 端點
- 後端 URL：`https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec`（前端由 `js/config.js` 的 `API_URL` 讀取）。
- 前端 `fetch` 必須：`redirect: 'follow'`、`credentials: 'omit'`、不可 `mode: 'no-cors'`、不可加自訂 header。

### 1.2 GET（只讀、無狀態變更）
- 只允許 `GET <API_URL>?action=health`。
- 任何其他 action 以 GET 呼叫 → `METHOD_NOT_ALLOWED`。
- health 回應 `data`：`{ "status": "ok", "schemaVersion": <number>, "version": "<string>" }`，不含任何預約資料。

### 1.3 POST（所有需要身分的讀取及全部寫入）
- `Content-Type: text/plain;charset=UTF-8`（simple request，避免 preflight）。
- Body 為 JSON 字串：

```json
{
  "action": "getWeekData",
  "idToken": "<Google ID token JWT>",
  "payload": { },
  "clientRequestId": "<前端產生的 UUID，選填，用於冪等與追蹤>"
}
```
- ID token 只可放在 body，永不放 query string。

### 1.4 回應 envelope（所有回應皆 HTTP 200，成敗看 `ok`）
成功：
```json
{ "ok": true, "data": { }, "error": null, "requestId": "req_xxxxxxxx", "serverTime": "2026-09-15T03:42:10.000Z" }
```
失敗：
```json
{ "ok": false, "data": null, "error": { "code": "VALIDATION_ERROR", "message": "繁體中文安全訊息", "details": null }, "requestId": "req_xxxxxxxx", "serverTime": "2026-09-15T03:42:10.000Z" }
```
- `details` 只在 `VALIDATION_ERROR` 時可為 `{ "field": "<欄位名>" }`，其他時候為 `null`。絕不含 stack trace。
- `serverTime` 為 ISO-8601 UTC。

### 1.5 錯誤碼（後端只可回傳此清單）

| code | 意義 | 前端處理 |
|---|---|---|
| `AUTH_REQUIRED` | 沒有 idToken | 顯示登入畫面 |
| `INVALID_TOKEN` | 簽章、格式錯誤或被篡改 | 清除登入狀態，要求重新登入 |
| `TOKEN_EXPIRED` | exp 已過 | 靜默續期一次後重送；失敗則要求重新登入 |
| `INVALID_AUDIENCE` | aud 不符 | 顯示「登入設定錯誤」 |
| `INVALID_ISSUER` | iss 不是 Google | 同 INVALID_TOKEN |
| `EMAIL_NOT_VERIFIED` | email_verified 非 true | 顯示訊息 |
| `FORBIDDEN_DOMAIN` | hd ≠ 允許網域 | 顯示「只限 blcwc.edu.hk 帳戶」並登出 |
| `FORBIDDEN_ROLE` | 角色不足 | 顯示訊息 |
| `UNKNOWN_ACTION` | action 不在白名單 | 顯示一般錯誤 |
| `METHOD_NOT_ALLOWED` | GET 呼叫非 health | 顯示一般錯誤 |
| `VALIDATION_ERROR` | 輸入不合法 | 於表單對應欄位顯示 message |
| `CONFLICT_INSUFFICIENT_STOCK` | 庫存不足（含被搶先） | 顯示 message，重新載入該週 |
| `SLOT_BLOCKED` | 封鎖日／時段 | 顯示 message，重新載入該週 |
| `SLOT_PAST` | 時段已過或已超過截止 | 顯示 message |
| `NOT_FOUND` | 申請編號不存在 | 顯示 message，重新載入清單 |
| `INVALID_STATE_TRANSITION` | 狀態機不允許 | 顯示 message，重新載入 |
| `LOCK_TIMEOUT` | 取鎖逾時 | 顯示「系統忙碌，請稍後再試」，提供重試 |
| `INTERNAL_ERROR` | 未預期錯誤 | 顯示一般錯誤及 requestId |

`message` 範例：`CONFLICT_INSUFFICIENT_STOCK` → 「2026-09-17 第 8 節 iPad 只剩 12 部，未能提供 15 部，請調整數量或改選其他時段。」

---

## 2. 身分與角色

### 2.1 Token 驗證（後端 Auth.gs）
必須全部通過：JWT 三段格式正確、`alg=RS256`、以 `kid` 對應 Google JWK（`https://www.googleapis.com/oauth2/v3/certs`，依回應 `Cache-Control max-age` 快取於 CacheService）驗證 RSASSA-PKCS1-v1_5 簽章、`aud === OAUTH_CLIENT_ID`、`iss ∈ {"accounts.google.com","https://accounts.google.com"}`、`exp > now`（容許 30 秒時鐘偏差）、`email_verified === true`、`hd === ALLOWED_HD`（嚴格相等，小寫比較）。
- 驗證成功結果以 `sha256(token)` 為 key 快取，TTL = `min(exp - now, 300)` 秒。
- 使用者 email 一律取自 token 並轉小寫；payload 內任何 `email` 欄位一律忽略。

### 2.2 角色代碼（API 使用英文代碼，工作表使用中文字串）

| API 代碼 | 人員設定「角色」欄接受的字串 | 權限 |
|---|---|---|
| `teacher` | （不需列於人員設定；任何通過驗證的網域帳戶皆是） | 週表、提交、我的申請、取消自己的申請 |
| `admin` | `管理員`、`審批員` | teacher ＋ 待審清單、核准、拒絕 |
| `handler` | `設備室經手人`、`借還處理員`、`處理員` | teacher ＋ 交收清單、登記領取、歸還 |

- 人員設定「啟用狀態」欄接受 `TRUE`/`true`/`是`/`1` 為啟用，其他為停用。
- 一人可有多列，roles 陣列去重，永遠包含 `teacher`。

---

## 3. 資料層（Google 試算表）

工作表名稱（不可改）：`申請主表`、`時段明細`、`交收紀錄`、`時段設定`、`系統設定`、`人員設定`、`封鎖日期`、`操作紀錄`。第 1 列為標題列並凍結。

所有日期存為字串 `YYYY-MM-DD`；時刻存為字串 `HH:mm`（讀取時要容忍 `9:10`、Date 物件、`08:00:00`，一律正規化為 `HH:mm`）；時間戳存為 `YYYY-MM-DD HH:mm:ss`（Asia/Hong_Kong）。寫入試算表時，任何自由文字若以 `=`、`+`、`-`、`@` 開頭，前面加一個 `'`；讀出時若首字為 `'` 且原欄為自由文字則去除。

### 3.1 申請主表（欄 A–Y）
| # | 欄名 | 型別／值 |
|---|---|---|
| 0 | 預約編號 | `BK-YYYY-NNNN`（年份＋4 位流水，同年遞增，於鎖內產生） |
| 1 | 教師電郵 | 已驗證 email（小寫） |
| 2 | 教師姓名 | 1–50 字 |
| 3 | 班別 | 1–20 字 |
| 4 | 學生人數 | 整數 1–60 |
| 5 | 科目 | 1–50 字 |
| 6 | 備註 | 0–500 字 |
| 7 | 狀態 | 見 §4 |
| 8 | 建立時間 | 時間戳 |
| 9 | 最後更新時間 | 時間戳 |
| 10 | 審批人 | email 或空 |
| 11 | 審批時間 | 時間戳或空 |
| 12 | 預約類型 | `一般課堂` 或 `特別活動`（見 §9） |
| 13 | 活動名稱 | 特別活動 1–100 字；一般課堂留空 |
| 14 | 自訂開始時間 | 特別活動 `HH:mm`；一般課堂留空 |
| 15 | 自訂結束時間 | 特別活動 `HH:mm`；一般課堂留空 |
| 16 | 17:15後保管確認 | `是`／`否`（特別活動結束時間遲於 afterHoursTime 時必須為 `是`） |
| 17 | 48小時內通知Molly確認 | 舊欄位，新版一律寫 `否`（保留相容） |
| 18 | 需特別批准 | `是`／`否`：特別活動落在星期日或封鎖日期／時段時為 `是` |
| 19 | 特別批准原因 | 需特別批准的原因文字，例 `星期日`、`封鎖日期：校慶`、`星期日；封鎖日期：校慶` |
| 20 | 拒絕／取消原因 | migration v3 新增；0–200 字 |
| 21 | 未還 iPad 數量 | migration v3 新增；整數 |
| 22 | 未還 Pencil 數量 | migration v3 新增；整數 |
| 23 | 異常備註 | migration v3 新增；0–500 字 |
| 24 | 通知旗標 | migration v3 新增；JSON 字串，例 `{"remind24h":true,"overduePickup":true,"overdueReturn":true,"expired":true}` |

### 3.2 時段明細（欄 A–G）
| # | 欄名 | 值 |
|---|---|---|
| 0 | 預約編號 | 對應主表 |
| 1 | 日期 | `YYYY-MM-DD` |
| 2 | 時段代號 | 對應時段設定；特別活動固定為 `ACT`（不在時段設定內） |
| 3 | 開始時間 | `HH:mm` |
| 4 | 結束時間 | `HH:mm` |
| 5 | iPad 數量 | 整數 |
| 6 | Apple Pencil 數量 | 整數 |

同一申請的多個時段各佔一列，數量相同。

### 3.3 交收紀錄（欄 A–H）
| # | 欄名 | 值 |
|---|---|---|
| 0 | 紀錄編號 | `HO-XXXXXXXX`（8 位大寫十六進位） |
| 1 | 預約編號 | |
| 2 | 類型 | `領取`、`部分歸還`、`完全歸還` |
| 3 | 時間 | 時間戳 |
| 4 | iPad 數量 | 本次數量 |
| 5 | Apple Pencil 數量 | 本次數量 |
| 6 | 經手人 | 已驗證 email |
| 7 | 異常備註 | 0–500 字 |

### 3.4 時段設定（欄 A–G）
| # | 欄名 | 值 |
|---|---|---|
| 0 | 時段代號 | 例 `P01`…`P09`、`AFTER` |
| 1 | 開始時間 | `HH:mm` |
| 2 | 結束時間 | `HH:mm` |
| 3 | 標籤 | 例 `第 1 節`、`放學時段` |
| 4 | 適用星期 | 支援 `MON-SAT`、`MON-FRI`、`MON,WED,FRI`、`SAT`（大小寫不拘） |
| 5 | 顯示次序 | 整數 |
| 6 | 啟用狀態 | `true`/`TRUE`/`是` |

現有資料：P01 08:35–09:10、P02 09:10–09:45、P03 09:45–10:20、P04 10:35–11:10、P05 11:10–11:45、P06 12:00–12:35、P07 12:35–13:10、P08 14:25–15:00、P09 15:00–15:35、AFTER 15:35–17:15，全部 MON-SAT。
前端在相鄰時段之間若有 ≥ 10 分鐘空隙，自動插入一列不可預約的分隔列（標籤：10:20–10:35「小息」、11:45–12:00「小息」、13:10–14:25「午膳」；其他空隙標籤「休息」）。分隔列由前端依時間差計算，不存於工作表。

### 3.5 系統設定（欄 A–B：項目、數值）
| 項目 | 預設 | 說明 |
|---|---|---|
| `iPad 總數` | 90 | |
| `Apple Pencil 總數` | 90 | |
| `獲准網域` | blcwc.edu.hk | 顯示用；驗證以 Script Properties `ALLOWED_HD` 為準，兩者不一致時後端 health 回傳 `configWarning` |
| `提前日數` | 30 | 可預約至今天起 N 天內 |
| `截止時數` | 0 | 時段開始前 N 小時停止申請 |
| `提醒時數` | 24 | 待審逾 N 小時提醒審批人 |
| `時區` | Asia/Hong_Kong | |
| `學年` | 2026-2027 | |
| `班別選項` | 逗號清單 | |
| `科目選項` | 逗號清單 | |
| `schemaVersion` | 3 | migration v3 新增 |
| `逾時未領取分鐘` | 30 | migration v3 新增 |
| `逾時未歸還分鐘` | 30 | migration v3 新增 |
| `系統版本` | 由程式寫入 | migration v3 新增 |
| `特別活動最遲時間` | 17:15 | migration v3 新增；結束時間遲於此值須保管確認 |
| `特別活動最早開始` | 07:00 | migration v3 新增 |
| `特別活動最遲結束` | 22:00 | migration v3 新增 |

### 3.6 人員設定（欄 A–C）：電郵、角色、啟用狀態（見 §2.2）

### 3.7 封鎖日期（欄 A–E）
| # | 欄名 | 值 |
|---|---|---|
| 0 | 日期 | `YYYY-MM-DD` |
| 1 | 時段代號或全日 | `全日` 或逗號分隔時段代號 `P01,P02` |
| 2 | 原因 | 文字 |
| 3 | 設定者 | email |
| 4 | 設定時間 | 時間戳 |

### 3.8 操作紀錄（欄 A–J）
| # | 欄名 | 值 |
|---|---|---|
| 0 | 時間 | 時間戳 |
| 1 | 操作者 | email 或 `system` |
| 2 | 動作 | 見下表 |
| 3 | 預約編號 | 或空 |
| 4 | 原資料 | JSON 字串 |
| 5 | 新資料 | JSON 字串 |
| 6 | 角色 | migration v3 新增；`teacher,admin` 或 `system` |
| 7 | 結果 | migration v3 新增；`成功` 或 `失敗:<code>` |
| 8 | 請求編號 | migration v3 新增；requestId |
| 9 | 備註 | migration v3 新增 |

動作字串：`提交申請`、`提交特別活動`、`特別批准`、`取消申請`、`核准申請`、`拒絕申請`、`登記領取`、`部分歸還`、`完全歸還`、`自動過期`、`逾時未領取`、`逾時未歸還`、`待審提醒`、`執行 migration`、`系統初始化`、`拒絕存取`（只記錄 FORBIDDEN_ROLE，不記錄每次 token 失敗）。

### 3.9 Migration 與初始化
- `setupSystem()`：若 Script Properties 無 `SPREADSHEET_ID`，建立新試算表及 8 個工作表（完整 v3 欄位＋預設設定＋ AFTER/P01–P09 時段），寫入 `SPREADSHEET_ID`，安裝 `processScheduledTasks` 每 15 分鐘觸發器（先移除同名舊觸發器）。若已有 `SPREADSHEET_ID`，只確保觸發器存在並呼叫 `migrateSystem()`。可重複執行。
- `migrateSystem()`：讀取 `系統設定.schemaVersion`（缺少視為 2），逐版本升級：v2→v3 先 `DriveApp.getFileById(id).makeCopy('ipad-backup-<timestamp>')`，再只在欄位不存在時於最後一欄之後追加標題，新增系統設定列，最後寫 `schemaVersion=3` 及操作紀錄 `執行 migration`。永不刪除、重命名或搬動欄位。

---

## 4. 狀態機

狀態字串（後端 `STATUS` 常數，前端同名對照）：
`待審批`、`已核准`、`已拒絕`、`已取消`、`已領取`、`未完全歸還`、`已歸還`、`逾時未領取`、`逾時未歸還`、`已過期`。

| 從 | 到 | 觸發 | 執行者 |
|---|---|---|---|
| — | 待審批 | submitApplication | teacher |
| 待審批 | 已核准 | approveApplication（重算庫存，不足則 CONFLICT） | admin |
| 待審批 | 已拒絕 | rejectApplication（原因必填 1–200 字） | admin |
| 待審批／已核准 | 已取消 | cancelMyApplication（只限申請人本人；第一個時段開始前） | owner |
| 待審批 | 已過期 | 排程：第一個時段開始時間已過 | system |
| 已核准 | 已領取 | recordPickup | handler |
| 已核准 | 逾時未領取 | 排程：第一個時段開始 + 逾時未領取分鐘 | system |
| 逾時未領取 | 已領取 | recordPickup（補登） | handler |
| 已領取／未完全歸還／逾時未歸還 | 未完全歸還 | recordReturn（歸還後仍有未還） | handler |
| 已領取／未完全歸還／逾時未歸還 | 已歸還 | recordReturn（未還 iPad 與 Pencil 皆為 0） | handler |
| 已領取／未完全歸還 | 逾時未歸還 | 排程：最後一個時段結束 + 逾時未歸還分鐘，且仍有未還 | system |

終態：`已拒絕`、`已取消`、`已歸還`、`已過期`。

庫存計算：
- `approvedLike` 狀態集合 = {已核准, 已領取, 未完全歸還, 逾時未領取, 逾時未歸還}
- `pending` = {待審批}
- 每格 `ipadApproved = Σ approvedLike 明細 iPad`、`ipadPending = Σ pending 明細 iPad`、`ipadRemaining = max(0, total − approved − pending)`；Pencil 同理。
- 舊資料 `ACT` 等非標準時段代號：以其開始／結束時間與每個標準時段的區間重疊（`start < slotEnd && end > slotStart`）計入該時段。
- 提交／核准的硬性檢查：對每個申請時段，`requested ≤ total − approved − pending(不含本申請)`，iPad 與 Pencil 分別檢查。

---

## 5. API actions

所有 POST action 均需通過 token 驗證（health 除外）。`payload` 欄位型別不符或缺少 → `VALIDATION_ERROR`。

### 5.1 共用資料形狀

```ts
User = { email: string, roles: ("teacher"|"admin"|"handler")[], displayName: string /* 取自最近一筆申請的教師姓名，否則 email @ 前部分 */ }

Settings = { ipadTotal: number, pencilTotal: number, advanceDays: number, cutoffHours: number,
             classOptions: string[], subjectOptions: string[], timezone: string, schoolYear: string,
             schemaVersion: number, overduePickupMinutes: number, overdueReturnMinutes: number }

Slot = { slotId: string, start: "HH:mm", end: "HH:mm", label: string, days: ("MON"|"TUE"|"WED"|"THU"|"FRI"|"SAT"|"SUN")[], order: number }
       // 只回傳啟用的時段，依 order 排序

BookingSummary = { applicationId: string, teacherName: string, className: string, subject: string,
                   ipad: number, pencil: number, status: string, isMine: boolean }

Cell = { date: "YYYY-MM-DD", slotId: string,
         ipadApproved: number, ipadPending: number, ipadRemaining: number,
         pencilApproved: number, pencilPending: number, pencilRemaining: number,
         bookable: boolean, unbookableReason: "past"|"blocked"|"cutoff"|"beyondAdvance"|"notApplicable"|null,
         blockedReason: string|null,
         bookings: BookingSummary[] /* 最多 3 筆 */, bookingCount: number }

Day = { date: "YYYY-MM-DD", weekday: "MON"|..., isToday: boolean, isPast: boolean,
        blockedAllDay: boolean, blockedReason: string|null }

Week = { weekStart: "YYYY-MM-DD" /* 星期一 */, weekEnd: "YYYY-MM-DD" /* 星期日 */,
         days: Day[] /* 7 筆 MON–SUN；一般課堂格只為 MON–SAT 產生 */,
         cells: { [key: `${date}|${slotId}`]: Cell },
         special: { [date: string]: SpecialCell } /* 7 天，見 §9 */ }

SlotLine = { date: string, slotId: string, label: string, start: string, end: string, ipad: number, pencil: number }

Handover = { recordId: string, type: "領取"|"部分歸還"|"完全歸還", time: string, ipad: number, pencil: number, handler: string, note: string }

Application = { applicationId: string, teacherEmail: string, teacherName: string, className: string,
                students: number, subject: string, remark: string, status: string,
                createdAt: string, updatedAt: string, approvedBy: string, approvedAt: string,
                bookingType: string, activityName: string, customStart: string, customEnd: string,
                reason: string, ipadOutstanding: number, pencilOutstanding: number, abnormalNote: string,
                date: string /* 第一個時段日期 */, ipad: number, pencil: number /* 每時段數量 */,
                afterHoursConfirm: boolean, needsSpecialApproval: boolean, specialApprovalReason: string,
                isSunday: boolean, blockedReason: string /* 特別活動所在日期／時段的封鎖原因，無則空字串 */,
                slots: SlotLine[], handovers: Handover[],
                canCancel: boolean /* 後端依規則計算，供前端顯示按鈕 */ }
```
`teacherEmail` 只在呼叫者為 owner、admin 或 handler 時回傳完整值；其他情況（週表 BookingSummary）不含 email。

### 5.2 Action 清單

| action | 角色 | payload | data |
|---|---|---|---|
| `health` (GET) | 公開 | — | `{status, schemaVersion, version, configWarning?: string}` |
| `whoami` | 已驗證 | `{}` | `{user: User}` |
| `bootstrap` | 已驗證 | `{date?: "YYYY-MM-DD"}` | `{user, settings, slots, week, today: "YYYY-MM-DD", serverNow: "YYYY-MM-DD HH:mm:ss"}` |
| `getWeekData` | 已驗證 | `{date: "YYYY-MM-DD"}` | `{week: Week}` |
| `submitSpecialActivity` | teacher | 見 §9.3 | `{application: Application}` |
| `getMyApplications` | 已驗證 | `{}` | `{applications: Application[]}`（本人，依建立時間新→舊） |
| `submitApplication` | teacher | `{date, slotIds: string[], teacherName, className, students, subject, ipad, pencil, remark}` | `{application: Application}` |
| `cancelMyApplication` | owner | `{applicationId, reason?: string}` | `{application}` |
| `getPendingApplications` | admin | `{}` | `{applications}`（狀態 待審批，依日期舊→新） |
| `approveApplication` | admin | `{applicationId, confirmSpecial?: boolean}` | `{application}`；申請 `needsSpecialApproval` 為 true 而 `confirmSpecial !== true` → `VALIDATION_ERROR`（field: confirmSpecial） |
| `rejectApplication` | admin | `{applicationId, reason}` | `{application}` |
| `getApprovedForHandover` | handler | `{date?: "YYYY-MM-DD"}` | `{applications}`（指定日期（預設今天）有時段且狀態 ∈ approvedLike 的申請，另加所有狀態為 未完全歸還／逾時未歸還 的申請，不論日期） |
| `recordPickup` | handler | `{applicationId, ipad, pencil, note?}` | `{application}` |
| `recordReturn` | handler | `{applicationId, ipad, pencil, note?}` | `{application}` |

### 5.3 submitApplication 驗證順序（後端；前端亦做同樣的即時檢查）
1. `date` 格式正確、在 `today` 至 `today + advanceDays` 內。
2. `slotIds` 非空、皆存在於啟用時段、皆適用該星期、依 `order` 排序後連續（order 相鄰）。
3. 每個時段開始時間 > now + cutoffHours（否則 `SLOT_PAST`）。
4. 日期不在封鎖（全日）且每個時段不在封鎖清單（否則 `SLOT_BLOCKED`）。
5. `teacherName` 1–50、`className` 1–20、`subject` 1–50、`remark` ≤ 500、`students` 整數 1–60。
6. `ipad` 整數 1–ipadTotal；`pencil` 整數 0–pencilTotal 且 `pencil ≤ ipad`。
7. 取 ScriptLock（`waitLock(10000)`，失敗 → `LOCK_TIMEOUT`）→ 重新讀取主表與明細 → 每時段檢查庫存（否則 `CONFLICT_INSUFFICIENT_STOCK`）→ 產生編號 → 先 append 明細列再 append 主表列 → 釋放鎖。
8. 鎖外：寫操作紀錄、寄通知（申請人＋所有啟用 admin）、清除週資料快取。

### 5.4 快取（後端）
- CacheService（script cache）鍵：`settings`、`slots`、`staff`、`blocks`（TTL 600 秒），寫入相關工作表後 `remove`。
- 週資料不快取於後端（每次讀主表＋明細各一次即可），但前端可快取。
- Token 驗證結果快取見 §2.1。

---

## 6. 通知（電郵，繁體中文）

主旨格式：`【iPad 預約】<事件> <預約編號> <日期> <班別>`。內文為純文字＋簡單 HTML，包含：預約編號、教師、日期、時段（標籤＋起訖）、班別、科目、iPad／Pencil 數量、狀態、原因（如適用）、操作連結 `FRONTEND_URL`（Script Property）。

| 事件 | 收件人 |
|---|---|
| 提交申請／提交特別活動 | 申請人；所有啟用 admin（特別活動主旨加「【需特別批准】」前綴當 needsSpecialApproval） |
| 核准／拒絕 | 申請人 |
| 取消 | 申請人；所有啟用 admin |
| 領取 | 申請人 |
| 部分歸還／完全歸還 | 申請人 |
| 待審提醒（提醒時數後仍待審） | 所有啟用 admin（每筆申請只提醒一次） |
| 逾時未領取 | 申請人；所有啟用 handler |
| 逾時未歸還 | 申請人；所有啟用 handler |
| 自動過期 | 申請人 |

冪等：排程事件寄出前檢查 `通知旗標` JSON 對應鍵，寄出後立即寫回旗標；狀態轉換本身以「目前狀態」為條件，重複執行不會再轉換。

---

## 7. 前端設定檔（`js/config.js`，可公開，無 secret）

```js
window.APP_CONFIG = {
  API_URL: "https://script.google.com/macros/s/REPLACE_WITH_DEPLOYMENT_ID/exec",
  GOOGLE_CLIENT_ID: "REPLACE_WITH_CLIENT_ID.apps.googleusercontent.com",
  ALLOWED_DOMAIN: "blcwc.edu.hk",
  SCHOOL_NAME: "香港正覺蓮社佛教梁植偉中學",
  APP_TITLE: "iPad 預約及借還系統",
  REQUEST_TIMEOUT_MS: 20000,
  WEEK_CACHE_TTL_MS: 60000
};
```
若 `API_URL` 或 `GOOGLE_CLIENT_ID` 仍含 `REPLACE_WITH`，前端顯示「系統尚未完成設定」而不呼叫 API。

---

## 8. Script Properties（後端，不進 GitHub）

| 鍵 | 說明 |
|---|---|
| `SPREADSHEET_ID` | 中央試算表 ID |
| `OAUTH_CLIENT_ID` | 與前端 `GOOGLE_CLIENT_ID` 相同 |
| `ALLOWED_HD` | `blcwc.edu.hk` |
| `FRONTEND_URL` | GitHub Pages 網址，用於電郵連結 |
| `ADMIN_EMAIL_FALLBACK` | 人員設定無啟用 admin 時的通知收件人 |

---

## 9. 特別活動（預約類型 = `特別活動`）

### 9.1 定義
- 一般課堂：只可選 P01–P09／AFTER 等時段設定內的時段，星期一至六，不可選星期日或封鎖日期／時段（規則見 §5.3）。
- 特別活動：自訂開始／結束時間（`HH:mm`，不受時段限制），可跨越多個正常時段；仍會計算及扣除同一時間範圍內的 iPad 與 Apple Pencil；**一律**進入 `待審批` 由管理員審批。
- 時段明細寫一列：時段代號 `ACT`、開始／結束為自訂時間。

### 9.2 日期權限（最終規則）

| 情況 | 一般教師 | 管理員 |
|---|---|---|
| 星期一至六（非封鎖） | 可提交一般課堂或特別活動 | 可提交及審批 |
| 星期日 | 只可提交特別活動，`需特別批准=是`，原因 `星期日` | 可特別批准 |
| 封鎖日期／時段（與活動時間重疊） | 只可提交特別活動，`需特別批准=是`，原因 `封鎖日期：<原因>` | 可特別批准 |
| 星期日兼封鎖 | 可提交，原因 `星期日；封鎖日期：<原因>`，前端標示雙重警告 | 可特別批准 |

管理員核准 `needsSpecialApproval=true` 的申請時必須帶 `confirmSpecial: true`（前端以獨立確認對話框再次確認，並列出星期日／封鎖原因）；後端寫操作紀錄動作 `特別批准`，新資料含 `{approver, approvedAt, reason}`。

### 9.3 `submitSpecialActivity` payload 與驗證順序
```ts
{ date: "YYYY-MM-DD", activityName: string, customStart: "HH:mm", customEnd: "HH:mm",
  teacherName: string, className: string /* 參與班別／組別 */, students: number,
  ipad: number, pencil: number, remark: string, afterHoursConfirm: boolean }
```
1. `date` 格式正確、在 `today` 至 `today + advanceDays` 內（星期日允許）。
2. `customStart`、`customEnd` 為 `HH:mm`；`customStart < customEnd`；`customStart ≥ 特別活動最早開始`；`customEnd ≤ 特別活動最遲結束`。
3. `date customStart` > now + cutoffHours（否則 `SLOT_PAST`）。
4. `activityName` 1–100、`teacherName` 1–50、`className` 1–50、`students` 1–200、`remark` ≤ 500。
5. `ipad` 1–ipadTotal、`pencil` 0–pencilTotal、`pencil ≤ ipad`。
6. 若 `customEnd > afterHoursTime`（系統設定 `特別活動最遲時間`，預設 17:15）：`afterHoursConfirm` 必須為 `true` 且 `remark` 非空（否則 `VALIDATION_ERROR`，field 分別為 `afterHoursConfirm`／`remark`）。主表第 16 欄寫 `是`；否則寫 `否`。
7. 計算 `needsSpecialApproval`：星期日 → 加原因 `星期日`；封鎖全日或封鎖時段與 `[customStart, customEnd)` 重疊 → 加原因 `封鎖日期：<原因>`；多個以 `；` 連接。第 18／19 欄據此寫入。**不**回傳 `SLOT_BLOCKED`。
8. 取 ScriptLock → 重新讀取 → 以區間尖峰法檢查庫存（§9.4）→ 產生編號 → append 明細（`ACT`）與主表（科目欄寫 `特別活動`）→ 釋放鎖。
9. 鎖外：操作紀錄 `提交特別活動`、通知、清快取。

### 9.4 庫存計算：區間尖峰法（一般課堂與特別活動共用）
- 同一日期內每筆 approvedLike 或 pending 的明細都是一個使用區間：一般課堂為時段起訖，`ACT` 為自訂起訖。
- `peakUsage_(date, start, end, excludeApplicationId)`：收集所有與 `[start,end)` 重疊的區間，取所有邊界點，計算每個子區間的 iPad／Pencil 使用總和，回傳最大值。
- 提交／核准檢查：`requested ≤ total − peakUsage`（iPad、Pencil 分別）。一般課堂對每個所選時段各算一次；特別活動對 `[customStart, customEnd)` 算一次。
- 週表 Cell 統計：`ipadApproved`／`ipadPending` 為與該時段區間重疊的所有明細（含 `ACT`）數量總和；`ipadRemaining = max(0, total − approved − pending)`。這與尖峰法在單一時段內結果一致。

### 9.5 週表顯示
- `Week.days` 有 7 天（MON–SUN）。一般課堂格只為 MON–SAT 產生；前端第七欄（星期日）在一般時段列顯示「星期日不設一般課堂預約」灰格。
- 時段列底部加一列「特別活動」，每天一格 `SpecialCell`：
```ts
SpecialActivitySummary = { applicationId, activityName, start: "HH:mm", end: "HH:mm", teacherName, className,
                           ipad, pencil, status, needsSpecialApproval: boolean, afterHoursConfirm: boolean, isMine: boolean }
SpecialCell = { date, activities: SpecialActivitySummary[] /* 最多 3 筆 */, activityCount: number,
                bookable: boolean /* 日期未過且在提前日數內 */, isSunday: boolean, blockedReason: string|null,
                warnings: ("sunday"|"blocked")[] }
```
- 特別活動格顯示活動名稱及實際時間，例「領袖訓練 14:00–18:30」，`needsSpecialApproval` 顯示「需特別批准」徽章，`afterHoursConfirm` 顯示「17:15 後自行保管」徽章。
- 過去日期的 `SpecialCell.activities` 回傳空陣列（`activityCount` 仍為實際數）；過去活動只能在「我的申請／借用紀錄」查看（前端提供關鍵字與日期範圍篩選，資料來自 `getMyApplications`；admin／handler 另可用 `searchApplications`）。
- 點擊特別活動格開啟特別活動表單，日期預填；星期日或封鎖日顯示醒目警告「此日期需要管理員特別批准」（兩者皆有時顯示雙重警告）。

### 9.6 `searchApplications`（admin、handler）
payload `{ query?: string /* 編號、姓名、班別、活動名稱模糊比對 */, from?: "YYYY-MM-DD", to?: "YYYY-MM-DD", bookingType?: "一般課堂"|"特別活動", status?: string }` → `{applications: Application[]}`（最多 200 筆，日期新→舊）。

### 9.7 審批畫面與電郵
- 審批卡片顯示：類型徽章、活動名稱、實際時間、需特別批准原因（醒目警告色）、17:15 後保管確認文字。
- 保管確認文字（前端表單、審批卡片、電郵三處一字不改）：
  「本人明白須自行保管 iPad 及 Apple Pencil，並於下一個上課天交到圖書館給 Molly。」
- 電郵：特別活動所有通知皆含活動名稱、實際時間；`afterHoursConfirm` 為 true 時附上上述確認文字；`needsSpecialApproval` 為 true 時主旨加前綴「【需特別批准】」並在內文列出原因。
- 逾時未歸還判定：特別活動以 `customEnd` 為結束時間；逾時未領取以 `customStart`。

### 9.8 取消與交收
- 特別活動的取消、領取、部分歸還、完全歸還規則與一般課堂相同。
