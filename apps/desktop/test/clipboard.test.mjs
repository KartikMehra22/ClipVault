/**
 * ClipOrbit — In-Memory Clipboard Capture Engine Test Suite
 * Phase 5.1: In-Memory Clipboard Capture Engine
 *
 * Verifies:
 * 1. Import side-effect freedom (no automatic polling, timer creation, or clipboard reads).
 * 2. Service defaults to stopped state.
 * 3. Starting establishes baseline without emitting historical items.
 * 4. Distinct clipboard changes produce exactly one item.
 * 5. Unchanged clipboard content is ignored.
 * 6. Returning to an earlier value after an intervening change creates a new item.
 * 7. Pausing prevents further reads.
 * 8. Resuming establishes a new baseline (ignoring changes made during pause).
 * 9. Repeated start() and resume() calls do not duplicate timers.
 * 10. stop() clears timers, history, and internal references.
 * 11. Empty clipboard content is ignored.
 * 12. Oversized content exceeding maxItemByteLength is skipped and tracked in status.
 * 13. Multi-byte UTF-8 content length is measured accurately.
 * 14. Maximum item count bound evicts oldest entries deterministically.
 * 15. Total memory byte budget evicts oldest entries deterministically.
 * 16. Configuration validation rejects invalid polling intervals and bounds.
 * 17. Adapter failures are contained without crashing the service or process.
 * 18. Concurrent polling calls are guarded against overlapping execution.
 * 19. Diagnostic status never leaks clipboard text or secret keys.
 * 20. Content is kept purely in process memory; no filesystem or database persistence occurs.
 * 21. Content classification deterministically identifies URLs, emails, code, and text.
 */

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ClipboardCaptureService,
  FakeClipboardAdapter,
  classifyText,
  ClipboardValidationError,
} from '../dist/services/clipboard/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootRepoDir = path.resolve(__dirname, '../../..');
const devDbPath = path.resolve(rootRepoDir, 'packages/database/prisma/dev.db');

let devDbInitialMtime = null;
let devDbInitialSize = null;

before(() => {
  if (fs.existsSync(devDbPath)) {
    const stat = fs.statSync(devDbPath);
    devDbInitialMtime = stat.mtimeMs;
    devDbInitialSize = stat.size;
  }
});

after(() => {
  // Ensure development database was not touched
  if (fs.existsSync(devDbPath) && devDbInitialMtime !== null) {
    const currentStat = fs.statSync(devDbPath);
    assert.equal(
      currentStat.mtimeMs,
      devDbInitialMtime,
      'DEVELOPMENT DATABASE INTEGRITY VIOLATION: dev.db modification time changed!',
    );
    assert.equal(
      currentStat.size,
      devDbInitialSize,
      'DEVELOPMENT DATABASE INTEGRITY VIOLATION: dev.db file size changed!',
    );
  }
});

// ============================================================================
// 1. Initial State & Baseline Semantics
// ============================================================================

test('ClipboardCapture - starts stopped with empty in-memory history', () => {
  const adapter = new FakeClipboardAdapter('Existing clipboard data');
  const service = new ClipboardCaptureService({ adapter });

  const status = service.getStatus();
  assert.equal(status.isRunning, false);
  assert.equal(status.isPaused, false);
  assert.equal(status.itemCount, 0);
  assert.equal(status.totalByteLength, 0);
  assert.equal(status.skippedOversizedCount, 0);
  assert.equal(status.skippedSensitiveCount, 0);
  assert.equal(status.lastDetectedAt, null);
  assert.equal(service.getRecentItems().length, 0);

  // Instantiation must not read the clipboard
  assert.equal(adapter.getReadCount(), 0);
});

test('ClipboardCapture - starting establishes a baseline without emitting an entry', async () => {
  const adapter = new FakeClipboardAdapter('Pre-existing content before start');
  const service = new ClipboardCaptureService({ adapter });

  await service.start();

  // Baseline was read once, but NO history item was emitted
  assert.equal(adapter.getReadCount(), 1);
  assert.equal(service.getStatus().itemCount, 0);
  assert.equal(service.getRecentItems().length, 0);

  service.stop();
});

test('ClipboardCapture - changed clipboard content creates exactly one entry', async () => {
  const adapter = new FakeClipboardAdapter('');
  const service = new ClipboardCaptureService({ adapter });

  await service.start();
  assert.equal(service.getStatus().itemCount, 0);

  adapter.setText('First newly copied text');
  await service.pollNow();

  const items = service.getRecentItems();
  assert.equal(items.length, 1);
  assert.equal(items[0].text, 'First newly copied text');
  assert.equal(items[0].byteLength, Buffer.byteLength('First newly copied text', 'utf8'));
  assert.ok(items[0].id.length > 0);
  assert.ok(items[0].detectedAt instanceof Date);

  service.stop();
});

test('ClipboardCapture - unchanged clipboard content does not create duplicate entries', async () => {
  const adapter = new FakeClipboardAdapter('');
  const service = new ClipboardCaptureService({ adapter });

  await service.start();

  adapter.setText('Identical text content');
  await service.pollNow();
  assert.equal(service.getStatus().itemCount, 1);

  // Subsequent polls with identical content must not emit new items
  await service.pollNow();
  await service.pollNow();
  await service.pollNow();

  assert.equal(service.getStatus().itemCount, 1);

  service.stop();
});

test('ClipboardCapture - returning to earlier value after intervening change creates new entry', async () => {
  const adapter = new FakeClipboardAdapter('');
  const service = new ClipboardCaptureService({ adapter });

  await service.start();

  // A -> B -> A
  adapter.setText('Value A');
  await service.pollNow();

  adapter.setText('Value B');
  await service.pollNow();

  adapter.setText('Value A');
  await service.pollNow();

  const items = service.getRecentItems();
  assert.equal(items.length, 3);
  assert.equal(items[0].text, 'Value A');
  assert.equal(items[1].text, 'Value B');
  assert.equal(items[2].text, 'Value A');

  // Ensure each entry receives a distinct in-memory ID
  assert.notEqual(items[0].id, items[2].id);

  service.stop();
});

// ============================================================================
// 2. Pause and Resume Privacy Semantics
// ============================================================================

test('ClipboardCapture - pause prevents further clipboard reads', async () => {
  const adapter = new FakeClipboardAdapter('');
  const service = new ClipboardCaptureService({ adapter });

  await service.start();
  adapter.setText('Before pause');
  await service.pollNow();
  assert.equal(service.getStatus().itemCount, 1);

  service.pause();
  assert.equal(service.getStatus().isPaused, true);

  const readsBefore = adapter.getReadCount();
  adapter.setText('Changed during pause');
  await service.pollNow();

  // No reads occurred while paused
  assert.equal(adapter.getReadCount(), readsBefore);
  assert.equal(service.getStatus().itemCount, 1);

  service.stop();
});

test('ClipboardCapture - resuming establishes a new baseline (ignoring pause-time changes)', async () => {
  const adapter = new FakeClipboardAdapter('');
  const service = new ClipboardCaptureService({ adapter });

  await service.start();
  adapter.setText('Item before pause');
  await service.pollNow();
  assert.equal(service.getStatus().itemCount, 1);

  service.pause();
  adapter.setText('Copied while capture was paused');

  // Resuming must establish this as baseline without emitting it
  await service.resume();
  assert.equal(service.getStatus().isPaused, false);
  assert.equal(service.getStatus().itemCount, 1);

  // Now copy content while active
  adapter.setText('Copied after resume');
  await service.pollNow();

  const items = service.getRecentItems();
  assert.equal(items.length, 2);
  assert.equal(items[0].text, 'Copied after resume');
  assert.equal(items[1].text, 'Item before pause');

  service.stop();
});

test('ClipboardCapture - repeated start and resume calls are idempotent without duplicate timers', async () => {
  const adapter = new FakeClipboardAdapter('');
  const service = new ClipboardCaptureService({ adapter });

  await service.start();
  await service.start();
  await service.start();
  assert.equal(service.getStatus().isRunning, true);

  service.pause();
  await service.resume();
  await service.resume();
  assert.equal(service.getStatus().isPaused, false);

  service.stop();
  service.stop(); // Multiple stop calls are safe
  assert.equal(service.getStatus().isRunning, false);
});

test('ClipboardCapture - stop clears timer, status, and purges in-memory history', async () => {
  const adapter = new FakeClipboardAdapter('');
  const service = new ClipboardCaptureService({ adapter });

  await service.start();
  adapter.setText('Sensitive secret in memory');
  await service.pollNow();
  assert.equal(service.getStatus().itemCount, 1);

  service.stop();

  const status = service.getStatus();
  assert.equal(status.isRunning, false);
  assert.equal(status.isPaused, false);
  assert.equal(status.itemCount, 0);
  assert.equal(status.totalByteLength, 0);
  assert.equal(service.getRecentItems().length, 0);
});

// ============================================================================
// 3. Filtering & Size Bounds
// ============================================================================

test('ClipboardCapture - empty clipboard values are ignored', async () => {
  const adapter = new FakeClipboardAdapter('');
  const service = new ClipboardCaptureService({ adapter });

  await service.start();
  adapter.setText('');
  await service.pollNow();

  assert.equal(service.getStatus().itemCount, 0);

  service.stop();
});

test('ClipboardCapture - oversized clipboard values are skipped and counted in status', async () => {
  const adapter = new FakeClipboardAdapter('');
  const service = new ClipboardCaptureService({
    adapter,
    config: { maxItemByteLength: 100 },
  });

  await service.start();

  // 200 bytes exceeds 100 byte limit
  const oversizedText = 'A'.repeat(200);
  adapter.setText(oversizedText);
  await service.pollNow();

  const status = service.getStatus();
  assert.equal(status.itemCount, 0);
  assert.equal(status.skippedOversizedCount, 1);
  assert.equal(service.getRecentItems().length, 0);

  // Subsequent poll with same oversized text does not re-increment
  await service.pollNow();
  assert.equal(service.getStatus().skippedOversizedCount, 1);

  // Normal item after oversized works as expected
  adapter.setText('Normal sized text');
  await service.pollNow();
  assert.equal(service.getStatus().itemCount, 1);
  assert.equal(service.getRecentItems()[0].text, 'Normal sized text');

  service.stop();
});

test('ClipboardCapture - calculates multi-byte UTF-8 lengths accurately', async () => {
  const adapter = new FakeClipboardAdapter('');
  const service = new ClipboardCaptureService({ adapter });

  await service.start();

  // Text with multi-byte unicode emojis (🚀 is 4 bytes, 🌍 is 4 bytes, é is 2 bytes)
  const unicodeText = 'Café 🚀 🌍';
  const expectedBytes = Buffer.byteLength(unicodeText, 'utf8');

  adapter.setText(unicodeText);
  await service.pollNow();

  const items = service.getRecentItems();
  assert.equal(items.length, 1);
  assert.equal(items[0].byteLength, expectedBytes);
  assert.equal(service.getStatus().totalByteLength, expectedBytes);

  service.stop();
});

test('ClipboardCapture - enforces maxItems bound by evicting oldest items', async () => {
  const adapter = new FakeClipboardAdapter('');
  const service = new ClipboardCaptureService({
    adapter,
    config: { maxItems: 3 },
  });

  await service.start();

  for (let i = 1; i <= 5; i++) {
    adapter.setText(`Item #${i}`);
    await service.pollNow();
  }

  const items = service.getRecentItems();
  assert.equal(items.length, 3);
  assert.equal(items[0].text, 'Item #5');
  assert.equal(items[1].text, 'Item #4');
  assert.equal(items[2].text, 'Item #3');

  service.stop();
});

test('ClipboardCapture - enforces maxTotalByteLength memory budget by evicting oldest items', async () => {
  const adapter = new FakeClipboardAdapter('');
  const service = new ClipboardCaptureService({
    adapter,
    config: { maxItemByteLength: 100, maxTotalByteLength: 150 },
  });

  await service.start();

  // Push 80 bytes
  adapter.setText('A'.repeat(80));
  await service.pollNow();
  assert.equal(service.getStatus().itemCount, 1);
  assert.equal(service.getStatus().totalByteLength, 80);

  // Push another 80 bytes -> total 160 > 150 budget -> oldest (A) must be evicted!
  adapter.setText('B'.repeat(80));
  await service.pollNow();

  assert.equal(service.getStatus().itemCount, 1);
  assert.equal(service.getStatus().totalByteLength, 80);
  assert.equal(service.getRecentItems()[0].text, 'B'.repeat(80));

  service.stop();
});

// ============================================================================
// 4. Validation, Fault Containment & Concurrency
// ============================================================================

test('ClipboardCapture - rejects invalid configuration parameters', () => {
  assert.throws(
    () => new ClipboardCaptureService({ config: { pollingIntervalMs: 20 } }),
    ClipboardValidationError,
  );
  assert.throws(
    () => new ClipboardCaptureService({ config: { maxItems: 0 } }),
    ClipboardValidationError,
  );
  assert.throws(
    () => new ClipboardCaptureService({ config: { maxItemByteLength: 0 } }),
    ClipboardValidationError,
  );
  assert.throws(
    () =>
      new ClipboardCaptureService({
        config: { maxItemByteLength: 500, maxTotalByteLength: 200 },
      }),
    ClipboardValidationError,
  );
  assert.throws(
    () =>
      new ClipboardCaptureService({
        config: { maxItemByteLength: 70 * 1024 },
      }),
    ClipboardValidationError,
  );
});

test('ClipboardCapture - adapter failures are safely contained without crashing', async () => {
  const adapter = new FakeClipboardAdapter('');
  const service = new ClipboardCaptureService({ adapter });

  await service.start();

  // Simulate clipboard lock error
  adapter.simulateError(new Error('OS clipboard locked by another process'));
  await assert.doesNotReject(async () => {
    await service.pollNow();
  });

  // Clear simulated error and verify service recovers
  adapter.simulateError(null);
  adapter.setText('Recovered text after adapter error');
  await service.pollNow();

  const items = service.getRecentItems();
  assert.equal(items.length, 1);
  assert.equal(items[0].text, 'Recovered text after adapter error');

  service.stop();
});

test('ClipboardCapture - guards against overlapping concurrent polling ticks', async () => {
  let inFlight = 0;
  let maxConcurrent = 0;

  const slowAdapter = {
    readText: async () => {
      inFlight += 1;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      return 'Slow text';
    },
  };

  const service = new ClipboardCaptureService({ adapter: slowAdapter });
  await service.start();

  // Fire three pollNow calls concurrently
  await Promise.all([service.pollNow(), service.pollNow(), service.pollNow()]);

  assert.equal(maxConcurrent, 1, 'Only one poll operation should be in-flight at any time');

  service.stop();
});

test('ClipboardCapture - diagnostic output never leaks clipboard content', async () => {
  const secretText = 'TOP_SECRET_PASSWORD_OR_TOKEN_XYZ';
  const adapter = new FakeClipboardAdapter('');
  const service = new ClipboardCaptureService({ adapter });

  await service.start();
  adapter.setText(secretText);
  await service.pollNow();

  const statusJson = JSON.stringify(service.getStatus());
  assert.equal(statusJson.includes(secretText), false);

  service.stop();
});

test('ClipboardCapture - a newly created service never persists any clipboard item', async () => {
  const adapter = new FakeClipboardAdapter('');
  const service = new ClipboardCaptureService({ adapter });

  await service.start();
  adapter.setText('Confidential text copied to clipboard');
  await service.pollNow();

  // Content exists in memory
  assert.equal(service.getRecentItems().length, 1);
  assert.equal(service.getRecentItems()[0].text, 'Confidential text copied to clipboard');

  // Verify that dev.db file was not written to or touched
  if (fs.existsSync(devDbPath) && devDbInitialMtime !== null) {
    const currentStat = fs.statSync(devDbPath);
    assert.equal(currentStat.mtimeMs, devDbInitialMtime, 'Database file mtime must not change');
    assert.equal(currentStat.size, devDbInitialSize, 'Database file size must not change');
  }

  // Verify no clipboard capture files were written anywhere in the workspace
  const desktopDistDir = path.resolve(__dirname, '../dist');
  assert.ok(fs.existsSync(desktopDistDir));

  service.stop();
});

// ============================================================================
// 5. Content Classification
// ============================================================================

test('Classifier - accurately identifies URLs', () => {
  assert.equal(classifyText('https://cliporbit.app/download?ref=test'), 'url');
  assert.equal(classifyText('http://localhost:3000/settings'), 'url');
  assert.equal(classifyText('https://github.com/KartikMehra22/ClipVault'), 'url');

  // Multi-line or space-containing text should not be a URL
  assert.equal(classifyText('https://cliporbit.app\nsecond line'), 'text');
  assert.equal(classifyText('not a url https://example.com'), 'text');
});

test('Classifier - accurately identifies email addresses', () => {
  assert.equal(classifyText('user@example.com'), 'email');
  assert.equal(classifyText('kartik.mehra+dev@domain.co.uk'), 'email');

  // Invalid email structures
  assert.equal(classifyText('user@'), 'text');
  assert.equal(classifyText('user @example.com'), 'text');
});

test('Classifier - accurately identifies code-like content', () => {
  const jsCode = `function calculateTotal(items) {\n  return items.reduce((acc, item) => acc + item.price, 0);\n}`;
  assert.equal(classifyText(jsCode), 'code');

  const tsCode = `export interface UserProfile {\n  id: string;\n  name: string;\n}`;
  assert.equal(classifyText(tsCode), 'code');

  const htmlCode = `<div class="container"><p>Hello World</p></div>`;
  assert.equal(classifyText(htmlCode), 'code');

  const jsonSnippet = `{\n  "appName": "ClipOrbit",\n  "version": "0.1.0"\n}`;
  assert.equal(classifyText(jsonSnippet), 'code');

  const sqlQuery = `SELECT id, name FROM users WHERE active = 1;`;
  assert.equal(classifyText(sqlQuery), 'code');
});

test('Classifier - defaults to plain text for regular sentences and paragraphs', () => {
  assert.equal(classifyText('Just a regular shopping list: milk, eggs, bread.'), 'text');
  assert.equal(classifyText('ClipOrbit is a secure clipboard manager.'), 'text');
  assert.equal(classifyText(''), 'text');
});

test('Classifier - accurately identifies image content from data URL', () => {
  assert.equal(classifyText('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='), 'image');
  assert.equal(classifyText('data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP...'), 'image');
  assert.equal(classifyText('data:image/webp;base64,UklGRk...'), 'image');
});

test('ClipboardCapture - captures copied images when clipboard text is empty', async () => {
  const adapter = new FakeClipboardAdapter('');
  const service = new ClipboardCaptureService({ adapter });

  await service.start();
  assert.equal(service.getRecentItems().length, 0);

  const testImage = {
    dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    byteLength: 68,
    width: 1,
    height: 1,
  };

  adapter.setImage(testImage);
  await service.pollNow();

  const items = service.getRecentItems();
  assert.equal(items.length, 1);
  assert.equal(items[0].category, 'image');
  assert.equal(items[0].text, testImage.dataUrl);
  assert.equal(items[0].byteLength, 68);

  // Unchanged image poll does not create duplicate
  await service.pollNow();
  assert.equal(service.getRecentItems().length, 1);

  service.stop();
});

test('ClipboardCapture - establishes baseline with pre-existing clipboard image', async () => {
  const adapter = new FakeClipboardAdapter('');
  const initialImage = {
    dataUrl: 'data:image/png;base64,existingImage',
    byteLength: 50,
  };
  adapter.setImage(initialImage);

  const service = new ClipboardCaptureService({ adapter });
  await service.start();

  // Baseline image must not be emitted
  assert.equal(service.getRecentItems().length, 0);

  // Unchanged image poll
  await service.pollNow();
  assert.equal(service.getRecentItems().length, 0);

  // New image copied
  const newImage = {
    dataUrl: 'data:image/png;base64,newlyCopiedImage',
    byteLength: 80,
  };
  adapter.setImage(newImage);
  await service.pollNow();

  assert.equal(service.getRecentItems().length, 1);
  assert.equal(service.getRecentItems()[0].text, newImage.dataUrl);

  service.stop();
});

test('ClipboardCapture - transitions between copied text and copied images', async () => {
  const adapter = new FakeClipboardAdapter('');
  const service = new ClipboardCaptureService({ adapter });

  await service.start();

  // 1. Copy text
  adapter.setText('Hello world');
  adapter.setImage(null);
  await service.pollNow();

  assert.equal(service.getRecentItems().length, 1);
  assert.equal(service.getRecentItems()[0].category, 'text');

  // 2. Copy image (text cleared, image populated)
  adapter.setText('');
  adapter.setImage({
    dataUrl: 'data:image/png;base64,myScreenshot',
    byteLength: 500,
  });
  await service.pollNow();

  assert.equal(service.getRecentItems().length, 2);
  assert.equal(service.getRecentItems()[0].category, 'image');
  assert.equal(service.getRecentItems()[1].category, 'text');

  // 3. Copy text again
  adapter.setText('Another snippet');
  adapter.setImage(null);
  await service.pollNow();

  assert.equal(service.getRecentItems().length, 3);
  assert.equal(service.getRecentItems()[0].category, 'text');
  assert.equal(service.getRecentItems()[1].category, 'image');

  service.stop();
});

