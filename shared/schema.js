// shared/schema.js
// Single source of truth for validation. Imported by the API (Node) and the
// React app (Vite). Keep this file free of Node-only or browser-only APIs.
import { z } from "zod";

export const CONSENT_TEXT_VERSION = "2026-11-v1";
export const GENDERS = ["MALE", "FEMALE"];
export const MARITAL_STATUSES = ["SINGLE", "MARRIED", "DIVORCED", "WIDOWED"];
export const ADULT_AGE = 18;
export const MAX_CHILDREN = 10;

/** Current calendar year in Singapore (avoids UTC / device-timezone errors around New Year). */
export function currentYearSG() {
  return Number(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Singapore",
      year: "numeric",
    }).format(new Date()),
  );
}

/** Age rule from the brief: age = current year - year of birth; adult when >= 18. */
export const isAdult = (yearOfBirth, year = currentYearSG()) =>
  year - Number(yearOfBirth) >= ADULT_AGE;

// ---------------------------------------------------------------------------
// Sanitisers
// ---------------------------------------------------------------------------
/** NFC-normalise, collapse whitespace, strip control/zero-width chars, trim. */
const clean = (v) =>
  typeof v === "string"
    ? v
        .normalize("NFC")
        .replace(/\s+/g, " ")
        .replace(/[\u0000-\u001F\u007F-\u009F\u200B\uFEFF]/g, "")
        .trim()
    : v;

/** '' / null / whitespace -> undefined (so optional fields behave). */
const emptyToUndefined = (v) => {
  const c = clean(v);
  return c === "" || c === null ? undefined : c;
};

/** Numeric strings from inputs -> numbers; leaves everything else untouched. */
const toNumber = (v) =>
  typeof v === "string" && v.trim() !== "" ? Number(v) : v;

// ---------------------------------------------------------------------------
// Field builders
// ---------------------------------------------------------------------------
const text = (label, { max, re, reMsg }) =>
  z.preprocess(
    clean,
    z
      .string({
        required_error: `${label} is required`,
        invalid_type_error: `${label} is required`,
      })
      .min(1, `${label} is required`)
      .max(max, `${label} must be ${max} characters or fewer`)
      .regex(re, reMsg ?? `${label} contains invalid characters`),
  );

// Unicode letters/marks so Tamil and other scripts are accepted.
const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u;
const PLACE_RE = /^[\p{L}\p{M}][\p{L}\p{M}\p{N} .,'’()-]*$/u;
const STREET_RE = /^[\p{L}\p{N}][\p{L}\p{M}\p{N} .,'’()/&#-]*$/u;
const BLOCK_RE = /^[A-Za-z0-9][A-Za-z0-9/-]*$/;
const UNIT_RE = /^#?[A-Za-z0-9][A-Za-z0-9/-]*$/;

const name = (label) =>
  text(label, {
    max: 100,
    re: NAME_RE,
    reMsg: `${label} may contain letters, spaces, . ' and - only`,
  });

const yearMsg = "Enter a valid 4-digit year of birth";
const yearOfBirth = z.preprocess(
  toNumber,
  z
    .number({ required_error: yearMsg, invalid_type_error: yearMsg })
    .int(yearMsg)
    .min(1900, "Year of birth must be 1900 or later")
    .refine((y) => y <= currentYearSG(), {
      message: "Year of birth cannot be in the future",
    }),
);

const gender = z.enum(GENDERS, {
  errorMap: () => ({ message: "Select a gender" }),
});
const maritalStatus = z.enum(MARITAL_STATUSES, {
  errorMap: () => ({ message: "Select a marital status" }),
});

/** Singapore mobile: 8 digits starting 3/6/8/9, optional +65 / 65. Output: +65XXXXXXXX */
const mobile = z
  .string({
    required_error: "Mobile number is required",
    invalid_type_error: "Mobile number is required",
  })
  .transform((v) => v.replace(/[\s\-().]/g, ""))
  .refine((v) => /^(\+?65)?[3689]\d{7}$/.test(v), {
    message:
      "Enter a valid Singapore mobile number (8 digits starting with 3, 6, 8 or 9)",
  })
  .transform((v) => `+65${v.slice(-8)}`);

const email = z.preprocess(
  clean,
  z
    .string({
      required_error: "Email is required",
      invalid_type_error: "Email is required",
    })
    .min(1, "Email is required")
    .max(254, "Email must be 254 characters or fewer")
    .email("Enter a valid email address")
    .transform((v) => v.toLowerCase()),
);

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------
const adultFields = {
  fullName: name("Full name"),
  familyName: name("Family name"),
  fatherName: name("Father's name"),
  motherName: name("Mother's name"),
  yearOfBirth,
  gender,
  mobile,
  email,
};

export const mainSchema = z.object({ ...adultFields, maritalStatus }).strict();

export const addressSchema = z
  .object({
    block: text("Block", {
      max: 10,
      re: BLOCK_RE,
      reMsg: "Enter a valid block (e.g. 123A)",
    }),
    street: text("Street", { max: 100, re: STREET_RE }),
    unitNo: text("Unit number", {
      max: 15,
      re: UNIT_RE,
      reMsg: "Enter a valid unit number (e.g. #05-123)",
    }),
    postalCode: z.preprocess(
      clean,
      z
        .string({
          required_error: "Postal code is required",
          invalid_type_error: "Postal code is required",
        })
        .regex(/^\d{6}$/, "Postal code must be exactly 6 digits"),
    ),
  })
  .strict();

export const spouseSchema = z
  .object({
    ...adultFields,
    isFromKoothanallur: z.boolean({
      required_error: "Select Yes or No",
      invalid_type_error: "Select Yes or No",
    }),
    nativePlace: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .max(100, "Native place must be 100 characters or fewer")
        .regex(PLACE_RE, "Native place contains invalid characters")
        .optional(),
    ),
    numberOfChildren: z.preprocess(
      toNumber,
      z
        .number({
          required_error: "Select number of children",
          invalid_type_error: "Select number of children",
        })
        .int("Select number of children")
        .min(0, "Number of children cannot be negative")
        .max(MAX_CHILDREN, `Maximum ${MAX_CHILDREN} children`),
    ),
  })
  .strict();

export const divorceSchema = z
  .object({
    hasChildrenInCustody: z.boolean({
      required_error: "Select Yes or No",
      invalid_type_error: "Select Yes or No",
    }),
    numberOfChildren: z.preprocess(
      toNumber,
      z
        .number({
          required_error: "Select number of children",
          invalid_type_error: "Select number of children",
        })
        .int("Select number of children")
        .min(0, "Number of children cannot be negative")
        .max(MAX_CHILDREN, `Maximum ${MAX_CHILDREN} children`),
    ),
  })
  .strict();

export const childSchema = z
  .object({
    fullName: name("Full name"),
    yearOfBirth,
    gender,
    // Marital status, mobile and email: required only when age >= 18,
    // must be empty otherwise (checked in superRefine).
    maritalStatus: z.preprocess(emptyToUndefined, maritalStatus.optional()),
    mobile: z.preprocess(emptyToUndefined, mobile.optional()),
    email: z.preprocess(emptyToUndefined, email.optional()),
  })
  .strict();

const mustBeTrue = (msg) =>
  z.literal(true, { errorMap: () => ({ message: msg }) });

export const consentSchema = z
  .object({
    accuracyConfirmed: mustBeTrue(
      "You must confirm the data provided is accurate",
    ),
    shareConsent: mustBeTrue(
      "You must consent to share the main member details for wedding invitations",
    ),
    consentTextVersion: z.literal(CONSENT_TEXT_VERSION, {
      errorMap: () => ({
        message: "Consent text version is out of date. Please reload the form.",
      }),
    }),
  })
  .strict();

// ---------------------------------------------------------------------------
// Whole submission
// ---------------------------------------------------------------------------
export const submissionSchema = z
  .object({
    clientToken: z
      .string({
        required_error: "Missing client token",
        invalid_type_error: "Invalid client token",
      })
      .uuid("Invalid client token"),
    website: z.string().max(200).optional(), // honeypot; handled before validation
    main: mainSchema,
    address: addressSchema,
    spouse: z.preprocess(
      (v) => (v === null ? undefined : v),
      spouseSchema.optional(),
    ),
    divorce: z.preprocess(
      (v) => (v === null ? undefined : v),
      divorceSchema.optional(),
    ),
    children: z
      .array(childSchema)
      .max(MAX_CHILDREN, `Maximum ${MAX_CHILDREN} children`)
      .default([]),
    consent: consentSchema,
  })
  .strict()
  .superRefine((d, ctx) => {
    const issue = (path, message) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
    const year = currentYearSG();
    const married = d.main.maritalStatus === "MARRIED";
    const divorced = d.main.maritalStatus === "DIVORCED";

    if (married && !d.spouse)
      issue(
        ["spouse"],
        "Spouse details are required when marital status is Married",
      );
    if (!married && d.spouse)
      issue(
        ["spouse"],
        "Spouse details are only accepted when marital status is Married",
      );

    if (divorced && !d.divorce)
      issue(
        ["divorce"],
        "Custody details are required when marital status is Divorced",
      );
    if (!divorced && d.divorce)
      issue(
        ["divorce"],
        "Custody details are only accepted when marital status is Divorced",
      );
    if (!married && !divorced && d.children.length > 0) {
      issue(
        ["children"],
        "Children are only accepted when marital status is Married or Divorced",
      );
    }

    if (d.divorce) {
      const dv = d.divorce;
      if (dv.hasChildrenInCustody === false && dv.numberOfChildren !== 0) {
        issue(
          ["divorce", "numberOfChildren"],
          "Number of children must be 0 when no child is in your custody",
        );
      }
      if (dv.hasChildrenInCustody === true && dv.numberOfChildren < 1) {
        issue(
          ["divorce", "numberOfChildren"],
          "Enter at least 1 child when a child is in your custody",
        );
      }
      if (dv.numberOfChildren !== d.children.length) {
        issue(
          ["divorce", "numberOfChildren"],
          "Number of children does not match the children listed",
        );
      }
    }

    if (d.spouse) {
      const s = d.spouse;
      if (s.isFromKoothanallur === false && !s.nativePlace) {
        issue(
          ["spouse", "nativePlace"],
          "Native place is required when spouse is not from Koothanallur",
        );
      }
      if (s.isFromKoothanallur === true && s.nativePlace) {
        issue(
          ["spouse", "nativePlace"],
          "Native place must be empty when spouse is from Koothanallur",
        );
      }
      if (s.numberOfChildren !== d.children.length) {
        issue(
          ["spouse", "numberOfChildren"],
          "Number of children does not match the children listed",
        );
      }
    }

    d.children.forEach((c, i) => {
      if (isAdult(c.yearOfBirth, year)) {
        if (!c.maritalStatus)
          issue(
            ["children", i, "maritalStatus"],
            "Marital status is required for children aged 18 or over",
          );
        if (!c.mobile)
          issue(
            ["children", i, "mobile"],
            "Mobile number is required for children aged 18 or over",
          );
        if (!c.email)
          issue(
            ["children", i, "email"],
            "Email is required for children aged 18 or over",
          );
      } else {
        if (c.maritalStatus)
          issue(
            ["children", i, "maritalStatus"],
            "Marital status must be empty for children under 18",
          );
        if (c.mobile)
          issue(
            ["children", i, "mobile"],
            "Mobile number must be empty for children under 18",
          );
        if (c.email)
          issue(
            ["children", i, "email"],
            "Email must be empty for children under 18",
          );
      }
    });
  });
