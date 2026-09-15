// Auth.gs — Google ID token 完整驗證（RS256 以 BigInt 驗簽、JWKS 快取、aud/iss/exp/email_verified/hd）及使用者角色解析。

var GOOGLE_JWKS_URL_ = 'https://www.googleapis.com/oauth2/v3/certs';
var GOOGLE_ISSUERS_ = ['accounts.google.com', 'https://accounts.google.com'];
var CLOCK_SKEW_SECONDS_ = 30;
var TOKEN_CACHE_MAX_TTL_ = 300;
var JWKS_CACHE_KEY_ = 'jwks_v3';
var JWKS_CACHE_MAX_TTL_ = 21600; // CacheService 上限 6 小時
var SHA256_DIGEST_INFO_PREFIX_ = '3031300d060960864801650304020105000420';

// 測試可注入的 JWKS 提供者：function () -> {keys: [...]}；null 表示使用 UrlFetchApp。
var JWKS_PROVIDER_OVERRIDE_ = null;

// ---------- 編碼工具 ----------

/** base64url → 位元組陣列（自行補齊 padding，避免不同執行環境差異）。 */
function base64UrlDecodeBytes_(s) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9\-_]*$/.test(s)) throw new ApiError_(ERROR_CODES.INVALID_TOKEN);
  var padded = s;
  while (padded.length % 4 !== 0) padded += '=';
  var bytes = Utilities.base64DecodeWebSafe(padded);
  return bytes;
}

/** base64url → UTF-8 字串。 */
function base64UrlDecodeString_(s) {
  var bytes = base64UrlDecodeBytes_(s);
  return Utilities.newBlob(bytes).getDataAsString('UTF-8');
}

/** 位元組陣列（-128..127 或 0..255）→ 小寫十六進位字串。 */
function bytesToHex_(bytes) {
  var hex = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i] & 0xff;
    hex += (b < 16 ? '0' : '') + b.toString(16);
  }
  return hex;
}

/** 位元組陣列 → BigInt。 */
function bytesToBigInt_(bytes) {
  var hex = bytesToHex_(bytes);
  return hex ? BigInt('0x' + hex) : BigInt(0);
}

/** 字串 → UTF-8 位元組陣列。 */
function stringToBytes_(s) {
  return Utilities.newBlob(s).getBytes();
}

function sha256Hex_(s) {
  return bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, stringToBytes_(s)));
}

// ---------- BigInt 數學 ----------

/** 模冪：base^exp mod mod（平方乘法）。 */
function modPow_(base, exp, mod) {
  if (mod === BigInt(1)) return BigInt(0);
  var result = BigInt(1);
  var b = base % mod;
  var e = exp;
  while (e > BigInt(0)) {
    if (e & BigInt(1)) result = (result * b) % mod;
    e >>= BigInt(1);
    b = (b * b) % mod;
  }
  return result;
}

/** BigInt → 固定長度（k 位元組）的十六進位字串，左側補零。 */
function bigIntToFixedHex_(n, byteLength) {
  var hex = n.toString(16);
  var target = byteLength * 2;
  if (hex.length > target) throw new ApiError_(ERROR_CODES.INVALID_TOKEN);
  while (hex.length < target) hex = '0' + hex;
  return hex;
}

// ---------- RSASSA-PKCS1-v1_5 SHA-256 ----------

/**
 * 驗證簽章。
 * @param {string} signingInput "header.payload"
 * @param {number[]} signatureBytes 簽章位元組
 * @param {{n: string, e: string}} jwk RSA 公開金鑰（base64url）
 * @return {boolean}
 */
function verifyRs256_(signingInput, signatureBytes, jwk) {
  var nBytes = base64UrlDecodeBytes_(jwk.n);
  var eBytes = base64UrlDecodeBytes_(jwk.e);
  // 去除前置零位元組以計算實際模數長度 k
  var start = 0;
  while (start < nBytes.length - 1 && (nBytes[start] & 0xff) === 0) start++;
  var k = nBytes.length - start;
  var n = bytesToBigInt_(nBytes);
  var e = bytesToBigInt_(eBytes);
  if (n <= BigInt(0) || e <= BigInt(0)) return false;
  if (signatureBytes.length !== k) return false;

  var s = bytesToBigInt_(signatureBytes);
  if (s >= n) return false;
  var m = modPow_(s, e, n);
  var em = bigIntToFixedHex_(m, k);

  var hashHex = bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, stringToBytes_(signingInput)));
  var t = SHA256_DIGEST_INFO_PREFIX_ + hashHex; // DigestInfo
  var tLen = t.length / 2;
  var psLen = k - tLen - 3;
  if (psLen < 8) return false;
  var expected = '0001';
  for (var i = 0; i < psLen; i++) expected += 'ff';
  expected += '00' + t;
  return constantTimeEqualHex_(em, expected);
}

function constantTimeEqualHex_(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------- JWKS ----------

/** 解析 Cache-Control 的 max-age（秒），缺少時回傳 3600。 */
function parseMaxAge_(headers) {
  if (!headers) return 3600;
  var cc = '';
  for (var key in headers) {
    if (Object.prototype.hasOwnProperty.call(headers, key) && key.toLowerCase() === 'cache-control') { cc = String(headers[key]); break; }
  }
  var m = /max-age\s*=\s*(\d+)/i.exec(cc);
  if (!m) return 3600;
  var n = parseInt(m[1], 10);
  return n > 0 ? n : 3600;
}

/** 由 Google 抓取 JWKS，並依 Cache-Control 快取。 */
function fetchJwks_() {
  if (JWKS_PROVIDER_OVERRIDE_) {
    var provided = JWKS_PROVIDER_OVERRIDE_();
    var providedKeys = provided && Array.isArray(provided.keys) ? provided.keys : [];
    CacheService.getScriptCache().put(JWKS_CACHE_KEY_, JSON.stringify(providedKeys), 3600);
    return providedKeys;
  }
  var resp = UrlFetchApp.fetch(GOOGLE_JWKS_URL_, { muteHttpExceptions: true, followRedirects: true });
  if (resp.getResponseCode() !== 200) throw new ApiError_(ERROR_CODES.INTERNAL_ERROR, '無法取得 Google 公開金鑰。');
  var body = JSON.parse(resp.getContentText());
  var keys = body && Array.isArray(body.keys) ? body.keys : [];
  var ttl = Math.min(parseMaxAge_(resp.getAllHeaders ? resp.getAllHeaders() : resp.getHeaders()), JWKS_CACHE_MAX_TTL_);
  try {
    CacheService.getScriptCache().put(JWKS_CACHE_KEY_, JSON.stringify(keys), ttl);
  } catch (err) {
    console.error('JWKS 快取寫入失敗: ' + err);
  }
  return keys;
}

/** 取得 JWKS（先讀快取）。forceRefresh 為 true 時略過快取。 */
function getJwks_(forceRefresh) {
  if (!forceRefresh) {
    var cached = CacheService.getScriptCache().get(JWKS_CACHE_KEY_);
    if (cached) {
      try { return JSON.parse(cached); } catch (err) { /* 快取損毀則重抓 */ }
    }
  }
  return fetchJwks_();
}

/** 依 kid 找金鑰；未命中則強制重抓一次。 */
function findJwk_(kid) {
  var keys = getJwks_(false);
  for (var i = 0; i < keys.length; i++) if (keys[i].kid === kid) return keys[i];
  keys = getJwks_(true);
  for (var j = 0; j < keys.length; j++) if (keys[j].kid === kid) return keys[j];
  return null;
}

// ---------- ID token 驗證 ----------

/**
 * 驗證 Google ID token。全部通過才回傳 {email, hd, name, sub}；否則拋出 ApiError_。
 * 成功結果以 sha256(token) 快取，TTL = min(exp - now, 300)。
 */
function verifyIdToken_(idToken) {
  if (!idToken || typeof idToken !== 'string') throw new ApiError_(ERROR_CODES.AUTH_REQUIRED);
  var cache = CacheService.getScriptCache();
  var cacheKey = 'tok_' + sha256Hex_(idToken);
  var nowSec = Math.floor(Clock_.now().getTime() / 1000);
  var cached = cache.get(cacheKey);
  if (cached) {
    try {
      var c = JSON.parse(cached);
      if (c && c.exp && c.exp + CLOCK_SKEW_SECONDS_ > nowSec) return { email: c.email, hd: c.hd, name: c.name, sub: c.sub };
    } catch (err) { /* 忽略損毀快取 */ }
  }

  var parts = idToken.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) throw new ApiError_(ERROR_CODES.INVALID_TOKEN);

  var header, payload;
  try {
    header = JSON.parse(base64UrlDecodeString_(parts[0]));
    payload = JSON.parse(base64UrlDecodeString_(parts[1]));
  } catch (err) {
    throw new ApiError_(ERROR_CODES.INVALID_TOKEN);
  }
  if (!header || header.alg !== 'RS256' || !header.kid || !payload || typeof payload !== 'object') {
    throw new ApiError_(ERROR_CODES.INVALID_TOKEN);
  }

  var jwk = findJwk_(String(header.kid));
  if (!jwk || jwk.kty !== 'RSA' || !jwk.n || !jwk.e) throw new ApiError_(ERROR_CODES.INVALID_TOKEN);

  var signature = base64UrlDecodeBytes_(parts[2]);
  if (!verifyRs256_(parts[0] + '.' + parts[1], signature, jwk)) throw new ApiError_(ERROR_CODES.INVALID_TOKEN);

  // 簽章正確後才檢查 claims
  var clientId = getProp_(PROP_KEYS.OAUTH_CLIENT_ID);
  var aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!clientId || aud.indexOf(clientId) < 0) throw new ApiError_(ERROR_CODES.INVALID_AUDIENCE);
  if (GOOGLE_ISSUERS_.indexOf(String(payload.iss)) < 0) throw new ApiError_(ERROR_CODES.INVALID_ISSUER);
  var exp = Number(payload.exp);
  if (!isFinite(exp) || exp + CLOCK_SKEW_SECONDS_ <= nowSec) throw new ApiError_(ERROR_CODES.TOKEN_EXPIRED);
  if (payload.email_verified !== true && payload.email_verified !== 'true') throw new ApiError_(ERROR_CODES.EMAIL_NOT_VERIFIED);
  var allowedHd = getProp_(PROP_KEYS.ALLOWED_HD).toLowerCase();
  var hd = String(payload.hd || '').toLowerCase();
  if (!allowedHd || hd !== allowedHd) throw new ApiError_(ERROR_CODES.FORBIDDEN_DOMAIN);
  if (!payload.email || typeof payload.email !== 'string') throw new ApiError_(ERROR_CODES.INVALID_TOKEN);

  var result = {
    email: payload.email.trim().toLowerCase(),
    hd: hd,
    name: payload.name ? String(payload.name) : '',
    sub: payload.sub ? String(payload.sub) : ''
  };
  var ttl = Math.min(Math.max(exp - nowSec, 1), TOKEN_CACHE_MAX_TTL_);
  try {
    cache.put(cacheKey, JSON.stringify({ email: result.email, hd: result.hd, name: result.name, sub: result.sub, exp: exp }), ttl);
  } catch (err) {
    console.error('Token 快取寫入失敗: ' + err);
  }
  return result;
}

/** 由已驗證 email 計算角色：永遠包含 teacher，再合併人員設定（啟用列）。 */
function resolveRoles_(email) {
  var staff = getStaff_();
  var roles = [ROLES.TEACHER];
  var extra = staff[email] || [];
  for (var i = 0; i < extra.length; i++) if (roles.indexOf(extra[i]) < 0) roles.push(extra[i]);
  return roles;
}

/** 驗證 token 並建立請求上下文 {email, hd, name, sub, roles, displayName}。 */
function getUserContext(idToken) {
  var identity = verifyIdToken_(idToken);
  var ctx = {
    email: identity.email,
    hd: identity.hd,
    name: identity.name,
    sub: identity.sub,
    roles: resolveRoles_(identity.email),
    displayName: '',
    requestId: '',
    clientRequestId: ''
  };
  ctx.displayName = resolveDisplayName_(ctx.email);
  return ctx;
}

/** displayName：最近一筆申請的教師姓名，否則 email @ 前部分。 */
function resolveDisplayName_(email) {
  var rows = readSheet_(SHEET_NAMES.APPLICATIONS);
  var latest = '', latestTime = '';
  for (var i = 1; i < rows.length; i++) {
    var row = rows[i];
    if (String(row[COL.APP.EMAIL] || '').toLowerCase() !== email) continue;
    var created = String(normalizeTimestamp_(row[COL.APP.CREATED]) || '');
    if (created >= latestTime && row[COL.APP.NAME]) {
      latestTime = created;
      latest = unsanitizeCell_(row[COL.APP.NAME]);
    }
  }
  if (latest) return latest;
  return email.split('@')[0];
}
