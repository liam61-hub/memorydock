import { beforeAll, describe, expect, it } from 'vitest';

let getConnection: typeof import('../src/db/lancedb.js')['getConnection'];
let getTable: typeof import('../src/db/lancedb.js')['getTable'];
let resetConnection: () => void;
let fromRow: typeof import('../src/db/schema.js')['fromRow'];
let TABLE_NAME: string;

beforeAll(async () => {
  const db = await import('../src/db/lancedb.js');
  getConnection = db.getConnection;
  getTable = db.getTable;
  resetConnection = db.resetConnection;
  TABLE_NAME = db.TABLE_NAME;
  const schema = await import('../src/db/schema.js');
  fromRow = schema.fromRow;
});

describe('memory table version column migration', () => {
  it('legacy tables (without a version column) get the column added on open, existing rows default to version=1', async () => {
    resetConnection();

    // 1. Pre-create a legacy table using the old schema (no version column)
    const conn = await getConnection();
    const legacySeed = {
      id: '__seed__',
      tenant_id: 'default',
      title: '',
      content: '',
      content_type: 'note',
      tags: ['__seed__'],
      source: '',
      status: 'active',
      metadata: '{}',
      vector: new Array(8).fill(0),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const legacyTable = await conn.createTable(TABLE_NAME, [legacySeed]);
    await legacyTable.delete("id = '__seed__'");
    await legacyTable.add([{
      ...legacySeed,
      id: 'legacy-1',
      title: '存量条目',
      content: '老内容',
      tags: ['旧'],
    }]);

    // 2. Open through getTable() to trigger the migration
    resetConnection();
    const table = await getTable();

    const tableSchema = await table.schema();
    const fieldNames = tableSchema.fields.map(f => f.name);
    expect(fieldNames).toContain('version');

    // 3. Existing rows are readable and version defaults to 1
    const rows = await table.query().toArray();
    const legacy = rows.find(r => r.id === 'legacy-1');
    expect(legacy).toBeTruthy();
    expect(fromRow(legacy).version).toBe(1);
  });
});
