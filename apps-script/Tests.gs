// Tests.gs — 內建測試：純函式單元測試、JWT 驗證拒絕、併發庫存、特別活動、排程冪等、migration、getWeekData 效能；不寄真郵件（MAIL_SINK_）。

/** 測試用固定時間：2026-09-15（二）08:00 香港時間。 */
var TEST_NOW_ISO_ = '2026-09-15T00:00:00Z';
var TEST_HD_ = 'test.example';
var TEST_TEACHER_EMAIL_ = 'teacher.one@' + TEST_HD_;
var TEST_ADMIN_EMAIL_ = 'admin.one@' + TEST_HD_;
var TEST_HANDLER_EMAIL_ = 'handler.one@' + TEST_HD_;

/** 由 Node（local-tests/gen-vectors.js）產生的 RS256 測試向量：公開金鑰 JWK 與各種 token。 */
var AUTH_TEST_VECTORS_ = {
  "jwk": {
    "kid": "test-kid-embedded",
    "use": "sig",
    "alg": "RS256",
    "kty": "RSA",
    "n": "u6xt3Lf1qGgI_MghBGtY6KHZCE8OvH769Q8hdJjtb9jOT3KXzRvP0BgnpeRbPl6QCTFGWdLF-1rVfSZMj5bgXc66bxSQ92yYCoIKacAxSa50ivJKGBuVcITUBBNiDmrxmZ6vjXRQTou0NbMNR5Gebs-tzREib-pFPmYmC-hQtsGK5mDKv7DO2hF9c0q3orhiMGKf4QYMIo7ZbQNgBkeLIkSchRpcu82AGxbdSPbBk-gseNHvMzSQs9iITvEJMs0HnBxQBq01WUy7kTSnmdtRaRVzjZ12aLNySOIJHipls-r3LiKYf1rM8r6Ghl0doozB7aqYL4JeKmbpcyv7MpLAEw",
    "e": "AQAB"
  },
  "clientId": "test-client-id",
  "hd": "test.example",
  "nowSec": 1789444800,
  "expectedEmail": "teacher.one@test.example",
  "tokens": {
    "valid": "eyJhbGciOiJSUzI1NiIsImtpZCI6InRlc3Qta2lkLWVtYmVkZGVkIiwidHlwIjoiSldUIn0.eyJpc3MiOiJodHRwczovL2FjY291bnRzLmdvb2dsZS5jb20iLCJhenAiOiJ0ZXN0LWNsaWVudC1pZCIsImF1ZCI6InRlc3QtY2xpZW50LWlkIiwic3ViIjoiMTIzNDU2Nzg5MCIsImhkIjoidGVzdC5leGFtcGxlIiwiZW1haWwiOiJUZWFjaGVyLk9uZUB0ZXN0LmV4YW1wbGUiLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwibmFtZSI6Iua4rOippuaVmeW4qyIsImlhdCI6MTc4OTQ0NDc0MCwiZXhwIjoxNzg5NDQ4NDAwfQ.WGxaKP8ejISvUd8A91Nhdku2Dd1V9POq8aNp1du0-7sCLn6vWT-JtXwXKZ1haCEWBzurugyK_NkSikyJtPZvZ4jJWgk7VkGLyasIMN3nwkc0d5ft6PbggHBDoeNbUQQpwx1zlvMPwPFmEBwpscoQwbuqPUcaYRVtwA9SJpfV9AZtvrfWrtoB4jje2ApTgH5D-ez6AW59_d2mIYav2DzKQqRRZPyxHIpRtPTrk6g_4e-fG4vpSO6V63tDHdwPdKvIHASsvbH3ED9-WVUBYmh9MTGsa4R6UNdFVdwXVeEEUy9pEa2cdkHch0QynxGe6kpAwvK6jUt86OO2iFa0pVgMvQ",
    "tampered": "eyJhbGciOiJSUzI1NiIsImtpZCI6InRlc3Qta2lkLWVtYmVkZGVkIiwidHlwIjoiSldUIn0.eyJpc3MiOiJodHRwczovL2FjY291bnRzLmdvb2dsZS5jb20iLCJhenAiOiJ0ZXN0LWNsaWVudC1pZCIsImF1ZCI6InRlc3QtY2xpZW50LWlkIiwic3ViIjoiMTIzNDU2Nzg5MCIsImhkIjoidGVzdC5leGFtcGxlIiwiZW1haWwiOiJhdHRhY2tlckB0ZXN0LmV4YW1wbGUiLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwibmFtZSI6Iua4rOippuaVmeW4qyIsImlhdCI6MTc4OTQ0NDc0MCwiZXhwIjoxNzg5NDQ4NDAwfQ.WGxaKP8ejISvUd8A91Nhdku2Dd1V9POq8aNp1du0-7sCLn6vWT-JtXwXKZ1haCEWBzurugyK_NkSikyJtPZvZ4jJWgk7VkGLyasIMN3nwkc0d5ft6PbggHBDoeNbUQQpwx1zlvMPwPFmEBwpscoQwbuqPUcaYRVtwA9SJpfV9AZtvrfWrtoB4jje2ApTgH5D-ez6AW59_d2mIYav2DzKQqRRZPyxHIpRtPTrk6g_4e-fG4vpSO6V63tDHdwPdKvIHASsvbH3ED9-WVUBYmh9MTGsa4R6UNdFVdwXVeEEUy9pEa2cdkHch0QynxGe6kpAwvK6jUt86OO2iFa0pVgMvQ",
    "wrongAud": "eyJhbGciOiJSUzI1NiIsImtpZCI6InRlc3Qta2lkLWVtYmVkZGVkIiwidHlwIjoiSldUIn0.eyJpc3MiOiJodHRwczovL2FjY291bnRzLmdvb2dsZS5jb20iLCJhenAiOiJvdGhlci1jbGllbnQiLCJhdWQiOiJvdGhlci1jbGllbnQiLCJzdWIiOiIxMjM0NTY3ODkwIiwiaGQiOiJ0ZXN0LmV4YW1wbGUiLCJlbWFpbCI6IlRlYWNoZXIuT25lQHRlc3QuZXhhbXBsZSIsImVtYWlsX3ZlcmlmaWVkIjp0cnVlLCJuYW1lIjoi5ris6Kmm5pWZ5birIiwiaWF0IjoxNzg5NDQ0NzQwLCJleHAiOjE3ODk0NDg0MDB9.lYAk4o3uaFOs5DOUB1r8EkKdgHYukPrx3G7LvZcvw_md_wymyzF-k_Or_BZBt7_BQlhgxvuGLwg1iZAbUjC4RN1qE8SCwFLT3XFQ6MXx1Suef9tqVJlrfiL_BH_NlZEG2B7HaMtjlIUXuXpGLf-F8AEJ-4yHoNGhyoZHbQL3kPcMByPERtX8yEd-UIhN6l5HjXMowwYEGdV5ka1Wq1W6jgtQUWc1JjVPMffHtijy_OjwJEHdkCrcsR1oUBIBPVV_8gVovsjLhyzV3PHjOlgp7x9jbJZJM6W3KUJiotJR57YwVOvUhRnxX9ujVpCKXzYdtpvfRxgXL8MXZkW-swBAjQ",
    "wrongIss": "eyJhbGciOiJSUzI1NiIsImtpZCI6InRlc3Qta2lkLWVtYmVkZGVkIiwidHlwIjoiSldUIn0.eyJpc3MiOiJodHRwczovL2V2aWwuZXhhbXBsZSIsImF6cCI6InRlc3QtY2xpZW50LWlkIiwiYXVkIjoidGVzdC1jbGllbnQtaWQiLCJzdWIiOiIxMjM0NTY3ODkwIiwiaGQiOiJ0ZXN0LmV4YW1wbGUiLCJlbWFpbCI6IlRlYWNoZXIuT25lQHRlc3QuZXhhbXBsZSIsImVtYWlsX3ZlcmlmaWVkIjp0cnVlLCJuYW1lIjoi5ris6Kmm5pWZ5birIiwiaWF0IjoxNzg5NDQ0NzQwLCJleHAiOjE3ODk0NDg0MDB9.Gjsa8qLZE3d9fHRVlQ7AC2jPsSsc6AxokK3lXRuyihJZDzXDVXixLJ379aEbmcW2YFXmpd7Cw6wSD9ZSjNof3bgulMz-pg8IvUFAzRDRJSTkeDZ7sICrQ00k3piYAhRDbJ9-xsybIYI-cTQoHDgGnR4-jhZgE-HulsPqL6pAK-L8dbxEwJYzetj0LYUgtNETO5JqyhdibnePF-eB42ZP1q3yZMhfzlgfPAdogKWr_tqj_RjhaWHi5R6QtKabP9YXhCOzqhNSaEtRBX48LM_gp_v5VBwzzlGKrr60LA00EAOIiX3nADuY0JerCCLV13EMYUlZ3X_KN2bkpV8QoWshew",
    "expired": "eyJhbGciOiJSUzI1NiIsImtpZCI6InRlc3Qta2lkLWVtYmVkZGVkIiwidHlwIjoiSldUIn0.eyJpc3MiOiJodHRwczovL2FjY291bnRzLmdvb2dsZS5jb20iLCJhenAiOiJ0ZXN0LWNsaWVudC1pZCIsImF1ZCI6InRlc3QtY2xpZW50LWlkIiwic3ViIjoiMTIzNDU2Nzg5MCIsImhkIjoidGVzdC5leGFtcGxlIiwiZW1haWwiOiJUZWFjaGVyLk9uZUB0ZXN0LmV4YW1wbGUiLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwibmFtZSI6Iua4rOippuaVmeW4qyIsImlhdCI6MTc4OTQzNzYwMCwiZXhwIjoxNzg5NDQxMjAwfQ.OC_AjtPM2g-KzSNjnhCgdx16TqnbXu1etdkT6S6-q2rlezUYMUbO-7mCz8zrOXSBn0xo37516HhPzRK31txPhCkoCYE-y3DZ4B1ChJ73KTWCyHgwXC7kzsx2p_XMcKGgcH_fZP5WNaPxFKGSJHs__bSHA6IDQA_CdAl-4BiskCuPXUltQby1AnnjebHbVFeRdDl_QxtIPCX5CrKaq8udqq-VMlv_wY1UIOC4ldQwSqLoi939H43QEfKUer_xaX5UchuFWuvx9p5VP4egKbfLF-EiqKC6v5uTNfLl-zbb6tzS5emApIgjVUOyawGdYzXDxi5LU0VBUCbUCPWr1iWpTQ",
    "wrongHd": "eyJhbGciOiJSUzI1NiIsImtpZCI6InRlc3Qta2lkLWVtYmVkZGVkIiwidHlwIjoiSldUIn0.eyJpc3MiOiJodHRwczovL2FjY291bnRzLmdvb2dsZS5jb20iLCJhenAiOiJ0ZXN0LWNsaWVudC1pZCIsImF1ZCI6InRlc3QtY2xpZW50LWlkIiwic3ViIjoiMTIzNDU2Nzg5MCIsImhkIjoib3RoZXIuZXhhbXBsZSIsImVtYWlsIjoic29tZW9uZUBvdGhlci5leGFtcGxlIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsIm5hbWUiOiLmuKzoqabmlZnluKsiLCJpYXQiOjE3ODk0NDQ3NDAsImV4cCI6MTc4OTQ0ODQwMH0.Ua6jFQqG3toQYWJcXaMw8XmUjqK9sUjvPcKUkjhw6yRgi7Xt5I12ZE_duQCRf6p7dBjvT2Qogbu2AfogjY1_iwI51dm_V9l2ivVVjnUPvc89ww8YHne9F8yWBFC6p43edHKSjtJiy55W45owH5aKR3fQ4MFCzK8ew3nkzrUaOwLENjv51JbVmiwZulLqsVCzZpkw9kWAulBfJZvXcl8LJkBi6mHrQ7XCBuN9kxRisYDKMIAZovgYB_iwDWbvLRDCIA1s5CNj3E3aMXmssZ3FVwkYdOx964P8eb__GZIvSxayOO13TRU94k_UoNd5JMAk-hg7XjPBKn-kR9RUcqQIKA",
    "notVerified": "eyJhbGciOiJSUzI1NiIsImtpZCI6InRlc3Qta2lkLWVtYmVkZGVkIiwidHlwIjoiSldUIn0.eyJpc3MiOiJodHRwczovL2FjY291bnRzLmdvb2dsZS5jb20iLCJhenAiOiJ0ZXN0LWNsaWVudC1pZCIsImF1ZCI6InRlc3QtY2xpZW50LWlkIiwic3ViIjoiMTIzNDU2Nzg5MCIsImhkIjoidGVzdC5leGFtcGxlIiwiZW1haWwiOiJUZWFjaGVyLk9uZUB0ZXN0LmV4YW1wbGUiLCJlbWFpbF92ZXJpZmllZCI6ZmFsc2UsIm5hbWUiOiLmuKzoqabmlZnluKsiLCJpYXQiOjE3ODk0NDQ3NDAsImV4cCI6MTc4OTQ0ODQwMH0.P5kA5eiXH80W0TY07trGl_gvS2Aqb1r1uyf96fCWyNh-xqRMJOt9VFaF7koeU_aza9RPBNP-lEQXwx--jfyHkyWAYx6hFx1Z3ZGrQpO57azN8N_jmfk_dGr1TcZ7VCJEpT76YPEkr7pkDPokqv4rr8vxfq1FOqC8Yiz_R8eKaJn3XFwQ_wvnRZFIPkGloqvsC1o5i8yiXgv7ZRw0F1tSBs3_l3ANggnJZuZ9umVvuU_IpNdOSJZL9uIuovumrFDwAM4-G5Rr7HnpOQv6BweWbLH9N1A77Mzk-zvmRggNQXq8lsFEiC0KS8S4kQ41Zk9M2cX98CJRBMquwEVvTYzg7g",
    "unknownKid": "eyJhbGciOiJSUzI1NiIsImtpZCI6InVua25vd24ta2lkIiwidHlwIjoiSldUIn0.eyJpc3MiOiJodHRwczovL2FjY291bnRzLmdvb2dsZS5jb20iLCJhenAiOiJ0ZXN0LWNsaWVudC1pZCIsImF1ZCI6InRlc3QtY2xpZW50LWlkIiwic3ViIjoiMTIzNDU2Nzg5MCIsImhkIjoidGVzdC5leGFtcGxlIiwiZW1haWwiOiJUZWFjaGVyLk9uZUB0ZXN0LmV4YW1wbGUiLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwibmFtZSI6Iua4rOippuaVmeW4qyIsImlhdCI6MTc4OTQ0NDc0MCwiZXhwIjoxNzg5NDQ4NDAwfQ.IEtzzzKJgZEOnZ003YEWfPKYIK8AgWx1MwVN3exLtA7NHV6E-QYnNn43t34wqjzACV4KMul66IJEAvRvj-6scFqqXCM2IUx4yP03BA8NNm5M91Yvg5B-VC6v0L-IMC6Bo_TOaJmgj_ViYdLtcOpY1XHQcNgeH7chbt587M0ZoIl2-0Q6pCAIR2_nRBhVzpBID3rUc8eBkFLRxh5fvxrDxXVnlHBv4P2HgLhr6kDjQnYI01PIiv77ykpXWxhIPKmXcXqmiAHWYxI9SSBRwJH_oNK2XGvIgtMAb9dE0ChUxtUTsu2M6Ah6_vfMCwMiwh79w9dXUS_iA5ptC0M52N8Xgw",
    "badAlg": "eyJhbGciOiJIUzI1NiIsImtpZCI6InRlc3Qta2lkLWVtYmVkZGVkIiwidHlwIjoiSldUIn0.eyJpc3MiOiJodHRwczovL2FjY291bnRzLmdvb2dsZS5jb20iLCJhenAiOiJ0ZXN0LWNsaWVudC1pZCIsImF1ZCI6InRlc3QtY2xpZW50LWlkIiwic3ViIjoiMTIzNDU2Nzg5MCIsImhkIjoidGVzdC5leGFtcGxlIiwiZW1haWwiOiJUZWFjaGVyLk9uZUB0ZXN0LmV4YW1wbGUiLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwibmFtZSI6Iua4rOippuaVmeW4qyIsImlhdCI6MTc4OTQ0NDc0MCwiZXhwIjoxNzg5NDQ4NDAwfQ.WGxaKP8ejISvUd8A91Nhdku2Dd1V9POq8aNp1du0-7sCLn6vWT-JtXwXKZ1haCEWBzurugyK_NkSikyJtPZvZ4jJWgk7VkGLyasIMN3nwkc0d5ft6PbggHBDoeNbUQQpwx1zlvMPwPFmEBwpscoQwbuqPUcaYRVtwA9SJpfV9AZtvrfWrtoB4jje2ApTgH5D-ez6AW59_d2mIYav2DzKQqRRZPyxHIpRtPTrk6g_4e-fG4vpSO6V63tDHdwPdKvIHASsvbH3ED9-WVUBYmh9MTGsa4R6UNdFVdwXVeEEUy9pEa2cdkHch0QynxGe6kpAwvK6jUt86OO2iFa0pVgMvQ",
    "malformed": "abc.def"
  }
};

var TestRunner_ = { results: [], current: '' };

/** 執行單一測試並記錄結果與耗時。 */
function test_(name, fn) {
  var start = Date.now();
  var record = { name: name, ok: true, error: '', ms: 0 };
  TestRunner_.current = name;
  try {
    fn();
  } catch (err) {
    record.ok = false;
    record.error = String(err && err.stack ? err.stack : err);
  }
  record.ms = Date.now() - start;
  TestRunner_.results.push(record);
  console.log((record.ok ? 'PASS ' : 'FAIL ') + name + ' (' + record.ms + 'ms)' + (record.ok ? '' : ' — ' + record.error));
  return record;
}

function assert_(cond, message) {
  if (!cond) throw new Error('斷言失敗：' + (message || ''));
}

function assertEqual_(actual, expected, message) {
  var a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error('斷言失敗：' + (message || '') + '｜預期 ' + e + '，實際 ' + a);
}

/** 期望 fn 拋出指定 code 的 ApiError_；回傳該錯誤以便進一步檢查。 */
function assertThrowsCode_(fn, code, message) {
  try {
    fn();
  } catch (err) {
    if (err && err.code === code) return err;
    throw new Error('斷言失敗：' + (message || '') + '｜預期錯誤碼 ' + code + '，實際 ' + (err && err.code ? err.code : String(err)));
  }
  throw new Error('斷言失敗：' + (message || '') + '｜預期拋出 ' + code + '，但沒有拋錯');
}

function makeCtx_(email, roles, displayName) {
  return { email: email, roles: roles, displayName: displayName || email.split('@')[0], requestId: 'test_' + Utilities.getUuid().slice(0, 8), clientRequestId: '' };
}

function teacherCtx_() { return makeCtx_(TEST_TEACHER_EMAIL_, [ROLES.TEACHER], '測試教師'); }
function adminCtx_() { return makeCtx_(TEST_ADMIN_EMAIL_, [ROLES.TEACHER, ROLES.ADMIN, ROLES.HANDLER], '測試管理員'); }
function handlerCtx_() { return makeCtx_(TEST_HANDLER_EMAIL_, [ROLES.TEACHER, ROLES.HANDLER], '測試經手人'); }

function clearAllCaches_() {
  cacheRemove_([CACHE_KEYS_.SETTINGS, CACHE_KEYS_.SLOTS, CACHE_KEYS_.STAFF, CACHE_KEYS_.BLOCKS, JWKS_CACHE_KEY_]);
  resetRequestMemo_();
}

/** 測試用 Script Properties 注入（不含任何真實憑證）。 */
function testProps_(extra) {
  var base = {};
  base[PROP_KEYS.OAUTH_CLIENT_ID] = AUTH_TEST_VECTORS_.clientId;
  base[PROP_KEYS.ALLOWED_HD] = TEST_HD_;
  base[PROP_KEYS.FRONTEND_URL] = 'https://frontend.test.example/';
  base[PROP_KEYS.ADMIN_EMAIL_FALLBACK] = 'fallback.admin@' + TEST_HD_;
  if (extra) for (var k in extra) base[k] = extra[k];
  return base;
}

/**
 * 在臨時測試試算表內執行 fn(spreadsheetId)；結束後移至垃圾桶並還原所有覆寫。
 * 人員設定：admin.one（管理員＋經手人）、handler.one（經手人）。
 */
function withTestSpreadsheet_(fn, options) {
  var opts = options || {};
  var savedOverride = SPREADSHEET_ID_OVERRIDE_;
  var savedProps = PROP_OVERRIDE_;
  var savedClock = Clock_.override;
  var savedSink = MAIL_SINK_;
  clearAllCaches_();
  var id = createFreshSpreadsheet_();
  var ss = SpreadsheetApp.openById(id);
  var staff = ss.getSheetByName(SHEET_NAMES.STAFF);
  var staffRows = [
    [TEST_ADMIN_EMAIL_, '管理員', 'TRUE'],
    [TEST_ADMIN_EMAIL_, '設備室經手人', 'TRUE'],
    [TEST_HANDLER_EMAIL_, '設備室經手人', 'TRUE']
  ];
  staff.getRange(2, 1, staffRows.length, 3).setValues(staffRows);
  if (opts.blocks && opts.blocks.length) {
    ss.getSheetByName(SHEET_NAMES.BLOCKS).getRange(2, 1, opts.blocks.length, 5).setValues(opts.blocks);
  }
  SPREADSHEET_ID_OVERRIDE_ = id;
  PROP_OVERRIDE_ = testProps_(opts.props);
  Clock_.override = new Date(opts.nowIso || TEST_NOW_ISO_);
  MAIL_SINK_ = [];
  clearAllCaches_();
  try {
    return fn(id, ss);
  } finally {
    try { DriveApp.getFileById(id).setTrashed(true); } catch (err) { console.error('無法刪除測試試算表 ' + id + ': ' + err); }
    SPREADSHEET_ID_OVERRIDE_ = savedOverride;
    PROP_OVERRIDE_ = savedProps;
    Clock_.override = savedClock;
    MAIL_SINK_ = savedSink;
    clearAllCaches_();
  }
}

/** 主入口：執行所有測試，回傳結果陣列並輸出摘要。 */
function runAllTests() {
  TestRunner_.results = [];
  var savedSink = MAIL_SINK_;
  MAIL_SINK_ = [];
  try {
    testPureFunctions_();
    testAuthRejections();
    testConcurrentBooking();
    testSpecialActivity();
    testHandoverFlow();
    testSchedulerIdempotent();
    testMigration();
    testRouterAndEnvelope();
    benchmarkGetWeekData();
  } finally {
    MAIL_SINK_ = savedSink;
    PROP_OVERRIDE_ = null;
    SPREADSHEET_ID_OVERRIDE_ = null;
    Clock_.override = null;
    JWKS_PROVIDER_OVERRIDE_ = null;
    clearAllCaches_();
  }
  var passed = TestRunner_.results.filter(function (r) { return r.ok; }).length;
  console.log('測試完成：' + passed + '/' + TestRunner_.results.length + ' 通過');
  return TestRunner_.results;
}

// ---------------------------------------------------------------------------
// 1. 純函式單元測試
// ---------------------------------------------------------------------------
function testPureFunctions_() {
  test_('normalizeTime_ 各種輸入', function () {
    assertEqual_(normalizeTime_('9:10'), '09:10', '9:10 → 09:10');
    assertEqual_(normalizeTime_('08:00:00'), '08:00', '含秒');
    assertEqual_(normalizeTime_(' 14:25 '), '14:25', '前後空白');
    assertEqual_(normalizeTime_(new Date('2026-09-15T06:25:00Z')), '14:25', 'Date → 香港時間');
    assertEqual_(normalizeTime_(0.5), '12:00', '試算表時間序號 0.5');
    assertEqual_(normalizeTime_('abc'), '', '無效字串');
    assertEqual_(normalizeTime_(''), '', '空字串');
  });
  test_('normalizeDate_ 各種輸入', function () {
    assertEqual_(normalizeDate_('2026-09-05'), '2026-09-05');
    assertEqual_(normalizeDate_('2026/9/5'), '2026-09-05', '斜線日期');
    assertEqual_(normalizeDate_(new Date('2026-09-15T16:30:00Z')), '2026-09-16', 'UTC 16:30 = 香港翌日 00:30');
    assertEqual_(normalizeDate_(''), '');
  });
  test_('parseDays_ 適用星期', function () {
    assertEqual_(parseDays_('MON-SAT'), ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']);
    assertEqual_(parseDays_('MON-FRI'), ['MON', 'TUE', 'WED', 'THU', 'FRI']);
    assertEqual_(parseDays_('mon,wed,fri'), ['MON', 'WED', 'FRI']);
    assertEqual_(parseDays_('SAT'), ['SAT']);
    assertEqual_(parseDays_('MON,SAT-SUN'), ['MON', 'SAT', 'SUN']);
    assertEqual_(parseDays_(''), ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], '空白預設 MON-SAT');
  });
  test_('weekStartOf_／weekdayOf_／addDays_', function () {
    assertEqual_(weekStartOf_('2026-09-15'), '2026-09-14', '週二 → 週一');
    assertEqual_(weekStartOf_('2026-09-20'), '2026-09-14', '週日屬同一週');
    assertEqual_(weekStartOf_('2026-09-14'), '2026-09-14', '週一本身');
    assertEqual_(weekdayOf_('2026-09-20'), 'SUN');
    assertEqual_(addDays_('2026-09-30', 1), '2026-10-01');
    assertEqual_(addDays_('2026-03-01', -1), '2026-02-28');
  });
  test_('resolveConsecutiveSlots_ 連續時段規則', function () {
    var slots = DEFAULT_SLOTS.map(function (r, i) {
      return { slotId: r[0], start: r[1], end: r[2], label: r[3], days: parseDays_(r[4]), order: r[5], enabled: true };
    });
    var ok = resolveConsecutiveSlots_(['P02', 'P01'], slots, '2026-09-16');
    assertEqual_(ok.map(function (s) { return s.slotId; }), ['P01', 'P02'], '排序後 P01,P02');
    var ok3 = resolveConsecutiveSlots_(['P08', 'P09', 'AFTER'], slots, '2026-09-16');
    assertEqual_(ok3.length, 3);
    var e1 = assertThrowsCode_(function () { resolveConsecutiveSlots_(['P01', 'P03'], slots, '2026-09-16'); }, ERROR_CODES.VALIDATION_ERROR, '不連續');
    assertEqual_(e1.details.field, 'slotIds');
    assertThrowsCode_(function () { resolveConsecutiveSlots_(['P99'], slots, '2026-09-16'); }, ERROR_CODES.VALIDATION_ERROR, '不存在');
    assertThrowsCode_(function () { resolveConsecutiveSlots_(['P01'], slots, '2026-09-20'); }, ERROR_CODES.VALIDATION_ERROR, '星期日不適用');
    var satOnly = slots.slice(0, 3).map(function (s) { return Object.assign({}, s, { days: ['SAT'] }); });
    assertThrowsCode_(function () { resolveConsecutiveSlots_(['P01'], satOnly, '2026-09-16'); }, ERROR_CODES.VALIDATION_ERROR, '週三不在 SAT');
  });
  test_('peakUsage_ 兩筆重疊 ACT 的區間尖峰', function () {
    var apps = [
      { applicationId: 'A1', status: STATUS.APPROVED, customStart: '14:00', customEnd: '16:00' },
      { applicationId: 'A2', status: STATUS.PENDING, customStart: '15:00', customEnd: '17:00' },
      { applicationId: 'A3', status: STATUS.CANCELLED, customStart: '14:00', customEnd: '17:00' }
    ];
    var detailsByApp = new Map();
    detailsByApp.set('A1', [{ applicationId: 'A1', date: '2026-09-17', slotId: 'ACT', start: '14:00', end: '16:00', ipad: 30, pencil: 5 }]);
    detailsByApp.set('A2', [{ applicationId: 'A2', date: '2026-09-17', slotId: 'ACT', start: '15:00', end: '17:00', ipad: 40, pencil: 10 }]);
    detailsByApp.set('A3', [{ applicationId: 'A3', date: '2026-09-17', slotId: 'ACT', start: '14:00', end: '17:00', ipad: 99, pencil: 99 }]);
    var intervals = buildIntervals_(apps, detailsByApp);
    assertEqual_(peakUsage_(intervals, '2026-09-17', '14:00', '17:00', ''), { ipad: 70, pencil: 15 }, '重疊時段 15:00–16:00 尖峰 70');
    assertEqual_(peakUsage_(intervals, '2026-09-17', '14:00', '15:00', ''), { ipad: 30, pencil: 5 }, '只與 A1 重疊');
    assertEqual_(peakUsage_(intervals, '2026-09-17', '16:00', '17:00', ''), { ipad: 40, pencil: 10 }, '只與 A2 重疊');
    assertEqual_(peakUsage_(intervals, '2026-09-17', '17:00', '18:00', ''), { ipad: 0, pencil: 0 }, '端點相接不算重疊');
    assertEqual_(peakUsage_(intervals, '2026-09-17', '14:00', '17:00', 'A1'), { ipad: 40, pencil: 10 }, '排除 A1');
    assertEqual_(peakUsage_(intervals, '2026-09-18', '14:00', '17:00', ''), { ipad: 0, pencil: 0 }, '另一日期');
  });
  test_('computeCellStats_ 一般時段與 ACT 重疊計數', function () {
    var slots = DEFAULT_SLOTS.map(function (r) {
      return { slotId: r[0], start: r[1], end: r[2], label: r[3], days: parseDays_(r[4]), order: r[5], enabled: true };
    });
    var apps = [
      { applicationId: 'R1', status: STATUS.APPROVED },
      { applicationId: 'R2', status: STATUS.PENDING },
      { applicationId: 'S1', status: STATUS.PENDING, customStart: '14:00', customEnd: '18:30' }
    ];
    var detailsByApp = new Map();
    detailsByApp.set('R1', [{ applicationId: 'R1', date: '2026-09-17', slotId: 'P08', start: '14:25', end: '15:00', ipad: 20, pencil: 0 }]);
    detailsByApp.set('R2', [{ applicationId: 'R2', date: '2026-09-17', slotId: 'P08', start: '14:25', end: '15:00', ipad: 10, pencil: 2 }]);
    detailsByApp.set('S1', [{ applicationId: 'S1', date: '2026-09-17', slotId: 'ACT', start: '14:00', end: '18:30', ipad: 50, pencil: 5 }]);
    var stats = computeCellStats_(apps, detailsByApp, slots, '');
    var p08 = stats.get('2026-09-17|P08');
    assertEqual_([p08.ipadApproved, p08.ipadPending, p08.pencilApproved, p08.pencilPending], [20, 60, 0, 7], 'P08 含 ACT 重疊');
    var p09 = stats.get('2026-09-17|P09');
    assertEqual_([p09.ipadApproved, p09.ipadPending], [0, 50], 'P09 只有 ACT');
    var after = stats.get('2026-09-17|AFTER');
    assertEqual_(after.ipadPending, 50, 'AFTER 亦與 ACT 重疊');
    assert_(!stats.get('2026-09-17|P07'), 'P07 無資料');
  });
  test_('狀態機白名單 canTransition_／assertTransition_', function () {
    assert_(canTransition_(STATUS.PENDING, STATUS.APPROVED));
    assert_(canTransition_(STATUS.PENDING, STATUS.EXPIRED));
    assert_(canTransition_(STATUS.APPROVED, STATUS.PICKED_UP));
    assert_(canTransition_(STATUS.OVERDUE_PICKUP, STATUS.PICKED_UP));
    assert_(canTransition_(STATUS.PARTIAL_RETURN, STATUS.PARTIAL_RETURN), '部分歸還可重複');
    assert_(canTransition_(STATUS.OVERDUE_RETURN, STATUS.RETURNED));
    assert_(!canTransition_(STATUS.APPROVED, STATUS.PENDING));
    assert_(!canTransition_(STATUS.RETURNED, STATUS.PICKED_UP));
    assert_(!canTransition_(STATUS.REJECTED, STATUS.APPROVED));
    assert_(!canTransition_(STATUS.PICKED_UP, STATUS.CANCELLED), '領取後不可取消');
    assertThrowsCode_(function () { assertTransition_(STATUS.CANCELLED, STATUS.APPROVED); }, ERROR_CODES.INVALID_STATE_TRANSITION);
  });
  test_('sanitizeCell_ 公式注入防護', function () {
    assertEqual_(sanitizeCell_('=SUM(A1:A9)'), "'=SUM(A1:A9)");
    assertEqual_(sanitizeCell_('+1+1'), "'+1+1");
    assertEqual_(sanitizeCell_('-cmd'), "'-cmd");
    assertEqual_(sanitizeCell_('@import'), "'@import");
    assertEqual_(sanitizeCell_('\t=x'), "'\t=x", 'tab 起首');
    assertEqual_(sanitizeCell_('正常備註'), '正常備註');
    assertEqual_(sanitizeCell_(12), 12, '數字不變');
    assertEqual_(sanitizeCell_(''), '');
    assertEqual_(unsanitizeCell_(sanitizeCell_('=HYPERLINK("x")')), '=HYPERLINK("x")', '還原');
    assertEqual_(unsanitizeCell_("'單引號但非公式"), "'單引號但非公式", '非公式不移除');
  });
  test_('requireInt／requireString／requireDate／requireTime 邊界', function () {
    assertEqual_(requireInt(5, 'ipad', 0, 90), 5);
    assertEqual_(requireInt('7', 'ipad', 0, 90), 7);
    assertThrowsCode_(function () { requireInt(1.5, 'ipad', 0, 90); }, ERROR_CODES.VALIDATION_ERROR);
    assertThrowsCode_(function () { requireInt(91, 'ipad', 0, 90); }, ERROR_CODES.VALIDATION_ERROR);
    assertThrowsCode_(function () { requireString('', 'className', 1, 20); }, ERROR_CODES.VALIDATION_ERROR);
    assertEqual_(requireString('  1A ', 'className', 1, 20), '1A', '去除空白');
    assertThrowsCode_(function () { requireDate('2026-2-3', 'date'); }, ERROR_CODES.VALIDATION_ERROR);
    assertThrowsCode_(function () { requireDate('2026-02-30', 'date'); }, ERROR_CODES.VALIDATION_ERROR, '不存在的日期');
    assertEqual_(requireTime('7:05', 'customStart'), '07:05');
    assertThrowsCode_(function () { requireTime('24:00', 'customStart'); }, ERROR_CODES.VALIDATION_ERROR);
  });
  test_('nextApplicationId_ 依年份遞增', function () {
    var now = new Date(TEST_NOW_ISO_);
    assertEqual_(nextApplicationId_([HEADERS[SHEET_NAMES.APPLICATIONS]], now), 'BK-2026-0001');
    var rows = [HEADERS[SHEET_NAMES.APPLICATIONS], ['BK-2026-0007'], ['BK-2025-0999'], ['BK-2026-0003']];
    assertEqual_(nextApplicationId_(rows, now), 'BK-2026-0008');
  });
  test_('isYes_／isTruthyFlag_／toInt_', function () {
    assert_(isYes_('是') && !isYes_('否') && !isYes_(''));
    assert_(isTruthyFlag_('TRUE') && isTruthyFlag_(true) && isTruthyFlag_('是') && isTruthyFlag_(1));
    assert_(!isTruthyFlag_('FALSE') && !isTruthyFlag_('') && !isTruthyFlag_(0));
    assertEqual_(toInt_('12', 0), 12);
    assertEqual_(toInt_('', 3), 3);
    assertEqual_(toInt_('abc', 0), 0);
  });
}

// ---------------------------------------------------------------------------
// 2. JWT 驗證（RS256 + 各種拒絕）
// ---------------------------------------------------------------------------
function testAuthRejections() {
  var v = AUTH_TEST_VECTORS_;
  var savedProvider = JWKS_PROVIDER_OVERRIDE_;
  var savedProps = PROP_OVERRIDE_;
  var savedClock = Clock_.override;
  var providerCalls = 0;
  JWKS_PROVIDER_OVERRIDE_ = function () { providerCalls++; return { keys: [v.jwk] }; };
  PROP_OVERRIDE_ = testProps_();
  Clock_.override = new Date(v.nowSec * 1000);
  var tokenKeys = [];
  for (var k in v.tokens) tokenKeys.push('tok_' + sha256Hex_(v.tokens[k]));
  cacheRemove_(tokenKeys.concat([JWKS_CACHE_KEY_]));
  try {
    test_('JWT 合法 token 通過 RS256 驗證', function () {
      var claims = verifyIdToken_(v.tokens.valid);
      assertEqual_(claims.email, v.expectedEmail, 'email 小寫化');
      assertEqual_(claims.hd, v.hd);
      assertEqual_(providerCalls, 1, '第一次需抓 JWKS');
    });
    test_('JWT 合法 token 第二次命中快取', function () {
      var claims = verifyIdToken_(v.tokens.valid);
      assertEqual_(claims.email, v.expectedEmail);
      assertEqual_(providerCalls, 1, '不再抓 JWKS');
    });
    test_('JWT 被竄改 payload → INVALID_TOKEN', function () {
      assertThrowsCode_(function () { verifyIdToken_(v.tokens.tampered); }, ERROR_CODES.INVALID_TOKEN);
    });
    test_('JWT 錯誤 aud → INVALID_AUDIENCE', function () {
      assertThrowsCode_(function () { verifyIdToken_(v.tokens.wrongAud); }, ERROR_CODES.INVALID_AUDIENCE);
    });
    test_('JWT 錯誤 iss → INVALID_ISSUER', function () {
      assertThrowsCode_(function () { verifyIdToken_(v.tokens.wrongIss); }, ERROR_CODES.INVALID_ISSUER);
    });
    test_('JWT 已過期 → TOKEN_EXPIRED', function () {
      assertThrowsCode_(function () { verifyIdToken_(v.tokens.expired); }, ERROR_CODES.TOKEN_EXPIRED);
    });
    test_('JWT 錯誤 hd → FORBIDDEN_DOMAIN', function () {
      assertThrowsCode_(function () { verifyIdToken_(v.tokens.wrongHd); }, ERROR_CODES.FORBIDDEN_DOMAIN);
    });
    test_('JWT email 未驗證 → EMAIL_NOT_VERIFIED', function () {
      assertThrowsCode_(function () { verifyIdToken_(v.tokens.notVerified); }, ERROR_CODES.EMAIL_NOT_VERIFIED);
    });
    test_('JWT 未知 kid → 重新抓取 JWKS 後 INVALID_TOKEN', function () {
      var before = providerCalls;
      assertThrowsCode_(function () { verifyIdToken_(v.tokens.unknownKid); }, ERROR_CODES.INVALID_TOKEN);
      assertEqual_(providerCalls, before + 1, 'kid 未命中應強制重抓一次');
    });
    test_('JWT alg 非 RS256／格式錯誤／缺 token → INVALID_TOKEN', function () {
      assertThrowsCode_(function () { verifyIdToken_(v.tokens.badAlg); }, ERROR_CODES.INVALID_TOKEN);
      assertThrowsCode_(function () { verifyIdToken_(v.tokens.malformed); }, ERROR_CODES.INVALID_TOKEN);
      assertThrowsCode_(function () { verifyIdToken_(''); }, ERROR_CODES.AUTH_REQUIRED, '缺 token → AUTH_REQUIRED');
    });
    test_('JWT 時鐘容差：exp 後 20 秒仍接受、40 秒拒絕', function () {
      var expSec = JSON.parse(base64UrlDecodeString_(v.tokens.valid.split('.')[1])).exp;
      cacheRemove_(['tok_' + sha256Hex_(v.tokens.valid)]);
      Clock_.override = new Date((expSec + 20) * 1000);
      verifyIdToken_(v.tokens.valid);
      cacheRemove_(['tok_' + sha256Hex_(v.tokens.valid)]);
      Clock_.override = new Date((expSec + 40) * 1000);
      assertThrowsCode_(function () { verifyIdToken_(v.tokens.valid); }, ERROR_CODES.TOKEN_EXPIRED);
      Clock_.override = new Date(v.nowSec * 1000);
    });
    test_('modPow_ 基本正確性', function () {
      assertEqual_(String(modPow_(BigInt(4), BigInt(13), BigInt(497))), '445');
      assertEqual_(String(modPow_(BigInt(2), BigInt(0), BigInt(7))), '1');
      assertEqual_(String(modPow_(BigInt(123456789), BigInt(65537), BigInt(1000000007))), String(modPowReference_(BigInt(123456789), BigInt(65537), BigInt(1000000007))));
    });
  } finally {
    cacheRemove_(tokenKeys.concat([JWKS_CACHE_KEY_]));
    JWKS_PROVIDER_OVERRIDE_ = savedProvider;
    PROP_OVERRIDE_ = savedProps;
    Clock_.override = savedClock;
  }
}

/** 對照用的簡單平方乘法實作。 */
function modPowReference_(base, exp, mod) {
  var result = BigInt(1);
  base = base % mod;
  while (exp > BigInt(0)) {
    if (exp % BigInt(2) === BigInt(1)) result = (result * base) % mod;
    exp = exp / BigInt(2);
    base = (base * base) % mod;
  }
  return result;
}

// ---------------------------------------------------------------------------
// 3. 併發庫存
// ---------------------------------------------------------------------------
function regularPayload_(date, slotIds, ipad, pencil, extra) {
  var p = { date: date, slotIds: slotIds, ipad: ipad, pencil: pencil, teacherName: '測試教師', className: '3A', students: 30, subject: '數學', remark: '' };
  if (extra) for (var k in extra) p[k] = extra[k];
  return p;
}

function testConcurrentBooking() {
  withTestSpreadsheet_(function () {
    var ctx = teacherCtx_();
    var date = '2026-09-16';
    test_('併發：同格 50+50 → 第二筆 CONFLICT_INSUFFICIENT_STOCK', function () {
      var r1 = submitApplication(ctx, regularPayload_(date, ['P03'], 50, 0));
      assertEqual_(r1.application.applicationId, 'BK-2026-0001');
      assertEqual_(r1.application.status, STATUS.PENDING);
      var err = assertThrowsCode_(function () { submitApplication(ctx, regularPayload_(date, ['P03'], 50, 0)); }, ERROR_CODES.CONFLICT_INSUFFICIENT_STOCK);
      assert_(err.message.indexOf('只剩 40 部') >= 0, '訊息應含剩餘 40：' + err.message);
      assert_(err.message.indexOf('第 3 節') >= 0, '訊息應含時段標籤');
      assertEqual_(err.details.field, 'ipad');
      assert_(!LockService.getScriptLock().hasLock(), '鎖已釋放');
    });
    test_('併發：同格 45+45 皆成功，再 1 部失敗', function () {
      submitApplication(ctx, regularPayload_(date, ['P05'], 45, 0));
      submitApplication(ctx, regularPayload_(date, ['P05'], 45, 0));
      assertThrowsCode_(function () { submitApplication(ctx, regularPayload_(date, ['P05'], 1, 0)); }, ERROR_CODES.CONFLICT_INSUFFICIENT_STOCK);
      var week = getWeekData(ctx, { date: date });
      var cell = week.week.cells[date + '|P05'];
      assertEqual_([cell.ipadPending, cell.ipadApproved, cell.ipadRemaining], [90, 0, 0], 'P05 統計');
      assertEqual_(cell.bookable, true, 'bookable 只反映時段可否申請，滿額由 ipadRemaining=0 表示');
      var p03 = week.week.cells[date + '|P03'];
      assertEqual_(p03.ipadRemaining, 40);
    });
    test_('併發：Pencil 亦受庫存限制', function () {
      assertThrowsCode_(function () { submitApplication(ctx, regularPayload_(date, ['P06'], 1, 2)); }, ERROR_CODES.VALIDATION_ERROR, 'pencil > ipad');
      setSettingValue_(SETTING_KEYS.PENCIL_TOTAL, 40);
      cacheRemove_([CACHE_KEYS_.SETTINGS]);
      submitApplication(ctx, regularPayload_(date, ['P06'], 40, 40));
      var err = assertThrowsCode_(function () { submitApplication(ctx, regularPayload_(date, ['P06'], 1, 1)); }, ERROR_CODES.CONFLICT_INSUFFICIENT_STOCK);
      assertEqual_(err.details.field, 'pencil');
      assert_(err.message.indexOf('Apple Pencil 只剩 0 支') >= 0, err.message);
      submitApplication(ctx, regularPayload_(date, ['P06'], 1, 0));
      setSettingValue_(SETTING_KEYS.PENCIL_TOTAL, 90);
      cacheRemove_([CACHE_KEYS_.SETTINGS]);
    });
    test_('提交驗證：日期範圍／SLOT_PAST／不連續／學生人數／iPad 上限', function () {
      assertThrowsCode_(function () { submitApplication(ctx, regularPayload_('2026-09-14', ['P01'], 1, 0)); }, ERROR_CODES.VALIDATION_ERROR, '昨天不在 today..today+advanceDays（§5.3 步驟 1）');
      var okToday = submitApplication(ctx, regularPayload_('2026-09-15', ['P01'], 1, 0));
      assertEqual_(okToday.application.date, '2026-09-15', '今天 08:35 > 08:00 允許');
      Clock_.override = new Date('2026-09-15T01:00:00Z');
      assertThrowsCode_(function () { submitApplication(ctx, regularPayload_('2026-09-15', ['P01'], 1, 0)); }, ERROR_CODES.SLOT_PAST, '09:00 時 08:35 已過');
      assertThrowsCode_(function () { submitSpecialActivity(ctx, specialPayload_('2026-09-15', '08:30', '09:30', 1, 0)); }, ERROR_CODES.SLOT_PAST, '特別活動亦檢查');
      Clock_.override = new Date(TEST_NOW_ISO_);
      assertThrowsCode_(function () { submitApplication(ctx, regularPayload_(date, ['P01', 'P03'], 1, 0)); }, ERROR_CODES.VALIDATION_ERROR, '不連續');
      assertThrowsCode_(function () { submitApplication(ctx, regularPayload_(date, ['P01'], 1, 0, { students: 0 })); }, ERROR_CODES.VALIDATION_ERROR);
      assertThrowsCode_(function () { submitApplication(ctx, regularPayload_(date, ['P01'], 91, 0)); }, ERROR_CODES.VALIDATION_ERROR);
      assertThrowsCode_(function () { submitApplication(ctx, regularPayload_(date, ['P01'], 0, 0)); }, ERROR_CODES.VALIDATION_ERROR, 'iPad 與 Pencil 皆 0');
      assertThrowsCode_(function () { submitApplication(ctx, regularPayload_('2026-11-30', ['P01'], 1, 0)); }, ERROR_CODES.VALIDATION_ERROR, '超過提前日數');
    });
    test_('提交驗證：今日 08:35 之前可預約今日第 1 節', function () {
      var r = submitApplication(ctx, regularPayload_('2026-09-15', ['P02'], 5, 0));
      assertEqual_(r.application.date, '2026-09-15');
      assertEqual_(r.application.slots[0].slotId, 'P02');
    });
    test_('取消：本人待審可取消，他人 FORBIDDEN_ROLE，已取消不可再取消', function () {
      var r = submitApplication(ctx, regularPayload_(date, ['P07'], 5, 0));
      var id = r.application.applicationId;
      var other = makeCtx_('teacher.two@' + TEST_HD_, [ROLES.TEACHER]);
      assertThrowsCode_(function () { cancelMyApplication(other, { applicationId: id }); }, ERROR_CODES.FORBIDDEN_ROLE, '非本人');
      assertThrowsCode_(function () { cancelMyApplication(ctx, { applicationId: 'BK-2099-0001' }); }, ERROR_CODES.NOT_FOUND);
      var c = cancelMyApplication(ctx, { applicationId: id });
      assertEqual_(c.application.status, STATUS.CANCELLED);
      assertThrowsCode_(function () { cancelMyApplication(ctx, { applicationId: id }); }, ERROR_CODES.INVALID_STATE_TRANSITION);
      var week = getWeekData(ctx, { date: date });
      var p07 = week.week.cells[date + '|P07'];
      assertEqual_(p07.ipadRemaining, 90, '取消後釋放庫存');
    });
    test_('備註公式注入被防護並可還原', function () {
      var r = submitApplication(ctx, regularPayload_(date, ['P04'], 1, 0, { remark: '=HYPERLINK("http://x")' }));
      var raw = SpreadsheetApp.openById(getSpreadsheetId_()).getSheetByName(SHEET_NAMES.APPLICATIONS).getDataRange().getValues();
      var row = raw.filter(function (x) { return x[COL.APP.ID] === r.application.applicationId; })[0];
      assertEqual_(row[COL.APP.REMARK], "'=HYPERLINK(\"http://x\")", '儲存格以單引號起首');
      assertEqual_(r.application.remark, '=HYPERLINK("http://x")', '回傳還原');
    });
    test_('通知：提交後寄出一封給申請人與管理員', function () {
      var before = MAIL_SINK_.length;
      submitApplication(ctx, regularPayload_(date, ['P01'], 2, 0));
      assertEqual_(MAIL_SINK_.length, before + 1);
      var mail = MAIL_SINK_[MAIL_SINK_.length - 1];
      assert_(mail.to.indexOf(TEST_TEACHER_EMAIL_) >= 0 && mail.to.indexOf(TEST_ADMIN_EMAIL_) >= 0, '收件人：' + mail.to);
      assert_(mail.subject.indexOf('【iPad 預約】') === 0, '主旨前綴：' + mail.subject);
      assert_(mail.subject.indexOf('BK-2026-') > 0);
    });
  });
}

/**
 * 真實併發模擬（僅供在 Apps Script 環境手動執行）：建立兩個 1 秒後觸發的一次性時間觸發器，
 * 各自呼叫 concurrencyProbe_ 於同一格提交 50 部 iPad；隨後查看操作紀錄應有一筆成功、一筆 CONFLICT_INSUFFICIENT_STOCK。
 * 需先設定 Script Properties 並確保 SPREADSHEET_ID 指向測試用試算表。
 */
function simulateConcurrency_() {
  var when = 1000;
  ScriptApp.newTrigger('concurrencyProbe_').timeBased().after(when).create();
  ScriptApp.newTrigger('concurrencyProbe_').timeBased().after(when).create();
  console.log('已建立兩個一次性觸發器，約 1 分鐘內執行 concurrencyProbe_；完成後請查看操作紀錄。');
}

/** 觸發器目標：以測試教師身分在下週三第 3 節提交 50 部 iPad，並寫入結果到操作紀錄。 */
function concurrencyProbe_() {
  var ctx = makeCtx_(TEST_TEACHER_EMAIL_, [ROLES.TEACHER], '併發測試');
  var date = addDays_(weekStartOf_(todayString_(Clock_.now())), 9);
  var result = '成功';
  var note = '';
  try {
    var r = submitApplication(ctx, regularPayload_(date, ['P03'], 50, 0, { remark: '併發模擬' }));
    note = r.application.applicationId;
  } catch (err) {
    result = '失敗';
    note = (err && err.code ? err.code : 'ERROR') + ' ' + (err && err.message ? err.message : String(err));
  }
  logAction_(ctx.email, LOG_ACTIONS.SUBMIT, '', null, { probe: true, date: date }, ROLES.TEACHER, result, ctx.requestId, note);
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'concurrencyProbe_') ScriptApp.deleteTrigger(triggers[i]);
  }
}

// ---------------------------------------------------------------------------
// 4. 特別活動
// ---------------------------------------------------------------------------
function specialPayload_(date, start, end, ipad, pencil, extra) {
  var p = { date: date, customStart: start, customEnd: end, activityName: '學生領袖訓練', ipad: ipad, pencil: pencil, teacherName: '測試教師', className: '4B', students: 25, remark: '', afterHoursConfirm: false };
  if (extra) for (var k in extra) p[k] = extra[k];
  return p;
}

function testSpecialActivity() {
  var blocks = [
    ['2026-09-18', 'P01,P02', '校慶', TEST_ADMIN_EMAIL_, '2026-09-01 09:00:00'],
    ['2026-09-19', '全日', '停課', TEST_ADMIN_EMAIL_, '2026-09-01 09:00:00'],
    ['2026-09-27', '全日', '維修', TEST_ADMIN_EMAIL_, '2026-09-01 09:00:00']
  ];
  withTestSpreadsheet_(function () {
    var ctx = teacherCtx_();
    var admin = adminCtx_();
    var thu = '2026-09-17';
    test_('特別活動：ACT 14:00–18:30 跨 P08+P09 扣減庫存', function () {
      var r1 = submitApplication(ctx, regularPayload_(thu, ['P08'], 30, 0));
      assertEqual_(r1.application.bookingType, BOOKING_TYPE_NORMAL);
      var s = submitSpecialActivity(ctx, specialPayload_(thu, '14:00', '18:30', 50, 5, { afterHoursConfirm: true, remark: '活動後自行保管' }));
      var a = s.application;
      assertEqual_(a.bookingType, BOOKING_TYPE_SPECIAL);
      assertEqual_(a.subject, BOOKING_TYPE_SPECIAL, '科目欄為 特別活動');
      assertEqual_([a.customStart, a.customEnd, a.afterHoursConfirm, a.needsSpecialApproval, a.isSunday], ['14:00', '18:30', true, false, false]);
      assertEqual_(a.slots.length, 1);
      assertEqual_(a.slots[0].slotId, ACT_SLOT_ID);
      var e = assertThrowsCode_(function () { submitApplication(ctx, regularPayload_(thu, ['P08'], 11, 0)); }, ERROR_CODES.CONFLICT_INSUFFICIENT_STOCK, 'P08 只剩 10');
      assert_(e.message.indexOf('只剩 10 部') >= 0, e.message);
      submitApplication(ctx, regularPayload_(thu, ['P09'], 40, 0));
      assertThrowsCode_(function () { submitApplication(ctx, regularPayload_(thu, ['P09'], 1, 0)); }, ERROR_CODES.CONFLICT_INSUFFICIENT_STOCK, 'P09 已滿');
      var week = getWeekData(ctx, { date: thu });
      var byId = {};
      ['P07', 'P08', 'P09', 'AFTER'].forEach(function (sid) { byId[sid] = week.week.cells[thu + '|' + sid]; });
      assertEqual_([byId.P08.ipadPending, byId.P09.ipadPending, byId.AFTER.ipadPending, byId.P07.ipadPending], [80, 90, 50, 0], '格統計含 ACT 重疊');
      assertEqual_(byId.P09.ipadRemaining, 0);
      var special = week.week.special[thu];
      assertEqual_(special.activityCount, 1);
      assertEqual_(special.activities[0].activityName, '學生領袖訓練');
      assertEqual_([special.activities[0].start, special.activities[0].end], ['14:00', '18:30']);
      var logs = SpreadsheetApp.openById(getSpreadsheetId_()).getSheetByName(SHEET_NAMES.LOGS).getDataRange().getValues();
      assert_(logs.some(function (l) { return l[COL.LOG.ACTION] === LOG_ACTIONS.SUBMIT_SPECIAL && l[COL.LOG.APP_ID] === a.applicationId; }), '操作紀錄 提交特別活動');
    });
    test_('特別活動：另一筆重疊 ACT 以尖峰法檢查', function () {
      var e = assertThrowsCode_(function () { submitSpecialActivity(ctx, specialPayload_(thu, '15:30', '16:30', 41, 0)); }, ERROR_CODES.CONFLICT_INSUFFICIENT_STOCK, '15:30–16:30 與 ACT50+P09(40 至 15:35) 重疊 → 剩 0');
      assert_(e.message.indexOf('只剩 0 部') >= 0, e.message);
      var ok = submitSpecialActivity(ctx, specialPayload_(thu, '15:35', '16:30', 40, 0));
      assertEqual_(ok.application.status, STATUS.PENDING, '15:35 起只與 ACT 50 重疊 → 剩 40');
      assertThrowsCode_(function () { submitSpecialActivity(ctx, specialPayload_(thu, '16:00', '17:00', 1, 0)); }, ERROR_CODES.CONFLICT_INSUFFICIENT_STOCK);
    });
    test_('特別活動：17:15 後需 afterHoursConfirm 且備註必填', function () {
      var e1 = assertThrowsCode_(function () { submitSpecialActivity(ctx, specialPayload_('2026-09-16', '16:00', '18:00', 5, 0)); }, ERROR_CODES.VALIDATION_ERROR);
      assertEqual_(e1.details.field, 'afterHoursConfirm');
      var e2 = assertThrowsCode_(function () { submitSpecialActivity(ctx, specialPayload_('2026-09-16', '16:00', '18:00', 5, 0, { afterHoursConfirm: true, remark: '  ' })); }, ERROR_CODES.VALIDATION_ERROR);
      assertEqual_(e2.details.field, 'remark');
      var ok = submitSpecialActivity(ctx, specialPayload_('2026-09-16', '16:00', '17:15', 5, 0));
      assertEqual_(ok.application.afterHoursConfirm, false, '17:15 整不算超時');
      var ok2 = submitSpecialActivity(ctx, specialPayload_('2026-09-16', '16:00', '18:00', 5, 0, { afterHoursConfirm: true, remark: '由本人保管' }));
      assertEqual_(ok2.application.afterHoursConfirm, true);
      var mail = MAIL_SINK_[MAIL_SINK_.length - 1];
      assert_(mail.body.indexOf(AFTER_HOURS_CONFIRM_TEXT) >= 0, '郵件含保管確認句');
      assert_(mail.body.indexOf('學生領袖訓練') >= 0 && mail.body.indexOf('16:00–18:00') >= 0, '郵件含活動名稱與時間');
    });
    test_('特別活動：時間界限 07:00–22:00 與起訖順序', function () {
      var e1 = assertThrowsCode_(function () { submitSpecialActivity(ctx, specialPayload_('2026-09-16', '06:30', '09:00', 5, 0)); }, ERROR_CODES.VALIDATION_ERROR);
      assertEqual_(e1.details.field, 'customStart');
      var e2 = assertThrowsCode_(function () { submitSpecialActivity(ctx, specialPayload_('2026-09-16', '19:00', '22:30', 5, 0, { afterHoursConfirm: true, remark: 'x' })); }, ERROR_CODES.VALIDATION_ERROR);
      assertEqual_(e2.details.field, 'customEnd');
      var e3 = assertThrowsCode_(function () { submitSpecialActivity(ctx, specialPayload_('2026-09-16', '10:00', '10:00', 5, 0)); }, ERROR_CODES.VALIDATION_ERROR);
      assertEqual_(e3.details.field, 'customEnd');
      var e4 = assertThrowsCode_(function () { submitSpecialActivity(ctx, specialPayload_('2026-09-16', '10:00', '11:00', 5, 0, { activityName: '' })); }, ERROR_CODES.VALIDATION_ERROR);
      assertEqual_(e4.details.field, 'activityName');
      assertThrowsCode_(function () { submitSpecialActivity(ctx, specialPayload_('2026-09-15', '07:30', '07:50', 5, 0)); }, ERROR_CODES.SLOT_PAST, '今日 07:30 已過');
    });
    test_('特別活動：星期日／封鎖日期 → 需特別批准而非 SLOT_BLOCKED', function () {
      var sun = submitSpecialActivity(ctx, specialPayload_('2026-09-20', '09:00', '11:00', 10, 0));
      assertEqual_([sun.application.needsSpecialApproval, sun.application.isSunday, sun.application.specialApprovalReason], [true, true, '星期日']);
      var mail = MAIL_SINK_[MAIL_SINK_.length - 1];
      assert_(mail.subject.indexOf('【需特別批准】') === 0, '主旨前綴：' + mail.subject);
      assertThrowsCode_(function () { submitApplication(ctx, regularPayload_('2026-09-20', ['P01'], 1, 0)); }, ERROR_CODES.VALIDATION_ERROR, '一般課堂不可星期日');
      var blockedPartial = submitSpecialActivity(ctx, specialPayload_('2026-09-18', '08:00', '09:30', 10, 0));
      assertEqual_([blockedPartial.application.needsSpecialApproval, blockedPartial.application.specialApprovalReason, blockedPartial.application.blockedReason], [true, '封鎖日期：校慶', '校慶']);
      var notBlocked = submitSpecialActivity(ctx, specialPayload_('2026-09-18', '10:00', '11:00', 10, 0));
      assertEqual_(notBlocked.application.needsSpecialApproval, false, '不與封鎖時段重疊');
      var allDay = submitSpecialActivity(ctx, specialPayload_('2026-09-19', '10:00', '11:00', 10, 0));
      assertEqual_(allDay.application.specialApprovalReason, '封鎖日期：停課');
      assertThrowsCode_(function () { submitApplication(ctx, regularPayload_('2026-09-19', ['P04'], 1, 0)); }, ERROR_CODES.SLOT_BLOCKED, '一般課堂在全日封鎖 → SLOT_BLOCKED');
      assertThrowsCode_(function () { submitApplication(ctx, regularPayload_('2026-09-18', ['P01'], 1, 0)); }, ERROR_CODES.SLOT_BLOCKED, '一般課堂在封鎖時段');
      var both = submitSpecialActivity(ctx, specialPayload_('2026-09-27', '10:00', '11:00', 10, 0));
      assertEqual_(both.application.specialApprovalReason, '星期日；封鎖日期：維修');
    });
    test_('特別活動：核准需 confirmSpecial，並寫入 特別批准 紀錄', function () {
      var pending = getPendingApplications(admin).applications;
      var sunApp = pending.filter(function (a) { return a.date === '2026-09-20'; })[0];
      var normalApp = pending.filter(function (a) { return a.date === thu && a.bookingType === BOOKING_TYPE_NORMAL; })[0];
      var e = assertThrowsCode_(function () { approveApplication(admin, { applicationId: sunApp.applicationId }); }, ERROR_CODES.VALIDATION_ERROR);
      assertEqual_(e.details.field, 'confirmSpecial');
      assertThrowsCode_(function () { approveApplication(admin, { applicationId: sunApp.applicationId, confirmSpecial: 'true' }); }, ERROR_CODES.VALIDATION_ERROR, '必須是布林 true');
      var ok = approveApplication(admin, { applicationId: sunApp.applicationId, confirmSpecial: true });
      assertEqual_(ok.application.status, STATUS.APPROVED);
      var logs = SpreadsheetApp.openById(getSpreadsheetId_()).getSheetByName(SHEET_NAMES.LOGS).getDataRange().getValues();
      var special = logs.filter(function (l) { return l[COL.LOG.ACTION] === LOG_ACTIONS.SPECIAL_APPROVE && l[COL.LOG.APP_ID] === sunApp.applicationId; });
      assertEqual_(special.length, 1, '一筆 特別批准');
      var after = JSON.parse(special[0][COL.LOG.AFTER]);
      assertEqual_([after.approver, after.reason], [TEST_ADMIN_EMAIL_, '星期日']);
      assert_(after.approvedAt.length === 19);
      var ok2 = approveApplication(admin, { applicationId: normalApp.applicationId });
      assertEqual_(ok2.application.status, STATUS.APPROVED, '一般申請無需 confirmSpecial');
      assertThrowsCode_(function () { approveApplication(admin, { applicationId: normalApp.applicationId }); }, ERROR_CODES.INVALID_STATE_TRANSITION);
      assertThrowsCode_(function () { approveApplication(admin, { applicationId: 'BK-2099-0001' }); }, ERROR_CODES.NOT_FOUND);
    });
    test_('特別活動：核准時以尖峰法重算（核准他筆後庫存不足 → CONFLICT）', function () {
      var fri = '2026-09-25';
      var a = submitSpecialActivity(ctx, specialPayload_(fri, '09:00', '10:00', 60, 0));
      var b = submitApplication(ctx, regularPayload_(fri, ['P02'], 30, 0));
      var c = cancelMyApplication(ctx, { applicationId: a.application.applicationId });
      assertEqual_(c.application.status, STATUS.CANCELLED);
      var d = submitSpecialActivity(ctx, specialPayload_(fri, '09:00', '10:00', 60, 0));
      approveApplication(admin, { applicationId: d.application.applicationId });
      var e = submitApplication(ctx, regularPayload_(fri, ['P03'], 30, 0));
      approveApplication(admin, { applicationId: e.application.applicationId });
      var err = assertThrowsCode_(function () { submitApplication(ctx, regularPayload_(fri, ['P02'], 1, 0)); }, ERROR_CODES.CONFLICT_INSUFFICIENT_STOCK);
      assert_(err.message.indexOf('只剩 0 部') >= 0, err.message);
      approveApplication(admin, { applicationId: b.application.applicationId });
      var week = getWeekData(ctx, { date: fri });
      var cell = week.week.cells[fri + '|P02'];
      assertEqual_([cell.ipadApproved, cell.ipadPending, cell.ipadRemaining], [90, 0, 0]);
    });
    test_('特別活動：週資料 7 天、星期日無一般格、special 標記與過去日期隱藏', function () {
      var week = getWeekData(ctx, { date: thu }).week;
      assertEqual_(week.days.length, 7);
      assertEqual_([week.weekStart, week.weekEnd], ['2026-09-14', '2026-09-20']);
      assertEqual_(week.days[6].weekday, 'SUN');
      var keys = Object.keys(week.cells);
      assertEqual_(keys.filter(function (k) { return k.indexOf('2026-09-20|') === 0; }).length, 0, '星期日無一般時段格');
      assertEqual_(keys.filter(function (k) { return k.indexOf('2026-09-19|') === 0; }).length, 10, '星期六有 10 格');
      assertEqual_(keys.length, 60, '6 天 × 10 時段');
      assertEqual_([week.days[0].isPast, week.days[1].isToday, week.days[5].blockedAllDay, week.days[5].blockedReason], [true, true, true, '停課']);
      assertEqual_([week.cells['2026-09-14|P01'].bookable, week.cells['2026-09-14|P01'].unbookableReason], [false, 'past']);
      assertEqual_([week.cells['2026-09-19|P04'].bookable, week.cells['2026-09-19|P04'].unbookableReason], [false, 'blocked']);
      assertEqual_(week.cells['2026-09-18|P01'].unbookableReason, 'blocked', '部分封鎖時段');
      assertEqual_(week.cells['2026-09-18|P03'].bookable, true);
      var sun = week.special['2026-09-20'];
      assertEqual_([sun.isSunday, sun.bookable, sun.warnings], [true, true, ['sunday']]);
      var sat = week.special['2026-09-19'];
      assertEqual_([sat.blockedReason, sat.warnings], ['停課', ['blocked']]);
      var friCell = week.special['2026-09-18'];
      assertEqual_(friCell.warnings, ['blocked'], '部分封鎖亦提示');
      appendRow_(SHEET_NAMES.APPLICATIONS, newApplicationRow_('BK-2026-0900', ctx, {
        className: '2C', students: 20, subject: BOOKING_TYPE_SPECIAL, remark: '', bookingType: BOOKING_TYPE_SPECIAL, activityName: '過去活動',
        customStart: '09:00', customEnd: '10:00', afterHoursConfirm: false, needsSpecialApproval: false, specialApprovalReason: ''
      }, '2026-09-10 09:00:00'));
      appendRow_(SHEET_NAMES.DETAILS, ['BK-2026-0900', '2026-09-14', ACT_SLOT_ID, '09:00', '10:00', 5, 0]);
      var week2 = getWeekData(ctx, { date: thu }).week;
      var past = week2.special['2026-09-14'];
      assertEqual_([past.activityCount, past.activities.length, past.bookable], [1, 0, false], '過去日期隱藏活動內容');
      assertEqual_(week2.special[thu].activities.length, 2, '最多 3 筆');
      assert_(week2.special[thu].activities[0].start <= week2.special[thu].activities[1].start, '依開始時間排序');
    });
    test_('特別活動：searchApplications 模糊搜尋與篩選', function () {
      var r = searchApplications(admin, { query: '領袖' });
      assert_(r.applications.length >= 5, '找到活動名稱');
      assert_(r.applications.every(function (a) { return a.bookingType === BOOKING_TYPE_SPECIAL; }));
      for (var i = 1; i < r.applications.length; i++) assert_(r.applications[i - 1].date >= r.applications[i].date, '日期新→舊');
      var byType = searchApplications(admin, { bookingType: BOOKING_TYPE_NORMAL, from: thu, to: thu });
      assert_(byType.applications.length >= 2 && byType.applications.every(function (a) { return a.bookingType === BOOKING_TYPE_NORMAL && a.date === thu; }));
      var byStatus = searchApplications(admin, { status: STATUS.APPROVED, query: 'bk-2026' });
      assert_(byStatus.applications.length >= 3 && byStatus.applications.every(function (a) { return a.status === STATUS.APPROVED; }));
      var byClass = searchApplications(handlerCtx_(), { query: '4b' });
      assert_(byClass.applications.length > 0, '班別大小寫不敏感');
      assertEqual_(searchApplications(admin, { query: '不存在的東西' }).applications.length, 0);
      assertThrowsCode_(function () { searchApplications(admin, { status: '亂填' }); }, ERROR_CODES.VALIDATION_ERROR);
      assertThrowsCode_(function () { searchApplications(admin, { bookingType: '亂填' }); }, ERROR_CODES.VALIDATION_ERROR);
    });
    test_('特別活動：getMyApplications 只回本人，含 isSunday／needsSpecialApproval', function () {
      var mine = getMyApplications(ctx).applications;
      assert_(mine.length >= 10);
      assert_(mine.every(function (a) { return a.teacherEmail === TEST_TEACHER_EMAIL_; }));
      var sun = mine.filter(function (a) { return a.date === '2026-09-20'; })[0];
      assertEqual_([sun.isSunday, sun.needsSpecialApproval, sun.status], [true, true, STATUS.APPROVED]);
      var other = getMyApplications(makeCtx_('teacher.two@' + TEST_HD_, [ROLES.TEACHER])).applications;
      assertEqual_(other.length, 0);
    });
  }, { blocks: blocks });
}

// ---------------------------------------------------------------------------
// 5. 借還流程
// ---------------------------------------------------------------------------
function testHandoverFlow() {
  withTestSpreadsheet_(function () {
    var ctx = teacherCtx_();
    var admin = adminCtx_();
    var handler = handlerCtx_();
    var date = '2026-09-16';
    test_('借還：領取 → 部分歸還 → 完全歸還，狀態與未還數量正確', function () {
      var r = submitApplication(ctx, regularPayload_(date, ['P03', 'P04'], 20, 10));
      var id = r.application.applicationId;
      assertThrowsCode_(function () { recordPickup(handler, { applicationId: id, ipad: 20, pencil: 10 }); }, ERROR_CODES.INVALID_STATE_TRANSITION, '未核准不可領取');
      approveApplication(admin, { applicationId: id });
      var list = getApprovedForHandover(handler, { date: date }).applications;
      assertEqual_(list.length, 1);
      assertEqual_(list[0].applicationId, id);
      assertThrowsCode_(function () { recordPickup(handler, { applicationId: id, ipad: 21, pencil: 10 }); }, ERROR_CODES.VALIDATION_ERROR, '超過申請數');
      var p = recordPickup(handler, { applicationId: id, ipad: 18, pencil: 10, note: '缺 2 部' });
      assertEqual_([p.application.status, p.application.ipadOutstanding, p.application.pencilOutstanding], [STATUS.PICKED_UP, 18, 10]);
      assertEqual_(p.application.handovers.length, 1);
      assertEqual_(p.application.handovers[0].type, HANDOVER_TYPES.PICKUP);
      assertThrowsCode_(function () { recordReturn(handler, { applicationId: id, ipad: 19, pencil: 0 }); }, ERROR_CODES.VALIDATION_ERROR, '歸還超過未還');
      var r1 = recordReturn(handler, { applicationId: id, ipad: 10, pencil: 10 });
      assertEqual_([r1.application.status, r1.application.ipadOutstanding, r1.application.pencilOutstanding], [STATUS.PARTIAL_RETURN, 8, 0]);
      var r2 = recordReturn(handler, { applicationId: id, ipad: 8, pencil: 0, note: '一部螢幕花痕' });
      assertEqual_([r2.application.status, r2.application.ipadOutstanding], [STATUS.RETURNED, 0]);
      assert_(r2.application.abnormalNote.indexOf('螢幕花痕') >= 0);
      assertEqual_(r2.application.handovers.length, 3);
      assertThrowsCode_(function () { recordReturn(handler, { applicationId: id, ipad: 1, pencil: 0 }); }, ERROR_CODES.INVALID_STATE_TRANSITION);
      assertThrowsCode_(function () { cancelMyApplication(ctx, { applicationId: id }); }, ERROR_CODES.INVALID_STATE_TRANSITION, '已歸還不可取消');
    });
    test_('借還：拒絕需原因，拒絕後不可領取', function () {
      var r = submitApplication(ctx, regularPayload_(date, ['P06'], 5, 0));
      var id = r.application.applicationId;
      assertThrowsCode_(function () { rejectApplication(admin, { applicationId: id, reason: '' }); }, ERROR_CODES.VALIDATION_ERROR);
      var rej = rejectApplication(admin, { applicationId: id, reason: '當日另有活動' });
      assertEqual_([rej.application.status, rej.application.reason], [STATUS.REJECTED, '當日另有活動']);
      assertThrowsCode_(function () { recordPickup(handler, { applicationId: id, ipad: 5, pencil: 0 }); }, ERROR_CODES.INVALID_STATE_TRANSITION);
      var mail = MAIL_SINK_[MAIL_SINK_.length - 1];
      assert_(mail.body.indexOf('當日另有活動') >= 0, '拒絕郵件含原因');
    });
  });
}

// ---------------------------------------------------------------------------
// 6. 排程冪等
// ---------------------------------------------------------------------------
function seedApp_(id, status, created, fields, details) {
  var ctx = teacherCtx_();
  var base = { className: '5A', students: 20, subject: '通識', remark: '', bookingType: BOOKING_TYPE_NORMAL, activityName: '', customStart: '', customEnd: '', afterHoursConfirm: false, needsSpecialApproval: false, specialApprovalReason: '' };
  if (fields) for (var k in fields) base[k] = fields[k];
  var row = newApplicationRow_(id, ctx, base, created);
  row[COL.APP.STATUS] = status;
  if (fields && fields.ipadOutstanding !== undefined) row[COL.APP.IPAD_OUT] = fields.ipadOutstanding;
  if (fields && fields.pencilOutstanding !== undefined) row[COL.APP.PENCIL_OUT] = fields.pencilOutstanding;
  appendRow_(SHEET_NAMES.APPLICATIONS, row);
  for (var i = 0; i < details.length; i++) {
    appendRow_(SHEET_NAMES.DETAILS, [id, details[i][0], details[i][1], details[i][2], details[i][3], details[i][4], details[i][5]]);
  }
}

function testSchedulerIdempotent() {
  withTestSpreadsheet_(function () {
    // now = 2026-09-15 08:00 HK
    seedApp_('BK-2026-0101', STATUS.PENDING, '2026-09-13 20:00:00', {}, [['2026-09-16', 'P01', '08:35', '09:10', 5, 0]]); // 待審 36 小時 → 提醒
    seedApp_('BK-2026-0102', STATUS.PENDING, '2026-09-14 20:00:00', {}, [['2026-09-14', 'P01', '08:35', '09:10', 5, 0]]); // 時段已過 → 過期
    seedApp_('BK-2026-0103', STATUS.APPROVED, '2026-09-10 09:00:00', {}, [['2026-09-14', 'P08', '14:25', '15:00', 5, 0]]); // 逾時未領取
    seedApp_('BK-2026-0104', STATUS.PICKED_UP, '2026-09-10 09:00:00', { ipadOutstanding: 5, pencilOutstanding: 0 }, [['2026-09-14', 'P09', '15:00', '15:35', 5, 0]]); // 逾時未歸還
    seedApp_('BK-2026-0105', STATUS.APPROVED, '2026-09-10 09:00:00', { bookingType: BOOKING_TYPE_SPECIAL, activityName: '早會', customStart: '07:00', customEnd: '07:20', subject: BOOKING_TYPE_SPECIAL }, [['2026-09-15', ACT_SLOT_ID, '07:00', '07:20', 5, 0]]); // ACT 07:00+30min < 08:00 → 逾時未領取
    seedApp_('BK-2026-0106', STATUS.APPROVED, '2026-09-10 09:00:00', { bookingType: BOOKING_TYPE_SPECIAL, activityName: '午會', customStart: '07:45', customEnd: '09:00', subject: BOOKING_TYPE_SPECIAL }, [['2026-09-15', ACT_SLOT_ID, '07:45', '09:00', 5, 0]]); // 07:45+30 > 08:00 → 不動
    seedApp_('BK-2026-0107', STATUS.PENDING, '2026-09-15 07:00:00', {}, [['2026-09-16', 'P02', '09:10', '09:45', 5, 0]]); // 剛提交 → 不提醒
    seedApp_('BK-2026-0108', STATUS.PICKED_UP, '2026-09-10 09:00:00', { ipadOutstanding: 0, pencilOutstanding: 0 }, [['2026-09-14', 'P09', '15:00', '15:35', 5, 0]]); // 已全數歸還數量 → 不逾時
    var statusOf = function (id) {
      var rows = SpreadsheetApp.openById(getSpreadsheetId_()).getSheetByName(SHEET_NAMES.APPLICATIONS).getDataRange().getValues();
      var row = rows.filter(function (r) { return r[COL.APP.ID] === id; })[0];
      return { status: row[COL.APP.STATUS], flags: row[COL.APP.FLAGS] ? JSON.parse(row[COL.APP.FLAGS]) : {} };
    };
    test_('排程：第一次執行處理過期／提醒／逾時，寄 5 封通知', function () {
      var before = MAIL_SINK_.length;
      var s = processScheduledTasks_();
      assertEqual_([s.expired, s.reminded, s.overduePickup, s.overdueReturn], [1, 1, 2, 1]);
      assertEqual_(MAIL_SINK_.length - before, 5, '5 封通知');
      assertEqual_(statusOf('BK-2026-0101').status, STATUS.PENDING);
      assertEqual_(statusOf('BK-2026-0101').flags.remind24h, true);
      assertEqual_(statusOf('BK-2026-0102').status, STATUS.EXPIRED);
      assertEqual_(statusOf('BK-2026-0102').flags.expired, true);
      assertEqual_(statusOf('BK-2026-0103').status, STATUS.OVERDUE_PICKUP);
      assertEqual_(statusOf('BK-2026-0104').status, STATUS.OVERDUE_RETURN);
      assertEqual_(statusOf('BK-2026-0105').status, STATUS.OVERDUE_PICKUP, 'ACT 以自訂開始時間判定');
      assertEqual_(statusOf('BK-2026-0106').status, STATUS.APPROVED);
      assertEqual_(statusOf('BK-2026-0107').status, STATUS.PENDING);
      assertEqual_(statusOf('BK-2026-0107').flags.remind24h, undefined);
      assertEqual_(statusOf('BK-2026-0108').status, STATUS.PICKED_UP);
      var subjects = MAIL_SINK_.slice(before).map(function (m) { return m.subject; }).join('\n');
      assert_(subjects.indexOf('自動過期') >= 0 && subjects.indexOf('逾時未領取') >= 0 && subjects.indexOf('逾時未歸還') >= 0 && subjects.indexOf('待審提醒') >= 0, subjects);
    });
    test_('排程：第二次執行不重複寄信、不改狀態（冪等）', function () {
      var before = MAIL_SINK_.length;
      var logsBefore = SpreadsheetApp.openById(getSpreadsheetId_()).getSheetByName(SHEET_NAMES.LOGS).getLastRow();
      var s = processScheduledTasks_();
      assertEqual_([s.expired, s.reminded, s.overduePickup, s.overdueReturn, s.mailsSent], [0, 0, 0, 0, 0]);
      assertEqual_(MAIL_SINK_.length - before, 0, '無重複郵件');
      assertEqual_(statusOf('BK-2026-0101').status, STATUS.PENDING);
      assertEqual_(statusOf('BK-2026-0105').status, STATUS.OVERDUE_PICKUP);
      var logsAfter = SpreadsheetApp.openById(getSpreadsheetId_()).getSheetByName(SHEET_NAMES.LOGS).getLastRow();
      assertEqual_(logsAfter, logsBefore, '無新增操作紀錄');
    });
    test_('排程：逾時未領取後仍可領取；第三次執行仍冪等', function () {
      var p = recordPickup(handlerCtx_(), { applicationId: 'BK-2026-0103', ipad: 5, pencil: 0 });
      assertEqual_(p.application.status, STATUS.PICKED_UP);
      Clock_.override = new Date('2026-09-15T01:00:00Z'); // 09:00 HK
      var s = processScheduledTasks_();
      assertEqual_(s.overdueReturn, 1, '0103 於 2026-09-14 15:00 結束且未還 → 逾時未歸還');
      assertEqual_(statusOf('BK-2026-0103').status, STATUS.OVERDUE_RETURN);
      var before = MAIL_SINK_.length;
      processScheduledTasks_();
      assertEqual_(MAIL_SINK_.length, before);
    });
    test_('排程：取鎖失敗時安全略過', function () {
      var lock = LockService.getScriptLock();
      lock.waitLock(1000);
      try {
        var s = processScheduledTasks_();
        assertEqual_(s.mailsSent, 0);
      } finally {
        lock.releaseLock();
      }
    });
  });
}

// ---------------------------------------------------------------------------
// 7. migration v2 → v3
// ---------------------------------------------------------------------------
/** 建立 v2 舊版試算表（20 欄申請主表、無 schemaVersion、含 ACT／'9:10'／特別活動 舊資料）。回傳 ID。 */
function buildLegacyV2Spreadsheet_() {
  var ss = SpreadsheetApp.create('iPad 預約系統 v2 測試');
  var apps = ss.getSheets()[0].setName(SHEET_NAMES.APPLICATIONS);
  var v2AppHeaders = HEADERS[SHEET_NAMES.APPLICATIONS].slice(0, 20);
  apps.getRange(1, 1, 4, 20).setValues([
    v2AppHeaders,
    ['BK-2025-0001', 'old.teacher@' + TEST_HD_, '舊教師', '3C', 30, '數學', '', STATUS.RETURNED, '2025-10-01 09:00:00', '2025-10-02 15:40:00', TEST_ADMIN_EMAIL_, '2025-10-01 10:00:00', '', '', '', '', '', '', '', ''],
    ['BK-2025-0002', 'old.teacher@' + TEST_HD_, '舊教師', '6A', 40, '特別活動', '=舊備註', STATUS.APPROVED, '2025-11-01 09:00:00', '2025-11-01 09:30:00', TEST_ADMIN_EMAIL_, '2025-11-01 09:30:00', '特別活動', '畢業禮綵排', '9:10', '18:30', '是', '否', '是', '星期日'],
    ['BK-2025-0003', 'old.teacher@' + TEST_HD_, '舊教師', '1B', 20, '英國語文', '', STATUS.PENDING, '2025-12-01 09:00:00', '2025-12-01 09:00:00', '', '', '一般課堂', '', '', '', '', '', '', '']
  ]);
  var details = ss.insertSheet(SHEET_NAMES.DETAILS, 1);
  details.getRange(1, 1, 4, 7).setValues([
    HEADERS[SHEET_NAMES.DETAILS],
    ['BK-2025-0001', '2025-10-02', 'P02', '9:10', '9:45', 30, 0],
    ['BK-2025-0002', '2025-11-02', 'ACT', '9:10', '18:30', 40, 10],
    ['BK-2025-0003', '2025-12-03', 'P01', '8:35', '9:10', 20, 0]
  ]);
  var handovers = ss.insertSheet(SHEET_NAMES.HANDOVERS, 2);
  handovers.getRange(1, 1, 2, 8).setValues([HEADERS[SHEET_NAMES.HANDOVERS], ['HO-OLD00001', 'BK-2025-0001', '領取', '2025-10-02 09:05:00', 30, 0, TEST_HANDLER_EMAIL_, '']]);
  var slots = ss.insertSheet(SHEET_NAMES.SLOTS, 3);
  slots.getRange(1, 1, DEFAULT_SLOTS.length + 1, 7).setValues([HEADERS[SHEET_NAMES.SLOTS]].concat(DEFAULT_SLOTS.map(function (r) { return [r[0], r[1].replace(/^0/, ''), r[2].replace(/^0/, ''), r[3], r[4], r[5], r[6]]; })));
  var settings = ss.insertSheet(SHEET_NAMES.SETTINGS, 4);
  settings.getRange(1, 1, 8, 2).setValues([
    HEADERS[SHEET_NAMES.SETTINGS],
    [SETTING_KEYS.IPAD_TOTAL, 80],
    [SETTING_KEYS.PENCIL_TOTAL, 60],
    [SETTING_KEYS.ALLOWED_DOMAIN, TEST_HD_],
    [SETTING_KEYS.ADVANCE_DAYS, 14],
    [SETTING_KEYS.CUTOFF_HOURS, 0],
    [SETTING_KEYS.TIMEZONE, 'Asia/Hong_Kong'],
    [SETTING_KEYS.SCHOOL_YEAR, '2025-2026']
  ]);
  var staff = ss.insertSheet(SHEET_NAMES.STAFF, 5);
  staff.getRange(1, 1, 2, 3).setValues([HEADERS[SHEET_NAMES.STAFF], [TEST_ADMIN_EMAIL_, '管理員', 'TRUE']]);
  var logs = ss.insertSheet(SHEET_NAMES.LOGS, 6);
  logs.getRange(1, 1, 2, 6).setValues([HEADERS[SHEET_NAMES.LOGS].slice(0, 6), ['2025-10-01 09:00:00', 'old.teacher@' + TEST_HD_, '提交申請', 'BK-2025-0001', '', '{}']]);
  return ss.getId();
}

function testMigration() {
  var savedOverride = SPREADSHEET_ID_OVERRIDE_;
  var savedProps = PROP_OVERRIDE_;
  var savedClock = Clock_.override;
  var savedSink = MAIL_SINK_;
  var ids = [];
  clearAllCaches_();
  try {
    var id = buildLegacyV2Spreadsheet_();
    ids.push(id);
    SPREADSHEET_ID_OVERRIDE_ = id;
    PROP_OVERRIDE_ = testProps_();
    Clock_.override = new Date(TEST_NOW_ISO_);
    MAIL_SINK_ = [];
    clearAllCaches_();
    var ss = SpreadsheetApp.openById(id);
    var snapshotApps = ss.getSheetByName(SHEET_NAMES.APPLICATIONS).getDataRange().getValues();
    var snapshotDetails = ss.getSheetByName(SHEET_NAMES.DETAILS).getDataRange().getValues();
    test_('migration v2→v3：只追加欄位／設定列，保留原值，建立備份', function () {
      assertEqual_(readSchemaVersion_(), 2, '無 schemaVersion 視為 v2');
      var result = migrateSystem_();
      if (result.backupId) ids.push(result.backupId);
      assertEqual_([result.fromVersion, result.toVersion], [2, 3]);
      assert_(result.backupId, '應有備份');
      assertEqual_(result.createdSheets, [SHEET_NAMES.BLOCKS], '補建 封鎖日期');
      assertEqual_(result.addedHeaders[SHEET_NAMES.APPLICATIONS], HEADERS[SHEET_NAMES.APPLICATIONS].slice(20), '申請主表補 5 欄');
      assertEqual_(result.addedHeaders[SHEET_NAMES.LOGS], HEADERS[SHEET_NAMES.LOGS].slice(6), '操作紀錄補 4 欄');
      assert_(!result.addedHeaders[SHEET_NAMES.DETAILS], '明細不變');
      var expectedSettings = [SETTING_KEYS.REMIND_HOURS, SETTING_KEYS.CLASS_OPTIONS, SETTING_KEYS.SUBJECT_OPTIONS, SETTING_KEYS.SCHEMA_VERSION, SETTING_KEYS.OVERDUE_PICKUP_MIN, SETTING_KEYS.OVERDUE_RETURN_MIN, SETTING_KEYS.SYSTEM_VERSION, SETTING_KEYS.SPECIAL_AFTER_HOURS, SETTING_KEYS.SPECIAL_EARLIEST_START, SETTING_KEYS.SPECIAL_LATEST_END];
      assertEqual_(result.addedSettings, expectedSettings, '補齊設定列（含三個特別活動設定）');
      var after = ss.getSheetByName(SHEET_NAMES.APPLICATIONS).getDataRange().getValues();
      assertEqual_(after[0], HEADERS[SHEET_NAMES.APPLICATIONS], '標題列完整 v3');
      for (var r = 1; r < snapshotApps.length; r++) {
        assertEqual_(after[r].slice(0, 20), snapshotApps[r], '第 ' + r + ' 列原值不變');
        assert_(after[r].slice(20).every(function (v) { return v === ''; }), '新欄為空');
      }
      assertEqual_(after[2][COL.APP.CUSTOM_START], '9:10', '舊時間格式原樣保留');
      assertEqual_(after[2][COL.APP.REMARK], '=舊備註', '舊備註不被改寫');
      assertEqual_(ss.getSheetByName(SHEET_NAMES.DETAILS).getDataRange().getValues(), snapshotDetails, '明細完全不變');
      var settings = getSettings_();
      assertEqual_([settings.ipadTotal, settings.pencilTotal, settings.advanceDays], [80, 60, 14], '舊設定值保留');
      assertEqual_([settings.afterHoursTime, settings.specialEarliestStart, settings.specialLatestEnd, settings.remindHours, settings.overduePickupMinutes], ['17:15', '07:00', '22:00', 24, 30]);
      assertEqual_(readSchemaVersion_(), 3);
      var logs = ss.getSheetByName(SHEET_NAMES.LOGS).getDataRange().getValues();
      assertEqual_(logs[0], HEADERS[SHEET_NAMES.LOGS]);
      assertEqual_(logs[1].slice(0, 6), ['2025-10-01 09:00:00', 'old.teacher@' + TEST_HD_, '提交申請', 'BK-2025-0001', '', '{}'], '舊紀錄保留');
      assert_(logs.some(function (l) { return l[COL.LOG.ACTION] === LOG_ACTIONS.MIGRATION; }), '寫入 migration 紀錄');
      var backup = SpreadsheetApp.openById(result.backupId);
      assertEqual_(backup.getSheetByName(SHEET_NAMES.APPLICATIONS).getDataRange().getValues()[0].length, 20, '備份保留 v2 欄數');
    });
    test_('migration 再執行：冪等、不再備份、不再寫 migration 紀錄', function () {
      var logsBefore = ss.getSheetByName(SHEET_NAMES.LOGS).getLastRow();
      var result = migrateSystem_();
      assertEqual_([result.fromVersion, result.toVersion, result.backupId, result.addedSettings, result.createdSheets], [3, 3, '', [], []]);
      assertEqual_(Object.keys(result.addedHeaders), []);
      assertEqual_(ss.getSheetByName(SHEET_NAMES.LOGS).getLastRow(), logsBefore);
    });
    test_('migration 後舊資料可讀：ACT／9:10 正常化、特別活動旗標', function () {
      var data = loadBookingData_(true);
      var app = data.idx.appsById.get('BK-2025-0002');
      assertEqual_([app.bookingType, app.activityName, app.customStart, app.customEnd, app.afterHoursConfirm, app.needsSpecialApproval, app.specialApprovalReason], [BOOKING_TYPE_SPECIAL, '畢業禮綵排', '09:10', '18:30', true, true, '星期日']);
      var d = data.idx.detailsByApp.get('BK-2025-0002')[0];
      assertEqual_([d.slotId, d.start, d.end], ['ACT', '09:10', '18:30']);
      var d3 = data.idx.detailsByApp.get('BK-2025-0003')[0];
      assertEqual_([d3.start, d3.end], ['08:35', '09:10']);
      var slots = getEnabledSlots_();
      assertEqual_([slots[0].start, slots[0].end], ['08:35', '09:10'], '時段 8:35 → 08:35');
      var view = toApplication_(app, data.idx.detailsByApp.get('BK-2025-0002'), [], adminCtx_(), data, Clock_.now());
      assertEqual_([view.isSunday, view.date, view.remark], [true, '2025-11-02', '=舊備註']);
      var old = data.idx.appsById.get('BK-2025-0001');
      var oldView = toApplication_(old, data.idx.detailsByApp.get('BK-2025-0001'), [], adminCtx_(), data, Clock_.now());
      assertEqual_([oldView.bookingType, oldView.slots[0].label], [BOOKING_TYPE_NORMAL, '第 2 節'], '空預約類型視為一般課堂');
    });
    test_('setupSystem_ 對既有試算表：不重建、跑 migration、安裝觸發器', function () {
      var props = {};
      props[PROP_KEYS.SPREADSHEET_ID] = id;
      PROP_OVERRIDE_ = testProps_(props);
      SPREADSHEET_ID_OVERRIDE_ = null;
      clearAllCaches_();
      var r = setupSystem_();
      assertEqual_([r.spreadsheetId, r.created, r.migration.fromVersion], [id, false, 3]);
      var triggers = ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === SCHEDULER_HANDLER_NAME_; });
      assertEqual_(triggers.length, 1, '排程觸發器只一個');
      r = setupSystem_();
      assertEqual_(ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === SCHEDULER_HANDLER_NAME_; }).length, 1, '重複執行不重複安裝');
      for (var i = 0; i < triggers.length; i++) ScriptApp.deleteTrigger(triggers[i]);
      ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === SCHEDULER_HANDLER_NAME_) ScriptApp.deleteTrigger(t); });
    });
    test_('setupSystem_ 缺少 SPREADSHEET_ID 時擲回錯誤且不建立新試算表；createNewSpreadsheetAndSetup_ 在已設定時拒絕', function () {
      var emptyProps = {};
      emptyProps[PROP_KEYS.SPREADSHEET_ID] = '';
      PROP_OVERRIDE_ = testProps_(emptyProps);
      SPREADSHEET_ID_OVERRIDE_ = null;
      var threw = false;
      try { setupSystem_(); } catch (err) { threw = String(err).indexOf(PROP_KEYS.SPREADSHEET_ID) >= 0; }
      assertEqual_(threw, true, '應擲回含 SPREADSHEET_ID 的錯誤');
      var setProps = {};
      setProps[PROP_KEYS.SPREADSHEET_ID] = id;
      PROP_OVERRIDE_ = testProps_(setProps);
      var threw2 = false;
      try { createNewSpreadsheetAndSetup_(); } catch (err2) { threw2 = String(err2).indexOf('不會建立新試算表') >= 0; }
      assertEqual_(threw2, true, '已設定時不可另建');
    });
  } finally {
    for (var k = 0; k < ids.length; k++) {
      try { DriveApp.getFileById(ids[k]).setTrashed(true); } catch (err) { console.error('無法刪除測試檔 ' + ids[k] + ': ' + err); }
    }
    SPREADSHEET_ID_OVERRIDE_ = savedOverride;
    PROP_OVERRIDE_ = savedProps;
    Clock_.override = savedClock;
    MAIL_SINK_ = savedSink;
    clearAllCaches_();
  }
}

// ---------------------------------------------------------------------------
// 8. 路由與回應封套
// ---------------------------------------------------------------------------
function testRouterAndEnvelope() {
  test_('路由：白名單 map、未知 action → UNKNOWN_ACTION、GET 非 health → METHOD_NOT_ALLOWED', function () {
    assert_(Object.prototype.toString.call(ACTIONS_) === '[object Object]');
    assert_(!ACTIONS_.constructor || ACTIONS_.hasOwnProperty('health'), 'health 存在');
    var expected = ['health', 'whoami', 'bootstrap', 'getWeekData', 'getMyApplications', 'submitApplication', 'submitSpecialActivity', 'cancelMyApplication', 'getPendingApplications', 'approveApplication', 'rejectApplication', 'getApprovedForHandover', 'recordPickup', 'recordReturn', 'searchApplications'];
    assertEqual_(Object.keys(ACTIONS_).sort(), expected.sort());
    var out = handleRequest_('POST', { postData: { contents: JSON.stringify({ action: 'toString', idToken: 'x', payload: {} }) } });
    var body = JSON.parse(out.getContent());
    assertEqual_([body.ok, body.error.code], [false, ERROR_CODES.UNKNOWN_ACTION], 'toString 不可被當成 action');
    var out2 = handleRequest_('POST', { postData: { contents: JSON.stringify({ action: '__proto__', idToken: 'x', payload: {} }) } });
    assertEqual_(JSON.parse(out2.getContent()).error.code, ERROR_CODES.UNKNOWN_ACTION);
    var out3 = handleRequest_('GET', { parameter: { action: 'getWeekData' } });
    assertEqual_(JSON.parse(out3.getContent()).error.code, ERROR_CODES.METHOD_NOT_ALLOWED, 'GET 不可呼叫 getWeekData');
    var out4 = handleRequest_('POST', { postData: { contents: '{bad json' } });
    assertEqual_(JSON.parse(out4.getContent()).error.code, ERROR_CODES.VALIDATION_ERROR, '非法 JSON');
    var out5 = handleRequest_('POST', { postData: { contents: JSON.stringify({ action: 'getWeekData', payload: {} }) } });
    assertEqual_(JSON.parse(out5.getContent()).error.code, ERROR_CODES.AUTH_REQUIRED, '沒有 idToken');
  });
  test_('health：GET 無需 token，回傳版本與 requestId', function () {
    var savedProps = PROP_OVERRIDE_;
    PROP_OVERRIDE_ = testProps_();
    try {
      var out = handleRequest_('GET', { parameter: { action: 'health' } });
      var body = JSON.parse(out.getContent());
      assertEqual_(body.ok, true);
      assertEqual_(body.data.version, VERSION);
      assert_(body.requestId && body.requestId.length > 0);
      assertEqual_(out.mimeType, ContentService.MimeType.JSON);
    } finally {
      PROP_OVERRIDE_ = savedProps;
    }
  });
  test_('角色權限：教師呼叫 approveApplication → FORBIDDEN_ROLE', function () {
    withTestSpreadsheet_(function () {
      var v = AUTH_TEST_VECTORS_;
      var savedProvider = JWKS_PROVIDER_OVERRIDE_;
      JWKS_PROVIDER_OVERRIDE_ = function () { return { keys: [v.jwk] }; };
      cacheRemove_(['tok_' + sha256Hex_(v.tokens.valid), JWKS_CACHE_KEY_]);
      Clock_.override = new Date(v.nowSec * 1000);
      try {
        var out = handleRequest_('POST', { postData: { contents: JSON.stringify({ action: 'approveApplication', idToken: v.tokens.valid, payload: { applicationId: 'BK-2026-0001' } }) } });
        var body = JSON.parse(out.getContent());
        assertEqual_([body.ok, body.error.code], [false, ERROR_CODES.FORBIDDEN_ROLE]);
        var who = handleRequest_('POST', { postData: { contents: JSON.stringify({ action: 'whoami', idToken: v.tokens.valid, payload: {} }) } });
        var whoBody = JSON.parse(who.getContent());
        assertEqual_([whoBody.ok, whoBody.data.user.email, whoBody.data.user.roles], [true, v.expectedEmail, [ROLES.TEACHER]]);
        var logs = SpreadsheetApp.openById(getSpreadsheetId_()).getSheetByName(SHEET_NAMES.LOGS).getDataRange().getValues();
        assert_(logs.some(function (l) { return l[COL.LOG.ACTION] === LOG_ACTIONS.ACCESS_DENIED; }), '寫入 拒絕存取 紀錄');
      } finally {
        cacheRemove_(['tok_' + sha256Hex_(v.tokens.valid), JWKS_CACHE_KEY_]);
        JWKS_PROVIDER_OVERRIDE_ = savedProvider;
      }
    });
  });
}

// ---------------------------------------------------------------------------
// 9. getWeekData 效能
// ---------------------------------------------------------------------------
/** 回傳 {emptyMs, existingMs, loadedMs, detailRows}；於臨時試算表執行後刪除。 */
function benchmarkGetWeekData() {
  var timings = { emptyMs: 0, existingMs: 0, loadedMs: 0, detailRows: 0 };
  withTestSpreadsheet_(function (id, ss) {
    var ctx = teacherCtx_();
    test_('效能：getWeekData 空表／少量／1000 筆明細', function () {
      var t0 = Date.now();
      console.time('getWeekData 空表');
      var w0 = getWeekData(ctx, { date: '2026-09-16' });
      console.timeEnd('getWeekData 空表');
      timings.emptyMs = Date.now() - t0;
      assertEqual_(w0.week.days.length, 7);

      submitApplication(ctx, regularPayload_('2026-09-16', ['P01'], 10, 0));
      submitSpecialActivity(ctx, specialPayload_('2026-09-16', '14:00', '16:00', 10, 0));
      var t1 = Date.now();
      console.time('getWeekData 少量資料');
      var w1 = getWeekData(ctx, { date: '2026-09-16' });
      console.timeEnd('getWeekData 少量資料');
      timings.existingMs = Date.now() - t1;
      assertEqual_(w1.week.special['2026-09-16'].activityCount, 1);

      // 產生 250 筆申請 × 4 筆明細 = 1000 筆明細，一次 setValues 寫入
      var appRows = [], detailRows = [];
      var dates = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19'];
      var statuses = [STATUS.PENDING, STATUS.APPROVED, STATUS.RETURNED, STATUS.CANCELLED];
      for (var i = 0; i < 250; i++) {
        var appId = 'BK-2026-' + String(5000 + i);
        var isSpecial = i % 10 === 0;
        var fields = { className: '1A', students: 10, subject: isSpecial ? BOOKING_TYPE_SPECIAL : '數學', remark: '', bookingType: isSpecial ? BOOKING_TYPE_SPECIAL : BOOKING_TYPE_NORMAL, activityName: isSpecial ? '活動' + i : '', customStart: isSpecial ? '13:00' : '', customEnd: isSpecial ? '16:00' : '', afterHoursConfirm: false, needsSpecialApproval: false, specialApprovalReason: '' };
        var row = newApplicationRow_(appId, ctx, fields, '2026-09-01 09:00:00');
        row[COL.APP.STATUS] = statuses[Math.floor(i / 7) % statuses.length];
        appRows.push(row);
        var date = dates[i % dates.length];
        if (isSpecial) {
          for (var k = 0; k < 4; k++) detailRows.push([appId, date, ACT_SLOT_ID, '13:00', '16:00', 1, 0]);
        } else {
          var startIdx = Math.floor(i / 6) % 6;
          for (var s = 0; s < 4; s++) {
            var slot = DEFAULT_SLOTS[startIdx + s];
            detailRows.push([appId, date, slot[0], slot[1], slot[2], 1, 0]);
          }
        }
      }
      var appsSheet = ss.getSheetByName(SHEET_NAMES.APPLICATIONS);
      appsSheet.getRange(appsSheet.getLastRow() + 1, 1, appRows.length, appRows[0].length).setValues(appRows);
      var detailSheet = ss.getSheetByName(SHEET_NAMES.DETAILS);
      detailSheet.getRange(detailSheet.getLastRow() + 1, 1, detailRows.length, 7).setValues(detailRows);
      timings.detailRows = detailSheet.getLastRow() - 1;
      resetRequestMemo_();
      var t2 = Date.now();
      console.time('getWeekData 1000 筆明細');
      var w2 = getWeekData(ctx, { date: '2026-09-16' });
      console.timeEnd('getWeekData 1000 筆明細');
      timings.loadedMs = Date.now() - t2;
      assert_(timings.detailRows >= 1000, '明細列數 ' + timings.detailRows);
      var p01 = w2.week.cells['2026-09-16|P01'];
      assert_(p01.ipadPending + p01.ipadApproved > 10, '統計包含模擬資料');
      assert_(w2.week.special['2026-09-16'].activityCount > 1);
      console.log('benchmarkGetWeekData: ' + JSON.stringify(timings));
    });
  });
  return timings;
}
