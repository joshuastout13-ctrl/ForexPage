import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { hashPassword, isBcryptHash } from "../../lib/password.js";

const localEnv = path.resolve(process.cwd(), ".env.local");
const fallbackEnv = "C:/Users/Shilley Pc/ForexPage/.env.local";
dotenv.config({ path: fs.existsSync(localEnv) ? localEnv : fallbackEnv });

const isApply = process.argv.includes("--apply");

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.");
  }

  const supabase = createClient(url, key);
  const { data: investors, error } = await supabase
    .from("investors")
    .select("id, portal_username, role, temp_password")
    .order("id", { ascending: true });

  if (error) throw error;

  const plaintextRows = [];
  let alreadyHashed = 0;
  let emptyPass = 0;

  for (const row of investors || []) {
    const raw = String(row.temp_password || "").trim();
    if (!raw) {
      emptyPass++;
    } else if (isBcryptHash(raw)) {
      alreadyHashed++;
    } else {
      plaintextRows.push({
        id: row.id,
        portal_username: row.portal_username || null,
        role: row.role || "Investor",
        rawLength: raw.length
      });
    }
  }

  console.log(`Mode: ${isApply ? "APPLY" : "DRY-RUN"}`);
  console.log(`Total investors scanned: ${(investors || []).length}`);
  console.log(`Already bcrypt-hashed:   ${alreadyHashed}`);
  console.log(`Empty password:          ${emptyPass}`);
  console.log(`Plaintext needing hash:  ${plaintextRows.length}`);

  if (!isApply) {
    console.log("Dry-run complete. Re-run with --apply to hash plaintext passwords with bcryptjs (rounds=10).");
    return;
  }

  let updated = 0;
  for (const target of plaintextRows) {
    const fullRow = (investors || []).find(r => r.id === target.id);
    const hashed = hashPassword(fullRow.temp_password);
    const { error: updErr } = await supabase
      .from("investors")
      .update({ temp_password: hashed })
      .eq("id", target.id);

    if (updErr) {
      throw new Error(`Failed updating investor ${target.id}: ${updErr.message}`);
    }
    updated++;
  }

  console.log(`Successfully upgraded ${updated} plaintext passwords to bcrypt hashes.`);
}

main().catch(err => {
  console.error("Password migration failed:", err.message);
  process.exit(1);
});
