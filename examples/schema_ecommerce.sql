-- =====================================================================
-- Domain 1: E-COMMERCE / RETAIL  (10 tables)
-- Inspired by open-source references: Oracle CO (Customer Orders),
-- Northwind, Sakila. PostgreSQL-compatible DDL.
-- =====================================================================

CREATE TABLE customers (
    customer_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email           VARCHAR(255) NOT NULL UNIQUE,
    full_name       VARCHAR(120) NOT NULL,
    phone           VARCHAR(20),
    customer_tier   VARCHAR(10) NOT NULL DEFAULT 'STANDARD'
                    CHECK (customer_tier IN ('STANDARD','SILVER','GOLD','PREMIUM')),
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE addresses (
    address_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_id     BIGINT NOT NULL REFERENCES customers(customer_id),
    address_type    VARCHAR(10) NOT NULL CHECK (address_type IN ('BILLING','SHIPPING')),
    line1           VARCHAR(200) NOT NULL,
    line2           VARCHAR(200),
    city            VARCHAR(80) NOT NULL,
    state           VARCHAR(80),
    postal_code     VARCHAR(15) NOT NULL,
    country_code    CHAR(2) NOT NULL,
    is_default      BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE categories (
    category_id     INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    parent_id       INT REFERENCES categories(category_id),
    category_name   VARCHAR(80) NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE products (
    product_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    category_id     INT NOT NULL REFERENCES categories(category_id),
    sku             VARCHAR(30) NOT NULL UNIQUE,
    product_name    VARCHAR(200) NOT NULL,
    unit_price      NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0),
    weight_grams    INT CHECK (weight_grams > 0),
    status          VARCHAR(15) NOT NULL DEFAULT 'ACTIVE'
                    CHECK (status IN ('ACTIVE','DISCONTINUED','OUT_OF_SEASON')),
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE inventory (
    inventory_id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id      BIGINT NOT NULL REFERENCES products(product_id),
    warehouse_code  VARCHAR(10) NOT NULL,
    qty_on_hand     INT NOT NULL CHECK (qty_on_hand >= 0),
    qty_reserved    INT NOT NULL DEFAULT 0 CHECK (qty_reserved >= 0),
    updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (product_id, warehouse_code)
);

CREATE TABLE orders (
    order_id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_id     BIGINT NOT NULL REFERENCES customers(customer_id),
    ship_address_id BIGINT NOT NULL REFERENCES addresses(address_id),
    order_date      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    order_status    VARCHAR(15) NOT NULL DEFAULT 'PENDING'
                    CHECK (order_status IN ('PENDING','PAID','SHIPPED','DELIVERED','CANCELLED','REFUNDED')),
    order_total     NUMERIC(12,2) NOT NULL CHECK (order_total >= 0),
    coupon_code     VARCHAR(20)
);

CREATE TABLE order_items (
    order_item_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id        BIGINT NOT NULL REFERENCES orders(order_id),
    product_id      BIGINT NOT NULL REFERENCES products(product_id),
    quantity        INT NOT NULL CHECK (quantity > 0),
    unit_price      NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0),
    discount_pct    NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 100),
    UNIQUE (order_id, product_id)
);

CREATE TABLE payments (
    payment_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id        BIGINT NOT NULL REFERENCES orders(order_id),
    payment_method  VARCHAR(15) NOT NULL
                    CHECK (payment_method IN ('CARD','UPI','NETBANKING','WALLET','COD')),
    amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    payment_status  VARCHAR(12) NOT NULL DEFAULT 'INITIATED'
                    CHECK (payment_status IN ('INITIATED','SUCCESS','FAILED','REFUNDED')),
    paid_at         TIMESTAMP
);

CREATE TABLE shipments (
    shipment_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id        BIGINT NOT NULL REFERENCES orders(order_id),
    carrier         VARCHAR(40) NOT NULL,
    tracking_number VARCHAR(40) UNIQUE,
    shipped_at      TIMESTAMP,
    delivered_at    TIMESTAMP,
    shipment_status VARCHAR(15) NOT NULL DEFAULT 'PREPARING'
                    CHECK (shipment_status IN ('PREPARING','IN_TRANSIT','DELIVERED','RETURNED','LOST'))
);

CREATE TABLE reviews (
    review_id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id      BIGINT NOT NULL REFERENCES products(product_id),
    customer_id     BIGINT NOT NULL REFERENCES customers(customer_id),
    rating          INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    review_text     TEXT,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (product_id, customer_id)
);
