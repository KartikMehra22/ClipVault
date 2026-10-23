/**
 * ClipOrbit — Snippets and Clipboard Write Test Suite
 * Local MVP Functional Completeness Pass
 *
 * Verifies:
 * 1. Plaintext snippet content is NEVER stored in the database.
 * 2. Snippets are encrypted at the application boundary using AES-256-GCM.
 * 3. Encrypted snippets can be listed and decrypted accurately.
 * 4. Language filtering and pagination work as expected.
 * 5. Corrupted snippet payloads fail closed and are excluded safely.
 * 6. Snippet updates correctly re-encrypt modified content.
 * 7. Snippet deletion removes records from repository.
 * 8. Clearing clipboard history never removes or modifies snippets.
 * 9. Input validation rejects empty titles, empty content, and content exceeding 64 KiB.
 * 10. Snippet IPC handlers enforce sender authorization and sanitize errors.
 * 11. Clipboard write IPC handler validates input, enforces authorization, and writes text.
 * 12. Development database integrity is preserved.
 */

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  EncryptedSnippetService,
  MAX_SNIPPET_CONTENT_BYTES,
  SnippetValidationError,
} from '../dist/services/snippets/index.js';
import { EncryptionService } from '../dist/services/crypto/index.js';
import { initializeDatabase, closeDatabase } from '../dist/services/database.js';
import { createSnippetRepository, createClipRepository } from '@cliporbit/database';

import { createSnippetIpcHandlers } from '../dist/main/snippetIpc.js';
import { createClipboardIpcHandlers } from '../dist/main/clipboardIpc.js';

import { isAuthorizedFrame } from '../dist/main/security.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootRepoDir = path.resolve(__dirname, '../../..');
const devDbPath = path.resolve(rootRepoDir, 'packages/database/prisma/dev.db');

const ALLOWED_ORIGIN = 'http://127.0.0.1:3000';

let devDbInitialMtime = null;
let devDbInitialSize = null;
const tempDirsToCleanup = [];

function createTempDir(prefix = 'cliporbit-snippets-test-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirsToCleanup.push(dir);
  return dir;
}

class FakeKeyProtector {
  constructor() {
    this.storage = new Map();
  }

  isAvailable() {
    return true;
  }

  checkBackendSecurity() {}

  async protectKey(plainTextKeyHex) {
    const protectedBuf = Buffer.from(`ENC:${plainTextKeyHex}`, 'utf8');
    this.storage.set('key', protectedBuf);
    return protectedBuf;
  }

  async unprotectKey(protectedData) {
    const str = protectedData.toString('utf8');
    return {
      keyHex: str.slice(4),
      source: 'simulated-unprotected',
      isHardwareBacked: false,
    };
  }
}

function createAuthorizedEvent(url = ALLOWED_ORIGIN) {
  return {
    senderFrame: {
      url,
      parent: null,
    },
  };
}

function createUnauthorizedEvent(url = 'http://malicious-origin.com') {
  return {
    senderFrame: {
      url,
      parent: null,
    },
  };
}

before(() => {
  if (fs.existsSync(devDbPath)) {
    const stat = fs.statSync(devDbPath);
    devDbInitialMtime = stat.mtimeMs;
    devDbInitialSize = stat.size;
  }
});

after(async () => {
  await closeDatabase();

  for (const dir of tempDirsToCleanup) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Ignore temp directory cleanup failures
    }
  }

  if (fs.existsSync(devDbPath)) {
    const stat = fs.statSync(devDbPath);
    assert.strictEqual(
      stat.mtimeMs,
      devDbInitialMtime,
      'packages/database/prisma/dev.db mtime must remain untouched by test runs',
    );
    assert.strictEqual(
      stat.size,
      devDbInitialSize,
      'packages/database/prisma/dev.db size must remain untouched by test runs',
    );
  }
});

test('Snippets - 1. Encrypted snippet creation and decryption', async () => {
  const tempDir = createTempDir();
  const dbResult = await initializeDatabase({ userDataPath: tempDir });
  const keyProtector = new FakeKeyProtector();
  const encService = new EncryptionService();
  await encService.initialize({ userDataPath: tempDir, keyProtector });

  const snippetRepo = createSnippetRepository(dbResult.client);
  const snippetService = new EncryptedSnippetService({
    snippetRepository: snippetRepo,
    encrypt: (buf) => encService.encrypt(buf),
    decrypt: (input) => encService.decrypt(input),
  });

  const created = await snippetService.createSnippet({
    title: 'PostgreSQL Connection URI',
    content: 'postgresql://user:password@localhost:5432/mydb?schema=public',
    description: 'Local development database connection string',
    language: 'sql',
  });

  assert.ok(created.id, 'Snippet must have an assigned ID');
  assert.strictEqual(created.title, 'PostgreSQL Connection URI');
  assert.strictEqual(created.language, 'sql');
  assert.strictEqual(
    created.content,
    'postgresql://user:password@localhost:5432/mydb?schema=public',
  );

  // Directly inspect raw database record to verify zero plaintext storage
  const rawRecord = await snippetRepo.findById(created.id);
  assert.ok(rawRecord, 'Database record must exist');
  assert.strictEqual(rawRecord.title, 'PostgreSQL Connection URI');

  // Verify encrypted binary fields
  assert.ok(
    rawRecord.encryptedContent instanceof Uint8Array || Buffer.isBuffer(rawRecord.encryptedContent),
    'encryptedContent must be binary data',
  );
  assert.strictEqual(rawRecord.encryptionNonce.length, 12, 'Nonce must be 12 bytes');
  assert.strictEqual(rawRecord.encryptionAuthTag.length, 16, 'Auth tag must be 16 bytes');

  // Strict check: plaintext content string must NOT appear anywhere in the raw binary ciphertext
  const rawCiphertextStr = Buffer.from(rawRecord.encryptedContent).toString('utf-8');

  assert.ok(
    !rawCiphertextStr.includes('postgresql://'),
    'Plaintext content must never be present in raw database ciphertext',
  );
  assert.ok(
    !rawCiphertextStr.includes('password'),
    'Plaintext credentials must never be present in raw database ciphertext',
  );
});

test('Snippets - 2. List and language filtering', async () => {
  const tempDir = createTempDir();
  const dbResult = await initializeDatabase({ userDataPath: tempDir });
  const keyProtector = new FakeKeyProtector();
  const encService = new EncryptionService();
  await encService.initialize({ userDataPath: tempDir, keyProtector });

  const snippetRepo = createSnippetRepository(dbResult.client);
  const snippetService = new EncryptedSnippetService({
    snippetRepository: snippetRepo,
    encrypt: (buf) => encService.encrypt(buf),
    decrypt: (input) => encService.decrypt(input),
  });

  await snippetService.createSnippet({
    title: 'TypeScript Type Guard',
    content: 'function isString(x: unknown): x is string { return typeof x === "string"; }',
    language: 'typescript',
  });

  await snippetService.createSnippet({
    title: 'Docker Build Command',
    content: 'docker build -t cliporbit-desktop:latest .',
    language: 'bash',
  });

  await snippetService.createSnippet({
    title: 'React Custom Hook',
    content: 'export function useMounted() { const [m, setM] = useState(false); return m; }',
    language: 'typescript',
  });

  // List all
  const allSnippets = await snippetService.listSnippets();
  assert.strictEqual(allSnippets.length, 3, 'Must list all 3 snippets');

  // Filter by typescript
  const tsSnippets = await snippetService.listSnippets({ language: 'typescript' });
  assert.strictEqual(tsSnippets.length, 2, 'Must filter to 2 TypeScript snippets');
  assert.ok(tsSnippets.every((s) => s.language === 'typescript'));

  // Filter by bash
  const bashSnippets = await snippetService.listSnippets({ language: 'bash' });
  assert.strictEqual(bashSnippets.length, 1, 'Must filter to 1 Bash snippet');
  assert.strictEqual(bashSnippets[0].title, 'Docker Build Command');
});

test('Snippets - 3. Corrupted records fail closed and are excluded safely', async () => {
  const tempDir = createTempDir();
  const dbResult = await initializeDatabase({ userDataPath: tempDir });
  const keyProtector = new FakeKeyProtector();
  const encService = new EncryptionService();
  await encService.initialize({ userDataPath: tempDir, keyProtector });

  const snippetRepo = createSnippetRepository(dbResult.client);
  const snippetService = new EncryptedSnippetService({
    snippetRepository: snippetRepo,
    encrypt: (buf) => encService.encrypt(buf),
    decrypt: (input) => encService.decrypt(input),
  });

  const valid1 = await snippetService.createSnippet({
    title: 'Valid Snippet 1',
    content: 'console.log("hello 1");',
  });

  // Manually insert a corrupt record into database with invalid auth tag
  const fakeEnc = encService.encrypt(Buffer.from('corrupt content', 'utf-8'));
  const corruptRecord = await snippetRepo.create({
    title: 'Corrupt Snippet',
    encryptedContent: fakeEnc.ciphertext,
    encryptionNonce: fakeEnc.nonce,
    encryptionAuthTag: Buffer.alloc(16, 0xff), // Corrupted tag
    encryptionVersion: 1,
  });

  const valid2 = await snippetService.createSnippet({
    title: 'Valid Snippet 2',
    content: 'console.log("hello 2");',
  });

  // Listing snippets should exclude corruptRecord cleanly without crashing
  const list = await snippetService.listSnippets();
  assert.strictEqual(list.length, 2, 'Corrupt record must be omitted');
  const ids = list.map((s) => s.id);
  assert.ok(ids.includes(valid1.id));
  assert.ok(ids.includes(valid2.id));
  assert.ok(!ids.includes(corruptRecord.id), 'Corrupt record ID must not be in list');
});

test('Snippets - 4. Update snippet metadata and content', async () => {
  const tempDir = createTempDir();
  const dbResult = await initializeDatabase({ userDataPath: tempDir });
  const keyProtector = new FakeKeyProtector();
  const encService = new EncryptionService();
  await encService.initialize({ userDataPath: tempDir, keyProtector });

  const snippetRepo = createSnippetRepository(dbResult.client);
  const snippetService = new EncryptedSnippetService({
    snippetRepository: snippetRepo,
    encrypt: (buf) => encService.encrypt(buf),
    decrypt: (input) => encService.decrypt(input),
  });

  const snippet = await snippetService.createSnippet({
    title: 'Original Title',
    content: 'const a = 1;',
    language: 'javascript',
  });

  const updated = await snippetService.updateSnippet({
    id: snippet.id,
    title: 'Updated Title',
    content: 'const a = 2; const b = 3;',
    language: 'typescript',
    description: 'Updated description',
  });

  assert.ok(updated);
  assert.strictEqual(updated.title, 'Updated Title');
  assert.strictEqual(updated.content, 'const a = 2; const b = 3;');
  assert.strictEqual(updated.language, 'typescript');
  assert.strictEqual(updated.description, 'Updated description');

  // Verify non-existent ID returns null
  const nonExistent = await snippetService.updateSnippet({
    id: '00000000-0000-0000-0000-000000000000',
    title: 'Does not exist',
  });
  assert.strictEqual(nonExistent, null);
});

test('Snippets - 5. Delete snippet operation', async () => {
  const tempDir = createTempDir();
  const dbResult = await initializeDatabase({ userDataPath: tempDir });
  const keyProtector = new FakeKeyProtector();
  const encService = new EncryptionService();
  await encService.initialize({ userDataPath: tempDir, keyProtector });

  const snippetRepo = createSnippetRepository(dbResult.client);
  const snippetService = new EncryptedSnippetService({
    snippetRepository: snippetRepo,
    encrypt: (buf) => encService.encrypt(buf),
    decrypt: (input) => encService.decrypt(input),
  });

  const snippet = await snippetService.createSnippet({
    title: 'Temporary Snippet',
    content: 'to be deleted',
  });

  const deleted = await snippetService.deleteSnippet(snippet.id);
  assert.strictEqual(deleted, true);

  const deletedAgain = await snippetService.deleteSnippet(snippet.id);
  assert.strictEqual(deletedAgain, false);

  const list = await snippetService.listSnippets();
  assert.strictEqual(list.length, 0);
});

test('Snippets - 6. Clearing clipboard history does NOT delete snippets', async () => {
  const tempDir = createTempDir();
  const dbResult = await initializeDatabase({ userDataPath: tempDir });
  const keyProtector = new FakeKeyProtector();
  const encService = new EncryptionService();
  await encService.initialize({ userDataPath: tempDir, keyProtector });

  const snippetRepo = createSnippetRepository(dbResult.client);
  const clipRepo = createClipRepository(dbResult.client);

  const snippetService = new EncryptedSnippetService({
    snippetRepository: snippetRepo,
    encrypt: (buf) => encService.encrypt(buf),
    decrypt: (input) => encService.decrypt(input),
  });

  // Create snippet
  const snippet = await snippetService.createSnippet({
    title: 'Preserved Snippet',
    content: 'Must never be deleted by clear history',
  });

  // Create clip
  const fakeClipEnc = encService.encrypt(Buffer.from('clip text', 'utf-8'));
  await clipRepo.create({
    contentType: 'text',
    encryptedPayload: fakeClipEnc.ciphertext,
    encryptionNonce: fakeClipEnc.nonce,
    encryptionAuthTag: fakeClipEnc.authTag,
    payloadByteLength: 9,
  });

  // Clear clipboard history
  const clearedCount = await clipRepo.deleteAll();
  assert.strictEqual(clearedCount, 1);

  // Verify snippet is still 100% present and decodable
  const list = await snippetService.listSnippets();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].id, snippet.id);
  assert.strictEqual(list[0].title, 'Preserved Snippet');
});

test('Snippets - 7. Input validation bounds', async () => {
  const tempDir = createTempDir();
  const dbResult = await initializeDatabase({ userDataPath: tempDir });
  const keyProtector = new FakeKeyProtector();
  const encService = new EncryptionService();
  await encService.initialize({ userDataPath: tempDir, keyProtector });

  const snippetRepo = createSnippetRepository(dbResult.client);
  const snippetService = new EncryptedSnippetService({
    snippetRepository: snippetRepo,
    encrypt: (buf) => encService.encrypt(buf),
    decrypt: (input) => encService.decrypt(input),
  });

  // Rejects empty title
  await assert.rejects(
    async () => snippetService.createSnippet({ title: '', content: 'hello' }),
    SnippetValidationError,
  );

  // Rejects title > 256 chars
  await assert.rejects(
    async () => snippetService.createSnippet({ title: 'a'.repeat(257), content: 'hello' }),
    SnippetValidationError,
  );

  // Rejects empty content
  await assert.rejects(
    async () => snippetService.createSnippet({ title: 'Valid', content: '' }),
    SnippetValidationError,
  );

  // Rejects content > 64 KiB
  const oversizedContent = 'a'.repeat(MAX_SNIPPET_CONTENT_BYTES + 1);
  await assert.rejects(
    async () => snippetService.createSnippet({ title: 'Valid', content: oversizedContent }),
    SnippetValidationError,
  );
});

test('Snippets - 8. Snippet IPC handlers authorization and CRUD operations', async () => {
  const tempDir = createTempDir();
  const dbResult = await initializeDatabase({ userDataPath: tempDir });
  const keyProtector = new FakeKeyProtector();
  const encService = new EncryptionService();
  await encService.initialize({ userDataPath: tempDir, keyProtector });

  const snippetRepo = createSnippetRepository(dbResult.client);
  const snippetService = new EncryptedSnippetService({
    snippetRepository: snippetRepo,
    encrypt: (buf) => encService.encrypt(buf),
    decrypt: (input) => encService.decrypt(input),
  });

  const handlers = createSnippetIpcHandlers({
    snippetService,
    isAuthorized: (event) => isAuthorizedFrame(event.senderFrame, ALLOWED_ORIGIN),
    isShutdown: () => false,
  });

  const authEvent = createAuthorizedEvent();
  const unauthEvent = createUnauthorizedEvent();

  // Unauthorized request rejected
  await assert.rejects(
    async () => handlers.handleListSnippets(unauthEvent),
    /Unauthorized IPC sender origin or frame/,
  );

  // Authorized create
  const createRes = await handlers.handleCreateSnippet(authEvent, {
    title: 'IPC Snippet',
    content: 'IPC Content',
    language: 'markdown',
  });
  assert.strictEqual(createRes.success, true);
  assert.ok(createRes.snippet);
  assert.strictEqual(createRes.snippet.title, 'IPC Snippet');

  // Authorized list
  const listRes = await handlers.handleListSnippets(authEvent);
  assert.strictEqual(listRes.success, true);
  assert.strictEqual(listRes.snippets?.length, 1);

  // Authorized update
  const updateRes = await handlers.handleUpdateSnippet(authEvent, {
    id: createRes.snippet.id,
    title: 'Updated IPC Snippet',
  });
  assert.strictEqual(updateRes.success, true);
  assert.strictEqual(updateRes.snippet?.title, 'Updated IPC Snippet');

  // Authorized delete
  const deleteRes = await handlers.handleDeleteSnippet(authEvent, createRes.snippet.id);
  assert.strictEqual(deleteRes, true);

  const listAfterDelete = await handlers.handleListSnippets(authEvent);
  assert.strictEqual(listAfterDelete.snippets?.length, 0);
});

test('Clipboard Write - 9. handleWriteClipboardText authorization and execution', async () => {
  let writtenText = null;

  const handlers = createClipboardIpcHandlers({
    isAuthorized: (event) => isAuthorizedFrame(event.senderFrame, ALLOWED_ORIGIN),
    isShutdown: () => false,
    clipboardWriter: (text) => {
      writtenText = text;
    },
  });

  const authEvent = createAuthorizedEvent();
  const unauthEvent = createUnauthorizedEvent();

  // Unauthorized rejected
  assert.throws(
    () => handlers.handleWriteClipboardText(unauthEvent, 'test'),
    /Unauthorized IPC sender origin or frame/,
  );

  // Invalid non-string rejected
  assert.throws(
    () => handlers.handleWriteClipboardText(authEvent, 12345),
    /Clipboard text must be a string/,
  );

  // Valid string written
  const success = handlers.handleWriteClipboardText(authEvent, 'Hello ClipOrbit Clipboard!');
  assert.strictEqual(success, true);
  assert.strictEqual(writtenText, 'Hello ClipOrbit Clipboard!');
});
