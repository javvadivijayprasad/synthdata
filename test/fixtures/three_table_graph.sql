-- Fixture: three-table referential graph used by the RI resolver tests.
--   customers  (root)
--     -> orders            customer_id NOT NULL, referred_by NULLABLE (two FKs to the same parent)
--          -> order_items  order_id via a table-level FOREIGN KEY clause (depth 2)

CREATE TABLE customers (
  customer_id  INTEGER PRIMARY KEY,
  email        VARCHAR(80) NOT NULL UNIQUE,
  country      VARCHAR(2)  NOT NULL CHECK (country IN ('US','GB','DE','IN')),
  signup_date  DATE        NOT NULL
);

CREATE TABLE orders (
  order_id     INTEGER PRIMARY KEY,
  customer_id  INTEGER       NOT NULL REFERENCES customers(customer_id),
  referred_by  INTEGER       REFERENCES customers(customer_id),
  status       VARCHAR(12)   NOT NULL CHECK (status IN ('new','paid','shipped','cancelled')),
  total_amount NUMERIC(10,2) NOT NULL CHECK (total_amount >= 0),
  placed_at    TIMESTAMP     NOT NULL
);

CREATE TABLE order_items (
  order_item_id INTEGER PRIMARY KEY,
  order_id      INTEGER     NOT NULL,
  product_sku   VARCHAR(16) NOT NULL,
  quantity      INTEGER     NOT NULL CHECK (quantity BETWEEN 1 AND 20),
  unit_price    NUMERIC(8,2) NOT NULL CHECK (unit_price >= 1),
  FOREIGN KEY (order_id) REFERENCES orders(order_id)
);
