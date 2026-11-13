import { sql } from './inspect_internal_transfer_rpc.mjs';

async function testPlpgsql() {
  const testScript = `
    DO $$
    DECLARE
      v_cnt integer;
    BEGIN
      SELECT count(*) INTO v_cnt FROM investors;
      RAISE NOTICE 'Found % investors', v_cnt;
    END $$;
  `;
  const res = await sql(testScript);
  console.log('Result:', res);
}

testPlpgsql().catch(console.error);
