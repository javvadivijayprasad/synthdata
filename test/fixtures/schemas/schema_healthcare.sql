-- =====================================================================
-- Domain 3: HEALTHCARE / OUTPATIENT CLINIC  (10 tables)
-- Inspired by open-source references: Synthea, OMOP CDM (simplified).
-- PostgreSQL-compatible DDL.
-- =====================================================================

CREATE TABLE departments (
    department_id   INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    dept_name       VARCHAR(80) NOT NULL UNIQUE,
    floor_number    INT,
    phone_ext       VARCHAR(6)
);

CREATE TABLE providers (
    provider_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    department_id   INT NOT NULL REFERENCES departments(department_id),
    full_name       VARCHAR(120) NOT NULL,
    specialty       VARCHAR(60) NOT NULL,
    license_number  VARCHAR(20) NOT NULL UNIQUE,
    provider_type   VARCHAR(15) NOT NULL
                    CHECK (provider_type IN ('PHYSICIAN','NURSE_PRACT','SPECIALIST','RESIDENT')),
    hired_date      DATE NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE patients (
    patient_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    mrn             VARCHAR(12) NOT NULL UNIQUE,
    full_name       VARCHAR(120) NOT NULL,
    date_of_birth   DATE NOT NULL,
    gender          VARCHAR(10) NOT NULL,
    blood_group     VARCHAR(3) CHECK (blood_group IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
    phone           VARCHAR(20),
    emergency_contact VARCHAR(120),
    registered_date DATE NOT NULL,
    is_deceased     BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE insurance_policies (
    policy_id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    patient_id      BIGINT NOT NULL REFERENCES patients(patient_id),
    payer_name      VARCHAR(100) NOT NULL,
    policy_number   VARCHAR(30) NOT NULL UNIQUE,
    coverage_type   VARCHAR(12) NOT NULL
                    CHECK (coverage_type IN ('PRIVATE','GOVT','CORPORATE','SELF_PAY')),
    valid_from      DATE NOT NULL,
    valid_to        DATE NOT NULL,
    annual_limit    NUMERIC(12,2) CHECK (annual_limit >= 0)
);

CREATE TABLE appointments (
    appointment_id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    patient_id      BIGINT NOT NULL REFERENCES patients(patient_id),
    provider_id     BIGINT NOT NULL REFERENCES providers(provider_id),
    scheduled_at    TIMESTAMP NOT NULL,
    appt_status     VARCHAR(12) NOT NULL DEFAULT 'SCHEDULED'
                    CHECK (appt_status IN ('SCHEDULED','CHECKED_IN','COMPLETED','NO_SHOW','CANCELLED')),
    visit_reason    VARCHAR(200),
    booked_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE encounters (
    encounter_id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    appointment_id  BIGINT REFERENCES appointments(appointment_id),
    patient_id      BIGINT NOT NULL REFERENCES patients(patient_id),
    provider_id     BIGINT NOT NULL REFERENCES providers(provider_id),
    encounter_type  VARCHAR(12) NOT NULL
                    CHECK (encounter_type IN ('OUTPATIENT','EMERGENCY','TELEHEALTH','FOLLOW_UP')),
    started_at      TIMESTAMP NOT NULL,
    ended_at        TIMESTAMP,
    chief_complaint VARCHAR(300)
);

CREATE TABLE diagnoses (
    diagnosis_id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    encounter_id    BIGINT NOT NULL REFERENCES encounters(encounter_id),
    icd10_code      VARCHAR(8) NOT NULL,
    description     VARCHAR(255) NOT NULL,
    is_chronic      BOOLEAN NOT NULL DEFAULT FALSE,
    diagnosed_at    TIMESTAMP NOT NULL
);

CREATE TABLE prescriptions (
    prescription_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    encounter_id    BIGINT NOT NULL REFERENCES encounters(encounter_id),
    drug_name       VARCHAR(120) NOT NULL,
    dosage          VARCHAR(50) NOT NULL,
    frequency       VARCHAR(50) NOT NULL,
    duration_days   INT NOT NULL CHECK (duration_days BETWEEN 1 AND 365),
    refills_allowed INT NOT NULL DEFAULT 0 CHECK (refills_allowed BETWEEN 0 AND 12),
    prescribed_at   TIMESTAMP NOT NULL
);

CREATE TABLE lab_orders (
    lab_order_id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    encounter_id    BIGINT NOT NULL REFERENCES encounters(encounter_id),
    test_code       VARCHAR(15) NOT NULL,
    test_name       VARCHAR(120) NOT NULL,
    ordered_at      TIMESTAMP NOT NULL,
    result_value    VARCHAR(60),
    result_unit     VARCHAR(20),
    result_status   VARCHAR(12) NOT NULL DEFAULT 'ORDERED'
                    CHECK (result_status IN ('ORDERED','IN_PROGRESS','RESULTED','CANCELLED')),
    is_abnormal     BOOLEAN
);

CREATE TABLE claims (
    claim_id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    encounter_id    BIGINT NOT NULL REFERENCES encounters(encounter_id),
    policy_id       BIGINT NOT NULL REFERENCES insurance_policies(policy_id),
    claim_amount    NUMERIC(12,2) NOT NULL CHECK (claim_amount > 0),
    approved_amount NUMERIC(12,2) CHECK (approved_amount >= 0),
    claim_status    VARCHAR(12) NOT NULL DEFAULT 'SUBMITTED'
                    CHECK (claim_status IN ('SUBMITTED','IN_REVIEW','APPROVED','PARTIAL','DENIED','PAID')),
    submitted_date  DATE NOT NULL,
    settled_date    DATE
);
