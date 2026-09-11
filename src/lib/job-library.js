import {
  enforceJdMode,
  isMeaningfulJd
} from "./jd.js";

export const JOB_LIBRARY_DB_NAME = "zhi-dao-le-job-library";
export const LEGACY_HISTORY_KEY = "zhi-dao-le:history:v1";
export const LEGACY_MIGRATION_KEY = "zhi-dao-le:history-migrated:v2";
export const JOB_FINGERPRINT_VERSION = 1;
export const JOB_LIBRARY_EXPORT_VERSION = 1;

export function serializeJobLibrary(records, { exportedAt = new Date().toISOString() } = {}) {
  return JSON.stringify({ version: JOB_LIBRARY_EXPORT_VERSION, exportedAt, jobs: (records || []).map((record) => ({
    id: record.id, createdAt: record.createdAt, updatedAt: record.updatedAt, lastOpenedAt: record.lastOpenedAt,
    revision: record.revision, rawJd: record.rawJd, mode: record.mode, searchOfficialLink: record.searchOfficialLink,
    data: record.data, fingerprint: record.fingerprint
  })) }, null, 2);
}

export function parseJobLibraryExport(input) {
  let payload;
  try { payload = typeof input === "string" ? JSON.parse(input) : input; } catch { throw new Error("invalid_json"); }
  if (!payload || !Array.isArray(payload.jobs)) throw new Error("invalid_export");
  return payload.jobs.filter((job) => job && typeof job === "object" && String(job.rawJd || "").trim());
}

export async function mergeJobLibraryRecords(library, records) {
  let imported = 0, skipped = 0;
  for (const item of records || []) {
    const normalized = await normalizeRecord(item);
    const existing = normalized.fingerprint ? await library.findExact(normalized) : await library.get(normalized.id);
    if (existing && existing.updatedAt >= normalized.updatedAt) { skipped += 1; continue; }
    await library.put(normalized); imported += 1;
  }
  return { imported, skipped };
}

const STORE_NAME = "jobs";
const DB_VERSION = 1;

const canonicalizeRawJd = (value) =>
  String(value || "")
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const effectiveOptions = ({ rawJd, mode, searchOfficialLink }) => {
  const safeMode = ["faithful", "polished", "confidential"].includes(mode)
    ? mode
    : "confidential";
  return {
    version: JOB_FINGERPRINT_VERSION,
    rawJd: canonicalizeRawJd(rawJd),
    mode: safeMode,
    searchOfficialLink:
      safeMode !== "confidential" && searchOfficialLink === true
  };
};

const fingerprintPayload = (input) => JSON.stringify(effectiveOptions(input));

const fallbackHash = (value) => {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
    second ^= second >>> 13;
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(
    second >>> 0
  )
    .toString(16)
    .padStart(8, "0")}`;
};

export async function createJobFingerprint(input) {
  const payload = fingerprintPayload(input);
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(payload)
    );
    return [...new Uint8Array(digest)]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
  }
  return fallbackHash(payload);
}

export async function isExactLibraryMatch(record, input) {
  if (!record?.fingerprint || !isMeaningfulJd(record.data)) return false;
  return (
    record.fingerprint === (await createJobFingerprint(input)) &&
    fingerprintPayload(record) === fingerprintPayload(input)
  );
}

const createId = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `job-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const activityTime = (record) =>
  Date.parse(record.lastOpenedAt || record.updatedAt || record.createdAt || 0) || 0;

export const sortLibraryJobs = (items) =>
  [...items].sort((left, right) => activityTime(right) - activityTime(left));

const normalizedSearchText = (value) =>
  String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/\s+/g, "")
    .trim();

export function buildLibrarySearchText(record) {
  const data = enforceJdMode(record.data, record.mode);
  return normalizedSearchText(
    [
      data.libraryCompany,
      data.libraryRole,
      data.company,
      data.role,
      data.locations.join(" "),
      data.summary,
      data.responsibilities.join(" "),
      data.requirements.join(" "),
      data.bonusPoints.join(" "),
      record.rawJd
    ].join(" ")
  );
}

export function searchLibraryJobs(items, query) {
  const terms = String(query || "")
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .trim()
    .split(/\s+/)
    .map(normalizedSearchText)
    .filter(Boolean);
  if (!terms.length) return sortLibraryJobs(items);
  return sortLibraryJobs(
    items.filter((record) => {
      const haystack = record.searchText || buildLibrarySearchText(record);
      return terms.every((term) => haystack.includes(term));
    })
  );
}

export function groupLibraryJobs(items) {
  const companies = new Map();
  for (const record of sortLibraryJobs(items)) {
    const company =
      record.data?.libraryCompany || record.data?.company || "公司待确认";
    if (!companies.has(company)) {
      companies.set(company, { company, jobs: [] });
    }
    companies.get(company).jobs.push(record);
  }
  return [...companies.values()];
}

const requestResult = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("storage_failed"));
  });

const transactionDone = (transaction) =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error || new Error("storage_failed"));
    transaction.onabort = () =>
      reject(transaction.error || new Error("storage_aborted"));
  });

const normalizeRecordShape = (record = {}, fingerprint) => {
  const options = effectiveOptions(record);
  const data = enforceJdMode(record.data, options.mode);
  const createdAt = record.createdAt || new Date().toISOString();
  const normalized = {
    id: String(record.id || createId()),
    createdAt,
    updatedAt: record.updatedAt || createdAt,
    lastOpenedAt: record.lastOpenedAt || record.updatedAt || createdAt,
    revision: Math.max(1, Number(record.revision || 1)),
    rawJd: String(record.rawJd || ""),
    mode: options.mode,
    searchOfficialLink: options.searchOfficialLink,
    data,
    ...(fingerprint ? { fingerprint } : {})
  };
  return { ...normalized, searchText: buildLibrarySearchText(normalized) };
};

const normalizeRecord = async (record = {}) => {
  const options = effectiveOptions(record);
  const fingerprint = options.rawJd
    ? record.fingerprint || (await createJobFingerprint(options))
    : undefined;
  return normalizeRecordShape(record, fingerprint);
};

export function openJobLibrary({
  indexedDB = globalThis.indexedDB,
  dbName = JOB_LIBRARY_DB_NAME
} = {}) {
  let databasePromise;
  let migrationPromise;

  const openDatabase = () => {
    if (!indexedDB) return Promise.reject(new Error("storage_unavailable"));
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (database.objectStoreNames.contains(STORE_NAME)) return;
        const store = database.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("fingerprint", "fingerprint", { unique: true });
        store.createIndex("lastOpenedAt", "lastOpenedAt");
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => database.close();
        resolve(database);
      };
      request.onerror = () =>
        reject(request.error || new Error("storage_open_failed"));
      request.onblocked = () => reject(new Error("storage_blocked"));
    });
    return databasePromise;
  };

  const get = async (id) => {
    const database = await openDatabase();
    const transaction = database.transaction(STORE_NAME, "readonly");
    return requestResult(transaction.objectStore(STORE_NAME).get(id));
  };

  const findByFingerprint = async (fingerprint) => {
    if (!fingerprint) return null;
    const database = await openDatabase();
    const transaction = database.transaction(STORE_NAME, "readonly");
    return (
      (await requestResult(
        transaction.objectStore(STORE_NAME).index("fingerprint").get(fingerprint)
      )) || null
    );
  };

  const put = async (record) => {
    const database = await openDatabase();
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(record);
    await transactionDone(transaction);
    return record;
  };

  const list = async () => {
    const database = await openDatabase();
    const transaction = database.transaction(STORE_NAME, "readonly");
    return sortLibraryJobs(
      await requestResult(transaction.objectStore(STORE_NAME).getAll())
    );
  };

  const findExact = async (input) => {
    const fingerprint = await createJobFingerprint(input);
    const record = await findByFingerprint(fingerprint);
    return (await isExactLibraryMatch(record, input)) ? record : null;
  };

  const saveGenerated = async (
    { rawJd, mode, searchOfficialLink, data },
    { now = new Date().toISOString() } = {}
  ) => {
    const fingerprint = await createJobFingerprint({
      rawJd,
      mode,
      searchOfficialLink
    });
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      let record;
      const request = store.index("fingerprint").get(fingerprint);
      request.onsuccess = () => {
        const existing = request.result;
        record = normalizeRecordShape(
          {
            ...existing,
            id: existing?.id || createId(),
            fingerprint,
            rawJd,
            mode,
            searchOfficialLink,
            data,
            createdAt: existing?.createdAt || now,
            updatedAt: now,
            lastOpenedAt: now,
            revision: existing ? Number(existing.revision || 1) + 1 : 1
          },
          fingerprint
        );
        store.put(record);
      };
      transaction.oncomplete = () => resolve(record);
      transaction.onerror = () =>
        reject(transaction.error || new Error("storage_failed"));
      transaction.onabort = () =>
        reject(transaction.error || new Error("storage_aborted"));
    });
  };

  const update = async (
    id,
    patch,
    { now = new Date().toISOString() } = {}
  ) => {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      let record;
      let missingError;
      const request = store.get(id);
      request.onsuccess = () => {
        const existing = request.result;
        if (!existing) {
          missingError = new Error("job_not_found");
          transaction.abort();
          return;
        }
        record = normalizeRecordShape(
          {
            ...existing,
            ...patch,
            id,
            fingerprint: existing.fingerprint,
            rawJd: existing.rawJd,
            mode: existing.mode,
            searchOfficialLink: existing.searchOfficialLink,
            createdAt: existing.createdAt,
            updatedAt: now,
            lastOpenedAt: now,
            revision: Number(existing.revision || 1) + 1
          },
          existing.fingerprint
        );
        store.put(record);
      };
      transaction.oncomplete = () => resolve(record);
      transaction.onerror = () =>
        reject(missingError || transaction.error || new Error("storage_failed"));
      transaction.onabort = () =>
        reject(missingError || transaction.error || new Error("storage_aborted"));
    });
  };

  const touch = async (id, now = new Date().toISOString()) => {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      let record = null;
      const request = store.get(id);
      request.onsuccess = () => {
        if (!request.result) return;
        record = { ...request.result, lastOpenedAt: now };
        store.put(record);
      };
      transaction.oncomplete = () => resolve(record);
      transaction.onerror = () =>
        reject(transaction.error || new Error("storage_failed"));
      transaction.onabort = () =>
        reject(transaction.error || new Error("storage_aborted"));
    });
  };

  const remove = async (id) => {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      let existing = null;
      const request = store.get(id);
      request.onsuccess = () => {
        existing = request.result || null;
        if (existing) store.delete(id);
      };
      transaction.oncomplete = () => resolve(existing);
      transaction.onerror = () =>
        reject(transaction.error || new Error("storage_failed"));
      transaction.onabort = () =>
        reject(transaction.error || new Error("storage_aborted"));
    });
  };

  const clear = async () => {
    const database = await openDatabase();
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).clear();
    await transactionDone(transaction);
  };

  const migrateLegacy = (storage) => {
    if (migrationPromise) return migrationPromise;
    migrationPromise = (async () => {
      let legacyStorage = storage;
      if (legacyStorage === undefined) {
        try {
          legacyStorage = globalThis.localStorage;
        } catch {
          return list();
        }
      }
      if (!legacyStorage) {
        return list();
      }
      let legacy;
      try {
        if (legacyStorage.getItem(LEGACY_MIGRATION_KEY) === "1") return list();
        const parsed = JSON.parse(
          legacyStorage.getItem(LEGACY_HISTORY_KEY) || "[]"
        );
        legacy = Array.isArray(parsed) ? parsed : [];
      } catch {
        return list();
      }
      for (const item of [...legacy].reverse()) {
        const rawJd = String(item.rawJd || "");
        if (rawJd.trim()) {
          await saveGenerated(
            {
              rawJd,
              mode: item.mode,
              searchOfficialLink: item.searchOfficialLink,
              data: item.data
            },
            { now: item.createdAt || new Date().toISOString() }
          );
        } else {
          await put(await normalizeRecord(item));
        }
      }
      try {
        if (typeof legacyStorage.removeItem === "function") {
          legacyStorage.removeItem(LEGACY_HISTORY_KEY);
        } else {
          legacyStorage.setItem(LEGACY_HISTORY_KEY, "[]");
        }
      } catch {
        // IndexedDB migration succeeded; legacy cleanup is best-effort.
      }
      try {
        legacyStorage.setItem(LEGACY_MIGRATION_KEY, "1");
      } catch {
        // A later migration is idempotent because fingerprints are unique.
      }
      return list();
    })();
    return migrationPromise;
  };

  return {
    clear,
    findExact,
    get,
    list,
    migrateLegacy,
    put,
    remove,
    saveGenerated,
    touch,
    update
  };
}

let browserLibrary;
export const getBrowserJobLibrary = () => {
  if (!browserLibrary) browserLibrary = openJobLibrary();
  return browserLibrary;
};
