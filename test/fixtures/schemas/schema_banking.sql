-- =====================================================================
-- Domain 2: RETAIL BANKING CORE  (10 tables)
-- Inspired by open-source bank system sample schemas. PostgreSQL DDL.
-- =====================================================================

CREATE TABLE branches (
    branch_id       INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    branch_code     VARCHAR(10) NOT NULL UNIQUE,
    branch_name     VARCHAR(100) NOT NULL,
    ifsc_code       VARCHAR(11) NOT NULL UNIQUE,
    city            VARCHAR(80) NOT NULL,
    opened_date     DATE NOT NULL
);

CREATE TABLE customers (
    customer_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    branch_id       INT NOT NULL REFERENCES branches(branch_id),
    full_name       VARCHAR(120) NOT NULL,
    date_of_birth   DATE NOT NULL,
    kyc_status      VARCHAR(10) NOT NULL DEFAULT 'PENDING'
                    CHECK (kyc_status IN ('PENDING','VERIFIED','REJECTED','EXPIRED')),
    risk_rating     VARCHAR(8) NOT NULL DEFAULT 'LOW'
                    CHECK (risk_rating IN ('LOW','MEDIUM','HIGH')),
    email           VARCHAR(255) UNIQUE,
    phone           VARCHAR(20) NOT NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE accounts (
    account_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account_number  VARCHAR(18) NOT NULL UNIQUE,
    branch_id       INT NOT NULL REFERENCES branches(branch_id),
    account_type    VARCHAR(12) NOT NULL
                    CHECK (account_type IN ('SAVINGS','CURRENT','SALARY','FIXED_DEP')),
    balance         NUMERIC(16,2) NOT NULL DEFAULT 0,
    currency        CHAR(3) NOT NULL DEFAULT 'INR',
    status          VARCHAR(10) NOT NULL DEFAULT 'ACTIVE'
                    CHECK (status IN ('ACTIVE','DORMANT','FROZEN','CLOSED')),
    opened_date     DATE NOT NULL,
    closed_date     DATE
);

CREATE TABLE account_holders (
    account_id      BIGINT NOT NULL REFERENCES accounts(account_id),
    customer_id     BIGINT NOT NULL REFERENCES customers(customer_id),
    holder_role     VARCHAR(10) NOT NULL DEFAULT 'PRIMARY'
                    CHECK (holder_role IN ('PRIMARY','JOINT','NOMINEE')),
    added_date      DATE NOT NULL,
    PRIMARY KEY (account_id, customer_id)
);

CREATE TABLE transactions (
    transaction_id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account_id      BIGINT NOT NULL REFERENCES accounts(account_id),
    txn_timestamp   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    txn_type        VARCHAR(12) NOT NULL
                    CHECK (txn_type IN ('DEPOSIT','WITHDRAWAL','TRANSFER_IN','TRANSFER_OUT','FEE','INTEREST')),
    amount          NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    balance_after   NUMERIC(16,2) NOT NULL,
    channel         VARCHAR(10) NOT NULL
                    CHECK (channel IN ('BRANCH','ATM','UPI','NEFT','RTGS','IMPS','CARD')),
    reference_no    VARCHAR(30) NOT NULL UNIQUE,
    narration       VARCHAR(200)
);

CREATE TABLE beneficiaries (
    beneficiary_id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_id     BIGINT NOT NULL REFERENCES customers(customer_id),
    nickname        VARCHAR(60) NOT NULL,
    account_number  VARCHAR(18) NOT NULL,
    ifsc_code       VARCHAR(11) NOT NULL,
    added_date      DATE NOT NULL,
    is_verified     BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (customer_id, account_number)
);

CREATE TABLE loans (
    loan_id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_id     BIGINT NOT NULL REFERENCES customers(customer_id),
    branch_id       INT NOT NULL REFERENCES branches(branch_id),
    loan_type       VARCHAR(10) NOT NULL
                    CHECK (loan_type IN ('HOME','AUTO','PERSONAL','EDUCATION','GOLD')),
    principal       NUMERIC(14,2) NOT NULL CHECK (principal > 0),
    interest_rate   NUMERIC(5,2) NOT NULL CHECK (interest_rate BETWEEN 0 AND 30),
    tenure_months   INT NOT NULL CHECK (tenure_months BETWEEN 6 AND 360),
    disbursed_date  DATE,
    loan_status     VARCHAR(12) NOT NULL DEFAULT 'APPLIED'
                    CHECK (loan_status IN ('APPLIED','APPROVED','DISBURSED','CLOSED','DEFAULTED','REJECTED'))
);

CREATE TABLE loan_payments (
    payment_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    loan_id         BIGINT NOT NULL REFERENCES loans(loan_id),
    due_date        DATE NOT NULL,
    paid_date       DATE,
    emi_amount      NUMERIC(12,2) NOT NULL CHECK (emi_amount > 0),
    principal_part  NUMERIC(12,2) NOT NULL,
    interest_part   NUMERIC(12,2) NOT NULL,
    payment_status  VARCHAR(10) NOT NULL DEFAULT 'DUE'
                    CHECK (payment_status IN ('DUE','PAID','LATE','MISSED'))
);

CREATE TABLE cards (
    card_id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account_id      BIGINT NOT NULL REFERENCES accounts(account_id),
    card_type       VARCHAR(8) NOT NULL CHECK (card_type IN ('DEBIT','CREDIT')),
    masked_number   VARCHAR(19) NOT NULL,
    expiry_date     DATE NOT NULL,
    credit_limit    NUMERIC(12,2) CHECK (credit_limit > 0),
    card_status     VARCHAR(10) NOT NULL DEFAULT 'ACTIVE'
                    CHECK (card_status IN ('ACTIVE','BLOCKED','EXPIRED','HOTLISTED'))
);

CREATE TABLE fraud_alerts (
    alert_id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    transaction_id  BIGINT NOT NULL REFERENCES transactions(transaction_id),
    alert_timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    alert_type      VARCHAR(20) NOT NULL
                    CHECK (alert_type IN ('VELOCITY','GEO_ANOMALY','LARGE_AMOUNT','PATTERN','DEVICE_CHANGE')),
    severity        VARCHAR(8) NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH')),
    resolution      VARCHAR(12) NOT NULL DEFAULT 'OPEN'
                    CHECK (resolution IN ('OPEN','FALSE_POS','CONFIRMED','ESCALATED'))
);
