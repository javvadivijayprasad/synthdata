-- =====================================================================
-- Domain 4: HR / PAYROLL  (10 tables)
-- Inspired by open-source reference: Oracle HR sample schema (extended
-- with payroll and leave management). PostgreSQL-compatible DDL.
-- =====================================================================

CREATE TABLE departments (
    department_id   INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    dept_name       VARCHAR(80) NOT NULL UNIQUE,
    cost_center     VARCHAR(10) NOT NULL,
    location_city   VARCHAR(80) NOT NULL
);

CREATE TABLE jobs (
    job_id          INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_title       VARCHAR(100) NOT NULL,
    job_level       VARCHAR(5) NOT NULL CHECK (job_level IN ('L1','L2','L3','L4','L5','L6')),
    min_salary      NUMERIC(12,2) NOT NULL CHECK (min_salary > 0),
    max_salary      NUMERIC(12,2) NOT NULL,
    CHECK (max_salary >= min_salary)
);

CREATE TABLE employees (
    employee_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    employee_code   VARCHAR(10) NOT NULL UNIQUE,
    full_name       VARCHAR(120) NOT NULL,
    work_email      VARCHAR(255) NOT NULL UNIQUE,
    department_id   INT NOT NULL REFERENCES departments(department_id),
    job_id          INT NOT NULL REFERENCES jobs(job_id),
    manager_id      BIGINT REFERENCES employees(employee_id),
    hire_date       DATE NOT NULL,
    termination_date DATE,
    employment_type VARCHAR(10) NOT NULL DEFAULT 'FULL_TIME'
                    CHECK (employment_type IN ('FULL_TIME','PART_TIME','CONTRACT','INTERN')),
    status          VARCHAR(10) NOT NULL DEFAULT 'ACTIVE'
                    CHECK (status IN ('ACTIVE','ON_LEAVE','TERMINATED','NOTICE'))
);

CREATE TABLE employment_history (
    history_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    employee_id     BIGINT NOT NULL REFERENCES employees(employee_id),
    department_id   INT NOT NULL REFERENCES departments(department_id),
    job_id          INT NOT NULL REFERENCES jobs(job_id),
    start_date      DATE NOT NULL,
    end_date        DATE,
    change_reason   VARCHAR(20) NOT NULL
                    CHECK (change_reason IN ('HIRE','PROMOTION','TRANSFER','DEMOTION','RESTRUCTURE'))
);

CREATE TABLE compensation (
    comp_id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    employee_id     BIGINT NOT NULL REFERENCES employees(employee_id),
    effective_date  DATE NOT NULL,
    base_salary     NUMERIC(12,2) NOT NULL CHECK (base_salary > 0),
    variable_pct    NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (variable_pct BETWEEN 0 AND 100),
    currency        CHAR(3) NOT NULL DEFAULT 'INR',
    UNIQUE (employee_id, effective_date)
);

CREATE TABLE payroll_runs (
    run_id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    pay_period_start DATE NOT NULL,
    pay_period_end  DATE NOT NULL,
    run_date        DATE NOT NULL,
    run_status      VARCHAR(12) NOT NULL DEFAULT 'DRAFT'
                    CHECK (run_status IN ('DRAFT','CALCULATED','APPROVED','PAID','REVERSED')),
    UNIQUE (pay_period_start, pay_period_end),
    CHECK (pay_period_end > pay_period_start)
);

CREATE TABLE payslips (
    payslip_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_id          BIGINT NOT NULL REFERENCES payroll_runs(run_id),
    employee_id     BIGINT NOT NULL REFERENCES employees(employee_id),
    gross_pay       NUMERIC(12,2) NOT NULL CHECK (gross_pay >= 0),
    total_deductions NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total_deductions >= 0),
    net_pay         NUMERIC(12,2) NOT NULL CHECK (net_pay >= 0),
    tax_withheld    NUMERIC(12,2) NOT NULL DEFAULT 0,
    UNIQUE (run_id, employee_id)
);

CREATE TABLE leave_types (
    leave_type_id   INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    type_name       VARCHAR(40) NOT NULL UNIQUE,
    annual_quota    NUMERIC(5,1) NOT NULL CHECK (annual_quota >= 0),
    is_paid         BOOLEAN NOT NULL DEFAULT TRUE,
    carry_forward   BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE leave_requests (
    request_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    employee_id     BIGINT NOT NULL REFERENCES employees(employee_id),
    leave_type_id   INT NOT NULL REFERENCES leave_types(leave_type_id),
    start_date      DATE NOT NULL,
    end_date        DATE NOT NULL,
    days_count      NUMERIC(4,1) NOT NULL CHECK (days_count > 0),
    request_status  VARCHAR(10) NOT NULL DEFAULT 'PENDING'
                    CHECK (request_status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
    approved_by     BIGINT REFERENCES employees(employee_id),
    requested_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (end_date >= start_date)
);

CREATE TABLE performance_reviews (
    review_id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    employee_id     BIGINT NOT NULL REFERENCES employees(employee_id),
    reviewer_id     BIGINT NOT NULL REFERENCES employees(employee_id),
    review_period   VARCHAR(10) NOT NULL,
    overall_rating  INT NOT NULL CHECK (overall_rating BETWEEN 1 AND 5),
    promotion_recommended BOOLEAN NOT NULL DEFAULT FALSE,
    comments        TEXT,
    submitted_at    TIMESTAMP NOT NULL,
    UNIQUE (employee_id, review_period)
);
