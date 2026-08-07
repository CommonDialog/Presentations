-- CRM database bootstrap.
-- Run this ONCE as the PostgreSQL superuser (e.g. `postgres`) in pgAdmin.
-- Everything after this script — schema migrations included — runs as crm_user
-- via `npm run db:setup -w @crm/api`.
--
-- The password below matches crm/.env (gitignored). Change both together if desired.

CREATE ROLE crm_user
    LOGIN
    PASSWORD 'CrmDev2026!Secure#Pwd'
    NOSUPERUSER
    NOCREATEROLE
    CREATEDB;  -- lets tooling recreate crm_test; drop this grant in production

CREATE DATABASE crm OWNER crm_user;
CREATE DATABASE crm_test OWNER crm_user;

COMMENT ON DATABASE crm IS 'AI-native CRM — development';
COMMENT ON DATABASE crm_test IS 'AI-native CRM — integration tests';
