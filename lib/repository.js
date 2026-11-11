// lib/repository.js
// Single-transaction, insert-only persistence. All SQL is parameterised
// (tagged templates). The API role has no SELECT on data tables, so no RETURNING:
// the API generates every ID itself.
import { randomUUID } from "node:crypto";
import { getSql } from "./db.js";
import { newReferenceNo } from "./reference.js";

const ROLE = { MAIN: 1, SPOUSE: 2, CHILD: 3 }; // matches ref_person_role seed

const hitConstraint = (err, column) =>
  `${err?.constraint ?? ""} ${err?.message ?? ""}`.includes(
    `submission_${column}_key`,
  );

function personInsert(
  sql,
  { id, subId, roleId, sortOrder, p, maritalCode = null },
) {
  return sql`
    INSERT INTO person (id, submission_id, role_id, sort_order, full_name, family_name,
                        father_name, mother_name, year_of_birth, gender_id, marital_status_id)
    VALUES (${id}, ${subId}, ${roleId}, ${sortOrder}, ${p.fullName},
            ${p.familyName ?? null}, ${p.fatherName ?? null}, ${p.motherName ?? null},
            ${p.yearOfBirth},
            (SELECT id FROM ref_gender WHERE code = ${p.gender}),
            (SELECT id FROM ref_marital_status WHERE code = ${maritalCode}))`;
}

const contactInsert = (sql, personId, mobile, email) => sql`
  INSERT INTO person_contact (person_id, mobile_e164, email)
  VALUES (${personId}, ${mobile}, ${email})`;

/** Builds the ordered list of statements (parents before children because FKs are immediate). */
function buildQueries(sql, d, subId, referenceNo) {
  const q = [];

  q.push(sql`
    INSERT INTO submission (id, reference_no, client_token)
    VALUES (${subId}, ${referenceNo}, ${d.clientToken})`);

  q.push(sql`
    INSERT INTO household_address (submission_id, block, street, unit_no, postal_code)
    VALUES (${subId}, ${d.address.block}, ${d.address.street}, ${d.address.unitNo}, ${d.address.postalCode})`);

  q.push(sql`
    INSERT INTO consent_record (submission_id, accuracy_confirmed, share_consent, consent_text_version)
    VALUES (${subId}, ${d.consent.accuracyConfirmed}, ${d.consent.shareConsent}, ${d.consent.consentTextVersion})`);

  // Main member
  const mainId = randomUUID();
  q.push(
    personInsert(sql, {
      id: mainId,
      subId,
      roleId: ROLE.MAIN,
      sortOrder: 0,
      p: d.main,
      maritalCode: d.main.maritalStatus,
    }),
  );
  q.push(contactInsert(sql, mainId, d.main.mobile, d.main.email));

  // Spouse
  if (d.spouse) {
    const spouseId = randomUUID();
    q.push(
      personInsert(sql, {
        id: spouseId,
        subId,
        roleId: ROLE.SPOUSE,
        sortOrder: 0,
        p: d.spouse,
      }),
    );
    q.push(contactInsert(sql, spouseId, d.spouse.mobile, d.spouse.email));
    q.push(sql`
      INSERT INTO spouse_detail (person_id, is_from_koothanallur, native_place)
      VALUES (${spouseId}, ${d.spouse.isFromKoothanallur}, ${d.spouse.nativePlace ?? null})`);
  }

  // Children (contact row only when mobile/email supplied, i.e. age >= 18)
  d.children.forEach((child, idx) => {
    const childId = randomUUID();
    q.push(
      personInsert(sql, {
        id: childId,
        subId,
        roleId: ROLE.CHILD,
        sortOrder: idx + 1,
        p: child,
        maritalCode: child.maritalStatus ?? null, // NULL for children under 18
      }),
    );
    if (child.mobile && child.email)
      q.push(contactInsert(sql, childId, child.mobile, child.email));
  });

  return q;
}

/**
 * Inserts one household atomically.
 * @returns {{ referenceNo: string, duplicate: boolean }}
 */
export async function insertSubmission(data) {
  const sql = getSql();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const subId = randomUUID();
    const referenceNo = newReferenceNo();

    try {
      await sql.transaction(buildQueries(sql, data, subId, referenceNo));
      return { referenceNo, duplicate: false };
    } catch (err) {
      if (err?.code === "23505") {
        // Same client token already stored -> idempotent replay
        if (hitConstraint(err, "client_token")) {
          const rows =
            await sql`SELECT fn_reference_for_token(${data.clientToken}::uuid) AS reference_no`;
          const existing = rows[0]?.reference_no;
          if (existing) return { referenceNo: existing, duplicate: true };
        }
        // Reference number collision (very unlikely) -> generate a new one and retry
        if (hitConstraint(err, "reference_no")) continue;
      }
      throw err;
    }
  }
  throw new Error("Could not allocate a unique reference number");
}
